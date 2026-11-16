// Modal de detalle de un color, en grande: el color ocupa buena parte de la
// pantalla para poder apreciarlo, con flechas (y teclado / deslizar) para
// pasar al anterior o siguiente de la lista que se está viendo, un botón para
// apartarlo y una tira de colores parecidos. Vanilla JS/CSS, sin
// dependencias, mismo estilo que product-modal.ts.
import { escapeHtml } from "./render-utils";
import { coloresParecidos, ETIQUETAS_FAMILIA, textoSobre, type ColorEnriquecido } from "./color-lanco";
import { alCambiarApartados, alternarApartado, estaApartado } from "./colores-apartados";

export interface ContextoModalColor {
  /** Lista que se está viendo en pantalla: define el "anterior / siguiente". */
  lista: ColorEnriquecido[];
  /** Paleta completa, para calcular los colores parecidos. */
  paleta: ColorEnriquecido[];
  alCombinar: (color: ColorEnriquecido) => void;
  /** Se llama cada vez que el modal pasa a mostrar otro color (para que la
   * página de atrás se mantenga sincronizada con lo que se está viendo). */
  alMostrar?: (color: ColorEnriquecido) => void;
  disparador?: HTMLElement;
}

const ICONO_CORAZON_VACIO =
  '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.5 5 6.6 5c1.9 0 3.5 1 4.4 2.5h2C13.9 6 15.5 5 17.4 5c3.1 0 5.2 2.9 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>';
const ICONO_CORAZON_LLENO =
  '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.5 5 6.6 5c1.9 0 3.5 1 4.4 2.5h2C13.9 6 15.5 5 17.4 5c3.1 0 5.2 2.9 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>';

let modalEl: HTMLDivElement | null = null;
let disparadorAnterior: HTMLElement | null = null;
let contexto: ContextoModalColor | null = null;
let colorActual: ColorEnriquecido | null = null;

const q = <T extends HTMLElement>(sel: string): T => modalEl!.querySelector(sel) as T;

function crearModal(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "modal-color";
  el.className = "fixed inset-0 z-[60] hidden items-center justify-center p-3 sm:p-6";
  el.innerHTML = `
    <div data-modal-backdrop class="absolute inset-0 bg-tinta-900/75 backdrop-blur-sm"></div>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-color-titulo"
      class="relative z-10 flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-crema-50 shadow-2xl"
    >
      <div data-modal-swatch class="relative h-[42vh] min-h-[220px] shrink-0 transition-colors duration-200 sm:h-[46vh]">
        <button
          type="button"
          data-modal-cerrar
          aria-label="Cerrar detalle de color"
          class="absolute right-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-crema-50/95 text-tinta-900 shadow-md transition-colors hover:bg-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <button
          type="button"
          data-modal-anterior
          aria-label="Color anterior"
          class="absolute left-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-crema-50/90 text-tinta-900 shadow-md transition-colors hover:bg-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button
          type="button"
          data-modal-siguiente
          aria-label="Color siguiente"
          class="absolute right-3 top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-crema-50/90 text-tinta-900 shadow-md transition-colors hover:bg-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
        <div data-modal-rotulo class="absolute inset-x-0 bottom-0 px-6 pb-5 pt-10">
          <p data-modal-codigo class="font-mono text-sm font-semibold opacity-90"></p>
          <h3 id="modal-color-titulo" data-modal-nombre class="font-display text-3xl font-bold leading-tight sm:text-4xl"></h3>
        </div>
      </div>

      <div class="overflow-y-auto p-5 sm:p-6">
        <div class="flex items-center justify-between gap-3">
          <p data-modal-familia class="text-xs font-semibold uppercase tracking-[0.14em] text-tinta-500"></p>
          <p data-modal-posicion class="text-xs text-tinta-500"></p>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            data-modal-apartar
            class="flex items-center justify-center gap-2 rounded-2xl border-2 border-brand-500 py-3.5 text-sm font-bold text-brand-600 transition-colors hover:bg-brand-50"
          ></button>
          <button
            type="button"
            data-modal-combinar
            class="rounded-2xl bg-brand-500 py-3.5 text-sm font-bold text-crema-50 shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-brand-600"
          >
            Ver ideas para combinarlo
          </button>
        </div>

        <div class="mt-6">
          <p class="text-sm font-bold text-tinta-900">Colores parecidos</p>
          <div data-modal-parecidos class="mt-2.5 grid grid-cols-4 gap-2 sm:grid-cols-8"></div>
        </div>

        <p class="mt-5 rounded-2xl bg-sol-300/25 px-4 py-3 text-xs leading-relaxed text-tinta-700">
          El color en pantalla puede variar un poco del color real -cada pantalla lo muestra distinto-. Confirmalo con el abanico físico en tienda.
        </p>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.querySelector("[data-modal-cerrar]")?.addEventListener("click", cerrarModalColor);
  el.querySelector("[data-modal-backdrop]")?.addEventListener("click", cerrarModalColor);
  el.querySelector("[data-modal-anterior]")?.addEventListener("click", () => moverColor(-1));
  el.querySelector("[data-modal-siguiente]")?.addEventListener("click", () => moverColor(1));

  el.querySelector("[data-modal-apartar]")?.addEventListener("click", () => {
    if (colorActual) alternarApartado(colorActual.codigo);
  });
  el.querySelector("[data-modal-combinar]")?.addEventListener("click", () => {
    if (colorActual && contexto) contexto.alCombinar(colorActual);
    cerrarModalColor();
  });
  el.querySelector("[data-modal-parecidos]")?.addEventListener("click", (e) => {
    const boton = (e.target as HTMLElement).closest("button[data-codigo]") as HTMLButtonElement | null;
    if (!boton || !contexto) return;
    const color = contexto.paleta.find((c) => c.codigo === boton.dataset.codigo);
    if (color) mostrarColor(color);
  });

  document.addEventListener("keydown", (e) => {
    if (!modalEl || modalEl.classList.contains("hidden")) return;
    if (e.key === "Escape") cerrarModalColor();
    else if (e.key === "ArrowLeft") moverColor(-1);
    else if (e.key === "ArrowRight") moverColor(1);
  });

  // Deslizar el color a izquierda/derecha para pasar al siguiente/anterior.
  let inicioX = 0;
  const swatch = el.querySelector("[data-modal-swatch]") as HTMLElement;
  swatch.addEventListener("touchstart", (e) => {
    inicioX = e.changedTouches[0].clientX;
  }, { passive: true });
  swatch.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - inicioX;
    if (Math.abs(dx) > 50) moverColor(dx < 0 ? 1 : -1);
  }, { passive: true });

  alCambiarApartados(() => {
    if (modalEl && !modalEl.classList.contains("hidden")) actualizarBotonApartar();
  });
  return el;
}

function actualizarBotonApartar(): void {
  if (!colorActual) return;
  const apartado = estaApartado(colorActual.codigo);
  const boton = q<HTMLButtonElement>("[data-modal-apartar]");
  boton.innerHTML = `${apartado ? ICONO_CORAZON_LLENO : ICONO_CORAZON_VACIO}<span>${apartado ? "Apartado - quitar" : "Apartar este color"}</span>`;
  boton.className = apartado
    ? "flex items-center justify-center gap-2 rounded-2xl border-2 border-brand-500 bg-brand-500 py-3.5 text-sm font-bold text-crema-50 transition-colors hover:bg-brand-600"
    : "flex items-center justify-center gap-2 rounded-2xl border-2 border-brand-500 py-3.5 text-sm font-bold text-brand-600 transition-colors hover:bg-brand-50";
}

function mostrarColor(color: ColorEnriquecido): void {
  if (!modalEl || !contexto) return;
  colorActual = color;

  const swatch = q<HTMLElement>("[data-modal-swatch]");
  swatch.style.background = color.hex;
  const rotulo = q<HTMLElement>("[data-modal-rotulo]");
  rotulo.style.color = textoSobre(color.hex);
  q<HTMLElement>("[data-modal-nombre]").textContent = color.nombre;
  q<HTMLElement>("[data-modal-codigo]").textContent = color.codigo;
  q<HTMLElement>("[data-modal-familia]").textContent = ETIQUETAS_FAMILIA[color.familia];

  const indice = contexto.lista.findIndex((c) => c.codigo === color.codigo);
  const posicion = q<HTMLElement>("[data-modal-posicion]");
  posicion.textContent = indice >= 0 ? `${indice + 1} de ${contexto.lista.length}` : "";
  const hayNavegacion = indice >= 0 && contexto.lista.length > 1;
  q<HTMLElement>("[data-modal-anterior]").classList.toggle("hidden", !hayNavegacion);
  q<HTMLElement>("[data-modal-siguiente]").classList.toggle("hidden", !hayNavegacion);

  q<HTMLElement>("[data-modal-parecidos]").innerHTML = coloresParecidos(color, contexto.paleta, 8)
    .map(
      (c) => `
      <button type="button" data-codigo="${escapeHtml(c.codigo)}" title="${escapeHtml(c.nombre)} · ${escapeHtml(c.codigo)}" aria-label="${escapeHtml(c.nombre)}, ${escapeHtml(c.codigo)}"
        class="aspect-square rounded-xl border border-tinta-900/10 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        style="background:${c.hex}"></button>`,
    )
    .join("");

  actualizarBotonApartar();
  contexto.alMostrar?.(color);
}

function moverColor(paso: number): void {
  if (!contexto || !colorActual) return;
  const lista = contexto.lista;
  const indice = lista.findIndex((c) => c.codigo === colorActual!.codigo);
  if (indice < 0 || lista.length < 2) return;
  mostrarColor(lista[(indice + paso + lista.length) % lista.length]);
}

export function abrirModalColor(color: ColorEnriquecido, ctx: ContextoModalColor): void {
  if (!modalEl) modalEl = crearModal();
  contexto = ctx;
  disparadorAnterior = ctx.disparador ?? (document.activeElement as HTMLElement | null) ?? null;
  mostrarColor(color);

  modalEl.classList.remove("hidden");
  modalEl.classList.add("flex");
  document.body.classList.add("overflow-hidden");
  q<HTMLElement>("[data-modal-cerrar]").focus();
}

export function cerrarModalColor(): void {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  modalEl.classList.remove("flex");
  // Si hay otro panel abierto por debajo (p. ej. "Mi selección"), el scroll
  // de la página debe seguir bloqueado.
  if (!document.querySelector("[data-bloquea-scroll]:not(.hidden)")) {
    document.body.classList.remove("overflow-hidden");
  }
  disparadorAnterior?.focus();
  disparadorAnterior = null;
}
