// Modal de detalle de un color -mismo patrón visual que product-modal.ts
// (vanilla JS/CSS, sin dependencias). El detalle es simple (swatch, código,
// nombre) más un botón que lleva al combinador de la misma página con este
// color ya elegido -las ideas de combinación viven en una sola herramienta
// central (ver colores.astro), no repetidas dentro del modal.
import { escapeHtml } from "./render-utils";
import type { ColorEnriquecido } from "./color-lanco";

let modalEl: HTMLDivElement | null = null;
let disparadorAnterior: HTMLElement | null = null;
let onCombinar: ((color: ColorEnriquecido) => void) | null = null;

function crearModal(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "modal-color";
  el.className = "fixed inset-0 z-50 hidden items-center justify-center p-4";
  el.innerHTML = `
    <div data-modal-backdrop class="absolute inset-0 bg-tinta-900/70 backdrop-blur-sm"></div>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-color-titulo"
      class="relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-crema-50 shadow-2xl"
    >
      <button
        type="button"
        data-modal-cerrar
        aria-label="Cerrar detalle de color"
        class="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-full bg-crema-50 text-tinta-900 shadow-md transition-colors hover:bg-crema-200"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div data-modal-swatch class="h-36"></div>
      <div class="p-7">
        <h3 id="modal-color-titulo" data-modal-nombre class="font-display text-2xl font-bold text-tinta-900"></h3>
        <p data-modal-codigo class="mt-1 font-mono text-sm text-tinta-500"></p>
        <p class="mt-4 rounded-2xl bg-sol-300/25 px-4 py-3 text-xs leading-relaxed text-tinta-700">
          El color en pantalla puede variar un poco del color real -confirmalo con el abanico físico en tienda.
        </p>
        <button
          type="button"
          data-modal-combinar
          class="mt-5 w-full rounded-2xl bg-brand-500 py-3.5 text-sm font-bold text-crema-50 shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-brand-600"
        >
          Ver ideas para combinarlo
        </button>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.querySelector("[data-modal-cerrar]")?.addEventListener("click", cerrarModalColor);
  el.querySelector("[data-modal-backdrop]")?.addEventListener("click", cerrarModalColor);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl && !modalEl.classList.contains("hidden")) {
      cerrarModalColor();
    }
  });
  return el;
}

let colorActual: ColorEnriquecido | null = null;

export function abrirModalColor(color: ColorEnriquecido, alCombinar: (color: ColorEnriquecido) => void, disparador?: HTMLElement): void {
  if (!modalEl) modalEl = crearModal();
  disparadorAnterior = disparador ?? (document.activeElement as HTMLElement | null) ?? null;
  colorActual = color;
  onCombinar = alCombinar;

  (modalEl.querySelector("[data-modal-swatch]") as HTMLElement).style.background = color.hex;
  (modalEl.querySelector("[data-modal-nombre]") as HTMLElement).textContent = color.nombre;
  (modalEl.querySelector("[data-modal-codigo]") as HTMLElement).textContent = color.codigo;

  const botonCombinar = modalEl.querySelector("[data-modal-combinar]") as HTMLElement;
  botonCombinar.onclick = () => {
    if (colorActual && onCombinar) onCombinar(colorActual);
    cerrarModalColor();
  };

  modalEl.classList.remove("hidden");
  modalEl.classList.add("flex");
  document.body.classList.add("overflow-hidden");
  (modalEl.querySelector("[data-modal-cerrar]") as HTMLElement | null)?.focus();
}

export function cerrarModalColor(): void {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  modalEl.classList.remove("flex");
  document.body.classList.remove("overflow-hidden");
  disparadorAnterior?.focus();
  disparadorAnterior = null;
}
