// Colores que el cliente aparta mientras explora el abanico. Se guardan solo
// en su navegador (localStorage), sin cuenta ni servidor: sirven para ir
// armando una lista de favoritos y mandarla por WhatsApp o llevarla a tienda.
const CLAVE = "sc-colores-apartados";

let codigos: string[] = [];
const oyentes = new Set<() => void>();

function cargar(): void {
  try {
    const crudo = localStorage.getItem(CLAVE);
    const lista = crudo ? JSON.parse(crudo) : [];
    codigos = Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string") : [];
  } catch {
    codigos = [];
  }
}

function guardar(): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(codigos));
  } catch {
    // Sin almacenamiento (modo privado, etc.): la lista sigue viva en memoria
    // mientras la página esté abierta.
  }
  oyentes.forEach((fn) => fn());
}

cargar();

export function apartados(): string[] {
  return [...codigos];
}

export function estaApartado(codigo: string): boolean {
  return codigos.includes(codigo);
}

export function alternarApartado(codigo: string): boolean {
  const i = codigos.indexOf(codigo);
  if (i >= 0) codigos.splice(i, 1);
  else codigos.push(codigo);
  guardar();
  return i < 0;
}

export function quitarApartado(codigo: string): void {
  const i = codigos.indexOf(codigo);
  if (i < 0) return;
  codigos.splice(i, 1);
  guardar();
}

export function vaciarApartados(): void {
  codigos = [];
  guardar();
}

export function alCambiarApartados(fn: () => void): void {
  oyentes.add(fn);
}
