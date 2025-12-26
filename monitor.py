import asyncio
import os
import requests
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

WEBHOOK_URL = os.getenv("WEBHOOK_URL")

STEAMSTATS_URL = "https://steamstats.us/lander"

async def get_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(STEAMSTATS_URL, timeout=60000)

        try:
            # Espera hasta que la tabla tenga algo de contenido
            await page.wait_for_function(
                """() => {
                    const t = document.querySelector('table');
                    return t && t.innerText.length > 10;
                }""",
                timeout=60000
            )
        except Exception:
            print("⚠️ Timeout cargando tabla, usando fallback")
        
        content = await page.content()
        await browser.close()

        soup = BeautifulSoup(content, "html.parser")
        table = soup.find("table")
        if not table:
            # fallback: buscar filas de texto en divs o preformateado
            text = soup.get_text()
            status = {}
            for line in text.splitlines():
                if ":" in line:
                    key, val = line.split(":", 1)
                    status[key.strip()] = val.strip()
            return status

        # Extraemos filas
        status = {}
        for row in table.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) >= 2:
                name = cols[0].text.strip()
                state = cols[1].text.strip()
                status[name] = state
        return status

def format_discord_message(status: dict) -> dict:
    """Devuelve el payload formateado para Discord embed"""
    if "error" in status:
        return {"content": f"❌ {status['error']}"}

    description = ""
    for k, v in status.items():
        emoji = "🟢" if "Normal" in v or "Online" in v else "🔴"
        description += f"{emoji} **{k}**: {v}\n"

    return {
        "embeds": [
            {
                "title": "Steam Status Monitor",
                "description": description,
                "color": 3066993  # azul
            }
        ]
    }

def send_to_discord(payload):
    if not WEBHOOK_URL:
        print("❌ WEBHOOK_URL no definido en secrets")
        return
    response = requests.post(WEBHOOK_URL, json=payload)
    if response.status_code != 204 and response.status_code != 200:
        print(f"❌ Error enviando a Discord: {response.status_code} - {response.text}")
    else:
        print("✅ Mensaje enviado a Discord correctamente")

async def main():
    status = await get_steam_status()
    payload = format_discord_message(status)
    send_to_discord(payload)

if __name__ == "__main__":
    asyncio.run(main())
