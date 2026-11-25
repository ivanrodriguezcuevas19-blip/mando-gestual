# P2 · El mando gestual del salón

Mando de un reproductor de vídeo con gestos de las manos (MediaPipe Hand Landmarker
1.2.2), con defensas contra el problema de Midas.

## Modo guiado (evaluación sin observador)

Al abrir la página aparece un asistente que lleva a cada participante paso a paso:
datos (código, distancia, mano dominante, luz) → cámara → aprender y practicar los gestos
(con dibujos) → dos rondas, una con cada versión en orden aleatorio → resultados.

En cada ronda la página pide cada gesto varias veces (10 intentos, o 5 + 5 en los gestos
con dos sentidos). Cada intento tiene una ventana para hacer el gesto (5 s sin defensas,
7 s con defensas, porque hay que activar antes) y 2,5 s para bajar las manos, y se
clasifica solo: ✓ la acción correcta una vez, ✗ nada, 2 varias veces, ≠ otra acción.
Después vienen 3 minutos de actividad normal guiada (hablar gesticulando, beber, móvil…).
Al final se descarga `evaluacion-<nombre>.csv`, que es lo que hay que enviar.

- `?libre` en la dirección oculta el asistente (página de la plantilla, para grabar el vídeo).
- `?prueba` acorta la evaluación (1 intento por gesto, 10 s de actividad): solo para probar la página.
- El «Panel técnico», plegado al final, tiene la versión, la depuración, la evaluación manual y el registro.

La página se puede publicar tal cual en GitHub Pages.

## Ejecutar en local

1. El vídeo `video.mp4` es «Big Buck Bunny» (© 2008 Blender Foundation, CC BY 3.0),
   recomprimido a 320×180 para que pese menos de 25 MB. También se puede elegir otro
   vídeo del ordenador con «Elegir vídeo».
2. Sirve la carpeta con un servidor que admita saltar en el vídeo (peticiones parciales):
   - `npx serve` (desde esta carpeta) y abre la dirección que indique, o
   - la extensión Live Server de VS Code.

   Con `python3 -m http.server` el vídeo se reproduce, pero no se puede avanzar ni retroceder.
3. Pulsa «Activar cámara». Para comparar GPU y CPU, añade `?delegate=cpu` a la URL.

## Gestos (versión final)

| Gesto | Cómo | Acción |
|---|---|---|
| Activación | Palma derecha abierta hacia la cámara, quieta 1 s | El mando escucha 5 s (cada orden renueva el tiempo) |
| Avanzar / retroceder | Palma derecha abierta desplazándose hacia tu derecha / izquierda | ±10 s |
| Cerrar | Puño derecho mantenido 0,7 s | Detiene y oculta el vídeo |
| Volumen | Índice derecho extendido + palma izquierda hacia la cámara; mover la derecha arriba / abajo | ±10 % |
| Pausar (propio 1) | «T» de tiempo muerto: una mano horizontal y la otra vertical tocándola, 0,5 s | Pausa / reanuda |
| Silenciar (propio 2) | «X»: manos abiertas cruzadas por las muñecas, 0,5 s | Silencia / quita el silencio |

## Versiones y evaluación

- El selector «Versión» cambia entre **Final** y **Sin defensas** (solo los gestos). También
  se puede abrir directamente con `?version=sinDefensas`. Las casillas activan o desactivan
  cada defensa por separado.
- En «Evaluación», marca el inicio y el fin de cada fase. La actividad normal dura
  3 minutos y termina sola.
- Descarga el registro (CSV) al terminar con cada participante y calcula la tabla con:

  ```bash
  python3 tools/analizar.py registro-P1.csv registro-P2.csv registro-P3.csv
  ```

## Ficheros

| Fichero | Contenido |
|---|---|
| `index.html`, `style.css` | Página (plantilla + selector de versión, depuración y evaluación) |
| `index.js` | Plantilla; sección 6: conecta los gestos con el reproductor, el estado y el anillo de progreso |
| `gestures.js` | Heurísticas de los gestos y defensas (sin DOM) |
| `guide.js` | Modo guiado: asistente de la evaluación y clasificación automática de intentos |
| `gestureArt.js` | Dibujos SVG de los gestos |
| `tests/` | Tests de `gestures.js` con manos sintéticas: `node --test tests/gestures.test.mjs` |
| `tools/analizar.py` | Tabla de resultados a partir de los CSV del registro |
