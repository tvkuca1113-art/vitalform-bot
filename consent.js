/* ============================================================
   VITALFORM – Cookie-Consent + Meta-Pixel (DSGVO / TTDSG-konform)
   ------------------------------------------------------------
   • Der Meta-Pixel (Facebook/Instagram) lädt ERST nach aktiver
     Zustimmung ("Alle akzeptieren"). "Nur notwendige" -> kein Pixel.
   • Die Auswahl wird lokal gespeichert (kein Banner bei jedem Besuch).
   • Geteilt von index.html, coach.html, quiz.html (1 Datei = 1 Ort).

   >>> SO AKTIVIERST DU DEN META-PIXEL: <<<
   Trage unten bei FB_PIXEL_ID deine Pixel-ID aus dem Facebook
   Werbeanzeigenmanager ein (Events-Manager -> Datenquellen -> Pixel).
   Solange das Feld leer ist, funktioniert das Banner ganz normal,
   es wird nur noch kein Pixel geladen (also alles startklar).
   ============================================================ */
(function () {
  "use strict";

  // ▼▼▼ HIER deine Meta-Pixel-ID eintragen (z. B. "123456789012345") ▼▼▼
  var FB_PIXEL_ID = "";
  // ▲▲▲ leer lassen, bis du sie hast – Banner läuft trotzdem ▲▲▲

  var STORE_KEY = "vf_consent";           // "all" | "necessary"
  var pixelLoaded = false;

  /* ---------- kleine Helfer für localStorage (fällt still aus) ---------- */
  function getConsent() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function setConsent(v) {
    try { localStorage.setItem(STORE_KEY, v); } catch (e) {}
  }

  /* ---------- Meta-Pixel laden (nur nach Zustimmung) ---------- */
  function loadPixel() {
    if (pixelLoaded) return;
    if (!FB_PIXEL_ID) { pixelLoaded = true; return; } // keine ID -> nichts laden
    pixelLoaded = true;
    /* Offizieller Meta-Pixel-Basiscode */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0";
      n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", FB_PIXEL_ID);
    window.fbq("track", "PageView");
  }

  /* ---------- öffentlicher Tracking-Helfer (für Lead/Kauf etc.) ---------- */
  /* Feuert nur, wenn zugestimmt UND Pixel aktiv ist – sonst passiert nichts. */
  window.vfTrack = function (event, params) {
    if (getConsent() === "all" && window.fbq) {
      try { window.fbq("track", event, params || {}); } catch (e) {}
    }
  };

  /* ---------- Texte (DE/EN) ---------- */
  var T = {
    de: {
      title: "Wir respektieren deine Privatsphäre 🍃",
      body: "Wir nutzen notwendige Cookies für den Betrieb der Seite. Mit deiner Zustimmung setzen wir zusätzlich Marketing-Cookies (Meta-Pixel), um unsere Angebote zu verbessern und dir relevante Inhalte zu zeigen. Du kannst deine Wahl jederzeit ändern.",
      accept: "Alle akzeptieren",
      necessary: "Nur notwendige",
      more: "Datenschutz"
    },
    en: {
      title: "We respect your privacy 🍃",
      body: "We use necessary cookies to run this site. With your consent we also set marketing cookies (Meta Pixel) to improve our offers and show you relevant content. You can change your choice at any time.",
      accept: "Accept all",
      necessary: "Only necessary",
      more: "Privacy"
    }
  };
  function lang() { return (document.documentElement.lang === "en") ? "en" : "de"; }

  /* ---------- Styles einmalig injizieren ---------- */
  function injectStyles() {
    if (document.getElementById("vf-consent-style")) return;
    var css = ''
      + '#vf-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:520px;margin:0 auto;'
      + 'background:rgba(255,255,255,.98);backdrop-filter:blur(10px);border:1px solid #e7efe9;border-radius:20px;'
      + 'box-shadow:0 24px 60px rgba(12,60,35,.22);padding:22px 22px 18px;'
      + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
      + 'transform:translateY(140%);transition:transform .45s cubic-bezier(.2,.8,.2,1)}'
      + '#vf-consent.show{transform:translateY(0)}'
      + '#vf-consent h4{margin:0 0 8px;font-size:1.05rem;font-weight:800;color:#0c1512;letter-spacing:-.01em}'
      + '#vf-consent p{margin:0 0 16px;font-size:.9rem;line-height:1.55;color:#5c6b63}'
      + '#vf-consent p a{color:#0f7a37;font-weight:700;text-decoration:underline}'
      + '#vf-consent .vf-row{display:flex;gap:10px;flex-wrap:wrap}'
      + '#vf-consent button{flex:1;min-width:150px;border:none;cursor:pointer;padding:13px 18px;border-radius:50px;'
      + 'font-size:.94rem;font-weight:750;font-family:inherit;transition:.2s}'
      + '#vf-consent .vf-accept{background:linear-gradient(135deg,#16a34a,#0b8a4f);color:#fff;box-shadow:0 10px 24px rgba(22,163,74,.32)}'
      + '#vf-consent .vf-accept:hover{transform:translateY(-2px);box-shadow:0 16px 30px rgba(22,163,74,.42)}'
      + '#vf-consent .vf-necessary{background:#f4f9f5;color:#1c2b24;border:1px solid #e7efe9}'
      + '#vf-consent .vf-necessary:hover{background:#e9f3ec;border-color:#16a34a;color:#0f7a37}'
      + '@media(max-width:520px){#vf-consent{left:10px;right:10px;bottom:10px;padding:20px 18px 16px}'
      + '#vf-consent button{min-width:100%}}'
      + '@media(prefers-reduced-motion:reduce){#vf-consent{transition:none}}';
    var st = document.createElement("style");
    st.id = "vf-consent-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- Banner bauen / anzeigen ---------- */
  var bannerEl = null;
  function buildBanner() {
    injectStyles();
    var t = T[lang()];
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.id = "vf-consent";
      bannerEl.setAttribute("role", "dialog");
      bannerEl.setAttribute("aria-live", "polite");
      bannerEl.setAttribute("aria-label", t.title);
      document.body.appendChild(bannerEl);
    }
    var privacyHref = /coach\.html|quiz\.html/.test(location.pathname) ? "index.html#datenschutz" : "#datenschutz";
    bannerEl.innerHTML =
      '<h4>' + t.title + '</h4>' +
      '<p>' + t.body + ' <a href="' + privacyHref + '" id="vf-privacy">' + t.more + '</a></p>' +
      '<div class="vf-row">' +
        '<button class="vf-necessary" type="button">' + t.necessary + '</button>' +
        '<button class="vf-accept" type="button">' + t.accept + '</button>' +
      '</div>';

    bannerEl.querySelector(".vf-accept").addEventListener("click", function () {
      setConsent("all"); loadPixel(); hideBanner();
    });
    bannerEl.querySelector(".vf-necessary").addEventListener("click", function () {
      setConsent("necessary"); hideBanner();
    });
    // Datenschutz-Link: auf der Startseite die Legal-Seite öffnen
    var pv = bannerEl.querySelector("#vf-privacy");
    if (pv && typeof window.showPage === "function" && privacyHref === "#datenschutz") {
      pv.addEventListener("click", function (e) { e.preventDefault(); window.showPage("datenschutz"); });
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { bannerEl.classList.add("show"); });
    });
  }
  function hideBanner() {
    if (!bannerEl) return;
    bannerEl.classList.remove("show");
    setTimeout(function () { if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl); bannerEl = null; }, 500);
  }

  /* ---------- erneut öffnen (z. B. Footer-Link "Cookie-Einstellungen") ---------- */
  window.vfOpenConsent = function () { buildBanner(); };

  /* ---------- Sprache wechselt -> Banner-Text aktualisieren ---------- */
  var mo = new MutationObserver(function () {
    if (bannerEl) buildBanner();
  });
  try { mo.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] }); } catch (e) {}

  /* ---------- Start ---------- */
  function start() {
    var c = getConsent();
    if (c === "all") { loadPixel(); }
    else if (c === "necessary") { /* nichts laden */ }
    else { buildBanner(); }   // noch keine Wahl -> Banner zeigen
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
})();
