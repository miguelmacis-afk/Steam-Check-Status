import { chromium } from "playwright";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const ESTADO_FILE = path.join(process.cwd(), "estado.json");

// Servicios que queremos ignorar
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
  "CS Matchmaking Scheduler",
  "Online on Steam"
];

// Servicios que queremos monitorear para alertas
const NOTIFY_SERVICES = [
  "Steam Connection Managers",
  "Steam Store",
  "Steam Community",
  "Steam Web API",
  "Database"
];

// Función para traducir nombres de servicios al español
function translate(name) {
  const translations = {
    "Steam Connection Managers": "Gestores de Conexión de Steam",
    "Steam Store": "Tienda de Steam",
    "Steam Community": "Comunidad de Steam",
    "Steam Web API": "API Web de Steam",
    "Database": "Database",
    "Online on Steam": "Online en Steam",
    "In-Game on Steam": "Jugando en Steam"
  };
  return translations[name] || name;
}

// Decide emoji según estado real
function statusEmoji(status) {
  const s = status.toLowerCase();
  const match = s.match(/(\d+(\.\d+)?)%/);
  if (match) {
    const pct = parseFloat(match[1]);
    if (pct >= 90) return "🟢";
    if (pct >= 70) return "🟡";
    return "🔴";
  }
  if (s.includes("normal") || s.includes("online") || s.includes("ok")) return "🟢";
  if (s.includes("slow") || s.includes("degraded") || s.includes("minor")) return "🟡";
  if (s.includes("down") || s.includes("offline") || s.includes("major") || s.includes("critical")) return "🔴";
  return "⚪"; // desconocido
}

// Scrapea SteamStat.us
async function getSteamStatus() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.goto("https://steamstat.us/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".services", { timeout: 60000 });

  const data = await page.evaluate(() => {
    const services = {};
    document.querySelectorAll(".service").forEach(el => {
      const name = el.querySelector(".name")?.innerText?.trim();
      const status = el.querySelector(".status")?.innerText?.trim();
      if (name && status) services[name] = status;
    });
    const online = document.querySelector("#online")?.innerText ?? "Desconocido";
    const ingame = document.querySelector("#ingame")?.innerText ?? "Desconocido";
    return { services, online, ingame };
  });

  let chartBuffer = null;
  const chart = await page.$("#js-cms-chart");
  if (chart) chartBuffer = await chart.screenshot();

  await browser.close();
  return { ...data, chartBuffer };
}

// Enviar mensaje a Discord
async function sendToDiscord(message, chartBuffer) {
  const form = new FormData();
  form.append("content", message);

  if (chartBuffer) {
    const blob = new Blob([chartBuffer], { type: "image/png" });
    form.append("file", blob, "steam_cms.png");
  }

  await fetch(WEBHOOK_URL, { method: "POST", body: form });
}

async function main() {
  if (!WEBHOOK_URL) {
    console.error("❌ WEBHOOK_URL no definido");
    process.exit(1);
  }

  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  // Leer estado previo
  let estado = {};
  if (fs.existsSync(ESTADO_FILE)) {
    const contenido = fs.readFileSync(ESTADO_FILE, "utf-8");
    estado = contenido ? JSON.parse(contenido) : {};
  }

  // Revisar si cambió alguno de los servicios importantes
  let huboCambio = false;
  for (const key of NOTIFY_SERVICES) {
    const actual = services[key];
    if (actual && estado[key] !== actual) {
      estado[key] = actual;
      huboCambio = true;
    }
  }

  // Guardar siempre el estado actualizado
  fs.writeFileSync(ESTADO_FILE, JSON.stringify(estado, null, 2), "utf-8");

  // Preparar mensaje solo si hubo cambios importantes
  const lines = [];
  lines.push("**🟢 Estado de los Servicios de Steam**\n");

  lines.push(`**Online en Steam:** ${ingame} jugando / ${online} online`);

  if (services["Steam Connection Managers"]) {
    const scm = services["Steam Connection Managers"];
    lines.push(`${statusEmoji(scm)} **${translate("Steam Connection Managers")}:** ${scm}`);
  }

  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name) && name !== "Steam Connection Managers") {
      lines.push(`${statusEmoji(status)} **${translate(name)}:** ${status}`);
    }
  }

  if (chartBuffer) lines.push("\n📊 **Gestores de Conexión de Steam (últimas 48h)**");

  if (huboCambio) {
    await sendToDiscord(lines.join("\n"), chartBuffer);
    console.log("✅ Estado enviado a Discord");
  } else {
    console.log("ℹ️ No hubo cambios importantes, no se envió nada");
  }
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
