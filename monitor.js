// monitor.js
import { chromium } from 'playwright';


const WEBHOOK_URL = process.env.WEBHOOK_URL; // Pon tu secret de GitHub

async function getSteamStatus() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://steamstat.us/', { waitUntil: 'networkidle' });

    // Esperamos que cargue la sección principal
    await page.waitForSelector('div.status-row', { timeout: 60000 });

    // Extraemos los servicios y estados
    const statuses = await page.$$eval('div.status-row', rows => {
        return rows.map(row => {
            const name = row.querySelector('span.status-name')?.textContent.trim() || 'Unknown';
            const stateEl = row.querySelector('span.status-indicator');
            let state = 'Unknown';
            if (stateEl) {
                if (stateEl.classList.contains('green')) state = '🟢 Normal';
                else if (stateEl.classList.contains('yellow')) state = '🟡 Problemas';
                else if (stateEl.classList.contains('red')) state = '🔴 Caído';
            }
            return { name, state };
        });
    });

    await browser.close();
    return statuses;
}

async function sendToDiscord(statuses) {
    const message = statuses.map(s => `${s.state} ${s.name}`).join('\n');
    const payload = { content: `**Steam Status**\n${message}` };

    await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

async function main() {
    try {
        const statuses = await getSteamStatus();
        await sendToDiscord(statuses);
        console.log('Estado enviado a Discord correctamente.');
    } catch (err) {
        console.error('Error al obtener o enviar los datos:', err);
    }
}

main();
