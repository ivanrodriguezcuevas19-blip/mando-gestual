// P2 · El mando gestual del salón (plantilla)
// Cámara → HandLandmarker (21 puntos por mano) → VUESTROS GESTOS → acciones sobre el reproductor
// Lo que tenéis que programar está en la sección 6, recognizeGestures()

// 1. Importar los elementos necesarios para la tarea.
// Versión fijada (nunca @latest): el .mjs y los ficheros .wasm deben ser de la misma versión
import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs";
// Nuestra lógica de gestos y defensas (sin DOM: se prueba con node --test)
import { GestureController, VERSIONS, isTimeOut, isCrossed } from "./gestures.js?v=4";
// Modo guiado: asistente paso a paso para la evaluación sin observador
import { initGuide } from "./guide.js?v=3";

const MEDIAPIPE_VERSION = "1.2.2"; // la misma que en el import de arriba
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const statusEl = document.querySelector("#status");
const btnCamera = document.querySelector("#btnCamera");
const video = document.querySelector("#webcam");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const player = document.querySelector("#player");
const modeEl = document.querySelector("#mode");
const logBody = document.querySelector("#log tbody");
const versionEl = document.querySelector("#version");
const defenseEls = {
  activation: document.querySelector("#defActivation"),
  hold: document.querySelector("#defHold"),
  hysteresis: document.querySelector("#defHysteresis"),
  cooldown: document.querySelector("#defCooldown"),
  feedback: document.querySelector("#defFeedback"),
};

let handLandmarker;
let delegate;
let drawingUtils;
let lastVideoTime = -1;
let frames = 0;
let fpsStart = performance.now();

function show(message) {
  statusEl.textContent = message;
  console.log(message);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el.textContent !== text) el.textContent = text; // solo tocamos el DOM si cambia
}

function environmentReport() {
  const yesNo = (value) => (value ? "sí" : "no");
  return [
    `MediaPipe Tasks Vision ${MEDIAPIPE_VERSION} · delegado: ${delegate}`,
    `Contexto seguro (necesario para la cámara): ${yesNo(window.isSecureContext)}`,
    `WebGPU: ${yesNo("gpu" in navigator)}`,
  ].join("\n");
}

// 2. Crear la tarea (con GPU si se puede; si no, CPU).
// Para comparar, añade ?delegate=cpu a la URL
async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numHands: 2,
  };
  const requested = new URLSearchParams(location.search).get("delegate")?.toUpperCase();
  const candidates = requested === "CPU" ? ["CPU"] : ["GPU", "CPU"];
  for (const candidate of candidates) {
    try {
      options.baseOptions.delegate = candidate;
      handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      delegate = candidate;
      return;
    } catch (error) {
      console.warn(`No se pudo crear la tarea con ${candidate}:`, error);
    }
  }
  throw new Error("No se pudo crear HandLandmarker");
}

// Activar la cámara web y ajustar el canvas a su resolución real
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("La cámara no está disponible (¿se sirve la página por HTTPS?)");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  drawingUtils = new DrawingUtils(ctx);
}

// 3. Ejecutar la tarea en cada fotograma nuevo
function predictWebcam() {
  // detectForVideo necesita marcas de tiempo crecientes: solo procesamos fotogramas nuevos
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    drawResults(result);
    showResults(result);
    recognizeGestures(result);
    countFrame();
  }
  requestAnimationFrame(predictWebcam);
}

// 4. Entender los resultados: tres listas paralelas, una entrada por mano detectada
function showResults(result) {
  setText("numHands", String(result.landmarks.length));
  const text = { Left: "–", Right: "–" };
  result.handedness.forEach((categories, i) => {
    const { categoryName, score } = categories[0]; // "Left" o "Right": la mano de la persona
    const wrist = result.landmarks[i][0]; // punto 0: muñeca, coordenadas normalizadas
    const where = `(${wrist.x.toFixed(2)}, ${wrist.y.toFixed(2)})`;
    text[categoryName] = Math.round(score * 100) + " % · muñeca en " + where;
  });
  setText("leftHand", text.Left);
  setText("rightHand", text.Right);
}

// 5. Utilizar los resultados: dibujar las conexiones entre articulaciones y un círculo en cada punto
function drawResults(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const landmarks of result.landmarks) {
    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: "#00e0ff",
      lineWidth: 3,
    });
    drawingUtils.drawLandmarks(landmarks, { color: "#ff6f00", lineWidth: 1, radius: 4 });
  }
}

// 6. VUESTRO TRABAJO: de los puntos a los gestos
// Se llama una vez por fotograma con el resultado de HandLandmarker:
//   result.handedness[i][0].categoryName → "Left" o "Right" (la mano de la persona)
//   result.landmarks[i]      → 21 puntos, x e y normalizadas (0–1) en la imagen
//   result.worldLandmarks[i] → los mismos 21 puntos en metros
// La lógica está en gestures.js (GestureController); aquí solo se traduce su salida
// a acciones sobre el reproductor, al estado del mando y a la retroalimentación.

// Gestos propios, elegidos con la mini elicitación (ver memoria). Cada uno es una
// condición sobre las dos manos (gestures.js, sección 8) y la acción que dispara.
// Se mantienen 0,5 s, como los demás gestos estáticos.
const CUSTOM_GESTURES = [
  { name: "pausa", action: "togglePause", test: isTimeOut, holdMs: 500 }, // T: tiempo muerto
  { name: "silencio", action: "toggleMute", test: isCrossed, holdMs: 500 }, // X: manos cruzadas
];

const ACTIONS = { togglePause, toggleMute };

let controller = new GestureController({ defenses: VERSIONS.final, customGestures: CUSTOM_GESTURES });
let currentVersion = "final";
let lastOutput = null;
let lastHandCount = 0;

function recognizeGestures(result) {
  const right = findHand(result, "Right");
  const left = findHand(result, "Left");
  const t = performance.now();
  const aspect = video.videoWidth / video.videoHeight || 4 / 3;
  const out = controller.update({ right, left, t, aspect });
  lastOutput = out;
  lastHandCount = result.landmarks.length;

  for (const action of out.actions) {
    logMeta = { version: currentVersion, latencyMs: action.latencyMs };
    if (action.type === "activar") logAction("activar", "mando escuchando 5 s");
    else if (action.type === "seek") seek(action.value);
    else if (action.type === "volume") changeVolume(action.value);
    else if (action.type === "close") closePlayer();
    else if (action.type === "custom") ACTIONS[action.action]?.();
    logMeta = null;
  }

  drawFeedback(out.feedback);
  showMode(out.mode);
  showGestureDebug(out.hands);
  showMotionDebug(out.debug, t);
}

// Cuánto se ha desplazado la mano frente a lo que hace falta (en tamaños de mano).
// Se muestra el máximo de los últimos 2 s para que dé tiempo a leerlo.
const motionPeak = { swipe: { value: 0, t: 0 }, volume: { value: 0, t: 0 } };

function showMotionDebug(debug, t) {
  const p = controller.params;
  const parts = [];
  for (const [key, axis, need, label] of [
    ["swipe", "dx", p.swipe.minDist, "avanzar/retroceder"],
    ["volume", "dy", p.volume.minDist, "volumen"],
  ]) {
    const value = Math.abs(debug?.[key]?.[axis] ?? 0);
    const peak = motionPeak[key];
    if (value >= peak.value || t - peak.t > 2000) Object.assign(peak, { value, t });
    parts.push(`${label}: ${peak.value.toFixed(2)} de ${need.toFixed(2)}`);
  }
  setText("motion", parts.join(" · "));
}

// Estado del mando, siempre visible (lo exige el enunciado)
function showMode(mode) {
  if (mode.always) {
    setMode("Mando siempre activo (versión sin defensas)", true);
  } else if (mode.active) {
    const s = Math.ceil(mode.remainingMs / 1000);
    setMode(`Mando activado: ${s} s${mode.cooling ? " · espera…" : ""}`, true);
  } else if (mode.activationProgress !== null) {
    setMode(`Activando… ${Math.round(mode.activationProgress * 100)} %`, false);
  } else {
    setMode("Mando en reposo · muestra la palma derecha 1 s para activarlo", false);
  }
}

// Retroalimentación anticipada: un anillo que se llena alrededor de la mano mientras
// se mantiene un gesto, para ver que se está reconociendo y poder soltarlo antes de
// que actúe. El canvas está en espejo por CSS, pero un anillo es simétrico.
const FEEDBACK_COLORS = { activation: "#2e7d32", close: "#e53935" };

function drawFeedback(items) {
  for (const { hand, progress, kind } of items) {
    if (!hand) continue;
    const cx = hand.landmarks[9].x * canvas.width;
    const cy = hand.landmarks[9].y * canvas.height;
    const r = Math.max(30, hand.size2d * canvas.height * 0.9);
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = FEEDBACK_COLORS[kind] ?? "#ff6f00";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
    ctx.stroke();
  }
}

const POSE_ES = { open: "palma abierta", fist: "puño", point: "índice", none: "—" };

// Panel de depuración: los valores que usan las heurísticas, para calibrar los
// umbrales mirando los datos y no a ojo
function showGestureDebug({ R, L }) {
  const describe = (h) => {
    if (!h) return "–";
    const r = h.ratios;
    return (
      `${POSE_ES[h.pose]} · dedos I ${r.index.toFixed(2)} C ${r.middle.toFixed(2)} ` +
      `A ${r.ring.toFixed(2)} M ${r.pinky.toFixed(2)} · pulgar ${h.thumb.toFixed(2)} · ` +
      `arriba ${h.up.toFixed(2)} · palma→cámara ${h.facing.toFixed(2)}`
    );
  };
  setText("rightGesture", describe(R));
  setText("leftGesture", describe(L));
  setText("ownGestures", `T (pausar): ${isTimeOut(R, L) ? "sí" : "no"} · X (silenciar): ${isCrossed(R, L) ? "sí" : "no"}`);
}

// Versión de la evaluación: "final" o "sinDefensas"; las casillas permiten además
// activar o desactivar cada defensa por separado
function applyVersion(name) {
  currentVersion = name;
  const defenses = VERSIONS[name] ?? VERSIONS.final;
  for (const [key, el] of Object.entries(defenseEls)) el.checked = defenses[key];
  applyDefenses();
}

function applyDefenses() {
  const defenses = Object.fromEntries(Object.entries(defenseEls).map(([k, el]) => [k, el.checked]));
  const preset = Object.entries(VERSIONS).find(([, v]) => JSON.stringify(v) === JSON.stringify(defenses));
  currentVersion = preset ? preset[0] : "personalizada";
  versionEl.value = preset ? preset[0] : "personalizada";
  controller.setDefenses(defenses);
}

// Devuelve { landmarks, world } de la mano pedida ("Left" o "Right"), o null si no está
function findHand(result, name) {
  const i = result.handedness.findIndex((categories) => categories[0].categoryName === name);
  return i < 0 ? null : { landmarks: result.landmarks[i], world: result.worldLandmarks[i] };
}

// Distancia entre dos puntos 3D
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Muestra el estado del mando (por ejemplo, "Mando activado: 3 s")
function setMode(text, active) {
  setText("mode", text);
  modeEl.classList.toggle("active", Boolean(active));
}

// 7. Acciones sobre el reproductor (ya implementadas; cada una queda en el registro)
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seek(seconds) {
  const end = Number.isFinite(player.duration) ? player.duration : Infinity; // aún sin cargar
  player.currentTime = clamp(player.currentTime + seconds, 0, end);
  logAction(seconds > 0 ? "avanzar" : "retroceder", `${seconds} s → ${player.currentTime.toFixed(1)} s`);
}

function changeVolume(delta) {
  player.volume = clamp(player.volume + delta, 0, 1);
  logAction(delta > 0 ? "subir volumen" : "bajar volumen", `volumen ${player.volume.toFixed(2)}`);
}

function closePlayer() {
  player.pause();
  player.hidden = true;
  logAction("cerrar", "");
}

function togglePause() {
  if (player.paused) player.play();
  else player.pause();
  logAction(player.paused ? "pausar" : "reanudar", "");
}

function toggleMute() {
  player.muted = !player.muted;
  logAction(player.muted ? "silenciar" : "quitar silencio", "");
}

// Registro de acciones: tiempo desde que se cargó la página, acción, detalle,
// versión (final / sinDefensas) y latencia del gesto (desde que empezó hasta la acción)
const logRows = [];
let logMeta = null; // lo rellena recognizeGestures() justo antes de cada acción
const actionListeners = []; // el modo guiado se entera así de cada acción

function logAction(action, detail) {
  const row = [
    (performance.now() / 1000).toFixed(2),
    action,
    detail,
    logMeta?.version ?? currentVersion,
    logMeta?.latencyMs !== undefined ? Math.round(logMeta.latencyMs) : "",
  ];
  logRows.push(row);
  const tr = document.createElement("tr");
  for (const value of row) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  logBody.prepend(tr); // la acción más reciente, arriba
  for (const listener of actionListeners) listener(action);
}

function downloadLog(filename = "registro-acciones.csv") {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const lines = [["tiempo_s", "accion", "detalle", "version", "latencia_ms"], ...logRows].map((row) => row.map(quote).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.querySelector("#btnDownload").addEventListener("click", () => downloadLog());
document.querySelector("#btnClear").addEventListener("click", () => {
  logRows.length = 0;
  logBody.replaceChildren();
});

// Ayuda para la evaluación: marcas de inicio y fin de cada fase en el registro y un
// temporizador de 3 minutos para la actividad normal. tools/analizar.py usa las marcas.
let phase = null;
let phaseTimer = null;

function startPhase() {
  if (phase) endPhase();
  const participant = document.querySelector("#participant").value.trim() || "sin nombre";
  const name = document.querySelector("#phase").value;
  phase = { participant, name, start: performance.now() };
  logAction("marca", `inicio · ${participant} · ${name}`);
  if (name === "actividad normal") {
    phaseTimer = setInterval(() => {
      const left = 180 - (performance.now() - phase.start) / 1000;
      if (left <= 0) {
        endPhase();
        return;
      }
      setText("phaseInfo", `Actividad normal: quedan ${Math.ceil(left)} s`);
    }, 250);
  }
  setText("phaseInfo", `En curso: ${participant} · ${name}`);
}

function endPhase() {
  if (!phase) return;
  clearInterval(phaseTimer);
  logAction("marca", `fin · ${phase.participant} · ${phase.name}`);
  setText("phaseInfo", `Terminada: ${phase.participant} · ${phase.name}`);
  phase = null;
}

function countFrame() {
  frames++;
  const elapsed = performance.now() - fpsStart;
  if (elapsed >= 1000) {
    setText("fps", (frames / (elapsed / 1000)).toFixed(1));
    frames = 0;
    fpsStart = performance.now();
  }
}

function bindControls() {
  versionEl.addEventListener("change", () => applyVersion(versionEl.value));
  for (const el of Object.values(defenseEls)) el.addEventListener("change", applyDefenses);
  const requested = new URLSearchParams(location.search).get("version");
  applyVersion(requested in VERSIONS ? requested : "final");
  document.querySelector("#btnShowPlayer").addEventListener("click", () => {
    player.hidden = false; // para seguir evaluando después de "cerrar"
  });
  // Vídeo elegido por la persona (evaluación a distancia): un objectURL local admite saltos
  document.querySelector("#videoFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (player.src.startsWith("blob:")) URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(file);
    player.hidden = false;
    document.querySelector("#videoHint").hidden = true;
  });
  // Si no hay video.mp4 (p. ej. en la versión publicada), se pide elegir uno. El error
  // puede haberse producido antes de llegar aquí, así que también se mira player.error.
  const showVideoHint = () => {
    if (!player.src.startsWith("blob:")) document.querySelector("#videoHint").hidden = false;
  };
  player.addEventListener("error", showVideoHint);
  if (player.error) showVideoHint();
  document.querySelector("#btnPhaseStart").addEventListener("click", startPhase);
  document.querySelector("#btnPhaseEnd").addEventListener("click", endPhase);
}

// Activa la cámara y el bucle de detección. La usan el botón de la plantilla y el
// modo guiado. Devuelve true si la cámara quedó funcionando.
let cameraRunning = false;
let landmarkerReady = null; // promesa: el modelo puede no haber terminado de cargar

async function enableCamera() {
  if (cameraRunning) return true;
  btnCamera.disabled = true;
  try {
    await landmarkerReady;
    await startCamera();
    btnCamera.hidden = true;
    cameraRunning = true;
    requestAnimationFrame(predictWebcam);
    return true;
  } catch (error) {
    console.error(error);
    show(`Error con la cámara: ${error.message}`);
    btnCamera.disabled = false;
    return false;
  }
}

// Deja el reproductor visible, sin silencio, a volumen medio y reproduciendo
function resetPlayer() {
  player.hidden = false;
  player.muted = false;
  player.volume = 0.5;
  player.play().catch(() => {}); // sin vídeo cargado, play() falla: no importa
}

async function app() {
  bindControls();
  landmarkerReady = createHandLandmarker();
  // Lo que el modo guiado puede hacer con la página
  initGuide({
    enableCamera,
    cameraOn: () => cameraRunning,
    handCount: () => lastHandCount,
    setVersion: (name) => applyVersion(name),
    resetPlayer,
    setVolume: (v) => {
      player.volume = v;
    },
    modeText: () => modeEl.textContent,
    logAction,
    clearLog: () => {
      logRows.length = 0;
      logBody.replaceChildren();
    },
    downloadLog,
    onAction: (fn) => actionListeners.push(fn),
  });
  await landmarkerReady;
  show(environmentReport());
  btnCamera.disabled = false;
  btnCamera.addEventListener("click", enableCamera);
}

try {
  await app();
} catch (error) {
  console.error(error);
  show(`Error: ${error.message}`);
}
