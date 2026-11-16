import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hexARgbFoto,
  rgbAHex,
  rgbALab,
  deltaE2000,
  indexarAbanico,
  parecidosEnAbanico,
  ajustarLuz,
  colorDeZona,
  coloresDominantes,
  etiquetaSimilitud,
} from "../src/lib/color-foto.ts";

const abanico = JSON.parse(readFileSync(new URL("../src/data/lanco_colores.json", import.meta.url), "utf8"));

test("hex y rgb son inversos", () => {
  assert.deepEqual(hexARgbFoto("#F6F6EE"), { r: 246, g: 246, b: 238 });
  assert.equal(rgbAHex({ r: 246, g: 246, b: 238 }), "#F6F6EE");
  assert.deepEqual(hexARgbFoto("#fff"), { r: 255, g: 255, b: 255 });
});

test("Lab: blanco, negro y rojo conocidos", () => {
  const blanco = rgbALab({ r: 255, g: 255, b: 255 });
  assert.ok(Math.abs(blanco.l - 100) < 0.1 && Math.abs(blanco.a) < 0.2 && Math.abs(blanco.b) < 0.2);
  const negro = rgbALab({ r: 0, g: 0, b: 0 });
  assert.ok(Math.abs(negro.l) < 0.1);
  const rojo = rgbALab({ r: 255, g: 0, b: 0 });
  assert.ok(Math.abs(rojo.l - 53.24) < 0.3 && Math.abs(rojo.a - 80.09) < 0.5);
});

test("deltaE2000 cumple los pares de referencia de Sharma et al.", () => {
  const par = (l1, a1, b1, l2, a2, b2) => deltaE2000({ l: l1, a: a1, b: b1 }, { l: l2, a: a2, b: b2 });
  assert.ok(Math.abs(par(50, 2.6772, -79.7751, 50, 0, -82.7485) - 2.0425) < 0.001);
  assert.ok(Math.abs(par(50, 3.1571, -77.2803, 50, 0, -82.7485) - 2.8615) < 0.001);
  assert.ok(Math.abs(par(50, 2.5, 0, 50, 0, -2.5) - 4.3065) < 0.001);
  assert.equal(par(60, 10, 10, 60, 10, 10), 0);
});

test("un color del abanico se encuentra a sí mismo primero", () => {
  const indice = indexarAbanico(abanico);
  const elegido = abanico[300];
  const r = parecidosEnAbanico(indice, rgbALab(hexARgbFoto(elegido.hex)), 5);
  assert.equal(r[0].color.codigo, elegido.codigo);
  assert.ok(r[0].de < 0.01);
  assert.equal(r.length, 5);
  assert.ok(r[1].de >= r[0].de);
});

test("un color cercano devuelve opciones del mismo rubro", () => {
  const indice = indexarAbanico(abanico);
  const r = parecidosEnAbanico(indice, rgbALab({ r: 201, g: 162, b: 122 }), 6);
  assert.ok(r[0].de < 8);
  assert.equal(etiquetaSimilitud(2), "Casi igual");
  assert.equal(etiquetaSimilitud(15), "Aproximado");
});

test("ajustarLuz sube o baja la luminosidad con tope", () => {
  const lab = rgbALab({ r: 120, g: 100, b: 90 });
  assert.ok(ajustarLuz(lab, 10).l > lab.l);
  assert.equal(ajustarLuz({ l: 98, a: 0, b: 0 }, 10).l, 100);
  assert.equal(ajustarLuz({ l: 3, a: 0, b: 0 }, -10).l, 0);
});

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

test("colorDeZona usa la mediana y ignora un brillo suelto", () => {
  const d = imagen(20, 20, (x, y) => (x === 10 && y === 10 ? [255, 255, 255] : [180, 140, 100]));
  assert.deepEqual(colorDeZona(d, 20, 20, 10, 10, 5), { r: 180, g: 140, b: 100 });
});

test("coloresDominantes separa una pared beige de un mueble oscuro", () => {
  const d = imagen(100, 100, (x) => (x < 70 ? [200, 170, 130] : [50, 35, 30]));
  const c = coloresDominantes(d, 100, 100, 4);
  assert.ok(c.length >= 2);
  assert.ok(Math.abs(c[0].proporcion - 0.7) < 0.08);
  assert.ok(Math.abs(c[0].rgb.r - 200) < 6 && Math.abs(c[0].rgb.b - 130) < 6);
});
