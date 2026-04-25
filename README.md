# hugo-module-osm

A Hugo module that adds an interactive OpenStreetMap to any page via Leaflet.

**Features**

- Leaflet lazy-loaded — only fetches when the map nears the viewport, a URL hash matches a location, or the user clicks a card
- Build-time geocoding via Nominatim — provide a postal address instead of coordinates; Hugo resolves and caches lat/lon at build time
- CDN or local Leaflet — zero-setup CDN default; swap to local for strict CSP sites
- Hash + card navigation — `#slug` URLs and `data-place` cards fly the map to the right marker
- Script deduplication — `osm-map.js` emits only once per page even if the partial is called multiple times

---

## Quick start

### 1 — Add the module to your site

```toml
# config/_default/module.toml
[[imports]]
path = "github.com/zeced/hugo-module-osm"
```

```bash
hugo mod get github.com/zeced/hugo-module-osm
hugo mod tidy
```

### 2 — Call the partial

```go-html-template
{{ partial "osm-map.html" (dict
    "page"      .
    "locations" (slice
      (dict "name" "My Place" "lat" 48.85 "lon" 2.35)
    )
) }}
```

That is all. Leaflet loads from jsDelivr CDN by default.

---

## Location object

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name in popups and cards |
| `slug` | string | no | Hash/anchor slug. Auto-derived from `name` |
| `lat` | float | — | Latitude. Provide `lat`+`lon` **or** `address` |
| `lon` | float | — | Longitude |
| `address.streetAddress` | string | — | Street for geocoding + popup |
| `address.postalCode` | string | — | Postal code |
| `address.addressLocality` | string | — | City |
| `address.addressCountry` | string | — | Country |
| `enable` | bool | no | Set `false` to skip this location. Default: `true` |

When `lat`/`lon` are absent, the module queries
`nominatim.openstreetmap.org` at build time using the address fields.
Hugo caches the result — Nominatim is only called on a cold build or when
the address changes.

---

## Partial parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | Page | — | Hugo page context — enables JS deduplication when calling the partial multiple times on one page |
| `id` | string | `"osm-map"` | HTML `id` for the map container. Must be unique if using multiple maps |
| `locations` | []dict | — | List of location objects (see above) |
| `center` | []float | from `params.osmMap` | Override initial center `[lat, lon]` |
| `zoom` | int | from `params.osmMap` | Override zoom level |

---

## Site configuration

Add to your `config/_default/params.toml` to override defaults:

```toml
[osmMap]
  # "cdn" (default) or "local"
  leafletSource    = "cdn"

  # CDN base URL — pin a version for reproducible builds
  leafletCDN       = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist"

  # Path for local mode (see below)
  leafletLocalPath = "/js/leaflet"

  # Fallback when no locations are provided
  defaultZoom      = 15
  defaultCenter    = [48.8715, 2.2219]
```

---

## Local Leaflet mode (CSP / privacy)

If your site has a strict Content-Security-Policy that blocks external scripts,
use local mode:

**Step 1** — install Leaflet in your site:

```bash
npm install leaflet
```

**Step 2** — copy Leaflet assets to `static/`:

```bash
# One-time setup or add to your build script
node node_modules/hugo-module-osm/scripts/copy-leaflet.mjs
```

Or add it to `package.json` as a postinstall hook:

```json
{
  "scripts": {
    "postinstall": "node node_modules/hugo-module-osm/scripts/copy-leaflet.mjs"
  }
}
```

**Step 3** — switch to local mode in `params.toml`:

```toml
[osmMap]
  leafletSource = "local"
```

---

## Interactive card + hash navigation

Any element with `data-place="<slug>"` will trigger the map to fly to that
marker and open its popup. Hash links (`href="#slug"`) work the same way.
If the map is not yet in the viewport, Leaflet loads on demand.

```html
<!-- card -->
<div class="osm-location-card" data-place="my-place" tabindex="0" aria-expanded="false">
  <strong>My Place</strong>
  <div class="osm-card-expandable">
    <p>More details shown when active.</p>
  </div>
</div>

<!-- hash link anywhere on the page -->
<a href="#my-place">See on map</a>
```

CSS classes used by the JS controller:

| Class | Element | Purpose |
|---|---|---|
| `osm-location-card` | card root | Receives `aria-expanded` toggle |
| `osm-card-expandable` | child of card | Expanded/collapsed via `max-height` |
| `osm-card-icon` | child of card | Optional icon that rotates when active |

All class names are prefixed with `osm-` to avoid conflicts. Style them
freely — the module ships no CSS for cards.

---

## Running the example site

```bash
cd exampleSite
hugo mod tidy
hugo server
```

---

## License

MIT — see [LICENSE](LICENSE).
Leaflet is © Vladimir Agafonkin, BSD 2-Clause.
Map tiles © OpenStreetMap contributors, ODbL.

---

## osm-map-section.html — batteries-included layout

Renders the full section: location cards column + map column, expandable cards
with images, responsive grid, and scoped CSS. No utility framework required.

```go-html-template
{{ partial "osm-map-section.html" (dict
    "page"        .
    "title"       "Our locations"
    "description" "Three spaces in the heart of the city."
    "note"        "Reception is at the back of the building."
    "layout"      "cards-left"
    "locations"   (slice
      (dict
        "name"     "Main Hall"
        "slug"     "main-hall"
        "color"    "#4f46e5"
        "subtitle" "Bus 70, 93"
        "image"    "images/places/main-hall.jpg"
        "lat"      48.870888
        "lon"      2.228951
      )
    )
) }}
```

### Section parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | Page | — | Hugo page context (required for CSS/JS dedup) |
| `locations` | []dict | — | Location objects — same shape as `osm-map.html` plus card fields below |
| `id` | string | `"osm-map"` | Map container id — must be unique per page |
| `layout` | string | `"cards-left"` | `"cards-left"` \| `"cards-right"` \| `"cards-below"` |
| `title` | string | — | Section heading |
| `description` | string | — | Subtitle below the heading |
| `note` | string | — | Footer note below the grid |
| `mapHeight` | string | `"500px"` | CSS height of the map container |
| `center` | []float | from params | Fallback `[lat, lon]` center |
| `zoom` | int | from params | Zoom level override |

### Extra location fields for cards

| Field | Type | Description |
|---|---|---|
| `color` | string | CSS color for the card left-border accent. Any CSS value: `"#e11d48"`, `"var(--color-primary)"` |
| `image` | string | Hugo resource path for the card image, e.g. `"images/places/hall.jpg"`. Processed as WebP. |
| `subtitle` | string | Secondary line in the card header (transport lines, hours, etc.) |

### Theming with CSS custom properties

No class name conflicts with your existing styles — all classes are prefixed
with `osm-`. Override any property in your stylesheet:

```css
:root {
  --osm-accent:       #6b7280;   /* fallback card border color */
  --osm-card-bg:      #ffffff;
  --osm-card-border:  #e5e7eb;
  --osm-card-radius:  0.5rem;
  --osm-card-shadow:  0 4px 12px rgba(0, 0, 0, 0.1);
  --osm-map-radius:   0.5rem;
  --osm-note-bg:      #f9fafb;
  --osm-note-border:  #e5e7eb;
  --osm-section-py:   3rem;
}
```

### Multiple maps on one page

Use a unique `id` per section — the JS handles each independently:

```go-html-template
{{ partial "osm-map-section.html" (dict "page" . "id" "map-centre"  "locations" $locsCentre  ...) }}
{{ partial "osm-map-section.html" (dict "page" . "id" "map-annexe"  "locations" $locsAnnexe  ...) }}
```
