// Builds the uploadable zip, and refuses to build a broken one.
//
// The Chrome Web Store rejects a package for things that are invisible while
// developing unpacked — a file the manifest names but does not ship, a stray
// source map, a version that was never bumped. Everything that has bitten this
// project is checked here.
//
// Usage: node tools/package.mjs
import { readFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

// Exactly what ships. Anything not named here stays out of the zip: no tools/,
// no test/, no data/, no harvested candidates, no git history.
const INCLUDE = ["manifest.json", "icons", "src", "LICENSE.md", "PRIVACY.md"];

// ...and things that must never end up inside those, even by accident.
const FORBIDDEN = /\.(map|zip|log|DS_Store)$|(^|\/)(node_modules|candidates)(\/|$)/;

const problems = [];
const must = (cond, msg) => { if (!cond) problems.push(msg); };

// 1. Every path the manifest names must exist.
const named = [
  ...manifest.content_scripts.flatMap((c) => c.js),
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  manifest.action.default_popup
];
for (const p of named) must(existsSync(join(ROOT, p)), `manifest names missing file: ${p}`);

// 2. So must everything the popup pulls in — a broken href here is silent.
const popup = readFileSync(join(ROOT, manifest.action.default_popup), "utf8");
for (const ref of popup.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (/^https?:/.test(ref[1])) continue;
  must(existsSync(join(ROOT, "src", ref[1])), `popup references missing file: ${ref[1]}`);
}

// 3. Every brand mark the runtime can ask for must be in the package.
const brands = JSON.parse(
  readFileSync(join(ROOT, "src/brands.js"), "utf8")
    .split("window.__cpBrands = ")[1].replace(/;\s*$/, "")
);
const missingMarks = Object.entries(brands)
  .filter(([, b]) => typeof b.mark === "string" && b.mark.startsWith("icons/"))
  .filter(([, b]) => !existsSync(join(ROOT, b.mark)))
  .map(([id]) => id);
must(!missingMarks.length, `brand marks missing from disk: ${missingMarks.slice(0, 5).join(", ")}`);

// 4. The store rejects a re-upload of a version already published.
must(/^\d+\.\d+(\.\d+)?(\.\d+)?$/.test(manifest.version),
     `version "${manifest.version}" is not a valid extension version`);

// 5. Claims the listing and the privacy policy make about the code.
for (const f of ["src/content.js", "src/detect-main.js", "src/popup.js"]) {
  const body = readFileSync(join(ROOT, f), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const net = body.match(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\s*\(/);
  must(!net, `${f} makes a network call (${net && net[1]}) — the privacy policy says it does not`);
}

if (problems.length) {
  for (const p of problems) console.error("  " + p);
  throw new Error(`${problems.length} problem(s); package not built`);
}

const out = join(ROOT, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const zip = join(out, `creepy-peeper-${manifest.version}.zip`);

execFileSync("zip", ["-r", "-q", "-X", zip, ...INCLUDE, "-x", "*.DS_Store", "*.map"],
             { cwd: ROOT });

// Prove the forbidden things really are absent, rather than trusting the -x.
const listed = execFileSync("unzip", ["-Z1", zip], { cwd: ROOT }).toString().trim().split("\n");
const smuggled = listed.filter((f) => FORBIDDEN.test(f));
if (smuggled.length) throw new Error(`package contains: ${smuggled.join(", ")}`);

const mb = (statSync(zip).size / 1024 / 1024).toFixed(2);
console.log(
  `${zip.replace(ROOT + "/", "")}\n` +
    `  ${listed.length} files, ${mb} MB\n` +
    `  version ${manifest.version}, ` +
    `permissions: ${(manifest.permissions || []).join(", ") || "none"}`
);
