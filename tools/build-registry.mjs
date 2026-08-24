// Joins data/wtm.json against Ghostery's TrackerDB to produce the domain table
// Creepy Peeper ships, then emits both a full record set for the other tools
// and a minimal runtime payload for the extension.
//
// TrackerDB is CC-BY-NC-SA-4.0 — see the attribution note in README.md.
//
//   data/wtm.json  +  trackerdb db/patterns/<slug>.eno
//     -> data/registry.json   full records (name, org, website_url, domains)
//     -> src/registry.js      window.__cpRegistry = { D: host->id, T: id->meta }
import {
  writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARBALL = "https://codeload.github.com/ghostery/trackerdb/tar.gz/refs/heads/main";

// --------------------------------------------------------------- eno parsing
//
// TrackerDB's .eno files use a small slice of the eno format: `key: value`
// lines at the top level, and named blocks fenced by a repeated `--- name`
// marker. That is all we read, so a full enolib dependency would be overkill.
function parseEno(text) {
  const out = { fields: {}, blocks: {} };
  const lines = text.split("\n");
  let block = null;
  for (const line of lines) {
    const fence = line.match(/^---\s+(\S+)\s*$/);
    if (fence) {
      block = block === fence[1] ? null : fence[1];
      if (block) out.blocks[block] = [];
      continue;
    }
    if (block !== null) {
      const v = line.trim();
      if (v) out.blocks[block].push(v);
      continue;
    }
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (field) out.fields[field[1]] = field[2].trim();
  }
  return out;
}

// ------------------------------------------------------------------- sources
async function trackerdb() {
  const local = process.env.TRACKERDB;
  if (local) {
    if (!existsSync(join(local, "db/patterns")))
      throw new Error(`TRACKERDB=${local} has no db/patterns`);
    return local;
  }
  const dir = join(tmpdir(), "creepy-peeper-trackerdb");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, "trackerdb.tar.gz");
  const buf = await fetch(TARBALL).then((r) => {
    if (!r.ok) throw new Error(`${TARBALL} -> HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  writeFileSync(tgz, Buffer.from(buf));
  execFileSync("tar", ["xzf", tgz, "-C", dir]);
  return join(dir, "trackerdb-main");
}

// ---------------------------------------------------------------------- join
const wtm = JSON.parse(readFileSync(join(ROOT, "data/wtm.json"), "utf8"));
const excludeFile = JSON.parse(readFileSync(join(ROOT, "data/exclude.json"), "utf8"));
const exclude = excludeFile.trackers || {};
const excludeDomains = excludeFile.domains || {};
const names = JSON.parse(readFileSync(join(ROOT, "data/names.json"), "utf8"));
const db = await trackerdb();
console.log(`trackerdb: ${db}`);

// Organization display names, so a camera can be labelled "Adobe" rather than
// carrying the slug "adobe" or one product's name.
const orgNames = {};
for (const f of readdirSync(join(db, "db/organizations"))) {
  if (!f.endsWith(".eno")) continue;
  const { fields } = parseEno(readFileSync(join(db, "db/organizations", f), "utf8"));
  if (fields.name) orgNames[f.slice(0, -4)] = fields.name;
}

const records = [];
const missing = [];
for (const row of wtm) {
  if (exclude[row.slug]) continue;
  const file = join(db, "db/patterns", row.slug + ".eno");
  if (!existsSync(file)) {
    missing.push(row.slug);
    continue;
  }
  const { fields, blocks } = parseEno(readFileSync(file, "utf8"));
  records.push({
    id: row.slug,
    name: row.name,
    category: row.category,
    reach: row.reach,
    rank: row.rank,
    organization: fields.organization || "",
    website_url: fields.website_url || "",
    domains: (blocks.domains || []).filter((d) => !excludeDomains[d])
  });
}

// A slug that stops resolving means Ghostery renamed or retired a tracker, and
// silently dropping it would quietly shrink our coverage. Make it loud.
if (missing.length) {
  throw new Error(
    `${missing.length} of ${wtm.length} slugs missing from trackerdb: ` +
      missing.slice(0, 12).join(", ")
  );
}

// ------------------------------------------------------------------- outputs
//
// Cameras are per *company*, not per tracker product. Google alone ships nine
// trackers in this set and Microsoft six; nine Google cameras says nothing that
// one does not, and it buries every other company on the page. So the runtime
// table is keyed by organization, and a company's tracker products collapse
// into one entry.
//
// The 23 patterns TrackerDB has no organization for stand alone under their own
// id, prefixed so they can never collide with a real organization slug.
const orgOf = (r) => (r.organization ? r.organization : "~" + r.id);

// TrackerDB records the legal entity, so a third of these read "Sharethrough,
// Inc" or "PulsePoint, Inc.". The suffix carries nothing a person needs on a
// camera. data/names.json handles the cases where the whole name is wrong.
const tidy = (name) =>
  String(name)
    .replace(/[,\s]+\b(Inc|LLC|L\.L\.C|Ltd|Limited|GmbH|S\.?A\.?S?|B\.?V|A\/S|AB|Oy|Pty|PLC|Corp|Corporation|Co)\b\.?$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const groups = new Map();
for (const r of records) {
  const key = orgOf(r);
  let g = groups.get(key);
  if (!g) {
    g = {
      key,
      name: names[key] || tidy(orgNames[r.organization] || r.name),
      members: [],
      domains: []
    };
    groups.set(key, g);
  }
  g.members.push(r);
  g.domains.push(...r.domains);
}

for (const g of groups.values()) {
  // Reach is a share of page loads, and a company's products co-occur on the
  // same pages, so summing them would overcount badly. The most widespread
  // product is the honest figure for how often you meet this company.
  const lead = g.members.reduce((a, b) => (b.reach > a.reach ? b : a));
  g.reach = lead.reach;
  // Advertising wins a tie: it is the stronger claim about what the company is
  // doing, and a company that does both is an advertiser that also measures.
  g.category = g.members.some((m) => m.category === "advertising")
    ? "advertising"
    : "site_analytics";
}

const D = {};
const collisions = [];
for (const g of groups.values()) {
  for (const d of g.domains) {
    if (D[d] && D[d] !== g.key) collisions.push(`${d}: ${D[d]} vs ${g.key}`);
    D[d] = g.key;
  }
}
if (collisions.length) {
  console.warn(`warning: ${collisions.length} domain collisions`);
  for (const c of collisions.slice(0, 10)) console.warn(`  ${c}`);
}

const T = {};
for (const g of [...groups.values()].sort((a, b) => b.reach - a.reach)) {
  // Reach only orders the curation batches; five decimals is far more
  // precision than that needs, and the raw floats cost ~9 KB of bundle.
  T[g.key] = {
    n: g.name,
    c: g.category === "advertising" ? "a" : "s",
    r: Number(g.reach.toFixed(5))
  };
}

writeFileSync(
  join(ROOT, "data/registry.json"),
  JSON.stringify(
    [...groups.values()]
      .sort((a, b) => b.reach - a.reach)
      .map((g, i) => ({
        id: g.key,
        name: g.name,
        category: g.category,
        reach: g.reach,
        rank: i + 1,
        website_url: g.members[0].website_url,
        products: g.members.map((m) => m.name),
        domains: g.domains
      })),
    null,
    1
  ) + "\n"
);

const payload = JSON.stringify({ D, T });
writeFileSync(
  join(ROOT, "src/registry.js"),
  "// GENERATED by tools/build-registry.mjs — do not edit.\n" +
    "//\n" +
    "// Tracker domains and metadata derived from Ghostery's TrackerDB\n" +
    "// (https://github.com/ghostery/trackerdb, CC-BY-NC-SA-4.0) filtered to the\n" +
    "// advertising and site-analytics trackers listed on WhoTracks.me.\n" +
    "//\n" +
    "//   D: domain -> tracker id        T: tracker id -> { n: name, c: category, r: reach }\n" +
    "window.__cpRegistry = " +
    payload +
    ";\n"
);

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(
  `data/registry.json: ${groups.size} companies behind ${records.length} trackers` +
    ` (${Object.keys(exclude).length} tracker(s) and ` +
    `${Object.keys(excludeDomains).length} domain(s) excluded)` +
    `\nsrc/registry.js:    ${Object.keys(D).length} domains, ${kb(payload.length)}`
);
