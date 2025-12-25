import requests
import re
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
import matplotlib.pyplot as plt

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = Path("state.json")
HISTORY_FILE = Path("history.json")
GRAPH_FILE = "steamstat_status.png"

HEADERS = {
    "User-Agent": 
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/118.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
}

SERVICES = [
    "Steam Store",
    "Steam Community",
    "Steam Web API",
    "Steam Connection Managers"
]

def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2))

def get_steamstat_status():
    url = "https://steamstat.us/"
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    html = r.text

    status = {}
    for svc in SERVICES:
        pattern = re.escape(svc) + r".*?(Normal|Offline|Major Outage|Partial Outage)"
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if match:
            status[svc] = match.group(1).strip()
        else:
            status[svc] = "Unknown"
    return status

def is_overall_down(status):
    return any(val.lower() != "normal" for val in status.values())

def update_history(down_flag, status):
    history = load_json(HISTORY_FILE, [])
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    last = history[-1] if history else None

    if down_flag and not last:
        history.append({"start": now, "end": None})
    if down_flag and last and last["end"] is not None:
        history.append({"start": now, "end": None})
    if not down_flag and last and last["end"] is None:
        last["end"] = now

    cutoff = datetime.utcnow() - timedelta(days=7)
    history = [
        h for h in history
        if datetime.strptime(h["start"], "%Y-%m-%d %H:%M") > cutoff
    ]
    save_json(HISTORY_FILE, history)
    return history

def generate_graph(history):
    if not history:
        return
    xs, ys = [], []
    for h in history:
        start = datetime.strptime(h["start"], "%Y-%m-%d %H:%M")
        end = datetime.strptime(h["end"], "%Y-%m-%d %H:%M") if h["end"] else datetime.utcnow()
        xs += [start, end]
        ys += [1, 1]

    plt.figure(figsize=(8,2))
    plt.plot(xs, ys, marker="o", color="red")
    plt.yticks([0,1], ["OK","Down"])
    plt.title("Steamstat.us ‐ Caídas en 7 días")
    plt.tight_layout()
    plt.savefig(GRAPH_FILE)
    plt.close()

def send_webhook(status, overall):
    color = 0xFF0000 if overall else 0x00FF00
    title = "🔴 Steam CAÍDO" if overall else "🟢 Steam ONLINE"

    desc = ""
    for svc, st in status.items():
        desc += f"**{svc}**: {st}\n"

    payload = {
        "embeds": [{
            "title": title,
            "description": desc,
            "color": color,
            "timestamp": datetime.utcnow().isoformat()
        }]
    }

    files = None
    if Path(GRAPH_FILE).exists():
        files = {"file": open(GRAPH_FILE,"rb")}

    requests.post(WEBHOOK_URL, data={"payload_json": json.dumps(payload)}, files=files)

def main():
    if not WEBHOOK_URL:
        raise RuntimeError("WEBHOOK_URL no está definido")

    last_state = load_json(STATE_FILE, {"down": False})
    status = get_steamstat_status()
    overall = is_overall_down(status)

    if overall != last_state.get("down"):
        history = update_history(overall, status)
        generate_graph(history)
        send_webhook(status, overall)

    save_json(STATE_FILE, {"down": overall})

if __name__ == "__main__":
    main()
