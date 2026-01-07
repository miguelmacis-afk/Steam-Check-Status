import { chromium } from "playwright";
import fs from "fs";

const WEBHOOK_URLS_CHANGES = process.env.WEBHOOK_URLS_CHANGES; // lista separada por comas
const WEBHOOK_URL_ERRORS = process.env.WEBHOOK_URL_ERRORS; // webhook único para errores
const estadoPath = "estado.json";

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

const SERVICE_IMPACT = {
  "Steam Store": [
    "La tienda puede no cargar o mostrar errores",
    "Compras y precios pueden no reflejarse correctamente",
    "El carrito puede fallar"
  ],
  "Steam Community": [
    "Perfiles pueden no cargar",
    "Amigos y comentarios no aparecen",
    "Mercado de la comunidad puede fallar"
  ],
  "Steam Web API": [
    "Bots y aplicaciones externas pueden dejar de funcionar",
    "Rust+, CS2, inventarios y stats pueden no actualizarse",
    "Servidores pueden no validar datos correctamente"
  ],
  "Steam Connection Managers": [
    "Problemas para conectarse a Steam",
    "Desconexiones en juegos online",
    "Latencia elevada o login fallido"
  ],
  "Database": [
    "Retrasos en inventarios",
    "Datos que no se actualizan",
    "Cambios que tardan en reflejarse"
  ]
};

const ALERT_SERVICES = [
  "Steam Store",
  "Steam Community",
  "Steam Web API"
];

function isBadStatus(status) {
  const s = status.toLowerCase();
  return (
    s.includes("down") ||
    s.includes("offline") ||
    s.includes("major") ||
    s.includes("critical") ||
    s.includes("slow") ||
    s.includes("degraded") ||
    s.includes("minor")
  );
}

function statusEmoji(status) {
  const s = status.toLowerCase();

  const match = s.match(/(\d+(\.\d+)?)%/);
  if (match) {
    const pct = parseFloat(match[1]);
    if (pct >= 90) return "🟢";
    if (pct >= 70) return "🟡";
    return "🔴";
  }

  if (s.includes("normal") || s.includes("online") || s.includes("ok") || s.includes("recovered")) return "🟢";
  if (s.includes("slow") || s.includes("degraded") || s.includes("minor")) return "🟡";
  if (s.includes("down") || s.includes("offline") || s.includes("major") || s.includes("critical")) return "🔴";
  return "⚪";
}

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

function estadoGeneral(estado) {
  let general = "🟢";
  for (const value of Object.values(estado)) {
    const s = value.toLowerCase();
    if (s.includes("down") || s.includes("offline") || s.includes("major") || s.includes("critical")) {
      return "🔴";
    }
    if (s.includes("slow") || s.includes("degraded") || s.includes("minor")) {
      general = "🟡";
    }
  }
  return general;
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

async function sendToDiscord(message, chartBuffer = null, webhooks = []) {
  for (const hook of webhooks) {
    if (!hook) continue;
    const form = new FormData();
    form.append("content", message);
    if (chartBuffer) form.append("file", new Blob([chartBuffer], { type: "image/png" }), "steam_cms.png");
    try {
      await fetch(hook, { method: "POST", body: form });
    } catch (err) {
      console.warn("❌ Error enviando a Discord:", hook, err.message);
    }
  }
}

async function main() {
  if (!WEBHOOK_URLS_CHANGES?.length || !WEBHOOK_URL_ERRORS) {
    console.error("❌ WEBHOOKS no definidos");
    process.exit(1);
  }

  const changeHooks = WEBHOOK_URLS_CHANGES.split(",");
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

  for (const svc of Object.keys(prevEstado)) {
    if (prevEstado[svc] === "Recovered") prevEstado[svc] = "Normal";
  }

  const filtered = {};
  for (const [name, status] of Object.entries(services)) {
    if (!IGNORE_SERVICES.includes(name)) filtered[name] = status;
  }

  const lines = [];
  const newEstado = {};
  for (const svc of ALERT_SERVICES) {
    let value = services[svc] || "Desconocido";
    if (value === "Recovered") value = "Normal";
    newEstado[svc] = value;
  }

  const generalEmoji = estadoGeneral(newEstado);
  lines.push(`**${generalEmoji} Estado de los Servicios de Steam**\n`);
  lines.push(`**⚪ Online en Steam:** ${ingame} jugando / ${online} online`);

  if (filtered["Steam Connection Managers"]) {
    const status = filtered["Steam Connection Managers"];
    lines.push(`${statusEmoji(status)} **Gestores de Conexión de Steam:** ${status}`);
    delete filtered["Steam Connection Managers"];
  }

  for (const [name, status] of Object.entries(filtered)) {
    lines.push(`${statusEmoji(status)} **${traducir(name)}:** ${status}`);
  }

  const impactLines = [];
  const addedImpacts = new Set();
  for (const [service, status] of Object.entries(services)) {
    if (!SERVICE_IMPACT[service]) continue;
    if (!isBadStatus(status)) continue;
    for (const impact of SERVICE_IMPACT[service]) {
      if (!addedImpacts.has(impact)) {
        impactLines.push(`• ${impact}`);
        addedImpacts.add(impact);
      }
    }
  }

  if (impactLines.length > 0) {
    lines.push("\n**⚠️ Posibles problemas que puedes notar:**");
    lines.push(...impactLines);
  }

  // Detectar cambios
  let changed = false;
  for (const svc of ALERT_SERVICES) {
    if (prevEstado[svc] !== newEstado[svc]) changed = true;
  }

  try {
    fs.writeFileSync(estadoPath, JSON.stringify(newEstado, null, 2), "utf-8");
    console.log("✅ Estado guardado correctamente");
  } catch (err) {
    console.error("❌ No se pudo guardar estado.json:", err);
  }

  if (changed) {
    await sendToDiscord(lines.join("\n"), chartBuffer, changeHooks);
    console.log("✅ Cambios enviados a Discord");
  } else {
    console.log("ℹ️ No hay cambios relevantes");
  }
}

// Captura errores y los envía al webhook de errores
main().catch(async err => {
  console.error("❌ Error:", err);
  const msg = `🚨 Error en el monitor de Steam:\n\`\`\`${err.message || err}\`\`\``;
  try {
    await sendToDiscord(msg, null, [WEBHOOK_URL_ERRORS]);
  } catch (e) {
    console.warn("❌ No se pudo notificar error a Discord:", e.message);
  }
  process.exit(1);
});
