// Modal de detalle de un color del abanico -mismo patrón visual que
// product-modal.ts (vanilla JS/CSS, sin dependencias), contenido distinto:
// el swatch grande, código/nombre, y las ideas de combinación reales.
import { escapeHtml } from "./render-utils";
import { ideasCombinacion, type ColorPaleta } from "./color-aproximado";

let modalEl: HTMLDivElement | null = null;
let disparadorAnterior: HTMLElement | null = null;

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
      class="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-crema-50 shadow-2xl"
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
      <div data-modal-swatch class="relative flex h-40 items-end overflow-hidden p-6 sm:h-48"></div>
      <div class="p-7">
        <span data-modal-base class="rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-600"></span>
        <h3 id="modal-color-titulo" data-modal-nombre class="mt-3 font-display text-2xl font-bold text-tinta-900"></h3>
        <p data-modal-codigo class="mt-1 font-mono text-sm text-tinta-500"></p>
        <p class="mt-4 rounded-2xl bg-sol-300/25 px-4 py-3 text-xs leading-relaxed text-tinta-700">
          El color real en la pared puede variar de esto -es un cálculo aproximado a partir de la fórmula de tinte, no un escaneo oficial, y además cada pantalla lo muestra distinto. Para el color exacto, mira el abanico físico en la tienda.
        </p>
        <div data-modal-ideas class="mt-6 space-y-3"></div>
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

function ideaHtml(idea: { color: ColorPaleta; titulo: string; descripcion: string }): string {
  return `
    <div class="flex items-start gap-3 rounded-2xl border border-tinta-900/5 bg-crema-100 p-3">
      <span class="mt-0.5 h-10 w-10 shrink-0 rounded-xl border border-tinta-900/10" style="background:${idea.color.hex}"></span>
      <div>
        <p class="text-xs font-bold uppercase tracking-wide text-brand-600">${escapeHtml(idea.titulo)}</p>
        <p class="mt-1 text-sm leading-relaxed text-tinta-700">${escapeHtml(idea.descripcion)}</p>
      </div>
    </div>`;
}

export function abrirModalColor(color: ColorPaleta, paleta: ColorPaleta[], disparador?: HTMLElement): void {
  if (!modalEl) modalEl = crearModal();
  disparadorAnterior = disparador ?? (document.activeElement as HTMLElement | null) ?? null;

  (modalEl.querySelector("[data-modal-swatch]") as HTMLElement).style.background = color.hex;
  (modalEl.querySelector("[data-modal-base]") as HTMLElement).textContent = color.formula.base;
  (modalEl.querySelector("[data-modal-nombre]") as HTMLElement).textContent = color.formula.nombre;
  (modalEl.querySelector("[data-modal-codigo]") as HTMLElement).textContent = color.formula.codigo;

  const ideas = ideasCombinacion(color, paleta);
  (modalEl.querySelector("[data-modal-ideas]") as HTMLElement).innerHTML = ideas.map(ideaHtml).join("");

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
