import { chromium } from "playwright";
import fs from "fs";

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const STATE_FILE = "./estado.json";

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

const CRITICAL_SERVICES = [
  "Steam Connection Managers",
  "Steam Store",
  "Steam Community",
  "Steam Web API",
  "Database"
];

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

function loadPreviousState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  return {};
}

function saveCurrentState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

function overallEmoji(services) {
  let overall = "🟢";
  for (const name of CRITICAL_SERVICES) {
    const emoji = statusEmoji(services[name]);
    if (emoji === "🔴") return "🔴";
    if (emoji === "🟡") overall = "🟡";
  }
  return overall;
}

async function main() {
  if (!WEBHOOK_URL) {
    console.error("❌ WEBHOOK_URL no definido");
    process.exit(1);
  }

  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  const filtered = {};
  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name)) filtered[name] = status;
  }

  const previousState = loadPreviousState();
  const changedServices = {};
  for (const name of CRITICAL_SERVICES) {
    const status = filtered[name];
    if (previousState[name] !== status) changedServices[name] = status;
  }

  if (Object.keys(changedServices).length === 0) {
    console.log("No hubo cambios en los servicios críticos, no se envía mensaje.");
    return;
  }

  const newState = {};
  for (const name of CRITICAL_SERVICES) newState[name] = filtered[name];
  saveCurrentState(newState);

  const lines = [];
  lines.push(`**${overallEmoji(filtered)} Estado de los Servicios de Steam**\n`);

  lines.push(`**⚪ Online en Steam:** ${ingame} jugando / ${online} online`);

  if (filtered["Steam Connection Managers"]) {
    const status = filtered["Steam Connection Managers"];
    lines.push(`${statusEmoji(status)} **Gestores de Conexión de Steam:** ${status}`);
    delete filtered["Steam Connection Managers"];
  }

  for (const [name, status] of Object.entries(filtered)) {
    lines.push(`${statusEmoji(status)} **${name}:** ${status}`);
  }

  if (chartBuffer) lines.push("\n📊 **Gestores de Conexión de Steam (últimas 48h)**");

  await sendToDiscord(lines.join("\n"), chartBuffer);
  console.log("✅ Estado enviado a Discord");
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
