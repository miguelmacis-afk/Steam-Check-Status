# monitor.py
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUTPUT_HTML = Path("steamstat.html")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://steamstat.us/")

        # Esperar a que los elementos de servicios estén cargados
        await page.wait_for_selector(".service .status", timeout=15000)

        # Guardar HTML completo
        html_content = await page.content()
        OUTPUT_HTML.write_text(html_content, encoding="utf-8")
        print(f"HTML guardado en {OUTPUT_HTML}")

        # Extraer servicios y estados
        services = {}
        service_elements = await page.query_selector_all(".service")
        for service in service_elements:
            name_elem = await service.query_selector(".name")
            status_elem = await service.query_selector(".status")
            if name_elem and status_elem:
                name = (await name_elem.inner_text()).strip()
                status = (await status_elem.inner_text()).strip()
                services[name] = status

        # Orden recomendado: Steam Connection Managers primero
        sorted_services = sorted(services.items(), key=lambda x: 0 if "Steam Connection Managers" in x[0] else 1)

        # Mostrar con emojis
        for name, status in sorted_services:
            if any(x in status.lower() for x in ["offline", "down", "0"]):
                emoji = "🔴"
            elif "%" in status:
                emoji = "🟡"
            else:
                emoji = "🟢"
            print(f"{emoji} {name}: {status}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
