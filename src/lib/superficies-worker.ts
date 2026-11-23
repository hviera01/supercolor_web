/// <reference lib="webworker" />
// Arma las zonas a partir de los contornos de Claude fuera de la pantalla
// (ajustar los bordes tarda uno o dos segundos en un celular).
import { cromaFoto } from "./pintar-foto";
import { limpiarSuperficies, mapaDeSuperficies } from "./superficies";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e) => {
  const { id, rgba, ancho, alto, datos, escalaX, escalaY } = e.data;
  try {
    const lista = limpiarSuperficies(datos, escalaX, escalaY);
    const mapa = mapaDeSuperficies(lista, cromaFoto(rgba, ancho, alto), ancho, alto);
    ctx.postMessage({ id, lista, etiquetas: mapa.etiquetas }, [mapa.etiquetas.buffer]);
  } catch (err) {
    ctx.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
