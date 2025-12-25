import requests
import json
import os
from datetime import datetime
from bs4 import BeautifulSoup

WEBHOOK_URL = os.getenv("WEBHOOK_URL")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

STATE_FILE = "state.json"
HISTORY_FILE = "history.json"


def get_steam_status():
    r = requests.get("https://steamstat.us/", headers=HEADERS, timeout=15)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")

    services = {
        "Steam Store": "Normal ✅",
        "Steam Community": "Normal ✅",
        "Steam Web API": "Normal ✅",
        "Steam Connection Managers": "Normal ✅"
    }

    for row in soup.select(".service"):
        name = row.select_one(".name")
        status = row.select_one(".status")

        if not name or not status:
            continue

        service_name = name.text.strip()
        service_status = status.text.strip()

        if service_name in services:
            services[service_name] = service_status

    overall_down = any(v != "Normal ✅" for v in services.values())
    return overall_down, services


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def send_discord(overall_down, services):
    if not WEBHOOK_URL:
        return

    title = "Steam ONLINE ✅" if not overall_down else "Steam DOWN ❌"
    color = 0x57F287 if not overall_down else 0xED4245

    fields = []
    for name, status in services.items():
        fields.append({
            "name": name,
            "value": status,
            "inline": False
        })

    embed = {
        "title": title,
        "color": color,
        "fields": fields,
        "footer": {
            "text": datetime.now().strftime("%Y-%m-%d %H:%M")
        }
    }

    r = requests.post(WEBHOOK_URL, json={"embeds": [embed]}, timeout=10)
    if r.status_code not in (200, 204):
        print("Discord error:", r.status_code, r.text)


def main():
    overall_down, services = get_steam_status()

    state = load_json(STATE_FILE, {})
    history = load_json(HISTORY_FILE, [])

    current_state = {
        "down": overall_down,
        "services": services
    }

    if state != current_state:
        send_discord(overall_down, services)
        save_json(STATE_FILE, current_state)

        history.append({
            "time": datetime.now().isoformat(),
            "down": overall_down
        })
        save_json(HISTORY_FILE, history)


if __name__ == "__main__":
    main()
