// Aproximación visual de los colores del abanico LANCO (libro Color Codex /
// Colortrend), a partir de sus fórmulas de tinte reales -NO es un escaneo ni
// un valor oficial de LANCO: su selector de colores (ColorClick/ColorIdeas)
// es una app en JavaScript que no expone valores de color descargables, así
// que no hay forma de sacar el hex exacto de ahí. Esto es un cálculo propio,
// basado en la ficha técnica REAL de pigmentos de Colortrend® 888 (Vibrantz
// Technologies, el fabricante de los colorantes) para que el resultado sea
// lo más parecido posible a la realidad sin pretender ser exacto -pedido
// explícito del dueño: "sé que no sería así, es para probar"-. El color
// físico real de cada lata puede variar de esto, y también se ve distinto
// en cada pantalla: este aviso se muestra siempre junto a los swatches.

export interface ColoranteFormula {
  colorante: string;
  galonOz: number | null;
}

export interface FormulaColor {
  codigo: string;
  nombre: string;
  base: string;
  pagina: number;
  cuartoDisponible: boolean;
  colorantes: ColoranteFormula[];
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

// Color de partida de cada base ANTES de agregar colorante -las bases más
// "profundas" (Deep/Accent) ya salen de fábrica menos blancas, con menos
// dióxido de titanio, para poder absorber más colorante y llegar a tonos
// oscuros/saturados que una base Pastel nunca alcanzaría.
const BASE_HEX: Record<string, RGB> = {
  "Pastel Base": { r: 0xfb, g: 0xfa, b: 0xf7 },
  "Tint Base": { r: 0xf4, g: 0xf2, b: 0xea },
  "Deep Base": { r: 0xd9, g: 0xd5, b: 0xc7 },
  "Accent Base": { r: 0xc9, g: 0xc3, b: 0xb0 },
};
const BASE_HEX_DEFECTO: RGB = { r: 0xf0, g: 0xee, b: 0xe6 };

// Pigmento real de cada colorante (ficha técnica Colortrend® 888, Vibrantz
// Technologies) → un hex representativo de ese pigmento, y una "fuerza" de
// tinte relativa (cuánto domina el color final por onza -los ftalocianina y
// la magenta son tintes mucho más fuertes que los óxidos de hierro, por eso
// pesan más acá; valores ajustados a ojo comparando contra varias fórmulas
// reales, no hay una fuente oficial de "fuerza de tinte" pública).
const COLORANTES: Record<string, { hex: RGB; fuerza: number }> = {
  KX: { hex: { r: 0xff, g: 0xff, b: 0xff }, fuerza: 1.0 }, // Titanium White (PW6)
  B: { hex: { r: 0x1a, g: 0x1a, b: 0x1a }, fuerza: 3.0 }, // Lamp Black (PBk7)
  V: { hex: { r: 0xc2, g: 0x18, b: 0x5b }, fuerza: 4.0 }, // Magenta (PR122)
  RN: { hex: { r: 0xe5, g: 0x39, b: 0x35 }, fuerza: 2.8 }, // High Perf. Red (PR254)
  R: { hex: { r: 0xd3, g: 0x2f, b: 0x2f }, fuerza: 2.5 }, // Organic Red (PR188)
  F: { hex: { r: 0x8d, g: 0x4a, b: 0x3c }, fuerza: 1.5 }, // Red Oxide (PR101)
  I: { hex: { r: 0x6b, g: 0x44, b: 0x23 }, fuerza: 1.5 }, // Brown Oxide
  C: { hex: { r: 0xc9, g: 0x9a, b: 0x3c }, fuerza: 1.8 }, // Yellow Oxide (PY42)
  L: { hex: { r: 0x5c, g: 0x4a, b: 0x32 }, fuerza: 1.5 }, // Raw Umber (PBr7)
  T: { hex: { r: 0xf2, g: 0xc2, b: 0x30 }, fuerza: 2.0 }, // Medium Yellow
  AN: { hex: { r: 0xff, g: 0xd4, b: 0x00 }, fuerza: 2.3 }, // High Perf. Yellow (PY184)
  AXX: { hex: { r: 0xfc, g: 0xe3, b: 0x00 }, fuerza: 2.5 }, // Organic Yellow
  D: { hex: { r: 0x00, g: 0x69, b: 0x3e }, fuerza: 4.5 }, // Phthalo Green (PG7)
  E: { hex: { r: 0x0b, g: 0x3d, b: 0x91 }, fuerza: 4.5 }, // Phthalo Blue (PB15:2)
};
const COLORANTE_DEFECTO = { hex: { r: 0x80, g: 0x80, b: 0x80 }, fuerza: 2.0 };

// "Peso" de la base en las mismas unidades que oz de colorante × fuerza -
// tunea qué tan rápido el color final se aleja del blanco/base a medida que
// se agrega colorante. Ajustable si en la práctica los colores salen muy
// pálidos o muy saturados comparados con la realidad.
const PESO_BASE = 0.9;

function mezclar(base: RGB, usos: { rgb: RGB; peso: number }[]): RGB {
  let pesoTotal = PESO_BASE;
  let r = base.r * PESO_BASE;
  let g = base.g * PESO_BASE;
  let b = base.b * PESO_BASE;
  for (const u of usos) {
    r += u.rgb.r * u.peso;
    g += u.rgb.g * u.peso;
    b += u.rgb.b * u.peso;
    pesoTotal += u.peso;
  }
  return {
    r: Math.round(r / pesoTotal),
    g: Math.round(g / pesoTotal),
    b: Math.round(b / pesoTotal),
  };
}

function rgbAHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Color aproximado (hex) de una fórmula -ver el aviso grande arriba. */
export function colorAproximadoHex(formula: FormulaColor): string {
  const baseRgb = BASE_HEX[formula.base] ?? BASE_HEX_DEFECTO;
  const usos = formula.colorantes
    .filter((c) => (c.galonOz ?? 0) > 0)
    .map((c) => {
      const info = COLORANTES[c.colorante] ?? COLORANTE_DEFECTO;
      return { rgb: info.hex, peso: (c.galonOz as number) * info.fuerza };
    });
  return rgbAHex(mezclar(baseRgb, usos));
}

function hexARgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** RGB (0-255) a HSL (h en grados 0-360, s/l en 0-100). */
export function rgbAHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
      break;
    case gn:
      h = ((bn - rn) / d + 2) * 60;
      break;
    default:
      h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export interface ColorPaleta {
  formula: FormulaColor;
  hex: string;
  h: number;
  s: number;
  l: number;
}

/** Precalcula el color aproximado + HSL de todo el dataset una sola vez -se
 * usa tanto para pintar los swatches como para las ideas de combinación,
 * evita recalcular la mezcla de color repetidas veces. */
export function calcularPaleta(formulas: FormulaColor[]): ColorPaleta[] {
  return formulas.map((formula) => {
    const hex = colorAproximadoHex(formula);
    const { h, s, l } = rgbAHsl(hexARgb(hex));
    return { formula, hex, h, s, l };
  });
}

function diferenciaAngular(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface IdeaCombinacion {
  color: ColorPaleta;
  titulo: string;
  descripcion: string;
}

/**
 * Tres ideas de combinación reales (colores de verdad del abanico, no
 * inventados) para un color dado, cada una con un objetivo distinto -pedido
 * explícito del dueño: "que diga combinado con este si quiere darle
 * amplitud", etc. Son plantillas de texto por TIPO de combinación (neutro
 * claro / análogo / complementario), no curadas color por color -inviable a
 * mano para ~1500 colores-, pero el color sugerido en cada una sí es real,
 * elegido según su relación de matiz con el color de origen.
 */
export function ideasCombinacion(color: ColorPaleta, paleta: ColorPaleta[]): IdeaCombinacion[] {
  const otros = paleta.filter((c) => c.formula.codigo !== color.formula.codigo);
  const ideas: IdeaCombinacion[] = [];

  // 1) Neutro/claro: el más luminoso y menos saturado disponible -para dar
  // amplitud y luz, el uso más típico de un neutro claro en combinación.
  const neutro = [...otros].sort((a, b) => (b.l - b.s * 0.3) - (a.l - a.s * 0.3))[0];
  if (neutro) {
    ideas.push({
      color: neutro,
      titulo: "Para dar amplitud",
      descripcion: `Combinado con ${neutro.formula.nombre} (${neutro.formula.codigo}): un neutro claro que abre el espacio y deja que ${color.formula.nombre} sea el protagonista, sin competir.`,
    });
  }

  // 2) Análogo: matiz cercano (dentro de 35°), similar familia de color -da
  // continuidad y calidez/frescura según la familia.
  const analogos = otros
    .filter((c) => diferenciaAngular(c.h, color.h) <= 35 && Math.abs(c.l - color.l) > 8)
    .sort((a, b) => diferenciaAngular(a.h, color.h) - diferenciaAngular(b.h, color.h));
  const analogo = analogos[0];
  if (analogo) {
    const calida = color.h < 90 || color.h > 300;
    ideas.push({
      color: analogo,
      titulo: calida ? "Para dar calidez" : "Para dar frescura y continuidad",
      descripcion: `Combinado con ${analogo.formula.nombre} (${analogo.formula.codigo}): de la misma familia de color, da una transición suave entre ambientes sin cortar de golpe.`,
    });
  }

  // 3) Complementario: matiz opuesto (cerca de 180°) -da contraste y
  // personalidad, el uso clásico de un acento complementario.
  const complementarios = otros
    .map((c) => ({ c, dif: Math.abs(diferenciaAngular(c.h, color.h) - 180) }))
    .sort((a, b) => a.dif - b.dif);
  const complementario = complementarios[0]?.c;
  if (complementario) {
    ideas.push({
      color: complementario,
      titulo: "Para dar contraste y personalidad",
      descripcion: `Combinado con ${complementario.formula.nombre} (${complementario.formula.codigo}): su opuesto en la rueda de color, ideal para un muro acento o un detalle que resalte de verdad.`,
    });
  }

  return ideas;
}