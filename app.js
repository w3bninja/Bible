// State
let bible = null;          // { books: [{ id, name, testament, order, chapters: [[verseText,...],...] }] }
let booksById = new Map();
let tagsData = { tags: [], verseTags: {} }; // verseTags[verseKey] = { tagIds: [...], note: "" }

let currentBookId = null;
let currentChapter = 1;
let currentView = "read"; // 'read' | 'search' | 'tag'
let activeTagId = null;
let selection = new Set(); // verseKeys
let lastClickedVerseKey = null;

let saveTimer = null;

const el = (id) => document.getElementById(id);

function verseKey(bookId, chapter, verse) {
  return `${bookId}-${chapter}-${verse}`;
}

function parseVerseKey(key) {
  const parts = key.split("-");
  const verse = Number(parts.pop());
  const chapter = Number(parts.pop());
  const bookId = parts.join("-");
  return { bookId, chapter, verse };
}

function refLabel(bookId, chapter, verse) {
  const book = booksById.get(bookId);
  return `${book ? book.name : bookId} ${chapter}:${verse}`;
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

async function init() {
  try {
    const [bibleData, tagsJson] = await Promise.all([
      fetchJSON("data/bible.json"),
      fetchJSON("data/tags.json").catch(() => ({ tags: [], verseTags: {} })),
    ]);
    bible = bibleData;
    tagsData = tagsJson;
    if (!tagsData.tags) tagsData.tags = [];
    if (!tagsData.verseTags) tagsData.verseTags = {};

    booksById = new Map(bible.books.map((b) => [b.id, b]));

    renderBookSidebar();
    renderTagList();

    const last = JSON.parse(localStorage.getItem("bible-study:lastLocation") || "null");
    if (last && booksById.has(last.bookId)) {
      selectBook(last.bookId, last.chapter || 1);
    } else {
      selectBook("genesis", 1);
    }

    setStatus("Ready");
  } catch (err) {
    console.error(err);
    setStatus("Failed to load data — is the server running?", "error");
  }
}

function setStatus(text, kind) {
  const s = el("status");
  s.textContent = text;
  s.className = "status" + (kind ? ` ${kind}` : "");
}

// ---------- Sidebar / navigation ----------

function renderBookSidebar() {
  const ot = el("otBooks");
  const nt = el("ntBooks");
  ot.innerHTML = "";
  nt.innerHTML = "";

  for (const book of bible.books) {
    const btn = document.createElement("button");
    btn.className = "book-item";
    btn.dataset.bookId = book.id;
    btn.textContent = book.name;
    btn.addEventListener("click", () => selectBook(book.id, 1));
    (book.testament === "OT" ? ot : nt).appendChild(btn);
  }
}

function selectBook(bookId, chapter) {
  currentBookId = bookId;
  currentChapter = chapter || 1;
  selection.clear();
  updateSelectionBar();

  document.querySelectorAll(".book-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.bookId === bookId);
  });

  renderChapterBar();
  renderVerses();
  showView("read");

  localStorage.setItem(
    "bible-study:lastLocation",
    JSON.stringify({ bookId: currentBookId, chapter: currentChapter })
  );
}

function renderChapterBar() {
  const book = booksById.get(currentBookId);
  const bar = el("chapterBar");
  bar.innerHTML = "";
  bar.classList.remove("hidden");

  book.chapters.forEach((_, idx) => {
    const chapNum = idx + 1;
    const chip = document.createElement("button");
    chip.className = "chapter-chip" + (chapNum === currentChapter ? " active" : "");
    chip.textContent = chapNum;
    chip.addEventListener("click", () => {
      currentChapter = chapNum;
      selection.clear();
      updateSelectionBar();
      renderChapterBar();
      renderVerses();
      localStorage.setItem(
        "bible-study:lastLocation",
        JSON.stringify({ bookId: currentBookId, chapter: currentChapter })
      );
    });
    bar.appendChild(chip);
  });
}

function renderVerses(scrollToVerse) {
  const book = booksById.get(currentBookId);
  const verseTextArr = book.chapters[currentChapter - 1];

  el("chapterHeading").textContent = `${book.name} ${currentChapter}`;
  const container = el("verses");
  container.innerHTML = "";

  verseTextArr.forEach((text, idx) => {
    const verseNum = idx + 1;
    const key = verseKey(book.id, currentChapter, verseNum);
    const row = buildVerseRow(key, verseNum, text);
    container.appendChild(row);
  });

  if (scrollToVerse) {
    const target = container.querySelector(`[data-verse="${scrollToVerse}"]`);
    if (target) target.scrollIntoView({ block: "center" });
  }
}

function buildVerseRow(key, verseNum, text) {
  const row = document.createElement("div");
  row.className = "verse";
  row.dataset.key = key;
  row.dataset.verse = verseNum;
  if (selection.has(key)) row.classList.add("selected");

  const num = document.createElement("div");
  num.className = "verse-num";
  num.textContent = verseNum;

  const body = document.createElement("div");
  body.className = "verse-body";

  const textEl = document.createElement("div");
  textEl.className = "verse-text";
  textEl.textContent = text;
  body.appendChild(textEl);

  const entry = tagsData.verseTags[key];
  if (entry && entry.tagIds && entry.tagIds.length) {
    const chips = document.createElement("div");
    chips.className = "verse-chips";
    entry.tagIds.forEach((tagId) => {
      const tag = tagsData.tags.find((t) => t.id === tagId);
      if (!tag) return;
      chips.appendChild(buildTagChip(tag, key));
    });
    body.appendChild(chips);
  }
  if (entry && entry.note) {
    const note = document.createElement("div");
    note.className = "verse-note";
    note.textContent = entry.note;
    body.appendChild(note);
  }

  row.appendChild(num);
  row.appendChild(body);

  row.addEventListener("click", (e) => handleVerseClick(e, key));
  return row;
}

function buildTagChip(tag, verseKeyStr) {
  const chip = document.createElement("button");
  chip.className = "tag-chip";
  chip.style.background = tag.color;
  chip.title = "Click to remove from this verse";
  chip.innerHTML = `<span>${escapeHtml(tag.name)}</span><span class="chip-remove">×</span>`;
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    removeTagFromVerse(verseKeyStr, tag.id);
  });
  return chip;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Selection ----------

function handleVerseClick(e, key) {
  if (e.shiftKey && lastClickedVerseKey) {
    selectRange(lastClickedVerseKey, key);
  } else if (e.ctrlKey || e.metaKey) {
    toggleSelection(key);
  } else {
    selection.clear();
    selection.add(key);
  }
  lastClickedVerseKey = key;
  applySelectionClasses();
  updateSelectionBar();
}

function toggleSelection(key) {
  if (selection.has(key)) selection.delete(key);
  else selection.add(key);
}

function selectRange(fromKey, toKey) {
  const a = parseVerseKey(fromKey);
  const b = parseVerseKey(toKey);
  if (a.bookId !== b.bookId || a.chapter !== b.chapter) {
    selection.clear();
    selection.add(toKey);
    return;
  }
  const lo = Math.min(a.verse, b.verse);
  const hi = Math.max(a.verse, b.verse);
  selection.clear();
  for (let v = lo; v <= hi; v++) selection.add(verseKey(a.bookId, a.chapter, v));
}

function applySelectionClasses() {
  document.querySelectorAll(".verse").forEach((row) => {
    row.classList.toggle("selected", selection.has(row.dataset.key));
  });
}

function updateSelectionBar() {
  const bar = el("selectionBar");
  if (selection.size === 0) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  el("selectionCount").textContent = `${selection.size} verse${selection.size > 1 ? "s" : ""} selected`;
}

el("clearSelectionBtn").addEventListener("click", () => {
  selection.clear();
  applySelectionClasses();
  updateSelectionBar();
});

// ---------- Tag picker (assign tags to selection) ----------

el("tagSelectionBtn").addEventListener("click", openTagPicker);

function openTagPicker() {
  if (selection.size === 0) return;
  const list = el("tagPickerList");
  list.innerHTML = "";

  if (tagsData.tags.length === 0) {
    list.innerHTML = '<div class="tag-empty">No tags yet — create one from the panel on the right.</div>';
  }

  const keys = [...selection];
  tagsData.tags.forEach((tag) => {
    const anySelected = keys.some((k) => (tagsData.verseTags[k]?.tagIds || []).includes(tag.id));
    const row = document.createElement("label");
    row.className = "tag-picker-row";
    row.innerHTML = `
      <input type="checkbox" data-tag-id="${tag.id}" ${anySelected ? "checked" : ""} />
      <span class="tag-swatch" style="background:${tag.color}"></span>
      <span>${escapeHtml(tag.name)}</span>
    `;
    list.appendChild(row);
  });

  // Prefill note only if exactly one verse is selected and it has a note.
  if (keys.length === 1) {
    el("verseNote").value = tagsData.verseTags[keys[0]]?.note || "";
  } else {
    el("verseNote").value = "";
  }

  el("tagPickerOverlay").classList.remove("hidden");
}

el("tagPickerCancel").addEventListener("click", () => el("tagPickerOverlay").classList.add("hidden"));

el("tagPickerApply").addEventListener("click", () => {
  const checkboxes = el("tagPickerList").querySelectorAll("input[type=checkbox]");
  const note = el("verseNote").value.trim();

  selection.forEach((key) => {
    if (!tagsData.verseTags[key]) tagsData.verseTags[key] = { tagIds: [], note: "" };
    const entry = tagsData.verseTags[key];

    checkboxes.forEach((cb) => {
      const tagId = cb.dataset.tagId;
      const has = entry.tagIds.includes(tagId);
      if (cb.checked && !has) entry.tagIds.push(tagId);
      if (!cb.checked && has) entry.tagIds = entry.tagIds.filter((id) => id !== tagId);
    });

    if (note) entry.note = note;
    else if (selection.size === 1) entry.note = "";

    if (entry.tagIds.length === 0 && !entry.note) delete tagsData.verseTags[key];
  });

  el("tagPickerOverlay").classList.add("hidden");
  selection.clear();
  applySelectionClasses();
  updateSelectionBar();
  renderVerses();
  renderTagList();
  scheduleSave();
});

function removeTagFromVerse(key, tagId) {
  const entry = tagsData.verseTags[key];
  if (!entry) return;
  entry.tagIds = entry.tagIds.filter((id) => id !== tagId);
  if (entry.tagIds.length === 0 && !entry.note) delete tagsData.verseTags[key];
  renderVerses();
  renderTagList();
  if (currentView === "tag") renderTagView(activeTagId);
  scheduleSave();
}

// ---------- Tags panel (CRUD) ----------

let editingTagId = null;

el("newTagBtn").addEventListener("click", () => {
  editingTagId = null;
  el("tagEditTitle").textContent = "New Tag";
  el("tagName").value = "";
  el("tagColor").value = randomColor();
  el("tagDeleteBtn").classList.add("hidden");
  el("tagEditOverlay").classList.remove("hidden");
});

function randomColor() {
  const palette = ["#e0a72e", "#3f9d5c", "#4a7bd4", "#c25b8b", "#7a5cc2", "#d4603f", "#4bb2b8"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function renderTagList() {
  const list = el("tagList");
  list.innerHTML = "";

  if (tagsData.tags.length === 0) {
    list.innerHTML = '<div class="tag-empty">No tags yet. Create one to start categorizing verses.</div>';
    return;
  }

  tagsData.tags.forEach((tag) => {
    const count = Object.values(tagsData.verseTags).filter((e) => e.tagIds.includes(tag.id)).length;

    const row = document.createElement("div");
    row.className = "tag-row" + (activeTagId === tag.id && currentView === "tag" ? " active" : "");
    row.innerHTML = `
      <span class="tag-swatch" style="background:${tag.color}"></span>
      <span class="tag-row-name">${escapeHtml(tag.name)}</span>
      <span class="tag-row-count">${count}</span>
      <button class="tag-row-edit" title="Edit tag">✎</button>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".tag-row-edit")) return;
      activeTagId = tag.id;
      showView("tag");
      renderTagView(tag.id);
      renderTagList();
    });
    row.querySelector(".tag-row-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openTagEditor(tag);
    });
    list.appendChild(row);
  });
}

function openTagEditor(tag) {
  editingTagId = tag.id;
  el("tagEditTitle").textContent = "Edit Tag";
  el("tagName").value = tag.name;
  el("tagColor").value = tag.color;
  el("tagDeleteBtn").classList.remove("hidden");
  el("tagEditOverlay").classList.remove("hidden");
}

el("tagEditCancel").addEventListener("click", () => el("tagEditOverlay").classList.add("hidden"));

el("tagEditForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el("tagName").value.trim();
  const color = el("tagColor").value;
  if (!name) return;

  if (editingTagId) {
    const tag = tagsData.tags.find((t) => t.id === editingTagId);
    tag.name = name;
    tag.color = color;
  } else {
    tagsData.tags.push({ id: crypto.randomUUID(), name, color });
  }

  el("tagEditOverlay").classList.add("hidden");
  renderTagList();
  renderVerses();
  if (currentView === "tag" && activeTagId) renderTagView(activeTagId);
  scheduleSave();
});

el("tagDeleteBtn").addEventListener("click", () => {
  if (!editingTagId) return;
  if (!confirm("Delete this tag? It will be removed from every verse.")) return;

  tagsData.tags = tagsData.tags.filter((t) => t.id !== editingTagId);
  for (const key of Object.keys(tagsData.verseTags)) {
    const entry = tagsData.verseTags[key];
    entry.tagIds = entry.tagIds.filter((id) => id !== editingTagId);
    if (entry.tagIds.length === 0 && !entry.note) delete tagsData.verseTags[key];
  }

  if (activeTagId === editingTagId) {
    activeTagId = null;
    showView("read");
  }

  el("tagEditOverlay").classList.add("hidden");
  renderTagList();
  renderVerses();
  scheduleSave();
});

// ---------- Tag view (browse verses by tag) ----------

function renderTagView(tagId) {
  const tag = tagsData.tags.find((t) => t.id === tagId);
  if (!tag) return;

  el("tagViewHeading").innerHTML = `<span class="tag-swatch" style="background:${tag.color};display:inline-block;margin-right:8px;"></span>${escapeHtml(tag.name)}`;

  const entries = Object.entries(tagsData.verseTags)
    .filter(([, entry]) => entry.tagIds.includes(tagId))
    .map(([key]) => ({ key, ...parseVerseKey(key) }))
    .sort((a, b) => {
      const oa = booksById.get(a.bookId)?.order ?? 0;
      const ob = booksById.get(b.bookId)?.order ?? 0;
      return oa - ob || a.chapter - b.chapter || a.verse - b.verse;
    });

  const container = el("tagVerses");
  container.innerHTML = "";

  if (entries.length === 0) {
    container.innerHTML = '<div class="tag-empty">No verses tagged yet. Select verses in the reader and choose "Tag selected…".</div>';
    return;
  }

  entries.forEach(({ key, bookId, chapter, verse }) => {
    const book = booksById.get(bookId);
    const text = book.chapters[chapter - 1][verse - 1];
    const entry = tagsData.verseTags[key];

    const item = document.createElement("div");
    item.className = "tag-verse-item";
    item.innerHTML = `
      <div class="tag-verse-ref">${refLabel(bookId, chapter, verse)}</div>
      <div class="tag-verse-text">${escapeHtml(text)}</div>
      ${entry.note ? `<div class="verse-note">${escapeHtml(entry.note)}</div>` : ""}
    `;
    item.addEventListener("click", () => {
      selectBook(bookId, chapter);
      setTimeout(() => renderVerses(verse), 0);
    });
    container.appendChild(item);
  });
}

// ---------- View switching ----------

function showView(view) {
  currentView = view;
  el("readView").classList.toggle("hidden", view !== "read");
  el("searchView").classList.toggle("hidden", view !== "search");
  el("tagView").classList.toggle("hidden", view !== "tag");
  el("chapterBar").classList.toggle("hidden", view !== "read");
  if (view !== "tag") {
    activeTagId = null;
    renderTagList();
  }
}

// ---------- Search / jump box ----------

const BOOK_NAME_ALIASES = null; // reserved for future alias support

function findBookByName(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  let match = bible.books.find((b) => b.name.toLowerCase() === q);
  if (match) return match;
  match = bible.books.find((b) => b.name.toLowerCase().startsWith(q));
  if (match) return match;
  return bible.books.find((b) => b.name.toLowerCase().includes(q));
}

el("jumpBox").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const query = el("jumpBox").value.trim();
  if (!query) return;

  const refMatch = query.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (refMatch) {
    const [, bookQuery, chapterStr, verseStr] = refMatch;
    const book = findBookByName(bookQuery);
    if (book) {
      const chapter = Math.min(Math.max(1, Number(chapterStr)), book.chapters.length);
      selectBook(book.id, chapter);
      if (verseStr) setTimeout(() => renderVerses(Number(verseStr)), 0);
      return;
    }
  }

  runTextSearch(query);
});

function runTextSearch(query) {
  const q = query.toLowerCase();
  const results = [];

  outer:
  for (const book of bible.books) {
    for (let c = 0; c < book.chapters.length; c++) {
      const chapterVerses = book.chapters[c];
      for (let v = 0; v < chapterVerses.length; v++) {
        if (chapterVerses[v].toLowerCase().includes(q)) {
          results.push({ bookId: book.id, chapter: c + 1, verse: v + 1, text: chapterVerses[v] });
          if (results.length >= 200) break outer;
        }
      }
    }
  }

  el("searchResults").innerHTML = "";
  const heading = el("searchView").querySelector(".search-view-heading");
  heading.textContent = `Search results for "${query}" (${results.length}${results.length >= 200 ? "+" : ""})`;

  const container = el("searchResults");
  if (results.length === 0) {
    container.innerHTML = '<div class="tag-empty">No matches found.</div>';
  } else {
    results.forEach(({ bookId, chapter, verse, text }) => {
      const item = document.createElement("div");
      item.className = "search-result";
      const highlighted = escapeHtml(text).replace(
        new RegExp(escapeRegExp(escapeHtml(query)), "ig"),
        (m) => `<mark>${m}</mark>`
      );
      item.innerHTML = `
        <div class="result-ref">${refLabel(bookId, chapter, verse)}</div>
        <div class="result-text">${highlighted}</div>
      `;
      item.addEventListener("click", () => {
        selectBook(bookId, chapter);
        setTimeout(() => renderVerses(verse), 0);
      });
      container.appendChild(item);
    });
  }

  showView("search");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Persistence ----------

function scheduleSave() {
  setStatus("Saving…", "dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveTags, 500);
}

async function saveTags() {
  try {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tagsData),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    setStatus("Saved");
  } catch (err) {
    console.error(err);
    setStatus("Error saving — check the server", "error");
  }
}

init();
