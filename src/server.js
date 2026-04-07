import express from "express";
import cron from "node-cron";
import { runSignalPipeline, formatTelegram } from "./signal.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

let latestSignal = null;
let latestMarkets = [];
let lastUpdateTime = null;
let history = [];

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

async function sendTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "Markdown" }),
    });
    const data = await res.json();
    if (!data.ok) console.error("[TG] Error:", data.description);
    else console.log("[TG] Sent");
  } catch (err) {
    console.error("[TG] Error:", err.message);
  }
}

async function updateSignal() {
  console.log(`[Cron] Updating at ${new Date().toISOString()}`);
  try {
    const { markets, signal } = await runSignalPipeline();
    latestMarkets = markets;
    latestSignal = signal;
    lastUpdateTime = new Date().toISOString();
    if (signal) {
      history.push({
        composite: signal.composite, strength: signal.strength,
        marketCount: signal.marketCount, totalVolume: signal.totalVolume,
        timestamp: signal.timestamp,
      });
      if (history.length > 288) history = history.slice(-288);
      console.log(`[Cron] ${signal.label} | Score: ${(signal.composite * 100).toFixed(1)} | Markets: ${signal.marketCount}`);
    }
    return signal;
  } catch (err) {
    console.error("[Cron] Error:", err.message);
    return null;
  }
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", lastUpdate: lastUpdateTime, marketCount: latestMarkets.length, uptime: process.uptime() });
});

app.get("/api/signal", (req, res) => {
  res.json({ signal: latestSignal, lastUpdate: lastUpdateTime });
});

app.get("/api/markets", (req, res) => {
  let filtered = latestMarkets;
  if (req.query.type) filtered = filtered.filter((m) => m.type === req.query.type);
  if (req.query.timeframe) filtered = filtered.filter((m) => m.timeframe === req.query.timeframe);
  res.json({ markets: filtered, total: filtered.length, lastUpdate: lastUpdateTime });
});

app.get("/api/history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 288);
  res.json({ history: history.slice(-limit), total: history.length });
});

app.post("/api/refresh", async (req, res) => {
  const signal = await updateSignal();
  res.json({ signal, lastUpdate: lastUpdateTime });
});

app.post("/api/notify", async (req, res) => {
  if (!latestSignal) await updateSignal();
  if (latestSignal) {
    await sendTelegram(formatTelegram(latestSignal));
    res.json({ ok: true });
  } else {
    res.json({ ok: false, message: "No signal" });
  }
});

app.use(express.static(join(__dirname, "..", "public")));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(join(__dirname, "..", "public", "index.html"));
});

cron.schedule("*/5 * * * *", () => { updateSignal(); });

cron.schedule("0 * * * *", async () => {
  const signal = await updateSignal();
  if (signal && TG_BOT_TOKEN && TG_CHAT_ID) {
    await sendTelegram(formatTelegram(signal));
  }
});

app.listen(PORT, async () => {
  console.log(`\n₿ Polymarket BTC Signal | Port ${PORT} | TG: ${TG_BOT_TOKEN ? "✓" : "✗"}\n`);
  await updateSignal();
});
