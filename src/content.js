// Creepy Peeper — isolated-world content script.
// Detects every advertising and site-analytics tracker in src/registry.js, then
// mounts one click-through surveillance camera per tracker, stacked down the
// right-hand edge, each swivelling to follow the mouse pointer.
(function () {
  "use strict";

  if (window.__creepyPeeperLoaded) return;
  window.__creepyPeeperLoaded = true;

  // Only the top document draws. detect-main.js runs in every frame and reports
  // up to here, so a tracker loaded inside an ad iframe still counts, but one
  // page gets one stack of cameras rather than one per frame.
  try {
    if (window.top !== window) return;
  } catch (e) {
    return;   // cross-origin parent we cannot see past; not our frame to draw in
  }

  var WATCH_MS = 30000;   // how long to keep looking for late-loading trackers
  var RESCAN_MS = 60;     // debounce for mutation-triggered rescans

  // ----------------------------------------------------------- brand identity
  //
  // Per camera: the band colour drives the shell and the rear cap (via
  // --cp-band), and the mark rides the band as a decal. Multi-colour marks get
  // a white plate so every brand colour reads against the band.
  //
  // Curated brands come from src/brands.js. Anything not curated yet falls back
  // to a monogram on a colour hashed from its id — every tracker in the
  // registry gets a recognisable camera either way.

  var REG = window.__cpRegistry || { D: {}, T: {} };
  var BRANDS = window.__cpBrands || {};

  var MONO_FONT =
    "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

  // Words that describe what the tracker does rather than who makes it. They
  // drown out the part of the name worth abbreviating: "Yahoo! Japan
  // Retargeting" should read YJ, not YR.
  var FILLER = /^(analytics?|advertising|ads?|adserver|tag|manager|sync|beacon|stats?|pixel|tracking|retargeting|marketing|platform|cloud|audience|insights?|conversion|tracker|metrics|inc|llc|ltd|gmbh|sa|sas|bv|co|com|the|and|for|of|with|signals)$/i;

  function initials(name) {
    var words = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
    var kept = words.filter(function (w) { return !FILLER.test(w); });
    if (!kept.length) kept = words;
    if (!kept.length) return "??";
    if (kept.length > 1) return (kept[0][0] + kept[1][0]).toUpperCase();
    // One word: an internal capital marks the second syllable a reader would
    // pick out ("PubMatic" -> PM), otherwise just take the first two letters.
    // A genuinely one-character name ("X") stays one character — doubling it
    // into "XX" reads as an abbreviation of something it is not.
    var solo = kept[0];
    if (solo.length === 1) return solo.toUpperCase();
    var hump = solo.slice(1).match(/[A-Z0-9]/);
    return (solo[0] + (hump ? hump[0] : solo[1])).toUpperCase();
  }

  // FNV-1a, so a given tracker always lands on the same hue across sessions and
  // machines. Saturation and lightness are fixed to keep white text legible.
  function hueFor(id) {
    var h = 2166136261;
    for (var i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h % 360;
  }

  function monogramBrand(id, name) {
    var letters = initials(name).replace(/[^A-Za-z0-9]/g, "") || "??";
    var colour = "hsl(" + hueFor(id) + ",64%,44%)";
    return {
      band: colour,
      palette: [colour],
      // Letters are filtered to alphanumerics above, so this cannot inject markup.
      mark:
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
        '<text x="12" y="12.5" fill="#fff" font-family="' + MONO_FONT + '" ' +
        'font-size="' + (letters.length > 1 ? 13 : 17) + '" font-weight="700" ' +
        'letter-spacing="-0.5" text-anchor="middle" dominant-baseline="central">' +
        letters + "</text></svg>",
      decalW: 22,
      decalH: 18,
      plate: ""
    };
  }

  // The band occupies the rear 44% of the barrel and a 90deg gradient runs from
  // the rear forward, so the palette is painted in reverse. That puts its first
  // colour nearest the lens, and the band reads in palette order from the lens
  // back toward the mount — the direction you actually read the camera.
  var BAND_END = 44;

  function bandStops(palette) {
    var span = BAND_END / palette.length;
    var out = [];
    for (var i = palette.length - 1, at = 0; i >= 0; i--, at += span) {
      out.push(palette[i] + " " + at.toFixed(2) + "% " + (at + span).toFixed(2) + "%");
    }
    return out.join(",");
  }

  var trackerCache = {};

  function trackerById(id) {
    if (trackerCache[id]) return trackerCache[id];
    var meta = REG.T[id];
    if (!meta) return null;               // id we no longer ship; ignore it
    var b = BRANDS[id] || monogramBrand(id, meta.n);
    var t = {
      id: id,
      name: meta.n,
      category: meta.c === "a" ? "advertising" : "site_analytics",
      band: b.band,
      palette: b.palette,
      mark: b.mark,
      decalW: b.decalW,
      decalH: b.decalH,
      plate: b.plate || "",
      stops: bandStops(b.palette)
    };
    trackerCache[id] = t;
    return t;
  }

  // ---------------------------------------------------------------- detection
  //
  // Everything funnels through hostnames. src/registry.js maps 991 tracker
  // domains to 498 tracker ids; three independent sources feed hostnames in:
  //
  //   1. this file's DOM sweep, for markup the page ships,
  //   2. detect-main.js's PerformanceObserver, for fetch/XHR/beacon traffic
  //      that never touches the DOM,
  //   3. detect-main.js's globals table, which beats both to the punch for the
  //      trackers that announce themselves on window.
  //
  // Deliberately no scan of inline <script> text. Any tracker that actually
  // runs makes a request, and matching source text only adds false positives on
  // pages that quote a snippet.

  function idForHost(host) {
    if (!host) return null;
    // Walk up the labels so deep subdomains resolve: a.b.criteo.net -> criteo.
    // Four hops covers every domain in the registry with room to spare.
    for (var i = 0; i < 5; i++) {
      var hit = REG.D[host];
      if (hit) return hit;
      var dot = host.indexOf(".");
      if (dot < 0) return null;
      host = host.slice(dot + 1);
    }
    return null;
  }

  // Browsing facebook.com should not raise a Meta camera for the site's own
  // assets — a tracker is only a tracker when it is watching from somewhere
  // else. Compare registrable-ish suffixes: the last two labels are enough
  // here, since a false match only ever suppresses a first-party camera.
  function suffix2(host) {
    var parts = String(host).split(".");
    return parts.slice(-2).join(".");
  }
  var SELF = suffix2(location.hostname);

  var scanned = new WeakSet();   // nodes whose URL we have already resolved
  var found = {};                // id -> true, latching

  var URL_ATTRS = ["src", "href", "data-src"];
  var URL_SEL =
    "script[src],img[src],iframe[src],link[href],embed[src]," +
    "video[src],audio[src],source[src],img[data-src],iframe[data-src]";

  // rel="dns-prefetch" and rel="preconnect" are hints, not loads: the browser
  // may warm a connection and nothing more. WordPress ships a preconnect to
  // wordpress.com on pages that never talk to it, and treating that as evidence
  // accuses a site of tracking it is not doing. rel="preload"/"prefetch" do
  // fetch, so those still count.
  var HINT_REL = /\b(dns-prefetch|preconnect)\b/i;
  var URL_IN_TEXT = /https?:\/\/([^\/"'\s<>)]+)/g;

  function noteUrl(url, hits) {
    var host;
    try {
      host = new URL(url, location.href).hostname;
    } catch (e) {
      return;
    }
    if (!host || suffix2(host) === SELF) return;
    var id = idForHost(host);
    if (id && !found[id]) hits.push(id);
  }

  function sweepDom() {
    var hits = [];
    try {
      var nodes = document.querySelectorAll(URL_SEL);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (scanned.has(n)) continue;
        scanned.add(n);
        var rel = n.getAttribute && n.getAttribute("rel");
        if (rel && HINT_REL.test(rel)) continue;
        for (var a = 0; a < URL_ATTRS.length; a++) {
          var v = n.getAttribute(URL_ATTRS[a]);
          if (v) noteUrl(v, hits);
        }
      }
      // <noscript> is where a lot of pixels ship, and its contents are inert
      // text rather than real nodes, so they need reading rather than querying.
      var nos = document.getElementsByTagName("noscript");
      for (var j = 0; j < nos.length; j++) {
        var ns = nos[j];
        if (scanned.has(ns)) continue;
        var raw = ns.textContent;
        if (!raw) continue;   // parser hasn't filled it in yet; retry next pass
        scanned.add(ns);
        var m;
        URL_IN_TEXT.lastIndex = 0;
        while ((m = URL_IN_TEXT.exec(raw)) !== null) noteUrl(m[0], hits);
      }
    } catch (e) {
      // Detection is best-effort; never break the host page.
    }
    return hits;
  }

  var observer = null;
  var rescanTimer = null;
  var stopTimer = null;

  function stopWatching() {
    if (observer) { observer.disconnect(); observer = null; }
    if (rescanTimer !== null) { clearTimeout(rescanTimer); rescanTimer = null; }
    if (stopTimer !== null) { clearTimeout(stopTimer); stopTimer = null; }
  }

  var order = [];        // detection order, so the stack can be rebuilt as-is

  function onDetected(id) {
    if (found[id]) return;              // latching: once shown, the camera stays
    var tracker = trackerById(id);
    if (!tracker) return;
    found[id] = true;
    order.push(tracker);
    // Detection keeps running while the extension is switched off, or while a
    // category is hidden, so the popup can still say who is watching. Only the
    // cameras are withheld.
    if (!shows(tracker)) return;
    // Slot is assigned in detection order, so the stack never has a gap and
    // already-mounted cameras never shuffle when a late one shows up.
    mount(tracker, cameras.length);
  }

  function scan() {
    var hits = sweepDom();
    for (var i = 0; i < hits.length; i++) onDetected(hits[i]);
  }

  function scheduleScan() {
    if (rescanTimer !== null) return;
    rescanTimer = setTimeout(function () {
      rescanTimer = null;
      scan();
    }, RESCAN_MS);
  }

  // ------------------------------------------------------------------ overlay
  //
  // The camera is real CSS 3D, not a drawing of a 3D camera. The page is the
  // "wall" (the z = 0 plane), the rig's origin is the swivel joint, and the
  // barrel is a tube of flat faces wrapped around the local +X axis.
  //
  // Aiming splits into two rotations:
  //   yaw  (rotateZ) — the cursor lives on the screen plane, so this is the
  //                    same atan2 the 2D version used.
  //   lean (rotateY) — tilts the barrel out of the page toward an assumed
  //                    viewer eye at z = VIEW_Z. Far cursor: nearly side-on.
  //                    Close cursor: pointing straight out at you.
  //
  // Aiming is not all a camera does when you move: it also focuses and zooms,
  // and both of those read off how far away the pointer is.
  //   focus (rotateX) — the ring wrapping the lens turns about the barrel axis,
  //                     near stop to infinity, on the log scale a focus scale is
  //                     printed on.
  //   zoom (translateX) — that same ring racks out of the barrel on an inner
  //                       tube as the subject gets further off, its glass
  //                       reading wider with it.

  var PIVOT_RIGHT = 78;   // px from the viewport's right edge to the joint
  var PIVOT_TOP   = 78;   // px from the top, for the first camera in the stack
  var SLOT_GAP    = 50;   // vertical pitch between stacked cameras; they overlap
  var COL_GAP     = 110;  // horizontal pitch when the stack wraps; barrel is 86
  var BOTTOM_PAD  = 24;   // keep the last camera in a column clear of the edge
  var MAX_ROWS    = 64;   // z-index step per column; larger than any real column
  var MAX_COLS    = 32;   // z-index bookkeeping only — 32 columns is 3520px wide
  var Z_MOUNTS    = 2147481000;   // static mount layer; never reorders
  var Z_HEADS     = 2147483300;   // every head sits above every mount
  var UP_ENTER    = 185;  // yaw past which the barrel counts as swung upward
  var UP_EXIT     = 175;  // and back down again; the gap stops z-index flicker
  var STANDOFF    = 28;   // how far the camera sits off the wall
  var BARREL_LEN  = 68;   // retracted; the shell gave its front ZOOM_MAX px to
                          // the rack, so the tip racked out is where 86 ended
  var BARREL_R    = 18;
  var BARREL_BACK = 14;   // how much barrel sits behind the joint
  var COLLAR_LEN  = 11;
  var COLLAR_R    = 21;
  var LENS_R      = 19;
  var TUBE_LEN    = 40;   // inner barrel the focus ring rides out on
  var TUBE_R      = BARREL_R - 1.5;
  var SEGMENTS    = 20;   // faces around the barrel; more = less visible faceting
  var SEGMENTS_FAR = 10;  // coarser shell for cameras past the first column
  var DETAIL_SLOTS = 12;  // how many get the full-detail barrel
  var RIBS        = 18;   // knurl ridges; they run along the axis, so a turn shows
  var RIBS_FAR    = 8;    // enough for the turn to still read at that size
  var ARM_R       = 9;
  var PLATE_OUT   = 44;   // joint to wall plate, in the wall plane
  var VIEW_Z      = 430;  // assumed eye distance; drives how hard it leans
  var REST_YAW    = 135;  // pointing down-left
  var REST_LEAN   = -32;
  var MIN_YAW     = 20;   // clamped so it never swings through its own mount
  var MAX_YAW     = 250;
  var SWING_DEG   = 90;   // yaw jumps beyond this get the slow, eased swing
  var DEAD_R      = 40;   // inside this, hold the last yaw instead of jittering
  var HOVER_R     = 64;   // fade when the pointer comes this close to the barrel
  var FOCUS_NEAR  = 70;   // pointer distance at the ring's near stop
  var FOCUS_FAR   = 1500; // and at its infinity stop
  var FOCUS_SWEEP = 250;  // degrees of ring travel between the two
  var ZOOM_MAX    = 18;   // px the ring racks out; more than COLLAR_LEN, so the
                          // inner tube is bare by the far end
  var GLASS_MAX   = 1.07; // how much wider the front element reads at full zoom
  var BARREL_MID  = BARREL_LEN / 2 - BARREL_BACK;
  var NOSE_X      = BARREL_LEN - BARREL_BACK;
  var COLLAR_MID  = NOSE_X - COLLAR_LEN / 2;
  var OPACITY_IDLE = "0.92";
  var OPACITY_GHOST = "0.12";

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Cameras overlap at this pitch, and equal z-index would let the last one
  // mounted (the bottom of the stack) paint over the others.
  //
  // Pointing down (the common case) the stack descends: the top camera is in
  // front, so its barrel sweeps over the one below. A barrel swung UP past
  // horizontal reaches into the camera above it instead, and the same rule then
  // hides the moving barrel behind a static neighbour. So flip the sign: an
  // upward camera climbs above the stack, and the lower it sits the further
  // forward it comes, since it is the one reaching furthest across.
  //
  // Columns compose on top of that: the stack wraps leftward, away from the
  // right edge, so each column further out sits a whole column-step behind the
  // one to its right and no barrel can reach across the gap and land wrong.
  function slotZ(slot, up) {
    var p = place(slot);
    return (up ? Z_HEADS + p.row : Z_HEADS - p.row) - colStep(p.col);
  }

  // The gap between the two layer bases is MAX_ROWS * MAX_COLS, so clamping the
  // column here is what guarantees no head can ever sink into the mount layer.
  // Columns past the clamp are thousands of pixels off-screen anyway.
  function colStep(col) { return clamp(col, 0, MAX_COLS - 1) * MAX_ROWS; }

  // Mounts are bolted to the wall and never move, so they keep one fixed order
  // whatever the barrels are doing. They also sit flat against the wall while
  // every head stands off it, so the whole mount layer belongs behind.
  function mountZ(slot) {
    var p = place(slot);
    return Z_MOUNTS - p.row - colStep(p.col);
  }

  // ------------------------------------------------------------------ packing
  //
  // A busy page can run thirty trackers, which at SLOT_GAP would run a long way
  // off the bottom of the viewport. So the stack fills the right edge top to
  // bottom, then wraps into another column to its left.
  //
  // Packing is a pure function of the slot and the viewport height, so a resize
  // reflows the whole stack without any bookkeeping, and mounting a new camera
  // never moves an existing one.
  function perColumn() {
    var h = (window.innerHeight || document.documentElement.clientHeight || 0);
    var fits = Math.floor((h - PIVOT_TOP - BOTTOM_PAD) / SLOT_GAP) + 1;
    return clamp(fits, 1, MAX_ROWS);
  }

  function place(slot) {
    var per = perColumn();
    return { col: Math.floor(slot / per), row: slot % per };
  }

  function anchorCss(slot) {
    var p = place(slot);
    return {
      top: (PIVOT_TOP + p.row * SLOT_GAP) + "px",
      right: (PIVOT_RIGHT + p.col * COL_GAP) + "px"
    };
  }

  // Screen-plane aim. Unchanged from the 2D version: the cursor has no depth.
  function yawFor(dx, dy, fallback) {
    if (Math.sqrt(dx * dx + dy * dy) <= DEAD_R) return fallback;
    var deg = Math.atan2(dy, dx) * 180 / Math.PI;   // -180..180
    if (deg < -90) deg += 360;                      // keep the usable arc contiguous
    return clamp(deg, MIN_YAW, MAX_YAW);
  }

  // How far out of the page to tilt. Always negative: leaning toward the viewer.
  function leanFor(dx, dy) {
    var dz = VIEW_Z - STANDOFF;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return -Math.asin(dz / len) * 180 / Math.PI;
  }

  // Where along its travel the focus ring sits: 0 at the near stop, 1 at
  // infinity. Measured in the wall plane, because the pointer has no depth and
  // that is the distance the eye reads. Log, because that is how a focus scale
  // is actually printed — most of the travel covers the near end, which is also
  // where a step of the pointer changes the subject distance most.
  function focusT(dx, dy) {
    var d = clamp(Math.sqrt(dx * dx + dy * dy), FOCUS_NEAR, FOCUS_FAR);
    return Math.log(d / FOCUS_NEAR) / Math.log(FOCUS_FAR / FOCUS_NEAR);
  }

  var SHELL = "#f4f7fb";

  var SHADOW_CSS = [
    ":host{--cp-yaw:" + REST_YAW + "deg;--cp-lean:" + REST_LEAN + "deg;",
    "--cp-dur:90ms;--cp-ease:linear;--cp-band:#1877f2;",
    "--cp-focus:0deg;--cp-zoom:0px;--cp-glass:1;",
    "--cp-stops:#1877f2 0 44%}",
    ".scene{position:absolute;left:0;top:0;width:0;height:0;",
    "perspective:820px;perspective-origin:0 0}",
    ".rig,.head,.cyl,.grp,.ribs{position:absolute;left:0;top:0;",
    "transform-style:preserve-3d}",
    ".head{transform:translateZ(" + STANDOFF + "px) rotateZ(var(--cp-yaw)) ",
    "rotateY(var(--cp-lean));transition:transform var(--cp-dur) var(--cp-ease)}",
    ".face,.disc,.decal,.plate{position:absolute;left:0;top:0;",
    "backface-visibility:hidden}",
    ".grp{transform:translateX(var(--cp-zoom));",
    "transition:transform var(--cp-dur) var(--cp-ease)}",
    ".ribs{transform:rotateX(var(--cp-focus));",
    "transition:transform var(--cp-dur) var(--cp-ease)}",
    ".rib{background:linear-gradient(rgba(255,255,255,.34),rgba(6,12,22,.62))}",
    ".witness{background:#dfe7f2;box-shadow:0 0 2px rgba(4,10,20,.7)}",
    ".disc{border-radius:50%}",
    ".plate{border-radius:7px;background:linear-gradient(158deg,#fff,#c6d1e0);",
    "box-shadow:0 2px 5px rgba(8,18,38,.4)}",
    ".bolt{position:absolute;width:4px;height:4px;border-radius:50%;",
    "background:radial-gradient(circle at 35% 30%,#fff,#7f8da3);top:50%;margin-top:-2px}",
    ".knuckle{background:radial-gradient(circle at 34% 28%,#fff,#d3dce8 42%,#8593a9 100%);",
    "box-shadow:0 2px 4px rgba(8,18,38,.45)}",
    ".lens{background:radial-gradient(circle at 37% 31%,#6f8199 0%,#26323f 28%,",
    "#080d14 60%,#1d2733 86%,#070b11 100%);",
    "box-shadow:inset 0 0 0 3px #b3bfcf,inset 0 0 10px 4px rgba(0,0,0,.85),",
    "0 0 0 1px rgba(10,18,32,.55);",
    "transition:transform var(--cp-dur) var(--cp-ease)}",
    ".spec{position:absolute;left:0;top:0;width:100%;height:100%;",
    "transform:rotateZ(calc(-1 * var(--cp-yaw)))}",
    ".glint{position:absolute;left:20%;top:14%;width:32%;height:24%;border-radius:50%;",
    "background:rgba(255,255,255,.92);filter:blur(1.4px)}",
    ".shroud{background:radial-gradient(circle at 42% 38%,#2b3644,#0a0e15 70%)}",
    ".cap{background:radial-gradient(circle at 38% 32%,",
    "color-mix(in srgb,var(--cp-band) 62%,#fff),var(--cp-band) 55%,",
    "color-mix(in srgb,var(--cp-band) 62%,#000) 100%);",
    "box-shadow:inset 0 0 0 2px rgba(255,255,255,.35)}",
    ".led{background:#ff3b30;box-shadow:0 0 5px 1px rgba(255,59,48,.85);",
    "animation:cp-blink 2s ease-in-out infinite}",
    ".decal{display:flex;align-items:center;justify-content:center}",
    ".decal.plated{background:#fff;box-shadow:0 0 0 1px rgba(8,18,38,.22)}",
    ".decal.circle{border-radius:50%}",
    ".decal.round{border-radius:5px}",
    ".decal svg{display:block}",
    "@keyframes cp-blink{0%,45%{opacity:1}55%,100%{opacity:.2}}",
    "@media (prefers-reduced-motion:reduce){",
    ".head,.grp,.ribs,.lens{transition:none}.led{animation:none;opacity:1}}"
  ].join("");

  function hostCss(slot, z) {
    var at = anchorCss(slot);
    return [
      "position:fixed",
      "top:" + at.top,
      "right:" + at.right,
      "width:0",
      "height:0",
      "margin:0",
      "padding:0",
      "border:0",
      "background:none",
      "pointer-events:none",
      "z-index:" + z,
      "opacity:" + OPACITY_IDLE,
      "transition:opacity 160ms ease",
      "display:block"
    ].map(function (d) { return d + " !important;"; }).join("");
  }

  function el(cls, css) {
    var d = document.createElement("div");
    d.className = cls;
    if (css) d.style.cssText = css;
    return d;
  }

  // Centre a box on its parent's origin, so transforms rotate about it.
  function box(node, w, h) {
    node.style.width = w + "px";
    node.style.height = h + "px";
    node.style.marginLeft = (-w / 2) + "px";
    node.style.marginTop = (-h / 2) + "px";
    return node;
  }

  // A tube along the local +X axis. Lighting is baked per face, which is what
  // gives the flat faces a cylindrical read.
  function cylinder(len, radius, segs, faceCss) {
    var wrap = el("cyl");
    var chord = 2 * radius * Math.sin(Math.PI / segs) + 0.9;  // overlap the seams
    for (var i = 0; i < segs; i++) {
      var a = i * 360 / segs;
      var r = a * Math.PI / 180;
      // Normal after rotateX(a) is (0, -sin a, cos a); light from up and front.
      var lum = Math.max(0, 0.6 * Math.sin(r) + 0.8 * Math.cos(r));
      var f = box(el("face", faceCss), len, chord);
      f.style.transform = "rotateX(" + a + "deg) translateZ(" + radius + "px)";
      var dark = 0.48 * Math.pow(1 - lum, 0.95);
      var spec = lum > 0.93 ? (lum - 0.93) * 2.4 : 0;
      f.style.boxShadow =
        "inset 0 0 0 200px rgba(8,16,32," + dark.toFixed(3) + ")" +
        (spec ? ",inset 0 0 0 200px rgba(255,255,255," + spec.toFixed(3) + ")" : "");
      wrap.appendChild(f);
    }
    return wrap;
  }

  function buildMount() {
    var scene = el("scene");
    var rig = el("rig");
    scene.appendChild(rig);

    var out = PLATE_OUT * Math.SQRT1_2;           // plate sits up-right of the joint
    var plate = box(el("plate"), 52, 22);
    plate.style.transform = "translate3d(" + out + "px," + (-out) + "px,0)";
    plate.appendChild(el("bolt", "left:7px"));
    plate.appendChild(el("bolt", "right:7px"));
    rig.appendChild(plate);

    var armLen = Math.sqrt(2 * out * out + STANDOFF * STANDOFF);
    var arm = cylinder(armLen, ARM_R, 10,
      "background:linear-gradient(90deg,#dae2ed,#f7fafd)");
    arm.style.transform =
      "translate3d(" + (out / 2) + "px," + (-out / 2) + "px," + (STANDOFF / 2) + "px) " +
      "rotateZ(" + (Math.atan2(out, -out) * 180 / Math.PI) + "deg) " +
      "rotateY(" + (-Math.asin(STANDOFF / armLen) * 180 / Math.PI) + "deg)";
    rig.appendChild(arm);

    var knuckle = box(el("disc knuckle"), 26, 26);
    knuckle.style.transform = "translateZ(" + (STANDOFF + 1) + "px)";
    rig.appendChild(knuckle);

    return scene;
  }

  // A mark is either inline SVG markup or a path to a harvested logo under
  // icons/brands/. The logos are files served from the extension's own origin
  // rather than data: URIs, because a page's CSP applies to anything a content
  // script injects into its DOM and extension URLs are what is exempt from it.
  //
  // The element is built rather than parsed as markup, so a path can never be
  // read as HTML.
  function assetUrl(path) {
    try {
      return chrome.runtime.getURL(path);
    } catch (e) {
      return "/" + path;   // test harnesses, served from the repo root
    }
  }

  // icons/brands/ is not carried in the repository — the logos are trademarked
  // artwork, fetched at build time by tools/fetch-logos.mjs — so a file can
  // legitimately be missing: the build was never run, or a company stopped
  // serving the icon it was harvested from. An empty decal reads as a bug, so
  // fall back to the monogram. It carries its own disc rather than reusing
  // monogramBrand's flat mark, because by this point the band is already
  // painted for a logo and white letters on it may not read.
  function fallbackMark(decal, tracker) {
    decal.className = decal.className.replace(/\bplated\b/, "").replace(/\s+/g, " ").trim();
    var letters = initials(tracker.name).replace(/[^A-Za-z0-9]/g, "") || "??";
    // Letters are filtered to alphanumerics above, so this cannot inject markup.
    decal.innerHTML =
      '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="12" fill="hsl(' + hueFor(tracker.id) + ',64%,44%)"/>' +
      '<text x="12" y="12.5" fill="#fff" font-family="' + MONO_FONT + '" ' +
      'font-size="' + (letters.length > 1 ? 11 : 15) + '" font-weight="700" ' +
      'letter-spacing="-0.5" text-anchor="middle" dominant-baseline="central">' +
      letters + "</text></svg>";
  }

  function setMark(decal, tracker) {
    var mark = tracker.mark;
    if (!mark) return;
    if (mark.slice(0, 6) === "icons/") {
      var img = document.createElement("img");
      img.onerror = function () {
        decal.removeChild(img);
        fallbackMark(decal, tracker);
      };
      img.src = assetUrl(mark);
      img.alt = "";
      img.style.cssText =
        "width:100%;height:100%;object-fit:contain;display:block;border:0";
      decal.appendChild(img);
      return;
    }
    decal.innerHTML = mark;
  }

  // Each face is an element that the browser restyles on every pointer update,
  // so the barrel is the whole cost of a camera. Thirty at full detail is about
  // 5 ms of style recalc a frame, which is a third of the 60fps budget and more
  // than this is worth. Cameras past the first column are small, half-occluded
  // and rarely the one you are looking at, so they get a coarser shell — the
  // faceting is not visible at that size.
  function segmentsFor(slot) {
    return slot < DETAIL_SLOTS ? SEGMENTS : SEGMENTS_FAR;
  }

  // The knurl is the one layer that moves a whole set of children on every
  // update, so it thins out on the same budget as the shell.
  function ribsFor(slot) {
    return slot < DETAIL_SLOTS ? RIBS : RIBS_FAR;
  }

  // The head is a separate layer from its mount so its paint order can change
  // with the swing without dragging the static bracket along with it.
  function buildHead(tracker, slot) {
    var scene = el("scene");
    var rig = el("rig");
    scene.appendChild(rig);

    var head = el("head");
    rig.appendChild(head);

    // White shell with the vendor's brand colour banding the back third.
    var segs = segmentsFor(slot || 0);
    var barrel = cylinder(BARREL_LEN, BARREL_R, segs,
      "background:linear-gradient(90deg,var(--cp-stops)," + SHELL + " 44% 100%)");
    barrel.style.transform = "translateX(" + BARREL_MID + "px)";
    head.appendChild(barrel);

    // Everything from here forward is the focus ring assembly: the collar that
    // wraps the lens, the lens itself, and the inner tube they ride out on. It
    // turns about the barrel axis with the focus and racks out with the zoom.
    var front = el("grp");

    var tube = cylinder(TUBE_LEN, TUBE_R, segs,
      "background:linear-gradient(90deg,#252d38,#39424f)");
    tube.style.transform = "translateX(" + (NOSE_X - TUBE_LEN / 2 - 2) + "px)";
    front.appendChild(tube);

    var collar = cylinder(COLLAR_LEN, COLLAR_R, segs,
      "background:linear-gradient(90deg,#dfe6f0,#eff4fa)");
    collar.style.transform = "translateX(" + COLLAR_MID + "px)";
    front.appendChild(collar);

    var shroud = box(el("disc shroud"), (COLLAR_R - 0.5) * 2, (COLLAR_R - 0.5) * 2);
    shroud.style.transform = "translateX(" + (NOSE_X - 4) + "px) rotateY(90deg)";
    front.appendChild(shroud);

    // The turn itself. The collar's own lighting is baked per face, so turning
    // that shell would drag the highlight round with it, as if the light moved;
    // what turns is the knurl on top of it. Ribs run along the axis — the way
    // you knurl anything meant to be twisted, and the only direction in which a
    // turn shows: a rib running around the ring would look the same at every
    // angle.
    var knurl = el("cyl");
    knurl.style.transform = "translateX(" + COLLAR_MID + "px)";
    var ribs = el("ribs");
    var nribs = ribsFor(slot || 0);
    for (var i = 0; i < nribs; i++) {
      var rib = box(el("face rib"), COLLAR_LEN - 3, 2.4);
      rib.style.transform = "rotateX(" + (i * 360 / nribs) + "deg) " +
        "translateZ(" + (COLLAR_R + 0.35) + "px)";
      ribs.appendChild(rib);
    }
    // One rib painted as a witness mark, so the ring reads as being at some
    // definite setting rather than just textured.
    var witness = box(el("face rib witness"), COLLAR_LEN - 1, 3);
    witness.style.transform = "translateZ(" + (COLLAR_R + 0.45) + "px)";
    ribs.appendChild(witness);
    knurl.appendChild(ribs);
    front.appendChild(knurl);

    var lens = box(el("disc lens"), LENS_R * 2, LENS_R * 2);
    lens.style.transform = "translateX(" + (NOSE_X - 1) + "px) rotateY(90deg) " +
      "scale(var(--cp-glass))";
    // The highlight hangs off a counter-rotated layer, not the lens itself: a
    // reflection comes from a fixed light, so it must not turn with the camera.
    var spec = el("spec");
    spec.appendChild(el("glint"));
    lens.appendChild(spec);
    front.appendChild(lens);
    head.appendChild(front);

    var cap = box(el("disc cap"), BARREL_R * 2, BARREL_R * 2);
    cap.style.transform = "translateX(" + (-BARREL_BACK) + "px) rotateY(-90deg)";
    head.appendChild(cap);

    // The mark rides the band as a decal on the viewer-facing surface.
    var decal = box(el(("decal " + tracker.plate).trim()), tracker.decalW, tracker.decalH);
    // Printed on the barrel, so it turns with it — no counter-rotation. The mark
    // is part of the object, unlike the lens highlight, which is a reflection and
    // does stay put in screen space. The flat 180 is just how the decal is applied
    // to the shell: it puts the mark the right way up at the rest pose.
    decal.style.transform = "translateX(4px) translateZ(" + (BARREL_R + 0.5) + "px) " +
      "rotateZ(180deg)";
    setMark(decal, tracker);
    head.appendChild(decal);

    var led = box(el("disc led"), 5, 5);
    led.style.transform =
      "translateX(28px) rotateX(-38deg) translateZ(" + (BARREL_R + 0.6) + "px)";
    head.appendChild(led);

    return scene;
  }

  // ------------------------------------------------------------------ cameras

  var cameras = [];
  var guardObserver = null;
  var listening = false;

  // One shadow host, positioned at the camera's joint, carrying one layer.
  function makeHost(slot, z) {
    var host = document.createElement("div");
    host.style.cssText = hostCss(slot, z);
    var root = host.attachShadow({ mode: "closed" });

    // Constructable stylesheets sidestep any page style-src CSP entirely.
    var adopted = false;
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(SHADOW_CSS);
      root.adoptedStyleSheets = [sheet];
      adopted = true;
    } catch (e) {
      adopted = false;
    }
    if (!adopted) {
      var style = document.createElement("style");
      style.textContent = SHADOW_CSS;
      root.appendChild(style);
    }
    return { host: host, root: root };
  }

  function mount(tracker, slot) {
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", function () {
        mount(tracker, slot);
      }, { once: true });
      return;
    }

    // Two layers per camera at the same anchor: the bracket never reorders,
    // the head does. Same perspective and origin, so they stay registered.
    var mountLayer = makeHost(slot, mountZ(slot));
    mountLayer.root.appendChild(buildMount());

    var headLayer = makeHost(slot, slotZ(slot, false));
    headLayer.host.style.setProperty("--cp-band", tracker.band);
    headLayer.host.style.setProperty("--cp-stops", tracker.stops);
    headLayer.root.appendChild(buildHead(tracker, slot));

    document.documentElement.appendChild(mountLayer.host);
    document.documentElement.appendChild(headLayer.host);

    var cam = { id: tracker.id, slot: slot, host: headLayer.host,
                mountHost: mountLayer.host, rect: null, ghost: false,
                lastYaw: REST_YAW, up: false };
    cameras.push(cam);
    measure(cam);

    if (!listening) {
      listening = true;
      // Layout may not be settled at document_start; re-measure once it is.
      document.addEventListener("DOMContentLoaded", measureAll, { once: true });
      window.addEventListener("load", measureAll, { once: true });

      // Some pages wipe documentElement's children; put the cameras back.
      guardObserver = new MutationObserver(function () {
        for (var i = 0; i < cameras.length; i++) {
          var c = cameras[i];
          if (!c.mountHost.isConnected) document.documentElement.appendChild(c.mountHost);
          if (!c.host.isConnected) {
            document.documentElement.appendChild(c.host);
            measure(c);
          }
        }
      });
      guardObserver.observe(document.documentElement, { childList: true });

      window.addEventListener("mousemove", onMouseMove, { passive: true });
      window.addEventListener("resize", measureAll, { passive: true });
      document.addEventListener("mouseleave", onMouseOut, { passive: true });
      window.addEventListener("blur", onMouseOut);
    }
  }

  // Re-anchor first: a resize can change how many cameras fit a column, which
  // moves every slot past the fold and reorders the columns behind each other.
  // Then read the rect back, since the host is a zero-size anchor and its rect
  // *is* that camera's joint.
  function measure(cam) {
    var at = anchorCss(cam.slot);
    var pair = [cam.host, cam.mountHost];
    for (var i = 0; i < pair.length; i++) {
      pair[i].style.setProperty("top", at.top, "important");
      pair[i].style.setProperty("right", at.right, "important");
    }
    cam.host.style.setProperty("z-index", String(slotZ(cam.slot, cam.up)), "important");
    cam.mountHost.style.setProperty("z-index", String(mountZ(cam.slot)), "important");
    cam.rect = cam.host.getBoundingClientRect();
  }

  function measureAll() {
    for (var i = 0; i < cameras.length; i++) measure(cameras[i]);
  }

  // One write of five custom properties per camera per frame. Only the four
  // elements that read them restyle: the head, the knurl, the front group and
  // the glass — the couple of hundred baked faces behind them never do.
  function setPose(cam, yaw, lean, t, durMs, ease) {
    cam.lastYaw = yaw;
    var st = cam.host.style;
    st.setProperty("--cp-yaw", yaw + "deg");
    st.setProperty("--cp-lean", lean + "deg");
    st.setProperty("--cp-focus", (t * FOCUS_SWEEP).toFixed(1) + "deg");
    st.setProperty("--cp-zoom", (t * ZOOM_MAX).toFixed(2) + "px");
    st.setProperty("--cp-glass", (1 + t * (GLASS_MAX - 1)).toFixed(3));
    st.setProperty("--cp-dur", durMs + "ms");
    st.setProperty("--cp-ease", ease);
  }

  // Hysteresis: without the dead band the z-index would flip back and forth
  // while the cursor hovers along the horizontal.
  function setUp(cam, yaw) {
    var up = cam.up;
    if (!up && yaw > UP_ENTER) up = true;
    else if (up && yaw < UP_EXIT) up = false;
    if (up === cam.up) return;
    cam.up = up;
    cam.host.style.setProperty("z-index", String(slotZ(cam.slot, up)), "important");
  }

  function setGhost(cam, on) {
    if (on === cam.ghost) return;
    cam.ghost = on;
    var o = on ? OPACITY_GHOST : OPACITY_IDLE;
    cam.host.style.setProperty("opacity", o, "important");
    cam.mountHost.style.setProperty("opacity", o, "important");
  }

  var pendingX = 0;
  var pendingY = 0;
  var frame = 0;

  function onMouseMove(event) {
    pendingX = event.clientX;
    pendingY = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(aimAll);
  }

  function aimAll() {
    frame = 0;
    for (var i = 0; i < cameras.length; i++) aim(cameras[i]);
  }

  function aim(cam) {
    var rect = cam.rect;
    if (!rect || (rect.left === 0 && rect.top === 0)) { measure(cam); rect = cam.rect; }
    if (!rect) return;

    var dx = pendingX - rect.left;
    var dy = pendingY - rect.top;
    var yaw = yawFor(dx, dy, cam.lastYaw);
    var lean = leanFor(dx, dy);
    var t = focusT(dx, dy);

    // A big yaw jump means the cursor crossed straight above the joint and the
    // aim flipped between clamp ends; swing round instead of teleporting.
    var swing = Math.abs(yaw - cam.lastYaw) > SWING_DEG;
    setPose(cam, yaw, lean, t, swing ? 420 : 90,
            swing ? "cubic-bezier(.4,0,.2,1)" : "linear");
    setUp(cam, yaw);

    // Fade against where the barrel actually is, which foreshortens as it leans.
    var reach = BARREL_MID * Math.cos(lean * Math.PI / 180);
    var rad = yaw * Math.PI / 180;
    var cx = rect.left + reach * Math.cos(rad);
    var cy = rect.top + reach * Math.sin(rad);
    setGhost(cam, Math.sqrt((pendingX - cx) * (pendingX - cx) +
                            (pendingY - cy) * (pendingY - cy)) < HOVER_R);
  }

  function onMouseOut() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    for (var i = 0; i < cameras.length; i++) {
      setPose(cameras[i], REST_YAW, REST_LEAN, 0, 700, "cubic-bezier(.22,.9,.3,1)");
      setUp(cameras[i], REST_YAW);
      setGhost(cameras[i], false);
    }
  }

  // ----------------------------------------------------------------- settings
  //
  // Four switches, all the user's: off everywhere, off for this site, and one
  // per category — some people want to see who is selling to them without the
  // analytics noise, or the reverse.
  //
  // Detection runs whatever they are set to. It costs almost nothing, and it
  // means the popup can still report who is on the page with every camera
  // hidden. Only the drawing is withheld.

  var SITE = location.hostname.replace(/^www\./, "");

  var DEFAULTS = {
    off: false,
    disabledSites: [],
    showAds: true,
    showAnalytics: true
  };

  var settings = DEFAULTS;
  var enabled = false;   // until settings arrive; see the storage.get below

  function shows(tracker) {
    if (!enabled) return false;
    return tracker.category === "advertising"
      ? settings.showAds
      : settings.showAnalytics;
  }

  function teardown() {
    for (var i = 0; i < cameras.length; i++) {
      var c = cameras[i];
      if (c.host.parentNode) c.host.parentNode.removeChild(c.host);
      if (c.mountHost.parentNode) c.mountHost.parentNode.removeChild(c.mountHost);
    }
    cameras.length = 0;
  }

  // Slots are handed out over the visible cameras only, so hiding a category
  // closes the gaps it leaves rather than stranding holes down the column.
  function rebuild() {
    teardown();
    var slot = 0;
    for (var i = 0; i < order.length; i++) {
      if (shows(order[i])) mount(order[i], slot++);
    }
  }

  function applySettings(next) {
    var before = enabled + "|" + settings.showAds + "|" + settings.showAnalytics;
    settings = next;
    enabled = !next.off && next.disabledSites.indexOf(SITE) === -1;
    if (before === enabled + "|" + next.showAds + "|" + next.showAnalytics) return;
    rebuild();
  }

  var storage = null;
  try {
    storage = chrome.storage && chrome.storage.local;
  } catch (e) {
    storage = null;   // test harness, or an unexpected context
  }

  if (storage) {
    // Cameras are withheld until the settings arrive, so a site the user has
    // switched off never flashes one first. Detection starts immediately either
    // way, and rebuild() draws whatever was found while we waited.
    storage.get(DEFAULTS, applySettings);

    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "local") return;
        storage.get(DEFAULTS, applySettings);
      });
    } catch (e) {
      // Live toggling is a convenience; a missing listener is not fatal.
    }

    // The popup asks what is on this page. It never asks anything else, and
    // nothing is sent anywhere — this reply crosses no process but Chrome's.
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
        if (!msg || msg.type !== "creepy-peeper:state") return;
        reply({
          site: SITE,
          enabled: enabled,
          companies: order.map(function (t) {
            return {
              id: t.id,
              name: t.name,
              category: t.category,
              band: t.band,
              shown: shows(t)
            };
          })
        });
        return true;
      });
    } catch (e) {
      // Without messaging the popup just shows the toggles.
    }
  } else {
    // No extension context (a test harness, or the scripts loaded by hand).
    // Behave as though everything is switched on.
    enabled = true;
  }

  // ---------------------------------------------------------------- bootstrap
  // Must run last: onDetected() calls mount(), which reads the overlay vars above.

  // The MAIN-world script reports two things we cannot see from here: the
  // trackers' globals, and every hostname the page requested.
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.__creepyPeeper !== true) return;
    // Deliberately not restricted to event.source === window: reports arrive
    // from sub-frames too. That does let page script post a made-up hostname,
    // but a page can already raise any camera it likes by simply requesting
    // that domain, so this grants nothing new — and every claim still has to
    // resolve against the bundled registry before it draws anything.
    var i;
    if (data.vendors) {
      for (i = 0; i < data.vendors.length; i++) onDetected(data.vendors[i]);
    }
    if (data.hosts) {
      for (i = 0; i < data.hosts.length; i++) {
        var host = data.hosts[i];
        if (suffix2(host) === SELF) continue;
        var id = idForHost(host);
        if (id) onDetected(id);
      }
    }
  });

  // No early exit on a full house: with 498 possible trackers that would never
  // fire, so watching simply runs until WATCH_MS is up.
  scan();
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", scan, { once: true });
  window.addEventListener("load", scan, { once: true });
  stopTimer = setTimeout(stopWatching, WATCH_MS);
})();
