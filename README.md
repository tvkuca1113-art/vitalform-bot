# VITALFORM KI-Coach – gotov bot 🤖

Ovo je pravi, radni AI-chat coach koji priča preko Claude API-ja. Sadrži:

- `index.html` – brendirani VITALFORM chat (ono što klijent vidi)
- `api/chat.js` – server koji sigurno zove Claude (tvoj API ključ ostaje skriven na serveru)
- `vercel.json`, `package.json`, `.env.example` – konfiguracija

Bot je **spreman**. Preostaje samo da ga postaviš online i ubaciš svoj Claude API ključ. Ispod je uputstvo korak po korak. Ne treba ti programiranje.

---

## Šta ti treba (2 naloga, oba besplatna za start)

1. **Anthropic nalog** (za Claude API ključ) → https://platform.claude.com
2. **Vercel nalog** (besplatni hosting za bot) → https://vercel.com
3. **GitHub nalog** (Vercel povlači kod odavde) → https://github.com

---

## Korak 1 – Uzmi Claude API ključ

1. Otvori https://platform.claude.com i registruj se.
2. Dodaj način plaćanja i mali kredit (npr. 5–10 $) – API se plaća po korištenju, vrlo jeftino.
3. Idi na **API Keys** → **Create Key** → kopiraj ključ (počinje sa `sk-ant-...`).
4. Sačuvaj ga privremeno na sigurno – trebat će ti u Koraku 3.

## Korak 2 – Stavi kod na GitHub

1. Otvori https://github.com i registruj se.
2. Klikni **New repository** → daj ime npr. `vitalform-bot` → **Create**.
3. Na stranici repozitorija klikni **uploading an existing file** i prevuci SVE datoteke iz ovog foldera (uključujući folder `api`).  
   *(Datoteku `.env.example` možeš uploadati; NIKAD ne uploaduj `.env` sa pravim ključem.)*
4. Klikni **Commit changes**.

## Korak 3 – Poveži na Vercel i unesi ključ

1. Otvori https://vercel.com → **Sign up** → prijavi se preko GitHub-a.
2. **Add New… → Project** → izaberi svoj `vitalform-bot` repozitorij → **Import**.
3. Prije nego klikneš Deploy, otvori **Environment Variables** i dodaj:
   - Ime: `ANTHROPIC_API_KEY` → Vrijednost: tvoj ključ `sk-ant-...`
   - (opcionalno) Ime: `CLAUDE_MODEL` → Vrijednost: `claude-sonnet-4-5`
4. Klikni **Deploy** i sačekaj ~1 minut.
5. Dobiješ link tipa `https://vitalform-bot.vercel.app` – **to je tvoj živi bot!** 🎉

## Korak 4 – Testiraj

Otvori link, napiši coachu poruku (npr. „Želim smršati 8 kg"). Ako odgovori – radi savršeno. Ako javi grešku o ključu, provjeri da si tačno unio `ANTHROPIC_API_KEY` u Vercel i ponovo deployuj.

---

## Kako povezati s glavnom stranicom

Kad je bot živ, na VITALFORM stranici (dugmad „Coach testen" / „Jetzt starten") samo stavi link na tvoj Vercel bot. Kasnije, kad postaviš Stripe, dostup botu daješ tek nakon uplate (o tome u tehničkom planu).

## Trošak

- Hosting (Vercel): 0 € za start.
- Claude API: plaćaš po korištenju. Sa Sonnet modelom, jedan aktivan klijent ≈ 1–3 € mjesečno. Ti naplaćuješ 29 €/mj.
- Možeš u Anthropic konzoli postaviti mjesečni limit potrošnje da budeš siguran/na.

## Sigurnosne napomene

- Tvoj API ključ je SAMO na Vercel serveru – klijenti ga nikad ne vide. To je ispravno i sigurno.
- Ako ključ ikad procuri, u Anthropic konzoli ga odmah obriši i napravi novi.
- Prije pravog live-a: dodaj u Datenschutz da se koristi Claude (Anthropic) i sklopi njihov DPA/AVV ugovor.

---

Ako negdje zapneš, javi mi tačno na kojem koraku i šta piše na ekranu – vodim te dalje.
