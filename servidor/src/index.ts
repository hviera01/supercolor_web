// Servidor chiquito del probador de colores: recibe la foto, le pide a Claude
// el contorno de cada superficie (pared, columnas, recuadros, cerámica…) y
// devuelve los polígonos. Existe solo para que la llave de la API no viaje
// dentro de la página.
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

interface Env {
  ANTHROPIC_API_KEY: string;
  LIMITE: { limit(o: { key: string }): Promise<{ success: boolean }> };
  DATOS: KVNamespace;
  CUPO: DurableObjectNamespace<Cupo>;
  FOTOS_POR_DIA: string;
  FOTOS_POR_PERSONA_DIA: string;
}

const DIA = 86400;
const GUARDAR_RESPUESTA = 30 * DIA;

// Día en hora de Honduras (UTC-6), para que el cupo se renueve a medianoche de allá.
function hoy(): string {
  return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

async function huella(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const h = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Contador de fotos del día. Es un solo objeto para todo el mundo, así que
// dos pedidos al mismo tiempo no pueden pasarse del cupo.
export class Cupo extends DurableObject {
  async consumir(dia: string, ip: string, maxDia: number, maxIp: number): Promise<boolean> {
    const s = this.ctx.storage;
    if ((await s.get<string>("dia")) !== dia) {
      await s.deleteAll();
      await s.put("dia", dia);
    }
    const total = (await s.get<number>("total")) ?? 0;
    const dePersona = (await s.get<number>(`ip:${ip}`)) ?? 0;
    if (total >= maxDia || dePersona >= maxIp) return false;
    await s.put({ total: total + 1, [`ip:${ip}`]: dePersona + 1 });
    return true;
  }
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

    // La misma foto (recargar la página, abrirla en otro celular) no se le
    // vuelve a pagar a Claude: se devuelve lo que ya contestó.
    const id = await huella(`${ancho}x${alto}:${imagen}`);
    const guardada = await env.DATOS.get(`r:${id}`);
    if (guardada) {
      return new Response(guardada, { status: 200, headers: { "Content-Type": "application/json", ...cabeceras(origen) } });
    }

    // Cupos para que nadie gaste todos los créditos: por día en total y por persona.
    const dia = hoy();
    const cupo = env.CUPO.get(env.CUPO.idFromName("cupo"));
    const hay = await cupo.consumir(dia, ip, Number(env.FOTOS_POR_DIA), Number(env.FOTOS_POR_PERSONA_DIA));
    if (!hay) return responder({ error: "cupo" }, 429, origen);

    const cliente = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
    try {
      const r = await cliente.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 10000,
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
      const cuerpo = JSON.stringify(r.parsed_output);
      await env.DATOS.put(`r:${id}`, cuerpo, { expirationTtl: GUARDAR_RESPUESTA });
      return new Response(cuerpo, { status: 200, headers: { "Content-Type": "application/json", ...cabeceras(origen) } });
    } catch (err) {
      console.error("reconocer:", err);
      if (err instanceof Anthropic.RateLimitError) return responder({ error: "ocupado" }, 503, origen);
      return responder({ error: "claude" }, 502, origen);
    }
  },
};
