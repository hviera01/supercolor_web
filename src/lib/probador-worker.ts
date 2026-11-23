/// <reference lib="webworker" />
// Detector de paredes: corre EdgeTAM (Segment Anything hecho para celulares)
// dentro del navegador del cliente. Usa ~300 MB de memoria al analizar: el
// modelo anterior (SlimSAM) pasaba de 1.9 GB y Safari en iPhone recargaba la
// pestaña. Guarda el análisis de cada foto para poder pasar de una a otra.
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
const MAX_FOTOS = 4;
env.allowLocalModels = false;

type Entrada =
  | { tipo: "foto"; id: number; clave: number; rgba: Uint8ClampedArray; ancho: number; alto: number }
  | { tipo: "zona"; id: number; clave: number; x: number; y: number }
  | { tipo: "otra"; id: number; clave: number }
  | { tipo: "olvidar"; id: number; clave: number };

interface EstadoFoto {
  ancho: number;
  alto: number;
  entradas: any;
  embeddings: any;
  guia: Float32Array;
  canales: CanalesFoto;
  croma: CromaFoto;
  ultimo: { logits: Float32Array[]; orden: number[]; areas: number[]; actual: number; x: number; y: number; hechas: (Uint8Array | undefined)[] } | null;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let modelo: any = null;
let procesador: any = null;
let cargando: Promise<void> | null = null;
const fotos = new Map<number, EstadoFoto>();
let cola: Promise<void> = Promise.resolve();

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

async function prepararFoto(clave: number, rgba: Uint8ClampedArray, w: number, h: number): Promise<void> {
  await cargarModelo();
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let k = 0, i = 0; k < w * h; k++, i += 4) {
    rgb[k * 3] = rgba[i];
    rgb[k * 3 + 1] = rgba[i + 1];
    rgb[k * 3 + 2] = rgba[i + 2];
  }
  ctx.postMessage({ tipo: "analizando", clave });
  // Se entrega ya del tamaño que pide el modelo para que la librería no use
  // OffscreenCanvas (no existe en Safari viejo); luego se le indica el tamaño
  // real para que las zonas salgan del tamaño de la foto.
  const tam = procesador.image_processor?.size ?? {};
  const dw = tam.width ?? 1024;
  const dh = tam.height ?? 1024;
  const entradas = await procesador(new RawImage(redimensionar(rgb, w, h, dw, dh), dw, dh, 3));
  entradas.original_sizes = [[h, w]];
  const embeddings = await modelo.get_image_embeddings(entradas);
  delete entradas.pixel_values;
  while (fotos.size >= MAX_FOTOS) fotos.delete(fotos.keys().next().value!);
  fotos.set(clave, {
    ancho: w,
    alto: h,
    entradas,
    embeddings,
    guia: guiaGris(rgba, w, h),
    canales: canalesFoto(rgba, w, h),
    croma: cromaFoto(rgba, w, h),
    ultimo: null,
  });
}

function terminarZona(f: EstadoFoto, logits: Float32Array, x: number, y: number): Uint8Array {
  const binaria = zonaDesdeLogits(logits, f.croma, f.ancho, f.alto, x, y);
  return refinarMascara(binaria, f.guia, f.ancho, f.alto, f.canales);
}

function zonaGuardada(f: EstadoFoto, u: NonNullable<EstadoFoto["ultimo"]>, i: number): Uint8Array {
  u.hechas[i] ??= terminarZona(f, u.logits[i], u.x, u.y);
  return u.hechas[i]!.slice();
}

function parecidas(a: Uint8Array, b: Uint8Array): boolean {
  let inter = 0, union = 0;
  for (let k = 0; k < a.length; k++) {
    const x = a[k] > 127, y = b[k] > 127;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union === 0 || inter / union > 0.93;
}

async function zona(f: EstadoFoto, x: number, y: number): Promise<{ alfa: Uint8Array; opciones: number }> {
  const [rh, rw] = f.entradas.reshaped_input_sizes[0];
  const puntos = new Tensor("float32", [(x * rw) / f.ancho, (y * rh) / f.alto], [1, 1, 1, 2]);
  const etiquetas = new Tensor("int64", [1n], [1, 1, 1]);
  const salida = await modelo({ ...f.embeddings, input_points: puntos, input_labels: etiquetas });
  const mascaras = await procesador.post_process_masks(salida.pred_masks, f.entradas.original_sizes, f.entradas.reshaped_input_sizes, {
    binarize: false,
  });
  const datos = mascaras[0].data as Float32Array;
  const n = f.ancho * f.alto;
  const logits = [0, 1, 2].map((k) => Float32Array.from(datos.subarray(k * n, (k + 1) * n)));
  const puntajes = Array.from(salida.iou_scores.data as Float32Array);
  const orden = ordenarOpciones(logits.map((l) => binarizar(l)), puntajes, f.croma, f.ancho, f.alto, x, y);
  const areas = logits.map((l) => {
    let n = 0;
    for (let k = 0; k < l.length; k++) if (l[k] > 0) n++;
    return n;
  });
  f.ultimo = { logits, orden, areas, actual: 0, x, y, hechas: [] };
  return { alfa: zonaGuardada(f, f.ultimo, orden[0]), opciones: orden.length };
}

function otraForma(f: EstadoFoto): Uint8Array | null {
  const u = f.ultimo;
  if (!u || u.orden.length < 2) return null;
  const vista = u.hechas[u.orden[u.actual]];
  for (let paso = 1; paso < u.orden.length; paso++) {
    const cand = (u.actual + paso) % u.orden.length;
    const alfa = zonaGuardada(f, u, u.orden[cand]);
    if (vista && cand !== 0 && parecidas(alfa, vista)) continue;
    u.actual = cand;
    return alfa;
  }
  u.actual = 0;
  return zonaGuardada(f, u, u.orden[0]);
}

async function atender(m: Entrada): Promise<void> {
  try {
    if (m.tipo === "foto") {
      await prepararFoto(m.clave, m.rgba, m.ancho, m.alto);
      ctx.postMessage({ tipo: "lista", id: m.id });
      return;
    }
    if (m.tipo === "olvidar") {
      fotos.delete(m.clave);
      return;
    }
    const f = fotos.get(m.clave);
    if (!f) {
      ctx.postMessage({ tipo: "sin-foto", id: m.id });
      return;
    }
    if (m.tipo === "zona") {
      const { alfa, opciones } = await zona(f, Math.round(m.x), Math.round(m.y));
      ctx.postMessage({ tipo: "zona", id: m.id, alfa, opciones }, [alfa.buffer]);
    } else {
      const alfa = otraForma(f);
      if (alfa) ctx.postMessage({ tipo: "zona", id: m.id, alfa, opciones: f.ultimo?.orden.length ?? 1 }, [alfa.buffer]);
      else ctx.postMessage({ tipo: "sin-otra", id: m.id });
    }
  } catch (err) {
    ctx.postMessage({ tipo: "error", id: m.id, mensaje: String((err as Error)?.message ?? err) });
  }
}

ctx.onmessage = (e: MessageEvent<Entrada>) => {
  cola = cola.then(() => atender(e.data));
};
