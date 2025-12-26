import os
import asyncio
import aiohttp
from playwright.async_api import async_playwright

WEBHOOK_URL = os.getenv("WEBHOOK_URL")

# Almacena el estado anterior para detectar cambios
previous_status = {}

async def get_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("https://steamstats.us/lander", timeout=60000)

        # Obtener todo el texto visible de la página
        body_text = await page.locator("body").all_text_contents()
        await browser.close()

        status = {}
        for line in body_text:
            # Procesar líneas tipo "Steam ONLINE" o "Steam Market: Normal"
            parts = line.split(":")
            if len(parts) == 2:
                key = parts[0].strip()
                val = parts[1].strip()
                status[key] = val
            else:
                # Líneas sin ":" las consideramos estado principal
                line_clean = line.strip()
                if line_clean:
                    status[line_clean] = "✅" if "ONLINE" in line_clean else line_clean
        return status

async def send_discord_message(content):
    async with aiohttp.ClientSession() as session:
        webhook_data = {"content": content}
        async with session.post(WEBHOOK_URL, json=webhook_data) as resp:
            if resp.status != 204:
                text = await resp.text()
                print("Error al enviar webhook:", resp.status, text)

def format_status(status):
    """Devuelve un string elegante para Discord con emojis"""
    lines = []
    for key, val in status.items():
        emoji = "🟢" if "Normal" in val or "ONLINE" in val else "🔴"
        lines.append(f"{emoji} **{key}:** {val}")
    return "\n".join(lines)

async def main():
    global previous_status
    while True:
        try:
            current_status = await get_steam_status()
        except Exception as e:
            print("Error al obtener el estado de Steam:", e)
            await asyncio.sleep(60)
            continue

        # Compara con el estado anterior
        if current_status != previous_status:
            previous_status = current_status
            message = format_status(current_status)
            print("Enviando actualización al Discord:\n", message)
            await send_discord_message(message)
        else:
            print("Sin cambios desde la última verificación.")

        await asyncio.sleep(300)  # Espera 5 minutos antes de la siguiente verificación

if __name__ == "__main__":
    asyncio.run(main())
