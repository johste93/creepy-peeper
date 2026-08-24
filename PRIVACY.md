# Privacy Policy — Creepy Peeper

**Last updated: 24 August 2026**

## The short version

Creepy Peeper collects nothing, stores nothing about you, and sends nothing
anywhere. There is no server. There is no analytics. There would be something
deeply stupid about a tracker-spotting extension that tracked you.

## What it does on a page

When you load a page, Creepy Peeper reads the addresses of the things that page
requests — scripts, images, beacons — and compares the domain names against a
list of known advertising and analytics companies that ships inside the
extension. If a domain matches, it draws a camera.

All of that happens locally, in your browser, in memory. The comparison list is
a file bundled with the extension; checking it requires no network access.

## What it collects

Nothing.

- **No browsing history.** The addresses it inspects are never recorded, never
  written to disk, and are discarded when you leave the page.
- **No personal information.** It never reads page content, form fields, cookies,
  passwords, or anything you type.
- **No identifiers.** No account, no device ID, no fingerprint.
- **No analytics.** The extension does not report its own usage to anyone,
  including its authors.

## What it sends

Nothing. Creepy Peeper makes no network requests of any kind. It has no server
to talk to.

## What it stores

Only your own settings — whether the extension is switched on, which categories
of tracker you want shown, and the list of sites you have turned it off for.

These are kept in `chrome.storage.local`, which means they stay on the device
they were set on. They are deliberately **not** synced between your devices,
because the list of sites you have switched the extension off for is itself a
small piece of browsing history and there is no reason for it to travel.

Removing the extension removes them.

## Permissions, and why each one exists

| Permission | Why |
|---|---|
| `storage` | To remember your switches: on/off, which categories to show, and which sites you have disabled. Local to the device. |
| `activeTab` | So the popup can tell which site you are on, and therefore which site the per-site switch applies to. It is granted only when you click the toolbar icon, and lapses afterwards. |
| Access to all sites | Trackers can be on any page, so the camera has to be able to appear on any page. It reads only the addresses of what a page loads. It has no network access of its own and no ability to send anything anywhere. |

Access to all sites is broad, so it is worth being precise about the limit: the
extension reads resource addresses and draws to the screen. It cannot transmit,
because it never makes a request.

## Third parties

There are none. No SDKs, no libraries loaded at runtime, no CDNs, no crash
reporting.

The bundled list of tracker domains is derived from
[Ghostery's TrackerDB](https://github.com/ghostery/trackerdb) and
[WhoTracks.me](https://www.ghostery.com/whotracksme/trackers), but it is
compiled into the extension when it is built. Ghostery receives no requests from
you and has no idea you are running this.

## Children

Creepy Peeper collects no data from anyone, of any age.

## Changes

If this policy ever changes, the change lands in this file in the public
repository, with the date above updated and the edit visible in the commit
history.

## Verifying any of this

You do not have to take our word for it. The extension is open source, so you
can read every line, and you can watch it behave:

- Open DevTools → Network, with the extension enabled. It originates no requests.
- Read `src/detect-main.js` and `src/content.js` — a few hundred lines between
  them. Neither contains `fetch`, `XMLHttpRequest`, or `sendBeacon`.

## Contact

Open an issue on the project's GitHub repository.
