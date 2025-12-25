import json
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import matplotlib.pyplot as plt
import os

WEBHOOK_URL = os.environ.get("WEBHOOK_URL")
STATE_FILE = Path("state.json")
HISTORY_FILE = Path("history.json")
GRAPH_FILE = Path("steam_history.png")

# ---------------- JSON helpers ----------------
def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2))

# ---------------- Scrap Steamstat ----------------
def get_steam_status():
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get("https://steamstat.us/", headers=headers, timeout=10)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    # Estado global
    overall_div = soup.find("div", class_="status-global")
    overall_online = True
    if overall_div:
        overall_online = "online" in overall_div.get("class", [])

    # Estado por servicios
    services = {}
    service_divs = soup.select(".status-item")
    for div in service_divs:
        name_tag = div.select_one(".status-item__name")
        status_tag = div.select_one(".status-item__status")
        if name_tag and status_tag:
            name = name_tag.text.strip()
            classes = status_tag.get("class", [])
            services[name] = "Normal" if "online" in classes else "Problemas"

    return not overall_online, services  # True = down, False = online

# ---------------- Actualizar historial ----------------
def update_history(overall_online):
    history = load_json(HISTORY_FILE, [])
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    if not history or history[-1].get("end") is not None:
        if not overall_online:
            history.append({"start": now, "end": None})
    else:
        if overall_online:
            history[-1]["end"] = now
    return history

# ---------------- Generar gráfica ----------------
def generate_graph(history):
    if not history:
        plt.figure(figsize=(10,2))
        plt.step([0,1],[1,1], where='post', color='red')
        plt.yticks([0,1], ["Down","Up"])
        plt.title("Historial de caídas de Steam")
        plt.savefig(GRAPH_FILE)
        plt.close()
        return

    times = []
    states = []
    for h in history:
        times.append(datetime.strptime(h["start"], "%Y-%m-%d %H:%M:%S"))
        states.append(0 if h["end"] is None else 1)
    plt.figure(figsize=(10,2))
    plt.step(times, states, where='post', color='red')
    plt.yticks([0,1], ["Down","Up"])
    plt.title("Historial de caídas de Steam")
    plt.savefig(GRAPH_FILE)
    plt.close()

# ---------------- Enviar webhook ----------------
def send_webhook(overall_down, services):
    if not WEBHOOK_URL:
        return
    try:
        status_text = "Steam DOWN ❌" if overall_down else "Steam ONLINE ✅"
        # Texto legible sin la hora
        fields_text = "\n".join([f"{k}: {v}" for k, v in services.items()])
        embed = {
            "title": status_text,
            "description": fields_text,
            "color": 15158332 if overall_down else 3066993
        }
        requests.post(WEBHOOK_URL, json={"embeds":[embed]}, timeout=10)
    except Exception as e:
        print("Error enviando webhook:", e)

# ---------------- Main ----------------
def main():
    last_state = load_json(STATE_FILE, {"down": True})

    overall_down, services = get_steam_status()
    overall_online = not overall_down

    history = update_history(overall_online)
    generate_graph(history)

    # Guardar siempre JSON
    save_json(STATE_FILE, {"down": overall_down})
    save_json(HISTORY_FILE, history)

    # Enviar Discord solo si cambio de estado
    if overall_down != last_state.get("down"):
        send_webhook(overall_down, services)

if __name__ == "__main__":
    main()
