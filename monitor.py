import asyncio
import requests
from playwright.async_api import async_playwright
import os

WEBHOOK_URL = os.environ.get("WEBHOOK_URL")

STATUS_URL = "https://steamstats.us/lander"

async def get_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)  # Cambiar a False para debug local
        page = await browser.new_page()
        try:
            await page.goto(STATUS_URL, timeout=30000)
            # Espera a que la tabla de estado cargue filas
            await page.wait_for_function(
                "document.querySelector('table') && document.querySelector('table').rows.length > 1",
                timeout=30000
            )

            # Obtener todas las filas de la tabla
            rows = await page.query_selector_all("table tr")
            status_list = []
            for row in rows:
                cells = await row.query_selector_all("td")
                if len(cells) >= 2:
                    name = (await cells[0].inner_text()).strip()
                    value = (await cells[1].inner_text()).strip()
                    status_list.append((name, value))
            return status_list
        except Exception as e:
            await browser.close()
            return f"ERROR: {e}"
        finally:
            await browser.close()

def format_discord_message(status):
    if isinstance(status, str) and status.startswith("ERROR"):
        return f"⚠️ {status}"
    
    # Emoji según estado
    lines = []
    for name, value in status:
        if "Normal" in value or "Online" in value:
            emoji = "🟢"
        elif "Down" in value or "Offline" in value:
            emoji = "🔴"
        else:
            emoji = "🟡"
        lines.append(f"{emoji} **{name}:** {value}")
    return "\n".join(lines)

def send_to_discord(message):
    if not WEBHOOK_URL:
        print("No se encontró WEBHOOK_URL en las variables de entorno.")
        return
    payload = {"content": message}
    try:
        requests.post(WEBHOOK_URL, json=payload)
    except Exception as e:
        print(f"Error enviando a Discord: {e}")

async def main():
    status = await get_steam_status()
    message = format_discord_message(status)
    send_to_discord(message)

if __name__ == "__main__":
    asyncio.run(main())
