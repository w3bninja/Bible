// One-time import: converts BibleData-Person.csv + BibleData-PersonVerse.csv
// (https://github.com/BradyStephenson/bible-data, CC BY 4.0, attribution:
// Brady Stephenson, "BibleData: Structured Datasets from the Holy Bible")
// into data/persons.json: { "David": ["1samuel-16-13", ...], "James (son of Zebedee)": [...] }
//
// Setup (source files are gitignored, not checked in):
//   curl -s --ssl-no-revoke -o .tmp-topics-src/BibleData-Person.csv https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-Person.csv
//   curl -s --ssl-no-revoke -o .tmp-topics-src/BibleData-PersonVerse.csv https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-PersonVerse.csv
//
// Run once with: node scripts/import-persons.js
//
// Unlike Nave's Topical Dictionary, PersonVerse rows are already one-row-per-
// verse with a clean "GEN 1:1" reference — no range/list grammar needed, just
// book-abbreviation normalization + validation against this app's bible.json.
// The harder problem here is that ~3,000 distinct person_ids often share the
// same first name (many "James"es, "Mary"s, etc), so labels need
// disambiguation before they can be used as unique, human-readable tag keys.

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", ".tmp-topics-src");
const DATA_DIR = path.join(__dirname, "..", "data");

const bibleV1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "bible.json"), "utf8"));
const booksById = new Map(bibleV1.books.map((b) => [b.id, b]));

// Same alias table as import-topics.js — duplicated rather than shared since
// these are independent one-off scripts, not runtime code.
const BOOK_ALIASES = {
  GEN: "genesis", EXO: "exodus", LEV: "leviticus", NUM: "numbers", DEU: "deuteronomy",
  JOS: "joshua", JDG: "judges", RUT: "ruth", "1SA": "1samuel", "2SA": "2samuel",
  "1KI": "1kings", "2KI": "2kings", "1CH": "1chronicles", "2CH": "2chronicles",
  EZR: "ezra", NEH: "nehemiah", EST: "esther", JOB: "job", PSA: "psalms",
  PRO: "proverbs", ECC: "ecclesiastes", SNG: "songofsolomon", SOS: "songofsolomon",
  SOL: "songofsolomon", ISA: "isaiah", JER: "jeremiah", LAM: "lamentations",
  EZK: "ezekiel", EZE: "ezekiel", DAN: "daniel", HOS: "hosea", JOL: "joel",
  JOE: "joel", AMO: "amos", OBA: "obadiah", JON: "jonah", MIC: "micah",
  NAM: "nahum", NAH: "nahum", HAB: "habakkuk", ZEP: "zephaniah", HAG: "haggai",
  ZEC: "zechariah", MAL: "malachi", MAT: "matthew", MRK: "mark", MAR: "mark",
  LUK: "luke", JHN: "john", JOHN: "john", ACT: "acts", ROM: "romans",
  "1CO": "1corinthians", "2CO": "2corinthians", GAL: "galatians", EPH: "ephesians",
  PHP: "philippians", PHIL: "philippians", COL: "colossians", "1TH": "1thessalonians",
  "2TH": "2thessalonians", "1TI": "1timothy", "2TI": "2timothy", TIT: "titus",
  PHM: "philemon", HEB: "hebrews", JAS: "james", "1PE": "1peter", "2PE": "2peter",
  "1JN": "1john", "1JHN": "1john", "2JN": "2john", "2JHN": "2john", "3JN": "3john",
  "3JHN": "3john", JUD: "jude", JDE: "jude", REV: "revelation",
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseReference(ref) {
  // e.g. "GEN 1:1" -> {bookId, chapter, verse}
  const m = ref.trim().match(/^([1-3]?[A-Z]+)\s+(\d+):(\d+)$/);
  if (!m) return null;
  const bookId = BOOK_ALIASES[m[1]];
  if (!bookId) return null;
  return { bookId, chapter: Number(m[2]), verse: Number(m[3]) };
}

function verseExists(bookId, chapter, verse) {
  const book = booksById.get(bookId);
  const ch = book && book.chapters[chapter - 1];
  return !!ch && verse >= 1 && verse <= ch.verses.length;
}

function readCSV(filename) {
  const raw = fs.readFileSync(path.join(SRC_DIR, filename), "utf8").replace(/^﻿/, "");
  const rows = parseCSV(raw);
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((h, i) => (obj[h] = row[i] || ""));
    return obj;
  });
}

// ---------- Person metadata: build unique, disambiguated labels ----------

const personRows = readCSV("BibleData-Person.csv");
const nameCounts = new Map();
personRows.forEach((p) => nameCounts.set(p.person_name, (nameCounts.get(p.person_name) || 0) + 1));

function shortDisambiguator(p) {
  const attr = (p.unique_attribute || "").trim();
  if (!attr) return null;
  // Take the leading clause only — these fields can run long ("Holy, Holy,
  // Holy (ISA 6:3) and too many others to fit here") — and strip trailing
  // scripture citations like "(MAT 4:21)" so labels don't end up with
  // doubled-up parens once wrapped as "Name (clause)".
  const clause = attr
    .split(/[,.;]/)[0]
    .replace(/\s*\([1-3]?[A-Z]+\s+\d+:\d+\)\s*$/, "")
    .trim();
  return clause.length > 0 && clause.length <= 40 ? clause : null;
}

const labelByPersonId = new Map();
const usedLabels = new Set();
personRows.forEach((p) => {
  let label = p.person_name;
  if (nameCounts.get(p.person_name) > 1) {
    const disambig = shortDisambiguator(p);
    label = disambig ? `${p.person_name} (${disambig})` : `${p.person_name} #${p.person_sequence}`;
  }
  // Guard against residual collisions after disambiguation.
  let finalLabel = label;
  let suffix = 2;
  while (usedLabels.has(finalLabel)) {
    finalLabel = `${label} (${suffix})`;
    suffix++;
  }
  usedLabels.add(finalLabel);
  labelByPersonId.set(p.person_id, finalLabel);
});

// ---------- Person-verse mapping ----------

const personVerseRows = readCSV("BibleData-PersonVerse.csv");
const stats = { rows: personVerseRows.length, unresolvedRef: 0, unresolvedPerson: 0, invalidVerse: 0, added: 0 };

const versesByPersonId = new Map();
personVerseRows.forEach((row) => {
  if (!row.person_id || row.person_id === "NA") return;
  const ref = parseReference(row.reference_id);
  if (!ref) {
    stats.unresolvedRef++;
    return;
  }
  if (!verseExists(ref.bookId, ref.chapter, ref.verse)) {
    stats.invalidVerse++;
    return;
  }
  if (!labelByPersonId.has(row.person_id)) {
    stats.unresolvedPerson++;
    return;
  }
  const key = `${ref.bookId}-${ref.chapter}-${ref.verse}`;
  if (!versesByPersonId.has(row.person_id)) versesByPersonId.set(row.person_id, new Set());
  versesByPersonId.get(row.person_id).add(key);
  stats.added++;
});

const persons = {};
versesByPersonId.forEach((verseSet, personId) => {
  const label = labelByPersonId.get(personId);
  persons[label] = [...verseSet];
});

fs.writeFileSync(path.join(DATA_DIR, "persons.json"), JSON.stringify(persons));

console.log(`Wrote persons.json: ${Object.keys(persons).length} people with at least one verse`);
console.log(
  `Rows: ${stats.rows} total, ${stats.added} verse links added, ${stats.unresolvedRef} unresolved refs, ${stats.invalidVerse} invalid verses dropped, ${stats.unresolvedPerson} unresolved person ids`
);
