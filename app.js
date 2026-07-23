// State
let bible = null;
let booksById = new Map();
let tagsData = { tags: [], verseTags: {} }; // tags: [{id,name,hue}], verseTags[key] = { tagIds:[], note:'' }

let currentBookId = null;
let currentChapter = 1;
let currentView = "read"; // 'read' | 'verse' | 'tags' | 'search'
let currentVerseKey = null; // for verse detail view
let activeTagFilter = null; // null = "All"
let pickerTestament = "OT";
let pickerBookId = null; // set when drilled into chapter grid
let tagAssignVerseKey = null;

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

  const entry = tagsData.verseTags[key];
  const tagIds = (entry && entry.tagIds) || [];
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

  span.addEventListener("click", () => openVerseDetail(key));
  return span;
}

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

function openPicker() {
  pickerTestament = booksById.get(currentBookId).testament;
  pickerBookId = null;
  renderPickerTabs();
  renderPickerBookList();
  el("pickerBookList").classList.remove("hidden");
  el("pickerChapterGrid").classList.add("hidden");
  el("pickerOverlay").classList.remove("hidden");
}

function renderPickerTabs() {
  document.querySelectorAll(".picker-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.testament === pickerTestament);
  });
}

document.querySelectorAll(".picker-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    pickerTestament = tab.dataset.testament;
    renderPickerTabs();
    renderPickerBookList();
  });
});

function renderPickerBookList() {
  const list = el("pickerBookList");
  list.innerHTML = "";
  bible.books
    .filter((b) => b.testament === pickerTestament)
    .forEach((book) => {
      const item = document.createElement("button");
      item.className = "picker-book-item";
      item.textContent = book.name;
      item.addEventListener("click", () => renderPickerChapterGrid(book));
      list.appendChild(item);
    });
}

function renderPickerChapterGrid(book) {
  pickerBookId = book.id;
  el("pickerBookList").classList.add("hidden");
  const grid = el("pickerChapterGrid");
  grid.innerHTML = "";
  grid.classList.remove("hidden");

  const backBtn = document.createElement("button");
  backBtn.className = "picker-back";
  backBtn.textContent = "‹ Books";
  backBtn.addEventListener("click", () => {
    grid.classList.add("hidden");
    el("pickerBookList").classList.remove("hidden");
  });
  grid.appendChild(backBtn);

  book.chapters.forEach((_, idx) => {
    const chapNum = idx + 1;
    const item = document.createElement("button");
    item.className = "picker-chapter-item";
    item.textContent = chapNum;
    item.addEventListener("click", () => {
      el("pickerOverlay").classList.add("hidden");
      selectBook(book.id, chapNum);
    });
    grid.appendChild(item);
  });
}

document.addEventListener("click", (e) => {
  if (e.target === el("pickerOverlay")) el("pickerOverlay").classList.add("hidden");
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
  addBtn.addEventListener("click", () => openTagAssign(currentVerseKey, true));
  container.appendChild(addBtn);
}

el("verseDetailNotes").addEventListener("input", () => {
  const key = currentVerseKey;
  if (!tagsData.verseTags[key]) tagsData.verseTags[key] = { tagIds: [], note: "" };
  tagsData.verseTags[key].note = el("verseDetailNotes").value;
  if (!tagsData.verseTags[key].tagIds.length && !tagsData.verseTags[key].note) delete tagsData.verseTags[key];

  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(saveTags, 600);
});

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

function openTagAssign(key, fromDetail) {
  tagAssignVerseKey = key;
  const { bookId, chapter, verse } = parseVerseKey(key);
  el("tagAssignRef").textContent = refLabel(bookId, chapter, verse);
  renderTagAssignList();
  el("tagAssignOverlay").classList.remove("hidden");
  el("tagAssignOverlay").dataset.fromDetail = fromDetail ? "1" : "";
}

function renderTagAssignList() {
  const list = el("tagAssignList");
  list.innerHTML = "";

  if (tagsData.tags.length === 0) {
    list.innerHTML = '<div class="empty-msg">No tags yet — create one below.</div>';
    return;
  }

  const entry = tagsData.verseTags[tagAssignVerseKey];
  const activeIds = entry ? entry.tagIds : [];

  tagsData.tags.forEach((tag) => {
    const selected = activeIds.includes(tag.id);
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
      toggleVerseTag(tagAssignVerseKey, tag.id);
      renderTagAssignList();
      renderVerses();
      if (currentView === "verse") renderVerseDetailTags();
      if (currentView === "tags") renderTagsView();
    });
    list.appendChild(btn);
  });
}

el("tagAssignDoneBtn").addEventListener("click", () => {
  el("tagAssignOverlay").classList.add("hidden");
});

el("tagAssignOverlay").addEventListener("click", (e) => {
  if (e.target === el("tagAssignOverlay")) el("tagAssignOverlay").classList.add("hidden");
});

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
  toggleVerseTag(tagAssignVerseKey, tag.id);

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
    container.innerHTML = '<div class="empty-msg">No tagged verses yet. Tap any verse while reading to add a tag.</div>';
    return;
  }

  entries.forEach(({ key, bookId, chapter, verse }) => {
    const book = booksById.get(bookId);
    const text = book.chapters[chapter - 1].verses[verse - 1];
    const entry = tagsData.verseTags[key];

    const card = document.createElement("div");
    card.className = "verse-card";
    card.innerHTML = `
      <div class="card-ref">${refLabel(bookId, chapter, verse)}</div>
      <div class="card-text">${escapeHtml(text.length > 140 ? text.slice(0, 140) + "…" : text)}</div>
      <div class="card-tags"></div>
    `;
    const tagsRow = card.querySelector(".card-tags");
    entry.tagIds.forEach((tagId) => {
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

    card.addEventListener("click", () => openVerseDetail(key));
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
