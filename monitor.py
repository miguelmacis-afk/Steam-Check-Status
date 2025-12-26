import os
import asyncio
import json
import requests
from playwright.async_api import async_playwright

# URL del webhook de Discord (de GitHub Secrets)
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
# Archivo para guardar el estado anterior
STATE_FILE = "steam_status.json"

# Servicios de Steam que vamos a monitorear
SERVICES = [
    "Steam", "Connection Managers", "Store", "Community",
    "Web API", "Cloud", "Workshop", "Market", "Support",
    "Region NA", "Region EU", "Region ASIA"
]

# Función para enviar mensaje al Discord usando embed
def send_discord_embed(status):
    embed = {
        "title": "Steam Status Update",
        "color": 3066993 if all(s == "Normal" or "Online" in s for s in status.values()) else 15158332,
        "fields": [{"name": k, "value": v, "inline": True} for k, v in status.items()],
        "footer": {"text": "Steam Monitor"}
    }
    data = {"embeds": [embed]}
    response = requests.post(WEBHOOK_URL, json=data)
    if response.status_code != 204:
        print(f"Error sending Discord message: {response.text}")

# Función para leer el estado previo guardado
def load_previous_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {}

# Función para guardar el estado actual
def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# Función principal para monitorear Steam usando Playwright
async def get_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://steamstats.us/")  # Cambia si otra URL
        await page.wait_for_selector("table")  # Espera a que cargue la tabla

        status = {}
        rows = await page.query_selector_all("table tr")
        for row in rows:
            cols = await row.query_selector_all("td")
            if len(cols) >= 2:
                service = (await cols[0].inner_text()).strip()
                value = (await cols[1].inner_text()).strip()
                if service in SERVICES:
                    status[service] = value

        await browser.close()
        return status

async def main():
    previous_state = load_previous_state()
    current_state = await get_steam_status()

    # Compara estados
    if current_state != previous_state:
        send_discord_embed(current_state)
        save_state(current_state)
        print("State changed! Discord message sent.")
    else:
        print("No changes detected.")

if __name__ == "__main__":
    asyncio.run(main())
