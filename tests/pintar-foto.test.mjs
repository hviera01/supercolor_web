import test from "node:test";
import assert from "node:assert/strict";
import {
  aLineal,
  aSrgb,
  cajaPromedio,
  combinarZonas,
  cromaFoto,
  filtrarPorTono,
  luzDeReferencia,
  ordenarOpciones,
  pintarCapas,
} from "../src/lib/pintar-foto.ts";

function imagen(ancho, alto, pintar) {
  const d = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pintar(x, y);
      const i = (y * ancho + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  return d;
}

test("sRGB y lineal son inversos", () => {
  for (const v of [0, 1, 10, 128, 200, 255]) assert.equal(aSrgb(aLineal(v)), v);
});

test("cajaPromedio de una imagen pareja no la cambia", () => {
  const e = new Float32Array(50 * 40).fill(0.3);
  const s = cajaPromedio(e, 50, 40, 5);
  assert.ok(s.every((v) => Math.abs(v - 0.3) < 1e-5));
});

test("a plena luz la pared queda exactamente del color del abanico", () => {
  const w = 40, h = 30;
  const foto = imagen(w, h, () => [200, 190, 180]);
  const alfa = new Uint8Array(w * h).fill(255);
  const dst = new Uint8ClampedArray(foto.length);
  pintarCapas(foto, [{ color: { r: 149, g: 96, b: 84 }, alfa }], dst);
  assert.deepEqual([dst[0], dst[1], dst[2]], [149, 96, 84]);
});

test("la sombra de la foto se conserva al pintar", () => {
  const w = 40, h = 30;
  const foto = imagen(w, h, (x) => (x < 30 ? [220, 220, 220] : [110, 110, 110]));
  const alfa = new Uint8Array(w * h).fill(255);
  const dst = new Uint8ClampedArray(foto.length);
  pintarCapas(foto, [{ color: { r: 90, g: 140, b: 200 }, alfa }], dst);
  const luz = (k) => 0.2126 * aLineal(dst[k * 4]) + 0.7152 * aLineal(dst[k * 4 + 1]) + 0.0722 * aLineal(dst[k * 4 + 2]);
  assert.deepEqual([dst[0], dst[1], dst[2]], [90, 140, 200]);
  const proporcionFoto = aLineal(110) / aLineal(220);
  assert.ok(Math.abs(luz(35) / luz(0) - proporcionFoto) < 0.02);
});

test("lo que no está marcado queda igual", () => {
  const w = 10, h = 10;
  const foto = imagen(w, h, (x, y) => [x * 20, y * 20, 100]);
  const dst = new Uint8ClampedArray(foto.length);
  pintarCapas(foto, [{ color: { r: 255, g: 0, b: 0 }, alfa: new Uint8Array(w * h) }], dst);
  assert.deepEqual(Array.from(dst), Array.from(foto));
});

test("luzDeReferencia toma la parte iluminada de la pared", () => {
  const w = 20, h = 10;
  const foto = imagen(w, h, (x) => (x < 16 ? [200, 200, 200] : [40, 40, 40]));
  const alfa = new Uint8Array(w * h).fill(255);
  assert.ok(Math.abs(luzDeReferencia(foto, alfa) - aLineal(200)) < 0.01);
});

test("combinarZonas suma y resta", () => {
  const a = Uint8Array.from([255, 255, 0, 0]);
  const b = Uint8Array.from([0, 128, 255, 0]);
  const quitar = Uint8Array.from([0, 255, 0, 0]);
  assert.deepEqual(Array.from(combinarZonas([a, b], [quitar], 4)), [255, 0, 255, 0]);
});

test("filtrarPorTono deja afuera una puerta de madera pegada a la pared", () => {
  const w = 60, h = 40;
  const foto = imagen(w, h, (x, y) => {
    if (x >= 20 && x < 35) return [180, 130, 70];
    return y > 25 ? [150, 75, 60] : [230, 115, 90];
  });
  const croma = cromaFoto(foto, w, h);
  const todo = new Float32Array(w * h).fill(1);
  const { mascara } = filtrarPorTono(todo, croma, w, h, 5, 10);
  assert.equal(mascara[10 * w + 5], 1);
  assert.equal(mascara[30 * w + 5], 1, "la parte en sombra de la pared sí se pinta");
  assert.equal(mascara[10 * w + 25], 0, "la puerta no se pinta");
  assert.equal(mascara[10 * w + 50], 0, "la pared del otro lado de la puerta queda separada: se pinta con otro toque");
});

test("ordenarOpciones prefiere la forma de un solo tono con mejor puntaje", () => {
  const w = 40, h = 20;
  const foto = imagen(w, h, (x) => (x < 20 ? [230, 115, 90] : [180, 130, 70]));
  const croma = cromaFoto(foto, w, h);
  const pared = new Float32Array(w * h).map((_, k) => (k % w < 20 ? 1 : 0));
  const todo = new Float32Array(w * h).fill(1);
  const orden = ordenarOpciones([todo, pared], [0.97, 0.9], croma, w, h, 5, 5);
  assert.equal(orden[0], 1);
});
