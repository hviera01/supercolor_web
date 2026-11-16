export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function hexARgbFoto(hex: string): Rgb {
  const limpio = hex.replace("#", "");
  const n = parseInt(limpio.length === 3 ? limpio.replace(/(.)/g, "$1$1") : limpio, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbAHex(c: Rgb): string {
  const parte = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${parte(c.r)}${parte(c.g)}${parte(c.b)}`.toUpperCase();
}

function linealizar(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbALab(c: Rgb): Lab {
  const r = linealizar(c.r);
  const g = linealizar(c.g);
  const b = linealizar(c.b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function aGrados(rad: number): number {
  return (rad * 180) / Math.PI;
}

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

/** Diferencia de color CIEDE2000: cerca de 0 = igual a la vista, ~2 apenas se nota, ~5 se nota, 10+ ya es otro color. */
export function deltaE2000(c1: Lab, c2: Lab): number {
  const kL = 1;
  const kC = 1;
  const kH = 1;
  const C1 = Math.hypot(c1.a, c1.b);
  const C2 = Math.hypot(c2.a, c2.b);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * c1.a;
  const a2p = (1 + G) * c2.a;
  const C1p = Math.hypot(a1p, c1.b);
  const C2p = Math.hypot(a2p, c2.b);
  const h1p = C1p === 0 ? 0 : (aGrados(Math.atan2(c1.b, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (aGrados(Math.atan2(c2.b, a2p)) + 360) % 360;
  const dLp = c2.l - c1.l;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(aRadianes(dhp / 2));
  const Lpm = (c1.l + c2.l) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm /= 2;
    else hpm = (hpm + (h1p + h2p < 360 ? 360 : -360)) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(aRadianes(hpm - 30)) +
    0.24 * Math.cos(aRadianes(2 * hpm)) +
    0.32 * Math.cos(aRadianes(3 * hpm + 6)) -
    0.2 * Math.cos(aRadianes(4 * hpm - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hpm - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cpm, 7) / (Math.pow(Cpm, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lpm - 50, 2)) / Math.sqrt(20 + Math.pow(Lpm - 50, 2));
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(aRadianes(2 * dTheta)) * Rc;
  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) +
      Math.pow(dCp / (kC * Sc), 2) +
      Math.pow(dHp / (kH * Sh), 2) +
      Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  );
}

export interface ColorDelAbanico {
  codigo: string;
  nombre: string;
  hex: string;
}

export interface Parecido<T extends ColorDelAbanico> {
  color: T;
  de: number;
}

export interface IndiceAbanico<T extends ColorDelAbanico> {
  colores: T[];
  labs: Lab[];
}

export function indexarAbanico<T extends ColorDelAbanico>(colores: T[]): IndiceAbanico<T> {
  return { colores, labs: colores.map((c) => rgbALab(hexARgbFoto(c.hex))) };
}

/** Corrige la luz de la foto: suma (o resta) luminosidad Lab antes de comparar. */
export function ajustarLuz(lab: Lab, delta: number): Lab {
  return { l: Math.max(0, Math.min(100, lab.l + delta)), a: lab.a, b: lab.b };
}

/** Los [n] colores del abanico más cercanos a [objetivo], sin repetir "familias" casi idénticas. */
export function parecidosEnAbanico<T extends ColorDelAbanico>(indice: IndiceAbanico<T>, objetivo: Lab, n = 8): Parecido<T>[] {
  const todos = indice.colores.map((color, i) => ({ color, de: deltaE2000(objetivo, indice.labs[i]) }));
  todos.sort((x, y) => x.de - y.de);
  return todos.slice(0, n);
}

export function etiquetaSimilitud(de: number): string {
  if (de <= 3) return "Casi igual";
  if (de <= 6) return "Muy parecido";
  if (de <= 12) return "Parecido";
  return "Aproximado";
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const m = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[m] : (orden[m - 1] + orden[m]) / 2;
}

/** Color típico de una zona cuadrada de la foto (mediana por canal, para ignorar brillos y sombras sueltas). */
export function colorDeZona(datos: Uint8ClampedArray, ancho: number, alto: number, cx: number, cy: number, radio: number): Rgb {
  const x0 = Math.max(0, Math.floor(cx - radio));
  const x1 = Math.min(ancho - 1, Math.floor(cx + radio));
  const y0 = Math.max(0, Math.floor(cy - radio));
  const y1 = Math.min(alto - 1, Math.floor(cy + radio));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * ancho + x) * 4;
      if (datos[i + 3] < 128) continue;
      rs.push(datos[i]);
      gs.push(datos[i + 1]);
      bs.push(datos[i + 2]);
    }
  }
  if (rs.length === 0) return { r: 128, g: 128, b: 128 };
  return { r: mediana(rs), g: mediana(gs), b: mediana(bs) };
}

export interface ColorDominante {
  rgb: Rgb;
  proporcion: number;
}

/** Agrupa los colores de la foto (k-means en espacio Lab) y devuelve los más presentes, de mayor a menor. */
export function coloresDominantes(datos: Uint8ClampedArray, ancho: number, alto: number, k = 5, muestras = 4000): ColorDominante[] {
  const total = ancho * alto;
  const paso = Math.max(1, Math.floor(total / muestras));
  const puntos: { rgb: Rgb; lab: Lab }[] = [];
  for (let p = 0; p < total; p += paso) {
    const i = p * 4;
    if (datos[i + 3] < 128) continue;
    const rgb = { r: datos[i], g: datos[i + 1], b: datos[i + 2] };
    puntos.push({ rgb, lab: rgbALab(rgb) });
  }
  if (puntos.length === 0) return [];
  const dist = (a: Lab, b: Lab) => (a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
  const centros: Lab[] = [puntos[0].lab];
  while (centros.length < Math.min(k, puntos.length)) {
    let mejor = puntos[0].lab;
    let lejos = -1;
    for (const p of puntos) {
      const d = Math.min(...centros.map((c) => dist(c, p.lab)));
      if (d > lejos) {
        lejos = d;
        mejor = p.lab;
      }
    }
    centros.push(mejor);
  }
  let asignacion = new Array<number>(puntos.length).fill(0);
  for (let it = 0; it < 10; it++) {
    asignacion = puntos.map((p) => {
      let idx = 0;
      let mejor = Infinity;
      centros.forEach((c, j) => {
        const d = dist(c, p.lab);
        if (d < mejor) {
          mejor = d;
          idx = j;
        }
      });
      return idx;
    });
    centros.forEach((_, j) => {
      const miembros = puntos.filter((_, i) => asignacion[i] === j);
      if (miembros.length === 0) return;
      centros[j] = {
        l: miembros.reduce((s, m) => s + m.lab.l, 0) / miembros.length,
        a: miembros.reduce((s, m) => s + m.lab.a, 0) / miembros.length,
        b: miembros.reduce((s, m) => s + m.lab.b, 0) / miembros.length,
      };
    });
  }
  const resultado: ColorDominante[] = centros.map((_, j) => {
    const miembros = puntos.filter((_, i) => asignacion[i] === j);
    return {
      rgb: {
        r: mediana(miembros.map((m) => m.rgb.r)),
        g: mediana(miembros.map((m) => m.rgb.g)),
        b: mediana(miembros.map((m) => m.rgb.b)),
      },
      proporcion: miembros.length / puntos.length,
    };
  });
  const util = resultado.filter((c) => c.proporcion > 0.02 && !Number.isNaN(c.rgb.r));
  util.sort((a, b) => b.proporcion - a.proporcion);
  const unicos: ColorDominante[] = [];
  for (const c of util) {
    const lab = rgbALab(c.rgb);
    if (unicos.every((u) => deltaE2000(lab, rgbALab(u.rgb)) > 8)) unicos.push(c);
  }
  return unicos;
}
