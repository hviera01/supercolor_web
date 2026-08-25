// Colores REALES del abanico LANCO -código, nombre, base y color oficial
// (hex)-, sacados directo del feed de datos que usa la propia herramienta
// de paleta de lancopaints.com (no es una aproximación calculada: es el
// mismo valor que usa LANCO). El sitio oficial no lo expone como descarga
// pública, pero sirve el color real en un JSON que su propia página carga
// por JavaScript -se extrajo una sola vez y se guarda acá como dataset
// estático; si LANCO cambia su paleta en el futuro, hay que repetir el
// proceso a mano, no hay sync automático-.

export interface ColorLanco {
  codigo: string;
  nombre: string;
  base: string;
  hex: string;
}

export type FamiliaColor =
  | "blancos"
  | "cremas_beiges"
  | "neutros"
  | "amarillos"
  | "naranjas"
  | "rojos"
  | "rosados"
  | "morados"
  | "azules"
  | "verdes_menta"
  | "verdes"
  | "verdes_lima";

export const ETIQUETAS_FAMILIA: Record<FamiliaColor, string> = {
  blancos: "Blancos",
  cremas_beiges: "Cremas y beiges",
  neutros: "Neutros y grises",
  amarillos: "Amarillos",
  naranjas: "Naranjas",
  rojos: "Rojos",
  rosados: "Rosados y magentas",
  morados: "Morados",
  azules: "Azules",
  verdes_menta: "Verdes menta y turquesas",
  verdes: "Verdes",
  verdes_lima: "Verdes limón",
};

/** Orden de despliegue de las familias -pensado para que se sienta como un
 * arcoíris ordenado, no una lista al azar. */
export const ORDEN_FAMILIAS: FamiliaColor[] = [
  "blancos",
  "cremas_beiges",
  "neutros",
  "amarillos",
  "naranjas",
  "rojos",
  "rosados",
  "morados",
  "azules",
  "verdes_menta",
  "verdes",
  "verdes_lima",
];

function hexARgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbAHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

/** Clasifica un color en una familia "de cliente" -no le importan las
 * bases de fábrica (Pastel/Deep/Accent/Tint), pedido explícito: "las bases
 * no importan porque el cliente no sabe de bases"-, por matiz/saturación/
 * luminosidad reales. */
function familiaDeColor(h: number, s: number, l: number): FamiliaColor {
  if (l >= 90 && s <= 12) return "blancos";
  // Cremas/beiges: tono cálido (amarillo-naranja), poco saturado y
  // claro/medio -lo que un cliente reconoce como "crema" o "beige" en vez
  // de "amarillo" (más saturado) o "blanco" (casi sin color). Se revisa
  // ANTES que "neutros" (grises verdaderos, sin sesgo de tono) y antes que
  // amarillos/naranjas (más saturados), para no perderlos ahí.
  if (h >= 20 && h <= 55 && s > 10 && s <= 35 && l >= 45) return "cremas_beiges";
  if (s <= 10) return "neutros";
  if (h < 15 || h >= 345) return "rojos";
  if (h < 40) return "naranjas";
  if (h < 68) return "amarillos";
  if (h < 95) return "verdes_lima";
  if (h < 150) return "verdes";
  if (h < 185) return "verdes_menta";
  if (h < 255) return "azules";
  if (h < 290) return "morados";
  return "rosados";
}

export interface ColorEnriquecido extends ColorLanco {
  h: number;
  s: number;
  l: number;
  familia: FamiliaColor;
}

export function enriquecerColores(colores: ColorLanco[]): ColorEnriquecido[] {
  return colores.map((c) => {
    const { r, g, b } = hexARgb(c.hex);
    const { h, s, l } = rgbAHsl(r, g, b);
    return { ...c, h, s, l, familia: familiaDeColor(h, s, l) };
  });
}

function diferenciaAngular(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export type ObjetivoCombinacion = "amplitud" | "calidez" | "frescura" | "contraste" | "elegancia" | "tranquilidad";

export const OBJETIVOS: { valor: ObjetivoCombinacion; etiqueta: string }[] = [
  { valor: "amplitud", etiqueta: "Amplitud y luminosidad" },
  { valor: "calidez", etiqueta: "Calidez" },
  { valor: "frescura", etiqueta: "Frescura" },
  { valor: "contraste", etiqueta: "Contraste y personalidad" },
  { valor: "elegancia", etiqueta: "Elegancia" },
  { valor: "tranquilidad", etiqueta: "Tranquilidad y relax" },
];

export const AREAS = ["Sala", "Dormitorio", "Cocina", "Baño", "Fachada / Exterior", "Oficina", "Local comercial"];

export interface SugerenciaCombinacion {
  color: ColorEnriquecido;
  tipo: "neutro claro" | "análogo" | "complementario" | "triádico" | "neutro oscuro" | "acento";
  objetivo: ObjetivoCombinacion;
  descripcion: string;
}

/**
 * El "combinador": 10 opciones reales del abanico para combinar con
 * [origen] -pedido explícito del dueño: no una sugerencia genérica, sino
 * que el cliente elija el color, opcionalmente el área y qué quiere
 * proyectar, y reciba 10 códigos concretos para llevar al abanico físico.
 * Si se pasa [objetivo], esas sugerencias van primero -el resto de todas
 * formas se incluye, para no dejar solo 2-3 opciones si el objetivo elegido
 * tiene pocos candidatos naturales.
 */
export function combinador(
  origen: ColorEnriquecido,
  paleta: ColorEnriquecido[],
  opts: { objetivo?: ObjetivoCombinacion; area?: string } = {},
): SugerenciaCombinacion[] {
  const otros = paleta.filter((c) => c.codigo !== origen.codigo);
  const usados = new Set<string>();
  const tomar = (candidatos: ColorEnriquecido[], n: number): ColorEnriquecido[] => {
    const elegidos: ColorEnriquecido[] = [];
    for (const c of candidatos) {
      if (elegidos.length >= n) break;
      if (usados.has(c.codigo)) continue;
      usados.add(c.codigo);
      elegidos.push(c);
    }
    return elegidos;
  };

  const paraArea = opts.area ? ` para tu ${opts.area.toLowerCase()}` : "";

  const neutrosClaros = tomar(
    [...otros].sort((a, b) => b.l - b.s * 0.3 - (a.l - a.s * 0.3)),
    2,
  ).map((color) => ({
    color,
    tipo: "neutro claro" as const,
    objetivo: "amplitud" as const,
    descripcion: `Un neutro claro${paraArea}: abre el espacio y deja que ${origen.nombre} sea el protagonista.`,
  }));

  const analogos = tomar(
    otros
      .filter((c) => diferenciaAngular(c.h, origen.h) <= 40 && Math.abs(c.l - origen.l) > 6)
      .sort((a, b) => diferenciaAngular(a.h, origen.h) - diferenciaAngular(b.h, origen.h)),
    2,
  ).map((color) => {
    const calida = origen.h < 90 || origen.h > 300;
    return {
      color,
      tipo: "análogo" as const,
      objetivo: calida ? ("calidez" as const) : ("frescura" as const),
      descripcion: `De la misma familia que ${origen.nombre}${paraArea}: da continuidad, sin cortar de golpe entre paredes.`,
    };
  });

  const complementarios = tomar(
    [...otros].sort(
      (a, b) => Math.abs(diferenciaAngular(a.h, origen.h) - 180) - Math.abs(diferenciaAngular(b.h, origen.h) - 180),
    ),
    2,
  ).map((color) => ({
    color,
    tipo: "complementario" as const,
    objetivo: "contraste" as const,
    descripcion: `Su opuesto en la rueda de color${paraArea}: ideal para un muro acento que de verdad resalte.`,
  }));

  const triadicos = tomar(
    [...otros].sort(
      (a, b) =>
        Math.min(Math.abs(diferenciaAngular(a.h, origen.h) - 120), Math.abs(diferenciaAngular(a.h, origen.h) - 240)) -
        Math.min(Math.abs(diferenciaAngular(b.h, origen.h) - 120), Math.abs(diferenciaAngular(b.h, origen.h) - 240)),
    ),
    2,
  ).map((color) => ({
    color,
    tipo: "triádico" as const,
    objetivo: "contraste" as const,
    descripcion: `Un tercer tono en equilibrio con ${origen.nombre}${paraArea}: para una combinación con más personalidad, sin quedar plano.`,
  }));

  const neutroOscuro = tomar(
    [...otros].filter((c) => c.familia === "neutros" || c.l < 30).sort((a, b) => a.l - b.l),
    1,
  ).map((color) => ({
    color,
    tipo: "neutro oscuro" as const,
    objetivo: "elegancia" as const,
    descripcion: `Un neutro profundo${paraArea}: da un acabado más serio y elegante, bueno para molduras o zócalos.`,
  }));

  const acento = tomar(
    [...otros]
      .filter((c) => diferenciaAngular(c.h, origen.h) <= 20)
      .sort((a, b) => b.s - a.s),
    1,
  ).map((color) => ({
    color,
    tipo: "acento" as const,
    objetivo: "tranquilidad" as const,
    descripcion: `Un tono más intenso de la misma familia${paraArea}: para un detalle puntual sin salirte de la paleta.`,
  }));

  let todas: SugerenciaCombinacion[] = [...neutrosClaros, ...analogos, ...complementarios, ...triadicos, ...neutroOscuro, ...acento];
  // Completar hasta 10 si algún grupo se quedó corto (paleta chica cerca de
  // ese matiz): rellena con los colores más cercanos en matiz que todavía
  // no se usaron, para siempre devolver 10 opciones reales.
  if (todas.length < 10) {
    const relleno = tomar(
      [...otros].sort((a, b) => diferenciaAngular(a.h, origen.h) - diferenciaAngular(b.h, origen.h)),
      10 - todas.length,
    ).map((color) => ({
      color,
      tipo: "análogo" as const,
      objetivo: "calidez" as const,
      descripcion: `Otra opción cercana a ${origen.nombre}${paraArea} para tener más variantes entre qué elegir.`,
    }));
    todas = [...todas, ...relleno];
  }

  if (opts.objetivo) {
    const prioridad = opts.objetivo;
    todas = [...todas].sort((a, b) => Number(b.objetivo === prioridad) - Number(a.objetivo === prioridad));
  }

  return todas.slice(0, 10);
}
