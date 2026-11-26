// gestures.js — De los 21 puntos de la mano a los gestos del mando.
//
// Este módulo no usa el DOM ni MediaPipe: recibe las manos que devuelve
// findHand() ({ landmarks, world }) y el instante, y devuelve qué acciones
// hay que ejecutar. Así se puede probar con Node (tests/gestures.test.mjs)
// con manos sintéticas, sin cámara.
//
// Recordatorio de coordenadas (Tutorial 4):
//  - landmarks: x e y normalizadas (0–1) en la imagen QUE RECIBE EL MODELO, que
//    NO está en espejo (solo la vista se voltea con CSS). y crece hacia abajo.
//  - worldLandmarks: metros, origen en el centro de la mano. Se usan para la
//    FORMA de la mano (no cambian al acercarse o alejarse).
//  - handedness: "Left"/"Right" son las manos de la persona.

// ---------------------------------------------------------------------------
// 1. Puntos clave
// ---------------------------------------------------------------------------
export const LM = {
  WRIST: 0,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
};

// Los cuatro dedos largos: [punta, articulación PIP]
export const FINGERS = {
  index: [LM.INDEX_TIP, LM.INDEX_PIP],
  middle: [LM.MIDDLE_TIP, LM.MIDDLE_PIP],
  ring: [LM.RING_TIP, LM.RING_PIP],
  pinky: [LM.PINKY_TIP, LM.PINKY_PIP],
};

// ---------------------------------------------------------------------------
// 2. Parámetros (umbrales y tiempos). Todos se justifican en la memoria.
// ---------------------------------------------------------------------------
export const DEFAULTS = {
  // Dedo extendido/doblado: cociente distancia(punta, muñeca) / distancia(PIP, muñeca).
  // Extendido ≈ 1,4–1,5; doblado en puño ≈ 0,8; a medias (sujetando un vaso) ≈ 1,0–1,1.
  // Con histéresis: se entra en "extendido" por encima de extOn y se sale por debajo
  // de extOff; se entra en "doblado" por debajo de foldOn y se sale por encima de foldOff.
  fingers: { extOn: 1.25, extOff: 1.12, foldOn: 0.95, foldOff: 1.05 },
  // Pulgar: distancia(punta del pulgar, MCP del índice) / tamaño de la mano.
  // Con el pulgar recogido sobre el puño ≈ 0,4–0,6; separado ≈ 0,8–1.
  thumb: { foldOn: 0.75, foldOff: 0.85 },
  // "Dedos hacia arriba": componente vertical del vector muñeca→MCP del corazón en la
  // imagen (1 = vertical hacia arriba, 0 = horizontal). 0,6 ≈ hasta unos 53° de inclinación.
  fingersUpMin: 0.6,
  // Palma hacia la cámara: componente z de la normal de la palma (con signo según la mano).
  palmFacingMin: 0.5,

  activation: {
    holdMs: 1000, // palma quieta durante 1 s
    windowMs: 5000, // el mando escucha 5 s (se renuevan con cada orden)
    stillWindowMs: 300, // "quieta": en los últimos 300 ms...
    stillMaxMove: 0.35, // ...la muñeca se mueve menos de 0,35 tamaños de mano
  },
  hold: {
    closeMs: 700, // cerrar oculta el vídeo: más exigente que el resto
    staticMs: 500, // resto de gestos estáticos (los gestos propios)
  },
  cooldownMs: 800, // tras cada orden se ignoran gestos durante 0,8 s
  swipe: {
    windowMs: 600, // el desplazamiento se mide en los últimos 600 ms
    minDist: 1.0, // al menos 1 tamaño de mano en horizontal (≈ 15–20 cm reales)
    dominance: 1.5, // y al menos 1,5 veces más en horizontal que en vertical
    seekSeconds: 10, // cada gesto avanza o retrocede 10 s
  },
  volume: {
    windowMs: 600,
    minDist: 0.7, // al menos 0,7 tamaños de mano en vertical
    dominance: 1.5,
    step: 0.1, // cada gesto sube o baja el volumen un 10 %
  },
  // Al mover la mano rápido, el desenfoque hace que MediaPipe pierda los dedos durante
  // unos fotogramas y la postura deja de reconocerse. La trayectoria no se borra hasta
  // que la postura falta más de gapMs: así un gesto rápido no se corta a medias.
  gapMs: 250,
};

// Versiones para la evaluación. "Sin defensas" = solo los gestos.
export const VERSIONS = {
  final: { activation: true, hold: true, hysteresis: true, cooldown: true, feedback: true },
  sinDefensas: { activation: false, hold: false, hysteresis: false, cooldown: false, feedback: false },
};

// ---------------------------------------------------------------------------
// 3. Medidas sobre los puntos
// ---------------------------------------------------------------------------
export function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

// Tamaño de la mano: muñeca → MCP del corazón (0→9), en metros (world)
export function handSize(world) {
  return dist3(world[LM.WRIST], world[LM.MIDDLE_MCP]);
}

// Tamaño de la mano en la imagen, en unidades de alto de imagen.
// x está normalizada por el ancho e y por el alto: x * aspect las pone en la misma escala.
export function handSize2D(landmarks, aspect) {
  const a = landmarks[LM.WRIST];
  const b = landmarks[LM.MIDDLE_MCP];
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

// Cociente punta/PIP respecto a la muñeca: > 1 extendido, < 1 doblado
export function fingerRatio(world, tip, pip) {
  const wrist = world[LM.WRIST];
  return dist3(world[tip], wrist) / dist3(world[pip], wrist);
}

// El pulgar se dobla hacia la palma, no hacia la muñeca: comparar su punta con la
// muñeca como en los otros dedos no distingue bien. Medimos lo cerca que queda de
// la base del índice, relativo al tamaño de la mano.
export function thumbRatio(world) {
  return dist3(world[LM.THUMB_TIP], world[LM.INDEX_MCP]) / handSize(world);
}

// Normal de la palma: producto vectorial (muñeca→MCP índice) × (muñeca→MCP meñique).
// Devuelve el vector unitario.
export function palmNormal(world) {
  const w = world[LM.WRIST];
  const a = sub(world[LM.INDEX_MCP], w);
  const b = sub(world[LM.PINKY_MCP], w);
  const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

// > 0 si la palma mira a la cámara (1 = de frente), < 0 si se ve el dorso.
// Con la imagen sin voltear, en la mano IZQUIERDA con la palma a la cámara el índice
// queda a la izquierda del meñique en la imagen, y el producto da z > 0; en la
// DERECHA es al revés. Por eso el signo depende de la mano.
// ⚠ Comprobado con geometría y tests; verificadlo con vuestra cámara en el panel de
// depuración ("palma→cámara") antes de fiarse del umbral.
export function palmFacing(world, handName) {
  const nz = palmNormal(world).z;
  return handName === "Left" ? nz : -nz;
}

// Componente "hacia arriba" del vector muñeca→MCP del corazón en la imagen
export function fingersUp(landmarks, aspect) {
  const a = landmarks[LM.WRIST];
  const b = landmarks[LM.MIDDLE_MCP];
  const dx = (b.x - a.x) * aspect;
  const dy = b.y - a.y;
  return -dy / (Math.hypot(dx, dy) || 1);
}

// Dirección de la mano en la imagen: vector unitario muñeca → MCP del corazón
// (x escalada por aspect). (0, -1) = dedos hacia arriba; (±1, 0) = mano horizontal.
export function handDirection(landmarks, aspect) {
  const a = landmarks[LM.WRIST];
  const b = landmarks[LM.MIDDLE_MCP];
  const dx = (b.x - a.x) * aspect;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// Distancia en la imagen entre dos puntos, en unidades de alto (x escalada por aspect)
export function imageDistance(a, b, aspect) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

// Distancia en la imagen de un punto p al segmento a–b
export function pointSegmentDistance(p, a, b, aspect) {
  const ax = a.x * aspect, bx = b.x * aspect, px = p.x * aspect;
  const vx = bx - ax, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const u = Math.max(0, Math.min(1, ((px - ax) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(px - (ax + u * vx), p.y - (a.y + u * vy));
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

// ---------------------------------------------------------------------------
// 4. Histéresis: un umbral para entrar en un estado y otro para salir
// ---------------------------------------------------------------------------
export class Hysteresis {
  // above = true: el estado se activa cuando el valor SUPERA "on" y se desactiva al
  // bajar de "off" (on > off). above = false: al revés (on < off).
  constructor({ on, off, above }) {
    Object.assign(this, { on, off, above, state: false });
  }
  update(value, enabled = true) {
    if (!enabled) {
      // Sin histéresis: un solo umbral, el punto medio
      const mid = (this.on + this.off) / 2;
      this.state = this.above ? value > mid : value < mid;
    } else if (this.above) {
      if (!this.state && value > this.on) this.state = true;
      else if (this.state && value < this.off) this.state = false;
    } else {
      if (!this.state && value < this.on) this.state = true;
      else if (this.state && value > this.off) this.state = false;
    }
    return this.state;
  }
  reset() {
    this.state = false;
  }
}

// ---------------------------------------------------------------------------
// 5. Forma de una mano: qué dedos están extendidos o doblados y qué postura es
// ---------------------------------------------------------------------------
export class HandShape {
  constructor(name, params = DEFAULTS) {
    this.name = name;
    const f = params.fingers;
    this.ext = {};
    this.fold = {};
    for (const finger of Object.keys(FINGERS)) {
      this.ext[finger] = new Hysteresis({ on: f.extOn, off: f.extOff, above: true });
      this.fold[finger] = new Hysteresis({ on: f.foldOn, off: f.foldOff, above: false });
    }
    this.thumbFold = new Hysteresis({ on: params.thumb.foldOn, off: params.thumb.foldOff, above: false });
    this.params = params;
  }

  reset() {
    for (const h of [...Object.values(this.ext), ...Object.values(this.fold), this.thumbFold]) h.reset();
  }

  // hand = { landmarks, world } de findHand(); devuelve un resumen del fotograma
  update(hand, aspect, hysteresis = true) {
    const { landmarks, world } = hand;
    const ratios = {};
    const ext = {};
    const fold = {};
    for (const [finger, [tip, pip]] of Object.entries(FINGERS)) {
      ratios[finger] = fingerRatio(world, tip, pip);
      ext[finger] = this.ext[finger].update(ratios[finger], hysteresis);
      fold[finger] = this.fold[finger].update(ratios[finger], hysteresis);
    }
    const thumb = thumbRatio(world);
    const thumbFolded = this.thumbFold.update(thumb, hysteresis);
    const up = fingersUp(landmarks, aspect);
    const facing = palmFacing(world, this.name);
    const all = (obj) => Object.values(obj).every(Boolean);

    let pose = "none";
    if (all(ext) && up >= this.params.fingersUpMin) pose = "open";
    else if (all(fold) && thumbFolded) pose = "fist";
    else if (ext.index && fold.middle && fold.ring && fold.pinky) pose = "point";

    return {
      pose,
      allExt: all(ext),
      dir: handDirection(landmarks, aspect),
      aspect,
      ext,
      fold,
      ratios,
      thumb,
      thumbFolded,
      up,
      facing,
      wrist: landmarks[LM.WRIST],
      indexTip: landmarks[LM.INDEX_TIP],
      size2d: handSize2D(landmarks, aspect),
      landmarks,
      world,
    };
  }
}

// ¿Se tocan las dos manos? (algún punto clave de una a menos de maxSizes tamaños de
// mano de algún punto de la otra). Se usa para que, mientras se hace un gesto de dos
// manos (T o X), la mano derecha abierta no cuente como activación ni como avanzar.
// No basta con mirar las muñecas: en la T se tocan las puntas de los dedos y las
// muñecas quedan lejos.
const CONTACT_POINTS = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];

export function handsTogether(R, L, maxSizes = 0.6) {
  if (!R || !L) return false;
  const size = (R.size2d + L.size2d) / 2 || 1;
  let min = Infinity;
  for (const i of CONTACT_POINTS) {
    for (const j of CONTACT_POINTS) {
      min = Math.min(min, imageDistance(R.landmarks[i], L.landmarks[j], R.aspect));
    }
  }
  return min / size < maxSizes;
}

// ---------------------------------------------------------------------------
// 6. Trayectorias: posiciones de los últimos milisegundos
// ---------------------------------------------------------------------------
export class Track {
  constructor(maxMs = 1500) {
    this.maxMs = maxMs;
    this.points = [];
  }
  push(t, x, y, size) {
    this.points.push({ t, x, y, size });
    while (this.points.length && t - this.points[0].t > this.maxMs) this.points.shift();
  }
  clear() {
    this.points = [];
  }
  // Desplazamiento entre el punto más antiguo de la ventana y el último, dividido por
  // el tamaño medio de la mano en la ventana (para que no dependa de la distancia).
  displacement(t, windowMs, aspect) {
    const pts = this.points.filter((p) => t - p.t <= windowMs);
    if (pts.length < 2) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const size = pts.reduce((s, p) => s + p.size, 0) / pts.length || 1;
    return {
      dx: ((last.x - first.x) * aspect) / size,
      dy: (last.y - first.y) / size,
      since: first.t,
    };
  }
}

// ---------------------------------------------------------------------------
// 7. El mando: gestos + defensas contra el problema de Midas
// ---------------------------------------------------------------------------
// Acciones que devuelve update():
//   { type: "activar" }
//   { type: "seek", value: ±segundos }        avanzar / retroceder
//   { type: "volume", value: ±delta }         subir / bajar volumen
//   { type: "close" }                         cerrar el vídeo
//   { type: "custom", name, action }          gestos propios (sección 8)
// Cada acción lleva latencyMs: tiempo desde que empezó el gesto hasta que se dispara.
export class GestureController {
  constructor({ defenses = VERSIONS.final, params = {}, customGestures = [] } = {}) {
    this.params = mergeDeep(structuredClone(DEFAULTS), params);
    this.shapes = { Right: new HandShape("Right", this.params), Left: new HandShape("Left", this.params) };
    this.customGestures = customGestures;
    this.setDefenses(defenses);
  }

  setDefenses(defenses) {
    this.defenses = { ...defenses };
    this.reset();
  }

  reset() {
    this.activeUntil = -Infinity;
    this.cooldownUntil = -Infinity;
    this.activation = { since: null, fired: false, track: new Track() };
    this.statics = {}; // estado de cada gesto estático: { since, fired }
    this.swipeTrack = new Track();
    this.volumeTrack = new Track();
    this.lostAt = { swipe: null, volume: null };
    this.debug = { swipe: null, volume: null };
    this.shapes.Right.reset();
    this.shapes.Left.reset();
  }

  isActive(t) {
    return !this.defenses.activation || t < this.activeUntil;
  }

  // right/left: { landmarks, world } o null. t: ms (performance.now()). aspect: ancho/alto.
  update({ right, left, t, aspect = 4 / 3 }) {
    const p = this.params;
    const d = this.defenses;
    const actions = [];
    const feedback = []; // anillos de progreso para dibujar: { hand, progress, kind }

    const R = right ? this.shapes.Right.update(right, aspect, d.hysteresis) : null;
    const L = left ? this.shapes.Left.update(left, aspect, d.hysteresis) : null;
    if (!right) this.shapes.Right.reset();
    if (!left) this.shapes.Left.reset();

    // Mientras las dos manos estén juntas (gestos propios de dos manos), la derecha no
    // cuenta para la activación ni para avanzar
    const together = handsTogether(R, L);
    const R1 = together ? null : R;

    // --- 7.1 Gesto de activación: palma derecha abierta, hacia la cámara y quieta 1 s
    if (d.activation) this.#activation(R1, t, actions, feedback);

    const canAct = this.isActive(t) && (!d.cooldown || t >= this.cooldownUntil);
    const fire = (action) => {
      actions.push(action);
      if (d.cooldown) this.cooldownUntil = t + p.cooldownMs;
      if (d.activation) this.activeUntil = t + p.activation.windowMs; // cada orden renueva la escucha
    };

    // --- 7.2 Cerrar: puño con la derecha (estático, el más exigente: oculta el vídeo)
    const close = this.#static("close", R?.pose === "fist", d.hold ? p.hold.closeMs : 0, t, canAct);
    if (close.fire) fire({ type: "close", latencyMs: close.latencyMs });
    if (close.progress !== null && d.feedback && canAct) feedback.push({ hand: R, progress: close.progress, kind: "close" });

    // --- 7.3 Avanzar / retroceder: mano derecha abierta (en el enunciado, de canto: palma
    // mirando de lado) que se desplaza en horizontal. No se exige orientación de la palma:
    // la forma "abierta" se mide en 3D y vale de canto o de frente. La activación, en cambio,
    // sí pide la palma de frente, así que la mano de canto del swipe no activa el mando.
    // Solo se acumula trayectoria mientras se puede actuar: así el movimiento de vuelta
    // tras un gesto (que cae en el tiempo de espera) no cuenta como gesto contrario.
    this.#follow("swipe", this.swipeTrack, R1?.pose === "open" && canAct, t, () => [R.wrist.x, R.wrist.y, R.size2d]);
    if (canAct) {
      const m = this.swipeTrack.displacement(t, p.swipe.windowMs, aspect);
      this.debug.swipe = m;
      if (m && Math.abs(m.dx) >= p.swipe.minDist && Math.abs(m.dx) >= p.swipe.dominance * Math.abs(m.dy)) {
        // ESPEJO: la imagen que recibe el modelo no está volteada. Si la persona mueve la
        // mano hacia SU derecha (que en la vista en espejo también se ve hacia la derecha),
        // en los datos x DISMINUYE. Por eso dx < 0 es avanzar.
        const seconds = m.dx < 0 ? p.swipe.seekSeconds : -p.swipe.seekSeconds;
        fire({ type: "seek", value: seconds, latencyMs: t - m.since });
        this.swipeTrack.clear(); // el siguiente gesto empieza de cero
      }
    }

    // --- 7.4 Volumen: índice derecho extendido (en el enunciado, en horizontal apuntando a la
    // mano izquierda; no se exige dirección, solo que sea el único dedo estirado) + palma
    // izquierda abierta hacia la cámara; mover la derecha arriba o abajo
    const volumePose = R?.pose === "point" && L?.pose === "open" && L.facing >= p.palmFacingMin;
    this.#follow("volume", this.volumeTrack, volumePose && canAct, t, () => [R.indexTip.x, R.indexTip.y, R.size2d]);
    if (canAct) {
      const m = this.volumeTrack.displacement(t, p.volume.windowMs, aspect);
      this.debug.volume = m;
      if (m && Math.abs(m.dy) >= p.volume.minDist && Math.abs(m.dy) >= p.volume.dominance * Math.abs(m.dx)) {
        // y crece hacia abajo: dy < 0 es subir la mano
        fire({ type: "volume", value: m.dy < 0 ? p.volume.step : -p.volume.step, latencyMs: t - m.since });
        this.volumeTrack.clear();
      }
    }

    // --- 7.5 Gestos propios (estáticos), definidos tras la elicitación
    for (const g of this.customGestures) {
      const st = this.#static(g.name, Boolean(g.test(R, L)), d.hold ? g.holdMs ?? p.hold.staticMs : 0, t, canAct);
      if (st.fire) fire({ type: "custom", name: g.name, action: g.action, latencyMs: st.latencyMs });
      if (st.progress !== null && d.feedback && canAct) feedback.push({ hand: R ?? L, progress: st.progress, kind: g.name });
    }

    return {
      actions,
      feedback,
      mode: {
        active: this.isActive(t),
        always: !d.activation,
        remainingMs: d.activation ? Math.max(0, this.activeUntil - t) : Infinity,
        cooling: d.cooldown && t < this.cooldownUntil,
        activationProgress: this.activation.since !== null && !this.activation.fired
          ? Math.min(1, (t - this.activation.since) / p.activation.holdMs)
          : null,
      },
      hands: { R, L },
      debug: this.debug,
    };
  }

  // Sigue una trayectoria mientras se cumple la postura; si la postura falta, espera
  // gapMs antes de borrarla (tolerancia a fotogramas perdidos por el desenfoque).
  #follow(key, track, present, t, point) {
    if (present) {
      this.lostAt[key] = null;
      const [x, y, size] = point();
      track.push(t, x, y, size);
    } else {
      this.lostAt[key] ??= t;
      if (t - this.lostAt[key] > this.params.gapMs) track.clear();
    }
  }

  // Gesto estático con tiempo de mantenimiento ("varios fotogramas") y disparo único:
  // se dispara una vez al completar holdMs y no vuelve a dispararse hasta que la
  // postura se suelta (rearme). Sin la defensa, holdMs = 0: primer fotograma.
  #static(name, present, holdMs, t, canAct) {
    const s = (this.statics[name] ??= { since: null, fired: false });
    if (!present) {
      s.since = null;
      s.fired = false;
      return { fire: false, progress: null };
    }
    if (!canAct) {
      // El tiempo de mantener solo cuenta mientras el mando escucha: si no, un gesto
      // mantenido desde antes de activar se dispararía nada más activarse.
      s.since = null;
      return { fire: false, progress: null };
    }
    s.since ??= t;
    const progress = holdMs > 0 ? Math.min(1, (t - s.since) / holdMs) : 1;
    if (!s.fired && progress >= 1 && canAct) {
      s.fired = true;
      return { fire: true, latencyMs: t - s.since, progress: null };
    }
    return { fire: false, progress: s.fired ? null : progress };
  }

  #activation(R, t, actions, feedback) {
    const p = this.params.activation;
    const a = this.activation;
    const candidate = R?.pose === "open" && R.facing >= this.params.palmFacingMin;
    if (!candidate) {
      a.since = null;
      a.fired = false;
      a.track.clear();
      return;
    }
    a.track.push(t, R.wrist.x, R.wrist.y, R.size2d);
    const m = a.track.displacement(t, p.stillWindowMs, 1);
    const still = !m || Math.hypot(m.dx, m.dy) <= p.stillMaxMove;
    if (!still) {
      a.since = null; // se ha movido: vuelve a empezar (p. ej. al hacer el gesto de avanzar)
      return;
    }
    a.since ??= t;
    if (a.fired) {
      this.activeUntil = Math.max(this.activeUntil, t + p.windowMs); // mientras se mantenga, sigue activo
      return;
    }
    const progress = Math.min(1, (t - a.since) / p.holdMs);
    if (this.defenses.feedback) feedback.push({ hand: R, progress, kind: "activation" });
    if (progress >= 1) {
      a.fired = true;
      this.activeUntil = t + p.windowMs;
      actions.push({ type: "activar", latencyMs: t - a.since });
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Gestos propios (elegidos en la mini elicitación)
// ---------------------------------------------------------------------------
// Ambos son de dos manos y no dependen de qué mano MediaPipe etiqueta como izquierda
// o derecha: se prueban las dos combinaciones.

// PAUSAR · "T" (tiempo muerto): una mano horizontal y la otra vertical, con la punta
// de los dedos de la vertical tocando la horizontal.
export const TIMEOUT = {
  horizontalMax: 0.45, // |componente vertical| ≤ 0,45 → como mucho ~27° de inclinación
  verticalMin: 0.75, // componente hacia arriba ≥ 0,75 → al menos ~49° sobre la horizontal
  touchMax: 0.6, // punta del corazón a ≤ 0,6 tamaños de mano de la mano horizontal
};

export function isTimeOut(R, L, p = TIMEOUT) {
  if (!R || !L || !R.allExt || !L.allExt) return false;
  for (const [h, v] of [[R, L], [L, R]]) {
    if (Math.abs(h.dir.y) > p.horizontalMax || -v.dir.y < p.verticalMin) continue;
    const tip = v.landmarks[LM.MIDDLE_TIP];
    const d = pointSegmentDistance(tip, h.landmarks[LM.WRIST], h.landmarks[LM.MIDDLE_TIP], h.aspect);
    if (d / h.size2d <= p.touchMax) return true;
  }
  return false;
}

// SILENCIAR · "X": las dos manos abiertas, muñecas juntas y dedos inclinados hacia
// lados opuestos (las puntas se separan mucho más que las muñecas).
export const CROSS = {
  tiltMin: 0.35, // componente horizontal de la dirección ≥ 0,35 → inclinadas ≥ ~20°
  upMin: 0.3, // y apuntando hacia arriba
  wristsMax: 1.0, // muñecas a ≤ 1 tamaño de mano
  spreadMin: 1.0, // las puntas, al menos 1 tamaño de mano más separadas que las muñecas
};

export function isCrossed(R, L, p = CROSS) {
  if (!R || !L || !R.allExt || !L.allExt) return false;
  if (-R.dir.y < p.upMin || -L.dir.y < p.upMin) return false;
  if (Math.abs(R.dir.x) < p.tiltMin || Math.abs(L.dir.x) < p.tiltMin) return false;
  if (Math.sign(R.dir.x) === Math.sign(L.dir.x)) return false;
  const size = (R.size2d + L.size2d) / 2;
  const wrists = imageDistance(R.wrist, L.wrist, R.aspect) / size;
  const tips = imageDistance(R.landmarks[LM.MIDDLE_TIP], L.landmarks[LM.MIDDLE_TIP], R.aspect) / size;
  return wrists <= p.wristsMax && tips - wrists >= p.spreadMin;
}

function mergeDeep(target, source) {
  for (const [k, v] of Object.entries(source ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) target[k] = mergeDeep(target[k] ?? {}, v);
    else target[k] = v;
  }
  return target;
}
