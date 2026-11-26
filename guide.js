// guide.js — Modo guiado: un asistente que lleva a la persona paso a paso por la
// evaluación sin que nadie tenga que estar mirando.
//
// Pasos: bienvenida (datos) → cámara → aprender y practicar los gestos → dos rondas
// (sin defensas y final, en orden aleatorio) → resultados y descarga del CSV.
//
// En cada ronda, para cada gesto, la página pide N intentos. Cada intento tiene una
// ventana para hacer el gesto y una pausa para bajar las manos; al acabar se clasifica
// automáticamente con las acciones que han llegado al registro en ese tiempo:
//   ✓ la acción correcta una sola vez · ✗ nada · 2 la correcta varias veces · ≠ otra acción
// Así se mide «¿cuántos intentos producen la acción correcta, una sola vez?» sin un
// observador. Las acciones que llegan en la pausa cuentan para el intento anterior:
// es justo cuando aparecen los disparos dobles (por ejemplo, al devolver la mano).

import { GESTURE_ART } from "./gestureArt.js?v=2";

const PHASES = [
  {
    id: "activar",
    label: "Activar el mando",
    attempts: 10,
    expect: ["activar"],
    onlyFinal: true,
    howto: "Muestra la palma de la mano derecha a la cámara y mantenla quieta 1 segundo, hasta que la barra se ponga verde. Luego baja la mano.",
  },
  {
    id: "avanzar",
    label: "Avanzar 10 s",
    attempts: 5,
    expect: ["avanzar"],
    howto: "Mano derecha abierta DE CANTO (la palma mirando hacia un lado, como un cuchillo) y los dedos hacia arriba. Desplázala rápido hacia TU derecha (unos 15–20 cm).",
  },
  {
    id: "retroceder",
    label: "Retroceder 10 s",
    attempts: 5,
    expect: ["retroceder"],
    howto: "Mano derecha abierta DE CANTO (la palma mirando hacia un lado) y los dedos hacia arriba. Desplázala rápido hacia TU izquierda (unos 15–20 cm).",
  },
  {
    id: "subir volumen",
    label: "Subir el volumen",
    attempts: 5,
    expect: ["subir volumen"],
    howto: "Levanta la mano izquierda abierta, con la palma hacia la cámara, y déjala quieta. Con la derecha, estira solo el índice EN HORIZONTAL, apuntando a tu mano izquierda, y sube la mano derecha rápido.",
  },
  {
    id: "bajar volumen",
    label: "Bajar el volumen",
    attempts: 5,
    expect: ["bajar volumen"],
    howto: "Igual que para subir: palma izquierda quieta hacia la cámara e índice derecho en horizontal apuntando a ella, pero ahora baja la mano derecha rápido.",
  },
  {
    id: "cerrar",
    label: "Cerrar el vídeo",
    attempts: 10,
    expect: ["cerrar"],
    howto: "Cierra la mano derecha en un puño (con el pulgar recogido) y mantenlo un momento, hasta que el vídeo desaparezca. Después el vídeo vuelve solo.",
  },
  {
    id: "propio 1",
    label: "Pausar / reanudar (T)",
    attempts: 10,
    expect: ["pausar", "reanudar"],
    howto: "Haz una «T» de tiempo muerto: una mano plana en horizontal y la otra en vertical, tocando con la punta de los dedos el centro de la horizontal. Mantenla un momento.",
  },
  {
    id: "propio 2",
    label: "Silenciar / quitar silencio (X)",
    attempts: 10,
    expect: ["silenciar", "quitar silencio"],
    howto: "Cruza las dos manos abiertas por las muñecas formando una «X», con los dedos hacia arriba. Mantenla un momento.",
  },
];

const VERSION_TEXT = {
  sinDefensas: {
    name: "Versión A",
    intro: "En esta ronda el mando está <strong>siempre escuchando</strong>: no hace falta activarlo. Haz cada gesto directamente cuando te lo pida la pantalla.",
  },
  final: {
    name: "Versión B",
    intro: "En esta ronda el mando <strong>solo escucha 5 segundos después de activarlo</strong>. Antes de cada gesto, si la barra verde no está encendida, muestra la palma derecha quieta 1 segundo hasta que se ponga verde, y entonces haz el gesto.",
  },
};

const ACTIVITY_PROMPTS = [
  "Habla en voz alta sobre lo que has hecho hoy, gesticulando con las manos como harías con un amigo.",
  "Coge un vaso o una botella y bebe un poco.",
  "Saca el móvil, desbloquéalo y escribe un mensaje cualquiera.",
  "Tócate la cara, el pelo o la barbilla; rasca la nariz.",
  "Estírate y cambia de postura, como si estuvieras en el sofá.",
  "Señala algo de la habitación mientras lo describes en voz alta.",
];

const WINDOW_MS = { sinDefensas: 5000, final: 7000 }; // con defensas hay que activar antes
const REST_MS = 2500;
// ?prueba en la URL (solo para probar la página): 1 intento por gesto y 10 s de actividad
const TEST_RUN = new URLSearchParams(location.search).has("prueba");
const ACTIVITY_MS = TEST_RUN ? 10000 : 180000;
if (TEST_RUN) for (const p of PHASES) p.attempts = 1;
const IGNORED = new Set(["marca", "intento", "participante", "resumen"]);

export function initGuide(api) {
  const root = document.querySelector("#wizard");
  const state = {
    participant: null,
    order: Math.random() < 0.5 ? ["sinDefensas", "final"] : ["final", "sinDefensas"],
    results: {}, // results[version][phaseId] = ["✓", "✗", ...]
    involuntary: {}, // involuntary[version] = número de acciones en actividad normal
    practiced: new Set(),
    listener: null,
    timers: [],
  };

  // Todas las acciones del mando pasan por aquí (las publica logAction en index.js)
  api.onAction((action) => {
    if (IGNORED.has(action)) return;
    state.listener?.(action);
  });

  const clearTimers = () => {
    state.timers.forEach((id) => clearTimeout(id) || clearInterval(id));
    state.timers = [];
  };
  const after = (ms, fn) => state.timers.push(setTimeout(fn, ms));
  const every = (ms, fn) => state.timers.push(setInterval(fn, ms));
  const html = (markup) => {
    root.innerHTML = markup;
    root.scrollIntoView({ block: "nearest" });
  };
  const $ = (sel) => root.querySelector(sel);
  const stepper = (n) => {
    const names = ["Datos", "Cámara", "Práctica", "Ronda 1", "Ronda 2", "Fin"];
    return `<ol class="stepper">${names
      .map((name, i) => `<li class="${i < n ? "done" : i === n ? "current" : ""}">${name}</li>`)
      .join("")}</ol>`;
  };

  // --- 1. Bienvenida y datos ------------------------------------------------------
  function welcome() {
    html(`${stepper(0)}
      <h2>Hola, gracias por ayudar 👋</h2>
      <p>Vas a probar un <strong>mando de la tele que funciona con gestos de las manos</strong>.
        La página te guiará paso a paso; tardarás unos <strong>25 minutos</strong>.</p>
      <ul>
        <li>No hay respuestas buenas ni malas: lo que se evalúa es el mando, no tú.</li>
        <li>La cámara solo se usa dentro de tu navegador. <strong>No se graba ni se envía ninguna imagen.</strong>
          Al final se descarga un archivo con los gestos que detectó el mando, y ese archivo es lo que tienes que enviar.</li>
        <li>Necesitas un sitio con buena luz, sentarte a unos <strong>2 pasos (1,5 m o más)</strong> del portátil y tener a mano un vaso y el móvil.</li>
      </ul>
      <form id="fData" class="form">
        <label>Tu nombre o iniciales <input name="code" required maxlength="20" placeholder="p. ej. Ana" /></label>
        <label>¿Eres diestro/a o zurdo/a?
          <select name="hand"><option>diestra</option><option>zurda</option><option>ambidiestra</option></select></label>
        <label>Luz de la habitación
          <select name="light"><option>natural (de día)</option><option>lámpara o luz del techo</option><option>poca luz</option></select></label>
        <label>Distancia aproximada a la cámara (metros)
          <input name="distance" type="number" min="0.5" max="5" step="0.1" value="1.5" required /></label>
        <button type="submit" class="primary">Siguiente →</button>
      </form>
      <p class="small"><button type="button" class="link" id="bFree">Saltar el asistente (modo libre)</button></p>`);
    $("#fData").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      state.participant = {
        code: String(f.get("code")).trim().replaceAll("·", "-") || "anónimo",
        hand: f.get("hand"),
        light: f.get("light"),
        distance: f.get("distance"),
      };
      api.clearLog();
      api.logAction(
        "participante",
        `${state.participant.code} · distancia ${state.participant.distance} m · ${state.participant.hand} · luz ${state.participant.light} · orden ${state.order.join(" → ")}`
      );
      camera();
    });
    $("#bFree").addEventListener("click", () => {
      root.hidden = true;
    });
  }

  // --- 2. Cámara --------------------------------------------------------------------
  function camera() {
    html(`${stepper(1)}
      <h2>Coloca la cámara</h2>
      <div class="twoCols">
        <ol>
          <li>Pulsa <strong>«Activar cámara»</strong> y permite el acceso cuando el navegador lo pida.</li>
          <li>Pon el portátil delante de ti y siéntate a <strong>unos 2 pasos</strong>.</li>
          <li>Comprueba en la imagen que se te ve <strong>de la cintura para arriba</strong>, con sitio para levantar las dos manos.</li>
          <li>Levanta las dos manos: abajo tiene que aparecer <strong>«Veo 2 manos»</strong>.</li>
        </ol>
        <div class="checkBox">
          <button type="button" class="primary" id="bCam">Activar cámara</button>
          <p id="camStatus" class="big">Cámara apagada</p>
        </div>
      </div>
      <button type="button" class="primary" id="bNext" disabled>Siguiente →</button>`);
    const update = () => {
      if (!api.cameraOn()) return;
      const n = api.handCount();
      $("#camStatus").textContent = n === 0 ? "No veo tus manos: levántalas" : `Veo ${n} mano${n > 1 ? "s" : ""} ✓`;
      $("#bNext").disabled = false;
    };
    $("#bCam").addEventListener("click", async () => {
      $("#bCam").disabled = true;
      $("#camStatus").textContent = "Abriendo la cámara…";
      const ok = await api.enableCamera();
      if (!ok) {
        $("#bCam").disabled = false;
        $("#camStatus").textContent = "No se pudo abrir la cámara. Revisa los permisos del navegador.";
        return;
      }
      $("#bCam").hidden = true;
      api.resetPlayer();
    });
    if (api.cameraOn()) $("#bCam").hidden = true;
    every(300, update);
    $("#bNext").addEventListener("click", () => {
      clearTimers();
      practice();
    });
  }

  // --- 3. Aprender y practicar los gestos -------------------------------------------
  function practice() {
    api.setVersion("final");
    const cards = [{ id: "activar", label: "Activar el mando", howto: PHASES[0].howto }, ...PHASES.slice(1)]
      .map(
        (p) => `<article class="card" data-id="${p.id}">
          ${GESTURE_ART[p.id]}
          <h3>${p.label}</h3>
          <p>${p.howto}</p>
          <p class="practiced" hidden>¡Detectado! ✓</p>
        </article>`
      )
      .join("");
    html(`${stepper(2)}
      <h2>Aprende los gestos</h2>
      <p>Prueba cada gesto unas cuantas veces. Cuando el mando lo reconozca, su tarjeta se pondrá en verde.
        <strong>Primero activa el mando</strong> (palma quieta 1 s, barra verde) y luego haz el gesto en los 5 segundos siguientes.
        Mira el anillo que se llena alrededor de tu mano: indica que estás manteniendo bien el gesto.</p>
      <div class="cards">${cards}</div>
      <p>Practica al menos 2 o 3 minutos. Cuando te salgan, empieza la evaluación.</p>
      <button type="button" class="primary" id="bStart">Empezar la evaluación →</button>`);
    const map = {
      activar: "activar", avanzar: "avanzar", retroceder: "retroceder",
      "subir volumen": "subir volumen", "bajar volumen": "bajar volumen", cerrar: "cerrar",
      pausar: "propio 1", reanudar: "propio 1", silenciar: "propio 2", "quitar silencio": "propio 2",
    };
    state.listener = (action) => {
      const id = map[action];
      if (!id) return;
      const card = root.querySelector(`.card[data-id="${id}"]`);
      card?.classList.add("ok");
      card?.querySelector(".practiced")?.removeAttribute("hidden");
      if (action === "cerrar") after(1500, () => api.resetPlayer());
    };
    $("#bStart").addEventListener("click", () => {
      state.listener = null;
      round(0);
    });
  }

  // --- 4. Rondas ------------------------------------------------------------------
  function round(r) {
    const version = state.order[r];
    const v = VERSION_TEXT[version];
    api.setVersion(version);
    api.resetPlayer();
    state.results[version] = {};
    html(`${stepper(3 + r)}
      <h2>Ronda ${r + 1} de 2 · ${v.name}</h2>
      <p class="big">${v.intro}</p>
      <p>Vas a hacer cada gesto varias veces cuando te lo pida la pantalla. Cada intento funciona así:</p>
      <ol class="big">
        <li>Cuando veas <strong>«¡Ahora!»</strong>, haz el gesto <strong>UNA sola vez</strong>.</li>
        <li>Si el mando lo reconoce, verás <strong>«¡Hecho!»</strong>: baja las manos y espera al siguiente intento.</li>
        <li>Si no pasa nada, <strong>no lo repitas</strong>: espera a que se acabe la barra. Un intento fallido también es un dato útil.</li>
      </ol>
      <p>Al final de la ronda hay 3 minutos de actividad normal.</p>
      <button type="button" class="primary" id="bGo">Empezar la ronda →</button>`);
    $("#bGo").addEventListener("click", () => {
      const phases = PHASES.filter((p) => !p.onlyFinal || version === "final");
      runPhase(r, version, phases, 0);
    });
  }

  function runPhase(r, version, phases, i) {
    if (i >= phases.length) {
      activity(r, version);
      return;
    }
    const p = phases[i];
    const code = state.participant.code;
    html(`${stepper(3 + r)}
      <div class="phaseHead">
        <div class="artBig">${GESTURE_ART[p.id]}</div>
        <div>
          <p class="small">Ronda ${r + 1} · gesto ${i + 1} de ${phases.length}</p>
          <h2>${p.label}</h2>
          <p class="big">${p.howto}</p>
          <p class="hint">Un gesto por intento: hazlo una sola vez, aunque no funcione.</p>
          ${version === "final" && p.id !== "activar" ? '<p class="hint">Si la barra del mando no está verde, actívalo primero (palma quieta 1 s): eso no cuenta como repetir.</p>' : ""}
          <button type="button" class="primary" id="bReady">Estoy listo/a →</button>
        </div>
      </div>`);
    $("#bReady").addEventListener("click", () => {
      api.resetPlayer();
      if (p.id === "subir volumen") api.setVolume(0.3);
      if (p.id === "bajar volumen") api.setVolume(0.8);
      api.logAction("marca", `inicio · ${code} · ${p.id}`);
      state.results[version][p.id] = [];
      attempt(r, version, phases, i, 1);
    });
  }

  function attempt(r, version, phases, i, k) {
    const p = phases[i];
    const code = state.participant.code;
    const marks = state.results[version][p.id];
    if (k > p.attempts) {
      api.logAction("marca", `fin · ${code} · ${p.id}`);
      state.listener = null;
      const ok = marks.filter((m) => m === "✓").length;
      html(`${stepper(3 + r)}
        <h2>${p.label}: ${ok} de ${p.attempts} ✓</h2>
        <p class="marks">${marks.map((m) => `<span class="mark m${markClass(m)}">${m}</span>`).join("")}</p>
        ${LEGEND}
        <p>${ok === p.attempts ? "¡Perfecto!" : "No pasa nada si algunos fallan: es justo lo que queremos medir."}</p>
        <button type="button" class="primary" id="bNext">Siguiente gesto →</button>`);
      $("#bNext").addEventListener("click", () => runPhase(r, version, phases, i + 1));
      return;
    }

    const windowMs = WINDOW_MS[version];
    const seen = [];
    let resting = false;
    // Descanso: empieza al acabar la ventana o, antes, en cuanto el mando reconoce el
    // gesto pedido. Las acciones que lleguen durante el descanso siguen contando para
    // este intento (así se detectan los disparos dobles).
    const startRest = (text, cls) => {
      if (resting) return;
      resting = true;
      const cue = $("#cue");
      cue.textContent = text;
      cue.className = `cue ${cls}`;
      after(REST_MS, finishAttempt);
    };
    const counts = (action) => p.id === "activar" || action !== "activar";
    state.listener = (action) => {
      seen.push(action);
      if (counts(action)) startRest("¡Hecho! Baja las manos", "done");
    };
    html(`${stepper(3 + r)}
      <div class="phaseHead">
        <div class="artBig">${GESTURE_ART[p.id]}</div>
        <div>
          <p class="small">${p.label} · intento ${k} de ${p.attempts}</p>
          <p id="cue" class="cue go">¡Ahora! Haz el gesto una vez</p>
          <div class="bar"><div id="barFill"></div></div>
          <p id="modeEcho" class="small"></p>
          <p class="marks">${marks.map((m) => `<span class="mark m${markClass(m)}">${m}</span>`).join("")}</p>
          ${LEGEND}
        </div>
      </div>`);
    const t0 = performance.now();
    every(100, () => {
      const fill = $("#barFill");
      if (fill && !resting) fill.style.width = `${Math.min(100, ((performance.now() - t0) / windowMs) * 100)}%`;
      const echo = $("#modeEcho");
      if (echo) echo.textContent = api.modeText();
    });
    after(windowMs, () => startRest("Baja las manos", "rest"));

    function finishAttempt() {
      clearTimers();
      state.listener = null;
      const mark = classify(seen, p);
      marks.push(mark);
      api.logAction("intento", `${code} · ${p.id} · ${k} · ${mark}`);
      if (p.id === "cerrar") api.resetPlayer();
      attempt(r, version, phases, i, k + 1);
    }
  }

  function classify(seen, p) {
    const actions = p.id === "activar" ? seen : seen.filter((a) => a !== "activar");
    const correct = actions.filter((a) => p.expect.includes(a)).length;
    const other = actions.length - correct;
    if (other > 0) return "≠";
    if (correct === 0) return "✗";
    return correct === 1 ? "✓" : "2";
  }

  const LEGEND = `<p class="small legend">✓ reconocido una vez · ✗ no se reconoció · 2 se activó varias veces · ≠ hizo otra cosa</p>`;

const markClass = (m) => ({ "✓": "ok", "✗": "no", 2: "dbl", "≠": "other" })[m] ?? "no";

  // --- 5. Actividad normal (3 min) ------------------------------------------------
  function activity(r, version) {
    const code = state.participant.code;
    html(`${stepper(3 + r)}
      <h2>3 minutos de actividad normal</h2>
      <p class="big">Ahora <strong>NO intentes controlar el mando</strong>. Haz como si estuvieras en el sofá viendo la tele
        y sigue las indicaciones que irán apareciendo. Si el vídeo se para o cambia, ignóralo.</p>
      <button type="button" class="primary" id="bGo">Empezar los 3 minutos →</button>`);
    $("#bGo").addEventListener("click", () => {
      api.resetPlayer();
      let count = 0;
      state.listener = () => {
        count++;
      };
      api.logAction("marca", `inicio · ${code} · actividad normal`);
      const t0 = performance.now();
      html(`${stepper(3 + r)}
        <h2>Actividad normal</h2>
        <p id="prompt" class="cue activity"></p>
        <div class="bar"><div id="barFill"></div></div>
        <p id="left" class="small"></p>`);
      const tick = () => {
        const e = performance.now() - t0;
        const idx = Math.min(ACTIVITY_PROMPTS.length - 1, Math.floor(e / (ACTIVITY_MS / ACTIVITY_PROMPTS.length)));
        $("#prompt").textContent = ACTIVITY_PROMPTS[idx];
        $("#barFill").style.width = `${Math.min(100, (e / ACTIVITY_MS) * 100)}%`;
        $("#left").textContent = `Quedan ${Math.max(0, Math.ceil((ACTIVITY_MS - e) / 1000))} s`;
      };
      tick();
      every(500, tick);
      after(ACTIVITY_MS, () => {
        clearTimers();
        state.listener = null;
        state.involuntary[version] = count;
        api.logAction("marca", `fin · ${code} · actividad normal`);
        api.resetPlayer();
        if (r === 0) betweenRounds();
        else finish();
      });
    });
  }

  function betweenRounds() {
    html(`${stepper(4)}
      <h2>¡Ronda 1 terminada! 🎉</h2>
      <p>Descansa un momento. La ronda 2 es igual, pero con la otra versión del mando.</p>
      <button type="button" class="primary" id="bGo">Ir a la ronda 2 →</button>`);
    $("#bGo").addEventListener("click", () => round(1));
  }

  // --- 6. Resultados y descarga ----------------------------------------------------
  function finish() {
    const rows = PHASES.map((p) => {
      const cell = (version) => {
        const m = state.results[version]?.[p.id];
        return m ? `${m.filter((x) => x === "✓").length} / ${m.length}` : "—";
      };
      return `<tr><td>${p.label}</td><td>${cell("sinDefensas")}</td><td>${cell("final")}</td></tr>`;
    }).join("");
    api.logAction(
      "resumen",
      `${state.participant.code} · involuntarias sin defensas ${state.involuntary.sinDefensas ?? "-"} · final ${state.involuntary.final ?? "-"}`
    );
    const filename = `evaluacion-${state.participant.code.replace(/[^\w-]+/g, "_")}.csv`;
    html(`${stepper(5)}
      <h2>¡Terminado! Muchas gracias 🙌</h2>
      <p class="big">Se ha descargado el archivo <strong>${filename}</strong>.
        <strong>Envíaselo a la persona que te pasó el enlace</strong> (por correo, WhatsApp…). Es lo único que hace falta.</p>
      <button type="button" class="primary" id="bDl">Descargar el archivo otra vez</button>
      <h3>Tus resultados</h3>
      <table class="summary">
        <thead><tr><th>Gesto</th><th>Versión A (sin defensas)</th><th>Versión B (final)</th></tr></thead>
        <tbody>${rows}
          <tr><td>Acciones sin querer (3 min)</td><td>${state.involuntary.sinDefensas ?? "—"}</td><td>${state.involuntary.final ?? "—"}</td></tr>
        </tbody>
      </table>`);
    api.downloadLog(filename);
    $("#bDl").addEventListener("click", () => api.downloadLog(filename));
  }

  if (new URLSearchParams(location.search).has("libre")) root.hidden = true;
  else welcome();
}
