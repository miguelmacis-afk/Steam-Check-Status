import os
import asyncio
from playwright.async_api import async_playwright
import requests

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
last_report = {}

# Agrupación de servicios por categoría
CATEGORIES = {
    "Steam": ["Steam ONLINE", "Steam Connection Managers", "Steam Store", "Steam Community", 
              "Steam Web API", "Steam Cloud", "Steam Workshop", "Steam Market", "Steam Support"],
    "Regiones": ["Region NA", "Region EU", "Region ASIA"]
}

async def fetch_steam_status():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("https://steamstat.us/")
        
        services = await page.query_selector_all(".services .service")
        status_data = {}

        for service in services:
            name_el = await service.query_selector(".name")
            status_el = await service.query_selector(".status")
            if name_el and status_el:
                name = (await name_el.inner_text()).strip()
                status_text = (await status_el.inner_text()).strip()
                emoji = "🟢" if "normal" in status_text.lower() or "online" in status_text.lower() else "🔴"
                status_data[name] = f"{emoji} {status_text}"

        await browser.close()
        return status_data

def send_discord_embed(status_data: dict):
    if not WEBHOOK_URL:
        print("WEBHOOK_URL no configurado en secrets")
        return
    
    # Determinar estado general
    if any("🔴" in s for s in status_data.values()):
        color = 15158332  # rojo
        title = "❌ Steam OFFLINE / Problemas detectados"
    elif any("🟡" in s for s in status_data.values()):
        color = 16776960  # amarillo
        title = "⚠️ Steam Con advertencias"
    else:
        color = 3066993  # verde
        title = "🟢 Steam ONLINE ✅"
    
    # Crear campos agrupados
    fields = []
    for category, services in CATEGORIES.items():
        value = ""
        for service in services:
            if service in status_data:
                value += f"{status_data[service]}\n"
        if value:
            fields.append({"name": category, "value": value, "inline": True})

    embed = {
        "title": title,
        "color": color,
        "fields": fields,
        "footer": {"text": "Última actualización"},
    }

    requests.post(WEBHOOK_URL, json={"embeds": [embed]})

async def main():
    global last_report
    while True:
        try:
            current_status = await fetch_steam_status()
            current_key = str(current_status)
            
            if current_key != last_report.get("data"):
                send_discord_embed(current_status)
                last_report["data"] = current_key
            
            await asyncio.sleep(300)  # 5 minutos
        except Exception as e:
            requests.post(WEBHOOK_URL, json={"content": f"❌ Error al obtener estado: {e}"})
            await asyncio.sleep(300)

if __name__ == "__main__":
    asyncio.run(main())
