// Manos sintéticas para los tests (y para el MediaPipe simulado de las pruebas de la página).
// Geometría aproximada de una mano adulta, en metros, con la muñeca en el origen,
// x hacia la derecha de la imagen, y hacia abajo y z hacia el fondo (como MediaPipe).

const MCP = {
  index: { x: 0.025, y: -0.085 },
  middle: { x: 0.008, y: -0.09 },
  ring: { x: -0.01, y: -0.083 },
  pinky: { x: -0.028, y: -0.075 },
};
const SEGMENTS = { index: [0.045, 0.025, 0.022], middle: [0.05, 0.028, 0.024], ring: [0.046, 0.026, 0.022], pinky: [0.035, 0.02, 0.019] };
const ORDER = ["index", "middle", "ring", "pinky"]; // puntos 5–8, 9–12, 13–16, 17–20

// fingers: { index, middle, ring, pinky } con "ext" o "fold"; thumb: "ext" o "fold"
// hand: "Right" | "Left"; facing: "camera" | "back" | "side" (de canto: la palma mira de lado,
// como en el gesto de avanzar del enunciado)
// x, y: posición de la muñeca en la imagen (0–1); scale: alto de imagen por metro;
// tilt: inclinación en radianes (0 = dedos hacia arriba)
export function makeHand({
  hand = "Right",
  facing = "camera",
  fingers = {},
  thumb = "ext",
  x = 0.5,
  y = 0.7,
  scale = 2,
  aspect = 4 / 3,
  tilt = 0,
} = {}) {
  // Con la palma a la cámara y la imagen sin voltear, el índice de la mano derecha
  // queda a la derecha de la imagen (+x) y el de la izquierda, a la izquierda.
  let sgn = hand === "Right" ? 1 : -1;
  if (facing === "back") sgn = -sgn;

  const world = new Array(21);
  world[0] = { x: 0, y: 0, z: 0 };
  // Pulgar: CMC, MCP, IP, punta
  world[1] = { x: sgn * 0.02, y: -0.02, z: 0 };
  world[2] = { x: sgn * 0.04, y: -0.04, z: 0 };
  world[3] = thumb === "ext" ? { x: sgn * 0.07, y: -0.05, z: 0 } : { x: sgn * 0.03, y: -0.07, z: -0.03 };
  world[4] = thumb === "ext" ? { x: sgn * 0.1, y: -0.055, z: 0 } : { x: sgn * 0.005, y: -0.1, z: -0.03 };

  ORDER.forEach((finger, k) => {
    const base = 5 + 4 * k;
    const m = MCP[finger];
    const [l1, l2, l3] = SEGMENTS[finger];
    const mcp = { x: sgn * m.x, y: m.y, z: 0 };
    world[base] = mcp;
    if ((fingers[finger] ?? "ext") === "ext") {
      world[base + 1] = { x: mcp.x, y: mcp.y - l1, z: 0 };
      world[base + 2] = { x: mcp.x, y: mcp.y - l1 - l2, z: 0 };
      world[base + 3] = { x: mcp.x, y: mcp.y - l1 - l2 - l3, z: 0 };
    } else {
      // Doblado: el nudillo avanza hacia la cámara y la punta vuelve hacia la palma
      world[base + 1] = { x: mcp.x, y: mcp.y - 0.03, z: -0.02 };
      world[base + 2] = { x: mcp.x, y: mcp.y - 0.01, z: -0.04 };
      world[base + 3] = { x: mcp.x, y: mcp.y + 0.01, z: -0.03 };
    }
  });

  // De canto: girar la mano 90° alrededor del eje vertical (x → profundidad)
  const yaw = facing === "side" ? Math.PI / 2 : 0;
  const turned = world.map((p) => ({
    x: p.x * Math.cos(yaw) + p.z * Math.sin(yaw),
    y: p.y,
    z: -p.x * Math.sin(yaw) + p.z * Math.cos(yaw),
  }));
  const rot = (p) => ({
    x: p.x * Math.cos(tilt) - p.y * Math.sin(tilt),
    y: p.x * Math.sin(tilt) + p.y * Math.cos(tilt),
    z: p.z,
  });
  const w = turned.map(rot);
  // Proyección a la imagen: x normalizada por el ancho (dividir por aspect), y por el alto
  const landmarks = w.map((p) => ({ x: x + (p.x * scale) / aspect, y: y + p.y * scale, z: p.z }));
  return { landmarks, world: w, name: hand };
}

export const OPEN = { fingers: {}, thumb: "ext" };
export const FIST = { fingers: { index: "fold", middle: "fold", ring: "fold", pinky: "fold" }, thumb: "fold" };
export const POINT = { fingers: { index: "ext", middle: "fold", ring: "fold", pinky: "fold" }, thumb: "fold" };
