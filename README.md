# Creepy Peeper

Creepy Peeper is a Chrome extension that shows a surveillance camera for every advertising or analytics company it detects on the page you’re visiting. Each camera uses the company’s logo and follows your mouse pointer as you move around the page.

The effect is intentionally uncomfortable. Tracking is usually invisible; Creepy Peeper makes it difficult to ignore.

- 444 companies from Ghostery’s WhoTracks.me advertising and analytics tracker index.
- One camera per company, using its logo and brand colour where available.
- Doesn’t get in the way. Cameras don’t intercept clicks and fade when the pointer gets close.
- No network access. The extension makes no requests of its own, collects no data, and sends nothing anywhere. See [PRIVACY.md](PRIVACY.md).

## Install

Creepy Peeper isn’t on the Chrome Web Store yet. To install it locally:

1. `git clone` this repository.
2. Fetch the logos: `node tools/fetch-logos.mjs && python3 tools/build-decals.py --restore`
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click Load unpacked and select the repository folder.

Step 2 needs Node 18+, Python 3 with [Pillow](https://pillow.readthedocs.io/),
and `rsvg-convert` (from librsvg) for the logos published as SVG. It takes about
a minute and downloads roughly 250 KB.

**You can skip it.** The extension works without the logos — every company it
can’t illustrate gets a monogram instead, and detection is unaffected. It’s the
same fallback used for the 128 companies that have no usable logo at all.

### Why the logos aren’t in the repository

Company logos are trademarks, and the image files are copies of artwork served
from each company’s own site. Displaying one to name the company running a
tracker is nominative use, which is the whole point of the extension; keeping
265 copies of other people’s artwork in a public repository is a different thing
and not one this project needs to do.

So `icons/brands/` is gitignored. What is committed is
[`data/decals.json`](data/decals.json), which records the URL each logo came
from and the colours measured out of it. The build step downloads from those
URLs and reproduces the files locally. See [LICENSE.md](LICENSE.md).

## Using it

Cameras appear as trackers are detected. They stack down the right side of the page and wrap into additional columns when necessary. Seeing fifteen or twenty on a news site isn’t unusual.

The toolbar button opens a list of every company detected on the current page. From there, cameras can be hidden for the current site, hidden everywhere, or filtered by category. Advertising and analytics can be toggled independently.

These controls only affect what is displayed. Detection continues in the background so the company list remains accurate even when all cameras are hidden.

Settings are stored locally on your device.

## How it decides

Creepy Peeper looks at the domains a page actually contacts and compares them against a bundled tracker database. Detection happens entirely inside the browser: there are no remote lookups and no data is sent anywhere.

A few things are intentionally excluded:

- First-party assets. Visiting criteo.com won’t produce a Criteo camera simply because the site loads its own resources.
- Speculative connection hints. dns-prefetch, for example, doesn’t mean a request was actually made.
- Google Tag Manager. GTM is a container and is often used to load trackers only after consent. Creepy Peeper reports the advertising or analytics services it subsequently loads instead.
- Services outside advertising and analytics. Hosting providers, CDNs, consent managers, and social widgets aren’t included.

Explicit exclusions and their reasons are kept in [`data/exclude.json`](data/exclude.json).


## Licence and attribution

The source code and tracker data have different licences. See [LICENSE.md](LICENSE.md) for the full details.

- Code: MIT.
- Tracker data: CC BY-NC-SA 4.0, derived from Ghostery’s TrackerDB and WhoTracks.me, © Ghostery GmbH. Because that data is included, the distributed extension is non-commercial.
- Logos: trademarks of their respective owners, used only to identify the company associated with a detected tracker. No affiliation or endorsement is implied. The artwork is not distributed here — it’s fetched from each company’s own site at install time.

## Known limits

- Detection is domain-based. A camera means the page contacted infrastructure associated with that company; it doesn’t say what information was exchanged or why. A Google camera, for example, might represent a conversion pixel or reCAPTCHA.
- 128 of the 444 companies don’t have usable logos and are shown with generated monograms instead. Many are defunct.
- The tracker database is a snapshot and needs to be rebuilt periodically to stay current.
