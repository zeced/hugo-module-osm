# CLAUDE.md — hugo-module-osm

Hugo module that adds an OpenStreetMap (Leaflet) to any Hugo site.

## Structure

```
assets/js/osm-map.js          JS controller — lazy-loads Leaflet, manages markers/cards/hashes
layouts/partials/osm-map.html Hugo partial — resolves coordinates, injects window.osmMapConfig
config/_default/params.toml   Module default params (consumed via site.Params.osmMap)
scripts/copy-leaflet.mjs      Node script to copy leaflet dist → static/js/leaflet (local mode)
exampleSite/                  Minimal Hugo site for testing and demonstration
```

## Key design decisions

**Leaflet lazy-loading** — `osm-map.js` uses IntersectionObserver to defer loading
Leaflet (JS + CSS) until the map element nears the viewport. Also triggers on URL
hash match or user click/keydown on a `data-place` card. Do not bundle leaflet into
the main script pipeline — lazy loading is the core performance feature.

**`leafletBase` in config** — The JS reads `cfg.leafletBase` (inside `window.osmMapConfig`)
for the Leaflet dist URL. There is no separate `window.__osmLeafletBase` global.
The partial sets this from `params.osmMap.leafletSource` ("cdn" or "local").

**Nominatim geocoding** — happens at Hugo build time via `resources.GetRemote`.
Hugo caches the result. Only fires when `lat`/`lon` are absent on a location.
Requires a descriptive User-Agent string (Nominatim usage policy).

**Script deduplication** — the partial uses `.page.Store` to emit `osm-map.js` only
once per page. Pass `"page" .` in the dict when calling. Without it the script emits
each time (harmless but redundant).

**CSS classes for cards** — `osm-location-card`, `osm-card-expandable`, `osm-card-icon`.
Prefixed with `osm-` to avoid collisions. The module ships no card CSS.

## Development workflow

```bash
cd exampleSite
hugo mod tidy    # syncs go.sum against ../
hugo server      # live reload at localhost:1313
```

The `replace` directive in `exampleSite/go.mod` points to `../` so edits to the
module files are picked up immediately without publishing.

## Testing checklist

- [ ] CDN mode: leaflet.js loads from jsDelivr on scroll
- [ ] Local mode: copy-leaflet.mjs populates static/js/leaflet, map loads from /js/leaflet
- [ ] Coordinates: marker placed correctly with lat/lon
- [ ] Geocoding: marker placed via Nominatim when only address provided
- [ ] Hash navigation: `?#slug` flies to correct marker on load
- [ ] Card click: map scrolls into view, correct marker opens, card expands
- [ ] Multiple maps on one page: unique `id` param required; `page` param deduplicates JS

## Consuming this module (in club-longchamp or another site)

Replace the existing `static/js/leaflet/` bundle + `window.__osmLeafletBase` pattern:

1. Add to `config/_default/module.toml`:
   ```toml
   [[imports]]
   path = "github.com/zeced/hugo-module-osm"
   ```
2. Remove `js/osm-map.js` from `params.plugins.js` in params.toml (partial now handles it)
3. Remove `static/js/leaflet/` from the repo (switch to CDN or npm local mode)
4. Update `layouts/partials/components/osm-map.html` call to new dict API:
   - Remove `"Page" .` → use `"page" .`
   - Remove `"locs"` → use `"locations"`

## Two-partial architecture

Mirrors the club-longchamp pattern exactly:

  osm-map.html         Config injector only — outputs <script> tags, NO <div>.
                       Writes window.osmMaps["mapId"] = cfg (registry, not a single global).
                       Also emits osm-map.js once per page via page.Store.

  osm-map-section.html Full section layout — owns the map <div>, cards column,
                       CSS (scoped with osm- prefix), responsive grid.
                       Calls osm-map.html internally for config + JS.

This matches: nous-trouver.html (layout) → calls → osm-map.html (config).
The caller owns the div; the config injector is separate.

## Multi-map support

window.osmMaps is a {mapId: config} registry. Each <script> appends to it:
  window.osmMaps = window.osmMaps || {};
  window.osmMaps["my-map"] = {...};

The JS iterates Object.values(window.osmMaps) on DOMContentLoaded and sets up
one IntersectionObserver + early-interaction listeners per map. instances[mapId]
stores each map's controller.

## Card expand height

setActiveCard uses scrollHeight for the max-height animation (not a fixed 300px).
This means the expandable area grows to fit its content correctly.
