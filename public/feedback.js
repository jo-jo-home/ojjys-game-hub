// The suggestion form. All submissions go to KV through the authenticated API;
// errors leave the draft intact, and a retry carries the same request id.
(function () {
  "use strict";

  var form = document.getElementById("fb-form");
  if (!form) return;
  var nameField = document.getElementById("fb-name");
  var kind = document.getElementById("fb-kind");
  var game = document.getElementById("fb-game");
  var title = document.getElementById("fb-title");
  var details = document.getElementById("fb-details");
  var fields = document.getElementById("fb-fields");
  var button = document.getElementById("fb-submit");
  var message = document.getElementById("fb-message");
  var login = document.getElementById("fb-login");
  var requestId = null;
  var sending = false;

  function update() {
    var bug = kind.value === "bug", wanted = kind.value === "game";
    document.getElementById("fb-game-field").hidden = !bug;
    game.disabled = !bug;
    game.required = bug;
    document.getElementById("fb-title-label").textContent = bug
      ? "what's the problem?" : wanted ? "which game should we add?" : "your idea";
    title.placeholder = bug ? "e.g. stuck on the loading screen"
      : wanted ? "the name of the game" : "a short summary of your idea";
    document.getElementById("fb-details-label").textContent = bug
      ? "what happens when you try to play?" : "more details (optional)";
    details.required = bug;
    details.minLength = bug ? 10 : 0;
    details.placeholder = bug
      ? "what did you try? any error message? which browser/device, and were you playing online or offline?"
      : wanted ? "a link to the game, or why you'd like it added"
      : "how would it work? what would make the hub better?";
    button.textContent = bug ? "send report" : wanted ? "send game request" : "send suggestion";
    document.getElementById("fb-count").textContent = details.value.length + " / 2,000";
  }

  function notice(text, error) {
    message.textContent = text;
    message.classList.toggle("error", !!error);
    // the springy confirmation animation only plays for good news
    message.classList.toggle("ok", !error && !!text);
  }

  form.addEventListener("input", function () {
    nameField.setCustomValidity("");
    requestId = null;
    notice("");
    update();
  });
  kind.addEventListener("change", update);

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    nameField.setCustomValidity(nameField.value.trim() ? "" : "enter your name");
    if (sending || !form.reportValidity()) return;
    if (!navigator.onLine) {
      notice("you're offline — reconnect to send this. your text is still here.", true);
      return;
    }
    sending = true;
    fields.disabled = true;
    button.classList.add("sending");
    button.textContent = "sending…";
    login.hidden = true;
    notice("");
    var timeout, controller = new AbortController();
    try {
      if (!requestId) requestId = crypto.randomUUID();
      var token = document.body.getAttribute("data-token") || "";
      var url = "/api/feedback" + (/^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{10,}\.[a-f0-9]{64})$/.test(token) ? "?token=" + token : "");
      timeout = setTimeout(function () { controller.abort(); }, 15000);
      var res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameField.value,
          kind: kind.value, game: game.value, title: title.value,
          details: details.value, requestId: requestId,
        }),
        signal: controller.signal,
      });
      var data;
      try { data = await res.json(); } catch (e) { throw new Error("the inbox isn't available right now — try again shortly"); }
      if (!res.ok) {
        if (res.status === 401) login.hidden = false;
        throw new Error(data.error || "couldn't send this — please try again");
      }
      var previousKind = kind.value;
      var previousName = nameField.value.trim();
      form.reset();
      kind.value = previousKind;
      nameField.value = previousName;
      requestId = null;
      notice("sent! Jonas can review it in the admin inbox. thanks for helping improve the hub.");
    } catch (e) {
      notice(e.name === "AbortError"
        ? "that took too long — try sending again. a retry won't submit it twice."
        : e instanceof TypeError ? "couldn't connect — your text is still here. try again when you're online."
        : e.message || "couldn't send this — please try again", true);
    } finally {
      clearTimeout(timeout);
      sending = false;
      fields.disabled = false;
      button.classList.remove("sending");
      update();
    }
  });

  update();
})();
