// Downloads the logo artwork that this repository deliberately does not carry.
//
// icons/brands/ holds 265 company logos. They are trademarks, and the PNGs are
// byte copies of artwork served from each company's own CDN, so redistributing
// them from this repository would be a reproduction of someone else's work
// rather than the nominative use that the extension itself relies on. They are
// therefore gitignored, and fetched from the source instead.
//
// data/decals.json IS committed. It records, per company, the URL its icon came
// from and the colours measured out of it. A URL is not a copy, and a hex value
// read off a pixel is a fact about the icon rather than the icon itself, so the
// manifest can live here even though the artwork cannot.
//
// Usage: node tools/fetch-logos.mjs [--force] [--only id,id]
//        python3 tools/build-decals.py --restore
//
// Whatever fails to download simply stays absent: content.js falls back to a
// monogram for any company whose file is missing, so a partial fetch degrades
// instead of breaking.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAND = join(ROOT, "data/candidates");
const TIMEOUT = 15000;
const PARALLEL = 8;

const FORCE = process.argv.includes("--force");
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(",")) : null;

const decals = JSON.parse(readFileSync(join(ROOT, "data/decals.json"), "utf8"));

// Content-type is more trustworthy than the URL here: plenty of these are
// served as ".ico" but are really PNG, and build-decals.py opens by content
// anyway. The extension only decides the cache filename.
const EXT = {
  "image/png": "png", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
  "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/svg+xml": "svg"
};

function cached(id) {
  const dir = join(CAND, id);
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f.startsWith("restore."));
  return hit || null;
}

async function grab(id, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      // Some CDNs serve a 403 to a bare fetch. This is the same request a
      // browser showing the company's own site would make.
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*" }
    });
    if (!res.ok) return { err: "HTTP " + res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { err: "empty response" };
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    const ext = EXT[type] || url.split("?")[0].split(".").pop().toLowerCase().slice(0, 4) || "img";
    const dir = join(CAND, id);
    mkdirSync(dir, { recursive: true });
    const name = "restore." + ext;
    writeFileSync(join(dir, name), buf);
    return { name, bytes: buf.length };
  } catch (e) {
    return { err: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

const jobs = Object.entries(decals).filter(([id]) => !ONLY || ONLY.has(id));
const rows = [];
const failed = [];
let done = 0;

async function worker(queue) {
  for (;;) {
    const job = queue.shift();
    if (!job) return;
    const [id, d] = job;
    let name = FORCE ? null : cached(id);
    if (name) {
      rows.push({ id, png: name, iconUrl: d.src });
    } else {
      const r = await grab(id, d.src);
      if (r.err) failed.push([id, r.err]);
      else rows.push({ id, png: r.name, iconUrl: d.src });
    }
    done++;
    if (done % 25 === 0) process.stderr.write(`  ${done}/${jobs.length}\n`);
  }
}

const queue = jobs.slice();
console.error(`fetching ${jobs.length} logos into data/candidates/ ...`);
await Promise.all(Array.from({ length: PARALLEL }, () => worker(queue)));

rows.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(CAND, "restore.json"), JSON.stringify(rows, null, 1));

console.error(`\n${rows.length} of ${jobs.length} fetched -> data/candidates/restore.json`);
if (failed.length) {
  console.error(`${failed.length} unavailable (these companies fall back to a monogram):`);
  for (const [id, why] of failed.slice(0, 40)) console.error(`  ${id}: ${why}`);
  if (failed.length > 40) console.error(`  ... and ${failed.length - 40} more`);
}
console.error("\nnext: python3 tools/build-decals.py --restore");
