// One-time build: constructs data/genealogy.json, the full "son of" chain
// from Adam to Jesus per Luke 3:23-38 (parsed directly out of this app's
// own data/bible.json — no external source), with each entry linked to its
// verse.
//
// For the earliest stretch (Adam through Jacob), Genesis 5 and 11 state
// each patriarch's age when their listed son was born, plus (for most)
// their total lifespan — explicit numbers in the KJV text, not
// interpretation. Those are hardcoded below (transcribed directly from
// Genesis 5/11, verified against data/bible.json) and used to compute an
// Anno Mundi (years since Adam's creation, AM 0) birth/death year for each
// person, so that stretch can be drawn to scale with real lifespan bars.
// As a sanity check, this arithmetic reproduces the well-known result that
// Methuselah dies in AM 1656 — the same year as the Flood.
//
// Genealogies are silent on ages from Judah onward (no age-at-fatherhood is
// stated for the remaining ~55 names down to Jesus), and reconstructing
// that stretch would require reign-length chronology (judges, kings, exile)
// this app doesn't model. Those entries are kept in the chain, linked to
// their verse, just without a computed year — the UI shows them as an
// undated continuation rather than inventing a position for them.
//
// Run once with: node scripts/build-genealogy.js

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const bible = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "bible.json"), "utf8"));
const luke = bible.books.find((b) => b.id === "luke");

// Luke 3:23-38 (1-indexed verses 23..38 -> 0-indexed 22..37).
const rawVerses = luke.chapters[2].verses.slice(22, 38);

// Parse "...son of NAME..." occurrences per verse, in order.
const chainFromJesus = [{ name: "Jesus", verseKey: "luke-3-23" }];
rawVerses.forEach((text, i) => {
  const verseKey = `luke-3-${23 + i}`;
  [...text.matchAll(/son of ([A-Z][a-zé]*)/g)].forEach((m) => {
    if (m[1] === "God") return; // chain terminator, not a person
    chainFromJesus.push({ name: m[1], verseKey });
  });
});

// Reverse to Adam -> Jesus order, and attach each person's father (the
// entry that follows them in the Jesus-first list).
const chain = chainFromJesus.slice().reverse();
chain.forEach((entry, i) => {
  entry.fatherName = i > 0 ? chain[i - 1].name : null;
});

// Genesis 5 (Adam-Noah) and Genesis 11 (Shem-Terah): [ageAtFatherhood, totalLifespanOrNull].
// Genesis 21:5 / 25:26 / 47:28 give Abraham/Isaac/Jacob directly.
const GENESIS_DATA = {
  Adam: { verseKey: "genesis-5-3", ageAtNext: 130, lifespan: 930 },
  Seth: { verseKey: "genesis-5-6", ageAtNext: 105, lifespan: 912 },
  Enos: { verseKey: "genesis-5-9", ageAtNext: 90, lifespan: 905 },
  Cainan: { verseKey: "genesis-5-12", ageAtNext: 70, lifespan: 910 },
  Maleleel: { verseKey: "genesis-5-15", ageAtNext: 65, lifespan: 895, displayName: "Mahalaleel" },
  Jared: { verseKey: "genesis-5-18", ageAtNext: 162, lifespan: 962 },
  Enoch: { verseKey: "genesis-5-21", ageAtNext: 65, lifespan: 365 },
  Mathusala: { verseKey: "genesis-5-25", ageAtNext: 187, lifespan: 969, displayName: "Methuselah" },
  Lamech: { verseKey: "genesis-5-28", ageAtNext: 182, lifespan: 777 },
  Noe: { verseKey: "genesis-5-32", ageAtNext: 500, lifespan: 950, displayName: "Noah" },
  Sem: { verseKey: "genesis-11-10", ageAtNext: 100, lifespan: 600, displayName: "Shem" },
  Arphaxad: { verseKey: "genesis-11-12", ageAtNext: 35, lifespan: 438 },
  Sala: { verseKey: "genesis-11-14", ageAtNext: 30, lifespan: 433, displayName: "Salah" },
  Heber: { verseKey: "genesis-11-16", ageAtNext: 34, lifespan: 464, displayName: "Eber" },
  Phalec: { verseKey: "genesis-11-18", ageAtNext: 30, lifespan: 239, displayName: "Peleg" },
  Ragau: { verseKey: "genesis-11-20", ageAtNext: 32, lifespan: 239, displayName: "Reu" },
  Saruch: { verseKey: "genesis-11-22", ageAtNext: 30, lifespan: 230, displayName: "Serug" },
  Nachor: { verseKey: "genesis-11-24", ageAtNext: 29, lifespan: 148, displayName: "Nahor" },
  Thara: { verseKey: "genesis-11-26", ageAtNext: 70, lifespan: 205, displayName: "Terah" },
  Abraham: { verseKey: "genesis-21-5", ageAtNext: 100, lifespan: 175 },
  Isaac: { verseKey: "genesis-25-26", ageAtNext: 60, lifespan: 180 },
  Jacob: { verseKey: "genesis-47-28", ageAtNext: null, lifespan: 147 },
};

// Walk the chain assigning Anno Mundi years. "Cainan" appears twice in
// Luke's list (once matching Genesis 5, once an extra generation the
// Masoretic Genesis text doesn't have) — only the first occurrence, right
// after Enos, gets Genesis data; the second is left undated.
let cumulativeYear = 0;
let cainanAssigned = false;

chain.forEach((entry) => {
  const isDuplicateCainan = entry.name === "Cainan" && cainanAssigned;
  const genData = !isDuplicateCainan ? GENESIS_DATA[entry.name] : null;
  if (entry.name === "Cainan") cainanAssigned = true;

  if (genData) {
    entry.displayName = genData.displayName || entry.name;
    entry.genesisVerseKey = genData.verseKey;
    entry.bornYear = cumulativeYear;
    entry.diedYear = genData.lifespan != null ? cumulativeYear + genData.lifespan : null;
    if (genData.ageAtNext != null) cumulativeYear += genData.ageAtNext;
  } else {
    entry.displayName = entry.name;
    entry.bornYear = null;
    entry.diedYear = null;
  }
});

// Matthew 1:1-16 gives a second, divergent line from David to Jesus — the
// legal/royal line through Solomon and the kings of Judah, rather than
// Luke's through Nathan (see https://www.ldolphin.org/2adams.html, on the
// two genealogies). Adam through David is identical to the Luke chain
// above, so this branch only needs to start at Solomon.
const matt = bible.books.find((b) => b.id === "matthew");
const mattVerses = matt.chapters[0].verses.slice(0, 16); // Matthew 1:1-16
const mattText = mattVerses.map((t, i) => ({ text: t, verseKey: `matthew-1-${i + 1}` }));
const matthewBranch = [];
mattText.forEach(({ text, verseKey }) => {
  [...text.matchAll(/([A-Z][a-z]+)(?: the king)? begat ([A-Z][a-z]+)/g)].forEach((m) => {
    matthewBranch.push({ father: m[1], name: m[2], verseKey });
  });
});

// Trim to Solomon onward (David begat Solomon is the branch point) and drop
// the trailing "Jacob begat Joseph" duplicate name collision with Luke's
// Jacob (different person, Joseph's father per Matthew).
const solomonIdx = matthewBranch.findIndex((e) => e.name === "Solomon");
const branch = matthewBranch.slice(solomonIdx).map((e) => ({
  name: e.name,
  displayName: e.name,
  fatherName: e.father,
  verseKey: e.verseKey,
  bornYear: null,
  diedYear: null,
}));
branch.push({ name: "Jesus", displayName: "Jesus", fatherName: "Joseph", verseKey: "matthew-1-16", bornYear: null, diedYear: null });

fs.writeFileSync(path.join(DATA_DIR, "genealogy.json"), JSON.stringify({ chain, matthewBranch: branch }));

const datedCount = chain.filter((e) => e.bornYear != null).length;
console.log(`Wrote genealogy.json: ${chain.length} people in Luke's chain, ${datedCount} with computed Anno Mundi years (Adam through Jacob)`);
console.log(`Last dated person: ${chain.filter((e) => e.bornYear != null).slice(-1)[0]?.displayName}, born AM ${chain.filter((e) => e.bornYear != null).slice(-1)[0]?.bornYear}`);
console.log(`Matthew's parallel line (Solomon through Jesus): ${branch.length} people`);
