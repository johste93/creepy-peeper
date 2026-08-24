# Licensing

Creepy Peeper has two halves under two different licences, because the tracker
data it depends on carries terms the code does not.

## The code — MIT

Everything under `src/` that is not generated, plus `tools/`, `test/`, and the
camera artwork in `icons/` other than `icons/brands/`.

```
MIT License

Copyright (c) 2026 Creepy Peeper contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## The tracker data — CC BY-NC-SA 4.0

`data/registry.json`, `data/wtm.json` and the generated `src/registry.js`.

These are derived from **[Ghostery's TrackerDB](https://github.com/ghostery/trackerdb)**
and from the tracker index published at
**[WhoTracks.me](https://www.ghostery.com/whotracksme/trackers)**, both
© Ghostery GmbH and licensed
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

A derived database inherits those terms, so for this half:

- **BY** — Ghostery must be credited. They are, here, in the extension's README,
  and in the store listing.
- **NC** — **non-commercial use only.** Creepy Peeper is free and always will
  be. It cannot be sold, bundled into a paid product, or monetised. If that ever
  needs to change, Ghostery sells commercial licences (`sales@ghostery.com`).
- **SA** — anything derived from this data must be shared under the same terms.

**In practice this means the extension as distributed is non-commercial.** The
MIT code can be reused freely on its own; the moment it ships with the tracker
database, NC and SA apply to the result.

## The logos — not distributed here

`icons/brands/` is **not part of this repository.** It is gitignored, and
populated at install time by `tools/fetch-logos.mjs`, which downloads each icon
from the company that publishes it.

That is deliberate, because two separate rights apply to a logo and only one of
them is answered by using it honestly:

- **Trademark.** Showing a company's mark in order to say *this company is
  running a tracker on the page you are reading* is nominative use. The mark
  identifies its owner, which is what a mark is for. No affiliation,
  sponsorship, or endorsement is claimed or implied, and the extension makes no
  claim about any company beyond which domains the page contacted.
- **Copyright.** The logo is also an image, and someone drew it. Nominative use
  is a trademark doctrine and says nothing about copying an image file.
  Redistributing 265 PNGs lifted from other companies' CDNs would be a
  reproduction question this project has no need to answer.

Fetching at install time settles the second point without weakening the first.
The extension still shows the marks, and does so nominatively. This repository
distributes no one else's artwork.

### What is committed

`data/decals.json` — for each company, the URL its icon was fetched from and the
colours measured out of it. A URL is a reference rather than a copy, and a hex
value read off a pixel is a measurement of the icon, not the icon.

The marks that **are** in this repository are of two kinds:

| Source | Count | Terms |
|---|---|---|
| [Simple Icons](https://simpleicons.org/) | 45 | Icon files CC0; the marks remain trademarks of their owners |
| Drawn by hand for this project | 10 | Original artwork here; the marks they depict remain trademarks |

**If you own one of these marks and want it gone, open an issue and it will be
removed from the next release.** The company falls back to a text monogram,
which costs the extension nothing — that is already how 128 of the 444 companies
are shown.

## No warranty

Tracker detection is a best-effort reading of what a page loads. It can be wrong
in both directions. Nothing here is a statement of fact about any company's
conduct, and none of it is legal advice.
