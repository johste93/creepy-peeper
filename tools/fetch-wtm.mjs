// Scrapes Ghostery's WhoTracks.me tracker index into data/wtm.json.
//
// Every row on that page is one anchor carrying the slug in its href plus the
// three fields we care about as data attributes:
//
//   <a href="/whotracksme/trackers/google_tag" data-category="Advertising"
//      data-order="0" data-reach="0.3804846694874094"> … Google Tag … </a>
//
// We keep only Advertising and Site Analytics, which is what Creepy Peeper
// reports on, and sort by reach so the brand-curation batches run in the order
// people actually meet these trackers.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = "https://www.ghostery.com/whotracksme/trackers";
const KEEP = { Advertising: "advertising", "Site Analytics": "site_analytics" };

const ROW =
  /<a\s+[^>]*?href="\/whotracksme\/trackers\/([^"]+)"([\s\S]*?)<\/a>/g;
const attr = (s, k) => (s.match(new RegExp(`data-${k}="([^"]*)"`)) || [])[1];

// The display name is the only .ds-body-m div inside the anchor.
const NAME = /<div class="ds-body-m[^"]*">\s*([\s\S]*?)\s*<\/div>/;

const html = await fetch(URL_, {
  headers: { "user-agent": "creepy-peeper build script" }
}).then((r) => {
  if (!r.ok) throw new Error(`${URL_} -> HTTP ${r.status}`);
  return r.text();
});

const all = [];
const seen = new Set();
for (const m of html.matchAll(ROW)) {
  const [, slug, body] = m;
  if (seen.has(slug)) continue;
  seen.add(slug);
  const category = attr(body, "category");
  const reach = Number(attr(body, "reach"));
  const order = Number(attr(body, "order"));
  const name = (body.match(NAME) || [])[1];
  if (category === undefined || !name) continue;
  all.push({ slug, name: name.trim(), category, reach, order });
}

if (all.length < 500) {
  throw new Error(
    `parsed only ${all.length} rows — the page markup probably changed`
  );
}

const rows = all
  .filter((r) => KEEP[r.category])
  .sort((a, b) => b.reach - a.reach)
  .map((r, i) => ({
    slug: r.slug,
    name: r.name,
    category: KEEP[r.category],
    reach: r.reach,
    rank: i + 1
  }));

mkdirSync(join(ROOT, "data"), { recursive: true });
writeFileSync(join(ROOT, "data/wtm.json"), JSON.stringify(rows, null, 1) + "\n");

const ads = rows.filter((r) => r.category === "advertising").length;
console.log(
  `data/wtm.json: ${rows.length} of ${all.length} trackers ` +
    `(${ads} advertising, ${rows.length - ads} site analytics)`
);
