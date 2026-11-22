/// <reference lib="webworker" />
// Detector de paredes: corre EdgeTAM (Segment Anything hecho para celulares)
// dentro del navegador del cliente. La foto nunca sale del teléfono o la
// computadora. Usa ~300 MB de memoria al analizar: el modelo anterior
// (SlimSAM) pasaba de 1.9 GB y Safari en iPhone cerraba la pestaña.
import { AutoProcessor, EdgeTamModel, RawImage, Tensor, env } from "@huggingface/transformers";
import {
  binarizar,
  canalesFoto,
  cromaFoto,
  guiaGris,
  ordenarOpciones,
  refinarMascara,
  zonaDesdeLogits,
  type CanalesFoto,
  type CromaFoto,
} from "./pintar-foto";

// Las versiones int8 del analizador de EdgeTAM vienen dañadas (puntajes en
// cero), por eso el analizador va completo y el decodificador en q4.
const MODELO = "onnx-community/EdgeTAM-ONNX";
const PRECISION = { vision_encoder: "fp32", prompt_encoder_mask_decoder: "q4" };
env.allowLocalModels = false;

type Entrada =
  | { tipo: "foto"; id: number; rgba: Uint8ClampedArray; ancho: number; alto: number }
  | { tipo: "zona"; id: number; x: number; y: number }
  | { tipo: "otra"; id: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let modelo: any = null;
let procesador: any = null;
let cargando: Promise<void> | null = null;

let ancho = 0;
let alto = 0;
let entradas: any = null;
let embeddings: any = null;
let guia: Float32Array | null = null;
let canales: CanalesFoto | null = null;
let croma: CromaFoto | null = null;
let fotoId = 0;

let ultimo: { logits: Float32Array[]; orden: number[]; actual: number; x: number; y: number } | null = null;

const bajado = new Map<string, { cargado: number; total: number }>();

function avisarProgreso(): void {
  let cargado = 0;
  let total = 0;
  for (const v of bajado.values()) {
    cargado += v.cargado;
    total += v.total;
  }
  ctx.postMessage({ tipo: "progreso", porcentaje: total ? Math.round((cargado / total) * 100) : 0 });
}

const progreso = (p: any) => {
  if (p.status === "progress" && p.file) {
    bajado.set(p.file, { cargado: p.loaded ?? 0, total: p.total ?? 0 });
    avisarProgreso();
  }
};

function cargarModelo(): Promise<void> {
  if (cargando) return cargando;
  cargando = (async () => {
    const [m, pr] = await Promise.all([
      EdgeTamModel.from_pretrained(MODELO, { device: "wasm", dtype: PRECISION as any, progress_callback: progreso }),
      AutoProcessor.from_pretrained(MODELO, { progress_callback: progreso }),
    ]);
    modelo = m;
    procesador = pr;
  })();
  cargando.catch(() => {
    cargando = null;
  });
  return cargando;
}

function redimensionar(rgb: Uint8ClampedArray, w: number, h: number, nw: number, nh: number): Uint8ClampedArray {
  const salida = new Uint8ClampedArray(nw * nh * 3);
  const sx = w / nw;
  const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const dy = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const dx = fx - x0;
      const a = (y0 * w + x0) * 3;
      const b = (y0 * w + x1) * 3;
      const c = (y1 * w + x0) * 3;
      const d = (y1 * w + x1) * 3;
      const o = (y * nw + x) * 3;
      for (let k = 0; k < 3; k++) {
        const arriba = rgb[a + k] + (rgb[b + k] - rgb[a + k]) * dx;
        const abajo = rgb[c + k] + (rgb[d + k] - rgb[c + k]) * dx;
        salida[o + k] = arriba + (abajo - arriba) * dy;
      }
    }
  }
  return salida;
}

async function prepararFoto(rgba: Uint8ClampedArray, w: number, h: number): Promise<void> {
  await cargarModelo();
  ancho = w;
  alto = h;
  ultimo = null;
  embeddings = null;
  entradas = null;
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let k = 0, i = 0; k < w * h; k++, i += 4) {
    rgb[k * 3] = rgba[i];
    rgb[k * 3 + 1] = rgba[i + 1];
    rgb[k * 3 + 2] = rgba[i + 2];
  }
  ctx.postMessage({ tipo: "analizando" });
  // Se entrega ya del tamaño que pide el modelo para que la librería no use
  // OffscreenCanvas (no existe en Safari viejo); luego se le indica el tamaño
  // real para que las zonas salgan del tamaño de la foto.
  const tam = procesador.image_processor?.size ?? {};
  const destinoAncho = tam.width ?? 1024;
  const destinoAlto = tam.height ?? 1024;
  entradas = await procesador(new RawImage(redimensionar(rgb, w, h, destinoAncho, destinoAlto), destinoAncho, destinoAlto, 3));
  entradas.original_sizes = [[h, w]];
  embeddings = await modelo.get_image_embeddings(entradas);
  delete entradas.pixel_values;
  guia = guiaGris(rgba, w, h);
  canales = canalesFoto(rgba, w, h);
  croma = cromaFoto(rgba, w, h);
}

function terminarZona(logits: Float32Array, x: number, y: number): Uint8Array {
  const binaria = zonaDesdeLogits(logits, croma!, ancho, alto, x, y);
  return refinarMascara(binaria, guia!, ancho, alto, canales!);
}

async function zona(x: number, y: number): Promise<{ alfa: Uint8Array; opciones: number }> {
  if (!embeddings || !modelo || !procesador) throw new Error("sin foto");
  const [rh, rw] = entradas.reshaped_input_sizes[0];
  const puntos = new Tensor("float32", [(x * rw) / ancho, (y * rh) / alto], [1, 1, 1, 2]);
  const etiquetas = new Tensor("int64", [1n], [1, 1, 1]);
  const salida = await modelo({ ...embeddings, input_points: puntos, input_labels: etiquetas });
  const mascaras = await procesador.post_process_masks(salida.pred_masks, entradas.original_sizes, entradas.reshaped_input_sizes, {
    binarize: false,
  });
  const datos = mascaras[0].data as Float32Array;
  const n = ancho * alto;
  const logits = [0, 1, 2].map((k) => Float32Array.from(datos.subarray(k * n, (k + 1) * n)));
  const puntajes = Array.from(salida.iou_scores.data as Float32Array);
  const orden = ordenarOpciones(logits.map((l) => binarizar(l)), puntajes, croma!, ancho, alto, x, y);
  ultimo = { logits, orden, actual: 0, x, y };
  return { alfa: terminarZona(logits[orden[0]], x, y), opciones: orden.length };
}

function otraForma(): Uint8Array | null {
  if (!ultimo || ultimo.orden.length < 2) return null;
  ultimo.actual = (ultimo.actual + 1) % ultimo.orden.length;
  return terminarZona(ultimo.logits[ultimo.orden[ultimo.actual]], ultimo.x, ultimo.y);
}

ctx.onmessage = async (e: MessageEvent<Entrada>) => {
  const m = e.data;
  try {
    if (m.tipo === "foto") {
      fotoId = m.id;
      await prepararFoto(m.rgba, m.ancho, m.alto);
      if (fotoId === m.id) ctx.postMessage({ tipo: "lista", id: m.id });
    } else if (m.tipo === "zona") {
      const { alfa, opciones } = await zona(Math.round(m.x), Math.round(m.y));
      ctx.postMessage({ tipo: "zona", id: m.id, alfa, opciones }, [alfa.buffer]);
    } else if (m.tipo === "otra") {
      const alfa = otraForma();
      if (alfa) ctx.postMessage({ tipo: "zona", id: m.id, alfa, opciones: ultimo?.orden.length ?? 1 }, [alfa.buffer]);
      else ctx.postMessage({ tipo: "sin-otra", id: m.id });
    }
  } catch (err) {
    ctx.postMessage({ tipo: "error", id: m.id, mensaje: String((err as Error)?.message ?? err) });
  }
};
