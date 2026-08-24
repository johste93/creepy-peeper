# Chrome Web Store listing

Copy for the submission form. Everything here is drafted to survive review —
the claims are all things the code actually does.

---

## Name

`Creepy Peeper`

## Short description (132 char max)

> A surveillance camera appears for every ad and analytics company tracking you
> — and each one follows your mouse.

*(126 characters.)*

## Category

Privacy & Security

## Detailed description

> Every page you visit is being watched by companies you did not choose to
> deal with. You know this. You have read it a hundred times. It has stopped
> meaning anything.
>
> Creepy Peeper makes it mean something again.
>
> When a page loads a tracker, a surveillance camera appears in the corner of
> your screen — one for each company, mounted to the edge of the window, wearing
> that company's own logo and brand colours. Then they turn and follow your
> mouse pointer. Everywhere it goes.
>
> On a news site you will often find fifteen or twenty of them, stacked in
> columns, all tracking you at once.
>
> WHAT IT DETECTS
>
> 444 companies — every advertising and site-analytics tracker listed on
> Ghostery's WhoTracks.me index. Detection works by watching which domains a
> page contacts, including requests that never appear in the page's markup.
>
> IT WILL NOT GET IN YOUR WAY
>
> • The cameras are click-through. They never intercept a click.
> • They fade out when your pointer gets close.
> • Switch them off for any site, or everywhere, from the toolbar icon.
> • Show only advertising, or only analytics — they toggle separately.
> • Reduced-motion settings are respected.
>
> IT DOES NOT TRACK YOU
>
> There would be something deeply stupid about a tracker-spotting extension
> that tracked you. So:
>
> • No network requests. None. The extension has no server and never contacts
>   one — you can confirm this yourself in DevTools.
> • No data collection, no analytics, no account, no identifiers.
> • The only thing stored is your own on/off settings, kept on your device.
> • Fully open source. Read every line.
>
> The tracker list is compiled from Ghostery's TrackerDB and WhoTracks.me, and
> is bundled inside the extension — checking it requires no network access, and
> Ghostery never learns you are running this.
>
> Free, and non-commercial by licence.

## Justification for permissions

*(Reviewers ask for these. Be specific.)*

**`storage`**
> Stores the user's own preferences only: whether the extension is enabled,
> which tracker categories they want shown, and the list of sites they have
> disabled it on. Uses `chrome.storage.local`, so nothing leaves the device. No
> browsing data is stored.

**`activeTab`**
> The popup shows a per-site on/off switch, so it needs the hostname of the tab
> the user is looking at when they click the toolbar icon. Granted only on that
> click.

**Host access (`<all_urls>` content scripts)**
> Trackers can be on any page, so the overlay must be able to appear on any
> page. The content scripts read the URLs of resources a page requests and
> compare the domains against a list bundled in the extension, then draw to the
> screen. They do not read page content, form input, or cookies. The extension
> makes no network requests of any kind and has no remote endpoint, so no data
> can leave the browser.

**`"world": "MAIN"`**
> One small script runs in the page world to read the Resource Timing API and a
> short list of well-known tracker globals. An isolated content script cannot
> see either. It reads only hostnames and passes them to the extension's own
> isolated script via `postMessage`. It does not modify the page.

## Data-handling disclosures

| Question | Answer |
|---|---|
| Collects personally identifiable information | **No** |
| Collects health information | **No** |
| Collects financial information | **No** |
| Collects authentication information | **No** |
| Collects personal communications | **No** |
| Collects location | **No** |
| Collects web history | **No** |
| Collects user activity | **No** |
| Collects website content | **No** |

Certifications — all three must be checked and all three are true:

- Does not sell or transfer user data to third parties outside approved use cases
- Does not use or transfer user data for purposes unrelated to the item's single purpose
- Does not use or transfer user data to determine creditworthiness or for lending

## Single purpose

> Creepy Peeper has one purpose: to show the user, visually and in real time,
> which advertising and analytics companies are tracking the page they are
> viewing.

## Privacy policy URL

`https://github.com/johste93/creepy-peeper/blob/main/PRIVACY.md`

## Assets still needed

- [ ] **Screenshots**, 1280×800 or 640×400, at least one, up to five. Best
      candidates: a news site with a full stack of cameras; the popup open with
      its list of companies; a close-up of a few barrels showing the logos.
- [ ] **Small promo tile**, 440×280.
- [x] Store icon, 128×128 — `icons/icon128.png`.

## Before submitting

- [ ] Set the repository URL — it appears in `src/popup.js` (`REPO`) and in the
      privacy policy link above.
- [ ] `node tools/package.mjs` and upload `dist/creepy-peeper-<version>.zip`.
- [ ] Pay the one-time developer registration fee.
