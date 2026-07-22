// VITALFORM – Stripe Webhook (Vercel Serverless Function)
// ------------------------------------------------------------------
// Der KOMPLETTE Kauf-Ablauf endet hier:
//   Kunde zahlt (Stripe) -> Stripe ruft diese URL -> wir prüfen die Signatur,
//   erzeugen einen persönlichen Zugangscode mit Ablaufdatum, speichern ihn in
//   Redis und mailen ihn dem Kunden. So aktiviert der Kunde den KI-Coach und
//   der Zugang endet automatisch nach der bezahlten Laufzeit (z. B. 1 Monat).
//
// SICHERHEIT:
//  - Signaturprüfung (HMAC-SHA256) gegen STRIPE_WEBHOOK_SECRET -> gefälschte
//    "Zahlung erfolgreich"-Aufrufe sind unmöglich (niemand kann Gratis-Codes erzwingen).
//  - Replay-Schutz (Zeitfenster) + Idempotenz (jedes Event nur einmal verarbeitet).
//  - Codes sind kryptografisch zufällig und laufen serverseitig ab.
// ------------------------------------------------------------------
import crypto from "node:crypto";
import { redisSetNx, putLicense, getLicense, getCodeBySub, genCode, nowSec } from "../lib/store.js";

// Vercel darf den Body NICHT parsen – für die Signaturprüfung brauchen wir den Rohtext.
export const config = { api: { bodyParser: false } };

// Produkte -> Laufzeit des KI-Coach-Zugangs (Tage). "content" = kein Bot-Code (reine Download-Ware).
const PLANS = {
  plan:     { label: "Ernährungsplan (4 Wochen)", botDays: 0,  kind: "content" },
  programm: { label: "12-Wochen-Programm",         botDays: 31, kind: "onetime" },
  coach:    { label: "VITALFORM KI-Coach",         botDays: 33, kind: "subscription" }
};
// Fallback-Zuordnung über den Betrag (in Cent). Nur genutzt, wenn client_reference_id/metadata fehlen.
const AMOUNT_TO_PLAN = {
  [process.env.STRIPE_AMOUNT_PLAN     || "3900"]: "plan",     // 39€
  [process.env.STRIPE_AMOUNT_PROGRAMM || "9700"]: "programm", // 97€
  [process.env.STRIPE_AMOUNT_COACH    || "1990"]: "coach"     // 19,90€
};

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// Stripe-Signatur prüfen (unterstützt mehrere v1-Signaturen während Secret-Rotation).
function verifySignature(rawBuf, sigHeader, secret, toleranceSec) {
  if (!sigHeader || !secret) return false;
  let t = null; const v1s = [];
  sigHeader.split(",").forEach(function (kv) {
    const i = kv.indexOf("=");
    if (i < 0) return;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === "t") t = v; else if (k === "v1") v1s.push(v);
  });
  if (!t || !v1s.length) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + rawBuf.toString("utf8"), "utf8").digest("hex");
  const eBuf = Buffer.from(expected);
  const match = v1s.some(function (v) {
    const vBuf = Buffer.from(v);
    return vBuf.length === eBuf.length && crypto.timingSafeEqual(vBuf, eBuf);
  });
  if (!match) return false;
  const age = nowSec() - parseInt(t, 10);
  if (Number.isFinite(age) && Math.abs(age) > (toleranceSec || 300)) return false; // Replay-Schutz
  return true;
}

function identifyPlan(session) {
  const cri = (session.client_reference_id || "").toString();
  if (PLANS[cri]) return cri;
  const mp = session.metadata && session.metadata.plan;
  if (mp && PLANS[mp]) return mp;
  if (session.mode === "subscription") return "coach";
  const amt = session.amount_total;
  if (amt != null && AMOUNT_TO_PLAN[String(amt)]) return AMOUNT_TO_PLAN[String(amt)];
  return null;
}

function deDate(unixSec) {
  try { return new Date(unixSec * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" }); }
  catch (e) { return ""; }
}

async function sendEmail(to, subject, html) {
  const key = process.env.BREVO_API_KEY;
  if (!key || !to) { console.error("email skip (no BREVO_API_KEY or recipient)"); return false; }
  const from = process.env.MAIL_FROM || "info@vitalform.fit";
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "VITALFORM", email: from }, to: [{ email: to }], subject: subject, htmlContent: html })
    });
    if (r.status >= 200 && r.status < 300) return true;
    const e = await r.json().catch(function () { return {}; });
    console.error("brevo email error", r.status, e && (e.message || e.code));
    return false;
  } catch (e) { console.error("brevo email exception", e && e.message); return false; }
}

function codeEmailHtml(code, planLabel, expiresAt, siteUrl, materials) {
  const until = expiresAt ? deDate(expiresAt) : "";
  const coachUrl = siteUrl + "/coach.html";
  const matHtml = (materials && materials.length) ? `
      <div style="margin:22px 0 4px;border-top:1px solid #e7efe9;padding-top:16px">
        <div style="font-weight:800;font-size:15px;margin-bottom:8px">📚 Deine Programm-Materialien</div>
        ${materials.map(function (m) { return `<a href="${m.url}" style="display:block;color:#0f7a37;text-decoration:none;font-weight:700;padding:8px 0;border-bottom:1px solid #f0f5f1">⬇&nbsp; ${m.name}</a>`; }).join("")}
      </div>` : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0c1512">
    <div style="background:linear-gradient(135deg,#1bb356,#0b8a4f);padding:26px;border-radius:16px 16px 0 0;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em">VITAL<span style="color:#a3e635">FORM</span></div>
    </div>
    <div style="border:1px solid #e7efe9;border-top:none;border-radius:0 0 16px 16px;padding:28px 26px">
      <h1 style="font-size:20px;margin:0 0 10px">Willkommen bei VITALFORM! 🎉</h1>
      <p style="color:#5c6b63;line-height:1.6;margin:0 0 18px">Vielen Dank für deinen Kauf: <b>${planLabel}</b>. Hier ist dein persönlicher Zugangscode für den KI-Coach:</p>
      <div style="background:#f4f9f5;border:2px dashed #16a34a;border-radius:12px;padding:18px;text-align:center;font-size:24px;font-weight:800;letter-spacing:2px;color:#0f7a37">${code}</div>
      ${until ? `<p style="color:#5c6b63;font-size:14px;margin:14px 0 0">Dein Zugang ist aktiv bis <b>${until}</b>.</p>` : ""}
      <div style="text-align:center;margin:24px 0 8px">
        <a href="${coachUrl}" style="display:inline-block;background:linear-gradient(135deg,#1bb356,#0b8a4f);color:#fff;text-decoration:none;padding:14px 28px;border-radius:50px;font-weight:700">Coach jetzt aktivieren →</a>
      </div>
      <p style="color:#8a978f;font-size:13px;line-height:1.6;margin:18px 0 0">So aktivierst du: Öffne den KI-Coach, klicke auf „Zugangscode eingeben" und trage den Code oben ein. Fertig!</p>
      ${matHtml}
      <p style="color:#8a978f;font-size:12px;line-height:1.6;margin:18px 0 0;border-top:1px solid #e7efe9;padding-top:14px">Bei Fragen antworte einfach auf diese E-Mail. VITALFORM · vitalform.fit</p>
    </div>
  </div>`;
}

function contentEmailHtml(planLabel, downloadUrl, siteUrl) {
  const cta = downloadUrl
    ? `<div style="text-align:center;margin:24px 0 8px"><a href="${downloadUrl}" style="display:inline-block;background:linear-gradient(135deg,#1bb356,#0b8a4f);color:#fff;text-decoration:none;padding:14px 28px;border-radius:50px;font-weight:700">Materialien herunterladen →</a></div>`
    : `<p style="color:#5c6b63;line-height:1.6">Deine Materialien schicken wir dir in Kürze an diese E-Mail-Adresse. 📩</p>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0c1512">
    <div style="background:linear-gradient(135deg,#1bb356,#0b8a4f);padding:26px;border-radius:16px 16px 0 0;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#fff">VITAL<span style="color:#a3e635">FORM</span></div>
    </div>
    <div style="border:1px solid #e7efe9;border-top:none;border-radius:0 0 16px 16px;padding:28px 26px">
      <h1 style="font-size:20px;margin:0 0 10px">Danke für deinen Kauf! 🎉</h1>
      <p style="color:#5c6b63;line-height:1.6;margin:0 0 8px">Du hast <b>${planLabel}</b> gekauft.</p>
      ${cta}
      <p style="color:#8a978f;font-size:12px;line-height:1.6;margin:18px 0 0;border-top:1px solid #e7efe9;padding-top:14px">Bei Fragen antworte einfach auf diese E-Mail. VITALFORM · vitalform.fit</p>
    </div>
  </div>`;
}

function json(res, status, obj) { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); }

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Method not allowed" }); }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) { console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET fehlt"); return json(res, 500, { error: "not configured" }); }

  const raw = await readRaw(req);
  const sig = req.headers["stripe-signature"];
  if (!verifySignature(raw, sig, secret, 300)) {
    console.error("stripe-webhook: ungültige Signatur");
    return json(res, 400, { error: "invalid signature" });
  }

  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch (e) { return json(res, 400, { error: "bad json" }); }

  // Idempotenz: jedes Event nur EINMAL verarbeiten (Stripe sendet ggf. mehrfach).
  if (event.id) {
    const fresh = await redisSetNx("evt:" + event.id, "1", 24 * 3600);
    // Wenn Redis konfiguriert ist und das Event schon verarbeitet wurde -> sofort OK.
    if (fresh === false) return json(res, 200, { received: true, duplicate: true });
  }

  const siteUrl = (process.env.SITE_URL || "https://vitalform.fit").replace(/\/+$/, "");
  // Download-Links der Produkt-Materialien (ENV-Override, sonst Standard im /downloads Ordner)
  const DL = function (f) { return siteUrl + "/downloads/" + f; };
  const MATERIALS = {
    ernaehrung: process.env.MATERIALS_URL_PLAN || DL("vitalform-ernaehrungsplan-vf7k2p9.pdf"),
    training: process.env.MATERIALS_URL_TRAINING || DL("vitalform-trainingsplan-vf4m8x3.pdf"),
    tracker: process.env.MATERIALS_URL_TRACKER || DL("vitalform-tracker-vf9q1r5.pdf")
  };

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const email = (s.customer_details && s.customer_details.email) || s.customer_email || "";
      const planKey = identifyPlan(s);
      const plan = planKey && PLANS[planKey];
      if (!plan) { console.error("stripe-webhook: Plan unbekannt", s.amount_total, s.mode); return json(res, 200, { received: true, note: "plan unknown" }); }

      if (plan.kind === "content") {
        // 39€ Ernährungsplan: reine Download-Ware (Ernährungsplan-PDF)
        await sendEmail(email, "Deine VITALFORM-Materialien 🍽️", contentEmailHtml(plan.label, MATERIALS.ernaehrung, siteUrl));
        return json(res, 200, { received: true, plan: planKey, delivered: "content" });
      }

      // Bot-Zugang: Code erzeugen, mit Ablauf speichern, per Mail schicken.
      // 97€ Programm bekommt zusätzlich alle Programm-Materialien mitgeschickt.
      const materials = planKey === "programm" ? [
        { name: "Ernährungsplan (4 Wochen + 40+ Rezepte)", url: MATERIALS.ernaehrung },
        { name: "12-Wochen-Trainingsplan (Home & Gym)", url: MATERIALS.training },
        { name: "Fortschritts-Tracker", url: MATERIALS.tracker }
      ] : null;
      const code = genCode();
      const expiresAt = nowSec() + plan.botDays * 24 * 3600;
      await putLicense(code, {
        plan: planKey, email: email, expiresAt: expiresAt,
        subId: s.subscription || null, source: "stripe"
      });
      await sendEmail(email, "Dein VITALFORM-Zugangscode 🔑", codeEmailHtml(code, plan.label, expiresAt, siteUrl, materials));
      console.log("stripe-webhook: Lizenz erstellt", planKey, "bis", deDate(expiresAt));
      return json(res, 200, { received: true, plan: planKey, issued: true });
    }

    // Abo-Verlängerung (monatliche Folgezahlung) -> Zugang um einen Monat verlängern.
    if (event.type === "invoice.paid") {
      const inv = event.data.object;
      if (inv.billing_reason !== "subscription_cycle") return json(res, 200, { received: true, note: "not a renewal" });
      const subId = inv.subscription;
      const email = inv.customer_email || "";
      const newExpiry = nowSec() + PLANS.coach.botDays * 24 * 3600;
      let code = await getCodeBySub(subId);
      if (code) {
        const rec = await getLicense(code) || {};
        await putLicense(code, { plan: "coach", email: rec.email || email, expiresAt: newExpiry, subId: subId, source: "stripe", createdAt: rec.createdAt });
        console.log("stripe-webhook: Abo verlängert", code, "bis", deDate(newExpiry));
      } else {
        // Selbstheilung: Code fehlt -> neuen erzeugen und mailen.
        code = genCode();
        await putLicense(code, { plan: "coach", email: email, expiresAt: newExpiry, subId: subId, source: "stripe" });
        await sendEmail(email, "Dein VITALFORM-Zugangscode 🔑", codeEmailHtml(code, PLANS.coach.label, newExpiry, siteUrl));
      }
      return json(res, 200, { received: true, renewed: true });
    }

    // Abo gekündigt -> Zugang läuft zum Periodenende aus.
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const code = await getCodeBySub(sub.id);
      if (code) {
        const rec = await getLicense(code);
        if (rec) {
          const endAt = sub.current_period_end || nowSec();
          rec.status = "canceled"; rec.expiresAt = Math.min(rec.expiresAt || endAt, endAt);
          await putLicense(code, rec);
          console.log("stripe-webhook: Abo gekündigt", code, "Zugang bis", deDate(rec.expiresAt));
        }
      }
      return json(res, 200, { received: true, canceled: true });
    }

    return json(res, 200, { received: true, ignored: event.type });
  } catch (err) {
    console.error("stripe-webhook: Verarbeitungsfehler", err && err.message);
    return json(res, 500, { error: "processing error" });
  }
}
