// November 5, 2026, in US Eastern time. The celebration is an
// attribute override, never a saved theme, so normal preferences return after
// the day ends, even on a page that stayed open or was served offline.
(function () {
  "use strict";
  if (window.__hubBirthday) return;

  var DATE = "2026-11-05";
  // New York is on EST (UTC-5) by November 5, 2026: daylight saving time
  // ends November 1. Explicit instants make the switch identical worldwide.
  var start = Date.UTC(2026, 10, 5, 5);
  var end = Date.UTC(2026, 10, 6, 5);
  var de = document.documentElement;
  var band = null, notice = null, ready = false, active = null, phase = "";
  var NOTICE_KEY = "hub_birthday_notice_" + DATE;

  function isBirthday(now) { return now >= start && now < end; }

  function updateTheme(now) {
    var on = isBirthday(now);
    if (on === active) return;
    active = on;
    if (on) de.setAttribute("data-birthday", DATE);
    else de.removeAttribute("data-birthday");
    if (ready) {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", getComputedStyle(de).getPropertyValue("--bg").trim());
      // The canvas engine caches its colours. Refresh on the date transition,
      // keeping the person's chosen background and motion settings.
      if (window.__hubBG) {
        var background = "none";
        try { background = JSON.parse(localStorage.getItem("hub_theme") || "{}").bg || "none"; } catch (e) {}
        window.__hubBG(background);
      }
    }
  }

  function createBand() {
    var node = document.createElement("section");
    node.id = "birthday-band";
    node.className = "bd-band";
    node.setAttribute("aria-label", "Jonas' birthday countdown");
    var header = document.querySelector("header");
    if (header) header.appendChild(node);
    else {
      node.classList.add("bd-floating");
      document.body.appendChild(node);
    }
    return node;
  }

  function showNotice() {
    if (notice || document.hidden) return;
    try { if (localStorage.getItem(NOTICE_KEY)) return; } catch (e) {}
    notice = document.createElement("aside");
    notice.id = "birthday-notice";
    notice.className = "bd-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.innerHTML = '<span class="bd-icon" aria-hidden="true">🎉</span>' +
      '<div class="bd-notice-copy"><strong>It\'s Jonas\' birthday!</strong>' +
      '<p>Happy birthday, Jonas! The hub is celebrating in rainbow colours today.</p></div>' +
      '<button type="button" class="bd-close" aria-label="dismiss birthday notification">×</button>';
    notice.querySelector("button").addEventListener("click", function () { notice.remove(); });
    document.body.appendChild(notice);
    try { localStorage.setItem(NOTICE_KEY, "1"); } catch (e) { /* still works without storage */ }
  }

  function tick() {
    var now = Date.now();
    updateTheme(now);
    if (!ready) return;
    var next = now < start ? "countdown" : now < end ? "birthday" : "past";
    if (next !== "birthday" && notice) { notice.remove(); notice = null; }
    if (next === "past") {
      if (band) { band.remove(); band = null; }
      if (notice) { notice.remove(); notice = null; }
      phase = next;
      return;
    }
    if (!band) band = createBand();
    if (next !== phase) {
      phase = next;
      if (next === "birthday") {
        band.setAttribute("aria-label", "It's Jonas' birthday!");
        band.innerHTML = '<span class="bd-icon" aria-hidden="true">🎂</span>' +
          '<div class="bd-copy"><strong>It\'s Jonas\' birthday!</strong>' +
          '<span>November 5, 2026 · Eastern time · rainbow mode for today</span></div>';
      } else {
        band.setAttribute("aria-label", "Jonas' birthday countdown");
        band.innerHTML = '<div class="bd-copy"><strong>Countdown to Jonas\' birthday</strong>' +
          '<span>November 5, 2026 · Eastern time</span></div><div class="bd-clock" role="timer" aria-live="off">' +
          ['days', 'hours', 'minutes', 'seconds'].map(function (unit) {
            return '<span class="bd-unit"><b data-bd="' + unit + '">0</b><small>' + unit + '</small></span>';
          }).join('') + '</div>';
      }
    }
    if (next === "birthday") showNotice();
    if (next === "countdown") {
      var seconds = Math.max(0, Math.ceil((start - now) / 1000));
      var values = {
        days: Math.floor(seconds / 86400), hours: Math.floor(seconds / 3600) % 24,
        minutes: Math.floor(seconds / 60) % 60, seconds: seconds % 60,
      };
      Object.keys(values).forEach(function (unit) {
        var value = unit === "days" ? String(values[unit]) : String(values[unit]).padStart(2, "0");
        var node = band.querySelector('[data-bd="' + unit + '"]');
        if (node.textContent !== value) node.textContent = value;
      });
    }
  }

  window.__hubBirthday = { refresh: tick };
  updateTheme(Date.now()); // before paint, including on cached pages
  function boot() {
    ready = true;
    tick();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (active && meta) meta.setAttribute("content", getComputedStyle(de).getPropertyValue("--bg").trim());
    setInterval(function () { if (!document.hidden) tick(); }, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", tick);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
