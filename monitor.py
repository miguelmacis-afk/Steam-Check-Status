import os
import asyncio
from playwright.async_api import async_playwright
import aiohttp

WEBHOOK_URL = os.getenv("WEBHOOK_URL")

STATUS_EMOJI = {
    "online": "🟢",
    "minor": "🟡",
    "major": "🔴",
    "offline": "⚫"
}

async def fetch_discord(session, content):
    if not WEBHOOK_URL:
        print("No se definió WEBHOOK_URL en los secrets")
        return
    data = {"content": content}
    async with session.post(WEBHOOK_URL, json=data) as resp:
        if resp.status != 204:
            text = await resp.text()
            print(f"Error enviando a Discord: {resp.status}, {text}")

async def get_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("https://steamstat.us/", timeout=60000)
        # Espera que cargue la sección principal
        await page.wait_for_selector("div.status-grid", timeout=60000)
        
        # Extrae todos los bloques de servicio
        services = await page.evaluate("""
() => {
    const items = document.querySelectorAll('div.status-grid > div.status-item');
    return Array.from(items).map(s => {
        const name = s.querySelector('div.status-title')?.innerText || '';
        const statusClass = s.querySelector('div.status-dot')?.className || '';
        return { name, statusClass };
    });
}
""")

        result = []
        for s in services:
            name_el = await s.query_selector("div.status-title")
            status_el = await s.query_selector("div.status-dot")
            if name_el and status_el:
                name = (await name_el.inner_text()).strip()
                status_class = await status_el.get_attribute("class")  # ej: "status-dot online"
                if "online" in status_class:
                    emoji = STATUS_EMOJI["online"]
                elif "minor" in status_class:
                    emoji = STATUS_EMOJI["minor"]
                elif "major" in status_class:
                    emoji = STATUS_EMOJI["major"]
                else:
                    emoji = STATUS_EMOJI["offline"]
                result.append(f"{emoji} {name}")
        
        await browser.close()
        return result

async def main():
    try:
        services = await get_steam_status()
        if not services:
            print("No se pudo obtener el estado de Steam.")
            return
        message = "**Steam Status Update**\n" + "\n".join(services)
        async with aiohttp.ClientSession() as session:
            await fetch_discord(session, message)
        print("Mensaje enviado a Discord con éxito.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
