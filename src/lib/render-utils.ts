// Utilidades compartidas para pintar contenido de Firestore en el DOM desde
// scripts de página simples (sin framework de UI).

export function escapeHtml(valor: unknown): string {
  const str = valor === null || valor === undefined ? "" : String(valor);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Paleta de degradados de marca, para ciclar cuando el contenido real no trae uno propio. */
export const DEGRADADOS = [
  "bg-gradient-to-br from-brand-500 to-brand-700",
  "bg-gradient-to-br from-cielo-400 to-cielo-600",
  "bg-gradient-to-br from-menta-400 to-menta-600",
  "bg-gradient-to-br from-fiesta-400 to-fiesta-600",
  "bg-gradient-to-br from-mandarina-400 to-mandarina-600",
  "bg-gradient-to-br from-sol-400 to-sol-600",
];

export const COLORES_SOLIDOS = [
  "bg-brand-500",
  "bg-cielo-500",
  "bg-menta-500",
  "bg-fiesta-500",
  "bg-mandarina-500",
  "bg-sol-500",
];

export function degradadoPorIndice(i: number): string {
  return DEGRADADOS[i % DEGRADADOS.length];
}

export function colorPorIndice(i: number): string {
  return COLORES_SOLIDOS[i % COLORES_SOLIDOS.length];
}

/** Bloque "col-span-full" con el mismo lenguaje visual del sitio, para secciones sin contenido todavía. */
export function estadoVacioHtml(mensaje = "Estamos actualizando esta sección, vuelve pronto."): string {
  return `
    <div class="col-span-full flex flex-col items-center gap-3 rounded-3xl border border-dashed border-tinta-900/15 bg-crema-50 px-8 py-16 text-center">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-500">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <p class="font-display text-lg font-bold text-tinta-900">${escapeHtml(mensaje)}</p>
      <p class="max-w-sm text-sm leading-relaxed text-tinta-500">
        Estamos cargando esta sección con contenido nuevo. Mientras tanto, escríbenos y con gusto te ayudamos directamente.
      </p>
      <a href="/contacto" class="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:text-brand-700">
        Contáctanos
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
      </a>
    </div>`;
}

export function estadoErrorHtml(): string {
  return `
    <div class="col-span-full flex flex-col items-center gap-3 rounded-3xl border border-dashed border-tinta-900/15 bg-crema-50 px-8 py-16 text-center">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-mandarina-50 text-mandarina-500">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
        </svg>
      </span>
      <p class="font-display text-lg font-bold text-tinta-900">No pudimos cargar esta sección ahora mismo.</p>
      <p class="max-w-sm text-sm leading-relaxed text-tinta-500">
        Puede ser tu conexión a internet. Escríbenos directamente mientras tanto.
      </p>
      <a href="/contacto" class="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:text-brand-700">
        Contáctanos
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
      </a>
    </div>`;
}

/** Esqueleto de carga inicial (mientras Firestore responde), con la forma de una tarjeta. */
export function esqueletoTarjetas(cantidad: number, altoClase = "h-72"): string {
  return Array.from({ length: cantidad })
    .map(
      () =>
        `<div class="animate-pulse overflow-hidden rounded-3xl border border-tinta-900/5 bg-crema-50 shadow-sm ${altoClase}">
          <div class="h-1/2 bg-tinta-900/5"></div>
        </div>`,
    )
    .join("");
}

export function flechaSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>`;
}
