// TikTok Pixel, loaded only after the visitor agrees (UK PECR/GDPR: ad-tracking needs consent first).
// Included in the <head> of every page on playtinted.com.
(function () {
  var KEY = "tinted:ads-consent";
  var get = function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  var set = function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} };

  function loadPixel() {
    if (window.ttq && window.ttq._i) return;
    /* TikTok Pixel Code Start */
    !function (w, d, t) {
      w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
      var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
      ;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};

      ttq.load('DBLJ1L3C77UCRTSK0V70');
      ttq.page();
    }(window, document, 'ttq');
    /* TikTok Pixel Code End */
  }

  // Events the app can send (no-ops until the visitor has agreed).
  window.tintedTrack = function (name) { if (get() === "yes" && window.ttq) window.ttq.track(name); };
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="/app"]');
    if (a) window.tintedTrack("ClickButton");
  });

  if (get() === "yes") { loadPixel(); return; }
  if (get() === "no") return;

  function banner() {
    var b = document.createElement("div");
    b.setAttribute("role", "dialog"); b.setAttribute("aria-label", "Cookies");
    b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:520px;margin:0 auto;padding:14px 16px;border-radius:18px;" +
      "background:rgba(34,18,58,.96);color:#fff2f8;box-shadow:0 12px 40px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.1);" +
      "font:500 14px/1.45 Geist,system-ui,-apple-system,'Segoe UI',sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:center";
    b.innerHTML = '<span style="flex:1 1 220px">We\'d like to use a TikTok cookie to see which of our ads bring people here. ' +
      '<a href="/privacy.html" style="color:#ffb3d6">Privacy</a></span>' +
      '<span style="display:flex;gap:8px;margin-left:auto">' +
      '<button data-c="no" style="border:0;border-radius:999px;padding:9px 14px;font-weight:600;font-size:14px;font-family:inherit;background:rgba(255,255,255,.08);color:#fff2f8;cursor:pointer">No thanks</button>' +
      '<button data-c="yes" style="border:0;border-radius:999px;padding:9px 16px;font-weight:700;font-size:14px;font-family:inherit;background:#ff4fa3;color:#fff;cursor:pointer">OK</button></span>';
    b.addEventListener("click", function (e) {
      var c = e.target.getAttribute && e.target.getAttribute("data-c"); if (!c) return;
      set(c); b.remove(); if (c === "yes") loadPixel();
    });
    document.body.appendChild(b);
  }
  if (document.body) banner(); else document.addEventListener("DOMContentLoaded", banner);
})();
