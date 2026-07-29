// One-time import: converts Nave's Topical Dictionary
// (https://github.com/BradyStephenson/bible-data, CC BY 4.0, attribution:
// Brady Stephenson, "BibleData: Structured Datasets from the Holy Bible")
// into data/topics.json: { "AARON": ["genesis-1-1", ...], ... }
//
// Setup (source file is gitignored, not checked in):
//   mkdir .tmp-topics-src
//   curl -s --ssl-no-revoke -o .tmp-topics-src/NavesTopicalDictionary.csv https://raw.githubusercontent.com/BradyStephenson/bible-data/main/NavesTopicalDictionary.csv
//
// Run once with: node scripts/import-topics.js
//
// The source is a CSV with columns (section, subject, entry), where `entry`
// is a block of "-description BOOK C:V,V-V; BOOK C:V; C:V" sub-entry lines —
// free-text descriptions followed by a trailing, sometimes book-omitting,
// sometimes chapter-omitting reference list. This script extracts only the
// reference list from each line (ignoring the prose) and expands it to
// concrete verse keys against this app's own data/bible.json, so chapter/
// verse counts always match what the app can actually render.

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", ".tmp-topics-src", "NavesTopicalDictionary.csv");
const DATA_DIR = path.join(__dirname, "..", "data");

const bibleV1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "bible.json"), "utf8"));
const booksById = new Map(bibleV1.books.map((b) => [b.id, b]));

// Maps every abbreviation variant seen (or plausible) in the source to our
// own bookId. The source is not internally consistent (e.g. both JHN and
// JOHN appear for John's Gospel), so this is deliberately generous.
const BOOK_ALIASES = {
  GEN: "genesis",
  EXO: "exodus",
  LEV: "leviticus",
  NUM: "numbers",
  DEU: "deuteronomy",
  JOS: "joshua",
  JDG: "judges",
  RUT: "ruth",
  "1SA": "1samuel",
  "2SA": "2samuel",
  "1KI": "1kings",
  "2KI": "2kings",
  "1CH": "1chronicles",
  "2CH": "2chronicles",
  EZR: "ezra",
  NEH: "nehemiah",
  EST: "esther",
  JOB: "job",
  PSA: "psalms",
  PRO: "proverbs",
  ECC: "ecclesiastes",
  SNG: "songofsolomon",
  SOS: "songofsolomon",
  SOL: "songofsolomon",
  ISA: "isaiah",
  JER: "jeremiah",
  LAM: "lamentations",
  EZK: "ezekiel",
  EZE: "ezekiel",
  DAN: "daniel",
  HOS: "hosea",
  JOL: "joel",
  JOE: "joel",
  AMO: "amos",
  OBA: "obadiah",
  JON: "jonah",
  MIC: "micah",
  NAM: "nahum",
  NAH: "nahum",
  HAB: "habakkuk",
  ZEP: "zephaniah",
  HAG: "haggai",
  ZEC: "zechariah",
  MAL: "malachi",
  MAT: "matthew",
  MRK: "mark",
  MAR: "mark",
  LUK: "luke",
  JHN: "john",
  JOHN: "john",
  ACT: "acts",
  ROM: "romans",
  "1CO": "1corinthians",
  "2CO": "2corinthians",
  GAL: "galatians",
  EPH: "ephesians",
  PHP: "philippians",
  PHIL: "philippians",
  COL: "colossians",
  "1TH": "1thessalonians",
  "2TH": "2thessalonians",
  "1TI": "1timothy",
  "2TI": "2timothy",
  TIT: "titus",
  PHM: "philemon",
  HEB: "hebrews",
  JAS: "james",
  "1PE": "1peter",
  "2PE": "2peter",
  "1JN": "1john",
  "1JHN": "1john",
  "2JN": "2john",
  "2JHN": "2john",
  "3JN": "3john",
  "3JHN": "3john",
  JUD: "jude",
  JDE: "jude",
  REV: "revelation",
};

// Longest-first so e.g. "1JHN" matches before "JHN" inside it.
const BOOK_TOKEN_RE = new RegExp(
  "\\b(" + Object.keys(BOOK_ALIASES).sort((a, b) => b.length - a.length).join("|") + ")\\b",
  "g"
);

function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function chapterVerseCount(bookId, chapter) {
  const book = booksById.get(bookId);
  if (!book) return 0;
  const ch = book.chapters[chapter - 1];
  return ch ? ch.verses.length : 0;
}

function verseExists(bookId, chapter, verse) {
  return verse >= 1 && verse <= chapterVerseCount(bookId, chapter);
}

const stats = { linesTotal: 0, linesWithRefs: 0, groupsParsed: 0, groupsSkipped: 0, versesAdded: 0, invalidVersesDropped: 0 };

// Parses everything from the first book-token onward in one sub-entry line.
// Returns a list of verse keys.
function parseReferenceZone(zone) {
  const keys = [];
  const groups = zone.split(";").map((g) => g.trim()).filter(Boolean);
  let currentBookId = null;

  groups.forEach((group) => {
    let rest = group;
    const bookMatch = rest.match(BOOK_TOKEN_RE);
    if (bookMatch && rest.trim().toUpperCase().startsWith(bookMatch[0])) {
      currentBookId = BOOK_ALIASES[bookMatch[0]];
      rest = rest.slice(bookMatch[0].length).trim();
    }
    // Strip any stray leading punctuation left over from splitting.
    rest = rest.replace(/^[,:\s]+/, "");

    if (!currentBookId) {
      stats.groupsSkipped++;
      return;
    }

    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) {
      // Bare chapter number (whole-chapter reference) or unparseable — only
      // accept a clean integer, otherwise skip rather than guess.
      if (/^\d+$/.test(rest.trim())) {
        const chapter = Number(rest.trim());
        const count = chapterVerseCount(currentBookId, chapter);
        for (let v = 1; v <= count; v++) keys.push(`${currentBookId}-${chapter}-${v}`);
        stats.groupsParsed++;
      } else {
        stats.groupsSkipped++;
      }
      return;
    }

    const chapterStr = rest.slice(0, colonIdx).trim();
    const verseListStr = rest.slice(colonIdx + 1).trim();
    const chapter = Number(chapterStr);
    if (!Number.isInteger(chapter) || chapter <= 0) {
      stats.groupsSkipped++;
      return;
    }

    const verseParts = verseListStr.split(",").map((p) => p.trim()).filter(Boolean);
    if (!verseParts.length) {
      stats.groupsSkipped++;
      return;
    }

    verseParts.forEach((part) => {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const lo = Number(rangeMatch[1]);
        const hi = Number(rangeMatch[2]);
        for (let v = lo; v <= hi; v++) {
          if (verseExists(currentBookId, chapter, v)) keys.push(`${currentBookId}-${chapter}-${v}`);
          else stats.invalidVersesDropped++;
        }
      } else if (/^\d+$/.test(part)) {
        const v = Number(part);
        if (verseExists(currentBookId, chapter, v)) keys.push(`${currentBookId}-${chapter}-${v}`);
        else stats.invalidVersesDropped++;
      }
      // Anything else (e.g. stray text) is silently dropped.
    });
    stats.groupsParsed++;
  });

  return keys;
}

function parseEntry(entry) {
  const keys = new Set();
  entry.split("\n").forEach((line) => {
    stats.linesTotal++;
    BOOK_TOKEN_RE.lastIndex = 0;
    const firstMatch = BOOK_TOKEN_RE.exec(line);
    if (!firstMatch) return;
    stats.linesWithRefs++;
    const zone = line.slice(firstMatch.index);
    parseReferenceZone(zone).forEach((k) => keys.add(k));
  });
  return [...keys];
}

const raw = fs.readFileSync(SRC_PATH, "utf8").replace(/^﻿/, "");
const rows = parseCSV(raw);
const header = rows[0];
const subjectIdx = header.indexOf("subject");
const entryIdx = header.indexOf("entry");

const topics = {};
rows.slice(1).forEach((row) => {
  const subject = row[subjectIdx];
  const entry = row[entryIdx];
  if (!subject || !entry) return;
  const keys = parseEntry(entry);
  if (keys.length) {
    topics[subject] = keys;
    stats.versesAdded += keys.length;
  }
});

fs.writeFileSync(path.join(DATA_DIR, "topics.json"), JSON.stringify(topics));

console.log(`Parsed ${Object.keys(topics).length} topics with at least one resolvable verse (of ${rows.length - 1} total rows)`);
console.log(
  `Lines: ${stats.linesTotal} total, ${stats.linesWithRefs} contained a recognizable book token`
);
console.log(`Reference groups: ${stats.groupsParsed} parsed, ${stats.groupsSkipped} skipped (unparseable)`);
console.log(`Invalid verse references dropped (chapter/verse doesn't exist, e.g. "daniel 17:14"): ${stats.invalidVersesDropped}`);
console.log(`Total verse-key entries written (pre-dedup per topic): ${stats.versesAdded}`);
