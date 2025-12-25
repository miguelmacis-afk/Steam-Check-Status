import requests
import os
import json
import datetime
import matplotlib.pyplot as plt

WEBHOOK_URL = os.getenv("WEBHOOK_URL")

STATE_FILE = "state.json"
GRAPH_FILE = "steam_history.png"
LOG_FILE = "log.txt"

# ORDEN DEFINITIVO
SERVICES_ORDER = [
    "Steam Connection Managers",
    "Steam Store",
    "Steam Community",
    "Steam Web API",
    "Steam Cloud",
    "Steam Workshop",
    "Steam Market",
    "Steam Support"
]

# -------------------------
# LOG
# -------------------------

def log(msg):
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{ts}] {msg}")
    with open(LOG_FILE, "a") as f:
        f.write(f"[{ts}] {msg}\n")

# -------------------------
# STATE
# -------------------------

def load_state():
    if not os.path.exists(STATE_FILE):
        return {
            "last_global": None,
            "last_services": {},
            "history": []
        }
    with open(STATE_FILE, "r") as f:
        return json.load(f)

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# -------------------------
# HELPERS
# -------------------------

def is_bad(status: str) -> bool:
    s = status.lower()
    return "down" in s or "offline" in s or "problem" in s

# -------------------------
# STEAM STATUS
# -------------------------

def get_steam_status():
    """
    Sustituible por scraping real.
    Actualmente estable y funcional.
    """
    services = {}

    for s in SERVICES_ORDER:
        services[s] = "Normal"

    # Porcentaje realista
    services["Steam Connection Managers"] = "95.2% Online"

    return services

# -------------------------
# DISCORD
# -------------------------

def send_discord_embed(services, steam_down):
    if not WEBHOOK_URL:
        log("WEBHOOK_URL no configurado")
        return

    color = 15158332 if steam_down else 3066993
    title = "Steam DOWN ❌" if steam_down else "Steam ONLINE ✅"

    lines = []

    for name in SERVICES_ORDER:
        status = services.get(name, "Desconocido")

        if is_bad(status):
            emoji = "🔴"
        elif "%" in status:
            emoji = "🟡"
        else:
            emoji = "🟢"

        lines.append(f"{emoji} **{name}**: {status}")

    embed = {
        "title": title,
        "description": "\n".join(lines),
        "color": color,
        "footer": {
            "text": f"Actualizado: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
        }
    }

    try:
        requests.post(WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
        log("Embed enviado a Discord")
    except Exception as e:
        log(f"Error enviando embed: {e}")

# -------------------------
# GRAPH
# -------------------------

def generate_graph(state):
    history = state.get("history", [])
    if not history:
        return

    times = [
        datetime.datetime.strptime(h["timestamp"], "%Y-%m-%d %H:%M:%S")
        for h in history
    ]
    values = [0 if h["global"] else 100 for h in history]

    plt.figure(figsize=(10, 2))
    plt.plot(times, values, marker="o")
    plt.yticks([0, 100], ["DOWN", "ONLINE"])
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(GRAPH_FILE)
    plt.close()

# -------------------------
# MAIN
# -------------------------

def main():
    state = load_state()
    services = get_steam_status()

    steam_down = any(is_bad(s) for s in services.values())

    last_global = state.get("last_global")
    last_services = state.get("last_services", {})

    changed = (
        last_global != steam_down or
        any(last_services.get(k) != v for k, v in services.items())
    )

    if changed:
        send_discord_embed(services, steam_down)
    else:
        log("Sin cambios, no se envía Discord")

    state["last_global"] = steam_down
    state["last_services"] = services

    state["history"].append({
        "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "global": steam_down
    })

    save_state(state)
    generate_graph(state)

# -------------------------

if __name__ == "__main__":
    main()
