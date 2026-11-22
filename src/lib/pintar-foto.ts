// Pintar una foto real con un color del abanico, sin inventar nada: solo se
// cambia el color de las zonas marcadas y se conservan la luz, las sombras y
// la textura originales de la pared.

export interface ColorCapa {
  r: number;
  g: number;
  b: number;
}

export interface CapaPintura {
  color: ColorCapa;
  alfa: Uint8Array;
  ref?: number;
  pareja?: Pareja;
}

const LINEAL = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAL[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function aLineal(c255: number): number {
  return LINEAL[Math.max(0, Math.min(255, Math.round(c255)))];
}

export function aSrgb(lin: number): number {
  const c = lin <= 0 ? 0 : lin >= 1 ? 1 : lin;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

export function luminanciaLineal(datos: Uint8ClampedArray | Uint8Array, i: number): number {
  return 0.2126 * LINEAL[datos[i]] + 0.7152 * LINEAL[datos[i + 1]] + 0.0722 * LINEAL[datos[i + 2]];
}

/** Promedio en una ventana cuadrada de lado 2r+1 (suma corrida, O(n) sin importar r). */
export function cajaPromedio(entrada: Float32Array, ancho: number, alto: number, r: number): Float32Array {
  const tmp = new Float32Array(ancho * alto);
  const salida = new Float32Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    const fila = y * ancho;
    let suma = 0;
    for (let x = -r; x <= r; x++) suma += entrada[fila + Math.max(0, Math.min(ancho - 1, x))];
    for (let x = 0; x < ancho; x++) {
      tmp[fila + x] = suma / (2 * r + 1);
      const sale = Math.max(0, x - r);
      const entra = Math.min(ancho - 1, x + r + 1);
      suma += entrada[fila + entra] - entrada[fila + sale];
    }
  }
  for (let x = 0; x < ancho; x++) {
    let suma = 0;
    for (let y = -r; y <= r; y++) suma += tmp[Math.max(0, Math.min(alto - 1, y)) * ancho + x];
    for (let y = 0; y < alto; y++) {
      salida[y * ancho + x] = suma / (2 * r + 1);
      const sale = Math.max(0, y - r);
      const entra = Math.min(alto - 1, y + r + 1);
      suma += tmp[entra * ancho + x] - tmp[sale * ancho + x];
    }
  }
  return salida;
}

/** Filtro guiado (He et al.): ajusta la máscara a los bordes reales de la foto. */
export function filtroGuiado(
  guia: Float32Array,
  entrada: Float32Array,
  ancho: number,
  alto: number,
  r: number,
  eps: number,
): Float32Array {
  const n = ancho * alto;
  const ii = new Float32Array(n);
  const ip = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    ii[k] = guia[k] * guia[k];
    ip[k] = guia[k] * entrada[k];
  }
  const mI = cajaPromedio(guia, ancho, alto, r);
  const mP = cajaPromedio(entrada, ancho, alto, r);
  const mII = cajaPromedio(ii, ancho, alto, r);
  const mIP = cajaPromedio(ip, ancho, alto, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const varI = mII[k] - mI[k] * mI[k];
    const cov = mIP[k] - mI[k] * mP[k];
    a[k] = cov / (varI + eps);
    b[k] = mP[k] - a[k] * mI[k];
  }
  const mA = cajaPromedio(a, ancho, alto, r);
  const mB = cajaPromedio(b, ancho, alto, r);
  const q = new Float32Array(n);
  for (let k = 0; k < n; k++) q[k] = mA[k] * guia[k] + mB[k];
  return q;
}

/** Tono de gris (0..1) de la foto, usado como guía para los bordes. */
export function guiaGris(rgba: Uint8ClampedArray | Uint8Array, ancho: number, alto: number): Float32Array {
  const g = new Float32Array(ancho * alto);
  for (let k = 0, i = 0; k < g.length; k++, i += 4) {
    g[k] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
  }
  return g;
}

export interface CanalesFoto {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

export function canalesFoto(rgba: Uint8ClampedArray | Uint8Array, ancho: number, alto: number): CanalesFoto {
  const n = ancho * alto;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let k = 0, i = 0; k < n; k++, i += 4) {
    r[k] = rgba[i] / 255;
    g[k] = rgba[i + 1] / 255;
    b[k] = rgba[i + 2] / 255;
  }
  return { r, g, b };
}

/** Corrige el borde de la máscara mirando el color: cada píxel cerca del borde
 * se compara con el color promedio de la pared a su alrededor y con el de lo
 * que queda afuera, y se queda del lado al que más se parece. */
export function ajustarPorColor(
  mascara: Float32Array,
  foto: CanalesFoto,
  ancho: number,
  alto: number,
  r: number,
): Float32Array {
  const n = ancho * alto;
  const fuera = new Float32Array(n);
  const rIn = new Float32Array(n);
  const gIn = new Float32Array(n);
  const bIn = new Float32Array(n);
  const rOut = new Float32Array(n);
  const gOut = new Float32Array(n);
  const bOut = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const m = mascara[k];
    const o = 1 - m;
    fuera[k] = o;
    rIn[k] = foto.r[k] * m;
    gIn[k] = foto.g[k] * m;
    bIn[k] = foto.b[k] * m;
    rOut[k] = foto.r[k] * o;
    gOut[k] = foto.g[k] * o;
    bOut[k] = foto.b[k] * o;
  }
  const cIn = cajaPromedio(mascara, ancho, alto, r);
  const mrIn = cajaPromedio(rIn, ancho, alto, r);
  const mgIn = cajaPromedio(gIn, ancho, alto, r);
  const mbIn = cajaPromedio(bIn, ancho, alto, r);
  const mrOut = cajaPromedio(rOut, ancho, alto, r);
  const mgOut = cajaPromedio(gOut, ancho, alto, r);
  const mbOut = cajaPromedio(bOut, ancho, alto, r);
  const salida = new Float32Array(mascara);
  for (let k = 0; k < n; k++) {
    const ci = cIn[k];
    if (ci < 0.04 || ci > 0.96) continue;
    const co = 1 - ci;
    const dr1 = foto.r[k] - mrIn[k] / ci;
    const dg1 = foto.g[k] - mgIn[k] / ci;
    const db1 = foto.b[k] - mbIn[k] / ci;
    const dr2 = foto.r[k] - mrOut[k] / co;
    const dg2 = foto.g[k] - mgOut[k] / co;
    const db2 = foto.b[k] - mbOut[k] / co;
    const dIn = dr1 * dr1 + dg1 * dg1 + db1 * db1;
    const dOut = dr2 * dr2 + dg2 * dg2 + db2 * db2;
    if (mascara[k] < 0.5) {
      if (dIn < 0.005 && dIn * 2 < dOut) salida[k] = 1;
    } else if (dIn > 0.012 && dOut * 2 < dIn) {
      salida[k] = 0;
    }
  }
  return salida;
}

export interface CromaFoto {
  cr: Float32Array;
  cg: Float32Array;
  luz: Float32Array;
  /** Logaritmo de la luz, apenas suavizado: para detectar saltos bruscos (bordes). */
  logLuz: Float32Array;
  oscuro: Uint8Array;
  textura: Float32Array;
}

/** Tono de cada píxel sin importar cuánta luz le llega (cromaticidad rg): una
 * pared en sombra y a pleno sol tienen casi el mismo tono. */
export function cromaFoto(rgba: Uint8ClampedArray | Uint8Array, ancho: number, alto: number): CromaFoto {
  const n = ancho * alto;
  const cr = new Float32Array(n);
  const cg = new Float32Array(n);
  const luz = new Float32Array(n);
  const oscuro = new Uint8Array(n);
  for (let k = 0, i = 0; k < n; k++, i += 4) {
    const r = LINEAL[rgba[i]];
    const g = LINEAL[rgba[i + 1]];
    const b = LINEAL[rgba[i + 2]];
    const s = r + g + b;
    luz[k] = s;
    if (s < 0.05) {
      oscuro[k] = 1;
      cr[k] = cg[k] = 1 / 3;
    } else {
      cr[k] = r / s;
      cg[k] = g / s;
    }
  }
  const log = new Float32Array(n);
  for (let k = 0; k < n; k++) log[k] = Math.log(Math.max(0.004, luz[k]));
  const logLuz = cajaPromedio(log, ancho, alto, 1);
  // Cuánto dibujo fino tiene cada parte: una cerámica con diseño, ladrillo o
  // piedra tiene muchos cambios suaves de luz juntos; una pared lisa casi
  // ninguno. Lo que toca algo casi negro (un cable) no cuenta.
  const marcas = new Float32Array(n);
  for (let yy = 0; yy < alto - 1; yy++) {
    for (let xx = 0; xx < ancho - 1; xx++) {
      const k = yy * ancho + xx;
      if (oscuro[k] || oscuro[k + 1] || oscuro[k + ancho]) continue;
      const s = Math.max(Math.abs(logLuz[k + 1] - logLuz[k]), Math.abs(logLuz[k + ancho] - logLuz[k]));
      if (s > 0.06 && s < 0.8) marcas[k] = 1;
    }
  }
  const textura = cajaPromedio(marcas, ancho, alto, Math.max(4, Math.round(Math.min(ancho, alto) / 40)));
  return { cr, cg, luz, logLuz, oscuro, textura };
}

function tonoDeReferencia(
  croma: CromaFoto,
  ancho: number,
  alto: number,
  x: number,
  y: number,
): { r: number; g: number; luz: number; dispersion: number } {
  const radio = Math.max(3, Math.round(Math.min(ancho, alto) / 150));
  const rs: number[] = [];
  const gs: number[] = [];
  const ls: number[] = [];
  for (let yy = Math.max(0, y - radio); yy <= Math.min(alto - 1, y + radio); yy++) {
    for (let xx = Math.max(0, x - radio); xx <= Math.min(ancho - 1, x + radio); xx++) {
      const k = yy * ancho + xx;
      if (croma.oscuro[k]) continue;
      rs.push(croma.cr[k]);
      gs.push(croma.cg[k]);
      ls.push(croma.luz[k]);
    }
  }
  if (!rs.length) return { r: 1 / 3, g: 1 / 3, luz: 0.1, dispersion: 1 };
  const r = mediana([...rs]);
  const g = mediana([...gs]);
  let d = 0;
  for (let i = 0; i < rs.length; i++) d += Math.hypot(rs[i] - r, gs[i] - g);
  return { r, g, luz: mediana(ls), dispersion: d / rs.length };
}

const LOG3 = Math.log(3);
const LUZ_MUY_DISTINTA = Math.log(2.5);

function mediana(v: number[]): number {
  return v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
}

/** Deja solo lo que tiene el mismo tono que donde se tocó y está unido a ese
 * punto: así no se pintan puertas, marcos de madera ni muebles pegados a la
 * pared aunque el detector los haya incluido. */
export function filtrarPorTono(
  mascara: Float32Array,
  croma: CromaFoto,
  ancho: number,
  alto: number,
  x: number,
  y: number,
): { mascara: Float32Array; parecido: number } {
  const n = ancho * alto;
  const ref = tonoDeReferencia(croma, ancho, alto, x, y);
  const limite = Math.max(0.08, Math.min(0.14, ref.dispersion * 4));
  const satRef = Math.hypot(ref.r - 1 / 3, ref.g - 1 / 3);
  const ok = new Uint8Array(n);
  let dentro = 0;
  let parecidos = 0;
  for (let k = 0; k < n; k++) {
    if (mascara[k] < 0.5) continue;
    dentro++;
    const relLuz = Math.log(Math.max(1e-4, croma.luz[k]) / ref.luz);
    const cambioDeLuz = Math.min(1, Math.abs(relLuz) / LOG3);
    const distTono = Math.hypot(croma.cr[k] - ref.r, croma.cg[k] - ref.g);
    // Mucho más claro y además más blanco no es la misma pared con más sol (el
    // sol la hace más clara pero igual de viva o más): es un recuadro o un
    // borde de otro color. Más oscuro y más cálido sí puede ser la misma pared
    // en sombra (bajo un alero rebota la luz del techo o del piso).
    const otraSuperficie =
      relLuz > LUZ_MUY_DISTINTA && distTono > 0.045 && Math.hypot(croma.cr[k] - 1 / 3, croma.cg[k] - 1 / 3) < satRef - 0.03;
    if (croma.oscuro[k] || (!otraSuperficie && distTono <= limite * (1 + 0.5 * cambioDeLuz))) {
      ok[k] = 1;
      parecidos++;
    }
  }
  const parecido = dentro ? parecidos / dentro : 0;
  if (parecido < 0.4) return { mascara, parecido };

  const inicio = Math.max(0, Math.min(alto - 1, y)) * ancho + Math.max(0, Math.min(ancho - 1, x));
  const salida = new Float32Array(n);
  const pila = new Int32Array(n);
  let tope = 0;
  let semilla = inicio;
  if (!ok[semilla]) {
    let mejor = -1;
    let dMejor = Infinity;
    const radio = 20;
    for (let yy = Math.max(0, y - radio); yy <= Math.min(alto - 1, y + radio); yy++) {
      for (let xx = Math.max(0, x - radio); xx <= Math.min(ancho - 1, x + radio); xx++) {
        const k = yy * ancho + xx;
        const d = (xx - x) ** 2 + (yy - y) ** 2;
        if (ok[k] && d < dMejor) {
          dMejor = d;
          mejor = k;
        }
      }
    }
    if (mejor < 0) return { mascara, parecido };
    semilla = mejor;
  }
  // Lo muy oscuro (cables, sombras duras) se puede cruzar solo en tramos
  // cortos: así una pared cortada por un cable sigue entera, pero la zona no
  // se mete por una reja o un vidrio oscuro.
  // Un salto brusco de luz es un borde (un recuadro de otro color, el zócalo
  // de cerámica, un marco): la zona no lo cruza. Las sombras suaves sí, porque
  // la luz cambia de a poco. Una línea fina (un cable o su sombra) se puede
  // cruzar en un tramo corto para seguir del otro lado, pero ese tramo no se
  // pinta salvo que sea muy oscuro. Lo que no es casi negro cuenta doble: así
  // no salta una franja de pared más oscura que separa dos recuadros.
  const maxCruce = Math.max(4, Math.round(Math.min(ancho, alto) / 120));
  const saltoMax = 0.15;
  // Tampoco se mete en algo con mucho más dibujo que donde se tocó (de una
  // columna lisa a la cerámica del zócalo, aunque tengan el mismo tono).
  const texturaRef = croma.textura[inicio];
  const texturaMax = Math.max(0.42, texturaRef * 1.5 + 0.15);
  const SIN = 0xffff;
  const racha = new Uint16Array(n).fill(SIN);
  const nivel = new Float32Array(n);
  pila[tope++] = semilla;
  racha[semilla] = 0;
  nivel[semilla] = croma.logLuz[semilla];
  while (tope) {
    const k = pila[--tope];
    const px = k % ancho;
    const rk = racha[k];
    const vecinos = [px > 0 ? k - 1 : -1, px < ancho - 1 ? k + 1 : -1, k >= ancho ? k - ancho : -1, k + ancho < n ? k + ancho : -1];
    for (const v of vecinos) {
      if (v < 0 || !ok[v] || croma.textura[v] > texturaMax) continue;
      let nueva: number;
      let nv: number;
      if (croma.oscuro[v]) {
        nueva = rk + 1;
        nv = nivel[k];
      } else if (Math.abs(croma.logLuz[v] - nivel[k]) <= saltoMax) {
        nueva = 0;
        nv = croma.logLuz[v];
      } else {
        nueva = rk + 2;
        nv = nivel[k];
      }
      if (nueva > maxCruce || nueva >= racha[v]) continue;
      racha[v] = nueva;
      nivel[v] = nv;
      pila[tope++] = v;
    }
  }
  for (let k = 0; k < n; k++) {
    if (racha[k] === SIN) continue;
    if (racha[k] === 0 || croma.oscuro[k]) salida[k] = 1;
  }
  return { mascara: salida, parecido };
}

/** De las tres formas que propone el detector, se queda con la más grande que
 * sea de un solo tono (una pared), y si ninguna lo es, con la de mejor puntaje. */
export function ordenarOpciones(
  opciones: Float32Array[],
  puntajes: number[],
  croma: CromaFoto,
  ancho: number,
  alto: number,
  x: number,
  y: number,
): number[] {
  const info = opciones.map((m, i) => {
    let area = 0;
    for (let k = 0; k < m.length; k++) if (m[k] >= 0.5) area++;
    const { parecido } = filtrarPorTono(m, croma, ancho, alto, x, y);
    return { i, area, parecido, puntaje: puntajes[i] };
  });
  const validas = info.filter((o) => o.area > 0);
  const lisas = validas.filter((o) => o.parecido >= 0.75 && o.puntaje >= 0.6);
  const mayor = Math.max(0, ...lisas.map((o) => o.area));
  lisas.sort((a, b) => {
    const chicaA = a.area < mayor * 0.2 ? 1 : 0;
    const chicaB = b.area < mayor * 0.2 ? 1 : 0;
    return chicaA - chicaB || b.puntaje - a.puntaje;
  });
  const resto = validas.filter((o) => !lisas.includes(o)).sort((a, b) => b.puntaje - a.puntaje);
  return [...lisas, ...resto].map((o) => o.i);
}

export function binarizar(logits: ArrayLike<number>, umbral = 0): Float32Array {
  const m = new Float32Array(logits.length);
  for (let k = 0; k < m.length; k++) m[k] = logits[k] > umbral ? 1 : 0;
  return m;
}

/** Zona final para un toque: el detector da la forma y el tono la recorta. */
export function zonaDesdeLogits(
  logits: ArrayLike<number>,
  croma: CromaFoto,
  ancho: number,
  alto: number,
  x: number,
  y: number,
): Float32Array {
  return filtrarPorTono(binarizar(logits, 0), croma, ancho, alto, x, y).mascara;
}

/** De una máscara 0/1 a una 0..255 con bordes pegados a la foto. */
export function refinarMascara(
  binaria: Float32Array,
  guia: Float32Array,
  ancho: number,
  alto: number,
  foto?: CanalesFoto,
): Uint8Array {
  const n = ancho * alto;
  let p = binaria;
  if (foto) {
    const base = Math.max(4, Math.round(Math.min(ancho, alto) / 60));
    p = ajustarPorColor(p, foto, ancho, alto, base);
    p = ajustarPorColor(p, foto, ancho, alto, Math.max(3, Math.round(base / 2)));
    p = soloUnidoA(p, binaria, ancho, alto);
  }
  const r = Math.max(2, Math.round(Math.min(ancho, alto) / 180));
  const q = filtroGuiado(guia, p, ancho, alto, r, 0.0004);
  // El suavizado solo actúa en una franja angosta pegada al borde: afuera no
  // queda pintura a medias (manchas) y adentro la pared queda pareja.
  const banda = Math.max(2, Math.round(Math.min(ancho, alto) / 320));
  const cerca = cajaPromedio(p, ancho, alto, banda);
  const alfa = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (cerca[k] <= 0.001) continue;
    if (cerca[k] >= 0.999) {
      alfa[k] = 255;
      continue;
    }
    const t = (q[k] - 0.4) / 0.2;
    alfa[k] = t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * t * (3 - 2 * t) * 255);
  }
  return alfa;
}

/** Lo que el ajuste por color agregó suelto, lejos de la zona tocada (manchas
 * en la pared de al lado que tiene un tono parecido), se descarta. */
function soloUnidoA(p: Float32Array, semilla: Float32Array, ancho: number, alto: number): Float32Array {
  const n = ancho * alto;
  const salida = new Float32Array(n);
  const pila = new Int32Array(n);
  let tope = 0;
  for (let k = 0; k < n; k++) {
    if (semilla[k] >= 0.5 && p[k] >= 0.5) {
      salida[k] = 1;
      pila[tope++] = k;
    }
  }
  while (tope) {
    const k = pila[--tope];
    const px = k % ancho;
    const vecinos = [px > 0 ? k - 1 : -1, px < ancho - 1 ? k + 1 : -1, k >= ancho ? k - ancho : -1, k + ancho < n ? k + ancho : -1];
    for (const v of vecinos) {
      if (v < 0 || salida[v] || p[v] < 0.5) continue;
      salida[v] = 1;
      pila[tope++] = v;
    }
  }
  return salida;
}

/** Une varias zonas (máximo) y les resta las que se borraron. */
export function combinarZonas(sumar: Uint8Array[], restar: Uint8Array[], n: number): Uint8Array {
  const alfa = new Uint8Array(n);
  for (const z of sumar) for (let k = 0; k < n; k++) if (z[k] > alfa[k]) alfa[k] = z[k];
  for (const z of restar) for (let k = 0; k < n; k++) if (z[k]) alfa[k] = Math.round((alfa[k] * (255 - z[k])) / 255);
  return alfa;
}

/** Luz "normal" de la pared: un percentil alto de su luminancia, para que las
 * zonas a plena luz queden en el color del abanico y lo demás en su sombra. */
export function luzDeReferencia(rgba: Uint8ClampedArray | Uint8Array, alfa: Uint8Array): number {
  const hist = new Uint32Array(1024);
  let total = 0;
  for (let k = 0; k < alfa.length; k++) {
    if (alfa[k] < 128) continue;
    const y = luminanciaLineal(rgba, k * 4);
    hist[Math.min(1023, Math.floor(y * 1023))]++;
    total++;
  }
  if (!total) return 0.5;
  const meta = total * 0.8;
  let acum = 0;
  for (let i = 0; i < 1024; i++) {
    acum += hist[i];
    if (acum >= meta) return Math.max(0.02, (i + 0.5) / 1023);
  }
  return 0.5;
}

export interface Pareja {
  /** Luminancia lineal de toda la foto, emparejada dentro de la capa. */
  luz: Float32Array;
  /** Huequitos sin pintar dentro de la capa que también se cubren. */
  relleno: Uint8Array;
}

/** "Disimular desperfectos": dentro de una capa, lo pelado, las manchas, las
 * grietas y el repello disparejo toman la luz de la pared sana de alrededor,
 * como si se hubiera resanado antes de pintar. Las sombras grandes (de un
 * alero, de una esquina) se mantienen porque conservan el tono de la pared;
 * lo pelado deja ver otro material, de otro tono. */
export function luzPareja(
  rgba: Uint8ClampedArray | Uint8Array,
  alfa: Uint8Array,
  ancho: number,
  alto: number,
  otras?: Uint8Array,
): Pareja {
  const n = ancho * alto;
  const luz = new Float32Array(n);
  for (let k = 0; k < n; k++) luz[k] = luminanciaLineal(rgba, k * 4);
  const relleno = new Uint8Array(n);

  let x0 = ancho, y0 = alto, x1 = -1, y1 = -1;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (alfa[y * ancho + x] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { luz, relleno };
  const lado = Math.min(ancho, alto);
  const margen = Math.round(lado / 40);
  x0 = Math.max(0, x0 - margen);
  y0 = Math.max(0, y0 - margen);
  x1 = Math.min(ancho - 1, x1 + margen);
  y1 = Math.min(alto - 1, y1 + margen);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const m = w * h;
  const global = (i: number) => (y0 + Math.floor(i / w)) * ancho + x0 + (i % w);

  const L = new Float32Array(m);
  const cr = new Float32Array(m);
  const cg = new Float32Array(m);
  const S = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    const k = global(i);
    const j = k * 4;
    const r = LINEAL[rgba[j]];
    const g = LINEAL[rgba[j + 1]];
    const b = LINEAL[rgba[j + 2]];
    const s = r + g + b;
    L[i] = Math.log(Math.max(1e-4, luz[k]));
    cr[i] = s > 0.05 ? r / s : 1 / 3;
    cg[i] = s > 0.05 ? g / s : 1 / 3;
    S[i] = alfa[k] >= 128 ? 1 : 0;
  }

  // Huequitos encerrados por la capa (descascarados chicos, clavos, manchas)
  // también se cubren; los grandes (un recuadro), los muy oscuros (una
  // ventana) y los que ya tienen otro color no.
  const afuera = new Uint8Array(m);
  const pila = new Int32Array(m);
  let tope = 0;
  for (let i = 0; i < m; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    if (!S[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) {
      afuera[i] = 1;
      pila[tope++] = i;
    }
  }
  while (tope) {
    const i = pila[--tope];
    const x = i % w;
    for (const v of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i + w < m ? i + w : -1]) {
      if (v < 0 || S[v] || afuera[v]) continue;
      afuera[v] = 1;
      pila[tope++] = v;
    }
  }
  const maxHueco = Math.round((lado / 40) ** 2);
  const maxHuecoOscuro = Math.round((lado / 55) ** 2);
  const visto = new Uint8Array(m);
  const comp: number[] = [];
  for (let i = 0; i < m; i++) {
    if (S[i] || afuera[i] || visto[i]) continue;
    comp.length = 0;
    visto[i] = 1;
    pila[0] = i;
    tope = 1;
    let oscuros = 0;
    let conOtroColor = false;
    while (tope) {
      const p = pila[--tope];
      comp.push(p);
      if (luz[global(p)] < 0.03) oscuros++;
      if (otras && otras[global(p)] >= 64) conOtroColor = true;
      const x = p % w;
      for (const v of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p + w < m ? p + w : -1]) {
        if (v < 0 || S[v] || afuera[v] || visto[v]) continue;
        visto[v] = 1;
        pila[tope++] = v;
      }
    }
    const chiquito = comp.length <= maxHuecoOscuro;
    if (!conOtroColor && comp.length <= maxHueco && (chiquito || oscuros < comp.length * 0.1)) {
      for (const p of comp) {
        S[p] = 2;
        relleno[global(p)] = 255;
      }
    }
  }

  // Tono y luz de la pared sana.
  const rs: number[] = [];
  const gs: number[] = [];
  const ls: number[] = [];
  for (let i = 0; i < m; i += 3) {
    if (S[i] !== 1) continue;
    rs.push(cr[i]);
    gs.push(cg[i]);
    ls.push(L[i]);
  }
  if (!rs.length) return { luz, relleno };
  const tr = mediana(rs);
  const tg = mediana(gs);
  ls.sort((a, b) => a - b);
  const luzAlta = ls[Math.floor(ls.length * 0.8)];

  // Lo muy oscuro y grande (una reja, el hueco de una ventana, la sombra bajo
  // el techo, un cable que cruza) no es un desperfecto ni sirve de muestra:
  // queda como está. Lo muy oscuro pero chico (donde se cayó el repello y se
  // ve el block) sí es un desperfecto.
  const oscuroAca = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    if (S[i] !== 1) continue;
    const j = global(i) * 4;
    if (L[i] < luzAlta - 1.4 || LINEAL[rgba[j]] + LINEAL[rgba[j + 1]] + LINEAL[rgba[j + 2]] <= 0.05) oscuroAca[i] = 1;
  }
  const fijo = new Uint8Array(m);
  const malo = new Uint8Array(m);
  const maxManchaOscura = Math.round((lado / 30) ** 2);
  // Muchos huequitos oscuros juntos son una reja o una ventana, no repello caído.
  const densidadOscura = cajaPromedio(Float32Array.from(oscuroAca), w, h, Math.max(3, Math.round(lado / 50)));
  const maxLadoMancha = lado / 12;
  const vistoOsc = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    if (!oscuroAca[i] || vistoOsc[i]) continue;
    comp.length = 0;
    vistoOsc[i] = 1;
    pila[0] = i;
    tope = 1;
    let cx0 = w, cy0 = h, cx1 = 0, cy1 = 0;
    while (tope) {
      const p = pila[--tope];
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < cx0) cx0 = x;
      if (x > cx1) cx1 = x;
      if (y < cy0) cy0 = y;
      if (y > cy1) cy1 = y;
      for (const v of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p + w < m ? p + w : -1]) {
        if (v < 0 || !oscuroAca[v] || vistoOsc[v]) continue;
        vistoOsc[v] = 1;
        pila[tope++] = v;
      }
    }
    let densidad = 0;
    for (const p of comp) densidad += densidadOscura[p];
    densidad /= comp.length;
    const chica = comp.length <= maxManchaOscura && Math.max(cx1 - cx0, cy1 - cy0) <= maxLadoMancha && densidad < 0.3;
    for (const p of comp) {
      if (chica) malo[p] = 1;
      else fijo[p] = 1;
    }
  }

  const amp = 0.12;
  const pico = (a: number, b: number, c: number) =>
    a > luzAlta - 1.4 && c > luzAlta - 1.4 && ((b - a > amp && b - c > amp) || (a - b > amp && c - b > amp));
  let cuantosMalos = 0;
  let cuantosS = 0;
  for (let i = 0; i < m; i++) {
    if (!S[i] || fijo[i]) continue;
    cuantosS++;
    if (malo[i] || S[i] === 2) {
      malo[i] = 1;
      cuantosMalos++;
      continue;
    }
    const distTono = Math.hypot(cr[i] - tr, cg[i] - tg);
    if ((L[i] > luzAlta - 0.7 && distTono > 0.04) || distTono > 0.08) {
      malo[i] = 1;
      cuantosMalos++;
      continue;
    }
    const x = i % w;
    const y = Math.floor(i / w);
    for (const d of [2, 5, 10]) {
      if (x >= d && x < w - d && pico(L[i - d], L[i], L[i + d])) malo[i] = 1;
      else if (y >= d && y < h - d && pico(L[i - d * w], L[i], L[i + d * w])) malo[i] = 1;
      if (malo[i]) {
        cuantosMalos++;
        break;
      }
    }
  }
  // Si casi todo "parece desperfecto" no es una pared con daños sino una
  // superficie con dibujo (cerámica, piedra): no se toca.
  if (!cuantosS || cuantosMalos > cuantosS * 0.45) return { luz, relleno };

  const malo2 = cajaPromedio(Float32Array.from(malo), w, h, 1);
  const sano = new Float32Array(m);
  const Ls = new Float32Array(m);
  const pendiente = new Uint8Array(m);
  let quedan = 0;
  for (let i = 0; i < m; i++) {
    if (!S[i] || fijo[i]) continue;
    if (malo2[i] > 0) {
      pendiente[i] = 1;
      quedan++;
    } else {
      sano[i] = 1;
      Ls[i] = L[i];
    }
  }

  // Cada desperfecto toma la luz de la pared sana más cercana. Lo que queda
  // lejos de pared sana (un pedazo grande que falta) se deja como está: ahí
  // no hay de dónde sacar cómo sería la pared.
  const salida = Float32Array.from(L);
  const llenado = new Uint8Array(m);
  for (let r = Math.max(2, Math.round(lado / 200)); quedan && r <= lado / 12; r *= 2) {
    const num = cajaPromedio(Ls, w, h, r);
    const den = cajaPromedio(sano, w, h, r);
    for (let i = 0; i < m; i++) {
      if (!pendiente[i] || den[i] < 0.06) continue;
      salida[i] = num[i] / den[i];
      pendiente[i] = 0;
      llenado[i] = 1;
      quedan--;
    }
  }

  const util = new Float32Array(m);
  for (let i = 0; i < m; i++) util[i] = sano[i] || llenado[i] ? 1 : 0;

  // Lo rellenado se suaviza con lo de alrededor para que no queden escalones
  // entre partes que se llenaron desde más cerca o más lejos.
  const rs2 = Math.max(2, Math.round(lado / 120));
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const val = new Float32Array(m);
    for (let i = 0; i < m; i++) if (util[i]) val[i] = salida[i];
    const nv = cajaPromedio(val, w, h, rs2);
    const dv = cajaPromedio(util, w, h, rs2);
    for (let i = 0; i < m; i++) if (llenado[i] && dv[i] > 0.05) salida[i] = nv[i] / dv[i];
  }

  const fino = cajaPromedio(L, w, h, 2);
  const grano = new Float32Array(m);
  for (let i = 0; i < m; i++) if (llenado[i]) grano[i] = Math.max(-0.035, Math.min(0.035, L[i] - fino[i]));

  // Repello disparejo: las variaciones chicas de luz se achican; las grandes
  // (bordes de sombra) quedan como están.
  const valS = new Float32Array(m);
  for (let i = 0; i < m; i++) if (util[i]) valS[i] = salida[i];
  const rb = Math.max(3, Math.round(lado / 80));
  const num = cajaPromedio(valS, w, h, rb);
  const den = cajaPromedio(util, w, h, rb);
  for (let i = 0; i < m; i++) {
    if (!util[i] || den[i] < 0.3) continue;
    const base = num[i] / den[i];
    const dev = salida[i] - base;
    const t = Math.min(1, Math.max(0, (Math.abs(dev) - 0.08) / 0.14));
    // El granito fino del repello se conserva siempre (también donde se
    // rellenó): sin él la pared queda lisa como una chapa.
    const v = base + dev * (0.55 + 0.45 * t * t * (3 - 2 * t)) + grano[i];
    luz[global(i)] = Math.exp(v);
  }
  return { luz, relleno };
}

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Pinta las capas sobre la foto original. Cada píxel toma el color del
 * abanico multiplicado por cuánta luz le llegaba en la foto. Con `region`
 * solo se repinta ese rectángulo (para el pincel, que va trazo a trazo). */
export function pintarCapas(
  original: Uint8ClampedArray | Uint8Array,
  capas: CapaPintura[],
  destino: Uint8ClampedArray,
  ancho = 0,
  region?: Region,
): void {
  const prep = capas.map((capa) => {
    const ref = capa.ref ?? luzDeReferencia(original, capa.alfa);
    return { a: capa.alfa, ref, pareja: capa.pareja, tr: aLineal(capa.color.r), tg: aLineal(capa.color.g), tb: aLineal(capa.color.b) };
  });
  const pixel = (k: number): void => {
    const i = k * 4;
    for (const c of prep) {
      const al = c.pareja && c.pareja.relleno[k] > c.a[k] ? c.pareja.relleno[k] : c.a[k];
      if (!al) continue;
      let s = (c.pareja ? c.pareja.luz[k] : luminanciaLineal(original, i)) / c.ref;
      if (s > 1) s = 1 + (s - 1) * 0.6;
      if (s > 1.5) s = 1.5;
      let r = c.tr * s;
      let g = c.tg * s;
      let b = c.tb * s;
      const exceso = Math.max(r, g, b);
      if (exceso > 1) {
        const m = Math.min(1, (exceso - 1) * 1.5);
        r = r / exceso + (1 - r / exceso) * m * 0.5;
        g = g / exceso + (1 - g / exceso) * m * 0.5;
        b = b / exceso + (1 - b / exceso) * m * 0.5;
      }
      const f = al / 255;
      destino[i] = destino[i] * (1 - f) + aSrgb(r) * f;
      destino[i + 1] = destino[i + 1] * (1 - f) + aSrgb(g) * f;
      destino[i + 2] = destino[i + 2] * (1 - f) + aSrgb(b) * f;
    }
  };
  if (!region || !ancho) {
    destino.set(original);
    const n = original.length / 4;
    for (let k = 0; k < n; k++) pixel(k);
    return;
  }
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const k = y * ancho + x;
      const i = k * 4;
      destino[i] = original[i];
      destino[i + 1] = original[i + 1];
      destino[i + 2] = original[i + 2];
      destino[i + 3] = original[i + 3];
      pixel(k);
    }
  }
}

export interface Tono {
  r: number;
  g: number;
  luz: number;
  oscuro: boolean;
}

/** Tono de la superficie en un punto (mediana de un cuadrito alrededor). */
export function tonoEn(croma: CromaFoto, ancho: number, alto: number, x: number, y: number): Tono {
  const px = Math.max(0, Math.min(ancho - 1, Math.round(x)));
  const py = Math.max(0, Math.min(alto - 1, Math.round(y)));
  if (croma.oscuro[py * ancho + px]) return { r: 1 / 3, g: 1 / 3, luz: croma.luz[py * ancho + px], oscuro: true };
  const t = tonoDeReferencia(croma, ancho, alto, px, py);
  return { r: t.r, g: t.g, luz: t.luz, oscuro: false };
}

/** Un toque del pincel fino: marca los píxeles del círculo. Si se le da un
 * tono, solo marca los que son de esa misma superficie (no se sale a la
 * pared de al lado aunque el pincel la toque). Devuelve el rectángulo tocado. */
export function pincelar(
  croma: CromaFoto,
  ancho: number,
  alto: number,
  cx: number,
  cy: number,
  radio: number,
  tono: Tono | null,
  marcar: (k: number, fuerza: number) => void,
): Region | null {
  const x0 = Math.max(0, Math.floor(cx - radio - 1));
  const y0 = Math.max(0, Math.floor(cy - radio - 1));
  const x1 = Math.min(ancho - 1, Math.ceil(cx + radio + 1));
  const y1 = Math.min(alto - 1, Math.ceil(cy + radio + 1));
  if (x0 > x1 || y0 > y1) return null;
  const limite = 0.1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const fuerza = Math.max(0, Math.min(1, radio - d + 0.5));
      if (fuerza <= 0) continue;
      const k = y * ancho + x;
      if (tono) {
        if (croma.oscuro[k] !== (tono.oscuro ? 1 : 0)) continue;
        if (!tono.oscuro) {
          const proporcion = croma.luz[k] / Math.max(1e-4, tono.luz);
          if (proporcion < 0.25 || proporcion > 3) continue;
          const cambio = Math.min(1, Math.abs(Math.log(Math.max(1e-4, proporcion))) / LOG3);
          if (Math.hypot(croma.cr[k] - tono.r, croma.cg[k] - tono.g) > limite * (1 + cambio)) continue;
        }
      }
      marcar(k, fuerza);
    }
  }
  return { x0, y0, x1, y1 };
}
