import requests
import os
import json
import datetime
import matplotlib.pyplot as plt

WEBHOOK_URL = os.getenv("WEBHOOK_URL")

STATE_FILE = "state.json"
GRAPH_FILE = "steam_history.png"
LOG_FILE = "log.txt"

SERVICES = [
    "Steam Connection Managers",
    "Steam Store",
    "Steam Community",
    "Steam Web API",
    "Steam Cloud",
    "Steam Workshop",
    "Steam Market",
    "Steam Support"
]

REGIONS = ["NA", "EU", "ASIA"]

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
            "last_services": {},
            "last_global": None,
            "last_ok_since": None,
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

def emoji(status):
    if is_bad(status):
        return "🔴"
    if "%" in status:
        return "🟡"
    return "🟢"

# -------------------------
# STEAM STATUS (SIMULADO ESTABLE)
# -------------------------

def get_steam_status():
    services = {}

    for s in SERVICES:
        services[s] = "Normal"

    services["Steam Connection Managers"] = "95.2% Online"

    # Regiones
    for r in REGIONS:
        services[f"Region {r}"] = "Normal"

    return services

# -------------------------
# GRAPH
# -------------------------

def generate_graph(state):
    history = state["history"]
    if not history:
        return False

    times = [
        datetime.datetime.strptime(h["timestamp"], "%Y-%m-%d %H:%M:%S")
        for h in history
    ]
    values = [100 if not h["global"] else 0 for h in history]

    plt.figure(figsize=(10, 2))
    plt.plot(times, values, marker="o")
    plt.yticks([0, 100], ["DOWN", "ONLINE"])
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(GRAPH_FILE)
    plt.close()
    return True

# -------------------------
# DISCORD
# -------------------------

def send_discord(services, steam_down, uptime, graph_exists):
    title = "Steam DOWN ❌" if steam_down else "Steam ONLINE ✅"
    color = 15158332 if steam_down else 3066993

    lines = []
    for s in services:
        lines.append(f"{emoji(services[s])} **{s}**: {services[s]}")

    description = "\n".join(lines)

    if uptime:
        description += f"\n\n⏱️ **Uptime:** {uptime}"

    embed = {
        "title": title,
        "description": description,
        "color": color,
        "footer": {
            "text": f"Actualizado: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
        }
    }

    payload = {"embeds": [embed]}

    if graph_exists:
        with open(GRAPH_FILE, "rb") as f:
            files = {"file": ("steam_history.png", f, "image/png")}
            requests.post(WEBHOOK_URL, data={"payload_json": json.dumps(payload)}, files=files)
    else:
        requests.post(WEBHOOK_URL, json=payload)

# -------------------------
# MAIN
# -------------------------

def main():
    state = load_state()
    services = get_steam_status()

    steam_down = any(is_bad(s) for s in services.values())

    changed = (
        state["last_global"] != steam_down or
        state["last_services"] != services
    )

    now = datetime.datetime.utcnow()

    if not steam_down:
        if not state["last_ok_since"]:
            state["last_ok_since"] = now.isoformat()
    else:
        state["last_ok_since"] = None

    uptime = None
    if state["last_ok_since"]:
        delta = now - datetime.datetime.fromisoformat(state["last_ok_since"])
        uptime = str(delta).split(".")[0]

    state["last_services"] = services
    state["last_global"] = steam_down

    state["history"].append({
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "global": steam_down
    })

    save_state(state)

    graph_exists = generate_graph(state)

    if changed:
        send_discord(services, steam_down, uptime, graph_exists)
        log("Estado cambiado → enviado a Discord")
    else:
        log("Sin cambios")

# -------------------------

if __name__ == "__main__":
    main()
