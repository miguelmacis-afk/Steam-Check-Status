import requests
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
import matplotlib.pyplot as plt

# ------------ Config ------------
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = Path("state.json")
HISTORY_FILE = Path("history.json")
GRAPH_FILE = "steam_supply_status.png"
CHECK_KEY = "community"  # puedes cambiar a "api", "ingame", etc.

# --------- Helpers ----------
def load_json(file, default):
    if file.exists():
        return json.loads(file.read_text())
    return default

def save_json(file, data):
    file.write_text(json.dumps(data, indent=2))

# --------- Fetch Steam Supply API ----------
def get_steam_supply():
    url = "http://steam.supply/API/LOGIN/getStatus"
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    return r.json()

# --------- Update history ----------
def update_history(is_down, last_state):
    history = load_json(HISTORY_FILE, [])
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    
    # If it went down
    if is_down and last_state["status"] != "DOWN":
        history.append({"start": now, "end": None})
    # If it recovered
    elif not is_down and last_state["status"] == "DOWN" and history:
        last = history[-1]
        last["end"] = now

    # keep only 7 days
    cutoff = datetime.utcnow() - timedelta(days=7)
    history = [h for h in history 
               if datetime.strptime(h["start"], "%Y-%m-%d %H:%M") > cutoff]

    save_json(HISTORY_FILE, history)
    return history

def generate_graph(history):
    if not history:
        return
    dates = []
    values = []
    for h in history:
        start = datetime.strptime(h["start"], "%Y-%m-%d %H:%M")
        end = datetime.strptime(h["end"], "%Y-%m-%d %H:%M") if h["end"] else datetime.utcnow()
        dates += [start, end]
        values += [1, 1]
    plt.figure(figsize=(10,2))
    plt.plot(dates, values, marker="o", color="red")
    plt.yticks([0,1], ["Online","Down"])
    plt.title("Steam Supply - Estado de Steam (últimos 7 días)")
    plt.tight_layout()
    plt.savefig(GRAPH_FILE)
    plt.close()

# --------- Webhook ----------
def send_webhook(status):
    import datetime
    color = 0xFF0000 if status == "DOWN" else 0x00FF00
    title = "🔴 Steam CAÍDO" if status == "DOWN" else "🟢 Steam ONLINE"
    description = f"Estado de servicio: {status}"
    payload = {"embeds": [{
        "title": title,
        "description": description,
        "color": color,
        "timestamp": datetime.datetime.utcnow().isoformat()
    }]}
    files = None
    if Path(GRAPH_FILE).exists():
        files = {"file": open(GRAPH_FILE,"rb")}
    requests.post(WEBHOOK_URL, data={"payload_json": json.dumps(payload)}, files=files)

# --------- Main ----------
def main():
    if not WEBHOOK_URL:
        raise RuntimeError("WEBHOOK_URL no está definido")

    last_state = load_json(STATE_FILE, {"status": "UP"})

    data = get_steam_supply()
    # is_down if the chosen segment is not alive
    is_down = not data.get(CHECK_KEY, {}).get("alive", True)
    current_status = "DOWN" if is_down else "UP"

    if current_status != last_state["status"]:
        history = update_history(is_down, last_state)
        generate_graph(history)
        send_webhook(current_status)

    last_state["status"] = current_status
    save_json(STATE_FILE, last_state)

if __name__ == "__main__":
    main()
