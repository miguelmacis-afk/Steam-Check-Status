import json
from pathlib import Path
import requests
from datetime import datetime

WEBHOOK_URL = "tu_discord_webhook_aqui"
STATE_FILE = Path("state.json")
HISTORY_FILE = Path("history.json")

# Funciones para JSON
def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2))

# Función de ejemplo para scrapear Steamstat
def get_steam_status():
    headers = {
        "User-Agent": "Mozilla/5.0"
    }
    r = requests.get("https://steamstat.us/status", headers=headers, timeout=10)
    r.raise_for_status()
    # Aquí debes parsear la página y devolver un dict con estado
    # Ejemplo simple:
    return {"online": True}

# Actualiza historial
def update_history(overall, status):
    history = load_json(HISTORY_FILE, [])
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    if not history or history[-1].get("end") is not None:
        if not overall:  # Nueva caída
            history.append({"start": now, "end": None})
    else:
        if overall:  # Termina caída
            history[-1]["end"] = now
    return history

# Envía webhook
def send_webhook(status, overall):
    try:
        data = {
            "content": None,
            "embeds": [{
                "title": "Steam Status Update",
                "description": f"Steam {'DOWN' if not overall else 'ONLINE'}",
                "color": 15158332 if not overall else 3066993,
            }]
        }
        requests.post(WEBHOOK_URL, json=data, timeout=10)
    except Exception as e:
        print("Error enviando webhook:", e)

def main():
    last_state = load_json(STATE_FILE, {"down": True})
    status = get_steam_status()
    overall = status.get("online", True)

    # Siempre guardar JSON
    history = update_history(overall, status)
    save_json(STATE_FILE, {"down": overall})
    save_json(HISTORY_FILE, history)

    # Solo enviar webhook si cambia
    if overall != last_state.get("down"):
        send_webhook(status, overall)

if __name__ == "__main__":
    main()
