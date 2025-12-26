import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Servicios críticos a vigilar
const WATCH_SERVICES = [
  "Gestores de Conexión de Steam",
  "Tienda de Steam",
  "Comunidad de Steam",
  "API Web de Steam",
  "Database"
];

// Servicios a ignorar para aviso
const IGNORE_SERVICES = [
  "SteamStat.us Page Views",
  "Backend Steam Bot",
  "In-Game on Steam",
  "Dota 2 API",
  "TF2 API",
  "Online on Steam",
  "Deadlock API",
  "Counter-Strike API",
  "CS Sessions Logon",
  "CS Player Inventories",
  "CS Matchmaking Scheduler"
];

// Ruta del JSON para guardar estado
const STATE_FILE = path.resolve(new URL('.', import.meta.url).pathname, "estado.json");

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

// Emoji global según estado de servicios críticos
function overallEmoji(state) {
  let hasRed = false, hasYellow = false;
  for (const name of WATCH_SERVICES) {
    const status = state[name];
    if (!status) continue;
    const e = statusEmoji(status);
    if (e === "🔴") hasRed = true;
    else if (e === "🟡") hasYellow = true;
  }
  if (hasRed) return "🔴";
  if (hasYellow) return "🟡";
  return "🟢";
}

// Scraping de SteamStat.us
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

// Guardar estado en JSON
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// Leer estado previo
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

// Traducción simple al español
function translateServices(services) {
  const mapping = {
    "Online on Steam": "Online en Steam",
    "In-Game on Steam": "Jugando",
    "Steam Store": "Tienda de Steam",
    "Steam Community": "Comunidad de Steam",
    "Steam Web API": "API Web de Steam",
    "Steam Connection Managers": "Gestores de Conexión de Steam",
    "Database": "Database"
  };
  const translated = {};
  for (const [name, status] of Object.entries(services)) {
    translated[mapping[name] || name] = status;
  }
  return translated;
}

async function main() {
  if (!WEBHOOK_URL) {
    console.error("❌ WEBHOOK_URL no definido");
    process.exit(1);
  }

  const { services, online, ingame, chartBuffer } = await getSteamStatus();
  const translated = translateServices(services);

  // Filtrado para mensaje
  const filtered = {};
  for (const [name, status] of Object.entries(translated)) {
    if (!IGNORE_SERVICES.includes(name)) filtered[name] = status;
  }

  // Cargar estado previo
  const prevState = loadState();
  const currentState = {};
  for (const name of WATCH_SERVICES) {
    currentState[name] = filtered[name];
  }

  // Solo enviar si cambió algún servicio crítico
  let hasChange = false;
  for (const name of WATCH_SERVICES) {
    if (prevState[name] !== currentState[name]) {
      hasChange = true;
      break;
    }
  }

  // Construir mensaje
  const steamEmoji = overallEmoji(currentState);
  const lines = [];
  lines.push(`${steamEmoji} **Estado de los Servicios de Steam**\n`);
  lines.push(`⚪ Online en Steam: ${ingame} jugando / ${online} online`);

  // Steam Connection Managers justo debajo
  if (filtered["Gestores de Conexión de Steam"]) {
    const status = filtered["Gestores de Conexión de Steam"];
    lines.push(`${statusEmoji(status)} Gestores de Conexión de Steam: ${status}`);
    delete filtered["Gestores de Conexión de Steam"];
  }

  for (const [name, status] of Object.entries(filtered)) {
    lines.push(`${statusEmoji(status)} ${name}: ${status}`);
  }

  if (chartBuffer) lines.push("\n📊 Gestores de Conexión de Steam (últimas 48h)");

  // Enviar a Discord solo si cambió
  if (hasChange) {
    await sendToDiscord(lines.join("\n"), chartBuffer);
    console.log("✅ Estado enviado a Discord");
  } else {
    console.log("ℹ️ No hay cambios en servicios críticos, no se envía mensaje.");
  }

  // Guardar estado actual
  saveState(currentState);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
