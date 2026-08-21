// Modal/lightbox de detalle de producto, compartido entre la grilla de /productos
// y las tarjetas de categoría del inicio. Vanilla JS/CSS, sin dependencias — mismo
// enfoque que el resto del sitio (ver render-utils.ts, productos.astro).
import { colorPorIndice, degradadoPorIndice, escapeHtml, paintCanHtml } from "./render-utils";

export interface DetalleProducto {
  nombre: string;
  descripcion?: string;
  categoria?: string;
  disponibilidad?: string;
  imagenUrl?: string;
  /** Usado solo cuando no hay imagenUrl, para elegir el color de la lata ilustrada. */
  indiceColor?: number;
}

let modalEl: HTMLDivElement | null = null;
let disparadorAnterior: HTMLElement | null = null;

function crearModal(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "modal-producto";
  el.className = "fixed inset-0 z-50 hidden items-center justify-center p-4";
  el.innerHTML = `
    <div data-modal-backdrop class="absolute inset-0 bg-tinta-900/70 backdrop-blur-sm"></div>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-producto-titulo"
      class="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-crema-50 shadow-2xl"
    >
      <button
        type="button"
        data-modal-cerrar
        aria-label="Cerrar detalle de producto"
        class="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-full bg-crema-50 text-tinta-900 shadow-md transition-colors hover:bg-crema-200"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div data-modal-imagen class="relative flex h-64 items-center justify-center overflow-hidden sm:h-80"></div>
      <div class="p-7">
        <span data-modal-categoria class="hidden rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-600"></span>
        <h3 id="modal-producto-titulo" data-modal-nombre class="mt-3 font-display text-2xl font-bold text-tinta-900"></h3>
        <p data-modal-descripcion class="mt-3 text-sm leading-relaxed text-tinta-500"></p>
        <p data-modal-disponibilidad class="mt-4 hidden rounded-2xl bg-menta-300/15 px-4 py-3 text-sm font-semibold leading-relaxed text-menta-700"></p>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.querySelector("[data-modal-cerrar]")?.addEventListener("click", cerrarModalProducto);
  el.querySelector("[data-modal-backdrop]")?.addEventListener("click", cerrarModalProducto);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl && !modalEl.classList.contains("hidden")) {
      cerrarModalProducto();
    }
  });
  return el;
}

export function abrirModalProducto(detalle: DetalleProducto, disparador?: HTMLElement): void {
  if (!modalEl) modalEl = crearModal();
  disparadorAnterior = disparador ?? (document.activeElement as HTMLElement | null) ?? null;

  const nombre = detalle.nombre || "Producto Súper Color";
  const indice = detalle.indiceColor ?? 0;

  const cajaImagen = modalEl.querySelector("[data-modal-imagen]") as HTMLElement;
  if (detalle.imagenUrl) {
    cajaImagen.className = "relative flex h-64 items-center justify-center overflow-hidden bg-crema-100 p-8 sm:h-80";
    cajaImagen.innerHTML = `<img src="${escapeHtml(detalle.imagenUrl)}" alt="${escapeHtml(nombre)}" class="max-h-full max-w-full object-contain" />`;
  } else {
    cajaImagen.className = `relative flex h-64 items-center justify-center overflow-hidden ${degradadoPorIndice(indice)} sm:h-80`;
    cajaImagen.innerHTML = paintCanHtml(colorPorIndice(indice), { size: "lg", hover: false });
  }

  const elCategoria = modalEl.querySelector("[data-modal-categoria]") as HTMLElement;
  if (detalle.categoria) {
    elCategoria.textContent = detalle.categoria;
    elCategoria.classList.remove("hidden");
  } else {
    elCategoria.classList.add("hidden");
  }

  (modalEl.querySelector("[data-modal-nombre]") as HTMLElement).textContent = nombre;
  (modalEl.querySelector("[data-modal-descripcion]") as HTMLElement).textContent = detalle.descripcion || "";

  const elDisponibilidad = modalEl.querySelector("[data-modal-disponibilidad]") as HTMLElement;
  if (detalle.disponibilidad) {
    elDisponibilidad.textContent = detalle.disponibilidad;
    elDisponibilidad.classList.remove("hidden");
  } else {
    elDisponibilidad.classList.add("hidden");
  }

  modalEl.classList.remove("hidden");
  modalEl.classList.add("flex");
  document.body.classList.add("overflow-hidden");
  (modalEl.querySelector("[data-modal-cerrar]") as HTMLElement | null)?.focus();
}

export function cerrarModalProducto(): void {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  modalEl.classList.remove("flex");
  document.body.classList.remove("overflow-hidden");
  disparadorAnterior?.focus();
  disparadorAnterior = null;
}
