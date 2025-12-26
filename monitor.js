import { chromium } from "playwright";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function getSteamStatus() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto("https://steamstat.us/", { waitUntil: "networkidle" });

        // Pequeña espera para que el JS renderice los bloques
        await page.waitForTimeout(5000);

        // Scrapeamos todos los divs que contengan 'service' en su clase
        const status = await page.evaluate(() => {
            const blocks = Array.from(document.querySelectorAll("div.service"));
            return blocks.map(b => {
                const name = b.querySelector("div.service-name")?.innerText.trim() || "Desconocido";
                const stat = b.querySelector("div.service-status")?.innerText.trim() || "Desconocido";
                return { name, stat };
            });
        });

        return status;
    } catch (err) {
        console.error("Error al obtener los datos:", err.message);
        return null;
    } finally {
        await browser.close();
    }
}

async function sendDiscord(status) {
    if (!status || status.length === 0) return;

    const content = status.map(s => {
        const emoji = s.stat.includes("Online") ? "🟢" : "🔴";
        return `${emoji} **${s.name}**: ${s.stat}`;
    }).join("\n");

    try {
        await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content })
        });
    } catch (err) {
        console.error("Error al enviar al Discord:", err.message);
    }
}

async function main() {
    const status = await getSteamStatus();
    await sendDiscord(status);
}

main();
