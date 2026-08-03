// One-time import: converts OpenBible.info's geocoded places dataset
// (https://www.openbible.info/geo/, CC BY, some points sourced from
// OpenStreetMap) into data/places.json: an array of
// { name, lat, lon, verseKeys: [...], comment }.
//
// Setup (source file is gitignored, not checked in):
//   mkdir .tmp-geo-src
//   curl -sL --ssl-no-revoke -o .tmp-geo-src/places.txt https://www.openbible.info/geo/data/places.txt
//
// Run once with: node scripts/import-places.js
//
// The source is tab-delimited: ESV Name | KMZ Name | Lat | Lon | Passages | Comment.
// About 1,056 of 1,274 rows have direct coordinates; the rest (e.g.
// "Abarim") instead give a root place name in the KMZ Name column whose
// coordinates should be reused (e.g. Abarim -> Mount Nebo). Passages are a
// comma-separated list of abbreviated ESV refs ("2 Kgs 5:12"), expanded to
// this app's own verse-key format against data/bible.json.

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", ".tmp-geo-src", "places.txt");
const DATA_DIR = path.join(__dirname, "..", "data");

const bible = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "bible.json"), "utf8"));
const booksById = new Map(bible.books.map((b) => [b.id, b]));

const BOOK_ALIASES = {
  Gen: "genesis", Ex: "exodus", Lev: "leviticus", Num: "numbers", Deut: "deuteronomy",
  Josh: "joshua", Judg: "judges", Ruth: "ruth", "1 Sam": "1samuel", "2 Sam": "2samuel",
  "1 Kgs": "1kings", "2 Kgs": "2kings", "1 Chr": "1chronicles", "2 Chr": "2chronicles",
  Ezra: "ezra", Neh: "nehemiah", Est: "esther", Job: "job", Ps: "psalms", Prov: "proverbs",
  Eccl: "ecclesiastes", Sng: "songofsolomon", Isa: "isaiah", Jer: "jeremiah",
  Lam: "lamentations", Ezek: "ezekiel", Dan: "daniel", Hos: "hosea", Joel: "joel",
  Amos: "amos", Obad: "obadiah", Jonah: "jonah", Mic: "micah", Nahum: "nahum",
  Hab: "habakkuk", Zeph: "zephaniah", Hag: "haggai", Zech: "zechariah", Mal: "malachi",
  Matt: "matthew", Mark: "mark", Luke: "luke", John: "john", Acts: "acts", Rom: "romans",
  "1 Cor": "1corinthians", "2 Cor": "2corinthians", Gal: "galatians", Eph: "ephesians",
  Phil: "philippians", Col: "colossians", "1 Thes": "1thessalonians", "2 Thes": "2thessalonians",
  "1 Tim": "1timothy", "2 Tim": "2timothy", Titus: "titus", Phlm: "philemon", Heb: "hebrews",
  Jas: "james", "1 Pet": "1peter", "2 Pet": "2peter", "1 John": "1john", "2 John": "2john",
  "3 John": "3john", Jude: "jude", Rev: "revelation",
};
// Longest-first so "2 Sam" matches before a bare "Sam" would (it never
// occurs, but keeps the alias-token matching unambiguous either way).
const BOOK_NAMES_BY_LENGTH = Object.keys(BOOK_ALIASES).sort((a, b) => b.length - a.length);

function chapterVerseCount(bookId, chapter) {
  const book = booksById.get(bookId);
  if (!book) return 0;
  const ch = book.chapters[chapter - 1];
  return ch ? ch.verses.length : 0;
}

function verseExists(bookId, chapter, verse) {
  return verse >= 1 && verse <= chapterVerseCount(bookId, chapter);
}

function parseRef(ref) {
  const trimmed = ref.trim();
  const bookAlias = BOOK_NAMES_BY_LENGTH.find((alias) => trimmed.startsWith(alias + " "));
  if (!bookAlias) return null;
  const bookId = BOOK_ALIASES[bookAlias];
  const rest = trimmed.slice(bookAlias.length).trim();
  const m = rest.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  const chapter = Number(m[1]);
  const verse = Number(m[2]);
  if (!verseExists(bookId, chapter, verse)) return null;
  return `${bookId}-${chapter}-${verse}`;
}

const lines = fs.readFileSync(SRC_PATH, "utf8").split("\n").slice(1);
const rows = lines.filter((l) => l.trim()).map((l) => l.split("\t"));

// Despite the header labels (ESV Name, KMZ Name, Lat, Lon...), data rows
// actually put a root-place-name string in the "Lat" column when a place
// has no direct coordinates of its own (e.g. Abarim -> "Mount Nebo" in the
// Lat column, Lon column empty) — the literal "KMZ Name" column is unused
// in practice. Root resolution below is driven by whether that column
// parses as a number, not by column position per the header.

// First pass: collect direct coordinates by ESV Name.
const coordsByName = new Map();
rows.forEach(([name, , latOrRoot, lon]) => {
  const lat = Number(latOrRoot);
  if (name && latOrRoot && Number.isFinite(lat) && lon) coordsByName.set(name, { lat, lon: Number(lon) });
});

const stats = { rowsTotal: rows.length, rootResolved: 0, rootUnresolved: 0, versesTotal: 0, versesDropped: 0 };
const places = [];

rows.forEach(([name, kmzName, latOrRoot, lon, passages, comment]) => {
  if (!name) return;
  const numericLat = Number(latOrRoot);
  let coords = latOrRoot && lon && Number.isFinite(numericLat) ? { lat: numericLat, lon: Number(lon) } : null;
  if (!coords) {
    // A leading >, <, or ~ on the root name means "surrounds", "inside", or
    // "approximately" per OpenBible.info's own legend — strip it, the
    // coordinate itself is still the named place's.
    const rawRoot = (latOrRoot && !Number.isFinite(numericLat) ? latOrRoot : null) || kmzName || null;
    const rootName = rawRoot ? rawRoot.replace(/^[><~]/, "").trim() : null;
    if (rootName) {
      coords = coordsByName.get(rootName) || null;
      if (coords) stats.rootResolved++;
      else stats.rootUnresolved++;
    }
  }
  if (!coords) return;

  const verseKeys = (passages || "")
    .split(",")
    .map((r) => parseRef(r))
    .filter(Boolean);
  stats.versesTotal += (passages || "").split(",").filter((r) => r.trim()).length;
  stats.versesDropped += (passages || "").split(",").filter((r) => r.trim()).length - verseKeys.length;

  places.push({
    name,
    lat: coords.lat,
    lon: coords.lon,
    verseKeys: [...new Set(verseKeys)],
    comment: (comment || "").trim(),
  });
});

fs.writeFileSync(path.join(DATA_DIR, "places.json"), JSON.stringify(places));

console.log(`Rows: ${stats.rowsTotal}, resolved via root: ${stats.rootResolved}, unresolvable (no coords at all): ${stats.rootUnresolved}`);
console.log(`Places written: ${places.length}`);
console.log(`Verse refs: ${stats.versesTotal} total, ${stats.versesDropped} dropped (unparseable/nonexistent)`);
