import asyncio
import os
import json
import requests
from playwright.async_api import async_playwright

WEBHOOK_URL = os.getenv("WEBHOOK_URL")  # Tu webhook de Discord desde secrets

async def get_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://steamstat.us/", timeout=60000)

        # Esperamos a que la sección de estados esté cargada
        await page.wait_for_selector("div.status-grid", timeout=60000)

        # Scrapeamos usando evaluate para obtener todos los estados
        status_data = await page.evaluate("""
        () => {
            const data = [];
            document.querySelectorAll("div.status-grid div.status-item").forEach(item => {
                const name = item.querySelector("h3")?.innerText || "Desconocido";
                const status = item.querySelector("div.status")?.innerText || "Desconocido";
                const emoji = status.includes("Online") ? "🟢" : status.includes("Offline") ? "🔴" : "🟡";
                data.push({name, status, emoji});
            });
            return data;
        }
        """)

        await browser.close()
        return status_data

def send_to_discord(status_data):
    # Creamos un mensaje elegante
    content = "**Steam Status Update**\n"
    for service in status_data:
        content += f"{service['emoji']} **{service['name']}**: {service['status']}\n"

    # Enviamos al webhook
    response = requests.post(WEBHOOK_URL, json={"content": content})
    if response.status_code == 204:
        print("Mensaje enviado correctamente al Discord.")
    else:
        print("Error enviando al Discord:", response.text)

async def main():
    try:
        status_data = await get_steam_status()
        if not status_data:
            print("No se pudo obtener el estado de Steam.")
            return
        send_to_discord(status_data)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
