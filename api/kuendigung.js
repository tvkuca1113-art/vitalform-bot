// VITALFORM – Online-Kündigung (§ 312k BGB "Kündigungsbutton")
// ------------------------------------------------------------------
// Nimmt eine Kündigungserklärung entgegen, bestätigt dem Kunden den
// EINGANG unverzüglich in Textform (E-Mail, § 312k Abs. 4 BGB) und
// benachrichtigt den Anbieter zur Bearbeitung (z. B. Storno in Stripe).
// Kein Login nötig. API-Schlüssel bleiben serverseitig.
// ------------------------------------------------------------------

const memHits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = memHits.get(ip);
  if (!rec || now > rec.exp) { memHits.set(ip, { c: 1, exp: now + 60000 }); return false; }
  rec.c++;
  return rec.c > 6; // maks. 6 Kündigungsanfragen/min pro IP
}
function getIp(req) {
  const x = req.headers["x-forwarded-for"];
  if (x) return String(x).split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function clip(s, n) { return String(s == null ? "" : s).slice(0, n); }

async function brevoSend(apiKey, from, to, subject, html) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "VITALFORM", email: from }, to: [{ email: to }], subject: subject, htmlContent: html })
  });
  if (r.status < 200 || r.status >= 300) {
    const d = await r.json().catch(() => ({}));
    console.error("kuendigung mail HTTP", r.status, d && (d.message || d.code));
    return false;
  }
  return true;
}

function shell(title, inner) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0c1512">
    <div style="background:linear-gradient(135deg,#1bb356,#0b8a4f);padding:22px;border-radius:16px 16px 0 0;text-align:center">
      <div style="font-size:20px;font-weight:800;color:#fff">VITAL<span style="color:#a3e635">FORM</span></div>
    </div>
    <div style="border:1px solid #e7efe9;border-top:none;border-radius:0 0 16px 16px;padding:26px 24px">
      <h1 style="font-size:19px;margin:0 0 12px">${title}</h1>
      ${inner}
      <p style="color:#8a978f;font-size:12px;line-height:1.6;margin:18px 0 0;border-top:1px solid #e7efe9;padding-top:14px">VITALFORM · vitalform.fit · info@vitalform.fit</p>
    </div>
  </div>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch (e) { return res.status(400).json({ error: "Ungültige Anfrage." }); }

  // Honeypot (nur Bots füllen es aus) – tiho als Erfolg abweisen
  if (String(body.hp || "").trim() !== "") {
    return res.status(200).json({ ok: true, receivedAt: new Date().toISOString() });
  }
  if (tooMany(getIp(req))) {
    return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Bitte gib eine gültige E-Mail-Adresse an." });
  }
  const name = clip(body.name, 120).trim();
  if (name.length < 2) return res.status(400).json({ error: "Bitte gib deinen Namen an." });

  const contract = clip(body.contract, 80) || "KI-Coach-Abo";
  const artRaw = clip(body.art, 30);
  const art = artRaw === "ausserordentlich" ? "außerordentlich (mit Grund)" : "ordentlich zum nächstmöglichen Zeitpunkt";
  const reason = clip(body.reason, 600).trim();
  const ref = clip(body.ref, 120).trim(); // optional: Kundennummer/Bestell-/Rechnungsnummer
  const receivedAt = new Date();
  const stampDE = receivedAt.toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }) + " Uhr";
  const stampISO = receivedAt.toISOString();

  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM || "info@vitalform.fit";
  const ownerTo = process.env.KUENDIGUNG_TO || process.env.MAIL_FROM || "info@vitalform.fit";

  // § 312k verlangt keine sofort automatisierte Stornierung, aber eine
  // unverzügliche Eingangsbestätigung in Textback. Wir versenden:
  //  (1) Bestätigung an den Kunden  (2) Benachrichtigung an den Anbieter
  let mailOk = false;
  if (apiKey) {
    const rowsCustomer = `
      <p style="color:#5c6b63;line-height:1.6;margin:0 0 14px">Hallo ${esc(name)},</p>
      <p style="color:#5c6b63;line-height:1.6;margin:0 0 14px">wir bestätigen den <b>Eingang deiner Kündigung</b>. Deine Erklärung ging bei uns ein am:</p>
      <div style="background:#f4f9f5;border:1px solid #e7efe9;border-radius:12px;padding:14px 16px;margin:0 0 14px">
        <div style="font-size:15px;font-weight:800;color:#0f7a37">${esc(stampDE)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#1c2b24">
        <tr><td style="padding:5px 0;color:#8a978f">Vertrag</td><td style="padding:5px 0;font-weight:700">${esc(contract)}</td></tr>
        <tr><td style="padding:5px 0;color:#8a978f">Art der Kündigung</td><td style="padding:5px 0;font-weight:700">${esc(art)}</td></tr>
        ${ref ? `<tr><td style="padding:5px 0;color:#8a978f">Referenz</td><td style="padding:5px 0;font-weight:700">${esc(ref)}</td></tr>` : ""}
        ${reason ? `<tr><td style="padding:5px 0;color:#8a978f">Grund</td><td style="padding:5px 0">${esc(reason)}</td></tr>` : ""}
      </table>
      <p style="color:#5c6b63;line-height:1.6;margin:14px 0 0">Dein Zugang bleibt bis zum Ende des bereits bezahlten Zeitraums bestehen und verlängert sich danach nicht mehr. Bitte bewahre diese E-Mail als Nachweis auf. Fragen? Antworte einfach auf diese E-Mail.</p>`;
    const custHtml = shell("Deine Kündigung ist bei uns eingegangen ✅", rowsCustomer);

    const ownerHtml = shell("Neue Kündigung eingegangen", `
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#1c2b24">
        <tr><td style="padding:5px 0;color:#8a978f">Eingang</td><td style="padding:5px 0;font-weight:700">${esc(stampDE)}</td></tr>
        <tr><td style="padding:5px 0;color:#8a978f">Name</td><td style="padding:5px 0;font-weight:700">${esc(name)}</td></tr>
        <tr><td style="padding:5px 0;color:#8a978f">E-Mail</td><td style="padding:5px 0;font-weight:700">${esc(email)}</td></tr>
        <tr><td style="padding:5px 0;color:#8a978f">Vertrag</td><td style="padding:5px 0;font-weight:700">${esc(contract)}</td></tr>
        <tr><td style="padding:5px 0;color:#8a978f">Art</td><td style="padding:5px 0;font-weight:700">${esc(art)}</td></tr>
        ${ref ? `<tr><td style="padding:5px 0;color:#8a978f">Referenz</td><td style="padding:5px 0;font-weight:700">${esc(ref)}</td></tr>` : ""}
        ${reason ? `<tr><td style="padding:5px 0;color:#8a978f">Grund</td><td style="padding:5px 0">${esc(reason)}</td></tr>` : ""}
      </table>
      <p style="color:#b23c3c;line-height:1.6;margin:14px 0 0;font-size:13px"><b>To-Do:</b> Abo im Zahlungsanbieter (z. B. Stripe) zum Periodenende stornieren.</p>`);

    const okCust = await brevoSend(apiKey, from, email, "VITALFORM – Bestätigung deiner Kündigung", custHtml);
    const okOwner = await brevoSend(apiKey, from, ownerTo, "🔔 Neue Kündigung: " + name, ownerHtml);
    mailOk = okCust; // Kundenbestätigung ist die rechtlich relevante
    if (!okOwner) console.error("kuendigung: Owner-Mail fehlgeschlagen für", email);
  } else {
    console.error("kuendigung: BREVO_API_KEY fehlt – Kündigung von", email, "am", stampISO, "(nur geloggt, keine E-Mail-Bestätigung)");
  }

  // Auch ohne Mailversand bestätigen wir dem Nutzer auf dem Bildschirm den
  // Eingang mit Zeitstempel (dauerhafter Datenträger: speicher-/druckbar).
  return res.status(200).json({
    ok: true,
    mailed: mailOk,
    receivedAt: stampISO,
    receivedAtDE: stampDE,
    contract: contract,
    art: art
  });
}
