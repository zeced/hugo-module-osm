/**
 * hugo-module-osm — multi-map OSM/Leaflet controller.
 *
 * Reads window.osmMaps ({mapId: config} registry injected by osm-map.html)
 * and lazy-loads Leaflet only when a map nears the viewport, a URL hash
 * matches a known place slug, or the user interacts with a location card.
 *
 * Multiple maps on one page are supported: give each a unique `id` param.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Slug helpers
  // ---------------------------------------------------------------------------

  const normalizeSlug = (value) => {
    if (value == null) return "";
    let s = String(value).trim().toLowerCase();
    if (!s) return "";
    s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    s = s.replace(/[^a-z0-9\s_-]/g, " ");
    return s.replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  };

  const slugsFor = (cfg) => {
    const set = new Set();
    const add = (v) => { const n = normalizeSlug(v); if (n) set.add(n); };
    for (const loc of cfg.locations || []) {
      add(loc.slug); add(loc.name);
      if (loc.slug && loc.slug !== loc.name) add(loc.slug.replace(/_/g, "-"));
    }
    return set;
  };

  const resolveTarget = (target) => {
    if (target.hasAttribute("data-place")) {
      const raw = target.getAttribute("data-place");
      return { raw, normalized: normalizeSlug(raw) };
    }
    const href = target.getAttribute("href");
    if (href?.startsWith("#")) {
      const raw = href.slice(1);
      return { raw, normalized: normalizeSlug(decodeURIComponent(raw)) };
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // Leaflet loader — shared across all maps, loaded once per leafletBase URL
  // ---------------------------------------------------------------------------

  const loadCache = Object.create(null);

  const ensureLeaflet = (base) => {
    if (loadCache[base]) return loadCache[base];
    if (typeof L !== "undefined") return (loadCache[base] = Promise.resolve());

    const b = base.replace(/\/$/, "");
    loadCache[base] = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${b}/leaflet.css`;
      document.head.appendChild(link);

      const script = document.createElement("script");
      script.src = `${b}/leaflet.js`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`[osm-map] Failed to load Leaflet from ${script.src}`));
      document.head.appendChild(script);
    });
    return loadCache[base];
  };

  // ---------------------------------------------------------------------------
  // Marker factory — SVG teardrop pin with optional color + icon
  // ---------------------------------------------------------------------------

  /**
   * loc.color — any CSS value: "#e11d48", "var(--color-primary)", etc.
   * loc.icon  — raw HTML injected inside the white circle. Works with any icon
   *             library loaded on the page, Unicode characters, or emoji:
   *               '<i class="fa-solid fa-building"></i>'  Font Awesome 6
   *               '<i class="bi bi-geo-alt-fill"></i>'    Bootstrap Icons
   *               '<span class="material-icons">place</span>'
   *               '🏛️'  '★'  (no dependency)
   *             If the icon font is not loaded the glyph won't render —
   *             the colored teardrop still displays correctly.
   */
  const createMarkerIcon = (loc) => {
    const color = loc.color || "var(--osm-accent, #3b82f6)";
    const icon  = loc.icon  || "";

    return L.divIcon({
      html: `<div class="osm-marker" style="--osm-marker-color:${color}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" aria-hidden="true">
          <path class="osm-marker-pin" d="M16 0C7.163 0 0 7.163 0 16c0 11.686 14.505 29.694 15.293 30.629a.953.953 0 0 0 1.414 0C17.495 45.694 32 27.686 32 16 32 7.163 24.837 0 16 0z"/>
          <circle class="osm-marker-bg" cx="16" cy="16" r="9"/>
        </svg>${icon ? `<div class="osm-marker-icon">${icon}</div>` : ""}
      </div>`,
      className:   "",
      iconSize:    [32, 48],
      iconAnchor:  [16, 48],
      popupAnchor: [0, -50],
    });
  };

  // ---------------------------------------------------------------------------
  // Per-map instance
  // ---------------------------------------------------------------------------

  const instances = Object.create(null); // mapId → controller

  const bootstrapMap = (cfg, knownSlugs) => {
    const mapId = cfg.mapId;
    if (instances[mapId]) return instances[mapId];

    const mapEl = document.getElementById(mapId);
    if (!mapEl) { console.warn(`[osm-map] #${mapId} not found`); return null; }

    const map = L.map(mapId);
    const tl  = cfg.tileLayer || {};
    L.tileLayer(tl.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom:      tl.maxZoom      || 19,
      attribution:  tl.attribution  || "&copy; OpenStreetMap contributors",
      detectRetina: tl.detectRetina || false,
    }).addTo(map);

    const markers      = [];
    const markerLookup = Object.create(null);
    const slugSet      = knownSlugs; // reuse the set built in initMap
    const slugSource   = Object.create(null);
    let   pendingMove  = null;
    let   activeSlug   = null;

    const reg = (raw, marker) => {
      const n = normalizeSlug(raw);
      if (!n) return;
      markerLookup[n] = markerLookup[n] || marker;
      slugSource[n]   = slugSource[n]   || (raw ? String(raw).trim() : n);
    };

    const nearlyEqual = (a, b) => Math.abs(a - b) <= 1e-7;

    const focusMap = () => {
      const header = document.querySelector(".sticky-header-wrapper");
      const offset = header ? header.getBoundingClientRect().height + 16 : 16;
      const rect   = mapEl.getBoundingClientRect();
      window.scrollTo({ top: rect.top + window.scrollY - offset, behavior: "smooth" });
      setTimeout(() => map.invalidateSize(), 350);
    };

    const setActiveCard = (slug) => {
      const n = normalizeSlug(slug);
      if (!n || n === activeSlug) return;
      const section = mapEl.closest(".osm-section") || document;
      section.querySelectorAll(".osm-location-card").forEach((card) => {
        const isActive   = normalizeSlug(card.getAttribute("data-place")) === n;
        const expandable = card.querySelector(".osm-card-expandable");
        card.setAttribute("aria-expanded", String(isActive));
        if (expandable) {
          expandable.style.maxHeight = isActive ? expandable.scrollHeight + "px" : "0";
          expandable.style.opacity   = isActive ? "1" : "0";
        }
        if (isActive) activeSlug = n;
      });
    };

    const openMarker = (slug, options = {}) => {
      const n = normalizeSlug(slug);
      if (!n || !markerLookup[n]) return false;

      const marker     = markerLookup[n];
      const latLng     = marker.getLatLng();
      const targetZoom = Math.max(map.getZoom(), options.scroll ? 17 : cfg.zoom || 15);

      if (options.scroll) focusMap();
      if (pendingMove) { map.off("moveend", pendingMove); pendingMove = null; }

      const finalize = () => {
        if (marker.getPopup()) marker.openPopup();
        if (options.scroll) {
          setTimeout(() => {
            const sz = map.getSize();
            map.panBy([0, -Math.min(220, Math.max(90, sz.y * 0.28))], { animate: true });
          }, 120);
        }
      };

      const center    = map.getCenter();
      const needsMove = !center
        || !nearlyEqual(center.lat, latLng.lat)
        || !nearlyEqual(center.lng, latLng.lng)
        || map.getZoom() < targetZoom;

      if (needsMove) {
        pendingMove = () => { map.off("moveend", pendingMove); pendingMove = null; finalize(); };
        map.on("moveend", pendingMove);
        map.setView(latLng, targetZoom, { animate: true });
      } else {
        finalize();
      }

      if (options.updateHash !== false) {
        const hash = (options.raw || slugSource[n] || n).toString().replace(/^#+/, "");
        history.replaceState(null, "", `#${hash}`);
      }
      return true;
    };

    // Place markers
    (cfg.locations || []).forEach((loc) => {
      if (typeof loc.lat !== "number" || typeof loc.lon !== "number") return;
      const m = L.marker([loc.lat, loc.lon], {
        icon:  createMarkerIcon(loc),
        title: loc.name || "",
      }).addTo(map);
      const label = loc.popup || [loc.name && `<strong>${loc.name}</strong>`, loc.address].filter(Boolean).join("<br>");
      if (label) m.bindPopup(label, { autoPan: false });
      reg(loc.slug, m); reg(loc.name, m);
      if (loc.slug && loc.slug !== loc.name) reg(loc.slug.replace(/_/g, "-"), m);
      markers.push(m);
    });

    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    } else {
      map.setView(cfg.center || [48.8715, 2.2219], cfg.zoom || 15);
    }

    if (slugSet.size) {
      const handleHash = () => {
        const hash = normalizeSlug(decodeURIComponent(window.location.hash.slice(1)));
        if (hash && slugSet.has(hash)) {
          setActiveCard(hash);
          openMarker(hash, { scroll: false, updateHash: false });
        }
      };

      document.addEventListener("click", (evt) => {
        const t = evt.target.closest('[data-place], a[href^="#"]');
        if (!t) return;
        const r = resolveTarget(t);
        if (!r || !slugSet.has(r.normalized)) return;
        evt.preventDefault();
        setActiveCard(r.normalized);
        openMarker(r.normalized, { scroll: true, raw: r.raw });
      });

      document.addEventListener("keydown", (evt) => {
        if (evt.key !== "Enter" && evt.key !== " ") return;
        const card = evt.target.closest(".osm-location-card[data-place]");
        if (!card) return;
        evt.preventDefault();
        const raw = card.getAttribute("data-place");
        const n   = normalizeSlug(raw);
        if (!slugSet.has(n)) return;
        setActiveCard(n); openMarker(n, { scroll: true, raw });
      });

      window.addEventListener("hashchange", handleHash);
      handleHash();
    }

    instances[mapId] = { openMarker, setActiveCard };
    return instances[mapId];
  };

  // ---------------------------------------------------------------------------
  // Per-map lazy initializer
  // ---------------------------------------------------------------------------

  const initMap = (cfg) => {
    const mapId  = cfg.mapId;
    const mapEl  = document.getElementById(mapId);
    if (!mapEl) { console.warn(`[osm-map] #${mapId} not found`); return; }

    const slugSet = slugsFor(cfg);
    const ac      = new AbortController(); // torn down once Leaflet boots
    const { signal } = ac;

    const hashMatchesSlug = () => {
      const h = normalizeSlug(decodeURIComponent(window.location.hash.slice(1)));
      return h && slugSet.has(h);
    };

    const boot = () =>
      ensureLeaflet(cfg.leafletBase)
        .then(() => {
          ac.abort();            // remove early-interaction listeners
          observer?.disconnect();
          observer = null;
          bootstrapMap(cfg, slugSet);
        })
        .catch((err) => console.error("[osm-map]", err));

    const onEarlyInteraction = (evt) => {
      if (evt.type === "keydown") {
        if (evt.key !== "Enter" && evt.key !== " ") return;
        const card = evt.target.closest(".osm-location-card[data-place]");
        if (!card) return;
        const raw = card.getAttribute("data-place");
        const n   = normalizeSlug(raw);
        if (!slugSet.has(n)) return;
        evt.preventDefault(); evt.stopImmediatePropagation();
        boot().then(() => { const c = instances[mapId]; if (c) { c.setActiveCard(n); c.openMarker(n, { scroll: true, raw }); } });
        return;
      }
      const t = evt.target.closest('[data-place], a[href^="#"]');
      if (!t) return;
      const r = resolveTarget(t);
      if (!r || !slugSet.has(r.normalized)) return;
      evt.preventDefault(); evt.stopImmediatePropagation();
      boot().then(() => { const c = instances[mapId]; if (c) { c.setActiveCard(r.normalized); c.openMarker(r.normalized, { scroll: true, raw: r.raw }); } });
    };

    document.addEventListener("click",   onEarlyInteraction, { capture: true, signal });
    document.addEventListener("keydown", onEarlyInteraction, { capture: true, signal });

    let observer = null;

    if (hashMatchesSlug()) { boot(); return; }

    observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) boot(); },
      { rootMargin: "200px 0px 240px 0px", threshold: 0 },
    );
    observer.observe(mapEl);
  };

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------

  const start = () => {
    const maps = window.osmMaps;
    if (maps && typeof maps === "object") Object.values(maps).forEach(initMap);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
