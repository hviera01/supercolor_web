// Lectura en vivo del contenido público desde Firestore (colecciones que administra
// el panel de administración en Flutter). Todo se consulta desde el navegador, en
// cada carga de página — el sitio estático no necesita rebuild para reflejar cambios.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

export interface ConfiguracionSitio {
  nombre?: string;
  eslogan?: string;
  descripcion?: string;
  telefono?: string;
  whatsapp?: string;
  correo?: string;
  direccionPrincipal?: string;
  horarioAtencion?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  logoUrl?: string;
}

export interface Sucursal {
  id: string;
  nombre?: string;
  direccion?: string;
  telefono?: string;
  horario?: string;
  mapaUrl?: string;
  latitud?: number;
  longitud?: number;
  fotoUrl?: string;
  orden?: number;
  activo?: boolean;
}

export interface ProductoDestacado {
  id: string;
  nombre?: string;
  descripcion?: string;
  categoria?: string;
  imagenUrl?: string;
  orden?: number;
  activo?: boolean;
}

export interface Servicio {
  id: string;
  titulo?: string;
  descripcion?: string;
  iconoUrl?: string;
  orden?: number;
  activo?: boolean;
}

export interface PromocionSitio {
  id: string;
  titulo?: string;
  descripcion?: string;
  imagenUrl?: string;
  fechaInicio?: unknown;
  fechaFin?: unknown;
  activo?: boolean;
}

export interface FetchResult<T> {
  data: T[];
  error: boolean;
}

/** Convierte un Timestamp de Firestore (o string/Date) a Date, o null si no se puede. */
function aFecha(valor: unknown): Date | null {
  if (!valor) return null;
  if (typeof valor === "object" && valor !== null && "toDate" in valor) {
    try {
      return (valor as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(valor as string | number);
  return isNaN(d.getTime()) ? null : d;
}

export function ordenarPorCampo<T extends { orden?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

async function fetchActivos<T>(coleccion: string): Promise<FetchResult<T>> {
  try {
    const col = collection(db, coleccion);
    const q = query(col, where("activo", "==", true));
    const snap = await getDocs(q);
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
    return { data, error: false };
  } catch (e) {
    console.error(`No se pudo cargar la colección "${coleccion}":`, e);
    return { data: [], error: true };
  }
}

export async function fetchConfiguracion(): Promise<{ data: ConfiguracionSitio | null; error: boolean }> {
  try {
    const snap = await getDoc(doc(db, "configuracionSitio", "negocio"));
    return { data: snap.exists() ? (snap.data() as ConfiguracionSitio) : null, error: false };
  } catch (e) {
    console.error('No se pudo cargar "configuracionSitio/negocio":', e);
    return { data: null, error: true };
  }
}

export async function fetchSucursales(): Promise<FetchResult<Sucursal>> {
  const res = await fetchActivos<Sucursal>("sucursales");
  return { ...res, data: ordenarPorCampo(res.data) };
}

export async function fetchProductosDestacados(): Promise<FetchResult<ProductoDestacado>> {
  const res = await fetchActivos<ProductoDestacado>("productosDestacados");
  return { ...res, data: ordenarPorCampo(res.data) };
}

export async function fetchServicios(): Promise<FetchResult<Servicio>> {
  const res = await fetchActivos<Servicio>("servicios");
  return { ...res, data: ordenarPorCampo(res.data) };
}

/** Promociones activas cuya fechaFin (si existe) todavía no ha pasado. */
export async function fetchPromocionesVigentes(): Promise<FetchResult<PromocionSitio>> {
  const res = await fetchActivos<PromocionSitio>("promocionesSitio");
  if (res.error) return res;
  const ahora = new Date();
  const vigentes = res.data.filter((p) => {
    const fin = aFecha(p.fechaFin);
    return !fin || fin.getTime() >= ahora.getTime();
  });
  return { data: vigentes, error: false };
}

export { aFecha };
