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

### Phase 2 — Rendering & interaction (DONE, built 2026-07-29)
- **Design pivot from the original plan:** rather than long-press-on-any-word (which conflicts with the existing verse-click-to-select interaction — plain click on verse text already means "select for tagging"), the feature is triggered from the existing single-verse selection: selecting exactly one verse reveals a **"Study words…"** button in the floating selection bar (`app.js` `updateSelectionBar()`), which opens a right-side panel. This was the user's suggestion mid-build and is a better fit — it reuses the selection mechanism from feature 1 instead of adding a parallel interaction mode, and required no changes to existing verse-click/range-selection behavior at all.
- New `#wordStudyPanel` side panel (`index.html`, styled in `styles.css`): word chips for every token in the selected verse (tappable if it carries a Strong's number, disabled/greyed if not — e.g. "the", "and"), each chip opening a detail view.
- `data/strongs-tokens.json`, `data/strongs-lexicon.json`, `data/strongs-concordance.json` are lazy-loaded on first use (`loadStrongsData()` in `app.js`) rather than at app init, so normal reading-view load time is unaffected by the ~26MB of Strong's data.
- Detail view shows the full lexicon card (lemma, transliteration, Strong's #, part of speech, definition, translation-breakdown pills, live occurrence count from the concordance) plus **Tag all occurrences…** (feeds directly into the existing `openTagAssign()` bulk-tag mechanism from feature 1 — same modal, same code path) and **Copy study note** (clipboard, pre-formatted markdown template).
- Verified live end-to-end against the running app: selected Genesis 1:1 → chips rendered exactly matching the tokenized words → tapped "beginning" → correct H7225 lexicon card rendered → "Tag all occurrences…" opened the tag-assign modal pre-loaded with all 51 verses containing H7225 (confirmed via the existing concordance index) → closed without polluting real tag data.
- Bug found and fixed along the way: ~95% of lexicon entries (11,514 of 12,040) contained literal undecoded HTML entities in their definitions (e.g. `&#8212` instead of an em dash) — fixed in `scripts/import-strongs.js` with an entity-decoding pass, re-ran the import, verified clean output.
- Known limitation carried over from feature 1: this uses the app's plain-text substring search infrastructure nowhere here, so nothing new to note there — but the panel currently shows the raw kaiserlik word text (not the app's original wording) for chip labels, per the earlier text-replacement decision; the reading view itself is untouched.

### Phase 3 — Side panel upgrade (DONE, built 2026-07-29)
- Confirmed with the user: keep the side-panel form factor permanently rather than building a separate mobile-style bottom sheet — it was judged to work for both desktop and mobile, so the original "bottom sheet" framing from the initial spec is retired in favor of this panel.
- **Translation-breakdown donut chart**: hand-rolled with a single CSS `conic-gradient` (no charting library, no new dependency), color-coded legend below it with word/count/percentage per translation. Replaces the flat pill list from Phase 2.
- **Full scrollable concordance list**: expandable "N occurrences in this text ▾" toggle reveals every verse containing the word, with the same All/OT/NT + per-book filter-chip pattern used in feature 1's search results (book chips scoped to only the books the word actually appears in). Capped at rendering 300 rows at a time (`CONCORDANCE_RENDER_CAP`) with a "narrow with a filter" prompt beyond that, since a handful of very common tagged words (e.g. Greek "and") could otherwise render thousands of DOM nodes.
- Clicking a concordance row closes the panel and navigates straight to that verse (reuses `goToVerseInChapter`), selecting it there.
- Verified live: opened G26 (agapē) from Romans 5:8 → donut/legend rendered correctly (74.8% love, 24.3% charity, 0.9% dear) → expanded to all 108 occurrences → filter narrowed to Romans (9 rows, including a genuine double-count at Romans 13:10 where "love" appears twice in one verse — concordance correctly reflects per-word occurrences, not per-verse) → clicked a row → panel closed and app navigated to Romans 5 with that verse selected.
- This closes out feature 2 end-to-end: lexicon card, translation chart, full concordance with filters, tag-all-occurrences, and copy-study-note are all built and working.

**Dependencies:** none remaining — Phase 0 resolved 2026-07-29.

---

## 3. Automated Tagging Engine

Three sub-features, decreasing in readiness:

### A. Strong's-number rule tagging (DONE, built 2026-07-29)
e.g. "auto-tag any verse containing G26 with #AgapeLove."

- Tags gained an optional `rule: {strongs: "G26"}` field. A verse's *effective* tags = its manually-assigned `verseTags` merged live with every rule-tag whose Strong's number appears in that verse (`effectiveTagIdsForKey()` in `app.js`) — computed at render time from the concordance index, never written into `verseTags`, so it can't corrupt or overwrite the user's manual tagging data.
- Rule creation happens right where it's contextually useful: the word study side panel (feature 2) gained an "Auto-tag verses with this word" pill row — toggle an existing tag on/off as a rule for the currently-viewed Strong's number, or hit "+ new" to create a fresh rule-tag on the spot.
- All three tag-consuming surfaces were updated to merge smart-tag matches with manual tags: the reading view's tag dot (`buildVerseSpan`), the verse-detail chip list (smart-only tags render as a visually distinct dashed "auto" chip, since removing them doesn't make sense — you'd edit the rule, not the verse), and the Tags browse view (filter-pill counts and the verse list itself, which is capped at 500 rendered entries with a "narrow with a filter" prompt beyond that, mirroring the cap pattern from feature 1's search).
- Performance: the ~5MB `strongs-concordance.json` is lazy-loaded on first use (creating/toggling a rule, or opening the word study panel), except it's loaded eagerly at app init *only if* a smart tag rule already exists from a previous session — so users who never touch this feature pay zero extra load cost.
- **Real bug found and fixed during verification, not cosmetic:** rendering the Tags browse view crashed (`Cannot read properties of undefined (reading 'verses')`) the first time a smart tag's concordance included a verse from one of the five single-chapter books (Obadiah, Philemon, 2 John, 3 John, Jude) — the exact pre-existing `data/bible.json` bug flagged during the Phase 1 data spike (those books stored `chapters` as a bare object instead of a one-element array) had never actually been hit by any other code path until this feature exercised it. Fixed at the data level (`data/bible.json` now stores `chapters` as an array for all 66 books), which also protects the reading/search/verse-detail views from the same latent bug.
- Verified live: created a rule-tag on G26 from Romans 5:8 → Matthew 24:12 (never manually tagged) correctly picked up the tag and its dot → verse-detail showed a dashed "auto" chip → Tags browse view showed "AgapeLove · 99" (99 distinct verses — correctly deduplicated from the concordance's 108 raw word-occurrences, since a few verses use the word twice) → filtering to it rendered 88 grouped passage cards.

**Dependencies:** none — built on Tap-to-Study's Phase 0/1 concordance index, already shipped.

### B1. Topic smart folders (DONE, built 2026-07-29)

- **Source: [`BradyStephenson/bible-data`](https://github.com/BradyStephenson/bible-data)**, `NavesTopicalDictionary.csv` — CC BY 4.0, confirmed via the actual LICENSE file. Attribution: Brady Stephenson, "BibleData: Structured Datasets from the Holy Bible" (Zenodo).
- The source format needed real parsing, not a straight import: each of the 5,319 topic rows has a block of `-description BOOK C:V,V-V; BOOK C:V; C:V` sub-entry lines, mixing free-text descriptions with a trailing (sometimes book-omitting, sometimes chapter-omitting) reference list. [`scripts/import-topics.js`](../scripts/import-topics.js) locates the first recognized book token per line, treats everything from there onward as the reference zone, and parses semicolon-separated groups (each optionally starting a new book, always containing `chapter:verse-list`) with comma-separated verses/ranges within each group. Book abbreviations are normalized through a generous alias table since the source itself is inconsistent (both `JHN` and `JOHN` appear for John's Gospel).
- Results: **4,665 of 5,319 topics (87.7%) resolved at least one verse**; 98.8% of individual reference groups parsed cleanly (59,235 parsed, 737 skipped as unparseable — logged, not silently dropped). All resolved verse references are validated against `data/bible.json`'s actual chapter/verse counts — 19 invalid references (e.g. `daniel 17:14`, a chapter that doesn't exist — a data error in the original Nave's text, not this import) were caught and dropped rather than shipped as dead links. Output: `data/topics.json` (2.77MB), same shape as feature 3A's concordance (`{topicName: [verseKey, ...]}`).
- UI: generalized the smart-tag `rule` field to accept `{topic: "AARON"}` alongside `{strongs: "G26"}` — `getSmartTagSets()`, `effectiveTagIdsForKey()`, etc. now resolve either kind transparently. New tag creation (from the Tags view's "+ Add" flow, not the word-study panel) gained an optional "Auto-tag by topic" field with a native `<datalist>` autocomplete over all 4,665 topic names, lazy-loaded on first open. Added a confirmation prompt if toggling a Strong's-number rule from the word study panel would overwrite an existing topic rule on the same tag (rules are one-per-tag; silently clobbering felt like a real footgun).
- Verified live: created a topic tag for "PARABLES" → the datalist offered all 4,665 topics → first matching verse (Judges 9:8, Jotham's parable of the trees — a real, correct match) picked up the tag dot immediately.

**Dependencies:** none — fully shipped.

### B2. Named-entity smart tags (people, e.g. "David") — DONE, built 2026-07-29

- A pre-built open dataset existed after all: **`BibleData-PersonVerse.csv` + `BibleData-Person.csv`**, same repo as 3B1 (`BradyStephenson/bible-data`), same CC BY 4.0 license already verified. No NER model needed.
- **Real scope change from the original spec, confirmed with the user before building:** the spec described tapping a name *directly in the reading text* (e.g. tap "David" mid-verse). The dataset only records "David appears in Ruth 4:17," not *which word* in that verse's text is his name — a verse can refer to someone via a pronoun or title instead of the literal name, so reliably highlighting the right word in-text isn't supported by this data (same limitation as 3B1's topics). Built instead as a **person smart tag** — the identical mechanism as 3A/3B1, selected via search/autocomplete rather than tapped in text. Places (`BibleData-Place`/`BibleData-PlaceVerse`, same repo) are available for a future pass but weren't in scope for this round.
- Format is simpler to parse than Nave's: each `PersonVerse` row is already one clean `"GEN 1:1"` reference per verse — just book-abbreviation normalization + validation against `data/bible.json`, no range/list grammar.
- The real work was **disambiguation**: ~3,000 distinct `person_id`s frequently share a first name (multiple Jameses, Marys, etc.), so [`scripts/import-persons.js`](../scripts/import-persons.js) builds a unique, human-readable label per person — plain name if unique, else `"Name (short clause from unique_attribute)"` (with citation suffixes like `"(MAT 4:21)"` stripped to avoid doubled-up parens), falling back to `"Name #sequence"` for the handful of people with no usable disambiguating text. `data/persons.json` is keyed directly by these final labels, same shape as `topics.json`.
- Results: 2,992 people with at least one resolvable verse, 29,413 verse links, 121 invalid verse references dropped (0.27%, same validation-against-bible.json pattern as 3B1), 0 unresolved references or person IDs.
- Generalized the smart-tag `rule` field again to accept `{person: "David"}` alongside `{strongs}`/`{topic}` — same live matching, same one-rule-per-tag overwrite confirmation in the word-study panel. New tag creation gained a second optional "Auto-tag by person" autocomplete field alongside the topic one.
- Verified live: created a person tag for "David" → 2,992-entry datalist populated correctly → first matching verse (Ruth 4:17, Obed named as David's grandfather — correct) picked up the tag immediately.

**Dependencies:** none — fully shipped.

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

Features 2, 3A, 3B1, and 3B2 all converge on the same rendering concept: **tags computed at display-time from a rule or index, merged visually with manually-assigned tags, without writing into `verseTags`.** Built as a shared `tag.rule: {strongs|topic|person}` field rather than three separate mechanisms.

Feature 1's multi-select + bulk-tag-apply mechanism is a direct prerequisite for the "tag all occurrences" actions in features 2 and 3A.

### Tags/Topics UI split (2026-07-29, post-ship revision)

After 3A/3B1/3B2 shipped, real usage surfaced that auto-tags (rule-based) and manual tags didn't belong in the same creation flow or the same mental model — auto-tags are closer to "topics" (discoverable, browsable, rule-driven) than to manual tags (deliberately, individually applied). Restructured:

- **Tags page** — manual tags only. Filter pills and the default verse-browsing list exclude any tag with a `rule`. "+ New Tag" creates a plain tag with no rule fields shown.
- **New Topics page** (new sidebar nav item) — the home for everything rule-based: "Your Auto-Tags" (list of existing rule-tags with an inline description of what they match, click through to browse their verses via the Tags page's existing list rendering, "Edit" to change/clear the rule), and a "Browse Topics" tab (the searchable list of all 4,665 Nave's topics from 3B1, "+ Tag" to create a smart tag directly from a topic).
- The New/Edit Tag modal is now unified across both pages and both create/edit — `openNewTagModal(opts)` takes a `manualOnly` flag to hide the three rule fields (Strong's number, topic, person) when opened from a manual-tagging context (Tags page's "+ New Tag", or the per-verse "+Add" in the tag-assign modal used while tagging a selection).
- The word study panel's "Auto-tag this word…" button now jumps to the Topics page (was the Tags page) with the Strong's number pre-filled.
- Strong's-number rules can now also be typed directly (e.g. `G26`) into the unified modal, not just reached by tapping a word — so all three rule types (Strong's, topic, person) are creatable from one place (the Topics page), while still supporting the word-study shortcut for convenience.

### Browse Topics categorization (2026-07-29)

4,665 flat, alphabetically-sorted topics was hard to navigate — and Nave's own "section" field turned out to be just an A-Z alphabetical grouping, not a thematic category, so it offered nothing beyond what sorting already gives. Rather than leave it flat, [`scripts/categorize-topics.js`](../scripts/categorize-topics.js) buckets every topic into **People** / **Places** / **Topics & Themes** by cross-referencing topic names against the person dataset (3B2) and a place dataset from the same source repo (`BibleData-Place.csv`, not previously pulled in). Results: 1,448 People, 63 Places, 3,154 Topics & Themes — written to `data/topic-categories.json`, surfaced as filter chips (with live counts) above the Browse Topics list.

Known limitation, flagged to the user before building and accepted as-is: the place dataset only has 113 unique names, and person-name matching requires an exact match after stripping disambiguation suffixes, so some genuine people/places (e.g. "ABED-NEGO", the river "ABANA") fall through to "Topics & Themes" rather than their correct bucket. This is a real, useful, data-backed split, not a perfect taxonomy — a true thematic categorization (Christian Living, Prophecy, etc.) isn't available in any sourced dataset and would need manual curation or an AI classification pass, which was explicitly deferred.

## Smart search: synonyms, proximity, saved rules (2026-07-29)

Three requested capabilities, all shipped:

- **Synonym/semantic expansion** — rather than sourcing a new English thesaurus (generic synonym lists don't capture biblical nuance, e.g. "peace" vs "rest" are different Hebrew roots entirely but thematically related), this reuses Nave's Topical Bible data already in the app (3B1). If the search query exactly matches a topic name, a banner offers to include that topic's verses (curated, related-word matches) alongside the literal text matches, clearly marked "via topic" on each card so it's not confused with a literal match.
- **Proximity/AND search** — a second "AND" input field next to the main search box (chosen over inline `term AND term` syntax, to avoid a syntax users would need to discover). Matches verses containing both terms as substrings, independent of order or position within the verse.
- **Saved search → Auto-Tag** — extends the `tag.rule` system with a fourth type, `{phrase: "...", phraseAnd?: "..."}`, computed live by scanning `bible.json` directly (no new data file needed — cheap enough at ~31k verses to run on demand, invalidated the same way as the other rule types). A "Save as Auto-Tag…" button on the search results page jumps to the Topics page with the current query pre-filled into a new auto-tag.
- Real bug caught during verification: `clearSelection()` still referenced the pre-rename `lastSearchResults` variable after `runTextSearch`'s result state was split into `baseSearchResults` (literal matches) vs. the topic-merged display set — fixed before shipping.

## Audio: read chapter aloud (2026-07-29)

Added a "read chapter aloud" control to the reading view, using the browser's built-in Web Speech API (`speechSynthesis`) — zero cost, zero new dependencies, fits the app's static-site architecture. Speaks one verse per `SpeechSynthesisUtterance`, chained via `onend`, rather than one utterance for the whole chapter — that's what makes per-verse highlighting (reuses `.speech-active` on the same span the reading view already builds) and reliable pause/resume possible. Controls: play/pause, stop, rate (0.75×–2×), and a voice picker (populated from `speechSynthesis.getVoices()`, English voices only), both persisted to `localStorage`. Playback stops automatically on chapter navigation or leaving the reading view, so it can't keep talking over a chapter you've since left. Verified via state-machine checks (queue construction, highlight application, pause/resume/stop transitions, stop-on-navigate) — actual audio output isn't verifiable through automated tooling, so real listening confirmation is still worth doing.

## Auto-tags moved out of the reading view (2026-07-29, post-ship revision)

User feedback after using the Topics feature: auto-tags showing the same colored tag-dot highlighting as manual tags in the main reading view read as clutter — "Topics feel less like tags and more like a focused reading." Two changes:

- `buildVerseSpan` (main reading view) reverted to manual tags only — auto-tags no longer render any inline highlighting there. `effectiveTagIdsForKey()` (the manual+smart merge helper) became dead code as a result and was removed; the Tags page's filter bar/verse list were simplified back to pure manual-tag logic too (dropped the "orphaned active pill" fallback for auto-tags, since auto-tags no longer route through the Tags page at all).
- Clicking an auto-tag in "Your Auto-Tags" (Topics page) now opens a new dedicated **Topic Reading view** instead of landing on the Tags page's card list — consecutive verses grouped into passages and rendered with the main reading view's own typography and `buildVerseSpan` (so a verse the user *has* manually tagged still shows that — only the auto-tag itself is excluded from inline highlighting). Verse detail's smart-tag chips are unaffected (still shown there; it's an explicit detail view, not reading-flow clutter).

## 4. Progressive Web App / Offline Support

Add a web app manifest + service worker so the app installs to a home screen and the reading experience keeps working without a connection.

**Effort: S/M**

- No external dependency — the app is already a static site with all Bible text/topics/lexicon data as committed JSON files under `data/`, which is exactly what a service worker cache-first strategy wants.
- New pieces: `manifest.json` (name, icons, theme color — none currently exist, confirmed via `find . -iname "manifest*"`), a service worker registered from `index.html` that precaches the app shell (`index.html`, `app.js`, `styles.css`) and the core `data/*.json` files, and an install-prompt affordance.
- **Split by what can go offline vs. what can't**: reading, search, tagging (writes to `localStorage`... no — tags/notes are server-backed via `netlify/functions/tags.js`, so offline tagging needs a queue), and the Strong's/topics/persons datasets (already lazy-loaded, already static JSON, trivially cacheable) all work offline for *reading*. Anything that calls a Netlify Function (tag/note writes, Studies, sharing, YouVersion/Google auth) needs the network — either disable those affordances with an "offline" indicator, or queue writes and sync on reconnect (bigger scope, see below).
- **Two tiers worth distinguishing**: (a) offline *reading* — cache the static data files, near-free, no write-conflict risk; (b) offline *writes* (tag/note edits queued while offline, flushed on reconnect) — real scope, needs conflict handling since `tags.js` currently does a full-blob read-modify-write with no version check. Recommend shipping (a) alone first.
- Known limitation: the largest data files (`data/strongs-tokens.json` 15.6MB, `data/strongs-lexicon.json` 4.9MB, `data/strongs-concordance.json` 5.1MB, `data/topics.json` 2.77MB) total ~30MB — fine as lazy-loaded runtime cache entries (cached only once actually used, matching today's lazy-load behavior) but wrong to precache eagerly at install time on mobile data.

**Dependencies:** none. Fully unblocked for tier (a); tier (b) benefits from having accounts/sync (#5, #6 below) settled first so there's a clear place to reconcile queued writes.

---

## 5. Cross-Device Reading Position Sync

Today "last read verse" (`bible-study:lastLocation` in `localStorage`, `app.js:199,349`) and sidebar/speech preferences are device-local only — opening the app on a second device starts back at Genesis 1.

**Effort: S** once accounts exist, **not sensibly buildable before then**

- The blocking dependency is real, not just convenient sequencing: syncing "last read verse" server-side requires a concept of *whose* position it is. Today the app has no per-user identity at the data layer (see [accounts-scoping.md](accounts-scoping.md)) — only a shared site password. Building this first would mean inventing a throwaway single-blob sync mechanism that gets thrown away again once accounts land.
- Once accounts ship: near-free addition, reuses the exact same per-user blob pattern accounts already introduces for tags/notes (`tags-<yvp_id>.json` per accounts-scoping.md) — e.g. a `prefs-<yvp_id>.json` blob (or a field within the user's existing tags blob) holding `{lastLocation, sidebarCollapsed, speechRate, speechVoiceURI}`, all fields that already exist as individual `localStorage` keys in `app.js` today and just need a write-through to the per-user blob alongside the existing `localStorage.setItem` calls.
- Conflict handling is trivial here (unlike tag edits) — last-write-wins is the correct behavior for "where was I reading," no merge logic needed.

**Dependencies:** [Multi-User Accounts](accounts-scoping.md) (specifically, per-user blob storage existing at all). Sequence *after* accounts, not before.

---

## 6. Export Studies / Tags / Notes

Let a user export their tagged verses, notes, or a Study as a document — for printing, sharing outside the app, or backup.

**Effort: S** for plain text/Markdown, **M** if PDF is required

- No external data dependency — this reads existing in-app data (`tagsData.verseTags`/notes, `categoriesData` Studies) and existing `data/bible.json` verse text; nothing new to source.
- **Markdown/plain-text export (S)**: a "Export" button on the Tags page (per-tag) and Studies page (per-Study) that walks the already-rendered verse list and serializes to a downloadable `.txt`/`.md` file client-side (`Blob` + `URL.createObjectURL`, no server round-trip, no new dependency) — same underlying verse-grouping logic the reading views already use.
- **PDF export (M)**: same content, formatted — either `window.print()` with a dedicated print stylesheet (near-free, no library, but less control over pagination/branding) or a client-side PDF library (adds a real dependency to a currently zero-dependency frontend — worth avoiding unless print-to-PDF proves visibly ugly in practice). Recommend trying the print-stylesheet route first since it's free to attempt and may be good enough.
- Natural pairing with `share.html` (existing share-view page) — that page already renders a single tag's verses for an unauthenticated viewer; the export feature can likely reuse its rendering logic rather than building a third verse-list renderer.
- Open question: export a single tag/Study at a time (simpler, matches existing per-tag/per-Study UI surfaces), or a full "export everything" dump (more useful as a backup, but a new aggregate view with no existing UI analog).

**Dependencies:** none. Fully unblocked — independent of accounts and can ship anytime.

---

## Effort summary

| Feature | Effort | Blocked on |
|---|---|---|
| 1. Search & Select Batch Tagging | **M** | ~~Nothing~~ **Done, shipped 2026-07-29** |
| 3A. Strong's rule tagging | **Done** | Shipped 2026-07-29 |
| 2. Tap-to-Study Word Study Sheet | **Done** | All phases shipped 2026-07-29 |
| 3B1. Topic smart folders (Nave's) | **Done** | Shipped 2026-07-29 |
| 3B2. Named-entity smart tags (people) | **Done** | Shipped 2026-07-29 |
| 3C. AI semantic tagging | **XL** | Infra/provider decision, not data |
| 4. PWA / Offline Support (reading tier) | **S/M** | Nothing — unblocked |
| 4b. PWA offline writes (queued sync) | **L** | Benefits from accounts (#5/#6 sync pattern) |
| 5. Cross-Device Reading Position Sync | **S** | [Multi-User Accounts](accounts-scoping.md) |
| 6. Export Studies/Tags/Notes | **S–M** | Nothing — unblocked |

## Suggested sequencing

1. ~~**Feature 1**~~ — done, shipped.
2. ~~**Data spike: Tap-to-Study Phase 0**~~ — resolved; source is `kaiserlik/kjv` (see feature 2 above).
3. **Feature 2, Phase 1** — build the import script and data layer (tokenize KJV text, reshape lexicon, derive concordance index). Unblocks both the full bottom-sheet UI and feature 3A.
4. **Feature 3A** — near-free once Phase 1 lands, reuses feature 1's bulk-tag mechanism.
5. **Feature 2, Phases 2-3** — word-tap interaction + bottom sheet UI, once Phase 1 data exists.
6. **Feature 3B1** — independent data source, can run in parallel with any of the above.
7. **Features 3B2 / 3C** — revisit after the above; each needs its own scoping spike before a real effort estimate is possible.
8. **Feature 6 (Export)** — cheap, independent, no reason to wait; good filler between larger efforts.
9. **Feature 4 (PWA, reading tier)** — cheap, independent; do once the data-file footprint (Strong's/topics files) has stabilized so the cache list doesn't need immediate rework.
10. **Multi-User Accounts** ([accounts-scoping.md](accounts-scoping.md)) — the big architectural item; once it ships, unblocks:
11. **Feature 5 (Reading position sync)** — near-free follow-on to accounts.
12. **Feature 4b (PWA offline writes)** — revisit once accounts establish the per-user write/sync pattern to reuse for conflict resolution.
