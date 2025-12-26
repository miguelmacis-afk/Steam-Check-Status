import { chromium } from 'playwright';

// Tu webhook de Discord desde secrets/env
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Lista de servicios que queremos monitorear
const SERVICES = [
    "Steam", "Steam Store", "Steam Community", "Steam Web API", 
    "Steam Cloud", "Steam Workshop", "Steam Market", "Steam Support",
    "Region NA", "Region EU", "Region ASIA"
];

// Map de emojis según estado
const STATUS_EMOJI = {
    "Normal": "🟢",
    "Online": "🟢",
    "Offline": "🔴",
    "Desconocido": "⚪"
};

// Función principal
async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('https://steamstat.us/', { waitUntil: 'networkidle' });

        // Extraemos todo el texto visible de la sección principal
        const text = await page.textContent('body');

        const lines = [];

        for (const service of SERVICES) {
            // Buscamos el estado cercano al nombre del servicio
            const regex = new RegExp(`${service}:?\\s*(Normal|Online|Offline)?`, 'i');
            const match = text.match(regex);
            const status = match && match[1] ? match[1] : "Desconocido";
            lines.push(`${STATUS_EMOJI[status] || "⚪"} ${service}: ${status}`);
        }

        const message = lines.join("\n");

        console.log(message);

        // Enviamos al Discord
        await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `**Steam Status**\n${message}` })
        });

    } catch (err) {
        console.error("Error al obtener o enviar los datos:", err);
    } finally {
        await browser.close();
    }
}

main();
