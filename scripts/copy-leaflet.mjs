/**
 * Copies Leaflet dist files (JS, CSS, marker images) from node_modules into a
 * target directory so Hugo can serve them as static assets in "local" mode.
 *
 * Usage (from your site root, after npm install):
 *   node node_modules/hugo-module-osm/scripts/copy-leaflet.mjs [target-dir]
 *
 * Default target: static/js/leaflet
 */
import { cpSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const leafletDist = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "leaflet",
  "dist",
);

const target = resolve(process.argv[2] ?? "static/js/leaflet");

mkdirSync(target, { recursive: true });
cpSync(leafletDist, target, { recursive: true });

console.log(`leaflet assets copied → ${target}`);
