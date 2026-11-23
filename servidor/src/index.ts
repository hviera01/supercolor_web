// Servidor chiquito del probador de colores: recibe la foto, le pide a Claude
// el contorno de cada superficie (pared, columnas, recuadros, cerámica…) y
// devuelve los polígonos. Existe solo para que la llave de la API no viaje
// dentro de la página.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

interface Env {
  ANTHROPIC_API_KEY: string;
  LIMITE: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const ORIGENES = [
  "https://supercolordanli.com",
  "https://www.supercolordanli.com",
  "https://supercolor-web.web.app",
  "https://supercolor-web.firebaseapp.com",
];

const TIPOS = [
  "pared", "columna", "franja", "recuadro", "cenefa", "zocalo", "ceramica", "ventana", "puerta", "reja",
  "techo", "alero", "cielo", "piso", "vegetacion", "mueble", "objeto", "otro",
] as const;

const Punto = z.array(z.number()).describe("[x, y] en píxeles de la imagen");
const Esquema = z.object({
  superficies: z.array(
    z.object({
      nombre: z.string().describe("Nombre corto en español, por ejemplo: Pared principal, Columna derecha"),
      tipo: z.enum(TIPOS),
      pintable: z.boolean(),
      poligono: z.array(Punto),
      huecos: z.array(z.array(Punto)),
    }),
  ),
});

const SISTEMA =
  "Sos un experto en pintura de fachadas e interiores. Segmentás fotos para un simulador de pintura: cada superficie que un pintor pintaría de un color por separado.";

function instrucciones(ancho: number, alto: number): string {
  return `La imagen mide ${ancho}x${alto} píxeles (x hacia la derecha, y hacia abajo, origen arriba a la izquierda).
Listá cada superficie de la foto como polígono con coordenadas en píxeles exactos de esta imagen.
- Separá cada superficie que se pintaría de otro color: pared principal, columnas o pilastras, franjas o recuadros de otro tono (aunque estén al mismo nivel), cenefas, zócalos, cielo falso.
- Las superficies pintables NO incluyen ventanas, rejas, puertas, cerámica, techo, alero, cielo, piso, muebles ni objetos: dejalos como huecos o como superficies aparte con pintable=false.
- Las paredes son rectas: usá los vértices de las esquinas reales y seguí los bordes con precisión de 2 o 3 píxeles. Cuidá sobre todo el borde contra el techo o alero y contra la cerámica o el piso.
- Si una superficie pintable rodea a otra (un recuadro dentro de la pared, una ventana), poné la de adentro en "huecos" de la de afuera.
- Paredes que doblan una esquina van como superficies separadas.
- Cubrí toda la foto con superficies (también cielo, techo, piso, etc.).`;
}

function cabeceras(origen: string | null): Record<string, string> {
  const permitido = origen && (ORIGENES.includes(origen) || /^http:\/\/localhost:\d+$/.test(origen)) ? origen : ORIGENES[0];
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function responder(cuerpo: unknown, estado: number, origen: string | null): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json", ...cabeceras(origen) },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origen = req.headers.get("Origin");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras(origen) });
    if (req.method !== "POST") return responder({ error: "metodo" }, 405, origen);
    if (!origen || !(ORIGENES.includes(origen) || /^http:\/\/localhost:\d+$/.test(origen))) {
      return responder({ error: "origen" }, 403, origen);
    }
    const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
    if (env.LIMITE && !(await env.LIMITE.limit({ key: ip })).success) return responder({ error: "limite" }, 429, origen);

    let datos: { imagen?: unknown; ancho?: unknown; alto?: unknown };
    try {
      datos = await req.json();
    } catch {
      return responder({ error: "json" }, 400, origen);
    }
    const imagen = typeof datos.imagen === "string" ? datos.imagen : "";
    const ancho = Number(datos.ancho);
    const alto = Number(datos.alto);
    if (!imagen || imagen.length > 2_000_000 || !(ancho > 0 && ancho <= 1600 && alto > 0 && alto <= 1600)) {
      return responder({ error: "imagen" }, 400, origen);
    }

    const cliente = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    try {
      const r = await cliente.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "high", format: zodOutputFormat(Esquema) },
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
      if (r.stop_reason === "refusal" || !r.parsed_output) return responder({ error: "sin-respuesta" }, 502, origen);
      return responder(r.parsed_output, 200, origen);
    } catch (err) {
      console.error("reconocer:", err);
      if (err instanceof Anthropic.RateLimitError) return responder({ error: "ocupado" }, 503, origen);
      return responder({ error: "claude" }, 502, origen);
    }
  },
};
