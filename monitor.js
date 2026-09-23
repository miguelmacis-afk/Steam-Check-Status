import fs from "fs";

const WEBHOOK_URLS_CHANGES = process.env.WEBHOOK_URLS_CHANGES;
const WEBHOOK_URL_ERRORS = process.env.WEBHOOK_URL_ERRORS;

const estadoPath = "estado.json";

const ALERT_SERVICES = [
  "Steam Store",
  "Steam Community",
  "Steam Web API",
  "Steam Market",
  "Steam Support",
  "Connection Managers"
];

const SERVICE_IMPACT = {
  "Steam Store": [
    "La tienda puede no cargar o mostrar errores",
    "Compras y precios pueden no reflejarse correctamente"
  ],
  "Steam Community": [
    "Perfiles pueden no cargar",
    "Amigos y comentarios no aparecen"
  ],
  "Steam Web API": [
    "Bots y aplicaciones externas pueden dejar de funcionar",
    "Inventarios y stats de juegos pueden no actualizarse"
  ],
  "Steam Market": [
    "Compras y ventas en el mercado pueden fallar o dar error"
  ],
  "Steam Support": [
    "No se pueden enviar tickets ni recuperar cuentas"
  ],
  "Connection Managers": [
    "Problemas para iniciar sesión o mantenerte conectado al cliente de Steam"
  ]
};

function statusEmoji(status) {
  const s = status.toLowerCase();
  if (s.includes("normal") || s.includes("online") || s.includes("ok")) return "🟢";
  if (s.includes("slow") || s.includes("degraded") || s.includes("timeout")) return "🟡";
  if (s.includes("down") || s.includes("error") || s.includes("refused")) return "🔴";
  return "⚪";
}

function traducir(nombre) {
  const map = {
    "Steam Store": "Tienda de Steam",
    "Steam Community": "Comunidad de Steam",
    "Steam Web API": "API Web de Steam",
    "Steam Market": "Mercado de la Comunidad",
    "Steam Support": "Soporte de Steam",
    "Connection Managers": "Gestores de Conexión (CM)"
  };
  return map[nombre] || nombre;
}

function estadoGeneral(estado) {
  let general = "🟢";
  for (const value of Object.values(estado)) {
    const s = value.toLowerCase();
    if (s.includes("down") || s.includes("error")) {
      return "🔴";
    }
    if (s.includes("slow") || s.includes("timeout")) {
      general = "🟡";
    }
  }
  return general;
}

async function checkEndpoint(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
    clearTimeout(id);
    const duration = Date.now() - start;

    if (!res.ok && res.status !== 403) {
      return `Caído (HTTP ${res.status})`;
    }
    if (duration > 3500) {
      return `Lento (${duration}ms)`;
    }
    return "Normal";
  } catch (err) {
    clearTimeout(id);
    if (err.name === "AbortError") return "Lento (Timeout)";
    return "Caído / Sin conexión";
  }
}

async function getSteamStatus() {
  const [store, community, api, market, support, cmList] = await Promise.all([
    checkEndpoint("https://store.steampowered.com/"),
    checkEndpoint("https://steamcommunity.com/"),
    checkEndpoint("https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v0001/"),
    checkEndpoint("https://steamcommunity.com/market/"),
    checkEndpoint("https://help.steampowered.com/"),
    checkEndpoint("https://api.steampowered.com/ISteamDirectory/GetCMList/v1/?cellid=0")
  ]);

  return {
    services: {
      "Steam Store": store,
      "Steam Community": community,
      "Steam Web API": api,
      "Steam Market": market,
      "Steam Support": support,
      "Connection Managers": cmList
    }
  };
}

async function sendToDiscord(message, webhooks = []) {
  for (const hook of webhooks) {
    if (!hook) continue;
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message })
      });
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
  const { services } = await getSteamStatus();

  let prevEstado = {};
  try {
    if (fs.existsSync(estadoPath)) {
      prevEstado = JSON.parse(fs.readFileSync(estadoPath, "utf-8"));
    }
  } catch (err) {
    console.warn("⚠️ No se pudo leer estado.json:", err);
  }

  const lines = [];
  const newEstado = {};
  for (const svc of ALERT_SERVICES) {
    newEstado[svc] = services[svc] || "Desconocido";
  }

  const generalEmoji = estadoGeneral(newEstado);
  lines.push(`**${generalEmoji} Estado Ampliado de Servicios de Steam**\n`);

  for (const [name, status] of Object.entries(newEstado)) {
    lines.push(`${statusEmoji(status)} **${traducir(name)}:**${status}`);
  }

  const impactLines = [];
  const addedImpacts = new Set();
  for (const [service, status] of Object.entries(newEstado)) {
    if (!SERVICE_IMPACT[service]) continue;
    const s = status.toLowerCase();
    if (s.includes("caído") || s.includes("lento") || s.includes("error")) {
      for (const impact of SERVICE_IMPACT[service]) {
        if (!addedImpacts.has(impact)) {
          impactLines.push(`• ${impact}`);
          addedImpacts.add(impact);
        }
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

  try {
    fs.writeFileSync(estadoPath, JSON.stringify(newEstado, null, 2), "utf-8");
    console.log("✅ Estado guardado correctamente");
  } catch (err) {
    console.error("❌ No se pudo guardar estado.json:", err);
  }

  if (changed) {
    await sendToDiscord(lines.join("\n"), changeHooks);
    console.log("✅ Cambios enviados a Discord");
  } else {
    console.log("ℹ️ No hay cambios en el estado de Steam");
  }
}

main().catch(async err => {
  console.error("❌ Error:", err);
  const msg = `🚨 Error en el monitor de Steam:\n\`\`\`${err.message || err}\`\`\``;
  try {
    await sendToDiscord(msg, [WEBHOOK_URL_ERRORS]);
  } catch (e) {
    console.warn("❌ No se pudo notificar error a Discord:", e.message);
  }
  process.exit(1);
});
