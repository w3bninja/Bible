// One-time import: converts OpenBible.info's cross-reference dataset
// (https://www.openbible.info/labs/cross-references/, CC BY, drawn mostly
// from the public-domain Treasury of Scripture Knowledge) into
// data/cross-references.json: { "genesis-1-1": [{"key":"acts-17-24","votes":132}, ...] }
//
// Setup (source file is gitignored, not checked in):
//   mkdir .tmp-xref-src
//   curl -sL --ssl-no-revoke -o .tmp-xref-src/cross-references.zip https://a.openbible.info/data/cross-references.zip
//   (cd .tmp-xref-src && unzip -o cross-references.zip)
//
// Run once with: node scripts/import-cross-references.js
//
// The source is tab-delimited: "From Verse", "To Verse", "Votes" using OSIS
// book abbreviations (e.g. "Gen.1.1", or a range like "Rom.1.19-Rom.1.20").
// Community-submitted votes can be negative (net downvoted, i.e. probably a
// weak or wrong cross-reference) — those are dropped entirely, and each
// verse's list is capped to its top-N by vote count so a heavily-connected
// verse (e.g. Gen 1:1) doesn't produce an unusably long list. Cross-refs are
// stored symmetrically (both directions) since a reader landing on either
// verse should be able to find the other.

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", ".tmp-xref-src", "cross_references.txt");
const DATA_DIR = path.join(__dirname, "..", "data");
const CAP_PER_VERSE = 12;

const bibleV1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "bible.json"), "utf8"));
const booksById = new Map(bibleV1.books.map((b) => [b.id, b]));

const BOOK_ALIASES = {
  Gen: "genesis", Exod: "exodus", Lev: "leviticus", Num: "numbers", Deut: "deuteronomy",
  Josh: "joshua", Judg: "judges", Ruth: "ruth", "1Sam": "1samuel", "2Sam": "2samuel",
  "1Kgs": "1kings", "2Kgs": "2kings", "1Chr": "1chronicles", "2Chr": "2chronicles",
  Ezra: "ezra", Neh: "nehemiah", Esth: "esther", Job: "job", Ps: "psalms", Prov: "proverbs",
  Eccl: "ecclesiastes", Song: "songofsolomon", Isa: "isaiah", Jer: "jeremiah",
  Lam: "lamentations", Ezek: "ezekiel", Dan: "daniel", Hos: "hosea", Joel: "joel",
  Amos: "amos", Obad: "obadiah", Jonah: "jonah", Mic: "micah", Nah: "nahum",
  Hab: "habakkuk", Zeph: "zephaniah", Hag: "haggai", Zech: "zechariah", Mal: "malachi",
  Matt: "matthew", Mark: "mark", Luke: "luke", John: "john", Acts: "acts", Rom: "romans",
  "1Cor": "1corinthians", "2Cor": "2corinthians", Gal: "galatians", Eph: "ephesians",
  Phil: "philippians", Col: "colossians", "1Thess": "1thessalonians", "2Thess": "2thessalonians",
  "1Tim": "1timothy", "2Tim": "2timothy", Titus: "titus", Phlm: "philemon", Heb: "hebrews",
  Jas: "james", "1Pet": "1peter", "2Pet": "2peter", "1John": "1john", "2John": "2john",
  "3John": "3john", Jude: "jude", Rev: "revelation",
};

function chapterVerseCount(bookId, chapter) {
  const book = booksById.get(bookId);
  if (!book) return 0;
  const ch = book.chapters[chapter - 1];
  return ch ? ch.verses.length : 0;
}

function verseExists(bookId, chapter, verse) {
  return verse >= 1 && verse <= chapterVerseCount(bookId, chapter);
}

// Parses one OSIS ref like "Gen.1.1" or "1Sam.2.10" into a verse key. Only
// the start of a range (e.g. the "Rom.1.19" in "Rom.1.19-Rom.1.20") is ever
// passed in here — see parseRefTakeStart.
function parseSingleRef(ref) {
  const parts = ref.split(".");
  if (parts.length !== 3) return null;
  const [abbrev, chapterStr, verseStr] = parts;
  const bookId = BOOK_ALIASES[abbrev];
  if (!bookId) return null;
  const chapter = Number(chapterStr);
  const verse = Number(verseStr);
  if (!Number.isInteger(chapter) || !Number.isInteger(verse)) return null;
  if (!verseExists(bookId, chapter, verse)) return null;
  return `${bookId}-${chapter}-${verse}`;
}

// A ref field is either a single OSIS ref or a range "A-B" (same or
// different chapter/book on each side). We only take the start verse — the
// cross-reference is treated as pointing at/from the top of the range,
// which is enough for a "see also" link without modeling passage spans.
function parseRefTakeStart(field) {
  const dashIdx = field.indexOf("-");
  const first = dashIdx === -1 ? field : field.slice(0, dashIdx);
  return parseSingleRef(first);
}

const raw = fs.readFileSync(SRC_PATH, "utf8");
const lines = raw.split("\n").slice(1); // skip header row

const stats = { rowsTotal: 0, rowsNegativeVotes: 0, rowsUnparseable: 0, rowsAccepted: 0 };
const pairs = []; // [{a, b, votes}]

lines.forEach((line) => {
  if (!line.trim()) return;
  stats.rowsTotal++;
  const [fromField, toField, votesStr] = line.split("\t");
  const votes = Number(votesStr);
  if (!Number.isFinite(votes) || votes < 0) {
    stats.rowsNegativeVotes++;
    return;
  }

  const fromKey = parseRefTakeStart(fromField);
  const toKey = parseRefTakeStart(toField);
  if (!fromKey || !toKey || fromKey === toKey) {
    stats.rowsUnparseable++;
    return;
  }

  pairs.push({ a: fromKey, b: toKey, votes });
  stats.rowsAccepted++;
});

// Build symmetric adjacency, keeping the highest vote count seen for any
// given (verse, otherVerse) pair since the same pair can appear more than
// once in the source (or reversed).
const adjacency = new Map(); // key -> Map(otherKey -> votes)

function addEdge(from, to, votes) {
  if (!adjacency.has(from)) adjacency.set(from, new Map());
  const m = adjacency.get(from);
  if (!m.has(to) || m.get(to) < votes) m.set(to, votes);
}

pairs.forEach(({ a, b, votes }) => {
  addEdge(a, b, votes);
  addEdge(b, a, votes);
});

const crossReferences = {};
let totalEdgesWritten = 0;
adjacency.forEach((othersMap, key) => {
  const sorted = [...othersMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CAP_PER_VERSE)
    .map(([otherKey, votes]) => ({ key: otherKey, votes }));
  crossReferences[key] = sorted;
  totalEdgesWritten += sorted.length;
});

fs.writeFileSync(path.join(DATA_DIR, "cross-references.json"), JSON.stringify(crossReferences));

console.log(`Rows: ${stats.rowsTotal} total, ${stats.rowsAccepted} accepted, ${stats.rowsNegativeVotes} dropped (negative votes), ${stats.rowsUnparseable} dropped (unparseable/self-ref)`);
console.log(`Verses with at least one cross-reference: ${Object.keys(crossReferences).length}`);
console.log(`Total edges written (post-cap at ${CAP_PER_VERSE}/verse): ${totalEdgesWritten}`);
