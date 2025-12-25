import requests
import os
import json
import datetime

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = "state.json"

# -------------------------
# STATE
# -------------------------

def load_state():
    if not os.path.exists(STATE_FILE):
        return {"last_global": None, "last_services": {}}
    with open(STATE_FILE, "r") as f:
        return json.load(f)

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# -------------------------
# HELPERS
# -------------------------

def is_bad(status: str) -> bool:
    return status.lower() not in ["normal", "online"]

def get_steam_services_status():
    """
    Devuelve un dict con cada servicio de Steam y su estado.
    """
    url = "https://api.steampowered.com/ISteamApps/GetServersAtAddress/v1/"  # ejemplo de endpoint
    # Nota: la Steam Web API no tiene endpoint público para todos los servicios.
    # Vamos a simular con los servicios clásicos usando Steamstatus API unofficial
    services = {}
    try:
        # usar un endpoint confiable: Steam Web API Status JSON
        r = requests.get("https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/", timeout=10)
        r.raise_for_status()
        data = r.json()

        # Simulamos servicios
        services["Steam Store"] = "Normal"
        services["Steam Community"] = "Normal"
        services["Steam Web API"] = "Normal"
        services["Steam Connection Managers"] = "Normal"

        # Aquí se podrían mapear valores reales del JSON si el endpoint devuelve estados
        # Para ahora, siempre enviamos Normal. Puedes reemplazar con tu endpoint real si existe.
    except Exception as e:
        print("⚠️ No se pudo obtener datos reales de la Web API:", e)
        services = {
            "Steam Store": "No verificado",
            "Steam Community": "No verificado",
            "Steam Web API": "No verificado",
            "Steam Connection Managers": "No verificado"
        }
    return services

# -------------------------
# DISCORD WEBHOOK
# -------------------------

def send_webhook(services: dict, steam_down: bool):
    if not WEBHOOK_URL:
        print("WEBHOOK_URL no configurado")
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
    except Exception as e:
        print("Error enviando webhook:", e)

# -------------------------
# MAIN
# -------------------------

def main():
    state = load_state()

    services = get_steam_services_status()

    steam_down = any(is_bad(status) for status in services.values())

    if state.get("last_global") != steam_down:
        send_webhook(services, steam_down)
    else:
        print("Sin cambios globales, no se envía Discord")

    # guardar estado
    state["last_global"] = steam_down
    state["last_services"] = services
    save_state(state)

# -------------------------

if __name__ == "__main__":
    main()
