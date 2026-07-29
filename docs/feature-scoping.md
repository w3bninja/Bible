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

**Effort: XL** (blocked on data sourcing)

### Phase 0 — Data sourcing (blocking, unresolved)
- Need: KJV text tagged word-by-word with Strong's numbers, and a Strong's lexicon (definitions/transliteration/pronunciation).
- Investigated so far:
  - `openscriptures/strongs` — lexicon data, viable, GPL 3.0 on the compiled edition (underlying 1890 dictionary is public domain).
  - `scrollmapper/bible_databases` — despite README claiming "KJV with Strong's Numbers," the actual exported `KJV.json` verified to contain only `{verse, text}`, no tagging. Tagged data if present would be in raw `sources/`, unconfirmed.
  - STEPBible-Data — CC BY 4.0, has Greek/Hebrew original-language tagging (TAGNT/TAHOT) and an ESV mapping (TTESV), but **no direct KJV mapping** — not directly usable without building an alignment layer.
  - Best lead, not yet verified: classic Zefania XML / CrossWire Sword "KJV" module lineage — the traditional source most Bible apps' Strong's features derive from. Needs an actual file pulled and inspected (format, license) before committing.
- **Next step before this feature can be scoped further:** a dedicated data spike — download and inspect real sample files, confirm structure and license.

### Phase 1 — Data layer (once Phase 0 resolves)
- Convert source data into a new `data/bible.json` v2 with per-word tokens `{text, strongs}`, replacing current whole-verse strings.
- New `data/strongs-lexicon.json`.
- Derive at import time: concordance index (`strongsNum -> [verseKey,...]`) and translation-breakdown counts (`strongsNum -> {englishWord: count}`).
- New static book→author/group table (for "Paul's Letters"-style filters) — also reusable by feature 3 and by search filters in feature 1.

### Phase 2 — Rendering & interaction
- Rework `buildVerseSpan()` (`app.js:182-211`) to wrap individual words in spans carrying `data-strongs`, without breaking verse readability/spacing.
- Long-press detection for touch; needs a distinct trigger for desktop (no native long-press) — open UX decision.
- Must not conflict with existing verse-level click/range-selection.

### Phase 3 — Bottom sheet UI
- New slide-up sheet component (existing `.modal-overlay` pattern in `styles.css:655-728` is centered-modal only, needs a new variant).
- 4 sections: lexicon card, translation-breakdown chart (open decision: hand-rolled SVG vs. adding the app's first JS dependency), concordance list (needs frequency-threshold handling for common words like "the"/"and" which could have 1000s of hits), action buttons.
- "Tag all occurrences" reuses the bulk-tag mechanism from feature 1.

**Dependencies:** Phase 0 data spike (unresolved). Everything else is scoped and ready once that lands.

---

## 3. Automated Tagging Engine

Three sub-features, decreasing in readiness:

### A. Strong's-number rule tagging
e.g. "auto-tag any verse containing G26 with #AgapeLove."

**Effort: S** (once Tap-to-Study Phase 0/1 data exists — otherwise blocked on the same dependency)

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
| 1. Search & Select Batch Tagging | **M** | Nothing — ready to build |
| 3A. Strong's rule tagging | **S** (after data) | Tap-to-Study Phase 0 |
| 2. Tap-to-Study Word Study Sheet | **XL** | Data spike (Strong's-tagged KJV) |
| 3B1. Topic smart folders (Nave's/TSK) | **L** | Own data spike (not started) |
| 3B2. Named-entity auto-tags | **XL** | Undefined — dataset existence unknown |
| 3C. AI semantic tagging | **XL** | Infra/provider decision, not data |

## Suggested sequencing

1. **Feature 1** — no dependencies, builds the shared multi-select/bulk-tag mechanism everything else needs.
2. **Data spike: Tap-to-Study Phase 0** — resolve KJV+Strong's source, unblocks feature 2 and 3A together.
3. **Feature 3A** — near-free once the spike lands, reuses feature 1's bulk mechanism.
4. **Feature 2** — the full bottom sheet, once data + mechanism both exist.
5. **Feature 3B1** — can run in parallel with step 2's spike if desired, independent data source.
6. **Features 3B2 / 3C** — revisit after the above; each needs its own scoping spike before a real effort estimate is possible.
