// Tab disguise: swaps the page title and favicon for something that looks
// like schoolwork. Adds a section to the customize panel on the hub.
//
// The chosen title and favicon are stored resolved in localStorage, so the
// tiny inline script in every page's <head> can apply them before first
// paint without loading this file. That matters: applying later means the
// real title flashes first, which rather defeats the point.
//
// Favicons are inlined as data: URIs rather than loaded from the real sites.
// A request to google.com/favicon.ico would show up in network logs and
// wouldn't work offline.
//
// Worth being clear about the limits: this changes what the tab says. It
// does nothing about network logs, a monitoring extension, or anyone
// actually looking at the screen.

(function () {
  "use strict";

  var KEY = "hub_cloak";

  function svg(body, w) {
    return "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (w || 48) + " " +
        (w || 48) + '">' + body + "</svg>",
    );
  }

  // Simple shapes in the right colours. At 16px in a tab strip the colour
  // and silhouette are all that register.
  var PRESETS = [
    {
      id: "docs", name: "Google Docs", dot: "#4285F4",
      title: "Untitled document - Google Docs",
      icon: svg('<rect x="9" y="3" width="30" height="42" rx="3" fill="#4285F4"/>' +
        '<path d="M15 14h18v3H15zm0 7h18v3H15zm0 7h12v3H15z" fill="#fff"/>'),
    },
    {
      id: "drive", name: "Google Drive", dot: "#34A853",
      title: "My Drive - Google Drive",
      icon: svg('<path d="M17 4h14l13 23H30z" fill="#4285F4"/>' +
        '<path d="M4 34 17 11l7 12-7 11z" fill="#34A853"/>' +
        '<path d="M8 40h32l4-7H12z" fill="#FBBC04"/>'),
    },
    {
      id: "gmail", name: "Gmail", dot: "#EA4335",
      title: "Inbox - Gmail",
      icon: svg('<rect x="4" y="10" width="40" height="28" rx="3" fill="#fff"/>' +
        '<path d="M4 13l20 15L44 13v5L24 33 4 18z" fill="#EA4335"/>' +
        '<path d="M4 13v25h6V17l14 11 14-11v21h6V13l-20 15z" fill="#EA4335"/>'),
    },
    {
      id: "classroom", name: "Google Classroom", dot: "#1E8E3E",
      title: "Classes",
      icon: svg('<rect x="4" y="9" width="40" height="30" rx="3" fill="#1E8E3E"/>' +
        '<circle cx="24" cy="21" r="4" fill="#fff"/>' +
        '<path d="M16 32c0-4 4-6 8-6s8 2 8 6z" fill="#fff"/>'),
    },
    {
      id: "slides", name: "Google Slides", dot: "#FBBC04",
      title: "Untitled presentation - Google Slides",
      icon: svg('<rect x="9" y="3" width="30" height="42" rx="3" fill="#FBBC04"/>' +
        '<rect x="15" y="16" width="18" height="13" rx="1" fill="#fff"/>'),
    },
    {
      id: "sheets", name: "Google Sheets", dot: "#0F9D58",
      title: "Untitled spreadsheet - Google Sheets",
      icon: svg('<rect x="9" y="3" width="30" height="42" rx="3" fill="#0F9D58"/>' +
        '<path d="M15 15h18v16H15z" fill="#fff"/>' +
        '<path d="M15 20h18v1.5H15zm0 5h18v1.5H15zm8-10h1.5v16H23z" fill="#0F9D58"/>'),
    },
    {
      id: "canvas", name: "Canvas", dot: "#E4060F",
      title: "Dashboard",
      icon: svg('<circle cx="24" cy="24" r="20" fill="#E4060F"/>' +
        '<circle cx="24" cy="24" r="6" fill="#fff"/>' +
        '<circle cx="24" cy="10" r="2.6" fill="#fff"/><circle cx="24" cy="38" r="2.6" fill="#fff"/>' +
        '<circle cx="10" cy="24" r="2.6" fill="#fff"/><circle cx="38" cy="24" r="2.6" fill="#fff"/>' +
        '<circle cx="14" cy="14" r="2.6" fill="#fff"/><circle cx="34" cy="34" r="2.6" fill="#fff"/>' +
        '<circle cx="34" cy="14" r="2.6" fill="#fff"/><circle cx="14" cy="34" r="2.6" fill="#fff"/>'),
    },
    {
      id: "studentvue", name: "StudentVUE", dot: "#1F6FB2",
      title: "StudentVUE",
      icon: svg('<rect x="4" y="4" width="40" height="40" rx="7" fill="#1F6FB2"/>' +
        '<path d="M13 30h5v9h-5zm8-8h5v17h-5zm8-9h5v26h-5z" fill="#fff"/>'),
    },
    {
      id: "powerschool", name: "PowerSchool", dot: "#0072CE",
      title: "PowerSchool SIS",
      icon: svg('<circle cx="24" cy="24" r="20" fill="#0072CE"/>' +
        '<path d="M18 13h9a8 8 0 0 1 0 16h-4v6h-5zm5 5v6h4a3 3 0 0 0 0-6z" fill="#fff"/>'),
    },
    {
      id: "schoology", name: "Schoology", dot: "#0677BA",
      title: "Home | Schoology",
      icon: svg('<rect x="4" y="4" width="40" height="40" rx="7" fill="#0677BA"/>' +
        '<path d="M30 17c-2-2-5-2.5-7-2.5-4 0-7 2-7 5.5 0 3 2.5 4.2 6 5.2 3 .9 4 1.4 4 2.6 0 1.3-1.3 2-3.3 2-2.3 0-4.4-.9-6-2.3l-2.7 4c2.2 2 5.3 3 8.6 3 4.6 0 7.9-2.2 7.9-6 0-3.4-2.6-4.8-6.3-5.8-2.8-.8-3.7-1.2-3.7-2.2 0-1 1-1.6 2.7-1.6 1.8 0 3.5.7 4.8 1.8z" fill="#fff"/>'),
    },
    {
      id: "clever", name: "Clever", dot: "#436CF4",
      title: "Clever | Portal",
      icon: svg('<rect x="4" y="4" width="40" height="40" rx="10" fill="#436CF4"/>' +
        '<path d="M32 19a9 9 0 1 0 0 10l4 3a14 14 0 1 1 0-16z" fill="#fff"/>'),
    },
    {
      id: "khan", name: "Khan Academy", dot: "#14BF96",
      title: "Khan Academy",
      icon: svg('<rect x="4" y="4" width="40" height="40" rx="8" fill="#14BF96"/>' +
        '<path d="M24 12l12 6-12 6-12-6zm0 14l12-6v9c0 4-5 7-12 7s-12-3-12-7v-9z" fill="#fff" transform="translate(0,2) scale(.86) translate(4,0)"/>'),
    },
    {
      id: "desmos", name: "Desmos", dot: "#6042A6",
      title: "Desmos | Graphing Calculator",
      icon: svg('<rect x="4" y="4" width="40" height="40" rx="7" fill="#6042A6"/>' +
        '<path d="M9 34c7 0 9-20 15-20s8 20 15 20" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/>'),
    },
    {
      id: "quizlet", name: "Quizlet", dot: "#4255FF",
      title: "Quizlet",
      icon: svg('<rect x="4" y="4" width="40" height="40" rx="8" fill="#4255FF"/>' +
        '<circle cx="23" cy="23" r="10" stroke="#fff" stroke-width="3.4" fill="none"/>' +
        '<path d="M29 30l7 7" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>'),
    },
    {
      id: "google", name: "Google", dot: "#4285F4",
      title: "Google",
      icon: svg('<path d="M24 20v8h11a11 11 0 0 1-11 8 12 12 0 0 1 0-24 11 11 0 0 1 7.6 3l5.7-5.7A20 20 0 1 0 44 24a18 18 0 0 0-.3-4z" fill="#4285F4"/>' +
        '<path d="M6.3 15.6l6.6 4.8A12 12 0 0 1 24 12a11 11 0 0 1 7.6 3l5.7-5.7A20 20 0 0 0 6.3 15.6z" fill="#EA4335"/>' +
        '<path d="M24 44a20 20 0 0 0 13.8-5.3l-6.4-5.2A12 12 0 0 1 12.9 27.6l-6.6 5A20 20 0 0 0 24 44z" fill="#34A853"/>'),
    },
    { id: "newtab", name: "New Tab", dot: "#8296ab", title: "New Tab", icon: "" },
  ];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }

  function write(value) {
    try {
      if (value) localStorage.setItem(KEY, JSON.stringify(value));
      else localStorage.removeItem(KEY);
    } catch (e) { /* storage blocked */ }
  }

  function apply() {
    var c = read();
    if (!c || !c.title) return;
    if (document.title !== c.title) document.title = c.title;
    var link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    var href = c.icon || "data:,";
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }

  var api = {
    presets: PRESETS,
    current: read,
    apply: apply,

    set: function (id) {
      if (!id) write(null);
      else {
        for (var i = 0; i < PRESETS.length; i++) {
          if (PRESETS[i].id === id) {
            write({ id: id, title: PRESETS[i].title, icon: PRESETS[i].icon });
            break;
          }
        }
      }
      if (!read()) location.reload(); // restores the real title and icon
      else apply();
      if (window.renderCZ) window.renderCZ();
    },

    // Rendered into the customize panel, reusing its existing classes.
    section: function () {
      var c = read();
      var active = c ? c.id : "";
      var h = '<div class="cz-sec"><div class="cz-lbl">tab disguise</div><div class="cz-row">';
      h += '<button class="cz-opt' + (active ? "" : " on") +
        '" onclick="window.__hubCloak.set(\'\')">off</button>';
      for (var i = 0; i < PRESETS.length; i++) {
        var p = PRESETS[i];
        h += '<button class="cz-opt' + (active === p.id ? " on" : "") +
          '" onclick="window.__hubCloak.set(\'' + p.id + '\')">' +
          '<span class="cz-sw"><span class="cz-dot" style="background:' + p.dot +
          '"></span></span>' + p.name + "</button>";
      }
      h += "</div><div class=\"cz-lbl\" style=\"margin-top:.7rem;font-size:.72rem\">" +
        "changes the tab title and icon everywhere, games included. doesn't hide " +
        "anything from network logs or someone looking at your screen.</div></div>";
      return h;
    },

    // Used by the landing page button so the about:blank tab it writes gets
    // the disguise too, instead of a hardcoded "ojjy's game hub".
    openBlank: function (token) {
      var c = read();
      var title = c && c.title ? c.title : "ojjy's game hub";
      var icon = c && c.icon ? c.icon : "";
      var w = window.open("about:blank", "_blank");
      if (!w) { window.location.href = "/hub"; return; }
      var head = "<title>" + title.replace(/</g, "&lt;") + "</title>" +
        (icon ? '<link rel="icon" href="' + icon + '">' : "") +
        "<style>*{margin:0;padding:0}html,body,iframe{width:100%;height:100%;border:none;overflow:hidden}</style>";
      w.document.write("<!DOCTYPE html><html><head>" + head + "</head><body><iframe src=\"" +
        window.location.origin + "/hub?token=" + token + "\" allowfullscreen></iframe></body></html>");
      w.document.close();
    },
  };

  window.__hubCloak = api;
  apply();
})();
