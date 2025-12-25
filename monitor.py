import requests
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
import matplotlib.pyplot as plt
import time

# ---------------- Config ----------------
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = Path("state.json")
HISTORY_FILE = Path("history.json")
GRAPH_FILE = "steam_reports.png"

# ---------------- Utils ----------------
def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2))

# ---------------- Steamstat.us ----------------
def get_steam_status(retries=3):
    url = "https://steamstat.us/api/v2/status.json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/117.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    for attempt in range(retries):
        try:
            r = requests.get(url, headers=headers, timeout=10)
            r.raise_for_status()
            data = r.json()
            status = data["status"]["players"]["status"]  # good / minor_outage / major_outage
            reports = 0 if status != "good" else 1
            return reports, []
        except Exception as e:
            print(f"Intento {attempt+1} fallido: {e}")
            time.sleep(2)
    raise Exception("No se pudo obtener datos de Steamstat.us después de varios intentos")

# ---------------- History / Graph ----------------
def update_history(reports, current_status, last_state):
    history = load_json(HISTORY_FILE, [])
    now = datetime.utcnow()

    # Inicio de caída
    if current_status == "DOWN" and last_state.get("status") != "DOWN":
        history.append({"start": now.strftime("%Y-%m-%d %H:%M"), "end": None})
    # Recuperación
    elif current_status == "UP" and last_state.get("status") == "DOWN" and history:
        last = history[-1]
        last["end"] = now.strftime("%Y-%m-%d %H:%M")

    # Guardar últimos 7 días
    cutoff = now - timedelta(days=7)
    history = [h for h in history if datetime.strptime(h["start"], "%Y-%m-%d %H:%M") > cutoff]

    save_json(HISTORY_FILE, history)
    return history

def generate_graph(history):
    if not history:
        return
    times = []
    values = []
    for h in history:
        start = datetime.strptime(h["start"], "%Y-%m-%d %H:%M")
        end = datetime.strptime(h["end"], "%Y-%m-%d %H:%M") if h["end"] else datetime.utcnow()
        times += [start, end]
        values += [1, 1]  # indicador de caída

    plt.figure(figsize=(10, 2))
    plt.plot(times, values, marker='o', color='red')
    plt.yticks([0, 1], ["Online", "Caído"])
    plt.title("Steam – Historial de caídas (Últimos 7 días)")
    plt.tight_layout()
    plt.savefig(GRAPH_FILE)
    plt.close()

# ---------------- Discord ----------------
def send_webhook(status):
    import datetime, requests
    color = 0xFF0000 if status=="DOWN" else 0x00FF00
    title = "🔴 Steam CAÍDO" if status=="DOWN" else "🟢 Steam ONLINE"
    description = f"Estado actual: {status}"
    payload = {"embeds":[{"title":title,"description":description,"color":color,"timestamp":datetime.utcnow().isoformat()}]}
    try:
        files = {"file": open(GRAPH_FILE, "rb")} if Path(GRAPH_FILE).exists() else None
        if files:
            requests.post(WEBHOOK_URL, data={"payload_json": json.dumps(payload)}, files=files, timeout=10)
        else:
            requests.post(WEBHOOK_URL, json=payload, timeout=10)
    except Exception as e:
        print("Error enviando webhook:", e)

# ---------------- Main ----------------
def main():
    if not WEBHOOK_URL:
        raise RuntimeError("WEBHOOK_URL no definido")

    last_state = load_json(STATE_FILE, {"status":"UP"})
    reports, _ = get_steam_status()
    current_status = "DOWN" if reports < 1 else "UP"

    # Anti-spam: solo si cambia
    if current_status != last_state.get("status"):
        history = update_history(reports, current_status, last_state)
        generate_graph(history)
        send_webhook(current_status)

    last_state["status"] = current_status
    save_json(STATE_FILE, last_state)

if __name__ == "__main__":
    main()
