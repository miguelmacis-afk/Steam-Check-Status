import requests
import os
import json
import datetime
from bs4 import BeautifulSoup

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = "state.json"

BAD_KEYWORDS = ["outage", "offline", "issues", "problem", "down"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0 Safari/537.36"
    )
}

# -------------------------
# STATE
# -------------------------

def load_state():
    if not os.path.exists(STATE_FILE):
        return {
            "last_global": None,
            "last_services": {}
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
    return any(bad in status.lower() for bad in BAD_KEYWORDS)

# -------------------------
# SCRAPE STEAMSTAT
# -------------------------

def scrape_steamstat():
    """
    Devuelve dict de servicios.
    Si Steamstat no responde correctamente, devuelve None (NO rompe).
    """
    try:
        r = requests.get("https://steamstat.us/", headers=HEADERS, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print("⚠️ Error accediendo a Steamstat:", e)
        return None

    services = {}

    soup = BeautifulSoup(r.text, "html.parser")

    for row in soup.find_all("tr"):
        cols = row.find_all("td")
        if len(cols) < 2:
            continue

        name = cols[0].get_text(strip=True)
        status = cols[1].get_text(strip=True)

        # solo servicios de Steam
        if name.lower().startswith("steam") and status:
            services[name] = status

    if not services:
        print("⚠️ Steamstat no devolvió servicios (HTML vacío)")
        return None

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

        fields.append({
            "name": name,
            "value": f"{emoji} {status}",
            "inline": False
        })

    embed = {
        "title": title,
        "color": color,
        "fields": fields,
        "footer": {
            "text": f"Actualizado: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
        }
    }

    try:
        requests.post(
            WEBHOOK_URL,
            json={"embeds": [embed]},
            timeout=10
        )
    except Exception as e:
        print("Error enviando webhook:", e)

# -------------------------
# MAIN
# -------------------------

def main():
    state = load_state()

    services = scrape_steamstat()

    # si Steamstat falló, usamos último estado válido
    if services is None:
        print("Usando último estado guardado")
        services = state.get("last_services", {})

    # si aún no hay servicios (primer run o primer fallo)
    if not services:
        print("No hay servicios disponibles, enviando estado no verificado")
        services = {
            "Steam Store": "Estado no verificado",
            "Steam Community": "Estado no verificado",
            "Steam Web API": "Estado no verificado",
            "Steam Connection Managers": "Estado no verificado"
        }

    steam_down = any(is_bad(status) for status in services.values())

    # evitar spam: solo enviar si cambia el estado global
    if state.get("last_global") == steam_down:
        print("Sin cambios globales, no se envía Discord")
    else:
        send_webhook(services, steam_down)

    # guardar estado
    state["last_global"] = steam_down
    state["last_services"] = services
    save_state(state)

# -------------------------

if __name__ == "__main__":
    main()
