import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Archivo para guardar el estado
const ESTADO_FILE = path.join(process.cwd(), "estado.json");

// Servicios que NO queremos enviar como alerta
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

// Servicios importantes a monitorear
const IMPORTANT_SERVICES = [
  "Steam Connection Managers",
  "Steam Store",
  "Steam Community",
  "Steam Web API",
  "Database"
];

// Traducciones de nombres
const NAMES_ES = {
  "Online on Steam": "Online en Steam",
  "In-Game on Steam": "Jugando en Steam",
  "Steam Store": "Tienda de Steam",
  "Steam Community": "Comunidad de Steam",
  "Steam Web API": "API Web de Steam",
  "Steam Connection Managers": "Gestores de Conexión de Steam",
  "Database": "Database"
};

// Decide emoji según estado
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
  if (s.includes("down") || s.includes("offline") || s.includes("major") || s.includes("critical"))
    return "🔴";

  return "⚪";
}

// Emoji general de Steam según servicios principales
function steamOverallEmoji(services) {
  for (const s of IMPORTANT_SERVICES) {
    const status = services[s];
    if (!status) continue;
    const emoji = statusEmoji(status);
    if (emoji === "🔴") return "🔴";
    if (emoji === "🟡") return "🟡";
  }
  return "🟢";
}

async function getSteamStatus() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

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

// Lee el estado guardado
function readEstado() {
  if (!fs.existsSync(ESTADO_FILE)) return {};
  const contenido = fs.readFileSync(ESTADO_FILE, "utf-8");
  if (!contenido) return {};
  try {
    return JSON.parse(contenido);
  } catch (e) {
    console.error("⚠️ estado.json corrupto, se reinicia:", e);
    return {};
  }
}

// Guarda el estado actualizado
function saveEstado(estado) {
  try {
    fs.writeFileSync(ESTADO_FILE, JSON.stringify(estado, null, 2), "utf-8");
    console.log("✅ Estado guardado correctamente");
  } catch (e) {
    console.error("❌ Error al guardar estado.json:", e);
  }
}

async function main() {
  if (!WEBHOOK_URL) {
    console.error("❌ WEBHOOK_URL no definido");
    process.exit(1);
  }

  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  const estadoGuardado = readEstado();
  const filtered = {};
  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name)) filtered[name] = status;
  }

  const lines = [];
  const overallEmoji = steamOverallEmoji(services);
  lines.push(`**${overallEmoji} Estado de los Servicios de Steam**\n`);

  lines.push(`**⚪ ${NAMES_ES["Online on Steam"]}:** ${ingame} jugando / ${online} online`);

  // Steam Connection Managers justo debajo
  if (filtered["Steam Connection Managers"]) {
    const status = filtered["Steam Connection Managers"];
    lines.push(`${statusEmoji(status)} **${NAMES_ES["Steam Connection Managers"]}:** ${status}`);
    delete filtered["Steam Connection Managers"];
  }

  for (const [name, status] of Object.entries(filtered)) {
    const esName = NAMES_ES[name] || name;
    lines.push(`${statusEmoji(status)} **${esName}:** ${status}`);
  }

  if (chartBuffer) lines.push("\n📊 **Gestores de Conexión de Steam (últimas 48h)**");

  // Comprobamos cambios solo en servicios importantes
  let changed = false;
  for (const s of IMPORTANT_SERVICES) {
    if (estadoGuardado[s] !== services[s]) {
      changed = true;
      break;
    }
  }

  // Guardamos estado
  saveEstado(services);

  if (changed) await sendToDiscord(lines.join("\n"), chartBuffer);
  console.log(changed ? "✅ Estado enviado a Discord" : "ℹ️ No hubo cambios en los servicios importantes");
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
