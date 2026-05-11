import { chromium } from "playwright";
import fs from "fs";

const WEBHOOK_URLS_CHANGES = process.env.WEBHOOK_URLS_CHANGES;
const WEBHOOK_URL_ERRORS = process.env.WEBHOOK_URL_ERRORS;
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
    if (s.includes("down") || s.includes("offline") || s.includes("major") || s.includes("critical")) return "🔴";
    if (s.includes("slow") || s.includes("degraded") || s.includes("minor")) general = "🟡";
  }
  return general;
}

async function getSteamStatus() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  
  // Usamos un User-Agent real para evitar ser detectados como bot básico
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  // BLOQUEO DE RECURSOS: Ahorra tiempo y evita timeouts por trackers/imágenes
  await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2,otf}', route => route.abort());

  try {
    // Cambiado 'networkidle' por 'domcontentloaded' (más rápido y estable)
    await page.goto("https://steamstat.us/", { waitUntil: "domcontentloaded", timeout: 60000 });
    
    // Esperamos específicamente a que la tabla de servicios esté presente
    await page.waitForSelector(".services", { timeout: 30000 });

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

    // Nota: El screenshot del chart fallará si bloqueamos CSS/Imágenes, 
    // pero para monitorear estados es preferible la estabilidad del texto.
    let chartBuffer = null;
    return { ...data, chartBuffer };

  } finally {
    await browser.close();
  }
}

async function sendToDiscord(message, chartBuffer = null, webhooks = []) {
  for (const hook of webhooks) {
    if (!hook) continue;
    const form = new FormData();
    form.append("content", message);
    if (chartBuffer) {
        form.append("file", new Blob([chartBuffer], { type: "image/png" }), "steam_cms.png");
    }
    try {
      await fetch(hook.trim(), { method: "POST", body: form });
    } catch (err) {
      console.warn("❌ Error enviando a Discord:", err.message);
    }
  }
}

async function main() {
  if (!WEBHOOK_URLS_CHANGES || !WEBHOOK_URL_ERRORS) {
    throw new Error("WEBHOOKS no definidos en las variables de entorno");
  }

  const changeHooks = WEBHOOK_URLS_CHANGES.split(",");
  const { services, online, ingame, chartBuffer } = await getSteamStatus();

  let prevEstado = {};
  try {
    if (fs.existsSync(estadoPath)) {
      prevEstado = JSON.parse(fs.readFileSync(estadoPath, "utf-8"));
    }
  } catch (err) {
    console.warn("⚠️ No se pudo leer estado.json:", err);
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

  let changed = false;
  for (const svc of ALERT_SERVICES) {
    if (prevEstado[svc] !== newEstado[svc]) changed = true;
  }

  fs.writeFileSync(estadoPath, JSON.stringify(newEstado, null, 2), "utf-8");

  if (changed) {
    await sendToDiscord(lines.join("\n"), chartBuffer, changeHooks);
    console.log("✅ Cambios enviados a Discord");
  } else {
    console.log("ℹ️ No hay cambios relevantes");
  }
}

main().catch(async err => {
  console.error("❌ Error Crítico:", err);
  const msg = `🚨 **Error en el monitor de Steam:**\n\`\`\`${err.message || err}\`\`\``;
  try {
    await sendToDiscord(msg, null, [WEBHOOK_URL_ERRORS]);
  } catch (e) {
    console.warn("❌ Falló el envío de alerta de error:", e.message);
  }
  process.exit(1);
});
