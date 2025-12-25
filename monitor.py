import requests
import json
import re
import os
from pathlib import Path
from datetime import datetime, timedelta
import matplotlib.pyplot as plt

# Config
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
REPORT_THRESHOLD = 100
REGION_PERCENT_THRESHOLD = 20

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

# ---------------- Downdetector ----------------
def get_downdetector_data():
    r = requests.get("https://downdetector.com/status/steam/", timeout=10)
    match = re.search(r'__NEXT_DATA__\s*=\s*({.*?});', r.text, re.S)
    data = json.loads(match.group(1))
    status = data["props"]["pageProps"]["dehydratedState"]["queries"][0]["state"]["data"]["status"]
    reports = status["report"]
    regions = [f"{r['name']} ({r['percent']}%)" for r in status.get("regions", []) if r['percent'] >= REGION_PERCENT_THRESHOLD]
    return reports, regions

# ---------------- History / Graph ----------------
def update_history(reports, regions, current_status, last_state):
    history = load_json(HISTORY_FILE, [])

    now = datetime.utcnow()

    # Detectar inicio de caída
    if current_status == "DOWN" and last_state.get("status") != "DOWN":
        history.append({"start": now.strftime("%Y-%m-%d %H:%M"), "end": None, "max_reports": reports, "regions": regions})
    # Si sigue caída, actualizar pico y regiones
    elif current_status == "DOWN" and last_state.get("status") == "DOWN" and history:
        last = history[-1]
        last["max_reports"] = max(last["max_reports"], reports)
        last["regions"] = list(set(last["regions"] + regions))
    # Si recuperación
    elif current_status == "UP" and last_state.get("status") == "DOWN" and history:
        last = history[-1]
        last["end"] = now.strftime("%Y-%m-%d %H:%M")
        last["max_reports"] = max(last["max_reports"], reports)
        last["regions"] = regions

    # Guardar solo últimos 7 días
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
        values += [h["max_reports"], h["max_reports"]]

    plt.figure(figsize=(10,4))
    plt.plot(times, values, marker='o')
    plt.axhline(REPORT_THRESHOLD, color='red', linestyle='--', label='Threshold')
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.title("Steam – Reportes Downdetector (Últimos 7 días)")
    plt.ylabel("Reportes")
    plt.xlabel("Hora")
    plt.legend()
    plt.savefig(GRAPH_FILE)
    plt.close()

# ---------------- Discord ----------------
def send_webhook(status, reports, regions):
    color = 0xFF0000 if status=="DOWN" else 0x00FF00
    title = "🔴 Steam CAÍDO" if status=="DOWN" else "🟢 Steam ONLINE"
    description = f"📉 **Reportes actuales:** {reports}\n"
    if regions:
        description += "\n🌍 **Regiones afectadas:**\n" + "\n".join(f"• {r}" for r in regions)
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

    last_state = load_json(STATE_FILE, {"status":"UP","regions":[]})

    reports, regions = get_downdetector_data()
    current_status = "DOWN" if reports >= REPORT_THRESHOLD else "UP"

    if current_status != last_state.get("status") or regions != last_state.get("regions"):
        history = update_history(reports, regions, current_status, last_state)
        generate_graph(history)
        send_webhook(current_status, reports, regions)

    last_state["status"] = current_status
    last_state["regions"] = regions
    save_json(STATE_FILE, last_state)

if __name__ == "__main__":
    main()
