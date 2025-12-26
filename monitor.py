import requests
import json
import os
from bs4 import BeautifulSoup
from datetime import datetime

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
STATE_FILE = "state.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

STEAMSTAT_URL = "https://steamstat.us/"

def load_state():
    if not os.path.exists(STATE_FILE):
        return {}
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_state(data):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def scrape_steamstat():
    r = requests.get(STEAMSTAT_URL, headers=HEADERS, timeout=20)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    services = {}

    table = soup.select_one("table.table tbody")
    if table:
        for row in table.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 2:
                continue
            name = cols[0].get_text(strip=True)
            status = cols[1].get_text(" ", strip=True)
            if name and status:
                services[name] = status

    # Connection Managers (% real)
    cm = soup.find("div", id="cms")
    if cm:
        services["Steam Connection Managers"] = cm.get_text(strip=True)

    return services

def is_bad(status):
    s = status.lower()
    return any(x in s for x in ["major", "down", "outage", "offline"])

def build_message(services, verified=True):
    lines = []

    global_down = any(is_bad(v) for v in services.values())
    header = "🔴 **Steam DOWN**" if global_down else "🟢 **Steam ONLINE**"
    lines.append(header)
    lines.append("")

    # Orden: Connection Managers primero
    ordered = []
    if "Steam Connection Managers" in services:
        ordered.append(("Steam Connection Managers", services["Steam Connection Managers"]))

    for k, v in services.items():
        if k != "Steam Connection Managers":
            ordered.append((k, v))

    for name, status in ordered:
        if not verified:
            emoji = "⚪"
            status = "Estado no verificado"
        elif is_bad(status):
            emoji = "🔴"
        elif "%" in status:
            emoji = "🟡"
        else:
            emoji = "🟢"

        lines.append(f"{emoji} **{name}**: {status}")

    lines.append("")
    lines.append(f"_Actualizado: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}_")

    return "\n".join(lines), global_down

def send_discord(content):
    requests.post(WEBHOOK_URL, json={"content": content}, timeout=15)

def main():
    prev_state = load_state()
    verified = True

    try:
        services = scrape_steamstat()
        if not services:
            raise Exception("HTML vacío")
    except Exception as e:
        print(f"⚠️ Steamstat sin datos ({e})")
        if "services" in prev_state:
            services = prev_state["services"]
            verified = False
        else:
            print("❌ No hay estado previo, se aborta")
            return

    message, global_down = build_message(services, verified)

    if prev_state.get("services") == services and prev_state.get("verified") == verified:
        print("ℹ️ Sin cambios, no se envía a Discord")
        return

    send_discord(message)

    save_state({
        "services": services,
        "global_down": global_down,
        "verified": verified,
        "last_update": datetime.utcnow().isoformat()
    })

    print("✅ Estado enviado y guardado")

if __name__ == "__main__":
    main()
