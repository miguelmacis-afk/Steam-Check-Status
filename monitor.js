import { chromium } from "playwright";
import axios from "axios";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function getSteamStatus() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
await page.goto("https://steamstat.us/", { waitUntil: "networkidle" });
await page.waitForSelector("div.status-grid", { timeout: 120000 }); // 2 minutos

    // Scrapeamos los servicios
    const services = await page.$$eval("div.status-grid div.service", nodes =>
        nodes.map(n => {
            const name = n.querySelector("h4")?.innerText.trim();
            const status = n.querySelector("div.status")?.innerText.trim();
            const emoji = n.querySelector("div.status")?.classList.contains("online") ? "🟢" : "🔴";
            return { name, status, emoji };
        })
    );

    await browser.close();
    return services;
}

async function sendDiscord(services) {
    if (!WEBHOOK_URL) {
        console.error("No se encontró WEBHOOK_URL en el entorno");
        return;
    }

    let description = services.map(s => `${s.emoji} ${s.name}: ${s.status}`).join("\n");

    await axios.post(WEBHOOK_URL, {
        username: "Steam Monitor",
        embeds: [{
            title: "Estado de Steam",
            description: description,
            color: 3066993, // verde
            timestamp: new Date()
        }]
    });
}

async function main() {
    try {
        const services = await getSteamStatus();
        await sendDiscord(services);
        console.log("Mensaje enviado al Discord ✅");
    } catch (e) {
        console.error("Error al obtener o enviar los datos:", e);
    }
}

main();
