import requests
import json
import time
import re
import os
from pathlib import Path
from datetime import datetime, timedelta
import matplotlib.pyplot as plt

# ================= CONFIG =================
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
CHECK_INTERVAL = 300           # 5 minutos
REPORT_THRESHOLD = 100         # reportes para considerar caída
REGION_PERCENT_THRESHOLD = 20  # % mínimo para región afectada
# ==========================================

STATE_FILE = Path("state.json")
HISTORY_FILE = Path("history.json")
GRAPH_FILE = "steam_reports.png"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}

# ---------- Utils ----------
def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2))

# ---------- Downdetector ----------
def get_downdetector_data():
    r = requests.get(
        "https://downdetector.com/status/steam/",
        headers=HEADERS,
        timeout=10
    )

    match = re.search(r'__NEXT_DATA__\s*=\s*({.*?});', r.text, re.S)
    if not match:
        raise Exception("No se pudo leer Downdetector")

    data = json.loads(match.group(1))
    status = data["props"]["pageProps"]["dehydratedState"]["queries"][0]["state"]["data"]["status"]

    reports = status["report"]

    regions = [
        f"{r['name']} ({r['percent']}%)"
        for r in status.get("regions", [])
        if r["percent"] >= REGION_PERCENT_THRESHOLD
    ]

    return reports, regions

# ---------- History / Graph ----------
def update_history(reports):
    history = load_json(HISTORY_FILE, [])
    now = datetime.utcnow()

    history.append({
        "time": now.strftime("%Y-%m-%d %H:%M"),
        "reports": reports
    })

    cutoff = now - timedelta(hours=24)
    history = [
        h for h in history
        if datetime.strptime(h["time"], "%Y-%m-%d %H:%M") > cutoff
    ]

    save_json(HISTORY_FILE, history)
    return history

def generate_graph(history):
    times = [h["time"] for h in history]
    values = [h["reports"] for h in history]

    plt.figure(figsize=(10, 4))
    plt.plot(times, values)
    plt.axhline(REPORT_THRESHOLD)
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.title("Steam – Reportes Downdetector (24h)")
    plt.ylabel("Reportes")
    plt.xlabel("Hora")

    plt.savefig(GRAPH_FILE)
    plt.close()

# ---------- Discord ----------
def send_webhook(status, reports, regions, attach_graph):
    color = 0xFF0000 if status == "DOWN" else 0x00FF00
    title = "🔴 Steam CAÍDO" if status == "DOWN" else "🟢 Steam ONLINE"

    description = f"📉 **Reportes actuales:** {reports}\n"
    if regions:
        description += "\n🌍 **Regiones afectadas:**\n"
        description += "\n".join(f"• {r}" for r in regions)

    payload = {
        "embeds": [{
            "title": title,
            "description": description,
            "color": color,
            "footer": {"text": "Fuente: Downdetector"},
            "timestamp": datetime.utcnow().isoformat()
        }]
    }

    if attach_graph:
        with open(GRAPH_FILE, "rb") as f:
            requests.post(
                WEBHOOK_URL,
                data={"payload_json": json.dumps(payload)},
                files={"file": f},
                timeout=10
            )
    else:
        requests.post(WEBHOOK_URL, json=payload, timeout=10)

# ---------- Main loop ----------
def main():
    if not WEBHOOK_URL:
        raise RuntimeError("WEBHOOK_URL no está definido")

    state = load_json(STATE_FILE, {"status": "UNKNOWN", "regions": []})

    while True:
        try:
            reports, regions = get_downdetector_data()
            history = update_history(reports)

            current_status = "DOWN" if reports >= REPORT_THRESHOLD else "UP"

            if (
                current_status != state["status"] or
                regions != state["regions"]
            ):
                generate_graph(history)
                send_webhook(current_status, reports, regions, attach_graph=True)
                save_json(STATE_FILE, {
                    "status": current_status,
                    "regions": regions
                })

            time.sleep(CHECK_INTERVAL)

        except Exception as e:
            print("Error:", e)
            time.sleep(60)

if __name__ == "__main__":
    main()
