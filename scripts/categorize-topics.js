// One-time post-process: buckets each Nave's topic (data/topics.json) into
// "person", "place", or "topic" by cross-referencing against the person
// dataset (data/persons.json) and place dataset (BibleData-Place.csv, same
// source repo as everything else: BradyStephenson/bible-data, CC BY 4.0).
//
// Nave's itself has no thematic categories — its own "section" column is
// just an alphabetical A-Z grouping — so this is the closest to a genuine,
// data-backed category split available without manual curation.
//
// Setup: requires data/topics.json and data/persons.json to already exist
// (run import-topics.js and import-persons.js first), plus:
//   curl -s --ssl-no-revoke -o .tmp-topics-src/BibleData-Place.csv https://raw.githubusercontent.com/BradyStephenson/bible-data/main/BibleData-Place.csv
//
// Run once with: node scripts/categorize-topics.js

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", ".tmp-topics-src");
const DATA_DIR = path.join(__dirname, "..", "data");

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

const topics = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "topics.json"), "utf8"));
const persons = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "persons.json"), "utf8"));

// Strip disambiguation suffixes like " (son of Zebedee)" or " #2836" to get
// the bare name for matching against topic titles, which are plain names.
// Also pulls extra aliases out of the parenthetical itself, since labels
// like "Simon (Peter)" or "Saul (the apostle Paul)" name the person by
// their better-known name there, not in the base label — a plain "Peter"
// or "Paul" topic would otherwise be missed entirely.
const personNames = new Set();
Object.keys(persons).forEach((label) => {
  const base = label.replace(/\s*\(.*\)\s*$/, "").replace(/\s*#\d+\s*$/, "").trim();
  if (base) personNames.add(base.toUpperCase());

  const parenMatch = label.match(/\(([^)]*)\)/);
  if (!parenMatch) return;
  const inner = parenMatch[1];

  // A short, fully title-cased parenthetical (e.g. "Peter") is itself a name.
  if (/^[A-Z][a-zA-Z]*(\s[A-Z][a-zA-Z]*){0,2}$/.test(inner)) {
    personNames.add(inner.toUpperCase());
  }
  // "the apostle Paul", "also called Paul", "surnamed Paul" — take the
  // trailing capitalized word as the alias.
  const trailingName = inner.match(/(?:apostle|called|surnamed|known as)\s+([A-Z][a-zA-Z]*)\s*$/);
  if (trailingName) personNames.add(trailingName[1].toUpperCase());
});

// A few well-known renames the source data doesn't link (it lists only the
// birth name): Abram/Abraham, Sarai/Sarah. "Israel" is deliberately left
// out since it's ambiguous with the nation, not just Jacob.
["ABRAHAM", "SARAH"].forEach((name) => personNames.add(name));

const placeCSV = fs.readFileSync(path.join(SRC_DIR, "BibleData-Place.csv"), "utf8").replace(/^﻿/, "");
const placeRows = parseCSV(placeCSV);
const placeHeader = placeRows[0];
const placeNameIdx = placeHeader.indexOf("place_name");
const placeNames = new Set(placeRows.slice(1).map((r) => (r[placeNameIdx] || "").toUpperCase()).filter(Boolean));

const categories = {};
const counts = { person: 0, place: 0, topic: 0 };

Object.keys(topics).forEach((name) => {
  const upper = name.toUpperCase();
  let category;
  if (personNames.has(upper)) category = "person";
  else if (placeNames.has(upper)) category = "place";
  else category = "topic";
  categories[name] = category;
  counts[category]++;
});

fs.writeFileSync(path.join(DATA_DIR, "topic-categories.json"), JSON.stringify(categories));
console.log(`Wrote topic-categories.json: ${counts.person} people, ${counts.place} places, ${counts.topic} topics/themes`);
