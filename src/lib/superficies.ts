// Convierte los contornos que devuelve Claude (un polígono por superficie:
// pared, columnas, recuadros, cerámica, ventana…) en zonas listas para pintar.
// Los vértices pueden venir corridos unos píxeles: primero se mira, comparando
// el tono de los dos lados, dónde está el borde real de la foto, y después se
// mueve cada lado del polígono hasta ese borde. El resultado sigue siendo un
// polígono, así que los bordes quedan rectos y sin manchas.
import { cajaPromedio, type CromaFoto } from "./pintar-foto.ts";

export type Punto = [number, number];

export interface Superficie {
  nombre: string;
  tipo: string;
  pintable: boolean;
  poligono: Punto[];
  huecos: Punto[][];
}

export interface MapaSuperficies {
  lista: Superficie[];
  etiquetas: Int16Array;
  ancho: number;
  alto: number;
}

function rellenar(pts: Punto[], etiquetas: Int16Array, ancho: number, alto: number, valor: number, solo?: number): void {
  if (pts.length < 3) return;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [, y] of pts) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const xs: number[] = [];
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(alto - 1, Math.ceil(y1)); y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const [xa, ya] = pts[i];
      const [xb, yb] = pts[(i + 1) % pts.length];
      if ((ya <= cy && yb > cy) || (yb <= cy && ya > cy)) xs.push(xa + ((cy - ya) * (xb - xa)) / (yb - ya));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const desde = Math.max(0, Math.round(xs[i]));
      const hasta = Math.min(ancho, Math.round(xs[i + 1]));
      for (let x = desde; x < hasta; x++) {
        const k = y * ancho + x;
        if (solo === undefined || etiquetas[k] === solo) etiquetas[k] = valor;
      }
    }
  }
}

function areaConSigno(pts: Punto[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[(i + 1) % pts.length];
    a += xa * yb - xb * ya;
  }
  return a / 2;
}

/** Valida y lleva los polígonos de la imagen que vio Claude a la foto real. */
export function limpiarSuperficies(datos: unknown, escalaX: number, escalaY: number): Superficie[] {
  const lista = (datos as { superficies?: unknown })?.superficies;
  if (!Array.isArray(lista)) return [];
  const punto = (p: unknown): Punto | null =>
    Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [Number(p[0]) * escalaX, Number(p[1]) * escalaY] : null;
  const poligono = (v: unknown): Punto[] => (Array.isArray(v) ? v.map(punto).filter((p): p is Punto => !!p) : []);
  const salida: Superficie[] = [];
  for (const s of lista.slice(0, 60)) {
    const pol = poligono(s?.poligono);
    if (pol.length < 3) continue;
    salida.push({
      nombre: String(s?.nombre ?? "").slice(0, 60),
      tipo: String(s?.tipo ?? "otro"),
      pintable: !!s?.pintable,
      poligono: pol,
      huecos: Array.isArray(s?.huecos) ? s.huecos.map(poligono).filter((h: Punto[]) => h.length >= 3) : [],
    });
  }
  return salida;
}

function rasterizar(lista: Superficie[], ancho: number, alto: number): Int16Array {
  const etiquetas = new Int16Array(ancho * alto).fill(-1);
  const orden = lista.map((s, i) => ({ i, a: Math.abs(areaConSigno(s.poligono)) })).sort((a, b) => b.a - a.a);
  for (const { i } of orden) {
    const s = lista[i];
    rellenar(s.poligono, etiquetas, ancho, alto, i);
    for (const h of s.huecos) rellenar(h, etiquetas, ancho, alto, -1, i);
  }
  return etiquetas;
}

export function mapaDeSuperficies(lista: Superficie[], croma: CromaFoto, ancho: number, alto: number): MapaSuperficies {
  const guia = rasterizar(lista, ancho, alto);
  const lado = Math.min(ancho, alto);
  const banda = Math.max(3, Math.round(lado / 110));
  bordesPorTono(guia, lista.length, croma, ancho, alto, banda);
  const ajustadas = lista.map((s, i) => {
    const dentro = (x: number, y: number) => {
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= ancho || yi >= alto) return false;
      return guia[yi * ancho + xi] === i;
    };
    return {
      ...s,
      poligono: enderezar(s.poligono, dentro, banda + 2),
      huecos: s.huecos.map((h) => enderezar(h, (x, y) => !dentro(x, y), banda + 2)),
    };
  });
  const etiquetas = rasterizar(ajustadas, ancho, alto);
  rellenarEsquinas(etiquetas, lista, croma, ancho, alto, Math.max(4, Math.round(lado / 60)));
  return { lista, etiquetas, ancho, alto };
}

/** Las puntas de los polígonos a veces no se tocan y quedan esquinitas sin
 * ninguna superficie. Cada pared pintable crece hacia esos huecos (hasta
 * `alcance` píxeles) solo por donde la foto tiene su mismo tono, así no se
 * pasa al cielo ni a otra cosa que Claude no listó. */
function rellenarEsquinas(etiquetas: Int16Array, lista: Superficie[], croma: CromaFoto, ancho: number, alto: number, alcance: number): void {
  const n = ancho * alto;
  const canales = [croma.logLuz, croma.cr, croma.cg];
  const pisos = [0.1, 0.015, 0.015];
  const cuantas = lista.length;
  const suma = new Float64Array(cuantas * 3);
  const suma2 = new Float64Array(cuantas * 3);
  const cuenta = new Float64Array(cuantas);
  for (let k = 0; k < n; k++) {
    const l = etiquetas[k];
    if (l < 0 || !lista[l].pintable) continue;
    cuenta[l]++;
    for (let c = 0; c < 3; c++) {
      const v = canales[c][k];
      suma[l * 3 + c] += v;
      suma2[l * 3 + c] += v * v;
    }
  }
  const media = new Float64Array(cuantas * 3);
  const desvio = new Float64Array(cuantas * 3);
  for (let l = 0; l < cuantas; l++) {
    if (!cuenta[l]) continue;
    for (let c = 0; c < 3; c++) {
      const m = suma[l * 3 + c] / cuenta[l];
      media[l * 3 + c] = m;
      desvio[l * 3 + c] = Math.max(pisos[c], Math.sqrt(Math.max(0, suma2[l * 3 + c] / cuenta[l] - m * m)));
    }
  }
  const parecido = (k: number, l: number) => {
    let d = 0;
    for (let c = 0; c < 3; c++) d += ((canales[c][k] - media[l * 3 + c]) / desvio[l * 3 + c]) ** 2;
    return d <= 12;
  };
  let frente: number[] = [];
  for (let k = 0; k < n; k++) {
    const l = etiquetas[k];
    if (l < 0 || !cuenta[l]) continue;
    const x = k % ancho;
    if ((x > 0 && etiquetas[k - 1] < 0) || (x < ancho - 1 && etiquetas[k + 1] < 0) || (k >= ancho && etiquetas[k - ancho] < 0) || (k < n - ancho && etiquetas[k + ancho] < 0)) {
      frente.push(k);
    }
  }
  for (let paso = 0; paso < alcance && frente.length; paso++) {
    const siguiente: number[] = [];
    for (const k of frente) {
      const l = etiquetas[k];
      const x = k % ancho;
      const vecinos = [x > 0 ? k - 1 : -1, x < ancho - 1 ? k + 1 : -1, k - ancho, k + ancho];
      for (const v of vecinos) {
        if (v < 0 || v >= n || etiquetas[v] >= 0) continue;
        if (!parecido(v, l)) continue;
        etiquetas[v] = l;
        siguiente.push(v);
      }
    }
    frente = siguiente;
  }
}

/** Mueve cada lado del polígono (cada punta por separado, hasta `alcance`
 * píxeles) a donde mejor separa "adentro" de "afuera", y rearma las esquinas
 * cruzando los lados movidos. */
function enderezar(pts: Punto[], dentro: (x: number, y: number) => boolean, alcance: number): Punto[] {
  const m = pts.length;
  if (m < 3) return pts;
  const giro = areaConSigno(pts) > 0 ? 1 : -1;
  const movidos: { a: Punto; b: Punto; n: Punto }[] = [];
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const largo = Math.hypot(dx, dy);
    if (largo < 1) {
      movidos.push({ a, b, n: [0, 0] });
      continue;
    }
    const n: Punto = [(-dy / largo) * giro, (dx / largo) * giro];
    const muestras = Math.max(4, Math.min(160, Math.round(largo / 2)));
    let mejor = -1;
    let oa = 0;
    let ob = 0;
    for (let pa = -alcance; pa <= alcance; pa++) {
      for (let pb = -alcance; pb <= alcance; pb++) {
        let puntos = 0;
        for (let s = 0; s < muestras; s++) {
          const t = 0.1 + (0.8 * (s + 0.5)) / muestras;
          const o = pa + (pb - pa) * t;
          const x = a[0] + dx * t - n[0] * o;
          const y = a[1] + dy * t - n[1] * o;
          if (dentro(x + n[0] * 1.5, y + n[1] * 1.5) !== dentro(x - n[0] * 1.5, y - n[1] * 1.5)) puntos++;
        }
        const valor = puntos - 0.02 * muestras * (Math.abs(pa) + Math.abs(pb)) / alcance;
        if (valor > mejor) {
          mejor = valor;
          oa = pa;
          ob = pb;
        }
      }
    }
    if (mejor < muestras * 0.35) {
      oa = 0;
      ob = 0;
    }
    movidos.push({
      a: [a[0] - n[0] * oa, a[1] - n[1] * oa],
      b: [b[0] - n[0] * ob, b[1] - n[1] * ob],
      n,
    });
  }
  const salida: Punto[] = [];
  for (let i = 0; i < m; i++) {
    const anterior = movidos[(i - 1 + m) % m];
    const siguiente = movidos[i];
    const cruce = cruzar(anterior.a, anterior.b, siguiente.a, siguiente.b);
    const promedio: Punto = [(anterior.b[0] + siguiente.a[0]) / 2, (anterior.b[1] + siguiente.a[1]) / 2];
    salida.push(cruce && Math.hypot(cruce[0] - promedio[0], cruce[1] - promedio[1]) < alcance * 3 ? cruce : promedio);
  }
  return salida;
}

function cruzar(a: Punto, b: Punto, c: Punto, d: Punto): Punto | null {
  const r: Punto = [b[0] - a[0], b[1] - a[1]];
  const s: Punto = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  const largo = Math.hypot(...r) * Math.hypot(...s);
  if (!largo || Math.abs(den) / largo < 0.15) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

/** Cerca de cada borde entre superficies, pasa cada píxel a la superficie
 * vecina cuyo tono (luz y color de la zona alrededor) se le parece más. */
function bordesPorTono(etiquetas: Int16Array, cuantas: number, croma: CromaFoto, ancho: number, alto: number, banda: number): void {
  const n = ancho * alto;
  const lado = Math.min(ancho, alto);
  const radio = Math.max(6, Math.round(lado / 25));
  const pasos = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, -1, 1, -1, -1, 1];

  const enBanda = new Uint8Array(n);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const k = y * ancho + x;
      const e = etiquetas[k];
      for (let p = 0; p < pasos.length; p += 2) {
        const xx = x + pasos[p] * banda;
        const yy = y + pasos[p + 1] * banda;
        if (xx < 0 || yy < 0 || xx >= ancho || yy >= alto) continue;
        if (etiquetas[yy * ancho + xx] !== e) {
          enBanda[k] = 1;
          break;
        }
      }
    }
  }

  const canales = [croma.logLuz, croma.cr, croma.cg];
  const pisos = [0.08, 0.012, 0.012];
  interface Zona {
    x0: number;
    y0: number;
    w: number;
    medias: Float32Array[];
    desvio: number[];
  }
  const zonas: (Zona | null)[] = [];
  for (let l = 0; l < cuantas; l++) {
    let x0 = ancho;
    let y0 = alto;
    let x1 = -1;
    let y1 = -1;
    let cuenta = 0;
    const suma = [0, 0, 0];
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const k = y * ancho + x;
        if (etiquetas[k] !== l) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (enBanda[k]) continue;
        cuenta++;
        for (let c = 0; c < 3; c++) suma[c] += canales[c][k];
      }
    }
    if (cuenta < 30) {
      zonas.push(null);
      continue;
    }
    const media = suma.map((v) => v / cuenta);
    const var2 = [0, 0, 0];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * ancho + x;
        if (etiquetas[k] !== l || enBanda[k]) continue;
        for (let c = 0; c < 3; c++) var2[c] += (canales[c][k] - media[c]) ** 2;
      }
    }
    const desvio = var2.map((v, c) => Math.max(pisos[c], Math.sqrt(v / cuenta)));
    const m = radio + banda;
    x0 = Math.max(0, x0 - m);
    y0 = Math.max(0, y0 - m);
    x1 = Math.min(ancho - 1, x1 + m);
    y1 = Math.min(alto - 1, y1 + m);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const ind = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y + y0) * ancho + x + x0;
        if (etiquetas[k] === l && !enBanda[k]) ind[y * w + x] = 1;
      }
    }
    const peso = cajaPromedio(ind, w, h, radio);
    const medias: Float32Array[] = [];
    for (let c = 0; c < 3; c++) {
      const prod = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ind[y * w + x]) prod[y * w + x] = canales[c][(y + y0) * ancho + x + x0];
      const caja = cajaPromedio(prod, w, h, radio);
      for (let j = 0; j < caja.length; j++) caja[j] = peso[j] > 0.02 ? caja[j] / peso[j] : media[c];
      medias.push(caja);
    }
    zonas.push({ x0, y0, w, medias, desvio });
  }

  const nuevas = Int16Array.from(etiquetas);
  const vistas = new Set<number>();
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const k = y * ancho + x;
      if (!enBanda[k]) continue;
      vistas.clear();
      vistas.add(etiquetas[k]);
      for (let p = 0; p < pasos.length; p += 2) {
        const xx = x + pasos[p] * banda;
        const yy = y + pasos[p + 1] * banda;
        if (xx >= 0 && yy >= 0 && xx < ancho && yy < alto) vistas.add(etiquetas[yy * ancho + xx]);
      }
      let mejor = etiquetas[k];
      let mejorD = Infinity;
      for (const l of vistas) {
        const z = l >= 0 ? zonas[l] : null;
        if (!z) continue;
        const j = (y - z.y0) * z.w + (x - z.x0);
        let d = 0;
        for (let c = 0; c < 3; c++) d += ((canales[c][k] - z.medias[c][j]) / z.desvio[c]) ** 2;
        if (l === etiquetas[k]) d -= 0.5;
        if (d < mejorD) {
          mejorD = d;
          mejor = l;
        }
      }
      nuevas[k] = mejor;
    }
  }
  etiquetas.set(nuevas);
}

export function superficieEn(mapa: MapaSuperficies, x: number, y: number): number {
  const xi = Math.max(0, Math.min(mapa.ancho - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(mapa.alto - 1, Math.round(y)));
  return mapa.etiquetas[yi * mapa.ancho + xi];
}

/** Máscara de una superficie con el borde apenas suavizado (sin escalones). */
export function mascaraSuperficie(mapa: MapaSuperficies, indice: number): Uint8Array {
  const { etiquetas, ancho, alto } = mapa;
  const n = ancho * alto;
  const base = new Float32Array(n);
  for (let k = 0; k < n; k++) if (etiquetas[k] === indice) base[k] = 1;
  const suave = cajaPromedio(base, ancho, alto, 1);
  const salida = new Uint8Array(n);
  for (let k = 0; k < n; k++) salida[k] = Math.round(suave[k] * 255);
  return salida;
}
