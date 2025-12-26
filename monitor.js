import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const STATE_FILE = path.resolve(process.cwd(), "estado.json");

const WATCHED_SERVICES = [
  "Online on Steam",
  "Steam Connection Managers",
  "Steam Store",
  "Steam Community",
  "Steam Web API",
  "Database"
];

// Traducción de nombres
const NAMES_ES = {
  "Online on Steam": "Online en Steam",
  "Steam Connection Managers": "Gestores de Conexión de Steam",
  "Steam Store": "Tienda de Steam",
  "Steam Community": "Comunidad de Steam",
  "Steam Web API": "API Web de Steam",
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
  if (s.includes("down") || s.includes("offline") || s.includes("major") || s.includes("critical")) return "🔴";
  return "⚪";
}

// Leer estado previo
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

// Guardar estado actual
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ Error guardando estado:", err);
  }
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

  const prevState = readState();
  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  // Preparar servicios a mostrar y los que vigilamos
  const watchedServices = {};
  const lines = [];
  lines.push("**Estado de los Servicios de Steam**\n");

  // Online + jugando
  lines.push(`⚪ **Online en Steam:** ${ingame} jugando / ${online} online`);
  watchedServices["Online on Steam"] = online;

  // Steam Connection Managers debajo
  if (services["Steam Connection Managers"]) {
    const scm = services["Steam Connection Managers"];
    lines.push(`${statusEmoji(scm)} **Gestores de Conexión de Steam:** ${scm}`);
    watchedServices["Steam Connection Managers"] = scm;
  }

  // Otros servicios que queremos vigilar
  for (const s of WATCHED_SERVICES) {
    if (s === "Online on Steam" || s === "Steam Connection Managers") continue;
    if (services[s]) {
      lines.push(`${statusEmoji(services[s])} **${NAMES_ES[s] || s}:** ${services[s]}`);
      watchedServices[s] = services[s];
    }
  }

  // Mostrar servicios restantes pero no vigilados
  for (const [name, status] of Object.entries(services)) {
    if (!WATCHED_SERVICES.includes(name)) {
      lines.push(`${statusEmoji(status)} **${name}:** ${status}`);
    }
  }

  // Comparar con estado previo
  let changed = false;
  for (const key of Object.keys(watchedServices)) {
    if (prevState[key] !== watchedServices[key]) {
      changed = true;
      break;
    }
  }

  if (changed) {
    await sendToDiscord(lines.join("\n"), chartBuffer);
    console.log("✅ Estado enviado a Discord");
    saveState(watchedServices);
  } else {
    console.log("ℹ️ No hubo cambios relevantes, no se envió nada");
  }
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
