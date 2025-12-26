import { chromium } from "playwright";
import { Blob } from "buffer";

const STEAM_URL = "https://steamstat.us/";
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error("WEBHOOK_URL no definido");
  process.exit(1);
}

async function getSteamStatus() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 }
  });

  await page.goto(STEAM_URL, { waitUntil: "networkidle" });

  // Esperar a que carguen los servicios (JS)
  await page.waitForSelector(".services .service", { timeout: 60000 });

  const services = await page.$$eval(".services .service", nodes =>
    nodes.map(n => {
      const name = n.querySelector(".name")?.innerText.trim() ?? "Desconocido";
      const status = n.querySelector(".status")?.innerText.trim() ?? "Desconocido";
      return { name, status };
    })
  );

  // Screenshot SOLO del gráfico CMS
  let chartBuffer = null;
  const chart = await page.$("#js-cms-chart");
  if (chart) {
    chartBuffer = await chart.screenshot();
  }

  await browser.close();

  return { services, chartBuffer };
}

function buildMessage(services) {
  let msg = "🟢 **Steam Services Status**\n\n";

  for (const s of services) {
    let icon = "🟢";
    if (/offline|down|error/i.test(s.status)) icon = "🔴";
    if (/degraded|slow/i.test(s.status)) icon = "🟡";

    msg += `${icon} **${s.name}**: ${s.status}\n`;
  }

  return msg;
}

async function sendToDiscord(message, imageBuffer) {
  const form = new FormData();
  form.append("content", message);

  if (imageBuffer) {
    const blob = new Blob([imageBuffer], { type: "image/png" });
    form.append("file", blob, "steam_cms_chart.png");
  }

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    body: form
  });

  if (!res.ok) {
    throw new Error(`Discord webhook error: ${res.status}`);
  }
}

async function main() {
  try {
    const { services, chartBuffer } = await getSteamStatus();
    const message = buildMessage(services);
    await sendToDiscord(message, chartBuffer);
    console.log("Estado enviado correctamente a Discord");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
