import { chromium } from 'playwright';

const WEBHOOK_URL = process.env.WEBHOOK_URL;

async function getSteamStatus() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto('https://steamstat.us/', { waitUntil: 'networkidle' });

        // Espera que cargue la sección de servicios
        await page.waitForSelector('div.services', { timeout: 60000 });

        // Obtener todos los servicios
        const services = await page.$$eval('div.service, div.sep.service', nodes => {
            return nodes.map(node => {
                const name = node.querySelector('.name')?.innerText.trim() || 'Desconocido';
                const status = node.querySelector('.status')?.innerText.trim() || 'Desconocido';
                return { name, status };
            });
        });

        // Capturar gráfico CMS
        const chart = await page.$('#js-cms-chart');
        let chartBuffer = null;
        if (chart) {
            chartBuffer = await chart.screenshot();
        }

        await browser.close();
        return { services, chartBuffer };

    } catch (err) {
        await browser.close();
        throw new Error('Error al obtener los datos: ' + err.message);
    }
}

async function sendToDiscord({ services, chartBuffer }) {
    try {
        let content = '📡 **Steam Status**\n';
        for (const s of services) {
            content += `**${s.name}:** ${s.status}\n`;
        }

        if (chartBuffer) {
            const formData = new FormData();
            formData.append('file', chartBuffer, 'cms-chart.png');
            formData.append('content', content);

            await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
        } else {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
        }

    } catch (err) {
        console.error('Error al enviar los datos:', err);
    }
}

async function main() {
    try {
        const data = await getSteamStatus();
        await sendToDiscord(data);
    } catch (err) {
        console.error(err.message);
    }
}

main();
