import { chromium } from "playwright";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Servicios que NO queremos mostrar
const IGNORE_SERVICES = [
  "SteamStat.us Page Views",
  "Backend Steam Bot",
  "In-Game on Steam",
  "Dota 2 API",
  "TF2 API",
  "Deadlock API",
  "Counter-Strike API",
  "CS Sessions Logon",
  "CS Player Inventories",
  "CS Matchmaking Scheduler"
];

async function getSteamStatus() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  await page.goto("https://steamstat.us/", {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForSelector(".services", { timeout: 60000 });

  const data = await page.evaluate(() => {
    const services = {};

    document.querySelectorAll(".service").forEach(el => {
      const name = el.querySelector(".name")?.innerText?.trim();
      const status = el.querySelector(".status")?.innerText?.trim();
      if (name && status) {
        services[name] = status;
      }
    });

    const online = document.querySelector("#online")?.innerText ?? "Desconocido";
    const ingame = document.querySelector("#ingame")?.innerText ?? "Desconocido";

    return { services, online, ingame };
  });

  let chartBuffer = null;
  const chart = await page.$("#js-cms-chart");
  if (chart) {
    chartBuffer = await chart.screenshot();
  }

  await browser.close();
  return { ...data, chartBuffer };
}

async function sendToDiscord(message, chartBuffer) {
  const form = new FormData();
  form.append("content", message);

  if (chartBuffer) {
    const blob = new Blob([chartBuffer], { type: "image/png" });
    form.append("file", blob, "steam_cms.png");
  }

  await fetch(WEBHOOK_URL, {
    method: "POST",
    body: form
  });
}

async function main() {
  if (!WEBHOOK_URL) {
    console.error("❌ WEBHOOK_URL no definido");
    process.exit(1);
  }

  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  const filtered = {};
  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name)) {
      filtered[name] = status;
    }
  }

  const lines = [];
  lines.push("🟢 **Steam Services Status**\n");

  // Online + jugando
  lines.push(`🟢 **Online on Steam:** ${ingame} jugando / ${online} online`);

  // Steam Connection Managers justo debajo
  if (filtered["Steam Connection Managers"]) {
    lines.push(`🟢 **Steam Connection Managers:** ${filtered["Steam Connection Managers"]}`);
    delete filtered["Steam Connection Managers"];
  }

  for (const [name, status] of Object.entries(filtered)) {
    lines.push(`🟢 **${name}:** ${status}`);
  }

  if (chartBuffer) {
    lines.push("\n📊 **Steam Connection Managers (últimas 48h)**");
  }

  await sendToDiscord(lines.join("\n"), chartBuffer);
  console.log("✅ Estado enviado a Discord");
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
