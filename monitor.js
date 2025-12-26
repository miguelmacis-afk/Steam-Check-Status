import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Archivo de estado absoluto
const STATE_FILE = path.resolve(process.cwd(), "estado.json");

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

// Servicios críticos a monitorear cambios
const WATCH_SERVICES = [
  "Gestores de Conexión de Steam",
  "Tienda de Steam",
  "Comunidad de Steam",
  "API Web de Steam",
  "Database"
];

// Decide emoji según estado real
function statusEmoji(status) {
  const s = status.toLowerCase();

  // Porcentaje (ej: 95.2% Online)
  const match = s.match(/(\d+(\.\d+)?)%/);
  if (match) {
    const pct = parseFloat(match[1]);
    if (pct >= 90) return "🟢";
    if (pct >= 70) return "🟡";
    return "🔴";
  }

  if (s.includes("normal") || s.includes("online") || s.includes("ok")) {
    return "🟢";
  }

  if (s.includes("slow") || s.includes("degraded") || s.includes("minor")) {
    return "🟡";
  }

  if (
    s.includes("down") ||
    s.includes("offline") ||
    s.includes("major") ||
    s.includes("critical")
  ) {
    return "🔴";
  }

  return "⚪"; // desconocido
}

// Carga el estado previo
function loadPreviousState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("❌ Error al leer estado previo:", err);
  }
  return {};
}

// Guarda el estado actual
function saveCurrentState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log("✅ Estado guardado correctamente");
  } catch (err) {
    console.error("❌ Error al guardar estado:", err);
  }
}

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
      const nameEl = el.querySelector(".name");
      const statusEl = el.querySelector(".status");
      if (nameEl && statusEl) {
        services[nameEl.innerText.trim()] = statusEl.innerText.trim();
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

  const prevState = loadPreviousState();

  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  const filtered = {};
  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name)) {
      filtered[name] = status;
    }
  }

  // Traducir nombres al español
  const traducciones = {
    "Steam Connection Managers": "Gestores de Conexión de Steam",
    "Steam Store": "Tienda de Steam",
    "Steam Community": "Comunidad de Steam",
    "Steam Web API": "API Web de Steam",
    "Database": "Database"
  };

  const translated = {};
  for (const [name, status] of Object.entries(filtered)) {
    const tName = traducciones[name] ?? name;
    translated[tName] = status;
  }

  // Construir mensaje
  const lines = [];
  lines.push(`${statusEmoji(translated["Gestores de Conexión de Steam"] || "")} **Estado de los Servicios de Steam**\n`);

  // Online / jugando
  lines.push(
    `⚪ **Online on Steam:** ${ingame} jugando / ${online} online`
  );

  // Steam Connection Managers justo debajo
  if (translated["Gestores de Conexión de Steam"]) {
    const status = translated["Gestores de Conexión de Steam"];
    lines.push(
      `${statusEmoji(status)} **Gestores de Conexión de Steam:** ${status}`
    );
  }

  // Otros servicios visibles
  for (const [name, status] of Object.entries(translated)) {
    if (!WATCH_SERVICES.includes(name)) {
      lines.push(`${statusEmoji(status)} **${name}:** ${status}`);
    }
  }

  // Verificar cambios solo de los críticos
  let hasChanges = false;
  const newState = {};
  for (const svc of WATCH_SERVICES) {
    const current = translated[svc] || "Desconocido";
    newState[svc] = current;
    if (prevState[svc] !== current) {
      hasChanges = true;
    }
  }

  // Si hubo cambios, enviar
  if (hasChanges) {
    if (chartBuffer) {
      lines.push("\n📊 **Gestores de Conexión de Steam (últimas 48h)**");
    }
    await sendToDiscord(lines.join("\n"), chartBuffer);
    console.log("✅ Estado crítico enviado a Discord");
    saveCurrentState(newState);
  } else {
    console.log("ℹ️ No hubo cambios en los servicios críticos. No se envía mensaje.");
  }
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
