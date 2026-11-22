// Probador de colores en fotos reales: el cliente sube una o varias fotos
// (o usa una de ejemplo), elige un color del abanico y toca la pared. El
// detector marca la pared exacta y se pinta conservando la luz y las sombras.
// Para detalles finos hay zoom y un pincel que no se sale de la superficie
// donde se empezó a pintar.
import type { ColorEnriquecido } from "./color-lanco";
import { hexARgbFoto } from "./color-foto";
import { apartados, alCambiarApartados } from "./colores-apartados";
import { escapeHtml } from "./render-utils";
import {
  cromaFoto,
  luminanciaLineal,
  luzDeReferencia,
  pincelar,
  pintarCapas,
  tonoEn,
  type ColorCapa,
  type CromaFoto,
  type Pareja,
  type Region,
  type Tono,
} from "./pintar-foto";

interface Capa {
  color: ColorEnriquecido;
  rgb: ColorCapa;
  alfa: Uint8Array;
  ref?: number;
  pareja?: Pareja;
  /** Pedido de "disimular" en curso para esta capa (para descartar los viejos). */
  parejaPedida?: number;
}

type Modo = "pared" | "pincel" | "borrador" | "quitar" | "marcar";

interface Paso {
  capas: { codigo: string; alfa: Uint8Array; ref?: number }[];
}

interface Foto {
  clave: number;
  original: ImageData;
  vista: ImageData;
  capas: Capa[];
  historial: Paso[];
  lista: boolean;
  mini: string;
  croma?: CromaFoto;
  /** Área marcada a mano: si existe, no se pinta nada fuera de ella. */
  limite?: Uint8Array;
}

export interface Probador {
  probarColores(colores: ColorEnriquecido[]): void;
}

const LADO_MAX = 1280;
const MAX_HISTORIAL = 12;
const MAX_FOTOS = 4;
const NIVELES_ZOOM = [1, 1.5, 2, 3, 4, 6];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function iniciarProbador(paleta: ColorEnriquecido[], porCodigo: Map<string, ColorEnriquecido>): Probador {
  const seccion = $("probador");
  const inicio = $("probador-inicio");
  const archivo = $<HTMLInputElement>("probador-archivo");
  const archivoMas = $<HTMLInputElement>("probador-archivo-mas");
  const trabajo = $("probador-trabajo");
  const tiraFotos = $("probador-fotos");
  const marco = $("probador-marco");
  const caja = $("probador-caja");
  const lienzo = $<HTMLCanvasElement>("probador-canvas");
  const anillo = $("probador-anillo");
  const lupa = $<HTMLCanvasElement>("probador-lupa");
  const ctxLupa = lupa.getContext("2d")!;
  const estado = $("probador-estado");
  const estadoTexto = $("probador-estado-texto");
  const estadoBarra = $("probador-estado-barra");
  const estadoReintentar = $<HTMLButtonElement>("probador-reintentar");
  const marca = $("probador-marca");
  const aviso = $("probador-aviso");
  const listaColores = $("probador-colores");
  const buscar = $<HTMLInputElement>("probador-buscar");
  const sugerencias = $("probador-sugerencias");
  const usados = $("probador-usados");
  const botonesModo = document.querySelectorAll<HTMLButtonElement>("[data-probador-modo]");
  const cajaTamano = $("probador-tamano-caja");
  const tamano = $<HTMLInputElement>("probador-tamano");
  const btnAcercar = $<HTMLButtonElement>("probador-acercar");
  const btnAlejar = $<HTMLButtonElement>("probador-alejar");
  const nivelZoom = $("probador-zoom-nivel");
  const btnDeshacer = $<HTMLButtonElement>("probador-deshacer");
  const btnOtra = $<HTMLButtonElement>("probador-otra");
  const btnAntes = $<HTMLButtonElement>("probador-antes");
  const btnDescargar = $<HTMLButtonElement>("probador-descargar");
  const capaLimite = $<HTMLCanvasElement>("probador-limite");
  const ctxLimite = capaLimite.getContext("2d")!;
  const btnQuitarLimite = $<HTMLButtonElement>("probador-limite-quitar");
  const cajaPropuesta = $("probador-propuesta");
  const textoPropuesta = $("probador-propuesta-texto");
  const btnPropSi = $<HTMLButtonElement>("probador-prop-si");
  const btnPropOtra = $<HTMLButtonElement>("probador-prop-otra");
  const btnPropMarcar = $<HTMLButtonElement>("probador-prop-marcar");
  const btnPropNo = $<HTMLButtonElement>("probador-prop-no");
  const error = $("probador-error");
  const ctx = lienzo.getContext("2d", { willReadFrequently: true })!;

  let worker: Worker | null = null;
  let siguienteId = 1;
  let siguienteClave = 1;
  const pendientes = new Map<number, (m: any) => void>();

  let fotos: Foto[] = [];
  let actual: Foto | null = null;
  let ocupado = false;
  let ultimaOp: { modo: Modo; codigo: string; antes: Paso; opciones: number; clave: number } | null = null;
  let modo: Modo = "pared";
  let extras: ColorEnriquecido[] = [];
  let activo: ColorEnriquecido | null = null;
  let mostrandoAntes = false;
  let zoom = 1;

  let vigilante: ReturnType<typeof setTimeout> | undefined;
  const LENTO = "Tu equipo está tardando demasiado en analizar la foto. Probá de nuevo o con otra foto.";

  // ---------- Detector (worker) ----------
  function vigilar(ms: number, alVencer: () => void): void {
    clearTimeout(vigilante);
    vigilante = setTimeout(alVencer, ms);
  }

  function reiniciarWorker(): void {
    clearTimeout(vigilante);
    worker?.terminate();
    worker = null;
    pendientes.clear();
    fotos.forEach((f) => (f.lista = false));
  }

  function crearWorker(): Worker {
    const w = new Worker(new URL("./probador-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progreso") {
        vigilar(90000, () => {
          reiniciarWorker();
          fallo("La descarga del detector se detuvo. Revisá tu conexión e intentá de nuevo.");
        });
        if (actual && !actual.lista) mostrarEstado(`Preparando el detector de paredes… ${m.porcentaje}%`, m.porcentaje, "Solo la primera vez; después queda guardado.");
        return;
      }
      if (m.tipo === "analizando") {
        vigilar(120000, () => {
          reiniciarWorker();
          fallo(LENTO);
        });
        if (actual && actual.clave === m.clave) mostrarEstado("Analizando tu foto…", -1, "Puede tardar unos segundos.");
        return;
      }
      const fn = pendientes.get(m.id);
      if (fn) {
        pendientes.delete(m.id);
        fn(m);
      }
    };
    w.onerror = (ev) => {
      ev.preventDefault?.();
      reiniciarWorker();
      fallo("No pudimos iniciar el detector en este navegador.");
    };
    return w;
  }

  function pedir(mensaje: Record<string, unknown>, transferir: Transferable[] = []): Promise<any> {
    worker ??= crearWorker();
    const id = siguienteId++;
    return new Promise((resolver) => {
      pendientes.set(id, resolver);
      worker!.postMessage({ ...mensaje, id }, transferir);
    });
  }

  async function analizar(f: Foto): Promise<void> {
    if (actual === f) mostrarEstado("Preparando el detector de paredes…", 0);
    vigilar(90000, () => {
      reiniciarWorker();
      fallo("No pudimos preparar el detector. Revisá tu conexión e intentá de nuevo.");
    });
    const copia = new Uint8ClampedArray(f.original.data);
    const r = await pedir({ tipo: "foto", clave: f.clave, rgba: copia, ancho: f.original.width, alto: f.original.height }, [copia.buffer]);
    if (!fotos.includes(f)) return;
    clearTimeout(vigilante);
    if (r.tipo === "lista") {
      f.lista = true;
      seccion.dataset.listo = "1";
      if (actual === f) {
        ocultarEstado();
        avisarListo();
      }
    } else {
      console.error("probador:", r.mensaje);
      reiniciarWorker();
      fallo("No pudimos cargar el detector de paredes. Revisá tu conexión a internet e intentá de nuevo.");
    }
  }

  function mostrarEstado(texto: string, porcentaje: number, detalle = ""): void {
    estado.classList.remove("hidden");
    estado.classList.add("flex");
    estadoReintentar.classList.add("hidden");
    estadoTexto.innerHTML = `${escapeHtml(texto)}${detalle ? `<span class="mt-1 block text-xs font-normal opacity-80">${escapeHtml(detalle)}</span>` : ""}`;
    estadoBarra.parentElement!.classList.toggle("hidden", porcentaje < 0);
    if (porcentaje >= 0) estadoBarra.style.width = `${porcentaje}%`;
  }

  function ocultarEstado(): void {
    estado.classList.add("hidden");
    estado.classList.remove("flex");
  }

  function fallo(texto: string): void {
    estado.classList.remove("hidden");
    estado.classList.add("flex");
    estadoTexto.textContent = texto;
    estadoBarra.parentElement!.classList.add("hidden");
    estadoReintentar.classList.remove("hidden");
  }

  estadoReintentar.addEventListener("click", () => {
    reiniciarWorker();
    const orden = actual ? [actual, ...fotos.filter((f) => f !== actual)] : fotos;
    orden.forEach((f) => void analizar(f));
  });

  function avisar(texto: string): void {
    aviso.textContent = texto;
  }

  function textoModo(): string {
    if (modo === "pincel") return activo ? `Pasá el dedo por el detalle que querés pintar de ${activo.nombre}. Acercá la foto para más precisión.` : "Primero elegí un color.";
    if (modo === "borrador") return "Pasá el dedo por donde querés borrar la pintura.";
    if (modo === "quitar") return "Tocá lo que no querés pintar (una puerta, un mueble, un marco…).";
    if (modo === "marcar") return "Rodeá con el dedo la parte que querés pintar (una columna, un recuadro…). Después la pintás toda de una vez o con el pincel, sin salirte.";
    if (actual?.limite) return activo ? `Tocá dentro del área marcada para pintarla de ${activo.nombre}; la pintura no sale de ahí.` : "Elegí un color y tocá dentro del área marcada.";
    return activo ? `Tocá la pared que querés pintar de ${activo.nombre}.` : "Elegí un color y tocá la pared.";
  }

  function avisarListo(): void {
    avisar(modo === "pared" ? `Listo: ${textoModo().charAt(0).toLowerCase()}${textoModo().slice(1)}` : textoModo());
  }

  // ---------- Colores para elegir ----------
  function coloresDisponibles(): ColorEnriquecido[] {
    const vistos = new Set<string>();
    const salida: ColorEnriquecido[] = [];
    const agregar = (c: ColorEnriquecido | undefined) => {
      if (c && !vistos.has(c.codigo)) {
        vistos.add(c.codigo);
        salida.push(c);
      }
    };
    extras.forEach(agregar);
    fotos.forEach((f) => f.capas.forEach((c) => agregar(c.color)));
    apartados().forEach((codigo) => agregar(porCodigo.get(codigo)));
    return salida;
  }

  function pintarColores(): void {
    const disponibles = coloresDisponibles();
    if (!activo && disponibles.length) activo = disponibles[0];
    listaColores.innerHTML = disponibles.length
      ? disponibles
          .map(
            (c) => `
        <button type="button" data-color="${escapeHtml(c.codigo)}" aria-pressed="${activo?.codigo === c.codigo}" class="probador-chip" title="${escapeHtml(c.nombre)} (${escapeHtml(c.codigo)})">
          <i style="background:${c.hex}"></i>
          <span><b>${escapeHtml(c.nombre)}</b><small>${escapeHtml(c.codigo)}</small></span>
        </button>`,
          )
          .join("")
      : '<p class="text-xs text-tinta-500">Buscá un color abajo, o apartá colores en el abanico con el corazón y aparecen aquí.</p>';
  }

  listaColores.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button[data-color]") as HTMLButtonElement | null;
    if (!b) return;
    activo = porCodigo.get(b.dataset.color!) ?? activo;
    if (modo === "borrador" || modo === "quitar") modo = "pared";
    aplicarModo();
    pintarColores();
    avisar(textoModo());
  });

  function normalizar(t: string): string {
    return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  buscar.addEventListener("input", () => {
    const texto = normalizar(buscar.value.trim());
    if (!texto) {
      sugerencias.classList.add("hidden");
      return;
    }
    const k = texto.replace(/[^a-z0-9]/g, "");
    const res = paleta
      .filter((c) => normalizar(c.nombre).includes(texto) || (k && normalizar(c.codigo).replace(/[^a-z0-9]/g, "").includes(k)))
      .slice(0, 8);
    sugerencias.innerHTML = res.length
      ? res
          .map(
            (c) => `<button type="button" data-codigo="${escapeHtml(c.codigo)}" class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-crema-100">
          <span class="h-7 w-7 shrink-0 rounded-lg border border-tinta-900/10" style="background:${c.hex}"></span>
          <span class="text-sm text-tinta-900">${escapeHtml(c.nombre)} <span class="font-mono text-xs text-tinta-500">${escapeHtml(c.codigo)}</span></span>
        </button>`,
          )
          .join("")
      : '<p class="px-4 py-3 text-sm text-tinta-500">No encontramos ese color.</p>';
    sugerencias.classList.remove("hidden");
  });

  sugerencias.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button[data-codigo]") as HTMLButtonElement | null;
    const c = b ? porCodigo.get(b.dataset.codigo!) : undefined;
    if (!c) return;
    extras = [c, ...extras.filter((x) => x.codigo !== c.codigo)];
    activo = c;
    buscar.value = "";
    sugerencias.classList.add("hidden");
    if (modo === "borrador" || modo === "quitar") modo = "pared";
    aplicarModo();
    pintarColores();
    avisar(textoModo());
  });

  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t !== buscar && !sugerencias.contains(t)) sugerencias.classList.add("hidden");
  });

  alCambiarApartados(pintarColores);

  // ---------- Herramientas ----------
  function esTrazo(): boolean {
    return modo === "pincel" || modo === "borrador";
  }

  let modoPrevio: Modo = "pared";

  function aplicarModo(): void {
    botonesModo.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.probadorModo === modo)));
    cajaTamano.classList.toggle("hidden", !esTrazo());
    cajaTamano.classList.toggle("flex", esTrazo());
    lienzo.style.cursor = esTrazo() ? "none" : modo === "quitar" ? "not-allowed" : "crosshair";
    lienzo.style.touchAction = esTrazo() || modo === "marcar" || zoom > 1 ? "none" : "pan-y";
    if (modo === "marcar") lienzo.style.cursor = "crosshair";
    if (!esTrazo()) anillo.classList.add("hidden");
  }

  botonesModo.forEach((b) =>
    b.addEventListener("click", () => {
      const nuevo = b.dataset.probadorModo as Modo;
      cerrarPropuesta();
      if (nuevo === "marcar" && modo !== "marcar") modoPrevio = modo;
      modo = nuevo;
      aplicarModo();
      avisar(textoModo());
    }),
  );

  function actualizarBotones(): void {
    const capas = actual?.capas ?? [];
    btnDeshacer.disabled = !actual || actual.historial.length === 0 || ocupado;
    const conOtra = !!ultimaOp && ultimaOp.clave === actual?.clave && ultimaOp.opciones > 1;
    btnOtra.classList.toggle("hidden", !conOtra);
    btnOtra.disabled = ocupado;
    btnDescargar.disabled = capas.length === 0;
    btnQuitarLimite.classList.toggle("hidden", !actual?.limite);
    btnAntes.disabled = capas.length === 0;
  }

  function copiaPaso(f: Foto): Paso {
    return { capas: f.capas.map((c) => ({ codigo: c.color.codigo, alfa: c.alfa.slice(), ref: c.ref })) };
  }

  function restaurar(f: Foto, paso: Paso): void {
    f.capas = paso.capas
      .map((c) => {
        const color = porCodigo.get(c.codigo)!;
        return { color, rgb: hexARgbFoto(color.hex), alfa: c.alfa.slice(), ref: c.ref };
      })
      .filter((c) => c.color);
  }

  function guardarPaso(f: Foto): Paso {
    const p = copiaPaso(f);
    f.historial.push(p);
    if (f.historial.length > MAX_HISTORIAL) f.historial.shift();
    return p;
  }

  function capaDe(f: Foto, codigo: string): Capa {
    let capa = f.capas.find((c) => c.color.codigo === codigo);
    if (!capa) {
      const color = porCodigo.get(codigo)!;
      capa = { color, rgb: hexARgbFoto(color.hex), alfa: new Uint8Array(f.original.width * f.original.height) };
      f.capas.push(capa);
    }
    return capa;
  }

  function aplicarZona(f: Foto, op: Modo, codigo: string, zona: Uint8Array): void {
    if (f.limite) {
      const lim = f.limite;
      zona = zona.map((v, k) => (v * lim[k]) / 255);
    }
    for (const c of f.capas) {
      if (op === "pared" && c.color.codigo === codigo) continue;
      const a = c.alfa;
      for (let k = 0; k < a.length; k++) if (zona[k]) a[k] = (a[k] * (255 - zona[k])) / 255;
      c.ref = undefined;
    }
    if (op === "pared") {
      const capa = capaDe(f, codigo);
      const a = capa.alfa;
      for (let k = 0; k < a.length; k++) if (zona[k] > a[k]) a[k] = zona[k];
      capa.ref = undefined;
    }
    f.capas = f.capas.filter((c) => c.alfa.some((v) => v > 8));
    olvidarParejas(f);
  }

  function capasParaPintar(f: Foto) {
    return f.capas.map((c) => {
      if (c.ref === undefined) c.ref = luzDeReferencia(f.original.data, c.alfa);
      return { color: c.rgb, alfa: c.alfa, ref: c.ref, pareja: disimular ? c.pareja : undefined };
    });
  }

  function redibujar(): void {
    const f = actual;
    if (!f) return;
    pintarCapas(f.original.data, capasParaPintar(f), f.vista.data);
    if (!mostrandoAntes) ctx.putImageData(f.vista, 0, 0);
    pintarUsados();
    pintarTira();
    actualizarBotones();
    pedirParejas(f);
  }

  // ---------- Disimular desperfectos ----------
  let disimular = false;
  let workerPareja: Worker | null = null;
  let siguientePareja = 1;
  const esperandoPareja = new Map<number, { f: Foto; capa: Capa }>();
  const btnDisimular = $<HTMLInputElement>("probador-disimular");

  function olvidarParejas(f: Foto): void {
    for (const c of f.capas) {
      c.pareja = undefined;
      c.parejaPedida = undefined;
    }
  }

  function trabajadorPareja(): Worker {
    if (workerPareja) return workerPareja;
    const w = new Worker(new URL("./pareja-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      const { id, luz, relleno } = e.data;
      const pedido = esperandoPareja.get(id);
      esperandoPareja.delete(id);
      if (!pedido || pedido.capa.parejaPedida !== id || !pedido.f.capas.includes(pedido.capa)) return;
      pedido.capa.pareja = { luz, relleno };
      if (esperandoPareja.size === 0 && actual === pedido.f && disimular) {
        avisar("Listo: pared emparejada, como si estuviera resanada.");
      }
      if (actual === pedido.f && disimular) redibujar();
    };
    w.onerror = () => {
      workerPareja?.terminate();
      workerPareja = null;
      esperandoPareja.clear();
    };
    workerPareja = w;
    return w;
  }

  function pedirParejas(f: Foto): void {
    if (!disimular || trazo) return;
    const w = f.original.width;
    const h = f.original.height;
    let pidio = false;
    for (const capa of f.capas) {
      if (capa.pareja || capa.parejaPedida) continue;
      const otras = new Uint8Array(w * h);
      for (const o of f.capas) {
        if (o === capa) continue;
        for (let k = 0; k < otras.length; k++) if (o.alfa[k] > otras[k]) otras[k] = o.alfa[k];
      }
      const id = siguientePareja++;
      capa.parejaPedida = id;
      esperandoPareja.set(id, { f, capa });
      trabajadorPareja().postMessage(
        { id, rgba: f.original.data.slice(), alfa: capa.alfa.slice(), otras, ancho: w, alto: h },
      );
      pidio = true;
    }
    if (pidio && actual === f) avisar("Emparejando la pared…");
  }

  btnDisimular.addEventListener("change", () => {
    disimular = btnDisimular.checked;
    if (!actual) return;
    redibujar();
    if (!disimular) avisar("Se ve la pared tal como está en la foto.");
  });

  let regionPendiente: Region | null = null;
  let cuadroPendiente = false;

  function redibujarRegion(r: Region): void {
    regionPendiente = regionPendiente
      ? { x0: Math.min(regionPendiente.x0, r.x0), y0: Math.min(regionPendiente.y0, r.y0), x1: Math.max(regionPendiente.x1, r.x1), y1: Math.max(regionPendiente.y1, r.y1) }
      : r;
    if (cuadroPendiente) return;
    cuadroPendiente = true;
    requestAnimationFrame(() => {
      cuadroPendiente = false;
      const f = actual;
      const reg = regionPendiente;
      regionPendiente = null;
      if (!f || !reg) return;
      pintarCapas(f.original.data, capasParaPintar(f), f.vista.data, f.original.width, reg);
      if (!mostrandoAntes) ctx.putImageData(f.vista, 0, 0, reg.x0, reg.y0, reg.x1 - reg.x0 + 1, reg.y1 - reg.y0 + 1);
      dibujarLupa();
    });
  }

  function pintarUsados(): void {
    const capas = actual?.capas ?? [];
    usados.innerHTML = capas
      .map(
        (c) => `
        <div class="flex items-center gap-3 rounded-xl bg-crema-100 p-2.5">
          <span class="h-9 w-9 shrink-0 rounded-lg border border-tinta-900/10" style="background:${c.color.hex}"></span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold text-tinta-900">${escapeHtml(c.color.nombre)}</p>
            <p class="font-mono text-xs text-tinta-500">${escapeHtml(c.color.codigo)}</p>
          </div>
          <button type="button" data-quitar-color="${escapeHtml(c.color.codigo)}" class="rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-50">Quitar</button>
        </div>`,
      )
      .join("");
    usados.classList.toggle("hidden", capas.length === 0);
  }

  usados.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button[data-quitar-color]") as HTMLButtonElement | null;
    if (!b || !actual) return;
    guardarPaso(actual);
    ultimaOp = null;
    actual.capas = actual.capas.filter((c) => c.color.codigo !== b.dataset.quitarColor);
    olvidarParejas(actual);
    redibujar();
  });

  btnDeshacer.addEventListener("click", () => {
    if (!actual) return;
    const p = actual.historial.pop();
    if (!p) return;
    restaurar(actual, p);
    ultimaOp = null;
    redibujar();
  });

  btnOtra.addEventListener("click", async () => {
    if (!ultimaOp || ocupado || !actual || ultimaOp.clave !== actual.clave) return;
    const op = ultimaOp;
    const f = actual;
    ocupado = true;
    actualizarBotones();
    avisar("Buscando otro recorte…");
    const r = await pedir({ tipo: "otra", clave: f.clave });
    ocupado = false;
    if (r.tipo === "zona" && ultimaOp === op) {
      restaurar(f, op.antes);
      aplicarZona(f, op.modo, op.codigo, r.alfa);
      if (actual === f) redibujar();
      avisar("¿Así quedó mejor? Si no, tocá “Cambiar recorte” otra vez o “Deshacer”.");
    }
    actualizarBotones();
  });

  const verAntes = (si: boolean) => {
    if (!actual || actual.capas.length === 0) return;
    mostrandoAntes = si;
    ctx.putImageData(si ? actual.original : actual.vista, 0, 0);
    btnAntes.setAttribute("aria-pressed", String(si));
  };
  btnAntes.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    verAntes(true);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) => btnAntes.addEventListener(t, () => verAntes(false)));
  btnAntes.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") verAntes(true);
  });
  btnAntes.addEventListener("keyup", () => verAntes(false));
  btnAntes.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- Zoom ----------
  function aplicarZoom(nuevo: number, cx?: number, cy?: number): void {
    nuevo = Math.max(1, Math.min(NIVELES_ZOOM[NIVELES_ZOOM.length - 1], nuevo));
    if (Math.abs(nuevo - zoom) < 0.001) return;
    const r = marco.getBoundingClientRect();
    const ax = (cx ?? r.left + r.width / 2) - r.left;
    const ay = (cy ?? r.top + r.height / 2) - r.top;
    const px = (marco.scrollLeft + ax) / zoom;
    const py = (marco.scrollTop + ay) / zoom;
    if (zoom === 1 && nuevo > 1) {
      marco.style.height = `${marco.clientHeight}px`;
      avisar(matchMedia("(pointer: coarse)").matches ? "Con dos dedos movés y acercás la foto." : "Arrastrá la foto (o usá las barras) para moverte.");
    }
    zoom = nuevo;
    caja.style.width = `${zoom * 100}%`;
    if (zoom === 1) marco.style.height = "";
    marco.scrollLeft = px * zoom - ax;
    marco.scrollTop = py * zoom - ay;
    nivelZoom.textContent = `${zoom % 1 ? zoom.toFixed(1) : zoom}×`;
    btnAlejar.disabled = zoom <= 1;
    btnAcercar.disabled = zoom >= NIVELES_ZOOM[NIVELES_ZOOM.length - 1];
    aplicarModo();
  }

  btnAcercar.addEventListener("click", () => aplicarZoom(NIVELES_ZOOM.find((z) => z > zoom + 0.01) ?? zoom));
  btnAlejar.addEventListener("click", () => aplicarZoom([...NIVELES_ZOOM].reverse().find((z) => z < zoom - 0.01) ?? 1));
  marco.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      aplicarZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    },
    { passive: false },
  );

  // ---------- Tocar y pintar sobre la foto ----------
  function puntoDe(cx: number, cy: number): { x: number; y: number; px: number; py: number } {
    const r = lienzo.getBoundingClientRect();
    return {
      x: ((cx - r.left) * lienzo.width) / r.width,
      y: ((cy - r.top) * lienzo.height) / r.height,
      px: ((cx - r.left) / r.width) * 100,
      py: ((cy - r.top) / r.height) * 100,
    };
  }

  function radioPincel(): number {
    const r = lienzo.getBoundingClientRect();
    return Math.max(0.6, (Number(tamano.value) / 2) * (lienzo.width / r.width));
  }

  function moverAnillo(cx: number, cy: number): void {
    if (!esTrazo()) return;
    const p = puntoDe(cx, cy);
    const d = Number(tamano.value);
    anillo.style.width = anillo.style.height = `${d}px`;
    anillo.style.left = `${p.px}%`;
    anillo.style.top = `${p.py}%`;
    anillo.classList.remove("hidden");
  }

  // Lupa: el dedo tapa lo que se está pintando, así que encima se ve esa zona
  // aumentada, con el círculo del pincel.
  const AUMENTO = 3;
  let lupaEn: { cx: number; cy: number } | null = null;

  function dibujarLupa(): void {
    if (!lupaEn) return;
    const { cx, cy } = lupaEn;
    const lado = 132;
    const r = lienzo.getBoundingClientRect();
    const escala = lienzo.width / r.width;
    const p = puntoDe(cx, cy);
    const fuente = (lado / AUMENTO) * escala;
    const W = lupa.width;
    ctxLupa.save();
    ctxLupa.fillStyle = "#e8e2d8";
    ctxLupa.fillRect(0, 0, W, W);
    ctxLupa.beginPath();
    ctxLupa.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctxLupa.clip();
    ctxLupa.imageSmoothingEnabled = true;
    ctxLupa.drawImage(lienzo, p.x - fuente / 2, p.y - fuente / 2, fuente, fuente, 0, 0, W, W);
    const radio = (Number(tamano.value) / 2) * AUMENTO * (W / lado);
    ctxLupa.lineWidth = 3;
    ctxLupa.strokeStyle = "rgba(26,26,26,.75)";
    ctxLupa.beginPath();
    ctxLupa.arc(W / 2, W / 2, radio, 0, Math.PI * 2);
    ctxLupa.stroke();
    ctxLupa.lineWidth = 1.5;
    ctxLupa.strokeStyle = "#fff";
    ctxLupa.beginPath();
    ctxLupa.arc(W / 2, W / 2, radio, 0, Math.PI * 2);
    ctxLupa.stroke();
    ctxLupa.restore();
    lupa.style.borderColor = modo === "borrador" ? "#fff" : activo?.hex ?? "#fff";
  }

  function moverLupa(cx: number, cy: number): void {
    lupaEn = { cx, cy };
    const lado = 132;
    let x = cx - lado / 2;
    let y = cy - lado - 56;
    if (y < 8) y = cy + 56;
    x = Math.max(8, Math.min(window.innerWidth - lado - 8, x));
    lupa.style.left = `${x}px`;
    lupa.style.top = `${y}px`;
    lupa.classList.remove("hidden");
    dibujarLupa();
  }

  function ocultarLupa(): void {
    lupaEn = null;
    lupa.classList.add("hidden");
  }

  const punteros = new Map<number, { x: number; y: number }>();
  let gesto: { d0: number; z0: number; mx: number; my: number } | null = null;
  let toque: { id: number; x: number; y: number; ux: number; uy: number; movio: boolean } | null = null;
  let trazo: { id: number; tono: Tono | null; borrar: boolean; codigo: string; antes: Paso; ux: number; uy: number } | null = null;

  function cancelarTrazo(): void {
    ocultarLupa();
    if (!trazo || !actual) return;
    restaurar(actual, trazo.antes);
    actual.historial.pop();
    trazo = null;
    redibujar();
  }

  function pincelada(x: number, y: number): void {
    const f = actual;
    if (!f || !trazo || !f.croma) return;
    const t = trazo;
    const w = f.original.width;
    const h = f.original.height;
    const capa = t.borrar ? null : capaDe(f, t.codigo);
    if (capa && capa.ref === undefined) {
      const k = Math.max(0, Math.min(w * h - 1, Math.round(y) * w + Math.round(x)));
      capa.ref = capa.alfa.some((v) => v > 128) ? luzDeReferencia(f.original.data, capa.alfa) : Math.max(0.02, luminanciaLineal(f.original.data, k * 4));
    }
    const otras = f.capas.filter((c) => c !== capa);
    const radio = radioPincel();
    const pasos = Math.max(1, Math.ceil(Math.hypot(x - t.ux, y - t.uy) / Math.max(0.5, radio / 3)));
    for (let i = 1; i <= pasos; i++) {
      const px = t.ux + ((x - t.ux) * i) / pasos;
      const py = t.uy + ((y - t.uy) * i) / pasos;
      const lim = f.limite;
      const r = pincelar(f.croma, w, h, px, py, radio, t.tono, (k, fuerza) => {
        const v = Math.round(fuerza * (lim ? lim[k] : 255));
        if (!v) return;
        if (capa && v > capa.alfa[k]) capa.alfa[k] = v;
        for (const o of otras) if (o.alfa[k]) o.alfa[k] = Math.min(o.alfa[k], 255 - v);
      });
      if (r) redibujarRegion(r);
    }
    t.ux = x;
    t.uy = y;
  }

  function empezarTrazo(e: PointerEvent): void {
    const f = actual!;
    if (modo === "pincel" && !activo) {
      avisar("Primero elegí un color.");
      return;
    }
    f.croma ??= cromaFoto(f.original.data, f.original.width, f.original.height);
    const p = puntoDe(e.clientX, e.clientY);
    const antes = guardarPaso(f);
    ultimaOp = null;
    trazo = {
      id: e.pointerId,
      tono: modo === "pincel" && !f.limite ? tonoEn(f.croma, f.original.width, f.original.height, p.x, p.y) : null,
      borrar: modo === "borrador",
      codigo: activo?.codigo ?? "",
      antes,
      ux: p.x,
      uy: p.y,
    };
    pincelada(p.x, p.y);
    actualizarBotones();
  }

  // ---------- Marcar área ----------
  let lazo: { id: number; pts: { x: number; y: number }[] } | null = null;
  let sombraLimite: { lim: Uint8Array; img: ImageData } | null = null;

  function dibujarLimite(): void {
    const f = actual;
    const W = capaLimite.width;
    const H = capaLimite.height;
    ctxLimite.clearRect(0, 0, W, H);
    if (!f) return;
    const esc = W / f.original.width;
    if (f.limite && sombraLimite?.lim === f.limite && sombraLimite.img.width === W) {
      ctxLimite.putImageData(sombraLimite.img, 0, 0);
    } else if (f.limite) {
      const img = ctxLimite.createImageData(W, H);
      const lim = f.limite;
      const ow = f.original.width;
      const oh = f.original.height;
      for (let y = 0; y < H; y++) {
        const sy = Math.min(oh - 1, Math.floor(y / esc));
        for (let x = 0; x < W; x++) {
          const sx = Math.min(ow - 1, Math.floor(x / esc));
          const a = 255 - lim[sy * ow + sx];
          const i = (y * W + x) * 4;
          img.data[i] = 26;
          img.data[i + 1] = 26;
          img.data[i + 2] = 26;
          img.data[i + 3] = Math.round(a * 0.55);
        }
      }
      ctxLimite.putImageData(img, 0, 0);
      sombraLimite = { lim: f.limite, img };
    }
    if (propuesta && propuesta.f === f && propuesta.img) ctxLimite.drawImage(propuesta.img, 0, 0);
    if (lazo && lazo.pts.length > 1) {
      ctxLimite.save();
      ctxLimite.lineJoin = "round";
      ctxLimite.lineCap = "round";
      ctxLimite.beginPath();
      lazo.pts.forEach((p, i) => (i ? ctxLimite.lineTo(p.x * esc, p.y * esc) : ctxLimite.moveTo(p.x * esc, p.y * esc)));
      ctxLimite.lineWidth = Math.max(2, W / 260);
      ctxLimite.strokeStyle = "rgba(26,26,26,.8)";
      ctxLimite.stroke();
      ctxLimite.setLineDash([Math.max(4, W / 90), Math.max(4, W / 90)]);
      ctxLimite.lineWidth = Math.max(1.2, W / 420);
      ctxLimite.strokeStyle = "#fff";
      ctxLimite.stroke();
      ctxLimite.restore();
    }
  }

  function prepararCapaLimite(f: Foto): void {
    capaLimite.width = Math.ceil(f.original.width / 2);
    capaLimite.height = Math.ceil(f.original.height / 2);
    dibujarLimite();
  }

  function cerrarLazo(): void {
    const f = actual;
    const l = lazo;
    lazo = null;
    if (!f || !l) return;
    const w = f.original.width;
    const h = f.original.height;
    let largo = 0;
    for (let i = 1; i < l.pts.length; i++) largo += Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y);
    if (l.pts.length < 3 || largo < Math.min(w, h) / 25) {
      dibujarLimite();
      avisar("Rodeá la parte que querés pintar: arrastrá el dedo alrededor, sin levantarlo.");
      return;
    }
    const lienzoLazo = document.createElement("canvas");
    lienzoLazo.width = w;
    lienzoLazo.height = h;
    const c = lienzoLazo.getContext("2d", { willReadFrequently: true })!;
    c.fillStyle = "#fff";
    c.beginPath();
    l.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.fill();
    const datos = c.getImageData(0, 0, w, h).data;
    const area = new Uint8Array(w * h);
    for (let k = 0; k < area.length; k++) area[k] = datos[k * 4 + 3];
    modo = modoPrevio === "marcar" || modoPrevio === "quitar" ? "pared" : modoPrevio;
    aplicarModo();
    if (!activo) {
      limitarA(f, area);
      avisar("Área marcada. Elegí un color arriba y tocá adentro, o pasá el pincel fino: la pintura no sale de ahí.");
      return;
    }
    proponer({ f, op: "pared", codigo: activo.codigo, alfa: area, opciones: 1, lazo: true });
  }

  function limitarA(f: Foto, area: Uint8Array): void {
    const lim = f.limite ?? new Uint8Array(area.length);
    for (let k = 0; k < lim.length; k++) if (area[k] > lim[k]) lim[k] = area[k];
    f.limite = lim;
    sombraLimite = null;
    dibujarLimite();
    actualizarBotones();
  }

  btnQuitarLimite.addEventListener("click", () => {
    if (!actual) return;
    actual.limite = undefined;
    dibujarLimite();
    actualizarBotones();
    avisar("Listo, ya podés pintar en toda la foto.");
  });

  function terminarTrazo(): void {
    const f = actual;
    trazo = null;
    if (!f) return;
    f.capas = f.capas.filter((c) => c.alfa.some((v) => v > 8));
    olvidarParejas(f);
    redibujar();
  }

  lienzo.addEventListener("pointerdown", (e) => {
    if (!actual) return;
    try {
      lienzo.setPointerCapture(e.pointerId);
    } catch {}
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 2) {
      cancelarTrazo();
      if (lazo) {
        lazo = null;
        dibujarLimite();
      }
      toque = null;
      const [a, b] = [...punteros.values()];
      gesto = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (punteros.size > 2) return;
    if (modo === "marcar") {
      e.preventDefault();
      const p = puntoDe(e.clientX, e.clientY);
      lazo = { id: e.pointerId, pts: [{ x: p.x, y: p.y }] };
      dibujarLimite();
      return;
    }
    if (esTrazo()) {
      e.preventDefault();
      empezarTrazo(e);
      moverAnillo(e.clientX, e.clientY);
      if (trazo) moverLupa(e.clientX, e.clientY);
    } else {
      toque = { id: e.pointerId, x: e.clientX, y: e.clientY, ux: e.clientX, uy: e.clientY, movio: false };
    }
  });

  lienzo.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && esTrazo()) moverAnillo(e.clientX, e.clientY);
    if (!punteros.has(e.pointerId)) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesto && punteros.size >= 2) {
      const [a, b] = [...punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      marco.scrollLeft -= mx - gesto.mx;
      marco.scrollTop -= my - gesto.my;
      gesto.mx = mx;
      gesto.my = my;
      if (gesto.d0 > 20) aplicarZoom(gesto.z0 * (d / gesto.d0), mx, my);
      return;
    }
    if (lazo && lazo.id === e.pointerId) {
      const p = puntoDe(e.clientX, e.clientY);
      const u = lazo.pts[lazo.pts.length - 1];
      if (Math.hypot(p.x - u.x, p.y - u.y) > 1.5) {
        lazo.pts.push({ x: p.x, y: p.y });
        dibujarLimite();
      }
      return;
    }
    if (trazo && trazo.id === e.pointerId) {
      const p = puntoDe(e.clientX, e.clientY);
      pincelada(p.x, p.y);
      moverAnillo(e.clientX, e.clientY);
      moverLupa(e.clientX, e.clientY);
      return;
    }
    if (toque && toque.id === e.pointerId) {
      if (Math.hypot(e.clientX - toque.x, e.clientY - toque.y) > 8) toque.movio = true;
      if (toque.movio && zoom > 1) {
        marco.scrollLeft -= e.clientX - toque.ux;
        marco.scrollTop -= e.clientY - toque.uy;
      }
      toque.ux = e.clientX;
      toque.uy = e.clientY;
    }
  });

  const soltar = (e: PointerEvent) => {
    punteros.delete(e.pointerId);
    if (gesto) {
      if (punteros.size < 2) gesto = null;
      toque = null;
      return;
    }
    if (lazo && lazo.id === e.pointerId) {
      if (e.type === "pointerup") cerrarLazo();
      else {
        lazo = null;
        dibujarLimite();
      }
      return;
    }
    if (trazo && trazo.id === e.pointerId) {
      ocultarLupa();
      terminarTrazo();
      if (e.pointerType !== "mouse") anillo.classList.add("hidden");
      return;
    }
    if (toque && toque.id === e.pointerId) {
      const t = toque;
      toque = null;
      if (e.type === "pointerup" && !t.movio) void tocarZona(e.clientX, e.clientY);
    }
  };
  lienzo.addEventListener("pointerup", soltar);
  lienzo.addEventListener("pointercancel", soltar);
  lienzo.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !trazo) anillo.classList.add("hidden");
  });

  async function tocarZona(cx: number, cy: number): Promise<void> {
    const f = actual;
    if (!f) return;
    if (!f.lista) {
      avisar("Esperá un momento: todavía estamos preparando la foto.");
      return;
    }
    if (ocupado) return;
    if (modo === "pared" && !activo) {
      avisar("Primero elegí un color.");
      return;
    }
    const p = puntoDe(cx, cy);
    const op = modo;
    const codigo = activo?.codigo ?? "";
    marca.style.left = `${p.px}%`;
    marca.style.top = `${p.py}%`;
    marca.classList.remove("hidden");
    ocupado = true;
    actualizarBotones();
    avisar(op === "pared" ? "Marcando la pared…" : "Marcando lo que vas a quitar…");
    const r = await pedir({ tipo: "zona", clave: f.clave, x: p.x, y: p.y });
    marca.classList.add("hidden");
    ocupado = false;
    if (!fotos.includes(f)) return;
    if (r.tipo !== "zona") {
      if (r.tipo === "sin-foto") {
        f.lista = false;
        void analizar(f);
      }
      avisar("No pudimos marcar esa zona. Probá tocando en otro punto.");
      actualizarBotones();
      return;
    }
    if (f.limite) {
      const lim = f.limite;
      let adentro = false;
      for (let k = 0; k < lim.length && !adentro; k += 7) if (lim[k] > 128 && r.alfa[k] > 128) adentro = true;
      if (!adentro) {
        avisar("Tocaste fuera del área marcada. Tocá adentro, o “Quitar área marcada” para pintar en otro lado.");
        actualizarBotones();
        return;
      }
    }
    proponer({ f, op, codigo, alfa: recortarAlLimite(f, r.alfa), opciones: r.opciones });
  }

  // ---------- Vista previa de la zona antes de pintar ----------
  let propuesta: { f: Foto; op: Modo; codigo: string; alfa: Uint8Array; opciones: number; lazo?: boolean; img?: HTMLCanvasElement } | null = null;

  function recortarAlLimite(f: Foto, alfa: Uint8Array): Uint8Array {
    if (!f.limite) return alfa;
    const lim = f.limite;
    return alfa.map((v, k) => (v * lim[k]) / 255);
  }

  function imagenPropuesta(p: NonNullable<typeof propuesta>): HTMLCanvasElement {
    const W = capaLimite.width;
    const H = capaLimite.height;
    const ow = p.f.original.width;
    const oh = p.f.original.height;
    const esc = W / ow;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const cx = c.getContext("2d")!;
    const img = cx.createImageData(W, H);
    const quitar = p.op === "quitar";
    const muestra = (x: number, y: number) => {
      const sx = Math.min(ow - 1, Math.max(0, Math.floor(x / esc)));
      const sy = Math.min(oh - 1, Math.max(0, Math.floor(y / esc)));
      return p.alfa[sy * ow + sx];
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = muestra(x, y);
        if (a < 40) continue;
        const borde = muestra(x - 1, y) < 128 || muestra(x + 1, y) < 128 || muestra(x, y - 1) < 128 || muestra(x, y + 1) < 128;
        const i = (y * W + x) * 4;
        if (borde && a >= 128) {
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = 255;
        } else {
          img.data[i] = quitar ? 220 : 30;
          img.data[i + 1] = quitar ? 50 : 125;
          img.data[i + 2] = quitar ? 50 : 235;
          img.data[i + 3] = Math.round(a * 0.5);
        }
      }
    }
    cx.putImageData(img, 0, 0);
    return c;
  }

  function proponer(p: NonNullable<typeof propuesta>): void {
    propuesta = p;
    if (actual !== p.f) return;
    p.img = imagenPropuesta(p);
    dibujarLimite();
    const quitar = p.op === "quitar";
    textoPropuesta.textContent = p.lazo
      ? "Lo azul es el área que marcaste. ¿La pintamos toda, o la terminás vos con el pincel?"
      : quitar
        ? "Lo rojo es lo que se va a quitar. ¿Está bien?"
        : "Lo azul es lo que se va a pintar. ¿Está bien?";
    btnPropSi.textContent = p.lazo ? "Pintar toda el área" : quitar ? "Quitar esta zona" : "Pintar esta zona";
    btnPropOtra.classList.toggle("hidden", !!p.lazo);
    btnPropOtra.disabled = p.opciones <= 1;
    btnPropMarcar.textContent = p.lazo ? "Pintar con pincel adentro" : "Marcar a mano";
    btnPropSi.disabled = false;
    cajaPropuesta.classList.remove("hidden");
    requestAnimationFrame(() => {
      const r = cajaPropuesta.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 8) cajaPropuesta.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    avisar(
      p.lazo
        ? "Se pinta exactamente lo que rodeaste. Si te quedó chico o grande, tocá “Cancelar” y volvé a rodearlo."
        : quitar
        ? "Revisá lo marcado en rojo antes de quitarlo."
        : "Revisá lo marcado en azul antes de pintar. Si agarra de más o de menos, probá “Otra forma” o “Marcar a mano”.",
    );
    actualizarBotones();
  }

  function cerrarPropuesta(): void {
    if (!propuesta) return;
    propuesta = null;
    cajaPropuesta.classList.add("hidden");
    dibujarLimite();
    actualizarBotones();
  }

  btnPropSi.addEventListener("click", () => {
    const p = propuesta;
    if (!p || ocupado) return;
    cerrarPropuesta();
    guardarPaso(p.f);
    aplicarZona(p.f, p.op, p.codigo, p.alfa);
    ultimaOp = null;
    if (actual === p.f) redibujar();
    avisar(p.op === "pared" ? "Pintado. Tocá otra parte para seguir, o usá el pincel fino para los detalles." : "Listo, se quitó esa zona.");
  });

  btnPropOtra.addEventListener("click", async () => {
    const p = propuesta;
    if (!p || ocupado) return;
    ocupado = true;
    btnPropOtra.disabled = true;
    btnPropSi.disabled = true;
    textoPropuesta.textContent = "Buscando otra forma…";
    const r = await pedir({ tipo: "otra", clave: p.f.clave });
    ocupado = false;
    if (propuesta !== p) return;
    if (r.tipo === "zona") proponer({ ...p, alfa: recortarAlLimite(p.f, r.alfa), opciones: r.opciones, img: undefined });
    else {
      btnPropOtra.disabled = false;
      btnPropSi.disabled = false;
      textoPropuesta.textContent = p.op === "quitar" ? "Lo rojo es lo que se va a quitar. ¿Está bien?" : "Lo azul es lo que se va a pintar. ¿Está bien?";
      avisar("No hay otra forma para ese toque. Probá “Marcar a mano”.");
    }
  });

  btnPropMarcar.addEventListener("click", () => {
    if (!propuesta) return;
    if (propuesta.lazo) {
      const p = propuesta;
      cerrarPropuesta();
      limitarA(p.f, p.alfa);
      modo = "pincel";
      aplicarModo();
      avisar("Pasá el pincel fino: pinta todo lo que pases, pero solo adentro del área. Para pintar en otro lado, “Quitar área marcada”.");
      return;
    }
    const previo = propuesta.op;
    cerrarPropuesta();
    modoPrevio = previo;
    modo = "marcar";
    aplicarModo();
    avisar(textoModo());
  });

  btnPropNo.addEventListener("click", () => {
    cerrarPropuesta();
    avisar(textoModo());
  });

  // ---------- Varias fotos ----------
  function pintarTira(): void {
    tiraFotos.innerHTML =
      fotos
        .map(
          (f, i) => `
      <div class="probador-mini" data-activa="${f === actual}">
        <button type="button" data-foto="${f.clave}" aria-label="Ver foto ${i + 1}"><img src="${f.mini}" alt="" /></button>
        <button type="button" data-cerrar-foto="${f.clave}" class="probador-mini-x" aria-label="Quitar foto ${i + 1}">×</button>
      </div>`,
        )
        .join("") +
      (fotos.length < MAX_FOTOS
        ? `<label for="probador-archivo-mas" class="probador-mini-mas"><span>+</span>Otra foto</label>`
        : "");
  }

  function mostrarFoto(f: Foto): void {
    actual = f;
    ultimaOp = ultimaOp?.clave === f.clave ? ultimaOp : null;
    mostrandoAntes = false;
    lienzo.width = f.original.width;
    lienzo.height = f.original.height;
    ctx.putImageData(f.vista, 0, 0);
    lazo = null;
    if (propuesta && propuesta.f !== f) cerrarPropuesta();
    prepararCapaLimite(f);
    zoom = 1;
    caja.style.width = "100%";
    marco.style.height = "";
    nivelZoom.textContent = "1×";
    btnAlejar.disabled = true;
    btnAcercar.disabled = false;
    aplicarModo();
    if (f.lista) {
      ocultarEstado();
      avisar(textoModo());
    } else {
      mostrarEstado("Analizando tu foto…", -1, "Puede tardar unos segundos.");
    }
    redibujar();
  }

  tiraFotos.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const cerrar = t.closest("button[data-cerrar-foto]") as HTMLButtonElement | null;
    if (cerrar) {
      const clave = Number(cerrar.dataset.cerrarFoto);
      const f = fotos.find((x) => x.clave === clave);
      if (!f) return;
      fotos = fotos.filter((x) => x !== f);
      if (worker) void pedir({ tipo: "olvidar", clave });
      if (ultimaOp?.clave === clave) ultimaOp = null;
      if (!fotos.length) {
        actual = null;
        ocultarEstado();
        trabajo.classList.add("hidden");
        inicio.classList.remove("hidden");
        archivo.value = "";
        seccion.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (actual === f) mostrarFoto(fotos[fotos.length - 1]);
      else pintarTira();
      return;
    }
    const ver = t.closest("button[data-foto]") as HTMLButtonElement | null;
    if (ver) {
      const f = fotos.find((x) => x.clave === Number(ver.dataset.foto));
      if (f && f !== actual) mostrarFoto(f);
    }
  });

  // ---------- Cargar fotos ----------
  async function abrirImagen(fuente: Blob, sinBitmap = false): Promise<{ img: CanvasImageSource; ancho: number; alto: number }> {
    if (!sinBitmap && "createImageBitmap" in window) {
      try {
        const bm = await createImageBitmap(fuente, { imageOrientation: "from-image" });
        return { img: bm, ancho: bm.width, alto: bm.height };
      } catch {}
    }
    const url = URL.createObjectURL(fuente);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { img, ancho: img.naturalWidth, alto: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function leerFoto(fuente: Blob): Promise<{ datos: ImageData; mini: string } | null> {
    const lamina = document.createElement("canvas");
    const g = lamina.getContext("2d", { willReadFrequently: true })!;
    for (const sinBitmap of [false, true]) {
      try {
        const { img, ancho, alto } = await abrirImagen(fuente, sinBitmap);
        if (!ancho || !alto) continue;
        const escala = Math.min(1, LADO_MAX / Math.max(ancho, alto));
        lamina.width = Math.max(1, Math.round(ancho * escala));
        lamina.height = Math.max(1, Math.round(alto * escala));
        g.drawImage(img, 0, 0, lamina.width, lamina.height);
        (img as ImageBitmap).close?.();
        const datos = g.getImageData(0, 0, lamina.width, lamina.height);
        let tiene = false;
        for (let i = 3; i < datos.data.length; i += 4 * 997) if (datos.data[i] > 0) tiene = true;
        if (!tiene) continue;
        const mini = document.createElement("canvas");
        const em = 160 / Math.max(lamina.width, lamina.height);
        mini.width = Math.round(lamina.width * em);
        mini.height = Math.round(lamina.height * em);
        mini.getContext("2d")!.drawImage(lamina, 0, 0, mini.width, mini.height);
        return { datos, mini: mini.toDataURL("image/jpeg", 0.7) };
      } catch {}
    }
    return null;
  }

  function mostrarError(texto: string): void {
    error.textContent = texto;
    error.classList.remove("hidden");
  }

  async function cargar(fuente: Blob): Promise<void> {
    error.classList.add("hidden");
    if (fotos.length >= MAX_FOTOS) {
      mostrarError(`Podés trabajar con ${MAX_FOTOS} fotos a la vez. Quitá una para agregar otra.`);
      return;
    }
    const leida = await leerFoto(fuente);
    if (!leida) {
      mostrarError("No pudimos abrir esa foto. Probá con otra (JPG o PNG).");
      return;
    }
    const vista = new ImageData(new Uint8ClampedArray(leida.datos.data), leida.datos.width, leida.datos.height);
    const f: Foto = { clave: siguienteClave++, original: leida.datos, vista, capas: [], historial: [], lista: false, mini: leida.mini };
    fotos.push(f);
    inicio.classList.add("hidden");
    trabajo.classList.remove("hidden");
    pintarColores();
    mostrarFoto(f);
    trabajo.scrollIntoView({ behavior: "smooth", block: "start" });
    void analizar(f);
  }

  async function cargarArchivos(lista: FileList | null): Promise<void> {
    const archivos = [...(lista ?? [])];
    if (!archivos.length) return;
    if (archivos.some((a) => !a.type.startsWith("image/"))) {
      mostrarError("Ese archivo no parece una foto. Probá con una imagen JPG o PNG.");
      return;
    }
    const lugar = MAX_FOTOS - fotos.length;
    for (const a of archivos.slice(0, Math.max(0, lugar))) await cargar(a);
    if (archivos.length > lugar) mostrarError(`Podés trabajar con ${MAX_FOTOS} fotos a la vez; se agregaron las primeras ${Math.max(0, lugar)}.`);
  }

  archivo.addEventListener("change", () => {
    void cargarArchivos(archivo.files);
    archivo.value = "";
  });
  archivoMas.addEventListener("change", () => {
    void cargarArchivos(archivoMas.files);
    archivoMas.value = "";
  });

  document.querySelectorAll<HTMLButtonElement>("[data-probador-ejemplo]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        const res = await fetch(`/probador/${b.dataset.probadorEjemplo}.jpg`);
        if (!res.ok) throw new Error();
        await cargar(await res.blob());
      } catch {
        mostrarError("No pudimos abrir la foto de ejemplo. Revisá tu conexión.");
      }
    }),
  );

  // ---------- Descargar ----------
  btnDescargar.addEventListener("click", () => {
    const f = actual;
    if (!f || f.capas.length === 0) return;
    const w = f.vista.width;
    const h = f.vista.height;
    const fila = Math.max(44, Math.round(w / 22));
    const alturaPie = fila * f.capas.length + Math.round(fila * 0.9);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h + alturaPie;
    const g = c.getContext("2d")!;
    g.putImageData(f.vista, 0, 0);
    g.fillStyle = "#fff8f0";
    g.fillRect(0, h, w, alturaPie);
    const margen = Math.round(fila * 0.4);
    f.capas.forEach((capa, i) => {
      const y = h + margen + i * fila;
      g.fillStyle = capa.color.hex;
      g.fillRect(margen, y, fila * 0.8, fila * 0.8);
      g.strokeStyle = "rgba(26,26,26,0.2)";
      g.strokeRect(margen, y, fila * 0.8, fila * 0.8);
      g.fillStyle = "#1a1a1a";
      g.font = `700 ${Math.round(fila * 0.36)}px "Plus Jakarta Sans", system-ui, sans-serif`;
      g.fillText(`${capa.color.nombre} · ${capa.color.codigo}`, margen + fila, y + fila * 0.52);
    });
    g.fillStyle = "#6b6862";
    g.font = `500 ${Math.round(fila * 0.28)}px "Plus Jakarta Sans", system-ui, sans-serif`;
    g.fillText("Súper Color · Colores LANCO · Vista aproximada", margen, h + alturaPie - margen * 0.8);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mi-color-super-color-${fotos.indexOf(f) + 1}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      },
      "image/jpeg",
      0.9,
    );
  });

  aplicarModo();
  pintarColores();
  actualizarBotones();

  return {
    probarColores(colores: ColorEnriquecido[]): void {
      const nuevos = colores.filter(Boolean);
      if (!nuevos.length) return;
      extras = [...nuevos, ...extras.filter((x) => !nuevos.some((n) => n.codigo === x.codigo))];
      activo = nuevos[0];
      if (modo === "borrador" || modo === "quitar") modo = "pared";
      aplicarModo();
      pintarColores();
      if (actual) avisar(textoModo());
      const preparados = document.getElementById("probador-preparados");
      if (preparados) {
        preparados.innerHTML = `<span class="flex -space-x-2">${nuevos
          .map((c) => `<i class="block h-8 w-8 rounded-full border-2 border-white" style="background:${c.hex}"></i>`)
          .join("")}</span><span>${nuevos.length > 1 ? "Tus colores están listos" : `${escapeHtml(nuevos[0].nombre)} está listo`}: subí una foto o elegí una de ejemplo.</span>`;
        preparados.classList.remove("hidden");
        preparados.classList.add("flex");
      }
      (actual ? trabajo : seccion).scrollIntoView({ behavior: "smooth", block: "start" });
    },
  };
}
