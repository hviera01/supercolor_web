// Lo que se le pide a Claude y cómo se lee la respuesta. Los vértices vienen
// como texto "x,y x,y …" (cuesta menos de la mitad de tokens que una lista
// JSON de pares) y se devuelven a la página como listas de puntos.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const TIPOS = [
  "pared", "columna", "franja", "recuadro", "cenefa", "zocalo", "ceramica", "ventana", "puerta", "reja",
  "techo", "alero", "cielo", "piso", "mueble", "objeto", "otro",
] as const;

const Esquema = z.object({
  superficies: z.array(
    z.object({
      nombre: z.string().describe("Nombre corto en español: Pared principal, Columna derecha…"),
      tipo: z.enum(TIPOS),
      pintable: z.boolean(),
      poligono: z.string().describe("Vértices en orden: \"x,y x,y x,y\" en píxeles enteros"),
      huecos: z.array(z.string()).describe("Cada hueco con el mismo formato que poligono"),
    }),
  ),
});

const SISTEMA =
  "Sos un experto en pintura de fachadas e interiores. Segmentás fotos para un simulador de pintura: cada superficie que un pintor pintaría de un color por separado.";

function instrucciones(ancho: number, alto: number): string {
  return `La imagen mide ${ancho}x${alto} píxeles (x hacia la derecha, y hacia abajo, origen arriba a la izquierda).
Listá cada superficie pintable como polígono, con coordenadas en píxeles exactos de esta imagen.
- Separá cada superficie que se pintaría de otro color: paredes, columnas o pilastras, franjas o recuadros de otro tono (aunque estén al mismo nivel), cenefas, zócalos pintados, marcos de puertas y ventanas, cielo falso.
- Lo que no se pinta y queda sobre una pared o pegado a ella (ventanas, rejas, puertas, cerámica, rótulos, muebles, techo o alero) va como superficie aparte con pintable=false, para marcar bien el borde. No listes el cielo, la calle, la vegetación ni el fondo lejano.
- Las paredes son rectas: usá los vértices de las esquinas reales y seguí los bordes con precisión de 2 o 3 píxeles. Cuidá sobre todo las esquinas y el borde contra el techo, el alero, la cerámica o el piso.
- Si una superficie pintable rodea a otra (un recuadro dentro de la pared, una ventana), poné la de adentro en "huecos" de la de afuera.
- Paredes que doblan una esquina, y fachadas de casas o locales distintos, van como superficies separadas.`;
}

function puntos(texto: string): number[][] {
  const salida: number[][] = [];
  for (const par of texto.trim().split(/\s+/)) {
    const [x, y] = par.split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) salida.push([x, y]);
  }
  return salida;
}

export async function pedirSuperficies(
  cliente: Anthropic,
  imagen: string,
  ancho: number,
  alto: number,
  modelo = "claude-opus-5-5",
  esfuerzo: "low" | "medium" | "high" = "high",
): Promise<{ superficies: unknown[]; uso: Anthropic.Usage } | null> {
  const r = await cliente.messages.parse({
    model: modelo,
    max_tokens: 10000,
    output_config: { effort: esfuerzo, format: zodOutputFormat(Esquema) },
    system: SISTEMA,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imagen } },
          { type: "text", text: instrucciones(ancho, alto) },
        ],
      },
    ],
  });
  if (r.stop_reason === "refusal" || !r.parsed_output) return null;
  const superficies = r.parsed_output.superficies.map((s) => ({
    ...s,
    poligono: puntos(s.poligono),
    huecos: s.huecos.map(puntos).filter((h) => h.length >= 3),
  }));
  return { superficies, uso: r.usage };
}
