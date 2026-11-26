// gestureArt.js — Dibujos de los gestos (SVG) para el modo guiado.
// Se ven tal como la persona se ve en la pantalla (en espejo). Los colores salen de
// variables CSS (--hand-fill, --hand-stroke, --arrow) para que funcionen en modo claro
// y oscuro. Las manos se dibujan centradas en el origen y se colocan con transform.

// Mano abierta, palma hacia la cámara, vista en espejo (pulgar a la izquierda)
// (el pulgar se dibuja primero para que la palma tape su base y parezca unido)
const OPEN = `
  <rect x="-39.5" y="-16" width="15" height="46" rx="7.5" transform="rotate(-40 -32 30)"/>
  <rect x="-35" y="-30" width="70" height="72" rx="14"/>
  <rect x="-33" y="-74" width="15" height="50" rx="7.5"/>
  <rect x="-16" y="-82" width="15" height="58" rx="7.5"/>
  <rect x="1" y="-78" width="15" height="54" rx="7.5"/>
  <rect x="18" y="-64" width="14" height="42" rx="7"/>`;

// Puño derecho, pulgar recogido por delante
const FIST = `
  <rect x="-38" y="-40" width="76" height="76" rx="20"/>
  <path d="M-19 -40V-16M0 -40V-16M19 -40V-16" fill="none"/>
  <rect x="-38" y="2" width="54" height="18" rx="9"/>`;

// Mano derecha DE CANTO (palma mirando de lado, como un cuchillo), dedos hacia arriba:
// desde la cámara se ve estrecha. Es la postura de avanzar/retroceder del enunciado.
const BLADE = `
  <rect x="2" y="-22" width="14" height="44" rx="7" transform="rotate(32 9 18)"/>
  <rect x="-15" y="-30" width="30" height="72" rx="12"/>
  <rect x="-13" y="-88" width="24" height="64" rx="11"/>
  <path d="M-5 -84V-30M3 -80V-30" fill="none"/>`;

// Mano derecha con el índice estirado EN HORIZONTAL apuntando a la izquierda de la
// pantalla (hacia la palma izquierda), resto de dedos doblados. Postura de volumen.
const POINT_H = `
  <rect x="-38" y="-40" width="76" height="76" rx="20"/>
  <rect x="-104" y="-38" width="70" height="17" rx="8.5"/>
  <path d="M-38 -10H-14M-38 10H-14" fill="none"/>`;

const hand = (shape, transform) => `<g class="hand" transform="${transform}">${shape}</g>`;
const arrow = (x1, y1, x2, y2) =>
  `<line class="arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ga-head)"/>`;
const label = (x, y, text) => `<text class="artLabel" x="${x}" y="${y}" text-anchor="middle">${text}</text>`;

function svg(body, title) {
  return `<svg viewBox="0 0 200 170" role="img" aria-label="${title}" class="gestureArt">
    <defs><marker id="ga-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5"
      orient="auto-start-reverse"><path d="M1 1L9 5L1 9z" class="arrowHead"/></marker></defs>
    ${body}</svg>`;
}

export const GESTURE_ART = {
  activar: svg(
    `${hand(OPEN, "translate(100 100) scale(0.8)")}
     <circle class="ring" cx="100" cy="82" r="62"/>
     ${label(100, 166, "quieta 1 segundo")}`,
    "Palma derecha abierta hacia la cámara, quieta"
  ),
  avanzar: svg(
    `${hand(BLADE, "translate(78 100) scale(0.8)")}
     ${arrow(110, 105, 188, 105)}
     ${label(100, 166, "rápido hacia tu derecha")}`,
    "Mano derecha abierta de canto, dedos arriba, desplazándose hacia la derecha"
  ),
  retroceder: svg(
    `${hand(BLADE, "translate(122 100) scale(0.8)")}
     ${arrow(90, 105, 12, 105)}
     ${label(100, 166, "rápido hacia tu izquierda")}`,
    "Mano derecha abierta de canto, dedos arriba, desplazándose hacia la izquierda"
  ),
  "subir volumen": svg(
    `${hand(OPEN, "translate(55 105) scale(-0.6 0.6)")}
     ${hand(POINT_H, "translate(142 118) scale(0.55)")}
     ${arrow(186, 110, 186, 40)}
     ${label(100, 166, "izquierda quieta, derecha arriba")}`,
    "Palma izquierda abierta y la mano derecha con el índice en horizontal, subiendo"
  ),
  "bajar volumen": svg(
    `${hand(OPEN, "translate(55 105) scale(-0.6 0.6)")}
     ${hand(POINT_H, "translate(142 82) scale(0.55)")}
     ${arrow(186, 70, 186, 140)}
     ${label(100, 166, "izquierda quieta, derecha abajo")}`,
    "Palma izquierda abierta y la mano derecha con el índice en horizontal, bajando"
  ),
  cerrar: svg(
    `${hand(FIST, "translate(100 85) scale(0.9)")}
     <circle class="ring ringRed" cx="100" cy="82" r="62"/>
     ${label(100, 166, "puño derecho, mantenlo")}`,
    "Puño con la mano derecha"
  ),
  "propio 1": svg(
    `${hand(OPEN, "translate(100 125) scale(0.55)")}
     ${hand(OPEN, "translate(115 52) rotate(-90) scale(0.55)")}
     ${label(100, 166, "«T» de tiempo muerto")}`,
    "Una mano horizontal sobre la punta de los dedos de la otra, vertical, formando una T"
  ),
  "propio 2": svg(
    `${hand(OPEN, "translate(82 110) rotate(28) scale(0.55)")}
     ${hand(OPEN, "translate(118 110) rotate(-28) scale(-0.55 0.55)")}
     ${label(100, 166, "manos cruzadas en «X»")}`,
    "Las dos manos abiertas cruzadas por las muñecas formando una X"
  ),
};
