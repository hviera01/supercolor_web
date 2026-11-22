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
  luzPareja,
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
  const w = 300, h = 400;
  const foto = imagen(w, h, (x, y) => {
    if (x >= 100 && x < 175) return [180, 130, 70];
    const t = Math.min(1, Math.max(0, (y - 200) / 10));
    return [230 - 80 * t, 115 - 40 * t, 90 - 30 * t];
  });
  const croma = cromaFoto(foto, w, h);
  const todo = new Float32Array(w * h).fill(1);
  const { mascara } = filtrarPorTono(todo, croma, w, h, 25, 100);
  assert.equal(mascara[100 * w + 25], 1);
  assert.equal(mascara[300 * w + 25], 1, "la parte en sombra de la pared sí se pinta");
  assert.equal(mascara[100 * w + 125], 0, "la puerta no se pinta");
  assert.equal(mascara[100 * w + 250], 0, "la pared del otro lado de la puerta queda separada: se pinta con otro toque");
});

test("filtrarPorTono no pasa a un recuadro de otro tono de luz ni a una cerámica con dibujo", () => {
  const w = 120, h = 90;
  const foto = imagen(w, h, (x, y) => {
    if (y >= 60) return (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? [150, 105, 92] : [128, 88, 78];
    if (x >= 40 && x < 80 && y >= 15 && y < 50) return [215, 190, 172];
    return [140, 98, 85];
  });
  const croma = cromaFoto(foto, w, h);
  const todo = new Float32Array(w * h).fill(1);
  const { mascara } = filtrarPorTono(todo, croma, w, h, 20, 30);
  assert.equal(mascara[30 * w + 20], 1, "la columna tocada se pinta");
  assert.equal(mascara[30 * w + 100], 1, "la otra columna, unida por arriba, también");
  assert.equal(mascara[30 * w + 60], 0, "el recuadro claro no");
  assert.equal(mascara[75 * w + 60], 0, "la cerámica del zócalo no");
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

test("el pincel fino no se sale a la superficie de al lado", async () => {
  const { pincelar, tonoEn } = await import("../src/lib/pintar-foto.ts");
  const w = 40, h = 20;
  const foto = imagen(w, h, (x) => (x < 20 ? [240, 240, 235] : [190, 90, 70]));
  const croma = cromaFoto(foto, w, h);
  const tono = tonoEn(croma, w, h, 25, 10);
  const marcados = new Set();
  pincelar(croma, w, h, 20, 10, 8, tono, (k) => marcados.add(k));
  assert.ok(marcados.has(10 * w + 24), "pinta el detalle donde empezó");
  assert.ok(!marcados.has(10 * w + 15), "no pinta la pared blanca de al lado");
  const sinLimite = new Set();
  pincelar(croma, w, h, 20, 10, 8, null, (k) => sinLimite.add(k));
  assert.ok(sinLimite.has(10 * w + 15), "el borrador no tiene límite de tono");
});

test("el pincel respeta la sombra de la misma superficie", async () => {
  const { pincelar, tonoEn } = await import("../src/lib/pintar-foto.ts");
  const w = 40, h = 20;
  const foto = imagen(w, h, (x) => (x < 20 ? [200, 100, 80] : [120, 60, 48]));
  const croma = cromaFoto(foto, w, h);
  const tono = tonoEn(croma, w, h, 10, 10);
  const marcados = new Set();
  pincelar(croma, w, h, 20, 10, 6, tono, (k) => marcados.add(k));
  assert.ok(marcados.has(10 * w + 24), "la parte en sombra también se pinta");
});

test("repintar una región da lo mismo que repintar todo", () => {
  const w = 30, h = 20;
  const foto = imagen(w, h, (x, y) => [100 + x * 3, 120 + y * 2, 140]);
  const alfa = new Uint8Array(w * h);
  for (let k = 0; k < alfa.length; k++) if (k % w > 10) alfa[k] = 255;
  const capas = [{ color: { r: 40, g: 150, b: 90 }, alfa, ref: 0.4 }];
  const todo = new Uint8ClampedArray(foto.length);
  pintarCapas(foto, capas, todo);
  const parcial = new Uint8ClampedArray(foto);
  pintarCapas(foto, capas, parcial, w, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
  assert.deepEqual(Array.from(parcial), Array.from(todo));
});

test("disimular desperfectos empareja lo pelado y conserva la sombra", () => {
  const w = 600, h = 600;
  const foto = imagen(w, h, (x, y) => {
    if (x >= 100 && x < 140 && y >= 60 && y < 100) return [235, 228, 215];
    if (y >= 420) return [120, 70, 50];
    return [200, 120, 90];
  });
  const alfa = new Uint8Array(w * h).fill(255);
  const { luz } = luzPareja(foto, alfa, w, h);
  const pared = luz[30 * w + 30];
  const pelado = luz[80 * w + 120];
  const sombra = luz[520 * w + 300];
  assert.ok(Math.abs(Math.log(pelado / pared)) < 0.1, `lo pelado queda como la pared (${pelado} vs ${pared})`);
  assert.ok(sombra < pared * 0.5, "la sombra se mantiene");
});
