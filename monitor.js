import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const ESTADO_FILE = path.resolve("./estado.json");

// Servicios que NO notificaremos si cambian
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

// Servicios que notificaremos si cambian
const NOTIFY_SERVICES = [
  "Steam Connection Managers",
  "Steam Store",
  "Steam Community",
  "Steam Web API",
  "Database"
];

// Función para elegir emoji según estado
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

// Traducción simple de servicios
function translate(name) {
  switch (name) {
    case "Steam Connection Managers": return "Gestores de Conexión de Steam";
    case "Steam Store": return "Tienda de Steam";
    case "Steam Community": return "Comunidad de Steam";
    case "Steam Web API": return "API Web de Steam";
    default: return name;
  }
}

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

  // Filtrar servicios a mostrar y traducir
  const lines = [];
  lines.push("**🟢 Estado de los Servicios de Steam**\n");

  lines.push(`**Online en Steam:** ${ingame} jugando / ${online} online`);

  // Steam Connection Managers justo debajo
  if (services["Steam Connection Managers"]) {
    const scm = services["Steam Connection Managers"];
    lines.push(`${statusEmoji(scm)} **${translate("Steam Connection Managers")}:** ${scm}`);
  }

  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name) && name !== "Steam Connection Managers") {
      lines.push(`${statusEmoji(status)} **${translate(name)}:** ${status}`);
    }
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

  // Guardar estado
  fs.writeFileSync(ESTADO_FILE, JSON.stringify(estado, null, 2), "utf-8");

  // Solo enviar mensaje si hubo cambio en servicios importantes
  if (huboCambio) {
    if (chartBuffer) lines.push("\n📊 **Gestores de Conexión de Steam (últimas 48h)**");
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
