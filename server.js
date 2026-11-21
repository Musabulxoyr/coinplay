const express = require("express");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const app = express();
app.use(express.json());

const TOKEN = process.env.BOT_TOKEN, APP_URL = process.env.APP_URL;
const FEE = 200;                 // turnirga qatnashish narxi (tanga)
const SHARES = [0.5, 0.3, 0.2];  // 1, 2, 3-o’rin ulushi
const TZ = 5 * 3600e3;           // Toshkent vaqti (UTC+5)
const FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

let db = { t: {}, claimed: {} };
try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(db)); } catch (e) { console.error("saqlash xato:", e.message); } };

// Telegram initData tekshiruvi (soxta foydalanuvchidan himoya)
function verify(initData) {
  try {
    if (!TOKEN || !initData) return null;
    const p = new URLSearchParams(initData);
    const hash = p.get("hash"); p.delete("hash");
    const str = [...p.entries()].map(([k, v]) => k + "=" + v).sort().join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const h = crypto.createHmac("sha256", secret).update(str).digest("hex");
    if (h !== hash) return null;
    return JSON.parse(p.get("user"));
  } catch (e) { return null; }
}
const getUser = req => verify(req.headers["x-init"] || (req.body && req.body.initData));

const dayAt = off => new Date(Date.now() + TZ + off * 864e5);
const ymd = d => d.toISOString().slice(0, 10);
function info() {
  const day = dayAt(0).getUTCDay(), back = (day - 5 + 7) % 7;
  return {
    active: day === 5,
    cur: ymd(dayAt(-back)),
    next: ymd(dayAt(day === 5 ? 0 : (5 - day + 7) % 7)),
    last: day === 5 ? ymd(dayAt(-7)) : ymd(dayAt(-back))
  };
}
const rank = key => Object.entries((db.t[key] && db.t[key].p) || {}).map(([id, p]) => ({ id, n: p.n, s: p.s })).sort((a, b) => b.s - a.s);
const poolOf = key => Math.floor(rank(key).length * FEE * 0.7);
function prizes(key) {
  const pool = poolOf(key), out = {};
  rank(key).slice(0, 3).forEach((p, i) => { if (p.s > 0) out[p.id] = Math.floor(pool * SHARES[i]); });
  return out;
}

app.get("/api/state", (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ err: "auth" });
  const f = info(), id = String(u.id);
  res.json({
    fee: FEE, active: f.active, next: f.next,
    joined: !!(db.t[f.cur] && db.t[f.cur].p[id] && f.active),
    pool: poolOf(f.cur),
    top: rank(f.active ? f.cur : f.last).slice(0, 10),
    prize: db.claimed[f.last + ":" + id] ? 0 : (prizes(f.last)[id] || 0)
  });
});
app.post("/api/join", (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ err: "auth" });
  const f = info(), id = String(u.id);
  if (!f.active) return res.json({ ok: false, err: "Turnir faqat juma kuni" });
  const t = db.t[f.cur] || (db.t[f.cur] = { p: {} });
  const already = !!t.p[id];
  if (!already) t.p[id] = { n: String(u.first_name || "O’yinchi").slice(0, 20), s: 0 };
  save(); res.json({ ok: true, already });
});
app.post("/api/score", (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ err: "auth" });
  const f = info(), t = db.t[f.cur], id = String(u.id);
  if (!f.active || !t || !t.p[id]) return res.json({ ok: false });
  t.p[id].s = Math.max(t.p[id].s, Math.min(Math.floor(+req.body.score) || 0, 400));
  save(); res.json({ ok: true });
});
app.post("/api/claim", (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ err: "auth" });
  const f = info(), id = String(u.id), k = f.last + ":" + id;
  const prize = prizes(f.last)[id] || 0;
  if (!prize || db.claimed[k]) return res.json({ prize: 0 });
  db.claimed[k] = 1; save(); res.json({ prize });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (req, res) => res.send("ok"));
app.get("/reward", (req, res) => { console.log("Reward so’rovi:", req.query); res.status(200).send("ok"); });

// Bot: /start ga javob beradi va Mini App tugmasini ko’rsatadi.
async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return r.json();
}
async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const r = await api("getUpdates", { offset, timeout: 30 });
      if (!r.ok) { console.error("getUpdates xato:", r.error_code, r.description); await new Promise(x => setTimeout(x, 5000)); continue; }
      for (const u of r.result || []) {
        offset = u.update_id + 1;
        const m = u.message;
        if (m && m.text && m.text.startsWith("/start")) {
          await api("sendMessage", {
            chat_id: m.chat.id,
            text: "👋 Salom, " + ((m.from && m.from.first_name) || "do’st") + "!\n\n🎮 CoinPlay’ga xush kelibsiz.\nIlon, shashka, shaxmat o’ynang, reklama ko’rib tanga yig’ing va juma turnirida sovrin yuting.\n\nBoshlash uchun pastdagi tugmani bosing 👇",
            reply_markup: { inline_keyboard: [[{ text: "🎮 O’ynash", web_app: { url: APP_URL } }]] }
          });
        }
      }
    } catch (e) { console.error("poll xato:", e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
}
if (TOKEN && APP_URL) {
  // Xabar yozish maydoni yonida "O’ynash" tugmasi chiqadi
  api("setChatMenuButton", { menu_button: { type: "web_app", text: "🎮 O’ynash", web_app: { url: APP_URL } } }).catch(() => {});
  console.log("Bot yoqildi, /start kutilmoqda");
  poll();
} else console.log("BOT_TOKEN/APP_URL yo’q: bot o’chiq");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("CoinPlay ishga tushdi, port " + PORT));
