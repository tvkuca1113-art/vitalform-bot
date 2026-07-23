// VITALFORM – Quiz-Auswertung: persönliche, KI-generierte Analyse (gestreamt)
// ------------------------------------------------------------------
// Schreibt für JEDEN Teilnehmer eine individuelle, fachlich starke Auswertung
// (kein Standardtext) mit ehrlichem Hook zum Programm. Gestreamt = erscheint live.
// Eigenes Rate-Limit (pro IP/Tag) + Honeypot; zählt NICHT gegen das Chat-Trial.
// ------------------------------------------------------------------
import { redisIncr } from "../lib/store.js";

const QUIZ_LIMIT = parseInt(process.env.QUIZ_LIMIT || "12", 10); // Auswertungen pro IP / 24h
const DAY = 24 * 60 * 60;

const memStore = new Map();
function memIncr(key, ttlSec) {
  const now = Date.now();
  const r = memStore.get(key);
  if (!r || now > r.exp) { memStore.set(key, { c: 1, exp: now + ttlSec * 1000 }); return 1; }
  r.c++; return r.c;
}
async function incr(key, ttl) { const v = await redisIncr(key, ttl); return v !== null ? v : memIncr(key, ttl); }
function getIp(req) { const x = req.headers["x-forwarded-for"]; if (x) return String(x).split(",")[0].trim(); return req.headers["x-real-ip"] || "unknown"; }
function json(res, s, o) { res.statusCode = s; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); }
function clip(v, n) { return String(v == null ? "–" : v).slice(0, n); }

function buildPrompt(d) {
  const lang = d.lang === "en" ? "English" : "Deutsch";
  const a = d.answers || {}, s = d.stats || {}, c = d.computed || {};
  return `Du bist der VITALFORM KI-Coach – ein Weltklasse-Ernährungsberater und Personal Trainer, warm, aufmerksam und motivierend.
Ein möglicher neuer Kunde hat gerade den kostenlosen „Abnehm-Typ-Test" ausgefüllt. Schreibe ihm/ihr eine persönliche, fachlich exzellente Auswertung – so, dass die Person sofort spürt: „Das ist genau auf MICH zugeschnitten."

Daten dieser Person:
- Ziel: ${clip(a.ziel, 60)}
- Geschlecht: ${clip(a.geschlecht, 20)}
- Alltag/Aktivität: ${clip(a.aktiv, 60)}
- Größte Herausforderung: ${clip(a.challenge, 80)}
- Alter: ${clip(s.alter, 5)}, Größe: ${clip(s.groesse, 5)} cm, aktuelles Gewicht: ${clip(s.gewicht, 6)} kg, Wunschgewicht: ${clip(s.zielgewicht, 6)} kg
- Berechnet: Kalorienziel ${clip(c.kcal, 6)} kcal/Tag, Protein ${clip(c.protein, 5)} g/Tag, ca. ${clip(c.kgToLose, 5)} kg abzunehmen, realistisch in ~${clip(c.weeks, 4)} Wochen, ermittelter Typ: „${clip(c.typ, 40)}".

Schreibe die Auswertung (KEIN Standard-/Schablonentext – gehe konkret auf DIESE Person, ihre Zahlen und ihre größte Herausforderung ein):
- Beginne persönlich und wertschätzend, sprich die Person direkt an.
- Erkläre fachlich, aber verständlich, was ihr Typ und ihre Zahlen für SIE bedeuten und worauf es bei ihr besonders ankommt – nimm klar Bezug auf ihre größte Herausforderung.
- Gib 1–2 konkrete, sofort umsetzbare Experten-Tipps, die genau zu ihrer Situation passen.
- Schließe mit einem ehrlichen, motivierenden Hinweis, wie der VITALFORM KI-Coach + das 12-Wochen-Programm ihr genau dabei helfen (sanfter, glaubwürdiger Hook – nicht marktschreierisch).

Regeln: 130–190 Wörter. Antworte in ${lang}, in der Du-Form, warm und professionell. KEINE Kilo-Garantie (sprich von realistischen Spannen), keine medizinischen Heilversprechen. Strukturiere mit 1–2 kurzen Absätzen (bei Bedarf eine kurze Aufzählung). Verwende KEINE „[[VF:]]"-Marker und keine Bilder.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Method not allowed" }); }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(res, 503, { error: "not configured" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch (e) { return json(res, 400, { error: "bad request" }); }

  // Honeypot: Bots tragen das versteckte Feld ein -> still ablehnen
  if (String(body.hp || "").trim() !== "") return json(res, 200, { skipped: true });

  const ip = getIp(req);
  const count = await incr("quiz:" + ip, DAY);
  if (count > QUIZ_LIMIT) return json(res, 429, { error: "limit" });

  const model = process.env.QUIZ_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  function callClaude(m) {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: m, max_tokens: 700, stream: true,
        system: [{ type: "text", text: "Du bist der VITALFORM KI-Coach. Schreibe persönliche, fachlich exzellente, motivierende Abnehm-Typ-Auswertungen – niemals Standardtext." }],
        messages: [{ role: "user", content: buildPrompt(body) }]
      })
    });
  }

  try {
    let r = await callClaude(model);
    if (!r.ok && (r.status === 404 || r.status === 400) && model !== "claude-haiku-4-5") r = await callClaude("claude-haiku-4-5");
    if (!r.ok || !r.body) { const e = await r.json().catch(function () { return {}; }); return json(res, r.status || 500, { error: (e && e.error && e.error.message) || "error" }); }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const parts = block.split("\n");
        for (let li = 0; li < parts.length; li++) {
          const line = parts[li];
          if (line.indexOf("data:") === 0) {
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const ev = JSON.parse(payload);
              if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta" && ev.delta.text) res.write(ev.delta.text);
            } catch (e) { }
          }
        }
      }
    }
    return res.end();
  } catch (err) {
    console.error("quiz stream error", err && err.message);
    if (!res.headersSent) return json(res, 500, { error: "server error" });
    try { return res.end(); } catch (e) { }
  }
}
