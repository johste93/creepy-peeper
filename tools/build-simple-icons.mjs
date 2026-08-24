// Pulls official brand marks and colours from Simple Icons for the companies it
// covers, into data/simple-icons.json.
//
// This outranks the harvested favicons (tools/build-decals.py) for two reasons:
// the hex is the brand's published colour rather than one guessed from pixels,
// and the artwork is a single clean path drawn to read at icon size — which is
// exactly what a 22px decal on a curved barrel needs.
//
// Coverage is only ~14%: Simple Icons has removed many large brands (Microsoft,
// Adobe, Amazon, Criteo, Taboola, Yandex) after trademark complaints, so the
// favicon harvest and hand curation still carry most of the table.
//
// Simple Icons is CC0; the marks themselves remain their owners' trademarks and
// are used here only to identify the company doing the tracking.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = "https://raw.githubusercontent.com/simple-icons/simple-icons/master/data/simple-icons.json";
const ICON = (slug) =>
  `https://raw.githubusercontent.com/simple-icons/simple-icons/master/icons/${slug}.svg`;

// Simple Icons' own slug rules, enough of them for our matching.
const slugify = (title) =>
  title
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/\./g, "dot")
    .replace(/&/g, "and")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The floor tools/build-brands.mjs enforces, with headroom so a band that
// lands on the line cannot fail the build on a rounding difference.
const MIN_CONTRAST = 0.38;
const rel = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const toRgb = (hex) =>
  [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255);
const toHex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

function rgbToHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0))
          : mx === g ? (b - r) / d + 2
          : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// HSL lightness is not luminance — a yellow at lightness 0.3 still reads bright
// — so bisect on lightness against the luminance the contrast rule uses.
function readableBand(hex) {
  const rgb = toRgb(hex);
  if (1 - rel(rgb) >= MIN_CONTRAST) return hex.toUpperCase();
  const [h, s] = rgbToHsl(rgb);
  const target = 1 - MIN_CONTRAST - 0.06;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (rel(hslToRgb([h, Math.max(s, 0.42), mid])) < target) lo = mid;
    else hi = mid;
  }
  return toHex(hslToRgb([h, Math.max(s, 0.42), (lo + hi) / 2]));
}

const registry = JSON.parse(readFileSync(join(ROOT, "data/registry.json"), "utf8"));
const raw = await fetch(DATA).then((r) => r.json());
const icons = Array.isArray(raw) ? raw : raw.icons;

const index = new Map();
for (const i of icons) {
  const add = (k) => { if (k && !index.has(k)) index.set(k, i); };
  add(norm(i.title));
  for (const a of (i.aliases || {}).aka || []) add(norm(a));
}

// Trailing words that say what a product does rather than who makes it.
const STRIP = /\s*\b(inc|llc|ltd|limited|gmbh|sa|sas|bv|ab|oy|corp|corporation|company|co|technologies|technology|software|solutions|group|media|labs|holdings)\b\.?/gi;

const wanted = [];
for (const r of registry) {
  const cands = [r.name, r.name.replace(STRIP, "").trim(), r.id.replace(/^~/, "")];
  for (const c of cands) {
    const hit = index.get(norm(c));
    if (hit) { wanted.push({ id: r.id, name: r.name, icon: hit }); break; }
  }
}

const out = {};
const failed = [];
for (let i = 0; i < wanted.length; i += 8) {
  await Promise.all(
    wanted.slice(i, i + 8).map(async ({ id, name, icon }) => {
      const slug = icon.slug || slugify(icon.title);
      const svg = await fetch(ICON(slug)).then((r) => (r.ok ? r.text() : null));
      if (!svg) { failed.push(`${id} (${slug})`); return; }
      const path = (svg.match(/\sd="([^"]+)"/) || [])[1];
      if (!path) { failed.push(`${id}: no path`); return; }
      // A Simple Icon is a silhouette, printed white. Some official brand
      // colours are bright enough that white would barely read on them — New
      // Relic's green, Airbrake's orange — so darken those until it does,
      // keeping the hue. Same contrast floor tools/build-decals.py uses.
      const band = readableBand("#" + icon.hex);
      // A single-path Simple Icon is a silhouette, so print it white on the
      // brand colour — the same treatment a real camera's decal would get.
      out[id] = {
        band,
        palette: [band],
        mark:
          '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
          `<path fill="#fff" d="${path}"/></svg>`,
        decalW: 20,
        decalH: 20,
        plate: "",
        src: `simple-icons/${slug}`
      };
    })
  );
}

writeFileSync(join(ROOT, "data/simple-icons.json"), JSON.stringify(out, null, 1) + "\n");
console.log(
  `data/simple-icons.json: ${Object.keys(out).length} of ${registry.length} ` +
    `companies matched (${((Object.keys(out).length / registry.length) * 100).toFixed(0)}%)`
);
if (failed.length) console.log(`  ${failed.length} failed: ${failed.slice(0, 8).join(", ")}`);
