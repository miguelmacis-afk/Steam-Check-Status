import requests
import os
import json
import datetime
import matplotlib.pyplot as plt

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = "state.json"
LOG_FILE = "log.txt"
GRAPH_FILE = "steam_history.png"

SERVICES = [
    "Steam Store",
    "Steam Community",
    "Steam Web API",
    "Steam Connection Managers",
    "Steam Cloud",
    "Steam Workshop",
    "Steam Market",
    "Steam Support"
]

# -------------------------
# STATE
# -------------------------

def load_state():
    if not os.path.exists(STATE_FILE):
        return {"last_global": None, "last_services": {}, "history": []}
    with open(STATE_FILE, "r") as f:
        return json.load(f)

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# -------------------------
# LOGGING
# -------------------------

def log(msg):
    timestamp = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    print(f"[{timestamp}] {msg}")
    with open(LOG_FILE, "a") as f:
        f.write(f"[{timestamp}] {msg}\n")

# -------------------------
# STEAM STATUS SIMULADO
# -------------------------

def get_steam_status():
    """
    Obtiene estado de los servicios de Steam.
    Retorna dict con valores: 'Normal', 'No verificado', 'Problem'...
    """
    services = {}
    try:
        # Aquí puedes usar un endpoint real si lo tienes.
        # Por ahora simulamos todos online
        for s in SERVICES:
            services[s] = "Normal"

        # Ejemplo de porcentaje para Connection Managers
        services["Steam Connection Managers"] = "95.2% Online"

    except Exception as e:
        log(f"Error obteniendo estado de Steam: {e}")
        for s in SERVICES:
            services[s] = "No verificado"
    return services

# -------------------------
# EMBED DISCORD
# -------------------------

def is_bad(status: str) -> bool:
    return "problem" in status.lower() or "offline" in status.lower() or "down" in status.lower()

def send_discord_embed(services: dict, steam_down: bool):
    if not WEBHOOK_URL:
        log("WEBHOOK_URL no configurado")
        return

    color = 15158332 if steam_down else 3066993
    title = "Steam DOWN ❌" if steam_down else "Steam ONLINE ✅"

    fields = []
    for name, status in services.items():
        if is_bad(status):
            emoji = "🔴"
        elif "%" in status:
            emoji = "🟡"
        else:
            emoji = "🟢"
        fields.append({"name": name, "value": f"{emoji} {status}", "inline": False})

    embed = {
        "title": title,
        "color": color,
        "fields": fields,
        "footer": {"text": f"Actualizado: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"}
    }

    try:
        requests.post(WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
        log("Embed enviado a Discord")
    except Exception as e:
        log(f"Error enviando embed a Discord: {e}")

# -------------------------
# GRAFICA DE HISTORICO
# -------------------------

def generate_graph(state):
    history = state.get("history", [])
    if not history:
        return

    timestamps = [datetime.datetime.strptime(h["timestamp"], "%Y-%m-%d %H:%M:%S") for h in history]
    values = [0 if h["global"] else 100 for h in history]  # 0 down, 100 online

    plt.figure(figsize=(10,2))
    plt.plot(timestamps, values, marker="o")
    plt.yticks([0,100], ["DOWN","ONLINE"])
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(GRAPH_FILE)
    plt.close()
    log(f"Gráfica generada: {GRAPH_FILE}")

# -------------------------
# MAIN
# -------------------------

def main():
    state = load_state()
    services = get_steam_status()

    steam_down = any(is_bad(s) for s in services.values())

    # Compara con último estado global y servicios
    last_global = state.get("last_global")
    last_services = state.get("last_services", {})

    changed = last_global != steam_down or any(last_services.get(k) != v for k,v in services.items())

    if changed:
        send_discord_embed(services, steam_down)
    else:
        log("Sin cambios, no se envía Discord")

    # Guardar estado
    state["last_global"] = steam_down
    state["last_services"] = services

    # Guardar histórico
    history_entry = {"timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), "global": steam_down}
    state.setdefault("history", []).append(history_entry)

    save_state(state)
    generate_graph(state)

# -------------------------

if __name__ == "__main__":
    main()
