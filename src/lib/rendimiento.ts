// Calculadora de cuánta pintura hace falta según el área a pintar. El
// rendimiento (m² por galón) es un ESTIMADO por tipo de producto -pedido
// explícito del dueño: sin cargar nada a mano por producto exacto-. Donde
// encontré una ficha técnica real de LANCO se usa ese dato (látex general
// ~40 m²/galón, e impermeabilizante Dry Coat: ~37 m²/galón como pintura o
// ~9.5 m²/galón como sellador, mucho más grueso); donde no encontré ficha
// exacta (aceite, piscina, sellador/base) se usa una cifra típica de la
// industria para ese tipo de producto. Mismo espíritu que la aproximación
// de color: razonable, no exacto.

export type TipoProducto =
  | "latex"
  | "aceite"
  | "impermeabilizante_pintura"
  | "impermeabilizante_sellador"
  | "piscina"
  | "sellador_base";

export const TIPOS_PRODUCTO: { valor: TipoProducto; etiqueta: string }[] = [
  { valor: "latex", etiqueta: "Látex (interior/exterior)" },
  { valor: "aceite", etiqueta: "Esmalte / Aceite" },
  { valor: "impermeabilizante_pintura", etiqueta: "Impermeabilizante, usado como pintura" },
  { valor: "impermeabilizante_sellador", etiqueta: "Impermeabilizante, usado como sellador (capa gruesa)" },
  { valor: "piscina", etiqueta: "Pintura de piscina" },
  { valor: "sellador_base", etiqueta: "Sellador / Base" },
];

const RENDIMIENTO_M2_POR_GALON: Record<TipoProducto, number> = {
  latex: 40,
  aceite: 32,
  impermeabilizante_pintura: 37,
  impermeabilizante_sellador: 9.5,
  piscina: 22,
  sellador_base: 35,
};

export interface CompraSugerida {
  cubetas: number;
  galones: number;
  cuartos: number;
}

export interface ResultadoRendimiento {
  areaM2: number;
  galonesNecesarios: number;
  compra: CompraSugerida;
}

export function areaDesdeAnchoAlto(anchoM: number, altoM: number): number {
  return Math.max(0, anchoM) * Math.max(0, altoM);
}

export function areaDesdeLineal(metrosLineales: number, alturaM: number): number {
  return Math.max(0, metrosLineales) * Math.max(0, alturaM);
}

/** Cuartos (0.25gal), galones y cubetas (5gal) que cubren [galones]
 * necesarios, priorizando los tamaños más grandes (más eficientes en
 * precio por galón) -greedy simple de mayor a menor, redondeando hacia
 * arriba en el último tramo para no quedar corto. */
function sugerirCompra(galones: number): CompraSugerida {
  if (galones <= 0) return { cubetas: 0, galones: 0, cuartos: 0 };
  let restante = galones;
  const cubetas = Math.floor(restante / 5);
  restante -= cubetas * 5;
  let galonesSueltos = Math.floor(restante);
  restante = redondear(restante - galonesSueltos);
  let cuartos = Math.ceil(restante / 0.25 - 1e-9);
  if (cuartos >= 4) {
    cuartos = 0;
    galonesSueltos += 1;
  }
  return { cubetas, galones: galonesSueltos, cuartos };
}

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function calcularPintura(areaM2: number, tipo: TipoProducto, manos: number): ResultadoRendimiento {
  const rendimiento = RENDIMIENTO_M2_POR_GALON[tipo];
  const galonesNecesarios = redondear((areaM2 * Math.max(1, manos)) / rendimiento);
  return { areaM2, galonesNecesarios, compra: sugerirCompra(galonesNecesarios) };
}
