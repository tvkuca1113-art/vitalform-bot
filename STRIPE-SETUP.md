# VITALFORM — Stripe postavljanje (kupovina → automatski kod s rokom)

Ovaj vodič povezuje Stripe tako da **čim kupac plati, automatski dobije lični kod na email**, aktivira KI-Coach, i **pristup mu automatski istekne** nakon plaćene dužine (npr. 1 mjesec).

Kako sve radi (ukratko):

```
Kupac klikne "Jetzt kaufen"
   → Stripe naplati (Apple Pay / kartica / PayPal)
   → Stripe pozove tvoj webhook  /api/stripe-webhook
   → server provjeri POTPIS (niko ne može lažirati "plaćeno")
   → generiše jedinstven kod  VF-XXXXX-XXXXX  s rokom (npr. 31 dan)
   → snimi ga u Redis + pošalje kupcu email s kodom
   → kupac unese kod u botu → aktivno "bis DD.MM.YYYY" → automatski istekne
```

---

## Korak 1 — Napravi 3 proizvoda u Stripeu

Stripe Dashboard → **Product catalog** → **Add product**. Napravi tačno ova tri (cijene se moraju poklapati sa stranicom):

| Proizvod | Cijena | Tip | Šta kupac dobije |
|---|---|---|---|
| Ernährungsplan | **39 €** | jednokratno (one-time) | samo materijali (bez bota) |
| 12-Wochen-Programm | **97 €** | jednokratno (one-time) | **31 dan** KI-Coach + materijali |
| VITALFORM KI-Coach | **19,90 € / mjesec** | pretplata (recurring) | KI-Coach dok traje pretplata |

> Ako želiš druge cijene, upiši iznose (u centima) u Vercel varijable `STRIPE_AMOUNT_PLAN`, `STRIPE_AMOUNT_PROGRAMM`, `STRIPE_AMOUNT_COACH`.

## Korak 2 — Napravi 3 Payment Link-a

Za svaki proizvod: **Payment Links** → **New** → izaberi proizvod → **Create link**. Dobiješ URL tipa `https://buy.stripe.com/xxxxx`.

## Korak 3 — Zalijepi linkove u stranicu

U `index.html` (pri dnu, sekcija `ZAHLUNGSLINKS`) upiši svoja 3 linka:

```js
const PAYMENT_LINKS = {
  plan:     "https://buy.stripe.com/tvoj_link_39",   // 39€
  programm: "https://buy.stripe.com/tvoj_link_97",   // 97€
  coach:    "https://buy.stripe.com/tvoj_link_19"    // 19,90€/mj
};
```

> Ne moraš ništa dodavati na kraj linka — stranica sama dopisuje `client_reference_id` da webhook zna koji je plan.

## Korak 4 — Postavi webhook

Stripe → **Developers** → **Webhooks** → **Add endpoint**.

- **Endpoint URL:** `https://vitalform.fit/api/stripe-webhook`
- **Events to send** (izaberi ova 4):
  - `checkout.session.completed`
  - `invoice.paid`
  - `customer.subscription.deleted`
  - `customer.subscription.updated` *(opciono)*
- Klikni **Add endpoint**, pa na endpointu klikni **Reveal** kod **Signing secret** — dobiješ `whsec_...`.

## Korak 5 — Upiši tajne u Vercel

Vercel → tvoj projekt → **Settings** → **Environment Variables**:

| Varijabla | Vrijednost |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (iz koraka 4) |
| `BREVO_API_KEY` | tvoj Brevo API ključ (za slanje maila s kodom) |
| `MAIL_FROM` | `info@vitalform.fit` (mora biti **verifikovan** u Brevo → Senders) |
| `SITE_URL` | `https://vitalform.fit` |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | već imaš (obavezno za trajne kodove) |

Nakon spremanja → Vercel **Redeploy**.

## Korak 6 — Verifikuj posiljaoca u Brevo

Brevo → **Settings** → **Senders, Domains & Dedicated IPs** → dodaj/verifikuj `info@vitalform.fit`. Bez toga email s kodom neće otići.

---

## Testiranje BEZ pravog plaćanja

Imaš dva načina:

**A) Vlasnički alat (najbrže):** u botu se prijaviš svojim `OWNER_ACCESS_CODE`, pa u konzoli (F12) pokreneš:

```js
// Izdaj testni kod na 1 dan
fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({action:'issue', accessCode:'TVOJ_OWNER_KOD', plan:'programm', days:1})
}).then(r=>r.json()).then(console.log)
// -> {ok:true, code:"VF-XXXXX-XXXXX", expiresAt:...}
```

Kopiraš dobiveni `code`, izađeš iz owner logina, otvoriš "Zugangscode eingeben", uneseš kod → vidiš **"aktiv bis ..."**. Sutra (nakon isteka) isti kod pokaže **"Zugang abgelaufen"**. Time si dokazao cijeli tok.

**B) Stripe Test mode:** upali **Test mode** u Stripeu, koristi test karticu `4242 4242 4242 4242` (bilo koji budući datum + CVC). Webhook radi isto, samo bez pravog novca.

Da poništiš kod prije isteka:
```js
fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({action:'revoke', accessCode:'TVOJ_OWNER_KOD', code:'VF-XXXXX-XXXXX'})}).then(r=>r.json()).then(console.log)
```

---

## Trajanje / rok — kako se računa

- **12-Wochen-Programm (97€):** `botDays = 31` → kod vrijedi 31 dan od kupovine.
- **KI-Coach (19,90€/mj):** `botDays = 33` (mjesec + par dana zaštite). Svakom **uspješnom mjesečnom naplatom** (`invoice.paid`) rok se produži za još mjesec. Kad kupac **otkaže** (`customer.subscription.deleted`), pristup traje do kraja plaćenog perioda pa se ugasi.
- **Ernährungsplan (39€):** nema bot-kod (čisto digitalna roba); kupac dobije email s materijalima.

Brojeve dana možeš promijeniti u `api/stripe-webhook.js` (objekat `PLANS`).
