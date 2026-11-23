// Servidor chiquito del probador de colores: recibe la foto, le pide a Claude
// el contorno de cada superficie (pared, columnas, recuadros, cerámica…) y
// devuelve los polígonos. Existe solo para que la llave de la API no viaje
// dentro de la página.
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { pedirSuperficies } from "./pedido";

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
      const r = await pedirSuperficies(cliente, imagen, ancho, alto);
      if (!r) return responder({ error: "sin-respuesta" }, 502, origen);
      console.log("reconocer: tokens", r.uso.input_tokens, r.uso.output_tokens);
      const cuerpo = JSON.stringify({ superficies: r.superficies });
      await env.DATOS.put(`r:${id}`, cuerpo, { expirationTtl: GUARDAR_RESPUESTA });
      return new Response(cuerpo, { status: 200, headers: { "Content-Type": "application/json", ...cabeceras(origen) } });
    } catch (err) {
      console.error("reconocer:", err);
      if (err instanceof Anthropic.RateLimitError) return responder({ error: "ocupado" }, 503, origen);
      return responder({ error: "claude" }, 502, origen);
    }
  },
};
