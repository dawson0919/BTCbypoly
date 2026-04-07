const GAMMA_API = "https://gamma-api.polymarket.com";

export function parseMarket(m) {
  const q = (m.question || m.title || "").toLowerCase();
  let prices = [];
  let outcomes = [];
  try {
    prices = JSON.parse(m.outcomePrices || "[]").map(Number);
    outcomes = JSON.parse(m.outcomes || "[]");
  } catch (e) {
    prices = [];
    outcomes = [];
  }
  const vol = Number(m.volume || m.volumeNum || 0);
  const yesPrice = prices[0] || 0;

  let type = "other";
  let direction = null;
  let rangeLow = null;
  let rangeHigh = null;
  let threshold = null;
  let abDirection = null;
  let timeframe = null;

  if (q.includes("5 min") || q.includes("5min")) timeframe = "5m";
  else if (q.includes("15 min") || q.includes("15min")) timeframe = "15m";
  else if (q.includes("1 hour") || q.includes("1hr")) timeframe = "1h";
  else if (q.includes("4 hour") || q.includes("4hr")) timeframe = "4h";
  else if (q.includes("daily") || q.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d+/)) timeframe = "daily";
  else if (q.includes("weekly") || q.includes("week")) timeframe = "weekly";
  else if (q.includes("monthly") || q.includes("month")) timeframe = "monthly";

  if (q.includes("up or down") || q.includes("up/down")) {
    type = "updown";
    const firstOutcome = (outcomes[0] || "").toLowerCase();
    if (firstOutcome === "up") {
      direction = yesPrice >= 0.5 ? "up" : "down";
    } else {
      direction = yesPrice >= 0.5 ? "down" : "up";
    }
  } else if (q.match(/\d[\d,]*\s*-\s*\d[\d,]*/)) {
    const rangeMatch = q.match(/([\d,]+)\s*-\s*([\d,]+)/);
    if (rangeMatch) {
      const lo = Number(rangeMatch[1].replace(/,/g, ""));
      const hi = Number(rangeMatch[2].replace(/,/g, ""));
      if (lo >= 10000 && hi >= 10000) {
        type = "range";
        rangeLow = lo;
        rangeHigh = hi;
      }
    }
  } else if (q.includes("above") || q.includes("below") || q.includes("↑") || q.includes("↓")) {
    type = "above_below";
    const numMatch = q.match(/([\d,]+)/);
    if (numMatch) {
      const val = Number(numMatch[1].replace(/,/g, ""));
      if (val >= 10000) {
        threshold = val;
        abDirection = (q.includes("above") || q.includes("↑")) ? "above" : "below";
      }
    }
  }

  return {
    id: m.id, question: m.question || m.title, type, direction,
    rangeLow, rangeHigh, threshold, abDirection, timeframe,
    yesPrice, noPrice: prices[1] || 0, volume: vol, outcomes, slug: m.slug,
  };
}

export function deriveSignal(markets) {
  if (!markets.length) return null;

  const upDown = markets.filter((m) => m.type === "updown");
  const priceRange = markets.filter((m) => m.type === "range");
  const aboveBelow = markets.filter((m) => m.type === "above_below");

  let bullScore = 0, bearScore = 0, dirWeight = 0;
  upDown.forEach((m) => {
    const w = Math.log10(Math.max(m.volume, 1) + 1);
    if (m.direction === "up") { bullScore += m.yesPrice * w; }
    else { bearScore += m.yesPrice * w; }
    dirWeight += w;
  });
  const dirBias = dirWeight > 0 ? (bullScore - bearScore) / dirWeight : 0;

  let expectedRange = null, rangeConfidence = 0, topRange = null;
  if (priceRange.length > 0) {
    let totalProb = 0, weightedMid = 0, maxProb = 0;
    priceRange.forEach((m) => {
      if (m.rangeLow != null && m.rangeHigh != null) {
        const mid = (m.rangeLow + m.rangeHigh) / 2;
        weightedMid += mid * m.yesPrice;
        totalProb += m.yesPrice;
        if (m.yesPrice > maxProb) {
          maxProb = m.yesPrice;
          topRange = { low: m.rangeLow, high: m.rangeHigh, prob: m.yesPrice };
        }
      }
    });
    if (totalProb > 0) {
      expectedRange = Math​​​​​​​​​​​​​​​​
