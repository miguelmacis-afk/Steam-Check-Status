import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Ruta absoluta del JSON en el mismo directorio del JS
const estadoPath = path.join(path.dirname(process.argv[1]), "estado.json");

// Servicios que NO queremos mostrar
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

// Servicios importantes a monitorear
const ALERT_SERVICES = [
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

// Traduce nombre de servicio al español
function traducir(nombre) {
  const map = {
    "Online on Steam": "Online en Steam",
    "Steam Connection Managers": "Gestores de Conexión de Steam",
    "Steam Store": "Tienda de Steam",
    "Steam Community": "Comunidad de Steam",
    "Steam Web API": "API Web de Steam",
    "Database": "Base de Datos"
  };
  return map[nombre] || nombre;
}

// Simplifica el estado para guardarlo en JSON
function estadoSimple(status) {
  const s = status.toLowerCase();
  if (s.includes("normal") || s.includes("online") || s.includes("%")) return "Normal";
  return "Caído";
}

async function getSteamStatus() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
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
  if (chartBuffer) form.append("file", new Blob([chartBuffer], { type: "image/png" }), "steam_cms.png");

  await fetch(WEBHOOK_URL, { method: "POST", body: form });
}

async function main() {
  if (!WEBHOOK_URL) {
    console.error("❌ WEBHOOK_URL no definido");
    process.exit(1);
  }

  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  // Leer estado previo
  let prevEstado = {};
  try {
    if (fs.existsSync(estadoPath)) {
      prevEstado = JSON.parse(fs.readFileSync(estadoPath, "utf-8"));
    }
  } catch (err) {
    console.warn("⚠️ No se pudo leer estado.json:", err);
  }

  // Filtrar servicios a mostrar
  const filtered = {};
  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name)) filtered[name] = status;
  }

  // Construir mensaje
  const lines = [];
  const onlinePct = parseInt(online.replace(/,/g, "")) || 0;
  const generalEmoji = onlinePct > 0 ? "🟢" : "🔴";
  lines.push(`**${generalEmoji} Estado de los Servicios de Steam**\n`);

  // Online / jugando
  lines.push(`**⚪ Online en Steam:** ${ingame} jugando / ${online} online`);

  // Steam Connection Managers justo debajo
  if (filtered["Steam Connection Managers"]) {
    const status = filtered["Steam Connection Managers"];
    lines.push(`${statusEmoji(status)} **Gestores de Conexión de Steam:** ${status}`);
    delete filtered["Steam Connection Managers"];
  }

  // Mostrar los demás servicios, sin avisar de cambios
  for (const [name, status] of Object.entries(filtered)) {
    lines.push(`${statusEmoji(status)} **${traducir(name)}:** ${status}`);
  }

  // Construir nuevo estado simplificado
  let changed = false;
  const newEstado = {};
  for (const svc of ALERT_SERVICES) {
    const valueRaw = services[svc] || "Desconocido";
    const value = estadoSimple(valueRaw);

    const prev = prevEstado[svc];
    if (prev !== value) changed = true;

    newEstado[svc] = value;
  }

  // Guardar estado actualizado
  try {
    fs.writeFileSync(estadoPath, JSON.stringify(newEstado, null, 2), "utf-8");
    console.log("✅ Estado guardado correctamente");
  } catch (err) {
    console.error("❌ No se pudo guardar estado.json:", err);
  }

  // Enviar solo si cambió algún servicio importante
  if (changed) {
    await sendToDiscord(lines.join("\n"), chartBuffer);
    console.log("✅ Estado enviado a Discord");
  } else {
    console.log("ℹ️ No hay cambios relevantes, no se envió Discord");
  }
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
