"""Calcula la tabla de la evaluación a partir de los CSV del registro de acciones.

Uso:
    python3 tools/analizar.py registro-P1.csv registro-P2.csv registro-P3.csv
    python3 tools/analizar.py evaluacion/*.csv --propio1 "pausar,reanudar" --propio2 "silenciar,quitar silencio"

Cada CSV es el que descarga la página («Descargar CSV»). Durante la evaluación hay que
marcar el inicio y el fin de cada fase con los botones «Empezar fase» / «Terminar fase»:
así el registro sabe a qué fase pertenece cada acción.

Qué calcula, por versión (final / sinDefensas) y gesto:
  - Acciones correctas en las fases de aciertos (la acción esperada para esa fase).
  - Acciones erróneas en esas fases (cualquier otra acción del reproductor).
  - Activaciones involuntarias: acciones durante la «actividad normal» (3 min),
    separadas por tipo de gesto. La activación del mando se cuenta aparte: no cambia
    el vídeo, pero indica cuántas veces se «despertó» sin querer.
  - Latencia mediana (ms) desde que empieza el gesto hasta la acción, y su categoría
    (inmediato, menos de medio segundo, más de medio segundo).

Aciertos por intento: con el modo guiado, la página clasifica cada intento y lo escribe
en el registro como una fila «intento» (✓ correcta una vez, ✗ nada, 2 varias veces,
≠ otra acción). Si hay filas «intento», los aciertos son el número de ✓. Si no las hay
(evaluación manual), el registro no sabe dónde empieza cada intento: se dan las acciones
correctas y los aciertos se anotan a mano.

Solo usa la biblioteca estándar (csv, statistics), para que funcione sin instalar nada.
"""

import argparse
import csv
import statistics
from collections import defaultdict

# Filas de la tabla del enunciado → fases de la página que las alimentan
GESTURE_ROWS = {
    "Activación": ["activar"],
    "Avanzar o retroceder": ["avanzar", "retroceder"],
    "Subir o bajar el volumen": ["subir volumen", "bajar volumen"],
    "Cerrar el vídeo": ["cerrar"],
    "Propio 1": ["propio 1"],
    "Propio 2": ["propio 2"],
}

# Acción del registro que se espera en cada fase
EXPECTED = {
    "activar": {"activar"},
    "avanzar": {"avanzar"},
    "retroceder": {"retroceder"},
    "subir volumen": {"subir volumen"},
    "bajar volumen": {"bajar volumen"},
    "cerrar": {"cerrar"},
    "propio 1": {"pausar", "reanudar"},
    "propio 2": {"silenciar", "quitar silencio"},
}

# Para repartir las activaciones involuntarias entre las filas de la tabla
ACTION_TO_ROW = {
    "activar": "Activación",
    "avanzar": "Avanzar o retroceder",
    "retroceder": "Avanzar o retroceder",
    "subir volumen": "Subir o bajar el volumen",
    "bajar volumen": "Subir o bajar el volumen",
    "cerrar": "Cerrar el vídeo",
}


def reaction_category(ms):
    if ms is None:
        return "—"
    if ms <= 200:
        return "inmediato"
    if ms <= 500:
        return "< 0,5 s"
    return "> 0,5 s"


# Filas del registro que no son acciones del mando
NOT_ACTIONS = {"intento", "participante", "resumen"}


def read_log(path):
    """Devuelve una lista de segmentos: {participante, fase, version, acciones, intentos}."""
    segments = []
    current = None
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            action = row["accion"]
            if action == "marca":
                # detalle: "inicio · P1 · avanzar" o "fin · P1 · avanzar"
                kind, participant, phase = [part.strip() for part in row["detalle"].split("·")]
                if kind == "inicio":
                    current = {"participante": participant, "fase": phase, "version": row["version"],
                               "acciones": [], "intentos": []}
                    segments.append(current)
                else:
                    current = None
            elif action == "intento" and current is not None:
                # detalle: "P1 · cerrar · 3 · ✓"
                current["intentos"].append(row["detalle"].split("·")[-1].strip())
            elif action in NOT_ACTIONS:
                continue
            elif current is not None:
                latency = row.get("latencia_ms", "")
                current["acciones"].append((action, float(latency) if latency else None))
    return segments


def analyze(paths):
    stats = defaultdict(lambda: {"correctas": 0, "erroneas": 0, "involuntarias": 0, "latencias": [],
                                 "participantes": set(), "ok": 0, "intentos": 0})
    activity = defaultdict(lambda: {"segmentos": 0, "acciones": 0, "activaciones": 0})

    for path in paths:
        for seg in read_log(path):
            version = seg["version"]
            if seg["fase"] == "actividad normal":
                activity[version]["segmentos"] += 1
                for action, _ in seg["acciones"]:
                    row = ACTION_TO_ROW.get(action)
                    if row is None:  # gestos propios: se asignan por su acción
                        row = next((r for r, phases in GESTURE_ROWS.items()
                                    if any(action in EXPECTED[p] for p in phases)), "Otras")
                    stats[(version, row)]["involuntarias"] += 1
                    if action == "activar":
                        activity[version]["activaciones"] += 1
                    else:
                        activity[version]["acciones"] += 1
                continue
            row = next((r for r, phases in GESTURE_ROWS.items() if seg["fase"] in phases), None)
            if row is None:
                continue
            s = stats[(version, row)]
            s["participantes"].add(seg["participante"])
            s["ok"] += sum(1 for m in seg["intentos"] if m == "✓")
            s["intentos"] += len(seg["intentos"])
            for action, latency in seg["acciones"]:
                if action in EXPECTED[seg["fase"]]:
                    s["correctas"] += 1
                    if latency is not None:
                        s["latencias"].append(latency)
                elif action != "activar":  # activar antes de cada orden es parte del gesto
                    s["erroneas"] += 1
    return stats, activity


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", nargs="+", help="registros descargados de la página")
    parser.add_argument("--propio1", default="pausar,reanudar", help="acciones del gesto propio 1")
    parser.add_argument("--propio2", default="silenciar,quitar silencio", help="acciones del gesto propio 2")
    args = parser.parse_args()
    EXPECTED["propio 1"] = {a.strip() for a in args.propio1.split(",")}
    EXPECTED["propio 2"] = {a.strip() for a in args.propio2.split(",")}

    stats, activity = analyze(args.csv)

    print("| Versión | Gesto | Participantes | Aciertos (✓ / intentos) | Acciones correctas | Acciones erróneas | "
          "Activaciones involuntarias | Latencia mediana (ms) | Tiempo de reacción |")
    print("|---|---|---|---|---|---|---|---|---|")
    for version in ["sinDefensas", "final"]:
        for row in GESTURE_ROWS:
            s = stats.get((version, row))
            if not s:
                continue
            lat = statistics.median(s["latencias"]) if s["latencias"] else None
            aciertos = f"{s['ok']} / {s['intentos']}" if s["intentos"] else "a mano"
            print(f"| {version} | {row} | {len(s['participantes'])} | {aciertos} | {s['correctas']} | {s['erroneas']} | "
                  f"{s['involuntarias']} | {'' if lat is None else round(lat)} | {reaction_category(lat)} |")

    print()
    for version, a in activity.items():
        print(f"{version}: {a['segmentos']} fases de actividad normal (3 min) · "
              f"{a['acciones']} acciones involuntarias sobre el vídeo · {a['activaciones']} activaciones del mando")


if __name__ == "__main__":
    main()
