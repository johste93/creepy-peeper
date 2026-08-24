// Runs in the page's MAIN world, where an isolated content script cannot reach.
// Two jobs, both reported to content.js over postMessage:
//
//   1. Resource timing — every URL the page fetches, including XHR, fetch and
//      sendBeacon traffic that never leaves a trace in the DOM. This is what
//      gives Creepy Peeper coverage of the whole tracker registry.
//   2. Known globals — a handful of high-traffic trackers announce themselves
//      on window before they make a single request, so probing for them puts
//      their camera on screen noticeably sooner.
//
// content.js owns the domain -> tracker lookup; this side just reports hosts.
(function () {
  "use strict";

  var POLL_MS = 400;
  var GIVE_UP_MS = 30000;   // consent-gated trackers can fire very late

  var deadline = Date.now() + GIVE_UP_MS;
  var timer = null;
  var observer = null;

  var seenVendor = {};      // registry id -> true
  var seenHost = {};        // hostname -> true
  var pendingVendors = [];
  var pendingHosts = [];

  // Each probe is wrapped: an exotic getter or a cross-origin guard on any one
  // global must not stop the others being checked.
  function has(fn) {
    try { return !!fn(); } catch (e) { return false; }
  }

  // Keys are company ids from src/registry.js — cameras are per company, so a
  // probe reports who is watching, not which of their products is doing it. An
  // id that ever stops existing upstream is harmless; content.js ignores ids it
  // cannot resolve.
  //
  // Deliberately absent: window.google_tag_manager. GTM on its own is a
  // container, and is routinely used to hold tracking back until consent is
  // given. window.gtag is different — that is Analytics or Ads actually live.
  var PROBES = {
    facebook: function () {
      return typeof window.fbq === "function" || window._fbq ||
             (window.fbq && (window.fbq.version || window.fbq.loaded));
    },
    google: function () {
      return typeof window.gtag === "function" || typeof window.ga === "function" ||
             window._gaq;
    },
    microsoft: function () {
      return window.uetq || window.UET || typeof window.clarity === "function" ||
             window.lintrk || window._linkedin_data_partner_ids;
    },
    adobe: function () { return window._satellite || window.s_gi || window.Munchkin; },
    hotjar: function () { return window._hjSettings || window.hj; },
    mixpanel: function () { return window.mixpanel; },
    twilio: function () { return window.analytics && window.analytics.Integrations; },
    bytedance_inc: function () { return window.ttq; },
    snap_technologies: function () { return window.snaptr; },
    twitter: function () { return window.twq; },
    matomo: function () { return window._paq || window.Matomo || window.Piwik; },
    posthog: function () { return window.posthog; },
    amplitude: function () { return window.amplitude; },
    content_square: function () { return window.heap; },
    fullstory: function () { return window.FS && window.FS.identify; },
    klaviyo: function () { return window._learnq || window.klaviyo; },
    new_relic: function () { return window.newrelic || window.NREUM; },
    quantcast: function () { return window._qevents; },
    yandex: function () { return window.ym || window.Ya; },
    crazy_egg: function () { return window.CE2 || window.CE_SNAPSHOT_NAME; },
    hubspot: function () { return window._hsq; },
    criteo: function () { return window.criteo_q; },
    taboola: function () { return window._taboola; },
    outbrain: function () { return window.obApi; },
    tealium: function () { return window.utag; },
    braze_inc: function () { return window.appboy || window.braze; }
  };

  function stop() {
    if (timer !== null) { clearInterval(timer); timer = null; }
    if (observer) {
      try { observer.disconnect(); } catch (e) { /* already gone */ }
      observer = null;
    }
  }

  // Ad and consent iframes load trackers of their own, and a cross-origin frame's
  // resource timing is invisible from the top document — so this script runs in
  // every frame and reports upward. Only the top frame draws anything.
  var TOP = (function () {
    try { return window.top || window; } catch (e) { return window; }
  })();

  function post(msg) {
    try {
      msg.__creepyPeeper = true;
      TOP.postMessage(msg, "*");
    } catch (e) {
      // A sandboxed frame may refuse; the top frame's own sweep still runs.
    }
  }

  // Say it more than once. A single message that lands before content.js has
  // registered its listener would be lost, and lost means no camera at all.
  // The full set is resent rather than the delta so a dropped message cannot
  // permanently hide a tracker; content.js latches per id and ignores repeats.
  var replayed = false;
  function announce() {
    if (!pendingVendors.length && !pendingHosts.length) return;
    post({ vendors: pendingVendors, hosts: pendingHosts });
    pendingVendors = [];
    pendingHosts = [];
    if (replayed) return;
    replayed = true;
    [150, 500, 1200].forEach(function (d) {
      setTimeout(function () { post({ vendors: keys(seenVendor), hosts: keys(seenHost) }); }, d);
    });
  }

  function keys(o) {
    var out = [];
    for (var k in o) if (o[k]) out.push(k);
    return out;
  }

  function noteHost(url) {
    var host;
    try {
      host = new URL(url, location.href).hostname;
    } catch (e) {
      return;
    }
    if (!host || seenHost[host]) return;
    seenHost[host] = true;
    pendingHosts.push(host);
  }

  function checkGlobals() {
    for (var id in PROBES) {
      if (!seenVendor[id] && has(PROBES[id])) {
        seenVendor[id] = true;
        pendingVendors.push(id);
      }
    }
  }

  function tick() {
    checkGlobals();
    announce();
    if (Date.now() > deadline) stop();
  }

  // buffered: true replays everything the page loaded before this observer was
  // created, which at document_start is usually nothing but costs us nothing
  // either — and covers the case where injection is delayed.
  try {
    observer = new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) noteHost(entries[i].name);
      announce();
    });
    observer.observe({ type: "resource", buffered: true });
  } catch (e) {
    observer = null;   // very old Chrome; the DOM sweep still carries detection
  }

  tick();
  timer = setInterval(tick, POLL_MS);
  document.addEventListener("DOMContentLoaded", tick, { once: true });
  window.addEventListener("load", tick, { once: true });
})();
