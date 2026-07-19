// VITALFORM – Lead-Capture (Brevo)
// Dodaje email u Brevo listu. API kljuc ostaje na serveru (BREVO_API_KEY u Vercelu).
// Lista se moze mijenjati preko BREVO_LIST_ID (default: 3).

const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID || "3", 10);

// jednostavna zastita od spama (po IP-u)
const memHits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = memHits.get(ip);
  if (!rec || now > rec.exp) { memHits.set(ip, { c: 1, exp: now + 60000 }); return false; }
  rec.c++;
  return rec.c > 12; // max 12 prijava/min po IP
}
function getIp(req) {
  const x = req.headers["x-forwarded-for"];
  if (x) return String(x).split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server nicht konfiguriert: BREVO_API_KEY fehlt." });
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

  try {
    const r = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        email: email,
        listIds: [BREVO_LIST_ID],
        updateEnabled: true
      })
    });

    // 201 = neu erstellt, 204 = aktualisiert -> beides Erfolg
    if (r.status === 201 || r.status === 204) {
      return res.status(200).json({ ok: true });
    }
    const data = await r.json().catch(() => ({}));
    // Kontakt existiert bereits -> als Erfolg behandeln
    if (data && (data.code === "duplicate_parameter" || (data.message && /exist/i.test(data.message)))) {
      return res.status(200).json({ ok: true, existed: true });
    }
    return res.status(502).json({ error: (data && data.message) ? data.message : "Anmeldung fehlgeschlagen." });
  } catch (e) {
    return res.status(500).json({ error: "Serverfehler. Bitte später erneut versuchen." });
  }
}
