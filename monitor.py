import asyncio
from playwright.async_api import async_playwright
import aiohttp
import os

WEBHOOK_URL = os.environ.get("WEBHOOK_URL")

async def get_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        try:
            await page.goto("https://steamstats.us/lander", timeout=15000)  # 15s max
            # Intento de esperar la tabla, con timeout más corto
            await page.wait_for_selector("table", timeout=10000)
            table_html = await page.inner_html("table")
            await browser.close()
            return table_html
        except Exception as e:
            await browser.close()
            return None  # No se pudo cargar

async def send_discord(message):
    async with aiohttp.ClientSession() as session:
        await session.post(WEBHOOK_URL, json={"content": message})

async def main():
    status = await get_steam_status()
    if status:
        # Aquí parsea la tabla y genera el mensaje bonito
        message = "🟢 Steam ONLINE ✅\n..."  # personaliza
    else:
        message = "⚠️ No se pudo obtener la tabla de SteamStats."
    await send_discord(message)

if __name__ == "__main__":
    asyncio.run(main())
