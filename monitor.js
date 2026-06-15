import { chromium } from "playwright";
import fs from "fs";

const WEBHOOK_URLS_CHANGES = process.env.WEBHOOK_URLS_CHANGES;
const WEBHOOK_URL_ERRORS = process.env.WEBHOOK_URL_ERRORS;
const estadoPath = "estado.json";

// Verifica si el estado es negativo
function isBadStatus(status) {
  const s = status.toLowerCase();
  const pctMatch = s.match(/(\d+(\.\d+)?)%/);
  // Si el estado es un porcentaje (CMS) y baja del 90%, se considera alerta
  if (pctMatch && parseFloat(pctMatch[1]) < 90) return true;
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

// Asigna el emoji correspondiente según el estado detectado
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

async function getSteamStatus() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Bloqueamos recursos innecesarios para que cargue al instante
  await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2,otf}', route => route.abort());

  try {
    await page.goto("https://steamstat.us/", { waitUntil: "domcontentloaded", timeout: 60000 });
    
    // Esperamos a que los selectores de los triggers actuales existan
    await page.waitForSelector('#store', { timeout: 30000 });

    const data = await page.evaluate(() => {
      // Extraemos exactamente los IDs del nuevo documento web
      let store = document.querySelector("#store")?.innerText.trim() || "Desconocido";
      let cms = document.querySelector("#cms")?.innerText.trim() || "Desconocido";
      
      // Normalizamos la palabra "Recovered" a "Normal"
      if (store === "Recovered") store = "Normal";
      if (cms === "Recovered") cms = "Normal";

      return { store, cms };
    });

    return data;
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
  const currentData = await getSteamStatus();

  let prevEstado = { store: "Desconocido", cms: "Desconocido" };
  try {
    if (fs.existsSync(estadoPath)) {
      prevEstado = JSON.parse(fs.readFileSync(estadoPath, "utf-8"));
    }
  } catch (err) {
    console.warn("⚠️ No se pudo leer estado.json:", err);
  }

  // Comparamos si hubo algún cambio ya sea en la Tienda o en los servidores (CMS)
  const changed = prevEstado.store !== currentData.store || prevEstado.cms !== currentData.cms;

  // Actualizamos y guardamos el estado
  fs.writeFileSync(estadoPath, JSON.stringify(currentData, null, 2), "utf-8");

  if (changed) {
    const lines = [];
    lines.push(`**Estado Actualizado de Steam**`);
    lines.push(`${statusEmoji(currentData.store)} **Tienda de Steam:** ${currentData.store}`);
    lines.push(`${statusEmoji(currentData.cms)} **Conexión a Steam (Servidores):** ${currentData.cms}`);

    // Añade aviso si el status es deficiente
    if (isBadStatus(currentData.store) || isBadStatus(currentData.cms)) {
      lines.push("\n🚨 **¡Atención! Steam o la Tienda están experimentando problemas.**");
    }

    await sendToDiscord(lines.join("\n"), changeHooks);
    console.log("✅ Cambio detectado. Notificación enviada a Discord.");
  } else {
    console.log("ℹ️ No hay cambios en la Tienda ni en Steam.");
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
