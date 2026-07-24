// State
let bible = null;
let booksById = new Map();
let tagsData = { tags: [], verseTags: {} }; // tags: [{id,name,hue}], verseTags[key] = { tagIds:[], note:'' }

let currentBookId = null;
let currentChapter = 1;
let currentView = "read"; // 'read' | 'verse' | 'tags' | 'search'
let currentVerseKey = null; // for verse detail view
let activeTagFilter = null; // null = "All"
let pickerBookId = null; // set when drilled into chapter grid
let tagAssignKeys = [];
let tagAssignShowNote = false;

let selection = new Set();
let lastClickedKey = null;

let saveTimer = null;
let notesSaveTimer = null;

const HUE_PRESETS = [10, 40, 70, 145, 190, 250, 290, 330];

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

function chipColors(hue) {
  return { bg: `oklch(0.93 0.035 ${hue})`, text: `oklch(0.4 0.09 ${hue})` };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
      fetchJSON("/api/tags").catch(() => ({ tags: [], verseTags: {} })),
    ]);
    bible = bibleData;
    tagsData = tagsJson;
    if (!tagsData.tags) tagsData.tags = [];
    if (!tagsData.verseTags) tagsData.verseTags = {};

    booksById = new Map(bible.books.map((b) => [b.id, b]));

    const last = JSON.parse(localStorage.getItem("bible-study:lastLocation") || "null");
    if (last && booksById.has(last.bookId)) {
      selectBook(last.bookId, last.chapter || 1);
    } else {
      selectBook("genesis", 1);
    }
  } catch (err) {
    console.error(err);
    el("readView").innerHTML = '<div class="empty-msg">Failed to load data — is the server running?</div>';
  }
}

// ---------- View switching ----------

function showView(view) {
  currentView = view;
  el("readView").classList.toggle("hidden", view !== "read");
  el("verseView").classList.toggle("hidden", view !== "verse");
  el("tagsView").classList.toggle("hidden", view !== "tags");
  el("searchView").classList.toggle("hidden", view !== "search");

  const showBack = view === "verse" || view === "search";
  el("backBtn").classList.toggle("hidden", !showBack);
  el("collapseBtn").classList.toggle("hidden", showBack);

  const breadcrumbs = { read: "Reading", verse: "Verse & Notes", tags: "Your tagged verses", search: "Search" };
  el("breadcrumb").textContent = breadcrumbs[view] || "";

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view || (view === "verse" && item.dataset.view === "read") || (view === "search" && item.dataset.view === "read"));
  });
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    if (item.dataset.view === "read") {
      showView("read");
    } else if (item.dataset.view === "tags") {
      renderTagsView();
      showView("tags");
    }
  });
});

el("backBtn").addEventListener("click", () => showView("read"));

el("collapseBtn").addEventListener("click", () => {
  const collapsed = document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
  localStorage.setItem("bible-study:sidebarCollapsed", collapsed ? "1" : "0");
});

if (localStorage.getItem("bible-study:sidebarCollapsed") === "1") {
  document.querySelector(".app-shell").classList.add("sidebar-collapsed");
}

// ---------- Read view ----------

function selectBook(bookId, chapter) {
  currentBookId = bookId;
  currentChapter = chapter || 1;
  renderReadView();
  showView("read");
  localStorage.setItem("bible-study:lastLocation", JSON.stringify({ bookId: currentBookId, chapter: currentChapter }));
}

function renderReadView() {
  const book = booksById.get(currentBookId);
  el("chapterHeading").textContent = `${book.name} ${currentChapter}`;
  renderVerses();
}

function renderVerses() {
  const book = booksById.get(currentBookId);
  const chapter = book.chapters[currentChapter - 1];
  const container = el("verses");
  container.innerHTML = "";

  if (chapter.heading) {
    const h = document.createElement("div");
    h.className = "section-title";
    h.textContent = chapter.heading;
    container.appendChild(h);
  }

  let proseP = null;
  let lastVerse = null;

  chapter.lines.forEach((line) => {
    const key = verseKey(book.id, currentChapter, line.verse);
    const showNum = line.verse !== lastVerse;
    lastVerse = line.verse;

    if (line.poetic) {
      proseP = null;
      const lineDiv = document.createElement("div");
      lineDiv.className =
        "poetry-line" + (line.indent === 2 ? " indent-2" : line.indent === 3 ? " indent-3" : "") + (line.newPara ? " stanza-break" : "");
      lineDiv.appendChild(buildVerseSpan(key, line.text, showNum, line.verse));
      container.appendChild(lineDiv);
    } else {
      if (!proseP || line.newPara) {
        proseP = document.createElement("p");
        proseP.className = "prose-para";
        container.appendChild(proseP);
      }
      proseP.appendChild(buildVerseSpan(key, line.text, showNum, line.verse));
      proseP.appendChild(document.createTextNode(" "));
    }
  });
}

function buildVerseSpan(key, text, showNum, verseNum) {
  const span = document.createElement("span");
  span.className = "verse-inline";
  span.dataset.key = key;
  if (selection.has(key)) span.classList.add("selected");

  const entry = tagsData.verseTags[key];
  const tagIds = (entry && entry.tagIds) || [];
  if (entry && entry.note) span.classList.add("has-note");
  if (tagIds.length) {
    span.classList.add("tagged");
    const firstTag = tagsData.tags.find((t) => t.id === tagIds[0]);
    if (firstTag) {
      const { bg, text: fg } = chipColors(firstTag.hue);
      span.style.setProperty("--tag-dot-bg", bg);
      span.style.setProperty("--tag-dot-text", fg);
    }
  }

  if (showNum) {
    const num = document.createElement("span");
    num.className = "verse-num-inline";
    num.textContent = verseNum;
    span.appendChild(num);
  }
  span.appendChild(document.createTextNode(text));

  span.addEventListener("click", (e) => handleVerseClick(e, key));
  return span;
}

// ---------- Multi-verse selection ----------

function handleVerseClick(e, key) {
  if (e.ctrlKey || e.metaKey) {
    if (selection.has(key)) selection.delete(key);
    else selection.add(key);
  } else if (lastClickedKey) {
    selectRange(lastClickedKey, key);
  } else {
    selection.add(key);
  }
  lastClickedKey = key;
  applySelectionClasses();
  updateSelectionBar();
}

function selectRange(fromKey, toKey) {
  const a = parseVerseKey(fromKey);
  const b = parseVerseKey(toKey);
  if (a.bookId !== b.bookId || a.chapter !== b.chapter) {
    selection.add(toKey);
    return;
  }
  const lo = Math.min(a.verse, b.verse);
  const hi = Math.max(a.verse, b.verse);
  for (let v = lo; v <= hi; v++) selection.add(verseKey(a.bookId, a.chapter, v));
}

function applySelectionClasses() {
  document.querySelectorAll(".verse-inline").forEach((span) => {
    span.classList.toggle("selected", selection.has(span.dataset.key));
  });
}

function clearSelection() {
  selection.clear();
  lastClickedKey = null;
  applySelectionClasses();
  updateSelectionBar();
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

function goToVerseInChapter(keys) {
  selection.clear();
  keys.forEach((k) => selection.add(k));
  lastClickedKey = keys[keys.length - 1];
  const { bookId, chapter } = parseVerseKey(keys[0]);
  selectBook(bookId, chapter);
  updateSelectionBar();
  requestAnimationFrame(() => {
    const span = document.querySelector(`.verse-inline[data-key="${keys[0]}"]`);
    if (span) span.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

el("clearSelectionBtn").addEventListener("click", clearSelection);
el("tagSelectionBtn").addEventListener("click", () => {
  openTagAssign([...selection], true);
});

function navigateChapter(delta) {
  const book = booksById.get(currentBookId);
  let newChapter = currentChapter + delta;

  if (newChapter < 1) {
    const prevBook = bible.books.find((b) => b.order === book.order - 1);
    if (!prevBook) return;
    selectBook(prevBook.id, prevBook.chapters.length);
    return;
  }
  if (newChapter > book.chapters.length) {
    const nextBook = bible.books.find((b) => b.order === book.order + 1);
    if (!nextBook) return;
    selectBook(nextBook.id, 1);
    return;
  }
  selectBook(currentBookId, newChapter);
}

el("prevChapterBtn").addEventListener("click", () => navigateChapter(-1));
el("nextChapterBtn").addEventListener("click", () => navigateChapter(1));

// ---------- Book/chapter picker ----------

el("chapterPickerBtn").addEventListener("click", openPicker);

function closePicker() {
  el("pickerOverlay").classList.add("hidden");
}

function openPicker() {
  pickerBookId = null;
  el("pickerSearchInput").value = "";
  el("pickerModalTitle").textContent = "Select a book";
  el("pickerBackBtn").classList.add("hidden");
  el("pickerSearchInput").classList.remove("hidden");
  renderPickerBookList();
  el("pickerBookList").classList.remove("hidden");
  el("pickerChapterGrid").classList.add("hidden");
  el("pickerOverlay").classList.remove("hidden");
  el("pickerSearchInput").focus();
}

function renderPickerBookList() {
  const list = el("pickerBookList");
  list.innerHTML = "";
  const query = el("pickerSearchInput").value.trim().toLowerCase();
  const groups = [
    { label: "Old Testament", books: bible.books.filter((b) => b.testament === "OT") },
    { label: "New Testament", books: bible.books.filter((b) => b.testament === "NT") },
  ];

  let anyMatch = false;
  groups.forEach((group) => {
    const matches = group.books.filter((b) => !query || b.name.toLowerCase().includes(query));
    if (matches.length === 0) return;
    anyMatch = true;

    const heading = document.createElement("div");
    heading.className = "picker-section-title";
    heading.textContent = group.label;
    list.appendChild(heading);

    matches.forEach((book) => {
      const item = document.createElement("button");
      item.className = "picker-book-item";
      item.textContent = book.name;
      item.addEventListener("click", () => renderPickerChapterGrid(book));
      list.appendChild(item);
    });
  });

  if (!anyMatch) {
    const empty = document.createElement("div");
    empty.className = "picker-empty-msg";
    empty.textContent = "No books match your search.";
    list.appendChild(empty);
  }
}

el("pickerSearchInput").addEventListener("input", renderPickerBookList);

function renderPickerChapterGrid(book) {
  pickerBookId = book.id;
  el("pickerBookList").classList.add("hidden");
  el("pickerSearchInput").classList.add("hidden");
  el("pickerModalTitle").textContent = book.name;
  el("pickerBackBtn").classList.remove("hidden");

  const grid = el("pickerChapterGrid");
  grid.innerHTML = "";
  grid.classList.remove("hidden");

  book.chapters.forEach((_, idx) => {
    const chapNum = idx + 1;
    const item = document.createElement("button");
    item.className = "picker-chapter-item";
    item.textContent = chapNum;
    item.addEventListener("click", () => {
      closePicker();
      selectBook(book.id, chapNum);
    });
    grid.appendChild(item);
  });
}

el("pickerBackBtn").addEventListener("click", () => {
  pickerBookId = null;
  el("pickerChapterGrid").classList.add("hidden");
  el("pickerBookList").classList.remove("hidden");
  el("pickerSearchInput").classList.remove("hidden");
  el("pickerModalTitle").textContent = "Select a book";
  el("pickerBackBtn").classList.add("hidden");
});

document.addEventListener("click", (e) => {
  if (e.target === el("pickerOverlay")) closePicker();
});

el("pickerCloseBtn").addEventListener("click", closePicker);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("pickerOverlay").classList.contains("hidden")) {
    closePicker();
  }
});

// ---------- Verse detail view ----------

function openVerseDetail(key) {
  currentVerseKey = key;
  const { bookId, chapter, verse } = parseVerseKey(key);
  const book = booksById.get(bookId);
  const text = book.chapters[chapter - 1].verses[verse - 1];

  el("verseDetailRef").textContent = refLabel(bookId, chapter, verse);
  el("verseDetailText").textContent = text;
  el("verseDetailNotes").value = tagsData.verseTags[key]?.note || "";
  el("verseDetailNoteClear").classList.toggle("hidden", !el("verseDetailNotes").value);

  renderVerseDetailTags();
  showView("verse");
}

function renderVerseDetailTags() {
  const container = el("verseDetailTags");
  container.innerHTML = "";
  const entry = tagsData.verseTags[currentVerseKey];

  if (entry && entry.tagIds) {
    entry.tagIds.forEach((tagId) => {
      const tag = tagsData.tags.find((t) => t.id === tagId);
      if (!tag) return;
      const { bg, text: fg } = chipColors(tag.hue);
      const chip = document.createElement("button");
      chip.className = "tag-chip-removable";
      chip.style.background = bg;
      chip.style.color = fg;
      chip.innerHTML = `<span>${escapeHtml(tag.name)}</span><span class="x">×</span>`;
      chip.addEventListener("click", () => {
        toggleVerseTag(currentVerseKey, tagId);
        renderVerseDetailTags();
        renderVerses();
      });
      container.appendChild(chip);
    });
  }

  const addBtn = document.createElement("button");
  addBtn.className = "tag-add-btn";
  addBtn.textContent = "+ add tag";
  addBtn.addEventListener("click", () => openTagAssign([currentVerseKey], false));
  container.appendChild(addBtn);
}

el("verseDetailNotes").addEventListener("input", () => {
  const key = currentVerseKey;
  const value = el("verseDetailNotes").value;
  if (!tagsData.verseTags[key]) tagsData.verseTags[key] = { tagIds: [], note: "" };
  tagsData.verseTags[key].note = value;
  if (!tagsData.verseTags[key].tagIds.length && !tagsData.verseTags[key].note) delete tagsData.verseTags[key];
  el("verseDetailNoteClear").classList.toggle("hidden", !value);

  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(saveTags, 600);
});

el("verseDetailNoteClear").addEventListener("click", () => {
  el("verseDetailNotes").value = "";
  el("verseDetailNotes").dispatchEvent(new Event("input"));
  clearTimeout(notesSaveTimer);
  saveTags();
});

el("verseDetailRef").addEventListener("click", () => goToVerseInChapter([currentVerseKey]));

// ---------- Tag assignment ----------

function toggleVerseTag(key, tagId) {
  if (!tagsData.verseTags[key]) tagsData.verseTags[key] = { tagIds: [], note: "" };
  const entry = tagsData.verseTags[key];
  if (entry.tagIds.includes(tagId)) {
    entry.tagIds = entry.tagIds.filter((id) => id !== tagId);
  } else {
    entry.tagIds.push(tagId);
  }
  if (!entry.tagIds.length && !entry.note) delete tagsData.verseTags[key];
  scheduleSave();
}

function toggleTagForKeys(keys, tagId) {
  const allHaveIt = keys.every((k) => (tagsData.verseTags[k]?.tagIds || []).includes(tagId));
  keys.forEach((key) => {
    if (!tagsData.verseTags[key]) tagsData.verseTags[key] = { tagIds: [], note: "" };
    const entry = tagsData.verseTags[key];
    if (allHaveIt) {
      entry.tagIds = entry.tagIds.filter((id) => id !== tagId);
    } else if (!entry.tagIds.includes(tagId)) {
      entry.tagIds.push(tagId);
    }
    if (!entry.tagIds.length && !entry.note) delete tagsData.verseTags[key];
  });
  scheduleSave();
}

function openTagAssign(keys, showNote) {
  tagAssignKeys = keys;
  tagAssignShowNote = showNote;

  if (keys.length === 1) {
    const { bookId, chapter, verse } = parseVerseKey(keys[0]);
    el("tagAssignRef").textContent = refLabel(bookId, chapter, verse);
  } else {
    el("tagAssignRef").textContent = `${keys.length} verses selected`;
  }

  el("tagAssignNoteLabel").classList.toggle("hidden", !showNote);
  if (showNote) {
    const notes = keys.map((k) => tagsData.verseTags[k]?.note || "");
    const uniform = notes.every((n) => n === notes[0]);
    el("tagAssignNote").value = uniform ? notes[0] : "";
    el("tagAssignNote").placeholder = uniform
      ? "Add a note to the selected verse(s)…"
      : "Selected verses have different notes — type to overwrite all";
    el("tagAssignNoteClear").classList.toggle("hidden", !notes.some((n) => n));
  }

  renderTagAssignList();
  el("tagAssignOverlay").classList.remove("hidden");
}

function renderTagAssignList() {
  const list = el("tagAssignList");
  list.innerHTML = "";

  if (tagsData.tags.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tags yet — create one below.</div>';
    return;
  }

  tagsData.tags.forEach((tag) => {
    const selected = tagAssignKeys.some((k) => (tagsData.verseTags[k]?.tagIds || []).includes(tag.id));
    const btn = document.createElement("button");
    btn.className = "tag-toggle-pill";
    btn.textContent = tag.name;
    if (selected) {
      const { bg, text: fg } = chipColors(tag.hue);
      btn.style.background = bg;
      btn.style.color = fg;
      btn.style.borderColor = "transparent";
    }
    btn.addEventListener("click", () => {
      toggleTagForKeys(tagAssignKeys, tag.id);
      renderTagAssignList();
      renderVerses();
      if (currentView === "verse") renderVerseDetailTags();
      if (currentView === "tags") renderTagsView();
    });
    list.appendChild(btn);
  });
}

el("tagAssignNote").addEventListener("input", () => {
  const note = el("tagAssignNote").value;
  tagAssignKeys.forEach((key) => {
    if (!tagsData.verseTags[key]) tagsData.verseTags[key] = { tagIds: [], note: "" };
    tagsData.verseTags[key].note = note;
    if (!tagsData.verseTags[key].tagIds.length && !tagsData.verseTags[key].note) delete tagsData.verseTags[key];
  });
  el("tagAssignNoteClear").classList.toggle("hidden", !note);
  el("tagAssignNote").placeholder = "Add a note to the selected verse(s)…";
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(saveTags, 600);
});

el("tagAssignNoteClear").addEventListener("click", () => {
  el("tagAssignNote").value = "";
  el("tagAssignNote").dispatchEvent(new Event("input"));
  clearTimeout(notesSaveTimer);
  saveTags();
});

el("tagAssignDoneBtn").addEventListener("click", closeTagAssign);

el("tagAssignOverlay").addEventListener("click", (e) => {
  if (e.target === el("tagAssignOverlay")) closeTagAssign();
});

function closeTagAssign() {
  el("tagAssignOverlay").classList.add("hidden");
  if (tagAssignShowNote) {
    clearSelection();
    renderVerses();
    if (currentView === "tags") renderTagsView();
  }
}

// ---------- New tag creation ----------

let selectedHue = HUE_PRESETS[0];

el("tagAssignAddBtn").addEventListener("click", () => {
  el("newTagName").value = "";
  selectedHue = HUE_PRESETS[Math.floor(Math.random() * HUE_PRESETS.length)];
  renderHueSwatches();
  el("newTagOverlay").classList.remove("hidden");
});

function renderHueSwatches() {
  const container = el("hueSwatches");
  container.innerHTML = "";
  HUE_PRESETS.forEach((hue) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "hue-swatch" + (hue === selectedHue ? " selected" : "");
    swatch.style.background = `oklch(0.75 0.13 ${hue})`;
    swatch.addEventListener("click", () => {
      selectedHue = hue;
      renderHueSwatches();
    });
    container.appendChild(swatch);
  });
}

el("newTagCancel").addEventListener("click", () => el("newTagOverlay").classList.add("hidden"));

el("newTagForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el("newTagName").value.trim();
  if (!name) return;

  const tag = { id: crypto.randomUUID(), name, hue: selectedHue };
  tagsData.tags.push(tag);
  toggleTagForKeys(tagAssignKeys, tag.id);

  el("newTagOverlay").classList.add("hidden");
  renderTagAssignList();
  renderVerses();
  if (currentView === "verse") renderVerseDetailTags();
});

// ---------- Tags browse view ----------

function renderTagsView() {
  renderTagFilterBar();
  renderTagVerseList();
}

function renderTagFilterBar() {
  const bar = el("tagFilterBar");
  bar.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "filter-pill" + (activeTagFilter === null ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    activeTagFilter = null;
    renderTagsView();
  });
  bar.appendChild(allBtn);

  tagsData.tags.forEach((tag) => {
    const count = Object.values(tagsData.verseTags).filter((e) => e.tagIds.includes(tag.id)).length;
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (activeTagFilter === tag.id ? " active" : "");
    btn.textContent = `${tag.name} · ${count}`;
    btn.addEventListener("click", () => {
      activeTagFilter = tag.id;
      renderTagsView();
    });
    bar.appendChild(btn);
  });
}

function sameTagIds(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function renderTagVerseList() {
  const container = el("tagVerseList");
  container.innerHTML = "";

  const entries = Object.entries(tagsData.verseTags)
    .filter(([, entry]) => (activeTagFilter ? entry.tagIds.includes(activeTagFilter) : true))
    .map(([key]) => ({ key, ...parseVerseKey(key) }))
    .sort((a, b) => {
      const oa = booksById.get(a.bookId)?.order ?? 0;
      const ob = booksById.get(b.bookId)?.order ?? 0;
      return oa - ob || a.chapter - b.chapter || a.verse - b.verse;
    });

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-msg">No tagged verses yet. Select a verse while reading to add a tag or note.</div>';
    return;
  }

  // Group consecutive verses that share the same note + tags into one card,
  // so a note written for a passage reads as belonging to the whole passage.
  const groups = [];
  entries.forEach(({ key, bookId, chapter, verse }) => {
    const entry = tagsData.verseTags[key];
    const last = groups[groups.length - 1];
    if (
      last &&
      last.bookId === bookId &&
      last.chapter === chapter &&
      verse === last.endVerse + 1 &&
      (entry.note || "") === (last.note || "") &&
      sameTagIds(entry.tagIds || [], last.tagIds || [])
    ) {
      last.endVerse = verse;
      last.keys.push(key);
    } else {
      groups.push({
        bookId,
        chapter,
        startVerse: verse,
        endVerse: verse,
        note: entry.note || "",
        tagIds: entry.tagIds || [],
        keys: [key],
      });
    }
  });

  groups.forEach((group) => {
    const book = booksById.get(group.bookId);
    const fullText = group.keys
      .map((k) => book.chapters[group.chapter - 1].verses[parseVerseKey(k).verse - 1])
      .join(" ");
    const excerpt = fullText.length > 160 ? fullText.slice(0, 160) + "…" : fullText;
    const refText =
      group.startVerse === group.endVerse
        ? refLabel(group.bookId, group.chapter, group.startVerse)
        : `${refLabel(group.bookId, group.chapter, group.startVerse)}–${group.endVerse}`;

    const card = document.createElement("div");
    card.className = "verse-card";
    card.innerHTML = `
      <div class="card-ref">${refText}</div>
      <div class="card-text">${escapeHtml(excerpt)}</div>
      ${group.note ? `<div class="card-note">${escapeHtml(group.note)}</div>` : ""}
      <div class="card-tags"></div>
    `;
    const tagsRow = card.querySelector(".card-tags");
    group.tagIds.forEach((tagId) => {
      const tag = tagsData.tags.find((t) => t.id === tagId);
      if (!tag) return;
      const { bg, text: fg } = chipColors(tag.hue);
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.style.background = bg;
      chip.style.color = fg;
      chip.textContent = tag.name;
      tagsRow.appendChild(chip);
    });

    card.addEventListener("click", () => {
      if (group.keys.length === 1) {
        openVerseDetail(group.keys[0]);
        return;
      }
      goToVerseInChapter(group.keys);
    });
    container.appendChild(card);
  });
}

// ---------- Search ----------

el("searchToggleBtn").addEventListener("click", () => {
  el("searchInput").value = "";
  el("searchHeading").classList.add("hidden");
  el("searchEmptyHint").classList.remove("hidden");
  el("searchResults").innerHTML = "";
  showView("search");
  el("searchInput").focus();
});

function findBookByName(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  let match = bible.books.find((b) => b.name.toLowerCase() === q);
  if (match) return match;
  match = bible.books.find((b) => b.name.toLowerCase().startsWith(q));
  if (match) return match;
  return bible.books.find((b) => b.name.toLowerCase().includes(q));
}

el("searchInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const query = el("searchInput").value.trim();
  if (!query) return;

  const refMatch = query.match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
  if (refMatch) {
    const [, bookQuery, chapterStr, verseStr] = refMatch;
    const book = findBookByName(bookQuery);
    if (book) {
      const chapter = Math.min(Math.max(1, Number(chapterStr)), book.chapters.length);
      selectBook(book.id, chapter);
      if (verseStr) {
        const v = Number(verseStr);
        const text = book.chapters[chapter - 1].verses[v - 1];
        if (text) openVerseDetail(verseKey(book.id, chapter, v));
      }
      return;
    }
  }

  runTextSearch(query);
});

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runTextSearch(query) {
  const q = query.toLowerCase();
  const results = [];

  outer:
  for (const book of bible.books) {
    for (let c = 0; c < book.chapters.length; c++) {
      const chapterVerses = book.chapters[c].verses;
      for (let v = 0; v < chapterVerses.length; v++) {
        if (chapterVerses[v].toLowerCase().includes(q)) {
          results.push({ bookId: book.id, chapter: c + 1, verse: v + 1, text: chapterVerses[v] });
          if (results.length >= 200) break outer;
        }
      }
    }
  }

  el("searchEmptyHint").classList.add("hidden");
  el("searchHeading").classList.remove("hidden");
  el("searchHeading").textContent = `Search results for "${query}" (${results.length}${results.length >= 200 ? "+" : ""})`;

  const container = el("searchResults");
  container.innerHTML = "";
  if (results.length === 0) {
    container.innerHTML = '<div class="empty-msg">No matches found.</div>';
  } else {
    results.forEach(({ bookId, chapter, verse, text }) => {
      const card = document.createElement("div");
      card.className = "verse-card";
      const highlighted = escapeHtml(text).replace(new RegExp(escapeRegExp(escapeHtml(query)), "ig"), (m) => `<mark>${m}</mark>`);
      card.innerHTML = `
        <div class="card-ref">${refLabel(bookId, chapter, verse)}</div>
        <div class="card-text">${highlighted}</div>
      `;
      card.addEventListener("click", () => openVerseDetail(verseKey(bookId, chapter, verse)));
      container.appendChild(card);
    });
  }

  showView("search");
}

// ---------- Persistence ----------

function scheduleSave() {
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
  } catch (err) {
    console.error(err);
  }
}

init();
