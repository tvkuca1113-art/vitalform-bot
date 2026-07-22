// VITALFORM – Lead-Capture (Brevo)
// Dodaje email (+ opcione atribute) u Brevo listu. API kljuc ostaje na serveru.
// Lista preko BREVO_LIST_ID (default: 3).

const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID || "3", 10);

const memHits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = memHits.get(ip);
  if (!rec || now > rec.exp) { memHits.set(ip, { c: 1, exp: now + 60000 }); return false; }
  rec.c++;
  return rec.c > 12;
}
function getIp(req) {
  const x = req.headers["x-forwarded-for"];
  if (x) return String(x).split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

async function brevoAddContact(apiKey, payload) {
  const r = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(payload)
  });
  let data = {};
  if (r.status !== 201 && r.status !== 204) { data = await r.json().catch(() => ({})); }
  return { status: r.status, data: data };
}
function isSuccess(res) { return res.status === 201 || res.status === 204; }
function isDuplicate(res) {
  return res.data && (res.data.code === "duplicate_parameter" || (res.data.message && /exist/i.test(res.data.message)));
}

// Automatski „7-Tage-Plan" email (ispunjenje obećanja s kvize/forme) preko Brevo transakcijskog maila.
async function sendPlanEmail(apiKey, email) {
  if (!apiKey || !email) return false;
  const from = process.env.MAIL_FROM || "info@vitalform.fit";
  const site = (process.env.SITE_URL || "https://vitalform.fit").replace(/\/+$/, "");
  const pdf = site + "/downloads/vitalform-7-tage-plan.pdf";
  const row = (d, f, m, s, a) => `<tr><td style="padding:7px 9px;border-bottom:1px solid #eef4f0;font-weight:700;color:#0f7a37">${d}</td><td style="padding:7px 9px;border-bottom:1px solid #eef4f0;font-size:13px">${f}</td><td style="padding:7px 9px;border-bottom:1px solid #eef4f0;font-size:13px">${m}</td><td style="padding:7px 9px;border-bottom:1px solid #eef4f0;font-size:13px">${a}</td></tr>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0c1512">
    <div style="background:linear-gradient(135deg,#1bb356,#0b8a4f);padding:26px;border-radius:16px 16px 0 0;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#fff">VITAL<span style="color:#a3e635">FORM</span></div>
    </div>
    <div style="border:1px solid #e7efe9;border-top:none;border-radius:0 0 16px 16px;padding:28px 26px">
      <h1 style="font-size:21px;margin:0 0 10px">Dein 7-Tage-Plan ist da! 🥗</h1>
      <p style="color:#5c6b63;line-height:1.6;margin:0 0 16px">Wie versprochen – dein kostenloser Start. Proteinreich, sättigend und ohne Verzicht. Hier ist ein Vorgeschmack, den kompletten Plan mit Rezepten &amp; Einkaufsliste bekommst du als PDF:</p>
      <div style="text-align:center;margin:0 0 18px"><a href="${pdf}" style="display:inline-block;background:linear-gradient(135deg,#1bb356,#0b8a4f);color:#fff;text-decoration:none;padding:13px 26px;border-radius:50px;font-weight:700">📄 Kompletten 7-Tage-Plan öffnen</a></div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e7efe9;border-radius:10px;overflow:hidden">
        <tr style="background:#0c1512;color:#fff"><th style="padding:7px 9px;text-align:left;font-size:12px">Tag</th><th style="padding:7px 9px;text-align:left;font-size:12px">Frühstück</th><th style="padding:7px 9px;text-align:left;font-size:12px">Mittag</th><th style="padding:7px 9px;text-align:left;font-size:12px">Abend</th></tr>
        ${row("1", "Overnight Oats", "Hähnchen-Reis-Bowl", "", "Lachs + Süßkartoffel")}
        ${row("2", "Rührei + Vollkorn", "Putenpfanne", "", "Linsen-Dal")}
        ${row("3", "Magerquark-Bowl", "One-Pan Hähnchen", "", "Vollkorn-Bolognese")}
      </table>
      <p style="color:#8a978f;font-size:13px;margin:14px 0 0">…und 4 weitere Tage im PDF. 💪</p>
      <div style="background:#f4f9f5;border:1px solid #e7efe9;border-radius:12px;padding:16px;margin:20px 0 0">
        <p style="margin:0;font-size:14px;color:#1c2b24"><b>Bereit für mehr?</b> Im VITALFORM-Programm bekommst du deinen persönlichen Plan + KI-Coach rund um die Uhr. <a href="${site}" style="color:#0f7a37;font-weight:700">Jetzt ansehen →</a></p>
      </div>
      <p style="color:#8a978f;font-size:12px;line-height:1.6;margin:18px 0 0;border-top:1px solid #e7efe9;padding-top:14px">Du erhältst diese E-Mail, weil du deinen kostenlosen 7-Tage-Plan angefordert hast. VITALFORM · vitalform.fit</p>
    </div>
  </div>`;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "VITALFORM", email: from }, to: [{ email: email }], subject: "Dein kostenloser 7-Tage-Plan 🥗", htmlContent: html })
    });
    if (r.status < 200 || r.status >= 300) console.error("plan email HTTP", r.status);
    return r.status >= 200 && r.status < 300;
  } catch (e) { console.error("plan email error", e && e.message); return false; }
}

async function okWithPlan(res, existed, apiKey, email) {
  await sendPlanEmail(apiKey, email); // best-effort; ne ruši hvatanje leada ako mail padne
  return res.status(200).json({ ok: true, existed: existed });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("lead: BREVO_API_KEY fehlt (in Vercel setzen)");
    return res.status(503).json({ error: "Anmeldung momentan nicht möglich. Bitte versuche es später erneut." });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch (e) { return res.status(400).json({ error: "Ungültige Anfrage." }); }

  // Honeypot: skriveno polje popune samo boti. Tiho odbaci (izgleda kao uspjeh, ne ide u Brevo).
  if (String(body.hp || "").trim() !== "") {
    return res.status(200).json({ ok: true });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Bitte gib eine gültige E-Mail-Adresse ein." });
  }
  if (tooMany(getIp(req))) {
    return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
  }

  // Opcioni atributi (za personalizovani email u Brevu). Kreiraj ih u Brevo:
  // Contacts -> Settings -> Contact attributes (Text): KALORIENZIEL, PROTEINZIEL, ZIEL, TYP
  const attributes = {};
  if (body.kcal) attributes.KALORIENZIEL = String(body.kcal).slice(0, 20);
  if (body.protein) attributes.PROTEINZIEL = String(body.protein).slice(0, 20);
  if (body.ziel) attributes.ZIEL = String(body.ziel).slice(0, 60);
  if (body.typ) attributes.TYP = String(body.typ).slice(0, 60);
  if (body.zielgewicht) attributes.ZIELGEWICHT = String(body.zielgewicht).slice(0, 20);
  if (body.zieldatum) attributes.ZIELDATUM = String(body.zieldatum).slice(0, 40);

  const base = { email: email, listIds: [BREVO_LIST_ID], updateEnabled: true };
  const withAttrs = Object.keys(attributes).length ? Object.assign({ attributes: attributes }, base) : base;

  try {
    let r = await brevoAddContact(apiKey, withAttrs);
    if (isSuccess(r) || isDuplicate(r)) return await okWithPlan(res, isDuplicate(r), apiKey, email);

    // Fallback: ako atributi ne postoje u Brevu, ponovo bez atributa da hvatanje nikad ne pukne
    if (withAttrs.attributes) {
      console.error("lead: retry ohne Attribute", r.status, r.data && (r.data.message || r.data.code));
      r = await brevoAddContact(apiKey, base);
      if (isSuccess(r) || isDuplicate(r)) return await okWithPlan(res, isDuplicate(r), apiKey, email);
    }

    console.error("lead: Brevo error", r.status, r.data && (r.data.message || r.data.code));
    return res.status(502).json({ error: "Anmeldung momentan nicht möglich. Bitte versuche es später erneut." });
  } catch (e) {
    console.error("lead: exception", e && e.message);
    return res.status(500).json({ error: "Anmeldung momentan nicht möglich. Bitte versuche es später erneut." });
  }
}
