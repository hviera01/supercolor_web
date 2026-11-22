// Probador de colores en fotos reales: el cliente sube una foto (o usa una de
// ejemplo), elige un color del abanico y toca la pared. El detector marca la
// pared exacta y se pinta conservando la luz y las sombras de la foto.
import type { ColorEnriquecido } from "./color-lanco";
import { hexARgbFoto } from "./color-foto";
import { apartados, alCambiarApartados } from "./colores-apartados";
import { escapeHtml } from "./render-utils";
import { pintarCapas } from "./pintar-foto";

interface Capa {
  color: ColorEnriquecido;
  alfa: Uint8Array;
}

type Modo = "pintar" | "quitar";

interface Paso {
  capas: { codigo: string; alfa: Uint8Array }[];
}

export interface Probador {
  probarColores(colores: ColorEnriquecido[]): void;
}

const LADO_MAX = 1280;
const MAX_HISTORIAL = 12;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function iniciarProbador(paleta: ColorEnriquecido[], porCodigo: Map<string, ColorEnriquecido>): Probador {
  const seccion = $("probador");
  const inicio = $("probador-inicio");
  const archivo = $<HTMLInputElement>("probador-archivo");
  const trabajo = $("probador-trabajo");
  const lienzo = $<HTMLCanvasElement>("probador-canvas");
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
  const btnDeshacer = $<HTMLButtonElement>("probador-deshacer");
  const btnOtra = $<HTMLButtonElement>("probador-otra");
  const btnAntes = $<HTMLButtonElement>("probador-antes");
  const btnDescargar = $<HTMLButtonElement>("probador-descargar");
  const btnOtraFoto = $<HTMLButtonElement>("probador-otra-foto");
  const error = $("probador-error");
  const ctx = lienzo.getContext("2d", { willReadFrequently: true })!;

  let worker: Worker | null = null;
  let siguienteId = 1;
  const pendientes = new Map<number, (m: any) => void>();

  let original: ImageData | null = null;
  let vista: ImageData | null = null;
  let fotoId = 0;
  let lista = false;
  let ocupado = false;
  let capas: Capa[] = [];
  let historial: Paso[] = [];
  let ultimaOp: { modo: Modo; codigo: string; antes: Paso; opciones: number } | null = null;
  let modo: Modo = "pintar";
  let extras: ColorEnriquecido[] = [];
  let activo: ColorEnriquecido | null = null;
  let mostrandoAntes = false;
  let ultimaFoto: { rgba: Uint8ClampedArray; ancho: number; alto: number } | null = null;

  function crearWorker(): Worker {
    const w = new Worker(new URL("./probador-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progreso") {
        mostrarEstado(
          `Preparando el detector de paredes… ${m.porcentaje}%`,
          m.porcentaje,
          "Se descarga una sola vez; después queda guardado.",
        );
        return;
      }
      if (m.tipo === "analizando") {
        mostrarEstado("Analizando tu foto…", -1, "Esto tarda unos segundos.");
        return;
      }
      const fn = pendientes.get(m.id);
      if (fn) {
        pendientes.delete(m.id);
        fn(m);
      }
    };
    w.onerror = () => fallo("No pudimos iniciar el detector en este navegador.");
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
    lista = false;
    estado.classList.remove("hidden");
    estado.classList.add("flex");
    estadoTexto.textContent = texto;
    estadoBarra.parentElement!.classList.add("hidden");
    estadoReintentar.classList.remove("hidden");
  }

  function avisar(texto: string): void {
    aviso.textContent = texto;
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
    capas.forEach((c) => agregar(c.color));
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
    modo = "pintar";
    aplicarModo();
    pintarColores();
    avisar(activo ? `Tocá la pared que querés pintar de ${activo.nombre}.` : "");
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
    modo = "pintar";
    aplicarModo();
    pintarColores();
    avisar(`Tocá la pared que querés pintar de ${c.nombre}.`);
  });

  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t !== buscar && !sugerencias.contains(t)) sugerencias.classList.add("hidden");
  });

  alCambiarApartados(pintarColores);

  // ---------- Herramientas ----------
  function aplicarModo(): void {
    botonesModo.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.probadorModo === modo)));
    lienzo.style.cursor = modo === "pintar" ? "crosshair" : "not-allowed";
  }

  botonesModo.forEach((b) =>
    b.addEventListener("click", () => {
      modo = b.dataset.probadorModo as Modo;
      aplicarModo();
      avisar(modo === "quitar" ? "Tocá lo que no querés pintar (una puerta, un mueble, un marco…)." : activo ? `Tocá la pared que querés pintar de ${activo.nombre}.` : "Elegí un color.");
    }),
  );

  function actualizarBotones(): void {
    btnDeshacer.disabled = historial.length === 0 || ocupado;
    btnOtra.disabled = !ultimaOp || ultimaOp.opciones < 2 || ocupado;
    btnDescargar.disabled = capas.length === 0;
    btnAntes.disabled = capas.length === 0;
  }

  function foto(): Paso {
    return { capas: capas.map((c) => ({ codigo: c.color.codigo, alfa: c.alfa.slice() })) };
  }

  function restaurar(paso: Paso): void {
    capas = paso.capas
      .map((c) => ({ color: porCodigo.get(c.codigo)!, alfa: c.alfa.slice() }))
      .filter((c) => c.color);
  }

  function guardarPaso(): Paso {
    const p = foto();
    historial.push(p);
    if (historial.length > MAX_HISTORIAL) historial.shift();
    return p;
  }

  function aplicarZona(op: Modo, codigo: string, zona: Uint8Array): void {
    for (const c of capas) {
      if (op === "pintar" && c.color.codigo === codigo) continue;
      const a = c.alfa;
      for (let k = 0; k < a.length; k++) if (zona[k]) a[k] = (a[k] * (255 - zona[k])) / 255;
    }
    if (op === "pintar") {
      let capa = capas.find((c) => c.color.codigo === codigo);
      if (!capa) {
        capa = { color: porCodigo.get(codigo)!, alfa: new Uint8Array(zona.length) };
        capas.push(capa);
      }
      const a = capa.alfa;
      for (let k = 0; k < a.length; k++) if (zona[k] > a[k]) a[k] = zona[k];
    }
    capas = capas.filter((c) => c.alfa.some((v) => v > 8));
  }

  function redibujar(): void {
    if (!original || !vista) return;
    pintarCapas(
      original.data,
      capas.map((c) => ({ color: hexARgbFoto(c.color.hex), alfa: c.alfa })),
      vista.data,
    );
    if (!mostrandoAntes) ctx.putImageData(vista, 0, 0);
    pintarUsados();
    actualizarBotones();
  }

  function pintarUsados(): void {
    usados.innerHTML = capas.length
      ? capas
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
          .join("")
      : "";
    usados.classList.toggle("hidden", capas.length === 0);
  }

  usados.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button[data-quitar-color]") as HTMLButtonElement | null;
    if (!b) return;
    guardarPaso();
    ultimaOp = null;
    capas = capas.filter((c) => c.color.codigo !== b.dataset.quitarColor);
    redibujar();
  });

  btnDeshacer.addEventListener("click", () => {
    const p = historial.pop();
    if (!p) return;
    restaurar(p);
    ultimaOp = null;
    redibujar();
  });

  btnOtra.addEventListener("click", async () => {
    if (!ultimaOp || ocupado) return;
    const op = ultimaOp;
    ocupado = true;
    actualizarBotones();
    avisar("Probando otra forma…");
    const r = await pedir({ tipo: "otra" });
    ocupado = false;
    if (r.tipo === "zona" && ultimaOp === op) {
      restaurar(op.antes);
      aplicarZona(op.modo, op.codigo, r.alfa);
      redibujar();
      avisar("¿Así está mejor? Podés tocar “Otra forma” de nuevo o seguir pintando.");
    }
    actualizarBotones();
  });

  const verAntes = (si: boolean) => {
    if (!original || !vista || capas.length === 0) return;
    mostrandoAntes = si;
    ctx.putImageData(si ? original : vista, 0, 0);
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

  // ---------- Tocar la foto ----------
  function puntoDe(e: MouseEvent): { x: number; y: number; px: number; py: number } {
    const caja = lienzo.getBoundingClientRect();
    return {
      x: ((e.clientX - caja.left) * lienzo.width) / caja.width,
      y: ((e.clientY - caja.top) * lienzo.height) / caja.height,
      px: ((e.clientX - caja.left) / caja.width) * 100,
      py: ((e.clientY - caja.top) / caja.height) * 100,
    };
  }

  lienzo.addEventListener("click", async (e) => {
    if (!original) return;
    if (!lista) {
      avisar("Esperá un momento: todavía estamos preparando la foto.");
      return;
    }
    if (ocupado) return;
    if (modo === "pintar" && !activo) {
      avisar("Primero elegí un color.");
      return;
    }
    const p = puntoDe(e);
    const op = modo;
    const codigo = activo?.codigo ?? "";
    const id = fotoId;
    marca.style.left = `${p.px}%`;
    marca.style.top = `${p.py}%`;
    marca.classList.remove("hidden");
    ocupado = true;
    actualizarBotones();
    avisar(op === "pintar" ? "Marcando la pared…" : "Marcando lo que vas a quitar…");
    const r = await pedir({ tipo: "zona", x: p.x, y: p.y });
    marca.classList.add("hidden");
    ocupado = false;
    if (id !== fotoId) return;
    if (r.tipo !== "zona") {
      avisar("No pudimos marcar esa zona. Probá tocando en otro punto.");
      actualizarBotones();
      return;
    }
    const antes = guardarPaso();
    aplicarZona(op, codigo, r.alfa);
    ultimaOp = { modo: op, codigo, antes, opciones: r.opciones };
    redibujar();
    avisar(
      op === "pintar"
        ? "Si no quedó bien, tocá “Otra forma”. Para sumar más pared, tocá otra parte."
        : "Listo. Si quitó de más, tocá “Otra forma” o “Deshacer”.",
    );
  });

  // ---------- Cargar fotos ----------
  async function abrirImagen(fuente: Blob): Promise<{ img: CanvasImageSource; ancho: number; alto: number }> {
    if ("createImageBitmap" in window) {
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

  async function cargar(fuente: Blob): Promise<void> {
    error.classList.add("hidden");
    try {
      const { img, ancho, alto } = await abrirImagen(fuente);
      const escala = Math.min(1, LADO_MAX / Math.max(ancho, alto));
      lienzo.width = Math.max(1, Math.round(ancho * escala));
      lienzo.height = Math.max(1, Math.round(alto * escala));
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      original = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      vista = ctx.createImageData(lienzo.width, lienzo.height);
      vista.data.set(original.data);
    } catch {
      error.textContent = "No pudimos abrir esa foto. Probá con otra (JPG o PNG).";
      error.classList.remove("hidden");
      return;
    }
    capas = [];
    historial = [];
    ultimaOp = null;
    lista = false;
    fotoId++;
    inicio.classList.add("hidden");
    trabajo.classList.remove("hidden");
    pintarColores();
    pintarUsados();
    actualizarBotones();
    avisar(activo ? `Cuando termine de cargar, tocá la pared que querés pintar de ${activo.nombre}.` : "Elegí un color y tocá la pared.");
    trabajo.scrollIntoView({ behavior: "smooth", block: "start" });
    ultimaFoto = { rgba: new Uint8ClampedArray(original!.data), ancho: lienzo.width, alto: lienzo.height };
    await analizar();
  }

  async function analizar(): Promise<void> {
    if (!ultimaFoto) return;
    const id = fotoId;
    mostrarEstado("Preparando el detector de paredes…", 0);
    const copia = new Uint8ClampedArray(ultimaFoto.rgba);
    const r = await pedir({ tipo: "foto", rgba: copia, ancho: ultimaFoto.ancho, alto: ultimaFoto.alto }, [copia.buffer]);
    if (id !== fotoId) return;
    if (r.tipo === "lista") {
      seccion.dataset.motor = r.motor;
      lista = true;
      ocultarEstado();
      avisar(activo ? `Listo: tocá la pared que querés pintar de ${activo.nombre}.` : "Listo: elegí un color y tocá la pared.");
    } else {
      fallo("No pudimos cargar el detector de paredes. Revisá tu conexión a internet e intentá de nuevo.");
    }
  }

  estadoReintentar.addEventListener("click", () => {
    worker?.terminate();
    worker = null;
    pendientes.clear();
    void analizar();
  });

  archivo.addEventListener("change", () => {
    const f = archivo.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      error.textContent = "Ese archivo no parece una foto. Probá con una imagen JPG o PNG.";
      error.classList.remove("hidden");
      return;
    }
    void cargar(f);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-probador-ejemplo]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        const res = await fetch(`/probador/${b.dataset.probadorEjemplo}.jpg`);
        if (!res.ok) throw new Error();
        await cargar(await res.blob());
      } catch {
        error.textContent = "No pudimos abrir la foto de ejemplo. Revisá tu conexión.";
        error.classList.remove("hidden");
      }
    }),
  );

  btnOtraFoto.addEventListener("click", () => {
    archivo.value = "";
    fotoId++;
    original = null;
    vista = null;
    capas = [];
    historial = [];
    ultimaOp = null;
    lista = false;
    ocultarEstado();
    trabajo.classList.add("hidden");
    inicio.classList.remove("hidden");
    seccion.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- Descargar ----------
  btnDescargar.addEventListener("click", () => {
    if (!vista || capas.length === 0) return;
    const w = vista.width;
    const h = vista.height;
    const fila = Math.max(44, Math.round(w / 22));
    const alturaPie = fila * capas.length + Math.round(fila * 0.9);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h + alturaPie;
    const g = c.getContext("2d")!;
    g.putImageData(vista, 0, 0);
    g.fillStyle = "#fff8f0";
    g.fillRect(0, h, w, alturaPie);
    const margen = Math.round(fila * 0.4);
    capas.forEach((capa, i) => {
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
        a.download = "mi-color-super-color.jpg";
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
      modo = "pintar";
      aplicarModo();
      pintarColores();
      if (original) avisar(`Tocá la pared que querés pintar de ${activo.nombre}.`);
      seccion.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  };
}
