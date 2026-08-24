// Pulls logo and brand-colour candidates for review, into data/candidates/.
//
// Nothing here writes data/brands.json — that stays hand-edited. This only
// gathers raw material so the curation pass is "look and accept or redraw"
// rather than "go find 444 logos".
//
// Per company we try, in order of how well it survives being shrunk onto a
// 22x18px decal on a curved barrel:
//
//   1. an SVG icon (scales perfectly, often a clean single-colour mark)
//   2. apple-touch-icon (usually 180px and purpose-drawn, no browser chrome)
//   3. the largest <link rel=icon> raster
//   4. /favicon.ico as a last resort
//
// plus <meta name="theme-color">, which is the brand colour when a site sets it.
//
// Usage: node tools/harvest-brands.mjs [--batch N] [--size 40] [--force]
import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/candidates");

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i > -1 ? process.argv[i + 1] : d;
};
const BATCH = Number(arg("batch", 1));
const SIZE = Number(arg("size", 40));
const FORCE = process.argv.includes("--force");
const TIMEOUT = 12000;

const registry = JSON.parse(readFileSync(join(ROOT, "data/registry.json"), "utf8"));

// TrackerDB's website_url points at whatever page documents the tracker, which
// is often a dead product page or a redirect with no branding on it. data/sites.json
// carries hand-checked homepages for the ones that matter.
const sites = JSON.parse(readFileSync(join(ROOT, "data/sites.json"), "utf8"));

// --only id,id,id harvests just these, for re-checking a company after fixing
// its URL rather than re-running a whole batch.
const only = (arg("only", "") || "").split(",").filter(Boolean);
const slice = only.length
  ? registry.filter((r) => only.includes(r.id))
  : registry.slice((BATCH - 1) * SIZE, BATCH * SIZE);
if (!slice.length) {
  throw new Error(
    only.length ? `no company matched --only ${only.join(",")}`
                : `batch ${BATCH} is past the end of the registry`
  );
}

mkdirSync(OUT, { recursive: true });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function get(url, as = "text") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "*/*" }
    });
    if (!r.ok) return null;
    return {
      url: r.url,
      type: r.headers.get("content-type") || "",
      body: as === "text" ? await r.text() : Buffer.from(await r.arrayBuffer())
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// <link rel="... icon ..."> with its sizes and type, in document order.
function icons(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (tag.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || "";
    if (!/\bicon\b/i.test(rel)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)/i) || [])[1];
    if (!href) continue;
    const sizes = (tag.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1];
    const type = (tag.match(/\btype\s*=\s*["']([^"']+)/i) || [])[1] || "";
    let abs;
    try { abs = new URL(href, base).href; } catch (e) { continue; }
    out.push({
      url: abs,
      px: Number(sizes) || 0,
      svg: /svg/i.test(type) || /\.svg(\?|$)/i.test(abs),
      apple: /apple-touch/i.test(rel)
    });
  }
  // SVG first, then Apple touch icons, then biggest raster.
  return out.sort((a, b) =>
    (b.svg - a.svg) || (b.apple - a.apple) || (b.px - a.px)
  );
}

const themeColor = (html) =>
  (html.match(/<meta\b[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)/i) ||
   html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']theme-color["']/i) ||
   [])[1] || null;

async function harvest(entry) {
  const site = sites[entry.id] || entry.website_url;
  const row = { id: entry.id, name: entry.name, rank: entry.rank, site, ok: false };
  if (!site) { row.why = "no website_url in trackerdb"; return row; }

  const page = await get(site);
  if (!page) { row.why = "site unreachable"; return row; }
  row.themeColor = themeColor(page.body);

  const list = icons(page.body, page.url);
  try { list.push({ url: new URL("/favicon.ico", page.url).href, px: 0, svg: false }); }
  catch (e) { /* malformed base */ }

  for (const cand of list.slice(0, 5)) {
    const got = await get(cand.url, "bin");
    if (!got || !got.body.length || got.body.length > 512 * 1024) continue;
    const isSvg = cand.svg || /svg/i.test(got.type) ||
                  got.body.slice(0, 400).toString("utf8").includes("<svg");
    const ext = isSvg ? "svg" : (got.type.match(/image\/(png|jpeg|webp|x-icon|vnd\.microsoft\.icon)/) ?
                 { png: "png", jpeg: "jpg", webp: "webp", "x-icon": "ico",
                   "vnd.microsoft.icon": "ico" }[RegExp.$1] : "ico");
    const dir = join(OUT, entry.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "icon." + ext), got.body);
    row.icon = "icon." + ext;
    row.iconUrl = got.url;
    row.bytes = got.body.length;
    row.ok = true;
    return row;
  }
  row.why = "no usable icon";
  return row;
}

// Politely serial-ish: six at a time is enough to finish a batch in seconds
// without hammering anyone.
const results = [];
for (let i = 0; i < slice.length; i += 6) {
  const chunk = slice.slice(i, i + 6);
  results.push(...(await Promise.all(chunk.map(harvest))));
  process.stdout.write(`\r  harvested ${results.length}/${slice.length}`);
}
process.stdout.write("\n");

// A targeted re-harvest patches the batch files it touches rather than writing
// a batch of its own, so the batch set stays a complete picture of the registry.
if (only.length) {
  for (const f of readdirSync(OUT).filter((n) => /^batch-\d+\.json$/.test(n))) {
    const path = join(OUT, f);
    const rows = JSON.parse(readFileSync(path, "utf8"));
    let touched = false;
    for (let i = 0; i < rows.length; i++) {
      const fresh = results.find((r) => r.id === rows[i].id);
      if (fresh) { rows[i] = fresh; touched = true; }
    }
    if (touched) writeFileSync(path, JSON.stringify(rows, null, 1) + "\n");
  }
  console.log(`patched ${results.length} row(s) into their batch files`);
}

const file = join(OUT, `batch-${BATCH}.json`);
if (only.length) {
  // handled above
} else if (existsSync(file) && !FORCE) {
  console.log(`${file} exists; re-run with --force to overwrite`);
} else {
  writeFileSync(file, JSON.stringify(results, null, 1) + "\n");
}

const got = results.filter((r) => r.ok);
console.log(
  `batch ${BATCH}: ${got.length}/${results.length} icons, ` +
    `${got.filter((r) => r.icon.endsWith(".svg")).length} of them SVG, ` +
    `${results.filter((r) => r.themeColor).length} theme-colors`
);
for (const r of results.filter((x) => !x.ok)) console.log(`  miss  ${r.id} — ${r.why}`);
