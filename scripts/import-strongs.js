// One-time import: converts the kaiserlik/kjv Strong's-tagged source data
// (https://github.com/kaiserlik/kjv, no declared license — underlying content
// is public domain; see docs/feature-scoping.md for the risk decision) into
// this app's data files:
//   data/strongs-tokens.json      { "<bookId>-<chapter>-<verse>": [{t, s?, i?}, ...] }
//   data/strongs-lexicon.json     { "G26": {lemma, translit, def, pos, root, translations, outline} }
//   data/strongs-concordance.json { "G26": ["<bookId>-<chapter>-<verse>", ...] }
//
// Token fields: t = word text (punctuation attached), s = array of Strong's numbers
// (omitted if none), i = true if this is an italicized/supplied word (omitted if false).
//
// Setup (source files are gitignored, ~78MB, not checked in):
//   mkdir .tmp-kjv-src
//   curl -s --ssl-no-revoke -o .tmp-kjv-src/books.json   https://raw.githubusercontent.com/kaiserlik/kjv/master/books.json
//   curl -s --ssl-no-revoke -o .tmp-kjv-src/lexicon.json https://raw.githubusercontent.com/kaiserlik/kjv/master/lexicon.json
//   node -e "JSON.parse(require('fs').readFileSync('.tmp-kjv-src/books.json','utf8')).books.map(b=>Object.values(b)[0]).join(' ')" > .tmp-kjv-src/abbrs.txt
//   cat .tmp-kjv-src/abbrs.txt | xargs -P 8 -I{} curl -s --ssl-no-revoke -o ".tmp-kjv-src/{}.json" "https://raw.githubusercontent.com/kaiserlik/kjv/master/{}.json"
//
// Run once with: node scripts/import-strongs.js
//
// Note: several source book files contain malformed JSON (unescaped quotes in
// the unused bg/ch/sp parallel-text fields) — this script extracts the "en"
// field via regex rather than JSON.parse'ing the whole file, so it tolerates that.

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", ".tmp-kjv-src");
const DATA_DIR = path.join(__dirname, "..", "data");

const bibleV1 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "bible.json"), "utf8"));
const kjvBooksList = JSON.parse(fs.readFileSync(path.join(SRC_DIR, "books.json"), "utf8")).books;
const kjvAbbrs = kjvBooksList.map((entry) => Object.values(entry)[0]);

if (kjvAbbrs.length !== bibleV1.books.length) {
  throw new Error(`Book count mismatch: source has ${kjvAbbrs.length}, ours has ${bibleV1.books.length}`);
}

const EM_OPEN = "";
const EM_CLOSE = "";

function tokenizeVerseText(en) {
  const marked = en.replace(/<em>/g, EM_OPEN).replace(/<\/em>/g, EM_CLOSE);
  const rawWords = marked.split(/\s+/).filter(Boolean);

  const tokens = [];
  let italic = false;
  for (let raw of rawWords) {
    while (raw.includes(EM_OPEN)) {
      italic = true;
      raw = raw.replace(EM_OPEN, "");
    }
    let closesAfter = false;
    while (raw.includes(EM_CLOSE)) {
      closesAfter = true;
      raw = raw.replace(EM_CLOSE, "");
    }
    if (!raw) {
      if (closesAfter) italic = false;
      continue;
    }

    const m = raw.match(/^(.*?)((?:\[[GH]\d+\])*)$/);
    const text = m[1];
    const tagsStr = m[2] || "";
    const strongs = [...tagsStr.matchAll(/\[([GH]\d+)\]/g)].map((x) => x[1]);

    const token = { t: text };
    if (strongs.length) token.s = strongs;
    if (italic) token.i = true;
    tokens.push(token);

    if (closesAfter) italic = false;
  }
  return tokens;
}

function parseOccurrences(str) {
  // Source string repeats itself verbatim, e.g. "love(86x), charity(28x), love(86x), charity(28x)"
  if (!str) return {};
  const seen = {};
  for (const m of str.matchAll(/([A-Za-z' -]+)\((\d+)x\)/g)) {
    const word = m[1].trim();
    const count = Number(m[2]);
    seen[word] = count; // dedupe by overwrite; same word always has same count in source
  }
  return seen;
}

// ---------- Tokens ----------

const strongsTokens = {};
const concordance = {};

// Several source files contain malformed JSON (unescaped quotes inside the
// Bulgarian/Chinese/Spanish parallel-text fields we don't need). Rather than
// depend on those fields parsing cleanly, extract only the well-formed
// "<Abbr>|<chapter>|<verse>":{"en":"..."} entries directly via regex — the
// "en" field itself is consistently well-escaped even when sibling fields aren't.
const VERSE_ENTRY_RE = /"([A-Za-z0-9]+\|\d+\|\d+)"\s*:\s*\{\s*"en"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function extractEnglishVerses(fileContent) {
  const verses = new Map();
  for (const m of fileContent.matchAll(VERSE_ENTRY_RE)) {
    verses.set(m[1], JSON.parse(`"${m[2]}"`));
  }
  return verses;
}

bibleV1.books.forEach((book, idx) => {
  const abbr = kjvAbbrs[idx];
  const srcPath = path.join(SRC_DIR, `${abbr}.json`);
  const fileContent = fs.readFileSync(srcPath, "utf8");
  const verses = extractEnglishVerses(fileContent);

  // Single-chapter books store `chapters` as a bare object instead of a
  // one-element array in data/bible.json (pre-existing quirk) — normalize here.
  const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];

  chapters.forEach((_, chapterIdx) => {
    const chapterNum = chapterIdx + 1;
    const verseCount = chapters[chapterIdx].verses.length;
    for (let v = 1; v <= verseCount; v++) {
      const verseKeySrc = `${abbr}|${chapterNum}|${v}`;
      const en = verses.get(verseKeySrc);
      if (en === undefined) {
        console.warn(`Missing verse in source: ${book.id} ${chapterNum}:${v}`);
        continue;
      }

      const ourKey = `${book.id}-${chapterNum}-${v}`;
      const tokens = tokenizeVerseText(en);
      strongsTokens[ourKey] = tokens;

      tokens.forEach((tok) => {
        (tok.s || []).forEach((num) => {
          if (!concordance[num]) concordance[num] = [];
          concordance[num].push(ourKey);
        });
      });
    }
  });
});

fs.writeFileSync(path.join(DATA_DIR, "strongs-tokens.json"), JSON.stringify(strongsTokens));
fs.writeFileSync(path.join(DATA_DIR, "strongs-concordance.json"), JSON.stringify(concordance));

console.log(`Wrote strongs-tokens.json: ${Object.keys(strongsTokens).length} verses`);
console.log(`Wrote strongs-concordance.json: ${Object.keys(concordance).length} Strong's numbers`);

// ---------- Lexicon ----------

const rawLexicon = JSON.parse(fs.readFileSync(path.join(SRC_DIR, "lexicon.json"), "utf8"));
const lexicon = {};

for (const [num, entry] of Object.entries(rawLexicon)) {
  lexicon[num] = {
    lemma: entry.Gk_word || entry.Hb_word || "",
    translit: entry.transliteration || "",
    def: entry.strongs_def || "",
    pos: entry.part_of_speech || "",
    root: entry.root_word || "",
    outline: entry.outline_usage || "",
    translations: parseOccurrences(entry.occurrences),
  };
}

fs.writeFileSync(path.join(DATA_DIR, "strongs-lexicon.json"), JSON.stringify(lexicon));
console.log(`Wrote strongs-lexicon.json: ${Object.keys(lexicon).length} entries`);
