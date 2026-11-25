// Tests de gestures.js:  node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { GestureController, HandShape, Hysteresis, VERSIONS, palmFacing, fingerRatio, FINGERS, isTimeOut, isCrossed } from "../gestures.js";
import { makeHand, OPEN, FIST, POINT } from "./hands.mjs";

const FPS = 30;
const DT = 1000 / FPS;

// Ejecuta el controlador sobre una secuencia de fotogramas y devuelve las acciones con su instante
function run(ctrl, frames, t0 = 0) {
  const out = [];
  frames.forEach((f, i) => {
    const t = t0 + i * DT;
    const r = ctrl.update({ right: f.right ?? null, left: f.left ?? null, t });
    for (const a of r.actions) out.push({ ...a, t });
  });
  return out;
}
const repeat = (n, frame) => Array.from({ length: n }, (_, i) => (typeof frame === "function" ? frame(i) : frame));
const right = (pose, opts = {}) => makeHand({ hand: "Right", ...pose, ...opts });
const left = (pose, opts = {}) => makeHand({ hand: "Left", ...pose, ...opts });

// --- Formas de la mano ------------------------------------------------------------
test("posturas: palma abierta, puño e índice", () => {
  const shape = new HandShape("Right");
  assert.equal(shape.update(right(OPEN), 4 / 3).pose, "open");
  shape.reset();
  assert.equal(shape.update(right(FIST), 4 / 3).pose, "fist");
  shape.reset();
  assert.equal(shape.update(right(POINT), 4 / 3).pose, "point");
});

test("dedo extendido ≈ 1,35 y doblado ≈ 0,7 (cociente punta/PIP respecto a la muñeca)", () => {
  const open = right(OPEN).world;
  const fist = right(FIST).world;
  const [tip, pip] = FINGERS.index;
  assert.ok(fingerRatio(open, tip, pip) > 1.25);
  assert.ok(fingerRatio(fist, tip, pip) < 0.95);
});

test("las medidas no cambian con la distancia a la cámara", () => {
  const near = new HandShape("Right").update(right(OPEN, { scale: 3 }), 4 / 3);
  const far = new HandShape("Right").update(right(OPEN, { scale: 0.8 }), 4 / 3);
  assert.equal(near.pose, far.pose);
  assert.ok(Math.abs(near.ratios.index - far.ratios.index) < 1e-9);
});

test("orientación de la palma: signo según la mano", () => {
  assert.ok(palmFacing(right(OPEN).world, "Right") > 0.9);
  assert.ok(palmFacing(right(OPEN, { facing: "back" }).world, "Right") < -0.9);
  assert.ok(palmFacing(left(OPEN).world, "Left") > 0.9);
  assert.ok(palmFacing(left(OPEN, { facing: "back" }).world, "Left") < -0.9);
});

test("palma abierta muy inclinada no cuenta como 'dedos hacia arriba'", () => {
  const shape = new HandShape("Right");
  assert.equal(shape.update(right(OPEN, { tilt: Math.PI / 2.2 }), 4 / 3).pose, "none");
});

test("histéresis: un valor que oscila cerca del umbral no hace parpadear el estado", () => {
  const values = [1.3, 1.17, 1.2, 1.17, 1.2, 1.17];
  const withH = new Hysteresis({ on: 1.25, off: 1.12, above: true });
  const without = new Hysteresis({ on: 1.25, off: 1.12, above: true });
  const a = values.map((v) => withH.update(v, true));
  const b = values.map((v) => without.update(v, false));
  assert.deepEqual(a, [true, true, true, true, true, true]);
  const changes = b.slice(1).filter((s, i) => s !== b[i]).length;
  assert.ok(changes >= 4); // sin histéresis cambia en casi cada fotograma
});

// --- Activación ------------------------------------------------------------------
const palmStill = (n) => repeat(n, { right: right(OPEN) });

test("activación: palma quieta 1 s activa el mando una vez", () => {
  const ctrl = new GestureController();
  const acts = run(ctrl, palmStill(45)); // 1,5 s
  const activations = acts.filter((a) => a.type === "activar");
  assert.equal(activations.length, 1);
  assert.ok(activations[0].t >= 1000 && activations[0].t < 1100);
});

test("activación: con el dorso de la mano no se activa", () => {
  const ctrl = new GestureController();
  const acts = run(ctrl, repeat(45, { right: right(OPEN, { facing: "back" }) }));
  assert.equal(acts.length, 0);
});

test("el mando se desactiva a los 5 s sin órdenes", () => {
  const ctrl = new GestureController();
  run(ctrl, palmStill(35));
  const r = ctrl.update({ right: null, left: null, t: 35 * DT + 5200 });
  assert.equal(r.mode.active, false);
});

// --- Avanzar / retroceder ----------------------------------------------------------
// La persona mueve la mano hacia SU derecha: en los datos (sin espejo) x disminuye
function swipe(direction, n = 10, from = 0.6, dist = 0.25) {
  const sign = direction === "persona-derecha" ? -1 : 1;
  return repeat(n, (i) => ({ right: right(OPEN, { x: from + (sign * dist * i) / (n - 1) }) }));
}

test("avanzar: palma hacia la derecha de la persona → +10 s; izquierda → −10 s", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  assert.deepEqual(run(ctrl, swipe("persona-derecha")).map((a) => a.value), [10]);
  ctrl.reset();
  assert.deepEqual(run(ctrl, swipe("persona-izquierda")).map((a) => a.value), [-10]);
});

test("versión final: sin activar, el gesto de avanzar no hace nada", () => {
  const ctrl = new GestureController();
  assert.equal(run(ctrl, swipe("persona-derecha")).length, 0);
});

test("versión final: activar y avanzar; la vuelta de la mano no retrocede", () => {
  const ctrl = new GestureController();
  // La mano parte de donde estaba al activar (x = 0,5), avanza y vuelve
  const frames = [...palmStill(33), ...swipe("persona-derecha", 8, 0.5), ...swipe("persona-izquierda", 12, 0.25)];
  const acts = run(ctrl, frames);
  assert.deepEqual(acts.map((a) => a.type + (a.value ?? "")), ["activar", "seek10"]);
});

test("sin defensas: la vuelta de la mano provoca un retroceso no deseado", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  const acts = run(ctrl, [...swipe("persona-derecha", 8, 0.6), ...swipe("persona-izquierda", 12, 0.35)]);
  assert.deepEqual(acts.map((a) => a.value), [10, -10]);
});

test("un gesto rápido con fotogramas perdidos a mitad (desenfoque) se reconoce igual", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  const frames = swipe("persona-derecha", 12, 0.6, 0.25).map((f, i) => (i === 5 || i === 6 ? { right: null } : f));
  assert.deepEqual(run(ctrl, frames).map((a) => a.value), [10]);
});

test("un movimiento lento (gesticular) no avanza", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  assert.equal(run(ctrl, swipe("persona-derecha", 90, 0.6, 0.25)).length, 0); // 0,25 en 3 s
});

test("un movimiento vertical con la palma no avanza", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  const frames = repeat(10, (i) => ({ right: right(OPEN, { y: 0.8 - (0.3 * i) / 9 }) }));
  assert.equal(run(ctrl, frames).length, 0);
});

// --- Cerrar --------------------------------------------------------------------------
test("cerrar: con defensas hay que mantener el puño 0,7 s; se dispara una sola vez", () => {
  const ctrl = new GestureController();
  const acts = run(ctrl, [...palmStill(33), ...repeat(40, { right: right(FIST) })]);
  const closes = acts.filter((a) => a.type === "close");
  assert.equal(closes.length, 1);
  assert.ok(closes[0].latencyMs >= 700);
});

test("cerrar sin defensas: primer fotograma con puño", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  const acts = run(ctrl, repeat(10, { right: right(FIST) }));
  assert.equal(acts.length, 1);
  assert.equal(acts[0].t, 0);
});

test("un puño breve (0,3 s, p. ej. coger algo) no cierra en la versión final", () => {
  const ctrl = new GestureController();
  const acts = run(ctrl, [...palmStill(33), ...repeat(9, { right: right(FIST) }), ...repeat(10, { right: right(POINT) })]);
  assert.equal(acts.filter((a) => a.type === "close").length, 0);
});

// --- Volumen ---------------------------------------------------------------------------
function volumeMove(dir, withLeftPalm = true, n = 12) {
  const sign = dir === "up" ? -1 : 1;
  return repeat(n, (i) => ({
    right: right(POINT, { y: 0.7 + (sign * 0.25 * i) / (n - 1), x: 0.4 }),
    left: withLeftPalm ? left(OPEN, { x: 0.75 }) : null,
  }));
}

test("volumen: índice derecho + palma izquierda; subir → +0,1, bajar → −0,1", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  assert.deepEqual(run(ctrl, volumeMove("up")).map((a) => a.value), [0.1]);
  ctrl.reset();
  assert.deepEqual(run(ctrl, volumeMove("down")).map((a) => a.value), [-0.1]);
});

test("volumen: sin la palma izquierda, señalar y mover el índice no cambia el volumen", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas });
  assert.equal(run(ctrl, volumeMove("up", false)).length, 0);
});

// --- Gestos propios ---------------------------------------------------------------------
test("gestos propios: se definen con una condición y heredan las defensas", () => {
  const ctrl = new GestureController({
    customGestures: [{ name: "prueba", action: "togglePause", test: (R) => R?.pose === "point", holdMs: 500 }],
  });
  const acts = run(ctrl, [...palmStill(33), ...repeat(20, { right: right(POINT) })]);
  const custom = acts.filter((a) => a.type === "custom");
  assert.equal(custom.length, 1);
  assert.equal(custom[0].action, "togglePause");
});

// --- Gestos propios: T (pausar) y X (silenciar) -------------------------------------------
const A = 4 / 3;
const summary = (hand) => new HandShape(hand.name).update(hand, A);

// T: mano izquierda horizontal (dedos hacia la izquierda de la imagen) a la altura 0,45;
// derecha vertical con la punta del corazón tocándola por debajo
const tHorizontal = () => left(OPEN, { x: 0.65, y: 0.45, tilt: -Math.PI / 2 });
const tVertical = () => right(OPEN, { x: 0.5, y: 0.45 + 0.182 * 2 });
// X: dos manos abiertas, muñecas juntas, inclinadas hacia lados opuestos
const xRight = () => right(OPEN, { x: 0.47, y: 0.75, tilt: 0.7 });
const xLeft = () => left(OPEN, { x: 0.53, y: 0.75, tilt: -0.7 });

test("T: se reconoce (y también con las manos intercambiadas)", () => {
  assert.equal(isTimeOut(summary(tVertical()), summary(tHorizontal())), true);
  const hR = right(OPEN, { x: 0.35, y: 0.45, tilt: Math.PI / 2 });
  const vL = left(OPEN, { x: 0.5, y: 0.45 + 0.182 * 2 });
  assert.equal(isTimeOut(summary(hR), summary(vL)), true);
});

test("T: dos palmas hacia arriba separadas no son una T", () => {
  assert.equal(isTimeOut(summary(right(OPEN, { x: 0.3 })), summary(left(OPEN, { x: 0.7 }))), false);
});

test("T: si la mano vertical no toca la horizontal, no es T", () => {
  const far = right(OPEN, { x: 0.5, y: 0.45 + 0.182 * 2 + 0.25 });
  assert.equal(isTimeOut(summary(far), summary(tHorizontal())), false);
});

test("X: se reconoce; dos palmas verticales juntas o una sola mano no", () => {
  assert.equal(isCrossed(summary(xRight()), summary(xLeft())), true);
  assert.equal(isCrossed(summary(right(OPEN, { x: 0.45 })), summary(left(OPEN, { x: 0.55 }))), false);
  assert.equal(isCrossed(summary(xRight()), null), false);
});

test("X: un puño y una palma (no todas las manos abiertas) no es X", () => {
  assert.equal(isCrossed(summary(right(FIST, { x: 0.47, y: 0.75, tilt: 0.7 })), summary(xLeft())), false);
});

const OWN = [
  { name: "pausa", action: "togglePause", test: isTimeOut, holdMs: 500 },
  { name: "silencio", action: "toggleMute", test: isCrossed, holdMs: 500 },
];

test("pausar con T y silenciar con X (versión final, tras activar)", () => {
  const ctrl = new GestureController({ customGestures: OWN });
  const frames = [
    ...palmStill(33),
    ...repeat(20, { right: tVertical(), left: tHorizontal() }),
    ...repeat(10, {}),
    ...palmStill(33),
    ...repeat(20, { right: xRight(), left: xLeft() }),
  ];
  const acts = run(ctrl, frames).filter((a) => a.type === "custom");
  assert.deepEqual(acts.map((a) => a.action), ["togglePause", "toggleMute"]);
});

test("la X mantenida no activa el mando por sí sola (las manos juntas no cuentan como activación)", () => {
  const ctrl = new GestureController({ customGestures: OWN });
  const acts = run(ctrl, repeat(60, { right: xRight(), left: xLeft() }));
  assert.equal(acts.length, 0);
});

test("un gesto mantenido desde antes de activar no se dispara nada más activarse", () => {
  const ctrl = new GestureController({ customGestures: OWN });
  // T mantenida 2 s sin activar; luego activación; la T vuelve: necesita sus 0,5 s
  const frames = [...repeat(60, { right: tVertical(), left: tHorizontal() }), ...palmStill(33), ...repeat(5, { right: tVertical(), left: tHorizontal() })];
  assert.equal(run(ctrl, frames).filter((a) => a.type === "custom").length, 0);
});

test("formar la T moviendo la mano derecha no cuenta como avanzar", () => {
  const ctrl = new GestureController({ defenses: VERSIONS.sinDefensas, customGestures: [] });
  const frames = repeat(12, (i) => ({ right: right(OPEN, { x: 0.65 - (0.2 * i) / 11, y: 0.7 }), left: left(OPEN, { x: 0.6, y: 0.45, tilt: -Math.PI / 2 }) }));
  assert.equal(run(ctrl, frames).filter((a) => a.type === "seek").length, 0);
});
