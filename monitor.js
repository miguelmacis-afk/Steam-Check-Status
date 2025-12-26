import { chromium } from "playwright";

// Tomamos el webhook desde el secret
const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function getSteamStatus() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto("https://steamstat.us/");

        // Espera hasta que cargue la tabla de status
        await page.waitForSelector("div.status-grid", { timeout: 60000 });

        // Extraemos los datos
        const status = await page.evaluate(() => {
            const blocks = document.querySelectorAll("div.status-grid div.status");
            const results = [];
            blocks.forEach(b => {
                const name = b.querySelector("div.service-name")?.innerText.trim();
                const stat = b.querySelector("div.service-status")?.innerText.trim();
                if (name && stat) results.push({ name, stat });
            });
            return results;
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
