import { chromium } from "playwright";
import fs from "fs";

const WEBHOOK_URLS_CHANGES = process.env.WEBHOOK_URLS_CHANGES;
const WEBHOOK_URL_ERRORS = process.env.WEBHOOK_URL_ERRORS;
const estadoPath = "estado.json";

// Detecta si el estado de la tienda indica que está caída o con problemas
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

// Asigna el emoji correspondiente según el estado de la tienda
function statusEmoji(status) {
  const s = status.toLowerCase();
  if (s.includes("normal") || s.includes("online") || s.includes("ok") || s.includes("recovered")) return "🟢";
  if (s.includes("slow") || s.includes("degraded") || s.includes("minor")) return "🟡";
  if (s.includes("down") || s.includes("offline") || s.includes("major") || s.includes("critical")) return "🔴";
  return "⚪";
}

async function getSteamStatus() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Bloqueamos la carga de imágenes y estilos pesados para acelerar la ejecución
  await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2,otf}', route => route.abort());

  try {
    await page.goto("https://steamstat.us/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('body', { timeout: 30000 });

    const storeStatus = await page.evaluate(() => {
      // Buscamos elementos pequeños que contengan el texto de la tienda para evitar contenedores gigantes
      const elements = Array.from(document.querySelectorAll('div, li, tr, span'));
      for (const el of elements) {
        const text = el.innerText || "";
        if (text.includes("Steam Store") && text.length < 50) {
          // Limpiamos el texto para quedarnos únicamente con el estado (ej: "Normal", "Down")
          return text.replace("Steam Store", "").trim();
        }
      }
      return "Desconocido";
    });

    return storeStatus;
  } finally {
    await browser.close();
  }
}

async function sendToDiscord(message, webhooks = []) {
  for (const hook of webhooks) {
    if (!hook) continue;
    const form = new FormData();
    form.append("content", message);
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
  let storeStatus = await getSteamStatus();
  
  if (storeStatus === "Recovered") storeStatus = "Normal";

  let prevEstado = {};
  try {
    if (fs.existsSync(estadoPath)) {
      prevEstado = JSON.parse(fs.readFileSync(estadoPath, "utf-8"));
    }
  } catch (err) {
    console.warn("⚠️ No se pudo leer estado.json:", err);
  }

  const newEstado = { store: storeStatus };
  const emoji = statusEmoji(storeStatus);
  
  const lines = [];
  lines.push(`${emoji} **Estado de la Tienda de Steam:** ${storeStatus}`);

  // Si la tienda está caída o fallando, añade una alerta explícita en el mensaje
  if (isBadStatus(storeStatus)) {
    lines.push("\n🚨 **¡Atención! La Tienda de Steam parece estar caída o experimentando problemas.**");
  }

  // Verifica si el estado de la tienda ha cambiado respecto al último guardado
  const changed = prevEstado.store !== newEstado.store;

  fs.writeFileSync(estadoPath, JSON.stringify(newEstado, null, 2), "utf-8");

  if (changed) {
    await sendToDiscord(lines.join("\n"), changeHooks);
    console.log(`✅ Cambio detectado (${storeStatus}). Notificación enviada.`);
  } else {
    console.log("ℹ️ Sin cambios en el estado de la tienda.");
  }
}

main().catch(async err => {
  console.error("❌ Error Crítico:", err);
  const msg = `🚨 **Error en el monitor de Steam:**\n\`\`\`${err.message || err}\`\`\``;
  try {
    await sendToDiscord(msg, [WEBHOOK_URL_ERRORS]);
  } catch (e) {
    console.warn("❌ Falló el envío de alerta de error:", e.message);
  }
  process.exit(1);
});
