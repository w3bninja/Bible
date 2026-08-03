// One-time import: consolidates the UBS Project MARBLE "Bible Routes"
// collection (https://github.com/ubsicap/ubs-open-license/tree/main/ubs-bible-routes,
// CC BY-SA 4.0, © United Bible Societies 2023, created by Dr. Leen
// Ritmeyer) into data/routes.json — journeys/campaigns as line paths, since
// OpenBible.info's point data (data/places.json) has no route/path info at
// all.
//
// Setup (source files are gitignored, not checked in):
//   mkdir -p .tmp-routes-src
//   git clone --filter=blob:none --sparse --depth 1 https://github.com/ubsicap/ubs-open-license.git .tmp-routes-src/repo
//   (cd .tmp-routes-src/repo && git sparse-checkout set ubs-bible-routes)
//   cp -r .tmp-routes-src/repo/ubs-bible-routes/GeoJsonRoutes .tmp-routes-src/
//
// Run once with: node scripts/import-routes.js
//
// The source files have no verse references, just a title (from the
// filename) and a LineString of [lon, lat] coordinate pairs — kept in that
// same GeoJSON-standard order in the output; swap to [lat, lon] at render
// time for Leaflet.

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", ".tmp-routes-src", "GeoJsonRoutes");
const DATA_DIR = path.join(__dirname, "..", "data");

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".geojson"));

// A file is either a bare Feature (geometry directly on it) or a
// FeatureCollection (LineString features nested in .features[], sometimes
// several — e.g. a battle with an approach and a retreat — and sometimes
// with stray nulls in the array). Collect every LineString geometry found,
// however it's nested.
function extractLineStrings(raw) {
  if (raw.type === "Feature") {
    return raw.geometry && raw.geometry.type === "LineString" ? [raw.geometry.coordinates] : [];
  }
  if (raw.type === "FeatureCollection" && Array.isArray(raw.features)) {
    return raw.features
      .filter((f) => f && f.geometry && f.geometry.type === "LineString")
      .map((f) => f.geometry.coordinates);
  }
  return [];
}

const routes = [];
files.forEach((filename) => {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC_DIR, filename), "utf8"));
  const title = filename
    .replace(/\.geojson$/, "")
    .replace(/^\d+[a-z]?\.\s*/, "")
    .trim();

  const lineStrings = extractLineStrings(raw).filter((coords) => Array.isArray(coords) && coords.length >= 2);
  lineStrings.forEach((coordinates, i) => {
    routes.push({ title: lineStrings.length > 1 ? `${title} (${i + 1})` : title, coordinates });
  });
});

fs.writeFileSync(path.join(DATA_DIR, "routes.json"), JSON.stringify(routes));

console.log(`Wrote routes.json: ${routes.length} routes (of ${files.length} source files)`);
console.log(`Total points: ${routes.reduce((s, r) => s + r.coordinates.length, 0)}`);
