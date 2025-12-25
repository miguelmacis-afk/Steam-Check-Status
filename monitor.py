import json
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import matplotlib.pyplot as plt

WEBHOOK_URL = "TU_DISCORD_WEBHOOK_AQUI"  # O usa os.environ["WEBHOOK_URL"]
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

    # Estado general
    overall_div = soup.find("div", class_="status-global")
    overall = True
    if overall_div and "down" in overall_div.get("class", []):
        overall = False

    # Estado por servicios
    services = {}
    service_divs = soup.select(".status-item")
    for div in service_divs:
        name = div.select_one(".status-item__name").text.strip()
        status_class = div.select_one(".status-item__status")["class"]
        services[name] = "online" if "online" in status_class else "offline"

    return overall, services

# ---------------- Actualizar historial ----------------
def update_history(overall):
    history = load_json(HISTORY_FILE, [])
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    if not history or history[-1].get("end") is not None:
        if not overall:
            history.append({"start": now, "end": None})
    else:
        if overall:
            history[-1]["end"] = now
    return history

# ---------------- Generar gráfica ----------------
def generate_graph(history):
    if not history:
        # Crear gráfico vacío de ejemplo
        plt.figure(figsize=(10,2))
        plt.step([0,1],[1,1], where='post', color='red')
        plt.yticks([0,1], ["Down","Up"])
        plt.title("Historial de caídas de Steam")
        plt.savefig(GRAPH_FILE)
        plt.close()
        return

    # Código normal para gráfica con historial
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
def send_webhook(overall, services):
    if not WEBHOOK_URL:
        return
    try:
        embed = {
            "title": f"Steam Status Update - {'DOWN' if not overall else 'ONLINE'}",
            "color": 15158332 if not overall else 3066993,
            "fields": [{"name": k, "value": v, "inline": True} for k,v in services.items()]
        }
        files = {"file": open(GRAPH_FILE, "rb")} if GRAPH_FILE.exists() else None
        data = {"embeds": [embed]}
        r = requests.post(WEBHOOK_URL, json=data, timeout=10)
        if files:
            files["file"].close()
    except Exception as e:
        print("Error enviando webhook:", e)

# ---------------- Main ----------------
def main():
    last_state = load_json(STATE_FILE, {"down": True})

    overall, services = get_steam_status()
    history = update_history(overall)
    generate_graph(history)

    # Guardar siempre JSON
    save_json(STATE_FILE, {"down": overall})
    save_json(HISTORY_FILE, history)

    # Enviar Discord solo si cambio de estado
    if overall != last_state.get("down"):
        send_webhook(overall, services)

if __name__ == "__main__":
    main()
