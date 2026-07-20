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
    if (isSuccess(r) || isDuplicate(r)) return res.status(200).json({ ok: true, existed: isDuplicate(r) });

    // Fallback: ako atributi ne postoje u Brevu, ponovo bez atributa da hvatanje nikad ne pukne
    if (withAttrs.attributes) {
      console.error("lead: retry ohne Attribute", r.status, r.data && (r.data.message || r.data.code));
      r = await brevoAddContact(apiKey, base);
      if (isSuccess(r) || isDuplicate(r)) return res.status(200).json({ ok: true, existed: isDuplicate(r) });
    }

    console.error("lead: Brevo error", r.status, r.data && (r.data.message || r.data.code));
    return res.status(502).json({ error: "Anmeldung momentan nicht möglich. Bitte versuche es später erneut." });
  } catch (e) {
    console.error("lead: exception", e && e.message);
    return res.status(500).json({ error: "Anmeldung momentan nicht möglich. Bitte versuche es später erneut." });
  }
}
