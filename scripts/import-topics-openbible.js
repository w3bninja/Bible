// One-time import: converts OpenBible.info's topic-scores dataset
// (https://www.openbible.info/topics/, CC BY, community search-behavior +
// voting driven — not an editorial index) into data/topics.json, replacing
// the previous Nave's Topical Dictionary import. Chosen over Nave's because
// it covers real-life topics Nave's doesn't (e.g. "10 commandments",
// "healthy marriage") — see scripts/import-topics.js for the old source.
//
// Setup (source file is gitignored, not checked in):
//   mkdir .tmp-topics2-src
//   curl -sL --ssl-no-revoke -o .tmp-topics2-src/topic-scores.zip https://a.openbible.info/data/topic-scores.zip
//   (cd .tmp-topics2-src && unzip -o topic-scores.zip)
//
// Run once with: node scripts/import-topics-openbible.js
//
// The source is tab-delimited: "Topic", "OSIS", "Quality Score". OSIS refs
// are either a single verse ("Gen.1.1") or a same-book range
// ("Exod.20.1-Exod.20.26", occasionally spanning chapters) — both are
// expanded to concrete verse keys against this app's own data/bible.json.
// No score-based filtering happens here: every topic and every one of its
// resolvable verses is kept, per explicit preference for the full list over
// a curated subset. Verses within a topic are ordered by score (highest
// first) so the most relevant passages lead.

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", ".tmp-topics2-src", "topic-scores.txt");
const DATA_DIR = path.join(__dirname, "..", "data");

const bibleV1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "bible.json"), "utf8"));
const booksById = new Map(bibleV1.books.map((b) => [b.id, b]));
const bookOrder = new Map(bibleV1.books.map((b) => [b.id, b.order]));

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

function parseSingleRef(ref) {
  const parts = ref.split(".");
  if (parts.length !== 3) return null;
  const [abbrev, chapterStr, verseStr] = parts;
  const bookId = BOOK_ALIASES[abbrev];
  if (!bookId) return null;
  const chapter = Number(chapterStr);
  const verse = Number(verseStr);
  if (!Number.isInteger(chapter) || !Number.isInteger(verse)) return null;
  return { bookId, chapter, verse };
}

// Expands "Gen.1.1" to one key, or "Exod.20.1-Exod.20.26" / cross-chapter
// ranges like "1Kgs.14.31-1Kgs.15.8" to every verse key in between.
function expandOsisField(field) {
  const dashIdx = field.indexOf("-");
  if (dashIdx === -1) {
    const ref = parseSingleRef(field);
    if (!ref || !verseExists(ref.bookId, ref.chapter, ref.verse)) return [];
    return [`${ref.bookId}-${ref.chapter}-${ref.verse}`];
  }

  const start = parseSingleRef(field.slice(0, dashIdx));
  const end = parseSingleRef(field.slice(dashIdx + 1));
  if (!start || !end || start.bookId !== end.bookId) return [];

  const keys = [];
  for (let chapter = start.chapter; chapter <= end.chapter; chapter++) {
    const vStart = chapter === start.chapter ? start.verse : 1;
    const vEnd = chapter === end.chapter ? end.verse : chapterVerseCount(start.bookId, chapter);
    for (let verse = vStart; verse <= vEnd; verse++) {
      if (verseExists(start.bookId, chapter, verse)) keys.push(`${start.bookId}-${chapter}-${verse}`);
    }
  }
  return keys;
}

const raw = fs.readFileSync(SRC_PATH, "utf8");
const lines = raw.split("\n").slice(1); // skip header row

const stats = { rowsTotal: 0, rowsUnparseable: 0, rowsAccepted: 0, versesAdded: 0 };
const topicVerseScores = new Map(); // topicName -> Map(verseKey -> bestScore)

lines.forEach((line) => {
  if (!line.trim()) return;
  stats.rowsTotal++;
  const [topic, osisField, scoreStr] = line.split("\t");
  const score = Number(scoreStr);
  if (!topic || !osisField || !Number.isFinite(score)) {
    stats.rowsUnparseable++;
    return;
  }

  const keys = expandOsisField(osisField.trim());
  if (!keys.length) {
    stats.rowsUnparseable++;
    return;
  }

  if (!topicVerseScores.has(topic)) topicVerseScores.set(topic, new Map());
  const verseMap = topicVerseScores.get(topic);
  keys.forEach((key) => {
    if (!verseMap.has(key) || verseMap.get(key) < score) verseMap.set(key, score);
    stats.versesAdded++;
  });
  stats.rowsAccepted++;
});

function verseSortKey(key) {
  const parts = key.split("-");
  const verse = Number(parts.pop());
  const chapter = Number(parts.pop());
  const bookId = parts.join("-");
  return (bookOrder.get(bookId) || 0) * 1e6 + chapter * 1e3 + verse;
}

const topics = {};
topicVerseScores.forEach((verseMap, name) => {
  const sorted = [...verseMap.entries()]
    .sort((a, b) => b[1] - a[1] || verseSortKey(a[0]) - verseSortKey(b[0]))
    .map(([key]) => key);
  topics[name] = sorted;
});

fs.writeFileSync(path.join(DATA_DIR, "topics.json"), JSON.stringify(topics));

console.log(`Rows: ${stats.rowsTotal} total, ${stats.rowsAccepted} accepted, ${stats.rowsUnparseable} dropped (unparseable/unresolvable)`);
console.log(`Topics written: ${Object.keys(topics).length}`);
console.log(`Verse-key entries written (pre-dedup across rows, post-dedup per topic): ${stats.versesAdded}`);
