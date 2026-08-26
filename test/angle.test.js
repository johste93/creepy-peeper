// Exercise the real aiming maths lifted out of src/content.js.
// Run from the repo root: node test/angle.test.js
const fs = require("fs");
const src = fs.readFileSync("src/content.js", "utf8");
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));

// The geometry block, lifted verbatim so the maths under test is the shipped
// maths. Packing reads window.innerHeight, so the harness supplies a viewport
// it can change between assertions.
const VW = 1200;
let VH = 800;
const geometry = (h) => {
  VH = h;
  const code =
    "var window = { innerHeight: " + h + " };\n" +
    slice("  var PIVOT_RIGHT", "  var SHELL =") +
    "\nreturn { clamp, yawFor, leanFor, PIVOT_RIGHT, PIVOT_TOP, NOSE_X, COLLAR_R," +
    " BARREL_MID, MIN_YAW, MAX_YAW, DEAD_R, REST_YAW, REST_LEAN, SLOT_GAP, COL_GAP," +
    " MAX_ROWS, MAX_COLS, BOTTOM_PAD, slotZ, mountZ, perColumn, place, anchorCss," +
    " UP_ENTER, UP_EXIT, focusT, FOCUS_NEAR, FOCUS_FAR, FOCUS_SWEEP, ZOOM_MAX," +
    " GLASS_MAX, LENS_R, BARREL_R, BARREL_LEN, COLLAR_LEN, COLLAR_MID, TUBE_LEN, TUBE_R };";
  return new Function(code)();
};
let m = geometry(800);

// The detection helpers, sliced the same way. REG comes from the generated
// registry, so these assertions run against the real 991-domain table.
const registry = (() => {
  const g = { window: {} };
  new Function("window", fs.readFileSync("src/registry.js", "utf8"))(g.window);
  return g.window.__cpRegistry;
})();
// The monogram fallback, which is what every not-yet-curated tracker renders.
const mono = (() => {
  const code =
    slice("  var MONO_FONT =", "  var trackerCache = {};") +
    "\nreturn { initials, hueFor, monogramBrand, bandStops };";
  return new Function(code)();
})();

const lookup = (() => {
  const code =
    "var REG = arguments[0], location = { hostname: arguments[1] };\n" +
    slice("  function idForHost", "  var scanned = new WeakSet();") +
    "\nreturn { idForHost, suffix2, SELF };";
  return (host) => new Function(code)(registry, host);
})();

const px = VW - m.PIVOT_RIGHT, py = m.PIVOT_TOP;   // joint, in viewport coords
const yaw = (x, y, prev = m.REST_YAW) => m.yawFor(x - px, y - py, prev);
const lean = (x, y) => m.leanFor(x - px, y - py);

let fails = 0;
const check = (name, got, want, tol = 1.5) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${got.toFixed(1)} (want ~${want})`);
};
const ok = (name, cond, detail = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

console.log(`joint at (${px}, ${py}) in a ${VW}x${VH} viewport\n--- yaw (screen-plane aim)`);

check("straight below the joint", yaw(px, py + 400), 90);
check("straight left", yaw(px - 600, py), 180);
check("down-left at 45deg", yaw(px - 300, py + 300), 135);
check("rest pose", m.REST_YAW, 135, 0);
check("just left of straight up clamps to MAX", yaw(px - 1, py - 60), m.MAX_YAW);
check("straight up clamps to MIN", yaw(px, py - 60), m.MIN_YAW);
check("straight right clamps to MIN", yaw(px + 300, py), m.MIN_YAW);
check("dead zone holds the previous yaw", yaw(px + 3, py + 3, 88), 88, 0);
ok("dead zone is only the joint itself",
   m.yawFor(m.DEAD_R + 1, 0, 999) !== 999, `radius ${m.DEAD_R}px`);

console.log("\n--- lean (tilt out of the page)");
const far = lean(0, VH), near = lean(px - 30, py + 30), atJoint = lean(px, py);
check("far cursor leans only slightly", far, -18, 8);
ok("closer cursor leans harder", near < far, `${near.toFixed(0)}deg vs ${far.toFixed(0)}deg`);
check("at the joint it stares straight out", atJoint, -90, 0.5);

let badLean = 0, badYaw = 0, clamped = 0, total = 0;
for (let x = 0; x <= VW; x += 7) {
  for (let y = 0; y <= VH; y += 7) {
    const a = yaw(x, y), l = lean(x, y);
    total++;
    if (!(a >= m.MIN_YAW - 1e-9 && a <= m.MAX_YAW + 1e-9) || Number.isNaN(a)) badYaw++;
    if (!(l <= 0 && l >= -90) || Number.isNaN(l)) badLean++;
    if (a === m.MIN_YAW || a === m.MAX_YAW) clamped++;
  }
}
console.log("");
ok(`yaw stays in [${m.MIN_YAW},${m.MAX_YAW}] across the viewport`, badYaw === 0,
   `${badYaw} outliers`);
ok("lean stays in [-90,0] across the viewport", badLean === 0, `${badLean} outliers`);

console.log("\n--- focus and zoom (how far away the pointer is)");
const focus = (x, y) => m.focusT(x - px, y - py);
const corner = focus(0, VH);   // the far corner of this viewport

check("the joint itself is at the near stop", focus(px, py), 0, 0);
check("inside the near stop it stays wound in", focus(px, py + m.FOCUS_NEAR - 10), 0, 0);
check("past the far stop it stays at infinity", focus(px - 4000, py), 1, 0);
check("the geometric mean of the two stops is half the travel",
      focus(px - Math.sqrt(m.FOCUS_NEAR * m.FOCUS_FAR), py), 0.5, 0.001);
ok("a log scale spends most of the travel up close",
   focus(px - 300, py) > (300 - m.FOCUS_NEAR) / (m.FOCUS_FAR - m.FOCUS_NEAR) + 0.3,
   `${focus(px - 300, py).toFixed(2)} of the ring used by 300px out`);
ok("the far corner of the viewport is near infinity", corner > 0.9,
   `t = ${corner.toFixed(2)} at the corner of a ${VW}x${VH} viewport`);

let badT = 0, prev = -1, backwards = 0;
for (let d = 0; d <= 3000; d += 3) {
  const t = m.focusT(-d, 0);
  if (!(t >= 0 && t <= 1) || Number.isNaN(t)) badT++;
  if (t < prev) backwards++;
  prev = t;
}
ok("the ring never winds past either stop", badT === 0,
   `travel ${(m.FOCUS_SWEEP).toFixed(0)}deg, rack ${m.ZOOM_MAX}px`);
ok("pulling the pointer further away never winds focus back", backwards === 0);

// Racking out must not open the barrel up or burst the glass out of its shroud.
const overlap = m.TUBE_LEN + 2 - m.ZOOM_MAX;
ok("the ring pulls clear of the barrel nose, baring the tube",
   m.ZOOM_MAX > m.COLLAR_LEN,
   `${m.ZOOM_MAX - m.COLLAR_LEN}px of tube showing at full zoom`);
ok("the inner tube is still plugged into the barrel at full zoom", overlap > 8,
   `${overlap.toFixed(0)}px of tube left inside`);
ok("the tube hides inside the shell when racked in", m.TUBE_R < m.BARREL_R - 1,
   `tube r${m.TUBE_R}, barrel r${m.BARREL_R}`);
ok("the glass stays inside the shroud at full zoom",
   m.LENS_R * m.GLASS_MAX <= m.COLLAR_R - 0.5,
   `${(m.LENS_R * m.GLASS_MAX).toFixed(1)}px of glass in a ${m.COLLAR_R - 0.5}px mouth`);
ok("the ring that turns is the one already wrapping the lens",
   m.COLLAR_MID + m.COLLAR_LEN / 2 === m.NOSE_X && m.COLLAR_R > m.BARREL_R,
   `collar r${m.COLLAR_R} at the r${m.BARREL_R} barrel's nose`);
ok("the ring parks on the shell, not off the end of it",
   m.COLLAR_MID - m.COLLAR_LEN / 2 > 0 && m.COLLAR_LEN < m.BARREL_LEN,
   `ring rests at ${m.COLLAR_MID - m.COLLAR_LEN / 2}..${m.NOSE_X} of a ${m.BARREL_LEN}px shell`);

// The barrel must not sweep off the top or right edge, worst case (no
// foreshortening) — measured racked all the way out, which is as long as the
// camera ever gets. Shortening the retracted barrel is what pays for the travel.
const rad = d => d * Math.PI / 180;
const TIP = m.NOSE_X + m.ZOOM_MAX;
const needRight = TIP * Math.cos(rad(m.MIN_YAW)) + m.COLLAR_R * Math.sin(rad(m.MIN_YAW));
const needTop = TIP * Math.abs(Math.sin(rad(m.MAX_YAW))) +
                m.COLLAR_R * Math.abs(Math.cos(rad(m.MAX_YAW)));
ok("clears the right edge at MIN_YAW", m.PIVOT_RIGHT >= needRight,
   `${m.PIVOT_RIGHT}px available, ${needRight.toFixed(0)}px needed`);
ok("clears the top edge at MAX_YAW", m.PIVOT_TOP >= needTop,
   `${m.PIVOT_TOP}px available, ${needTop.toFixed(0)}px needed`);

// Cameras are stacked deliberately tight, so they DO overlap. What matters is
// that the paint order is right: the top of the stack must stay in front.
let maxDown = 0, maxUp = 0;
for (let a = m.MIN_YAW; a <= m.MAX_YAW; a += 0.5) {
  const r = rad(a);
  const along = TIP * Math.sin(r), across = m.COLLAR_R * Math.abs(Math.cos(r));
  maxDown = Math.max(maxDown, along + across);
  maxUp = Math.max(maxUp, -along + across);
}
ok("pointing down, the top camera is in front",
   m.slotZ(0, false) > m.slotZ(1, false) && m.slotZ(1, false) > m.slotZ(2, false),
   `slot 0/1/2 -> ${m.slotZ(0, false)}/${m.slotZ(1, false)}/${m.slotZ(2, false)}`);
ok("a barrel swung up comes forward of the cameras above it",
   m.slotZ(2, true) > m.slotZ(1, false) && m.slotZ(2, true) > m.slotZ(0, false),
   `slot 2 up ${m.slotZ(2, true)} vs slot 0 down ${m.slotZ(0, false)}`);
ok("among upward cameras the lowest reaches furthest, so leads",
   m.slotZ(2, true) > m.slotZ(1, true) && m.slotZ(1, true) > m.slotZ(0, true),
   `slot 0/1/2 up -> ${m.slotZ(0, true)}/${m.slotZ(1, true)}/${m.slotZ(2, true)}`);
ok("mounts keep one fixed order whatever the barrels do",
   m.mountZ(0) > m.mountZ(1) && m.mountZ(1) > m.mountZ(2),
   `slot 0/1/2 -> ${m.mountZ(0)}/${m.mountZ(1)}/${m.mountZ(2)}`);
ok("every head sits above every mount, up or down",
   Math.min(m.slotZ(20, false), m.slotZ(20, true)) > m.mountZ(0),
   `lowest head ${Math.min(m.slotZ(20, false), m.slotZ(20, true))} vs top mount ${m.mountZ(0)}`);
ok("z-index stays a valid positive CSS integer either way",
   Number.isSafeInteger(m.slotZ(0, false)) && m.slotZ(20, false) > 0 &&
   m.slotZ(20, true) <= 2147483647,
   `slot 20 -> ${m.slotZ(20, false)} down / ${m.slotZ(20, true)} up`);

console.log("--- column packing");
{
  const per = m.perColumn();
  ok("slot 0 anchors at the corner",
     m.place(0).col === 0 && m.place(0).row === 0 &&
     m.anchorCss(0).top === m.PIVOT_TOP + "px" &&
     m.anchorCss(0).right === m.PIVOT_RIGHT + "px",
     `${m.anchorCss(0).top} / ${m.anchorCss(0).right}`);
  ok(`a ${VH}px viewport fits ${per} cameras per column`,
     per > 1 && m.PIVOT_TOP + (per - 1) * m.SLOT_GAP <= VH - m.BOTTOM_PAD,
     `last row at ${m.PIVOT_TOP + (per - 1) * m.SLOT_GAP}px of ${VH}px`);
  ok("one more than fits starts a fresh column",
     m.place(per).col === 1 && m.place(per).row === 0 &&
     m.anchorCss(per).right === m.PIVOT_RIGHT + m.COL_GAP + "px",
     `slot ${per} -> col ${m.place(per).col} row ${m.place(per).row}`);
  ok("packing is contiguous — no slot is skipped or doubled",
     (() => {
       const seen = new Set();
       for (let s = 0; s < 3 * per; s++) {
         const p = m.place(s);
         const key = p.col + ":" + p.row;
         if (seen.has(key) || p.row >= per) return false;
         seen.add(key);
       }
       return seen.size === 3 * per;
     })(), `${3 * per} slots over 3 columns`);
  ok("columns paint back to front, rightmost in front",
     m.slotZ(0, false) > m.slotZ(per, false) &&
     m.slotZ(per, false) > m.slotZ(2 * per, false),
     `col 0/1/2 -> ${m.slotZ(0, false)}/${m.slotZ(per, false)}/${m.slotZ(2 * per, false)}`);
  ok("an upward barrel still cannot reach across a column",
     m.slotZ(per, true) < m.slotZ(per - 1, false),
     `col 1 up ${m.slotZ(per, true)} vs col 0 bottom ${m.slotZ(per - 1, false)}`);
  ok("every head beats every mount at the worst column",
     Math.min(m.slotZ(999 * per, false), m.slotZ(999 * per, true)) >
       m.mountZ(0),
     `deepest head ${m.slotZ(999 * per, false)} vs top mount ${m.mountZ(0)}`);
  ok("z-index stays inside the CSS integer range at the worst column",
     m.slotZ(0, true) <= 2147483647 && m.mountZ(999 * per) > 0,
     `max ${m.slotZ(0, true)}, min ${m.mountZ(999 * per)}`);
}
{
  const tiny = geometry(300);
  ok("a short viewport still packs at least one per column",
     tiny.perColumn() >= 1 && tiny.place(0).col === 0,
     `perColumn ${tiny.perColumn()} at 300px`);
  const tall = geometry(2000);
  ok("a tall viewport packs more per column than a short one",
     tall.perColumn() > tiny.perColumn(),
     `${tall.perColumn()} at 2000px vs ${tiny.perColumn()} at 300px`);
  VH = 800;
}

console.log("\n--- registry lookup");
{
  const L = lookup("example.com");
  const ids = Object.keys(registry.T), domains = Object.keys(registry.D);
  ok("the registry ships one entry per company, not per product",
     ids.length === 444, `${ids.length} companies, ${domains.length} domains`);
  ok("a company's products collapse into a single camera",
     registry.D["google-analytics.com"] === "google" &&
     registry.D["doubleclick.net"] === "google" &&
     registry.D["clarity.ms"] === "microsoft" &&
     registry.D["ads.microsoft.com"] === "microsoft",
     "Google's nine trackers and Microsoft's six are one camera each");
  ok("Google Tag Manager is excluded — it is a consent gate, not a tracker",
     registry.D["googletagmanager.com"] === undefined);
  ok("WordPress's emoji CDN is excluded but its stats pixel is not",
     registry.D["w.org"] === undefined && registry.D["wp.com"] === "automattic",
     "core WordPress loads s.w.org on every page with no analytics involved");
  ok("every domain resolves to a tracker that has metadata",
     domains.every((d) => registry.T[registry.D[d]] !== undefined));
  ok("every tracker has a name and a category",
     ids.every((i) => registry.T[i].n && /^[as]$/.test(registry.T[i].c)));
  ok("company names are display names, not slugs",
     registry.T["microsoft"].n === "Microsoft" && registry.T["braze_inc"].n === "Braze",
     `${registry.T["microsoft"].n} / ${registry.T["braze_inc"].n}`);
  ok("obscure parent companies are named for the brand people meet",
     registry.T["bytedance_inc"].n === "TikTok" && registry.T["twilio"].n === "Segment",
     `${registry.T["bytedance_inc"].n} / ${registry.T["twilio"].n}`);
  ok("no company name is left as a bare legal entity",
     Object.values(registry.T).every((t) => !/,\s*(Inc|LLC|Ltd|GmbH)\.?$/i.test(t.n)),
     (() => {
       const bad = Object.values(registry.T)
         .filter((t) => /,\s*(Inc|LLC|Ltd|GmbH)\.?$/i.test(t.n)).map((t) => t.n);
       return bad.length ? `${bad.length}: ${bad.slice(0, 4).join(", ")}` : "all 444";
     })());
  ok("exact domain resolves", L.idForHost("criteo.net") === "criteo",
     `criteo.net -> ${L.idForHost("criteo.net")}`);
  ok("a deep subdomain walks up to its tracker",
     L.idForHost("a.b.c.criteo.net") === "criteo",
     `a.b.c.criteo.net -> ${L.idForHost("a.b.c.criteo.net")}`);
  ok("an unrelated host resolves to nothing",
     L.idForHost("news.example.org") === null);
  ok("a lookalike suffix does not match",
     L.idForHost("notcriteo.net") === null,
     `notcriteo.net -> ${L.idForHost("notcriteo.net")}`);
  ok("a bare label does not crash",
     L.idForHost("localhost") === null && L.idForHost("") === null);
  ok("first-party assets are not treated as tracking",
     lookup("www.criteo.net").SELF === "criteo.net",
     `browsing criteo.net suppresses its own camera`);
}

console.log("\n--- one name, one function");
{
  // content.js is one long IIFE, so two function declarations sharing a name
  // silently overwrite each other and every call site quietly gets the later
  // one. That is how requestAnimationFrame(apply) ended up handing a timestamp
  // to the settings applier, and it threw on every pointer move.
  const src = fs.readFileSync("src/content.js", "utf8");
  const names = [...src.matchAll(/^  function ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  ok("no two top-level functions share a name", dupes.length === 0,
     dupes.length ? `duplicated: ${[...new Set(dupes)].join(", ")}`
                  : `${names.length} declarations, all distinct`);

  // Same trap for the vars they close over.
  const vars = [...src.matchAll(/^  var ([A-Za-z0-9_$]+)\s*=/gm)].map((m) => m[1]);
  const dupeVars = vars.filter((n, i) => vars.indexOf(n) !== i);
  ok("no top-level var is declared twice", dupeVars.length === 0,
     dupeVars.length ? `duplicated: ${[...new Set(dupeVars)].join(", ")}`
                     : `${vars.length} declarations, all distinct`);

  ok("the animation-frame callback is not the settings applier",
     /requestAnimationFrame\(aimAll\)/.test(src) &&
     /function aimAll\(\)/.test(src) &&
     /function applySettings\(next\)/.test(src));
}

console.log("\n--- category filter");
{
  const src = fs.readFileSync("src/content.js", "utf8");
  // mount() belongs to the overlay half of the file, so the harness stands in
  // for it and records the slot each camera was handed. That makes the slot
  // packing testable at the same time as the filter.
  const f = new Function(
    "var location = { hostname: 'example.com' };\n" +
    "var order = arguments[0], drawn = arguments[1], cameras = [];\n" +
    "function mount(t, slot) { drawn.push(slot); cameras.push(t); }\n" +
    slice("  var SITE = location.hostname", "  var storage = null;") +
    "\nreturn { shows, applySettings, DEFAULTS };");

  const page = [
    { id: "a1", category: "advertising" }, { id: "s1", category: "site_analytics" },
    { id: "a2", category: "advertising" }, { id: "s2", category: "site_analytics" },
    { id: "a3", category: "advertising" }
  ];
  const set = (patch) => {
    const drawn = [];
    const m = f(page, drawn);
    m.applySettings(Object.assign({}, m.DEFAULTS, patch));
    return { slots: drawn, mounted: () => drawn.length, DEFAULTS: m.DEFAULTS };
  };

  ok("both categories show by default",
     set({}).mounted() === 5, `${set({}).mounted()} of 5`);
  ok("hiding advertising leaves only the analytics cameras",
     set({ showAds: false }).mounted() === 2);
  ok("hiding analytics leaves only the advertising cameras",
     set({ showAds: true, showAnalytics: false }).mounted() === 3);
  ok("a hidden category closes its gaps instead of stranding holes",
     (() => {
       const s = set({ showAds: false }).slots;
       return s.every((v, i) => v === i);
     })(), `analytics-only slots: [${set({ showAds: false }).slots}]`);
  ok("hiding both leaves nothing drawn",
     set({ showAds: false, showAnalytics: false }).mounted() === 0);
  ok("a per-site switch beats the category switches",
     set({ disabledSites: ["example.com"] }).mounted() === 0);
  ok("the global switch beats everything",
     set({ off: true }).mounted() === 0);
  ok("categories default to on, so an upgrade does not hide anything",
     set({}).DEFAULTS.showAds === true && set({}).DEFAULTS.showAnalytics === true);
}

console.log("\n--- detail budget");
{
  const src = fs.readFileSync("src/content.js", "utf8");
  const seg = new Function(
    slice("  var SEGMENTS ", "  var ARM_R") +
    slice("  function segmentsFor", "  function buildHead") +
    "\nreturn { segmentsFor, ribsFor, SEGMENTS, SEGMENTS_FAR, DETAIL_SLOTS," +
    " RIBS, RIBS_FAR };")();
  ok("the first column keeps the full-detail barrel",
     seg.segmentsFor(0) === seg.SEGMENTS &&
     seg.segmentsFor(seg.DETAIL_SLOTS - 1) === seg.SEGMENTS,
     `slots 0..${seg.DETAIL_SLOTS - 1} at ${seg.SEGMENTS} faces`);
  ok("cameras past it drop to a coarser shell",
     seg.segmentsFor(seg.DETAIL_SLOTS) === seg.SEGMENTS_FAR &&
     seg.SEGMENTS_FAR < seg.SEGMENTS,
     `slot ${seg.DETAIL_SLOTS}+ at ${seg.SEGMENTS_FAR} faces`);
  ok("a coarse barrel is still a closed cylinder",
     seg.SEGMENTS_FAR >= 8, `${seg.SEGMENTS_FAR} faces`);
  ok("the knurl thins out on the same budget as the shell",
     seg.ribsFor(0) === seg.RIBS && seg.ribsFor(seg.DETAIL_SLOTS) === seg.RIBS_FAR &&
     seg.RIBS_FAR < seg.RIBS, `${seg.RIBS} ribs up close, ${seg.RIBS_FAR} past it`);
  ok("a far camera still has enough ribs for a turn to read",
     seg.RIBS_FAR >= 6, `${seg.RIBS_FAR} ribs`);
}

console.log("\n--- dns hints are not evidence");
{
  const src = fs.readFileSync("src/content.js", "utf8");
  const HINT = new Function("return " + (src.match(/var HINT_REL = (\/.*?\/i);/) || [])[1])();
  ok("dns-prefetch and preconnect are ignored",
     HINT.test("dns-prefetch") && HINT.test("preconnect") &&
     HINT.test("dns-prefetch preconnect"),
     "a hint warms a connection; it is not a request");
  ok("preload and prefetch still count — those actually fetch",
     !HINT.test("preload") && !HINT.test("prefetch") && !HINT.test("stylesheet") &&
     !HINT.test("icon") && !HINT.test("canonical"));
  ok("the sweep consults rel before reading a link's href",
     /HINT_REL\.test\(rel\)\) continue;/.test(src));
}

console.log("\n--- monogram fallback");
{
  const i = mono.initials;
  ok("two words abbreviate to their initials",
     i("Index Exchange") === "IE", `Index Exchange -> ${i("Index Exchange")}`);
  ok("filler words are skipped so the brand survives",
     i("Yahoo! Japan Retargeting") === "YJ" && i("Criteo Advertising") === "CR",
     `${i("Yahoo! Japan Retargeting")} / ${i("Criteo Advertising")}`);
  ok("an internal capital marks the second letter",
     i("PubMatic") === "PM" && i("TripleLift") === "TL",
     `${i("PubMatic")} / ${i("TripleLift")}`);
  ok("a plain single word takes its first two letters",
     i("Criteo") === "CR", `Criteo -> ${i("Criteo")}`);
  ok("a one-character name is not doubled",
     i("X Advertising") === "X", `X Advertising -> ${i("X Advertising")}`);
  ok("an all-filler name still yields something",
     /^[A-Z0-9?]{1,2}$/.test(i("Ads")) && /^[A-Z0-9?]{1,2}$/.test(i("")),
     `Ads -> ${i("Ads")}, empty -> ${i("")}`);
  ok("every registry name produces a clean 1-2 char monogram",
     Object.values(registry.T).every((t) => /^[A-Z0-9]{1,2}$/.test(i(t.n))),
     (() => {
       const bad = Object.values(registry.T).filter((t) => !/^[A-Z0-9]{1,2}$/.test(i(t.n)));
       return bad.length ? bad.slice(0, 3).map((t) => `${t.n} -> ${i(t.n)}`).join(", ")
                         : "all 498";
     })());
  ok("hues are stable and spread across the wheel",
     mono.hueFor("criteo") === mono.hueFor("criteo") &&
     new Set(Object.keys(registry.T).map(mono.hueFor)).size > 200,
     `${new Set(Object.keys(registry.T).map(mono.hueFor)).size} distinct hues over 498 ids`);
  // icons/brands/ is not committed — the logos are fetched at build time by
  // tools/fetch-logos.mjs — so this cannot assert the files are on disk. It
  // asserts the shape instead. tools/package.mjs is what refuses to build a
  // zip with a mark missing from it; a missing file at runtime falls back to
  // a monogram, so a repository without the build is degraded, not broken.
  const branded = JSON.parse(fs.readFileSync("src/brands.js", "utf8")
    .split("window.__cpBrands = ")[1].replace(/;\s*$/, ""));
  ok("every branded company has a mark that will actually render",
     Object.entries(branded).every(([id, v]) =>
       v.mark && v.band && Array.isArray(v.palette) && v.palette.length &&
       (v.mark.startsWith("<svg") || /^icons\/brands\/[a-z0-9_.~-]+\.png$/.test(v.mark))),
     (() => {
       const bad = Object.entries(branded).filter(([, v]) =>
         !(v.mark && v.band && Array.isArray(v.palette) && v.palette.length &&
           (v.mark.startsWith("<svg") || /^icons\/brands\/[a-z0-9_.~-]+\.png$/.test(v.mark))));
       return bad.length ? bad.slice(0, 3).map(([id]) => id).join(", ") : "all branded";
     })());
  {
    const paths = Object.values(branded)
      .filter((v) => typeof v.mark === "string" && v.mark.startsWith("icons/"))
      .map((v) => v.mark);
    const have = paths.filter((p) => fs.existsSync(p)).length;
    console.log(have === paths.length
      ? `INFO  all ${paths.length} logo files present`
      : `INFO  ${have}/${paths.length} logo files present — the rest render as ` +
        `monograms until "node tools/fetch-logos.mjs" is run`);
  }
  ok("the generated mark is inert drawing markup",
     Object.keys(registry.T).every((id) => {
       const mk = mono.monogramBrand(id, registry.T[id].n).mark;
       return mk.startsWith("<svg") && !/[<>]/.test(mono.initials(registry.T[id].n));
     }));
  ok("band stops cover the band exactly, whatever the palette length",
     [1, 2, 3, 4, 5].every((n) => {
       const stops = mono.bandStops(new Array(n).fill("#000"));
       return stops.split(",").length === n && stops.includes("44.00%");
     }));
}

console.log("");
ok("the up/down switch has hysteresis", m.UP_ENTER > m.UP_EXIT,
   `enters up at ${m.UP_ENTER}deg, leaves at ${m.UP_EXIT}deg`);
ok("slots are distinct", m.SLOT_GAP > 0, `SLOT_GAP ${m.SLOT_GAP}px`);
console.log(`INFO  neighbours overlap by ${(maxDown + maxUp - m.SLOT_GAP).toFixed(0)}px ` +
            `worst case (span ${(maxDown + maxUp).toFixed(0)}px, pitch ${m.SLOT_GAP}px)`);

console.log(`\nINFO  clamped region: ${(100 * clamped / total).toFixed(1)}% of viewport`);
process.exit(fails ? 1 : 0);
