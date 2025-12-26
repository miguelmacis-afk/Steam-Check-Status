import os
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = "state.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

SERVICE_ORDER = [
    "Steam Connection Managers",
    "Steam Store",
    "Steam Community",
    "Steam Web API",
    "Steam Workshop",
    "Steam Market",
    "Steam Support",
]

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def scrape_steamstat():
    r = requests.get("https://steamstat.us/", headers=HEADERS, timeout=20)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    services = {}

    rows = soup.select("table.services tr")
    if not rows:
        raise Exception("Steamstat no devolvió servicios")

    for row in rows:
        cols = row.find_all("td")
        if len(cols) < 2:
            continue

        name = cols[0].get_text(strip=True)
        status = cols[1].get_text(strip=True)

        services[name] = status

    return services

def is_bad(status):
    s = status.lower()
    return any(x in s for x in ["down", "outage", "offline", "critical"])

def status_emoji(status):
    if "%" in status:
        return "🟡"
    if is_bad(status):
        return "🔴"
    if "no verificado" in status.lower():
        return "⚪"
    return "🟢"

def send_discord(services, verified):
    fields = []

    for name in SERVICE_ORDER:
        if name not in services:
            continue
        status = services[name]
        emoji = status_emoji(status)
        fields.append({
            "name": f"{emoji} {name}",
            "value": status,
            "inline": False
        })

    payload = {
        "embeds": [{
            "title": "Steam ONLINE",
            "color": 0x57F287 if verified else 0xFAA61A,
            "fields": fields,
            "footer": {
                "text": f"Actualizado: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
            }
        }]
    }

    requests.post(WEBHOOK_URL, json=payload, timeout=20)

def main():
    prev_state = load_state()
    verified = True

    try:
        services = scrape_steamstat()
    except Exception as e:
        print(f"⚠️ Steamstat sin datos ({e})")
        verified = False

        if "services" in prev_state:
            services = prev_state["services"]
        else:
            services = {
                "Steam Connection Managers": "Estado no verificado",
                "Steam Store": "Estado no verificado",
                "Steam Community": "Estado no verificado",
                "Steam Web API": "Estado no verificado",
                "Steam Workshop": "Estado no verificado",
                "Steam Market": "Estado no verificado",
                "Steam Support": "Estado no verificado",
            }

    changed = services != prev_state.get("services")

    if changed:
        send_discord(services, verified)
        save_state({
            "services": services,
            "verified": verified,
            "updated": datetime.utcnow().isoformat()
        })
        print("✅ Cambio detectado, enviado a Discord")
    else:
        print("ℹ️ Sin cambios, no se envía nada")

if __name__ == "__main__":
    main()
