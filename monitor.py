import requests
import os
import json
import datetime
import re
from bs4 import BeautifulSoup

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = "state.json"

BAD_KEYWORDS = ["outage", "offline", "issues", "problem", "down"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

def load_state():
    if not os.path.exists(STATE_FILE):
        return {"last_status": None}
    with open(STATE_FILE, "r") as f:
        return json.load(f)

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def is_bad(status):
    return any(bad in status.lower() for bad in BAD_KEYWORDS)

def scrape_steamstat():
    r = requests.get("https://steamstat.us/", headers=HEADERS, timeout=15)
    r.raise_for_status()

    match = re.search(r'__INITIAL_STATE__\s*=\s*({.*?});', r.text, re.S)
    if not match:
        raise Exception("No se pudo leer estado interno de Steamstat")

    data = json.loads(match.group(1))
    services = {}

    for service in data["services"]:
        name = service["name"]
        status = service["status"]
        services[name] = status

    # Connection Managers
    cm = data.get("connectionManagers", {})
    if "onlinePercent" in cm:
        services["Steam Connection Managers"] = f'{cm["onlinePercent"]}% Online'

    return services
def send_webhook(services, steam_down):
    if not WEBHOOK_URL:
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

    requests.post(WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)

def main():
    services = scrape_steamstat()
    steam_down = any(is_bad(s) for s in services.values())

    state = load_state()

    if state["last_status"] == steam_down:
        print("Sin cambios, no se envía aviso.")
        return

    send_webhook(services, steam_down)

    state["last_status"] = steam_down
    save_state(state)

if __name__ == "__main__":
    main()
