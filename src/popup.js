// Popup: the two switches, and a list of who this page is talking to.
//
// It asks the content script what it found; nothing here reaches the network,
// and the list is discarded the moment the popup closes.
(function () {
  "use strict";

  var REPO = "https://github.com/johste93/creepy-peeper";
  var DEFAULTS = {
    off: false,
    disabledSites: [],
    showAds: true,
    showAnalytics: true
  };

  var $ = function (id) { return document.getElementById(id); };
  var siteToggle = $("siteToggle");
  var globalToggle = $("globalToggle");
  var adsToggle = $("adsToggle");
  var analyticsToggle = $("analyticsToggle");
  var list = $("list");

  var found = [];      // what the content script reported, unfiltered
  var reported = false;   // whether it has answered yet

  $("repo").href = REPO;

  var site = null;

  function hostOf(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.hostname.replace(/^www\./, "");
    } catch (e) {
      return null;
    }
  }

  function empty(text) {
    list.innerHTML = "";
    var p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    list.appendChild(p);
  }

  function isAd(c) { return c.category === "advertising"; }

  function shown(c, settings) {
    return isAd(c) ? settings.showAds : settings.showAnalytics;
  }

  // The list always names everyone found. Companies whose category is switched
  // off are dimmed and hollowed out rather than removed, so hiding a category
  // never reads as "nothing is tracking you here".
  function render(settings) {
    var ads = found.filter(isAd).length;
    $("adsCount").textContent = ads || "";
    $("analyticsCount").textContent = (found.length - ads) || "";

    // Settings arrive before the content script answers, so paint() runs first
    // with nothing to show. Say nothing rather than "no companies detected",
    // which would be a wrong answer for the moment it was on screen.
    if (!reported) return;

    list.innerHTML = "";
    if (!found.length) {
      empty("No advertising or analytics companies detected here.");
      return;
    }

    var visible = found.filter(function (c) { return shown(c, settings); }).length;
    var head = document.createElement("p");
    head.className = "count";
    head.textContent = visible === found.length
      ? (found.length === 1 ? "1 company watching" : found.length + " companies watching")
      : visible + " of " + found.length + " shown";
    list.appendChild(head);

    found.forEach(function (c) {
      var on = shown(c, settings);
      var row = document.createElement("div");
      row.className = on ? "co" : "co hidden";
      var dot = document.createElement("i");
      dot.className = "dot";
      dot.style.color = c.band;
      if (on) dot.style.background = c.band;
      var name = document.createElement("span");
      name.textContent = c.name;
      var kind = document.createElement("em");
      kind.textContent = isAd(c) ? "ads" : "analytics";
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(kind);
      list.appendChild(row);
    });
  }

  function paint(settings) {
    var off = settings.off;
    globalToggle.checked = off;
    siteToggle.checked = !off && site !== null &&
                         settings.disabledSites.indexOf(site) === -1;
    siteToggle.disabled = off || site === null;
    adsToggle.checked = settings.showAds;
    analyticsToggle.checked = settings.showAnalytics;
    adsToggle.disabled = analyticsToggle.disabled = off;
    document.body.classList.toggle("off", off);
    render(settings);
  }

  function save(patch) {
    chrome.storage.local.get(DEFAULTS, function (settings) {
      var next = {
        off: "off" in patch ? patch.off : settings.off,
        disabledSites: settings.disabledSites.slice(),
        showAds: "showAds" in patch ? patch.showAds : settings.showAds,
        showAnalytics:
          "showAnalytics" in patch ? patch.showAnalytics : settings.showAnalytics
      };
      if ("site" in patch && site) {
        var at = next.disabledSites.indexOf(site);
        if (patch.site && at !== -1) next.disabledSites.splice(at, 1);
        if (!patch.site && at === -1) next.disabledSites.push(site);
      }
      chrome.storage.local.set(next, function () { paint(next); });
    });
  }

  siteToggle.addEventListener("change", function () {
    save({ site: siteToggle.checked });
  });
  globalToggle.addEventListener("change", function () {
    save({ off: globalToggle.checked });
  });
  adsToggle.addEventListener("change", function () {
    save({ showAds: adsToggle.checked });
  });
  analyticsToggle.addEventListener("change", function () {
    save({ showAnalytics: analyticsToggle.checked });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    site = tab ? hostOf(tab.url) : null;
    $("site").textContent = site || "Not a web page";
    $("siteName").textContent = site || "this site";

    chrome.storage.local.get(DEFAULTS, paint);

    if (!tab || site === null) {
      empty("Creepy Peeper only runs on web pages.");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "creepy-peeper:state" }, function (res) {
      // No receiver means the content script never ran here — a page the
      // browser keeps extensions off, or one loaded before install.
      if (chrome.runtime.lastError || !res) {
        reported = true;
        empty("Nothing to report on this page yet. Try reloading it.");
        return;
      }
      reported = true;
      found = res.companies || [];
      chrome.storage.local.get(DEFAULTS, render);
    });
  });
})();
