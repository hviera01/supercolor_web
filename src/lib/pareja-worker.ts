// Calcula "Disimular desperfectos" fuera de la pantalla para que no se trabe
// mientras se empareja la pared (tarda uno o dos segundos en un celular).
import { luzPareja } from "./pintar-foto";

const ctx = self as unknown as Worker;

ctx.onmessage = (e) => {
  const { id, rgba, alfa, otras, ancho, alto } = e.data;
  const { luz, relleno } = luzPareja(rgba, alfa, ancho, alto, otras);
  ctx.postMessage({ id, luz, relleno }, [luz.buffer, relleno.buffer]);
};
