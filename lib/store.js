// VITALFORM – gemeinsame Speicher-/Lizenz-Bibliothek (Upstash Redis REST)
// ------------------------------------------------------------------
// Wird von /api/chat.js und /api/stripe-webhook.js genutzt.
// Enthält:
//  - Redis-Helfer (GET/SET/DEL/INCR mit TTL/PING) über die REST-API
//  - Lizenz-Logik: Zugangscodes mit Ablaufdatum (persistiert in Redis)
// SICHERHEIT: Der Upstash-Token bleibt IMMER nur auf dem Server.
// ------------------------------------------------------------------
import crypto from "node:crypto";

const BASE = () => (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || "";
export function redisReady() { return !!(BASE() && TOKEN()); }

// Ein einzelnes Kommando an die Basis-URL
async function redisCmd(cmd) {
  if (!redisReady()) return null;
  try {
    const r = await fetch(BASE(), {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN(), "content-type": "application/json" },
      body: JSON.stringify(cmd)
    });
    if (!r.ok) { console.error("redisCmd HTTP", r.status, cmd[0]); return null; }
    const j = await r.json();
    return (j && typeof j.result !== "undefined") ? j.result : null;
  } catch (e) { console.error("redisCmd error", e && e.message); return null; }
}

// Pipeline (mehrere Kommandos) MUSS an /pipeline gehen (sonst lehnt Upstash ab).
async function redisPipeline(cmds) {
  if (!redisReady()) return null;
  try {
    const r = await fetch(BASE() + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + TOKEN(), "content-type": "application/json" },
      body: JSON.stringify(cmds)
    });
    if (!r.ok) { console.error("redisPipeline HTTP", r.status); return null; }
    return await r.json();
  } catch (e) { console.error("redisPipeline error", e && e.message); return null; }
}

// INCR + EXPIRE(NX) atomar per Pipeline – Basis für Rate-Limits.
export async function redisIncr(key, ttlSec) {
  const j = await redisPipeline([["INCR", key], ["EXPIRE", key, String(ttlSec), "NX"]]);
  if (Array.isArray(j) && j[0] && typeof j[0].result !== "undefined") return j[0].result;
  if (j !== null) console.error("redisIncr unexpected", JSON.stringify(j).slice(0, 160));
  return null;
}

export async function redisPing() {
  if (!redisReady()) return "not_configured";
  const r = await redisCmd(["PING"]);
  if (r === null) return "error_exception";
  return (String(r).toUpperCase() === "PONG") ? "ok" : "error_response";
}

export async function redisGet(key) { return redisCmd(["GET", key]); }
export async function redisSetEx(key, val, ttlSec) { return redisCmd(["SET", key, val, "EX", String(Math.max(1, Math.round(ttlSec)))]); }
export async function redisDel(key) { return redisCmd(["DEL", key]); }

// Idempotenz: true, wenn dieser Schlüssel neu gesetzt wurde (SET key val NX EX ttl)
export async function redisSetNx(key, val, ttlSec) {
  const r = await redisCmd(["SET", key, val, "NX", "EX", String(Math.max(1, Math.round(ttlSec)))]);
  return r !== null && String(r).toUpperCase() === "OK";
}

// -------------------- Gemeldete KI-Antworten (Qualitätsprüfung) --------------------
// Nutzer können eine Antwort mit einem Klick „melden". Wir halten eine kurze,
// begrenzte Liste zur manuellen Sichtung. Inhalt wird gekappt, Liste getrimmt,
// TTL sorgt fürs automatische Aufräumen. Persistiert nur mit konfiguriertem Redis.
export async function pushReport(rec, cap, ttlSec) {
  const val = JSON.stringify(rec).slice(0, 4000);
  const j = await redisPipeline([
    ["LPUSH", "vf:reports", val],
    ["LTRIM", "vf:reports", "0", String(Math.max(1, cap) - 1)],
    ["EXPIRE", "vf:reports", String(Math.max(60, Math.round(ttlSec)))]
  ]);
  return j !== null;
}
export async function getReports(limit) {
  const r = await redisCmd(["LRANGE", "vf:reports", "0", String(Math.max(1, limit) - 1)]);
  if (!Array.isArray(r)) return [];
  return r.map(function (s) { try { return JSON.parse(s); } catch (e) { return { raw: s }; } });
}

// -------------------- Lizenzen (Zugangscodes mit Ablauf) --------------------

// Menschlich lesbarer, aber kryptografisch zufälliger Code: VF-XXXXX-XXXXX
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O/1/I – weniger Tippfehler
export function genCode() {
  const bytes = crypto.randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return "VF-" + s.slice(0, 5) + "-" + s.slice(5, 10);
}

const licKey = (code) => "lic:" + String(code).trim().toUpperCase();
const GRACE_SEC = 3 * 24 * 3600; // Redis-TTL etwas über Ablauf, damit "abgelaufen" noch lesbar ist

// Lizenz anlegen/aktualisieren. expiresAt = Unix-Sekunden.
export async function putLicense(code, data) {
  const rec = Object.assign({ status: "active", createdAt: nowSec() }, data);
  const ttl = Math.max(60, (rec.expiresAt - nowSec()) + GRACE_SEC);
  await redisSetEx(licKey(code), JSON.stringify(rec), ttl);
  if (rec.subId) await redisSetEx("sub:" + rec.subId, String(code).toUpperCase(), ttl);
  return rec;
}

export async function getLicense(code) {
  if (!code) return null;
  const raw = await redisGet(licKey(code));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export async function getCodeBySub(subId) {
  if (!subId) return null;
  return redisGet("sub:" + subId);
}

export async function revokeLicense(code) {
  const rec = await getLicense(code);
  if (!rec) return false;
  rec.status = "revoked"; rec.expiresAt = nowSec();
  await redisSetEx(licKey(code), JSON.stringify(rec), GRACE_SEC);
  return true;
}

// Prüft Gültigkeit + Ablauf. Gibt einheitliches Status-Objekt zurück.
export async function licenseStatus(code) {
  const rec = await getLicense(code);
  if (!rec) return { valid: false, reason: "unknown" };
  if (rec.status === "revoked") return { valid: false, reason: "revoked", plan: rec.plan };
  if (rec.expiresAt && rec.expiresAt <= nowSec()) return { valid: false, reason: "expired", plan: rec.plan, expiresAt: rec.expiresAt };
  return { valid: true, plan: rec.plan, expiresAt: rec.expiresAt || null };
}

export function nowSec() { return Math.floor(Date.now() / 1000); }
