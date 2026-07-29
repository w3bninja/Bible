# Feature Scoping: Word Study & Tagging Workflows

Status: scoping only, nothing implemented yet. Effort scores are rough (S/M/L/XL) based on how much is new build vs. reuse of existing app.js/tags/verse infrastructure, and whether external data/infra is required.

Effort scale:
- **S** — days, self-contained, no new data source, mostly reuses existing patterns
- **M** — a week+ equivalent, new UI surface and/or moderate data modeling, no external unknowns
- **L** — new data source integration and/or new architecture pattern (e.g. computed/virtual tags), real design decisions to make
- **XL** — depends on an unresolved external dependency (data license/format unverified, or new infra like AI/embeddings) before real scoping is even possible

---

## 1. Search & Select Batch Tagging

Search for a term, get a checkbox list of matching verses, filter by testament/book/author-group, bulk-apply tags via a floating action bar.

**Effort: M**

- No external data dependency — works against current plain-text `data/bible.json` as-is.
- Reuses ~70% existing infrastructure: `verseTags` model, tag-assign modal, book/testament metadata, and generalizes the existing verse range-selection pattern (`app.js:215-238`) to non-contiguous multi-select.
- New pieces: keyword search (client-side substring match), results list UI with checkboxes, filter chips, floating action bar.
- Known limitation: plain keyword search only (e.g. "joy" won't catch "rejoice") until Strong's data exists — noted, not blocking.
- Open question: build as a new screen, or extend the existing chapter-picker popup search into a results-with-checkboxes state.

**Dependencies:** none. Fully unblocked.

**Why it's a good first pick:** cheapest of everything scoped, ships value immediately, and the "select N verses → bulk action" mechanism it builds is a direct prerequisite for the "Tag All Occurrences" action in both Tap-to-Study and Automated Tagging below — building it first de-risks those.

---

## 2. Tap-to-Study Word Study Sheet

Long-press/tap a word to open a bottom sheet: Strong's lexicon card, translation-breakdown chart, full concordance list, and one-tap actions (tag all occurrences, copy study note).

**Effort: L** (was XL — data source now resolved)

### Phase 0 — Data sourcing (RESOLVED 2026-07-29)
- Need: KJV text tagged word-by-word with Strong's numbers, and a Strong's lexicon (definitions/transliteration/pronunciation).
- Investigated and ruled out: `openscriptures/strongs` (lexicon-only, GPL 3.0 on compiled edition), `scrollmapper/bible_databases` (README claimed KJV+Strong's but the actual exported `KJV.json` verified to contain only `{verse, text}`, no tagging), STEPBible-Data (CC BY 4.0, but no direct KJV mapping, only ESV/original-language).
- **Chosen source: [`kaiserlik/kjv`](https://github.com/kaiserlik/kjv)** — verified by pulling real files directly (not just trusting the README):
  - **Text**: one JSON object per verse keyed `"BookAbbr|chapter|verse"`, KJV text with inline `[G####]`/`[H####]` tags immediately after each tagged word, e.g. `"Paul,[G3972] a prisoner[G1198] of Jesus[G2424] Christ,[G5547] ..."`. Italicized supplied words (KJV's own convention for words with no underlying Greek/Hebrew) are wrapped in `<em>` and correctly carry no Strong's tag. 66 per-book files + `books.json` + `chapter_count.json`.
  - **Lexicon**: `lexicon.json` (~6.3MB), keyed by Strong's number, fields: `Gk_word`/lemma, `transliteration`, `strongs_def`, `part_of_speech`, `root_word`, `outline_usage`, and — unexpectedly useful — **`occurrences`**, a pre-computed string like `"love(86x), charity(28x), dear(1x)"` giving us the translation-breakdown chart data for free, no derivation step needed.
  - **License**: no `LICENSE` file, no license field on the repo (confirmed via GitHub API: `null`). Underlying content (1890 Strong's dictionary, KJV text) is public domain; a reformatting of public-domain facts typically carries thin-to-no compilation copyright under US law, but this is not a guarantee. Decision made 2026-07-29: proceed anyway, treating this as acceptable risk for a personal-use app built on public-domain source material.

### Phase 1 — Data layer (DONE, built 2026-07-29)
- [`scripts/import-strongs.js`](../scripts/import-strongs.js) downloads the 66 book files + `lexicon.json` from `kaiserlik/kjv` (source files gitignored, ~78MB, not checked in — script header documents the `curl` commands to re-fetch) and produces three new committed data files:
  - `data/strongs-tokens.json` (15.6MB) — `{ "<bookId>-<chapter>-<verse>": [{t: "word", s?: ["G26"], i?: true}, ...] }`. `s` is an array (some words carry more than one Strong's number, e.g. an untranslated Hebrew particle stacked onto the preceding word); `i` marks KJV's own italicized/supplied words, which correctly carry no Strong's tag.
  - `data/strongs-lexicon.json` (4.9MB) — reshaped from source, keyed by Strong's number: `lemma`, `translit`, `def`, `pos`, `root`, `outline`, and `translations` (the pre-computed per-English-word counts, e.g. `{"love": 86, "charity": 28, "dear": 1}` for G26).
  - `data/strongs-concordance.json` (5.1MB) — `{ "G26": ["<bookId>-<chapter>-<verse>", ...] }`, derived directly from the tokenized text (authoritative — the odd case where its count doesn't exactly match the lexicon's self-reported `translations` sum is a documented pre-existing quirk in Strong's own numbering, not an import bug).
- Result verified: exactly 31,102 verses tokenized — the correct, well-known total verse count for the KJV — with zero missing-verse warnings.
- Real issues hit and fixed along the way: several source book files contain malformed JSON (unescaped quotes inside unused Bulgarian/Chinese/Spanish parallel-text fields) — worked around with a tolerant regex extractor instead of `JSON.parse`; inconsistent top-level key naming across source files (abbreviation vs. full book name) — worked around by reading the key dynamically; **found and worked around a pre-existing bug in this app's own `data/bible.json`**, where single-chapter books (Obadiah, Philemon, 2 John, 3 John, Jude) store `chapters` as a bare object instead of a one-element array — may also affect the reading view for those books, worth checking separately.
- **Text-mismatch decision (resolved 2026-07-29):** the kaiserlik source text is not always word-for-word identical to this app's existing verse text — 4,492 of 31,102 verses (14.4%) have a differing word count (e.g. Genesis 1:9 in kaiserlik's source omits "and it was so." — a known KJV textual-variant issue, not a bug in either source). Decision: **Phase 2 will replace the app's displayed text with kaiserlik's version outright**, guaranteeing every displayed word aligns with its Strong's tag, accepting minor wording differences on ~14% of verses rather than attempting fragile word-alignment between two slightly different texts.
- Skipped for now (not needed until Phase 2/3): book→author/group table for "Paul's Letters"-style filters.

### Phase 2 — Rendering & interaction
- Rework `buildVerseSpan()` (`app.js:182-211`) to wrap individual words in spans carrying `data-strongs`, without breaking verse readability/spacing.
- Long-press detection for touch; needs a distinct trigger for desktop (no native long-press) — open UX decision.
- Must not conflict with existing verse-level click/range-selection.

### Phase 3 — Bottom sheet UI
- New slide-up sheet component (existing `.modal-overlay` pattern in `styles.css:655-728` is centered-modal only, needs a new variant).
- 4 sections: lexicon card, translation-breakdown chart (open decision: hand-rolled SVG vs. adding the app's first JS dependency), concordance list (needs frequency-threshold handling for common words like "the"/"and" which could have 1000s of hits), action buttons.
- "Tag all occurrences" reuses the bulk-tag mechanism from feature 1.

**Dependencies:** none remaining — Phase 0 resolved 2026-07-29.

---

## 3. Automated Tagging Engine

Three sub-features, decreasing in readiness:

### A. Strong's-number rule tagging
e.g. "auto-tag any verse containing G26 with #AgapeLove."

**Effort: S** (once Tap-to-Study Phase 1 data layer exists — data source itself is now resolved)

- No new data beyond Tap-to-Study's Phase 0/1.
- New concept: computed/"smart" tags — rendered live from a rule + concordance index rather than written into `verseTags`, so they don't mutate user data.
- Effectively the same mechanism as Tap-to-Study's "Tag All Occurrences" action, generalized into a standing rule instead of a one-time action.

**Dependencies:** Tap-to-Study Phase 0/1 (Strong's-tagged text + concordance index).

### B1. Topic smart folders (Nave's Topical Bible / Treasury of Scripture Knowledge)
**Effort: L**

- Both datasets are old enough to likely be public-domain, but need the same treatment as feature 2's data spike: pull a real file, confirm structure and license before scoping further.
- Once sourced: static import (`data/topics.json: {topicId -> [verseKey,...]}`), same computed/non-destructive smart-tag rendering as 3A.
- Independent of Strong's data — could proceed in parallel with Tap-to-Study's Phase 0 spike.

**Dependencies:** its own data-source spike (not yet started).

### B2. Named entity recognition (people/places, e.g. tapping "David")
**Effort: XL**, least defined

- Real NER requires either a pre-built open dataset of entity→verse mappings, or running an actual NER model — this app's architecture (static JS, thin Netlify Function backend) doesn't cheaply support model inference.
- Unknown whether a suitable open dataset exists — has not been investigated yet.

**Dependencies:** unresolved data-source question, more open-ended than any other item here.

### C. Dynamic AI semantic tagging
Free-text prompt (e.g. "tag verses about anxiety") → semantic verse matches.

**Effort: XL**, different category from the rest — an infrastructure decision, not a data-sourcing one

- Requires either local embeddings (model + vector index for ~31,000 verses, real size/perf cost for a currently zero-dependency static app) or a hosted API call per query.
- API-per-query fits the app's existing pattern better (already has a Netlify Function backend) but introduces API key management and per-request cost.
- Precomputing verse embeddings is a one-time batch job, separate from runtime cost.
- Needs a provider/cost decision before it can be scoped in any more detail.

**Dependencies:** infra/provider decision (not a data spike — a different kind of open question).

---

## Cross-cutting design note

Features 2, 3A, 3B1, and 3B2 all converge on the same rendering concept: **tags computed at display-time from a rule or index, merged visually with manually-assigned tags, without writing into `verseTags`.** Worth designing this once as a shared `smartTags` mechanism (e.g. `{id, name, hue, source: 'strongs' | 'topic' | 'entity' | 'semantic', ...}`) rather than building it three separate times.

Feature 1's multi-select + bulk-tag-apply mechanism is a direct prerequisite for the "tag all occurrences" actions in features 2 and 3A.

## Effort summary

| Feature | Effort | Blocked on |
|---|---|---|
| 1. Search & Select Batch Tagging | **M** | ~~Nothing~~ **Done, shipped 2026-07-29** |
| 3A. Strong's rule tagging | **S** (after Phase 1) | Tap-to-Study Phase 1 (data layer build) |
| 2. Tap-to-Study Word Study Sheet | **M** (Phases 2-3 remain) | ~~Data spike~~, ~~Phase 1~~ done — text-alignment decision needed before Phase 2 |
| 3B1. Topic smart folders (Nave's/TSK) | **L** | Own data spike (not started) |
| 3B2. Named-entity auto-tags | **XL** | Undefined — dataset existence unknown |
| 3C. AI semantic tagging | **XL** | Infra/provider decision, not data |

## Suggested sequencing

1. ~~**Feature 1**~~ — done, shipped.
2. ~~**Data spike: Tap-to-Study Phase 0**~~ — resolved; source is `kaiserlik/kjv` (see feature 2 above).
3. **Feature 2, Phase 1** — build the import script and data layer (tokenize KJV text, reshape lexicon, derive concordance index). Unblocks both the full bottom-sheet UI and feature 3A.
4. **Feature 3A** — near-free once Phase 1 lands, reuses feature 1's bulk-tag mechanism.
5. **Feature 2, Phases 2-3** — word-tap interaction + bottom sheet UI, once Phase 1 data exists.
6. **Feature 3B1** — independent data source, can run in parallel with any of the above.
7. **Features 3B2 / 3C** — revisit after the above; each needs its own scoping spike before a real effort estimate is possible.
