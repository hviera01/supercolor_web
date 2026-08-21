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
  horarioAtencion?: string;
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
  setTexto("[data-footer-horario]", datos.horarioAtencion);

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
    setEnlace("whatsapp", enlaceWhatsapp(datos.whatsapp));
  }
}

// Honduras: números locales tienen 8 dígitos y necesitan el código de país
// 504 para que wa.me abra el chat correctamente.
export function enlaceWhatsapp(numero: string, mensaje?: string): string {
  let digitos = numero.replace(/[^\d]/g, "");
  if (digitos.length === 8) digitos = `504${digitos}`;
  const texto = mensaje ? `?text=${encodeURIComponent(mensaje)}` : "";
  return `https://wa.me/${digitos}${texto}`;
}

// Convención de atajos de WhatsApp usada en toda la página: cualquier elemento marcado
// con [data-whatsapp-link] recibe un href real de wa.me, con el mensaje precargado que
// traiga en [data-whatsapp-mensaje] (si trae alguno). El markup siempre debe traer un
// href="/contacto" estático de respaldo, por si Firestore o el script fallan.
// Se exporta para que páginas con contenido armado en su propio <script> (p. ej. las
// tarjetas de servicios, insertadas después de su propio fetch a Firestore) puedan
// volver a aplicarla sobre los elementos que insertaron, no solo sobre el HTML estático
// que ya existía cuando corrió initSiteChrome.
export function aplicarEnlacesWhatsapp(numero?: string) {
  if (!numero || !numero.trim()) return;
  document.querySelectorAll<HTMLAnchorElement>("[data-whatsapp-link]").forEach((el) => {
    el.href = enlaceWhatsapp(numero, el.dataset.whatsappMensaje);
    el.target = "_blank";
    el.rel = "noopener";
  });
}

export async function initSiteChrome() {
  const { data: config } = await fetchConfiguracion();
  if (!config) return;
  aplicarMarca(config.nombre, config.logoUrl);
  aplicarFooter(config);
  aplicarEnlacesWhatsapp(config.whatsapp);
}
