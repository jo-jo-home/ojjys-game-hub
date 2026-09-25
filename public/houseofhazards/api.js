// Replaces Poki's 131 KB advertising SDK.
//
// The original phoned pvc.poki.io on load and gated the game behind ad calls,
// which is both a privacy problem and a reason the game would stall on a
// school network that blocks it. The game only ever calls the seven methods
// below, so this stub answers all of them locally: loading reports itself as
// finished, and every ad break resolves immediately instead of never.
window.PokiSDK = {
  init: function () { return Promise.resolve(); },
  setDebug: function () {},
  gameLoadingStart: function () {},
  gameLoadingProgress: function () {},
  gameLoadingFinished: function () {},
  // Resolving rather than rejecting: the game waits on these before handing
  // control back, so a rejection would leave it stuck mid-round.
  commercialBreak: function () { return Promise.resolve(); },
  rewardedBreak: function () { return Promise.resolve(false); },
  gameplayStart: function () {},
  gameplayStop: function () {},
  happyTime: function () {},
  captureError: function () {},
  shareableURL: function () { return Promise.resolve(""); },
  getURLParam: function () { return ""; },
};
