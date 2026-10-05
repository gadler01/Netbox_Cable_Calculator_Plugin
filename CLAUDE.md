# CLAUDE.md

Guidance for Claude Code when working in this repo. See README.md for install and user-facing docs.

## What this is

A NetBox 4.x plugin (`netbox_cable_calc`) that calculates cable lengths for datacenter moves. It has a Django backend and a React frontend, served at `/plugins/cable-calc/`.

## Layout

- `netbox_cable_calc/views.py`: all backend logic (rack index, length math, BOM, layout files, API views).
- `netbox_cable_calc/urls.py`: routes `""` (page), `bom/`, `layout/`, `racks/`, `devices/`.
- `netbox_cable_calc/templates/netbox_cable_calc/calculator.html`: injects `window.NETBOX_*` data and loads the bundle.
- `netbox_cable_calc/layouts/`: saved floor plans and BOM caches written at runtime (`site_{id}.json`, `site_{id}_loc_{id}.json`, `*_bom_cache.json`). Gitignored, so never commit them.
- `netbox_cable_calc/views.py.simple`: an old copy of views.py. It isn't used.
- `ui/src/`: React source.
  - `App.jsx`: main component, scope (site/location) state, tabs, save/load wiring.
  - `FloorPlan.jsx`: single-location floor plan editor.
  - `SiteLayout.jsx`: site-wide view with cross-location bridges.
  - `floorplan.js`: helpers (auto layout, `loadFromServer`, `saveToServer`, sessionStorage, bridge helpers).

## Build and deploy workflow

1. Edit `ui/src/*`.
2. Build: `cd ui && npm run build`. This writes `netbox_cable_calc/static/netbox_cable_calc/calculator.bundle.js`.
3. Bump the cache-buster `?v=N` in `calculator.html` so browsers pick up the new bundle.
4. Commit the source, the bundle and the template together. The bundle is committed on purpose, because NetBox hosts usually don't have Node.
5. Deploy to the dev NetBox (see below).

### Dev NetBox on this host (`nbupg`)

NetBox does **not** run from `~/nbcc`. It runs an editable install of `/opt/netbox/netbox_cable_calc_repo`, a separate git checkout that tracks `origin/development`. It serves the bundle from `STATIC_ROOT` (`/opt/netbox/netbox/static/`), not from the plugin folder.

To deploy, commit and push from `~/nbcc`, then:

```bash
cd /opt/netbox/netbox_cable_calc_repo && git pull
cd /opt/netbox/netbox && sudo -u netbox /opt/netbox/venv/bin/python manage.py collectstatic --no-input
sudo systemctl restart netbox netbox-rq
```

- Don't copy files into the deploy checkout by hand. Local changes there make the next `git pull` fail.
- Check: the browser console should show `calculator.bundle.js?v=<current number>`. If it shows an older number, the deploy didn't land.
- The live layout files are in `/opt/netbox/netbox_cable_calc_repo/netbox_cable_calc/layouts/`. They're gitignored, so pulls don't touch them. The copies in `~/nbcc` are stale.

There are no automated tests. To check a change, load the page in NetBox and watch the browser console.

## Key concepts

- **Scope**: site, plus an optional location. It lives in React state as `pendingSite` / `pendingLocation`, and the URL is kept in sync with `history.replaceState`.
- **Site view**: `showSiteLayout` is true when a site is selected, no location is selected, and the site has locations. The layout API then merges the site file with every location file (`_load_scoped_layout`).
- **Row id namespacing**: merged rows get prefixed ids (`site:row-1`, `loc125:row-1`) so they don't collide. `_namespace_layout` is idempotent, so a prefix is never added twice.
- **Site-level file holds bridges only**: saves from the site view write `rows: []`, `rackPositions: {}` and only the cross-location bridges (see `setBridgesAndSave` in App.jsx). Rows and same-location bridges stay in each location's own file. `SiteLayout` hides site-level rows that have no racks; these are leftovers from before the site view existed (Sep 18).

## Current progress (as of 2026-10-04, branch `development`)

Recent work, in order:
1. Re-fetch racks and devices when the scope changes (`aab0379`).
2. Reload the layout when the scope changes (`4c14b0a`).
3. Make `_namespace_layout` idempotent (`40dd360`).
4. Add debug logging to `loadFromServer` and fix the Suite 14 layout file, which was missing `y` on its rows (`b0aa6c0`).
5. `ad59be4` (bundle `v=20`, pushed and deployed):
   - Layout reload fixed: the layout-load `useEffect` runs on `[pendingSite, pendingLocation]`. It clears the old layout at the start, and it ignores a response that arrives after the scope has changed again.
   - `popstate` (back/forward) copies the URL into `pendingSite`/`pendingLocation`, and the effect above does the reload.
   - `_namespace_layout` leaves any id that already has a `:` alone. Before this, site-level bridges loaded as `site:loc126:row-?`.
   - The site file stores bridges only, and empty site-level rows are hidden in the site view.
   - Temporary `console.error("DEBUG: ...")` logging in App.jsx.

Data change made outside git: the live `site_105.json` was cleaned (4 empty leftover rows and 2 broken bridges removed).

## Known issues / next steps

- **Debug logging is always on.** Remove it or put it behind a flag before merging to `main`. Debug messages use `console.error`, which makes them look like real errors.
- **Site 105 has no cross-location bridges now.** Re-create the S14 to S15 bridges in the site view.
- **Save errors are hidden.** `saveToServer` drops the error in `catch(_)`, and `LayoutApiView` has no server-side logging.
- **The TomSelect handler may be redundant.** It sets `pendingLocation` alongside `handleLocationChange` (`onChange`). React skips the second update when the value is the same, so it's harmless but probably not needed.
- **`layoutReady` is set but never read.** Either wire it up (for example, to disable saving while a layout loads) or remove it.
- **No floor plan for racks that are in a site but not in any location.** The site view is read-only for rows. If those racks need laying out, the site view needs its own row editor.

## Conventions

- Match the existing compact JSX style (short lines, inline `useEffect`s).
- Layout files are plain JSON. Rows need `id`, `x`, `y` and related fields. A missing `y` broke rendering before.
- Commit messages are short and imperative ("Add ...", "Fix ...").
