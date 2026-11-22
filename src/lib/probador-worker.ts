/// <reference lib="webworker" />
// Detector de paredes: corre el modelo Segment Anything (SlimSAM) dentro del
// navegador del cliente. La foto nunca sale del teléfono o la computadora.
import { AutoProcessor, RawImage, SamModel, Tensor, env } from "@huggingface/transformers";
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

const MODELO = "Xenova/slimsam-77-uniform";
env.allowLocalModels = false;

type Entrada =
  | { tipo: "foto"; id: number; rgba: Uint8ClampedArray; ancho: number; alto: number }
  | { tipo: "zona"; id: number; x: number; y: number }
  | { tipo: "otra"; id: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let modelo: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null;
let procesador: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
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
  ctx.postMessage({ tipo: "progreso", porcentaje: total ? Math.round((cargado / total) * 100) : 0, megas: total / 1e6 });
}

let usaGpu = false;

async function gpuDisponible(): Promise<"fp16" | "fp32" | null> {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) return null;
    const adaptador = await gpu.requestAdapter();
    if (!adaptador) return null;
    return adaptador.features?.has("shader-f16") ? "fp16" : "fp32";
  } catch {
    return null;
  }
}

const progreso = (p: any) => {
  if (p.status === "progress" && p.file) {
    bajado.set(p.file, { cargado: p.loaded ?? 0, total: p.total ?? 0 });
    avisarProgreso();
  }
};

async function cargarEn(gpu: "fp16" | "fp32" | null) {
  if (gpu) {
    return SamModel.from_pretrained(MODELO, {
      device: { vision_encoder: "webgpu", prompt_encoder_mask_decoder: "wasm" } as any,
      dtype: { vision_encoder: gpu, prompt_encoder_mask_decoder: "q8" } as any,
      progress_callback: progreso,
    });
  }
  return SamModel.from_pretrained(MODELO, { dtype: "q8", device: "wasm", progress_callback: progreso });
}

function cargarModelo(): Promise<void> {
  if (cargando) return cargando;
  cargando = (async () => {
    const gpu = await gpuDisponible();
    procesador ??= await AutoProcessor.from_pretrained(MODELO, { progress_callback: progreso });
    if (gpu) {
      try {
        modelo = await cargarEn(gpu);
        usaGpu = true;
        return;
      } catch {
        bajado.clear();
      }
    }
    modelo = await cargarEn(null);
    usaGpu = false;
  })();
  cargando.catch(() => {
    cargando = null;
  });
  return cargando;
}

async function prepararFoto(rgba: Uint8ClampedArray, w: number, h: number): Promise<void> {
  await cargarModelo();
  ancho = w;
  alto = h;
  ultimo = null;
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let k = 0, i = 0; k < w * h; k++, i += 4) {
    rgb[k * 3] = rgba[i];
    rgb[k * 3 + 1] = rgba[i + 1];
    rgb[k * 3 + 2] = rgba[i + 2];
  }
  const imagen = new RawImage(rgb, w, h, 3);
  ctx.postMessage({ tipo: "analizando" });
  entradas = await (procesador as any)(imagen);
  try {
    embeddings = await (modelo as any).get_image_embeddings(entradas);
  } catch (err) {
    if (!usaGpu) throw err;
    bajado.clear();
    modelo = await cargarEn(null);
    usaGpu = false;
    embeddings = await (modelo as any).get_image_embeddings(entradas);
  }
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
  const salida = await (modelo as any)({ ...embeddings, input_points: puntos, input_labels: etiquetas });
  const mascaras = await (procesador as any).post_process_masks(
    salida.pred_masks,
    entradas.original_sizes,
    entradas.reshaped_input_sizes,
    { binarize: false },
  );
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
      if (fotoId === m.id) ctx.postMessage({ tipo: "lista", id: m.id, motor: usaGpu ? "gpu" : "cpu" });
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
