// Aplica configuracionSitio (nombre/logo del nav, datos de contacto y redes del footer)
// a cada página. Se ejecuta desde BaseLayout, así corre en todas las páginas por igual.
// Si Firestore falla o el documento está vacío, simplemente no se toca nada y el sitio
// se queda con el texto de marca por defecto (Súper Color) — nunca una pantalla rota.
import { fetchConfiguracion } from "./content";
import { escapeHtml } from "./render-utils";

function aplicarMarca(nombre?: string, logoUrl?: string) {
  if (nombre && nombre.trim()) {
    document.querySelectorAll<HTMLElement>("[data-brand-name]").forEach((el) => {
      el.textContent = nombre.trim();
    });
  }
  if (logoUrl && logoUrl.trim()) {
    document.querySelectorAll<HTMLElement>("[data-brand-icon-slot]").forEach((el) => {
      el.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(nombre || "Súper Color")}" class="h-10 w-10 rounded-full object-cover" />`;
    });
  }
}

function aplicarFooter(datos: {
  direccionPrincipal?: string;
  telefono?: string;
  correo?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  whatsapp?: string;
}) {
  const setTexto = (selector: string, valor?: string) => {
    if (!valor || !valor.trim()) return;
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      el.textContent = valor.trim();
    });
  };
  setTexto("[data-footer-direccion]", datos.direccionPrincipal);
  setTexto("[data-footer-telefono]", datos.telefono);
  setTexto("[data-footer-correo]", datos.correo);

  const setEnlace = (attr: string, url?: string) => {
    if (!url || !url.trim()) return;
    document.querySelectorAll<HTMLAnchorElement>(`[data-social="${attr}"]`).forEach((el) => {
      el.href = url.trim();
      el.target = "_blank";
      el.rel = "noopener";
      el.classList.remove("hidden");
      el.classList.add("grid");
    });
  };
  setEnlace("facebook", datos.facebookUrl);
  setEnlace("instagram", datos.instagramUrl);
  if (datos.whatsapp && datos.whatsapp.trim()) {
    const digitos = datos.whatsapp.replace(/[^\d]/g, "");
    if (digitos) setEnlace("whatsapp", `https://wa.me/${digitos}`);
  }
}

export async function initSiteChrome() {
  const { data: config } = await fetchConfiguracion();
  if (!config) return;
  aplicarMarca(config.nombre, config.logoUrl);
  aplicarFooter(config);
}
