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

let lastSearchQuery = "";
let lastSearchAndQuery = "";
let baseSearchResults = []; // [{bookId, chapter, verse, text}] — literal text matches only
let matchedSynonymTopic = null; // topic name if the query exactly matches a Nave's topic
let topicSynonymIncluded = false;
let searchTestamentFilter = null; // null | 'OT' | 'NT'
let searchBookFilter = null; // null | bookId

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

    if (anySmartTagsDefined()) await loadAnyDefinedSmartTagSources();

    const last = JSON.parse(localStorage.getItem("bible-study:lastLocation") || "null");
    if (last && booksById.has(last.bookId)) {
      selectBook(last.bookId, last.chapter || 1);
    } else {
      selectBook("genesis", 1);
    }

    if (new URLSearchParams(window.location.search).get("yvConnect")) {
      handleYouVersionRedirectParam();
      renderTagsView();
      showView("tags");
    }
  } catch (err) {
    console.error(err);
    el("readView").innerHTML = '<div class="empty-msg">Failed to load data — is the server running?</div>';
  }
}

// ---------- View switching ----------

function showView(view) {
  if (view !== "read") stopReading();
  currentView = view;
  el("readView").classList.toggle("hidden", view !== "read");
  el("verseView").classList.toggle("hidden", view !== "verse");
  el("tagsView").classList.toggle("hidden", view !== "tags");
  el("topicsView").classList.toggle("hidden", view !== "topics");
  el("topicReadingView").classList.toggle("hidden", view !== "topicReading");
  el("searchView").classList.toggle("hidden", view !== "search");

  const showBack = view === "verse" || view === "search" || view === "topicReading";
  el("backBtn").classList.toggle("hidden", !showBack);
  el("collapseBtn").classList.toggle("hidden", showBack);

  const breadcrumbs = {
    read: "Reading",
    verse: "Verse & Notes",
    tags: "Your tagged verses",
    topics: "Auto-tags & topics",
    topicReading: "Topic reading",
    search: "Search",
  };
  el("breadcrumb").textContent = breadcrumbs[view] || "";

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.view === view ||
        (view === "verse" && item.dataset.view === "read") ||
        (view === "search" && item.dataset.view === "read") ||
        (view === "topicReading" && item.dataset.view === "topics")
    );
  });
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    if (item.dataset.view === "read") {
      showView("read");
    } else if (item.dataset.view === "tags") {
      renderTagsView();
      showView("tags");
    } else if (item.dataset.view === "topics") {
      renderTopicsView();
      showView("topics");
    }
  });
});

el("backBtn").addEventListener("click", () => {
  if (currentView === "topicReading") {
    renderTopicsView();
    showView("topics");
  } else {
    showView("read");
  }
});

el("collapseBtn").addEventListener("click", () => {
  const collapsed = document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
  localStorage.setItem("bible-study:sidebarCollapsed", collapsed ? "1" : "0");
});

if (localStorage.getItem("bible-study:sidebarCollapsed") === "1") {
  document.querySelector(".app-shell").classList.add("sidebar-collapsed");
}

// ---------- Read view ----------

function selectBook(bookId, chapter) {
  stopReading();
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
  if (currentView === "search" && baseSearchResults.length) renderSearchResults();
}

function updateSelectionBar() {
  const bar = el("selectionBar");
  if (selection.size === 0) {
    bar.classList.add("hidden");
    closeWordStudyPanel();
    return;
  }
  bar.classList.remove("hidden");
  el("selectionCount").textContent = `${selection.size} verse${selection.size > 1 ? "s" : ""} selected`;
  el("studyWordsBtn").classList.toggle("hidden", selection.size !== 1);
  if (selection.size !== 1) closeWordStudyPanel();
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
el("studyWordsBtn").addEventListener("click", () => {
  if (selection.size === 1) openWordStudyPanel([...selection][0]);
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

// ---------- Audio: read chapter aloud (Web Speech API) ----------
//
// Speaks one verse per SpeechSynthesisUtterance, chained via onend, rather
// than one utterance for the whole chapter — this is what makes per-verse
// highlighting and reliable pause/resume possible.

const speechSupported = "speechSynthesis" in window;
let speechQueue = []; // [{key, text}]
let speechIndex = -1;
let speechPlaying = false;
let speechRate = Number(localStorage.getItem("bible-study:speechRate") || "1");
let speechVoiceURI = localStorage.getItem("bible-study:speechVoiceURI") || "";
let currentUtterance = null;

function restartCurrentVerse() {
  if (currentUtterance) {
    currentUtterance.onend = null;
    currentUtterance.onerror = null;
  }
  speechIndex--;
  window.speechSynthesis.cancel();
  speakNext();
}

function buildSpeechQueue() {
  const book = booksById.get(currentBookId);
  const chapter = book.chapters[currentChapter - 1];
  return chapter.verses.map((text, i) => ({ key: verseKey(book.id, currentChapter, i + 1), text }));
}

function clearSpeechHighlight() {
  document.querySelectorAll(".verse-inline.speech-active").forEach((s) => s.classList.remove("speech-active"));
}

function highlightSpeechVerse(key) {
  const span = document.querySelector(`.verse-inline[data-key="${key}"]`);
  if (!span) return;
  span.classList.add("speech-active");
  span.scrollIntoView({ block: "center", behavior: "smooth" });
}

function getSelectedVoice() {
  if (!speechVoiceURI) return null;
  return window.speechSynthesis.getVoices().find((v) => v.voiceURI === speechVoiceURI) || null;
}

function speakNext() {
  speechIndex++;
  clearSpeechHighlight();
  if (speechIndex >= speechQueue.length) {
    stopReading();
    return;
  }
  const { key, text } = speechQueue[speechIndex];
  highlightSpeechVerse(key);
  updateAudioControls();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = speechRate;
  const voice = getSelectedVoice();
  if (voice) utter.voice = voice;
  utter.onend = () => {
    if (speechPlaying) speakNext();
  };
  utter.onerror = () => {
    if (speechPlaying) speakNext();
  };
  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

function startReading() {
  if (!speechSupported) return;
  window.speechSynthesis.cancel();
  speechQueue = buildSpeechQueue();
  speechIndex = -1;
  speechPlaying = true;
  updateAudioControls();
  speakNext();
}

function pauseReading() {
  if (!speechSupported || !speechPlaying) return;
  window.speechSynthesis.pause();
  speechPlaying = false;
  updateAudioControls();
}

function resumeReading() {
  if (!speechSupported || speechPlaying) return;
  window.speechSynthesis.resume();
  speechPlaying = true;
  updateAudioControls();
}

function stopReading() {
  if (!speechSupported) return;
  window.speechSynthesis.cancel();
  speechPlaying = false;
  speechIndex = -1;
  speechQueue = [];
  clearSpeechHighlight();
  updateAudioControls();
}

function updateAudioStatus() {
  const status = el("audioStatus");
  if (speechIndex >= 0 && speechIndex < speechQueue.length) {
    status.textContent = `Verse ${speechIndex + 1} of ${speechQueue.length}`;
  } else {
    status.textContent = "";
  }
}

function updateAudioControls() {
  const playBtn = el("audioPlayBtn");
  const playIcon = el("audioPlayIcon");
  const stopBtn = el("audioStopBtn");
  const active = speechIndex >= 0 && speechIndex < speechQueue.length;

  playBtn.title = speechPlaying ? "Pause" : active ? "Resume reading" : "Read chapter aloud";
  playIcon.innerHTML = speechPlaying
    ? '<rect x="5" y="4" width="3" height="12" fill="currentColor"/><rect x="12" y="4" width="3" height="12" fill="currentColor"/>'
    : '<path d="M6 4l10 6-10 6V4Z" fill="currentColor"/>';
  stopBtn.classList.toggle("hidden", !active);
  updateAudioStatus();
}

function populateVoiceSelect() {
  if (!speechSupported) return;
  const select = el("audioVoiceSelect");
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  if (!voices.length) return;

  select.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Default voice";
  select.appendChild(defaultOpt);
  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = v.name;
    select.appendChild(opt);
  });
  select.value = voices.some((v) => v.voiceURI === speechVoiceURI) ? speechVoiceURI : "";
}

if (speechSupported) {
  el("audioPlayerBar").classList.remove("hidden");
  populateVoiceSelect();
  window.speechSynthesis.addEventListener("voiceschanged", populateVoiceSelect);

  el("audioPlayBtn").addEventListener("click", () => {
    if (speechPlaying) pauseReading();
    else if (speechIndex >= 0 && speechIndex < speechQueue.length) resumeReading();
    else startReading();
  });

  el("audioStopBtn").addEventListener("click", stopReading);

  el("audioRateSelect").value = String(speechRate);
  el("audioRateSelect").addEventListener("change", (e) => {
    speechRate = Number(e.target.value);
    localStorage.setItem("bible-study:speechRate", String(speechRate));
    // Rate changes only take effect on the next utterance in most engines,
    // so restart the current verse for an immediate, consistent result.
    if (speechPlaying) restartCurrentVerse();
  });

  el("audioVoiceSelect").addEventListener("change", (e) => {
    speechVoiceURI = e.target.value;
    localStorage.setItem("bible-study:speechVoiceURI", speechVoiceURI);
    if (speechPlaying) restartCurrentVerse();
  });
}

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
  const manualIds = (entry && entry.tagIds) || [];
  const smartIds = smartTagIdsForKey(currentVerseKey);

  manualIds.forEach((tagId) => {
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

  smartIds
    .filter((tagId) => !manualIds.includes(tagId))
    .forEach((tagId) => {
      const tag = tagsData.tags.find((t) => t.id === tagId);
      if (!tag) return;
      const { bg, text: fg } = chipColors(tag.hue);
      const chip = document.createElement("span");
      chip.className = "tag-chip-smart";
      chip.style.background = bg;
      chip.style.color = fg;
      chip.title = `Auto-tagged: this verse contains ${tag.rule.strongs}`;
      chip.innerHTML = `<span>${escapeHtml(tag.name)}</span><span class="auto-mark">auto</span>`;
      container.appendChild(chip);
    });

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

// ---------- New/edit tag creation ----------
//
// A single modal handles: plain manual tags, and tags with a rule (Strong's
// number, topic, or person — one at a time). It's used both to create a new
// tag and to edit an existing one's name/hue/rule.

let selectedHue = HUE_PRESETS[0];
let editingTagId = null; // set when the modal is in edit mode
let newTagAutoAssignKeys = null; // set only when opened from the per-verse tag-assign flow

function populateDatalist(datalistId, names) {
  const datalist = el(datalistId);
  if (datalist.childElementCount) return;
  names
    .slice()
    .sort()
    .forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      datalist.appendChild(opt);
    });
}

function openNewTagModal(opts = {}) {
  editingTagId = opts.editTagId || null;
  newTagAutoAssignKeys = opts.autoAssignKeys || null;
  const tag = editingTagId ? tagsData.tags.find((t) => t.id === editingTagId) : null;
  const manualOnly = !!opts.manualOnly;

  el("newTagModalTitle").textContent = editingTagId ? "Edit Tag" : manualOnly ? "New Tag" : "New Auto-Tag";
  el("newTagSubmitBtn").textContent = editingTagId ? "Save" : "Create";
  el("newTagName").value = tag ? tag.name : opts.name || "";
  el("newTagStrongs").value = opts.strongs || (tag && tag.rule && tag.rule.strongs) || "";
  el("newTagTopic").value = opts.topic || (tag && tag.rule && tag.rule.topic) || "";
  el("newTagPerson").value = (tag && tag.rule && tag.rule.person) || "";
  el("newTagPhrase").value = opts.phrase || (tag && tag.rule && tag.rule.phrase) || "";
  el("newTagPhraseAnd").value = opts.phraseAnd || (tag && tag.rule && tag.rule.phraseAnd) || "";
  selectedHue = tag ? tag.hue : HUE_PRESETS[Math.floor(Math.random() * HUE_PRESETS.length)];
  renderHueSwatches();

  el("newTagStrongsRow").classList.toggle("hidden", manualOnly);
  el("newTagTopicRow").classList.toggle("hidden", manualOnly);
  el("newTagPersonRow").classList.toggle("hidden", manualOnly);
  el("newTagPhraseRow").classList.toggle("hidden", manualOnly);
  el("newTagPhraseAndRow").classList.toggle("hidden", manualOnly);

  if (!manualOnly) {
    ensureTopicsLoaded().then(() => populateDatalist("topicsDatalist", Object.keys(topicsData)));
    ensurePersonsLoaded().then(() => populateDatalist("personsDatalist", Object.keys(personsData)));
  }

  el("newTagOverlay").classList.remove("hidden");
}

el("tagAssignAddBtn").addEventListener("click", () => {
  openNewTagModal({ autoAssignKeys: tagAssignKeys, manualOnly: true });
});

el("newTagPageBtn").addEventListener("click", () => openNewTagModal({ manualOnly: true }));

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

el("newTagCancel").addEventListener("click", () => {
  editingTagId = null;
  newTagAutoAssignKeys = null;
  el("newTagOverlay").classList.add("hidden");
});

el("newTagForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el("newTagName").value.trim();
  if (!name) return;

  const strongsInput = el("newTagStrongs").value.trim().toUpperCase();
  const topicInput = el("newTagTopic").value.trim();
  const personInput = el("newTagPerson").value.trim();
  const phraseInput = el("newTagPhrase").value.trim();
  const phraseAndInput = el("newTagPhraseAnd").value.trim();

  let rule = null;
  if (strongsInput && /^[GH]\d+$/.test(strongsInput)) {
    rule = { strongs: strongsInput };
  } else if (topicInput) {
    const matched = Object.keys(topicsData || {}).find((t) => t.toLowerCase() === topicInput.toLowerCase());
    if (matched) rule = { topic: matched };
  } else if (personInput) {
    const matched = Object.keys(personsData || {}).find((p) => p.toLowerCase() === personInput.toLowerCase());
    if (matched) rule = { person: matched };
  } else if (phraseInput) {
    rule = { phrase: phraseInput };
    if (phraseAndInput) rule.phraseAnd = phraseAndInput;
  }

  let tag;
  if (editingTagId) {
    tag = tagsData.tags.find((t) => t.id === editingTagId);
    tag.name = name;
    tag.hue = selectedHue;
    if (rule) tag.rule = rule;
    else delete tag.rule;
  } else {
    tag = { id: crypto.randomUUID(), name, hue: selectedHue };
    if (rule) tag.rule = rule;
    tagsData.tags.push(tag);
    if (!rule && newTagAutoAssignKeys) toggleTagForKeys(newTagAutoAssignKeys, tag.id);
  }

  editingTagId = null;
  newTagAutoAssignKeys = null;
  invalidateSmartTagCache();
  scheduleSave();

  const finish = () => {
    renderVerses();
    renderTagAssignList();
    if (currentView === "verse") renderVerseDetailTags();
    if (currentView === "tags") renderTagsView();
    if (currentView === "topics") renderTopicsView();
    if (wordStudyConcNum) renderWordStudyCard(wordStudyConcNum, [wordStudyConcNum]);
  };
  if (rule && rule.strongs) ensureConcordanceLoaded().then(finish);
  else finish();

  el("newTagOverlay").classList.add("hidden");
});

// ---------- Tags browse view (manual tags only) ----------

function isSmartTag(tag) {
  return !!(tag.rule && (tag.rule.strongs || tag.rule.topic || tag.rule.person));
}

function renderTagsView() {
  renderTagFilterBar();
  renderTagVerseList();
  refreshYouVersionStatus();
}

// ---------- YouVersion (Bible.com) connect ----------
//
// PKCE OAuth flow — no client secret exists anywhere, this app's App Key is
// a public client_id. The token exchange still happens server-side (a
// Netlify Function) and tokens are stored server-side via Netlify Blobs,
// never in the browser, consistent with how this app already stores tags.

const YOUVERSION_APP_KEY = "Z8ou4eKH1jLzXHa8QOvlNnCgLQmXRtY2tyIfBg31o8omy0IO";
const YOUVERSION_AUTHORIZE_ENDPOINT = "https://api.youversion.com/auth/authorize";

function base64UrlEncode(buffer) {
  let binary = "";
  new Uint8Array(buffer).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomPkceString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr.buffer);
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

async function connectYouVersion() {
  const verifier = randomPkceString(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomPkceString(24);
  sessionStorage.setItem("yv_pkce_verifier", verifier);
  sessionStorage.setItem("yv_oauth_state", state);

  const redirectUri = window.location.origin + "/youversion-callback.html";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: YOUVERSION_APP_KEY,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state,
    nonce: randomPkceString(16),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${YOUVERSION_AUTHORIZE_ENDPOINT}?${params}`;
}

async function refreshYouVersionStatus() {
  const statusText = el("youversionStatusText");
  const connectBtn = el("youversionConnectBtn");
  const disconnectBtn = el("youversionDisconnectBtn");
  statusText.textContent = "Checking YouVersion connection…";
  connectBtn.classList.add("hidden");
  disconnectBtn.classList.add("hidden");

  try {
    const res = await fetch("/api/youversion/status");
    const data = await res.json();
    if (data.connected) {
      statusText.textContent = "YouVersion account connected.";
      disconnectBtn.classList.remove("hidden");
    } else {
      statusText.textContent = "YouVersion account not connected.";
      connectBtn.classList.remove("hidden");
    }
  } catch (err) {
    console.error(err);
    statusText.textContent = "Couldn't check YouVersion connection status.";
    connectBtn.classList.remove("hidden");
  }
}

el("youversionConnectBtn").addEventListener("click", connectYouVersion);

el("youversionDisconnectBtn").addEventListener("click", async () => {
  try {
    await fetch("/api/youversion/status", { method: "DELETE" });
  } catch (err) {
    console.error(err);
  }
  refreshYouVersionStatus();
});

function handleYouVersionRedirectParam() {
  const params = new URLSearchParams(window.location.search);
  const yvConnect = params.get("yvConnect");
  if (!yvConnect) return;
  const reason = params.get("reason");
  const detail = params.get("detail");
  window.history.replaceState({}, "", window.location.pathname);
  if (yvConnect === "success") {
    alert("YouVersion account connected.");
  } else {
    alert(`Couldn't connect your YouVersion account.\nReason: ${reason || "unknown"}${detail ? `\nDetail: ${detail}` : ""}`);
  }
}

function ruleDescription(rule) {
  if (rule.strongs) return `Strong's ${rule.strongs}`;
  if (rule.topic) return `Topic: ${rule.topic}`;
  if (rule.person) return `Person: ${rule.person}`;
  if (rule.phrase) return `Phrase: "${rule.phrase}"${rule.phraseAnd ? ` AND "${rule.phraseAnd}"` : ""}`;
  return "";
}

// ---------- Topics view (auto-tags: create/edit/manage, browse Nave's topics) ----------

function renderTopicsView() {
  renderAutoTagsList();
}

function renderAutoTagsList() {
  const list = el("autoTagsList");
  const ruleTags = tagsData.tags.filter(isSmartTag);
  list.innerHTML = "";

  if (!ruleTags.length) {
    list.innerHTML = '<div class="empty-msg">No auto-tags yet. Create one above, or find a topic to tag below.</div>';
    return;
  }

  ruleTags.forEach((tag) => {
    const { bg, text: fg } = chipColors(tag.hue);
    const row = document.createElement("div");
    row.className = "smart-tag-row";
    row.innerHTML = `
      <span class="tag-chip" style="background:${bg};color:${fg}">${escapeHtml(tag.name)}</span>
      <span class="smart-tag-desc">${escapeHtml(ruleDescription(tag.rule))}</span>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openTopicReading(tag.id);
    });
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-outline btn-small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openNewTagModal({ editTagId: tag.id }));
    row.appendChild(editBtn);
    list.appendChild(row);
  });
}

// ---------- Topic reading view ----------
//
// Auto-tags aren't manual tags — they're closer to a curated reading list
// (Nave's topical entries, a Strong's word across the text, etc.) than to
// something the user deliberately marked. So instead of dumping their
// matches into the Tags page's card list with tag-colored highlighting,
// clicking one opens a dedicated, continuous reading view: grouped passages
// rendered with the same typography/interaction as the main reading view
// (buildVerseSpan — which only colors *manually* assigned tags, so a verse
// the user has also tagged by hand still shows that, just not the auto-tag
// itself as a highlight).

let topicReadingTagId = null;

function groupConsecutiveVerses(keys) {
  const entries = keys
    .map((key) => ({ key, ...parseVerseKey(key) }))
    .sort((a, b) => {
      const oa = booksById.get(a.bookId)?.order ?? 0;
      const ob = booksById.get(b.bookId)?.order ?? 0;
      return oa - ob || a.chapter - b.chapter || a.verse - b.verse;
    });

  const groups = [];
  entries.forEach(({ key, bookId, chapter, verse }) => {
    const last = groups[groups.length - 1];
    if (last && last.bookId === bookId && last.chapter === chapter && verse === last.endVerse + 1) {
      last.endVerse = verse;
      last.keys.push(key);
    } else {
      groups.push({ bookId, chapter, startVerse: verse, endVerse: verse, keys: [key] });
    }
  });
  return groups;
}

function openTopicReading(tagId) {
  topicReadingTagId = tagId;
  renderTopicReading();
  showView("topicReading");
}

function renderTopicReading() {
  const tag = tagsData.tags.find((t) => t.id === topicReadingTagId);
  const container = el("topicReadingContent");
  if (!tag) {
    container.innerHTML = "";
    return;
  }

  el("topicReadingHeading").textContent = tag.name;
  el("topicReadingDesc").textContent = ruleDescription(tag.rule);

  const sets = getSmartTagSets();
  const keys = sets ? [...(sets.get(tag.id) || [])] : [];
  const groups = groupConsecutiveVerses(keys);

  el("topicReadingCount").textContent = keys.length
    ? `${keys.length} verse${keys.length === 1 ? "" : "s"} in ${groups.length} passage${groups.length === 1 ? "" : "s"}`
    : "";

  container.innerHTML = "";
  if (!groups.length) {
    container.innerHTML = '<div class="empty-msg">No verses found for this auto-tag yet.</div>';
    return;
  }

  groups.forEach((group) => {
    const book = booksById.get(group.bookId);
    const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];
    const refText =
      group.startVerse === group.endVerse
        ? refLabel(group.bookId, group.chapter, group.startVerse)
        : `${refLabel(group.bookId, group.chapter, group.startVerse)}–${group.endVerse}`;

    const section = document.createElement("div");
    section.className = "topic-reading-passage";

    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "topic-reading-ref";
    heading.textContent = refText;
    heading.addEventListener("click", () => goToVerseInChapter(group.keys));
    section.appendChild(heading);

    const para = document.createElement("p");
    para.className = "topic-reading-para";
    group.keys.forEach((key) => {
      const { verse } = parseVerseKey(key);
      const text = chapters[group.chapter - 1].verses[verse - 1];
      para.appendChild(buildVerseSpan(key, text, true, verse));
      para.appendChild(document.createTextNode(" "));
    });
    section.appendChild(para);

    container.appendChild(section);
  });
}

document.querySelectorAll(".subnav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const nav = tab.closest(".tags-subnav");
    nav.querySelectorAll(".subnav-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const showBrowse = tab.dataset.topictab === "browse";
    el("myAutoTagsTab").classList.toggle("hidden", showBrowse);
    el("browseTopicsTab").classList.toggle("hidden", !showBrowse);
    if (showBrowse) renderTopicsBrowseList(el("topicsSearchInput").value);
  });
});

el("newAutoTagBtn").addEventListener("click", () => openNewTagModal());

const TOPICS_BROWSE_CAP = 300;
const TOPIC_CATEGORY_LABELS = { person: "People", place: "Places", topic: "Topics & Themes" };
let topicsBrowseCategory = null; // null | 'person' | 'place' | 'topic'

function renderTopicCategoryFilterBar() {
  const bar = el("topicCategoryFilterBar");
  bar.innerHTML = "";

  const counts = { person: 0, place: 0, topic: 0 };
  Object.values(topicCategories).forEach((c) => counts[c]++);

  const makePill = (label, active, onClick) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (active ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    bar.appendChild(btn);
  };

  makePill("All", topicsBrowseCategory === null, () => {
    topicsBrowseCategory = null;
    renderTopicsBrowseList(el("topicsSearchInput").value);
  });
  Object.entries(TOPIC_CATEGORY_LABELS).forEach(([key, label]) => {
    makePill(`${label} · ${counts[key]}`, topicsBrowseCategory === key, () => {
      topicsBrowseCategory = topicsBrowseCategory === key ? null : key;
      renderTopicsBrowseList(el("topicsSearchInput").value);
    });
  });
}

function renderTopicsBrowseList(query) {
  const container = el("topicsBrowseList");
  container.innerHTML = '<div class="empty-msg">Loading topics…</div>';

  Promise.all([ensureTopicsLoaded(), ensureTopicCategoriesLoaded()]).then(() => {
    renderTopicCategoryFilterBar();

    const q = (query || "").trim().toLowerCase();
    const names = Object.keys(topicsData)
      .filter((n) => !q || n.toLowerCase().includes(q))
      .filter((n) => !topicsBrowseCategory || topicCategories[n] === topicsBrowseCategory)
      .sort();

    container.innerHTML = "";
    if (!names.length) {
      container.innerHTML = '<div class="empty-msg">No topics match your search.</div>';
      return;
    }

    names.slice(0, TOPICS_BROWSE_CAP).forEach((name) => {
      const count = topicsData[name].length;
      const row = document.createElement("div");
      row.className = "topic-browse-row";
      row.innerHTML = `
        <span class="topic-browse-name">${escapeHtml(name)}</span>
        <span class="topic-browse-count">${count} verse${count === 1 ? "" : "s"}</span>
      `;
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn btn-outline btn-small";
      addBtn.textContent = "+ Tag";
      addBtn.addEventListener("click", () => openNewTagModal({ topic: name, name }));
      row.appendChild(addBtn);
      container.appendChild(row);
    });

    if (names.length > TOPICS_BROWSE_CAP) {
      const more = document.createElement("div");
      more.className = "empty-msg";
      more.textContent = `Showing first ${TOPICS_BROWSE_CAP} of ${names.length} — narrow your search to see more.`;
      container.appendChild(more);
    }
  });
}

el("topicsSearchInput").addEventListener("input", () => {
  renderTopicsBrowseList(el("topicsSearchInput").value);
});

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

  function tagCount(tag) {
    return Object.values(tagsData.verseTags).filter((e) => e.tagIds.includes(tag.id)).length;
  }

  const manualTags = tagsData.tags.filter((t) => !isSmartTag(t));
  manualTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (activeTagFilter === tag.id ? " active" : "");
    btn.textContent = `${tag.name} · ${tagCount(tag)}`;
    btn.addEventListener("click", () => {
      activeTagFilter = tag.id;
      renderTagsView();
    });
    bar.appendChild(btn);
  });

  // Auto-tags aren't listed as pills here (managed on the Topics page), but
}

function sameTagIds(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

const TAG_VERSE_LIST_CAP = 500;

function renderTagVerseList() {
  const container = el("tagVerseList");
  container.innerHTML = "";

  let entries = Object.keys(tagsData.verseTags)
    .filter((key) => (activeTagFilter ? (tagsData.verseTags[key].tagIds || []).includes(activeTagFilter) : true))
    .map((key) => ({ key, ...parseVerseKey(key) }))
    .sort((a, b) => {
      const oa = booksById.get(a.bookId)?.order ?? 0;
      const ob = booksById.get(b.bookId)?.order ?? 0;
      return oa - ob || a.chapter - b.chapter || a.verse - b.verse;
    });

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-msg">No tagged verses yet. Select a verse while reading to add a tag or note.</div>';
    return;
  }

  const truncated = entries.length > TAG_VERSE_LIST_CAP;
  if (truncated) entries = entries.slice(0, TAG_VERSE_LIST_CAP);

  // Group consecutive verses that share the same note + tags into one card,
  // so a note written for a passage reads as belonging to the whole passage.
  const groups = [];
  entries.forEach(({ key, bookId, chapter, verse }) => {
    const note = tagsData.verseTags[key]?.note || "";
    const tagIds = tagsData.verseTags[key]?.tagIds || [];
    const last = groups[groups.length - 1];
    if (
      last &&
      last.bookId === bookId &&
      last.chapter === chapter &&
      verse === last.endVerse + 1 &&
      note === (last.note || "") &&
      sameTagIds(tagIds, last.tagIds || [])
    ) {
      last.endVerse = verse;
      last.keys.push(key);
    } else {
      groups.push({
        bookId,
        chapter,
        startVerse: verse,
        endVerse: verse,
        note,
        tagIds,
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

  if (truncated) {
    const note = document.createElement("div");
    note.className = "empty-msg";
    note.textContent = `Showing first ${TAG_VERSE_LIST_CAP} verses — narrow with a tag filter above to see more.`;
    container.appendChild(note);
  }
}

// ---------- Search ----------

el("searchToggleBtn").addEventListener("click", () => {
  el("searchInput").value = "";
  el("searchAndInput").value = "";
  el("searchHeading").classList.add("hidden");
  el("searchEmptyHint").classList.remove("hidden");
  el("searchToolbar").classList.add("hidden");
  el("searchSynonymBanner").classList.add("hidden");
  el("searchResults").innerHTML = "";
  baseSearchResults = [];
  matchedSynonymTopic = null;
  topicSynonymIncluded = false;
  searchTestamentFilter = null;
  searchBookFilter = null;
  clearSelection();
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

function handleSearchEnter(e) {
  if (e.key !== "Enter") return;
  const query = el("searchInput").value.trim();
  if (!query) return;
  const andQuery = el("searchAndInput").value.trim();

  if (!andQuery) {
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
  }

  runTextSearch(query, andQuery);
}

el("searchInput").addEventListener("keydown", handleSearchEnter);
el("searchAndInput").addEventListener("keydown", handleSearchEnter);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SEARCH_RESULT_CAP = 1000;

function runTextSearch(query, andQuery) {
  const q = query.toLowerCase();
  const q2 = (andQuery || "").toLowerCase();
  const results = [];

  outer:
  for (const book of bible.books) {
    const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];
    for (let c = 0; c < chapters.length; c++) {
      const chapterVerses = chapters[c].verses;
      for (let v = 0; v < chapterVerses.length; v++) {
        const lower = chapterVerses[v].toLowerCase();
        if (lower.includes(q) && (!q2 || lower.includes(q2))) {
          results.push({ bookId: book.id, chapter: c + 1, verse: v + 1, text: chapterVerses[v] });
          if (results.length >= SEARCH_RESULT_CAP) break outer;
        }
      }
    }
  }

  lastSearchQuery = query;
  lastSearchAndQuery = andQuery || "";
  baseSearchResults = results;
  matchedSynonymTopic = null;
  topicSynonymIncluded = false;
  searchTestamentFilter = null;
  searchBookFilter = null;
  clearSelection();

  el("searchEmptyHint").classList.add("hidden");
  el("searchHeading").classList.remove("hidden");
  el("searchSynonymBanner").classList.add("hidden");

  renderSearchResults();
  showView("search");

  // A synonym/topic suggestion only makes sense for a single-term search.
  if (!lastSearchAndQuery) {
    ensureTopicsLoaded().then(() => {
      const upper = query.trim().toUpperCase();
      if (topicsData[upper] && topicsData[upper].length) {
        matchedSynonymTopic = upper;
        renderSearchResults();
      }
    });
  }
}

function currentSearchResultSet() {
  if (!topicSynonymIncluded || !matchedSynonymTopic) return baseSearchResults;
  const existingKeys = new Set(baseSearchResults.map((r) => verseKey(r.bookId, r.chapter, r.verse)));
  const extra = (topicsData[matchedSynonymTopic] || [])
    .filter((k) => !existingKeys.has(k))
    .map((k) => {
      const { bookId, chapter, verse } = parseVerseKey(k);
      const book = booksById.get(bookId);
      const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];
      const text = chapters[chapter - 1].verses[verse - 1];
      return { bookId, chapter, verse, text, viaTopic: true };
    });
  return [...baseSearchResults, ...extra];
}

function filteredSearchResults() {
  return currentSearchResultSet().filter((r) => {
    if (searchTestamentFilter && booksById.get(r.bookId)?.testament !== searchTestamentFilter) return false;
    if (searchBookFilter && r.bookId !== searchBookFilter) return false;
    return true;
  });
}

function renderSearchFilterBar(filtered) {
  const bar = el("searchFilterBar");
  bar.innerHTML = "";
  const all = currentSearchResultSet();

  const makePill = (label, active, onClick) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (active ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    bar.appendChild(btn);
  };

  makePill("All", searchTestamentFilter === null, () => {
    searchTestamentFilter = null;
    searchBookFilter = null;
    renderSearchResults();
  });
  makePill("Old Testament", searchTestamentFilter === "OT", () => {
    searchTestamentFilter = searchTestamentFilter === "OT" ? null : "OT";
    searchBookFilter = null;
    renderSearchResults();
  });
  makePill("New Testament", searchTestamentFilter === "NT", () => {
    searchTestamentFilter = searchTestamentFilter === "NT" ? null : "NT";
    searchBookFilter = null;
    renderSearchResults();
  });

  const booksInScope = (searchTestamentFilter ? all.filter((r) => booksById.get(r.bookId)?.testament === searchTestamentFilter) : all).reduce(
    (set, r) => set.add(r.bookId),
    new Set()
  );

  if (booksInScope.size > 1) {
    [...booksInScope]
      .sort((a, b) => (booksById.get(a)?.order ?? 0) - (booksById.get(b)?.order ?? 0))
      .forEach((bookId) => {
        const book = booksById.get(bookId);
        if (!book) return;
        makePill(book.name, searchBookFilter === bookId, () => {
          searchBookFilter = searchBookFilter === bookId ? null : bookId;
          renderSearchResults();
        });
      });
  }
}

function renderSynonymBanner() {
  const banner = el("searchSynonymBanner");
  if (!matchedSynonymTopic) {
    banner.classList.add("hidden");
    return;
  }
  const count = (topicsData[matchedSynonymTopic] || []).length;
  banner.classList.remove("hidden");
  banner.innerHTML = "";

  const label = document.createElement("span");
  label.textContent = topicSynonymIncluded
    ? `Including ${count} verses from the topic "${matchedSynonymTopic}" (related words like synonyms, not just the literal text).`
    : `This also matches Nave's topic "${matchedSynonymTopic}" (${count} verses, including related words/synonyms) — not shown yet.`;
  banner.appendChild(label);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-outline btn-small";
  btn.textContent = topicSynonymIncluded ? "Remove topic verses" : "Include topic verses";
  btn.addEventListener("click", () => {
    topicSynonymIncluded = !topicSynonymIncluded;
    renderSearchResults();
  });
  banner.appendChild(btn);
}

function renderSearchResults() {
  const filtered = filteredSearchResults();
  const all = currentSearchResultSet();

  const capSuffix = baseSearchResults.length >= SEARCH_RESULT_CAP ? "+" : "";
  const andLabel = lastSearchAndQuery ? ` AND "${lastSearchAndQuery}"` : "";
  el("searchHeading").textContent =
    `Search results for "${lastSearchQuery}"${andLabel} (${filtered.length}${filtered.length !== all.length ? ` of ${all.length}${capSuffix}` : capSuffix})`;

  el("searchToolbar").classList.toggle("hidden", all.length === 0);
  renderSynonymBanner();
  renderSearchFilterBar(filtered);

  const allSelected = filtered.length > 0 && filtered.every((r) => selection.has(verseKey(r.bookId, r.chapter, r.verse)));
  const selectAllBtn = el("searchSelectAllBtn");
  selectAllBtn.textContent = allSelected ? "Deselect all" : "Select all";
  selectAllBtn.disabled = filtered.length === 0;
  el("searchSaveAutoTagBtn").classList.toggle("hidden", baseSearchResults.length === 0);

  const container = el("searchResults");
  container.innerHTML = "";
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-msg">${all.length === 0 ? "No matches found." : "No matches in this filter."}</div>`;
    return;
  }

  filtered.forEach(({ bookId, chapter, verse, text, viaTopic }) => {
    const key = verseKey(bookId, chapter, verse);
    const card = document.createElement("div");
    card.className = "verse-card card-checkbox-row";
    let highlighted = escapeHtml(text);
    if (!viaTopic) {
      highlighted = highlighted.replace(new RegExp(escapeRegExp(escapeHtml(lastSearchQuery)), "ig"), (m) => `<mark>${m}</mark>`);
      if (lastSearchAndQuery) {
        highlighted = highlighted.replace(new RegExp(escapeRegExp(escapeHtml(lastSearchAndQuery)), "ig"), (m) => `<mark>${m}</mark>`);
      }
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "card-checkbox";
    checkbox.checked = selection.has(key);
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selection.add(key);
      else selection.delete(key);
      lastClickedKey = key;
      updateSelectionBar();
      renderSearchResults();
    });
    card.appendChild(checkbox);

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <div class="card-ref">${refLabel(bookId, chapter, verse)}${viaTopic ? ' <span class="via-topic-badge">via topic</span>' : ""}</div>
      <div class="card-text">${highlighted}</div>
    `;
    body.addEventListener("click", () => openVerseDetail(key));
    card.appendChild(body);

    container.appendChild(card);
  });
}

el("searchSelectAllBtn").addEventListener("click", () => {
  const filtered = filteredSearchResults();
  const allSelected = filtered.length > 0 && filtered.every((r) => selection.has(verseKey(r.bookId, r.chapter, r.verse)));
  filtered.forEach((r) => {
    const key = verseKey(r.bookId, r.chapter, r.verse);
    if (allSelected) selection.delete(key);
    else selection.add(key);
  });
  updateSelectionBar();
  renderSearchResults();
});

el("searchSaveAutoTagBtn").addEventListener("click", () => {
  showView("topics");
  renderTopicsView();
  openNewTagModal({ phrase: lastSearchQuery, phraseAnd: lastSearchAndQuery, name: lastSearchQuery });
});

// ---------- Word study panel ----------

let strongsTokens = null;
let strongsLexicon = null;
let strongsConcordance = null;
let strongsDataPromise = null;

let wordStudyVerseKey = null;
let wordStudyConcNum = null;
let wordStudyConcExpanded = false;
let wordStudyConcTestament = null; // null | 'OT' | 'NT'
let wordStudyConcBook = null;

const CHART_HUES = [250, 10, 145, 40, 290, 190, 330, 70];
const CONCORDANCE_RENDER_CAP = 300;

function loadStrongsData() {
  if (!strongsDataPromise) {
    strongsDataPromise = Promise.all([
      strongsTokens ? Promise.resolve(strongsTokens) : fetchJSON("data/strongs-tokens.json"),
      strongsLexicon ? Promise.resolve(strongsLexicon) : fetchJSON("data/strongs-lexicon.json"),
      strongsConcordance ? Promise.resolve(strongsConcordance) : fetchJSON("data/strongs-concordance.json"),
    ]).then(([tokens, lexicon, concordance]) => {
      strongsTokens = tokens;
      strongsLexicon = lexicon;
      strongsConcordance = concordance;
    });
  }
  return strongsDataPromise;
}

// ---------- Smart (rule-based) tags ----------
//
// A tag with a `rule: {strongs: "G26"}`, `rule: {topic: "AARON"}`, or
// `rule: {person: "David"}` field auto-applies to every matching verse,
// computed live from the relevant index rather than written into
// verseTags — so it never mutates saved verse data.

let concordanceOnlyPromise = null;
let topicsData = null;
let topicsPromise = null;
let topicCategories = null; // { topicName: "person" | "place" | "topic" }
let topicCategoriesPromise = null;
let personsData = null;
let personsPromise = null;
let smartTagSetsCache = null; // Map<tagId, Set<verseKey>>

function ensureConcordanceLoaded() {
  if (strongsConcordance) return Promise.resolve();
  if (!concordanceOnlyPromise) {
    concordanceOnlyPromise = fetchJSON("data/strongs-concordance.json").then((c) => {
      strongsConcordance = c;
    });
  }
  return concordanceOnlyPromise;
}

function ensureTopicsLoaded() {
  if (topicsData) return Promise.resolve();
  if (!topicsPromise) {
    topicsPromise = fetchJSON("data/topics.json").then((t) => {
      topicsData = t;
    });
  }
  return topicsPromise;
}

function ensureTopicCategoriesLoaded() {
  if (topicCategories) return Promise.resolve();
  if (!topicCategoriesPromise) {
    topicCategoriesPromise = fetchJSON("data/topic-categories.json").then((c) => {
      topicCategories = c;
    });
  }
  return topicCategoriesPromise;
}

function ensurePersonsLoaded() {
  if (personsData) return Promise.resolve();
  if (!personsPromise) {
    personsPromise = fetchJSON("data/persons.json").then((p) => {
      personsData = p;
    });
  }
  return personsPromise;
}

function invalidateSmartTagCache() {
  smartTagSetsCache = null;
}

function versesMatchingPhrase(phrase, phraseAnd) {
  const q = (phrase || "").trim().toLowerCase();
  const q2 = (phraseAnd || "").trim().toLowerCase();
  if (!q) return [];
  const keys = [];
  bible.books.forEach((book) => {
    const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];
    chapters.forEach((chapter, ci) => {
      chapter.verses.forEach((text, vi) => {
        const lower = text.toLowerCase();
        if (lower.includes(q) && (!q2 || lower.includes(q2))) {
          keys.push(`${book.id}-${ci + 1}-${vi + 1}`);
        }
      });
    });
  });
  return keys;
}

function getSmartTagSets() {
  const anyRule = tagsData.tags.some((t) => t.rule);
  if (!anyRule) return null;
  if (!smartTagSetsCache) {
    smartTagSetsCache = new Map();
    tagsData.tags.forEach((tag) => {
      if (tag.rule && tag.rule.strongs && strongsConcordance) {
        smartTagSetsCache.set(tag.id, new Set(strongsConcordance[tag.rule.strongs] || []));
      } else if (tag.rule && tag.rule.topic && topicsData) {
        smartTagSetsCache.set(tag.id, new Set(topicsData[tag.rule.topic] || []));
      } else if (tag.rule && tag.rule.person && personsData) {
        smartTagSetsCache.set(tag.id, new Set(personsData[tag.rule.person] || []));
      } else if (tag.rule && tag.rule.phrase) {
        smartTagSetsCache.set(tag.id, new Set(versesMatchingPhrase(tag.rule.phrase, tag.rule.phraseAnd)));
      }
    });
  }
  return smartTagSetsCache;
}

function smartTagIdsForKey(key) {
  const sets = getSmartTagSets();
  if (!sets) return [];
  const ids = [];
  sets.forEach((set, tagId) => {
    if (set.has(key)) ids.push(tagId);
  });
  return ids;
}

function anySmartTagsDefined() {
  return tagsData.tags.some((t) => t.rule && (t.rule.strongs || t.rule.topic || t.rule.person));
}

function loadAnyDefinedSmartTagSources() {
  const jobs = [];
  if (tagsData.tags.some((t) => t.rule && t.rule.strongs)) jobs.push(ensureConcordanceLoaded());
  if (tagsData.tags.some((t) => t.rule && t.rule.topic)) jobs.push(ensureTopicsLoaded());
  if (tagsData.tags.some((t) => t.rule && t.rule.person)) jobs.push(ensurePersonsLoaded());
  return Promise.all(jobs);
}

async function openWordStudyPanel(key) {
  wordStudyVerseKey = key;
  const { bookId, chapter, verse } = parseVerseKey(key);
  el("wordStudyRef").textContent = refLabel(bookId, chapter, verse);
  el("wordStudyPanel").classList.remove("hidden");
  el("wordStudyDetail").classList.add("hidden");
  el("wordStudyChips").classList.add("hidden");
  el("wordStudyLoading").classList.remove("hidden");

  await loadStrongsData();
  if (wordStudyVerseKey !== key) return; // panel closed or moved on while loading

  el("wordStudyLoading").classList.add("hidden");
  el("wordStudyChips").classList.remove("hidden");
  renderWordStudyChips(key);
}

function closeWordStudyPanel() {
  wordStudyVerseKey = null;
  el("wordStudyPanel").classList.add("hidden");
}

el("wordStudyCloseBtn").addEventListener("click", closeWordStudyPanel);

// Not every English word has its own Strong's number — Hebrew/Greek don't map
// word-for-word onto English, so helper words (e.g. "Let" in "Let...bring
// forth[H1876]") often go untagged even though they're part of a tagged
// phrase. Rather than a dead end, link untagged words to whichever tagged
// word is nearest in the same verse (by word distance, ties favor the word
// that follows), and say plainly that it's a proximity link, not a claim
// that the words share an exact grammatical relationship.
function nearestTaggedIndex(tokens, index) {
  for (let d = 1; d < tokens.length; d++) {
    const after = index + d;
    const before = index - d;
    if (after < tokens.length && tokens[after].s && tokens[after].s.length) return after;
    if (before >= 0 && tokens[before].s && tokens[before].s.length) return before;
  }
  return -1;
}

function renderWordStudyChips(key) {
  const container = el("wordStudyChips");
  container.innerHTML = "";
  const tokens = strongsTokens[key];

  if (!tokens) {
    container.innerHTML = '<div class="empty-msg">No word study data for this verse.</div>';
    return;
  }

  tokens.forEach((tok, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = tok.t;
    if (tok.s && tok.s.length) {
      chip.className = "word-chip";
      chip.addEventListener("click", () => openWordDetail(tok.s));
    } else {
      chip.className = "word-chip word-chip-untagged";
      const nearestIdx = nearestTaggedIndex(tokens, i);
      chip.addEventListener("click", () => openUntaggedWordDetail(tok.t, nearestIdx >= 0 ? tokens[nearestIdx] : null));
    }
    container.appendChild(chip);
  });
}

function openUntaggedWordDetail(word, linkedToken) {
  el("wordStudyChips").classList.add("hidden");
  el("wordStudyDetail").classList.remove("hidden");
  const card = el("wordStudyCard");

  const note = linkedToken
    ? `<div class="wsc-def">This word doesn't carry its own Strong's number in the underlying text — English and the original Hebrew/Greek don't always map word-for-word. The nearest tagged word in this verse is <strong>${escapeHtml(linkedToken.t)}</strong> (${escapeHtml(linkedToken.s.join(", "))}).</div>`
    : `<div class="wsc-def">This word doesn't carry its own Strong's number, and no other word in this verse does either.</div>`;

  card.innerHTML = `
    <div class="wsc-lemma-row"><span class="wsc-lemma">${escapeHtml(word)}</span></div>
    ${note}
    ${linkedToken ? `<button type="button" class="btn btn-outline btn-small" id="wscJumpToLinkedBtn">View "${escapeHtml(linkedToken.t)}" →</button>` : ""}
  `;

  if (linkedToken) {
    el("wscJumpToLinkedBtn").addEventListener("click", () => openWordDetail(linkedToken.s));
  }
}

el("wordStudyBackBtn").addEventListener("click", () => {
  el("wordStudyDetail").classList.add("hidden");
  el("wordStudyChips").classList.remove("hidden");
});

function openWordDetail(strongsNums) {
  el("wordStudyChips").classList.add("hidden");
  el("wordStudyDetail").classList.remove("hidden");
  wordStudyConcExpanded = false;
  wordStudyConcTestament = null;
  wordStudyConcBook = null;
  renderWordStudyCard(strongsNums[0], strongsNums);
}

function buildTranslationDonut(translations) {
  const entries = Object.entries(translations || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (!total) return "";

  let cursor = 0;
  const stops = entries
    .map(([, count], i) => {
      const hue = CHART_HUES[i % CHART_HUES.length];
      const start = cursor;
      cursor += (count / total) * 100;
      return `oklch(0.72 0.13 ${hue}) ${start}% ${cursor}%`;
    })
    .join(", ");

  const legend = entries
    .map(([word, count], i) => {
      const hue = CHART_HUES[i % CHART_HUES.length];
      const pct = Math.round((count / total) * 100);
      return `<div class="wsc-legend-row"><span class="wsc-legend-dot" style="background:oklch(0.72 0.13 ${hue})"></span><span class="wsc-legend-label">${escapeHtml(word)}</span><span class="wsc-legend-pct">${count}× · ${pct}%</span></div>`;
    })
    .join("");

  return `
    <div class="wsc-chart-row">
      <div class="wsc-donut" style="background: conic-gradient(${stops})"></div>
      <div class="wsc-legend">${legend}</div>
    </div>
  `;
}

function renderWordStudyCard(num, allNums) {
  const entry = strongsLexicon[num];
  const card = el("wordStudyCard");

  if (!entry) {
    card.innerHTML = `<div class="empty-msg">No lexicon entry for ${escapeHtml(num)}.</div>`;
    return;
  }

  wordStudyConcNum = num;
  const keys = strongsConcordance[num] || [];
  const occurrences = keys.length;

  // A handful of lexicon entries have a near-empty "def" field (e.g. just
  // "."), so fall back to the outline_usage field, which is usually intact.
  const hasDef = entry.def && entry.def.trim().replace(/\.$/, "").length > 0;
  const defText = hasDef ? entry.def : entry.outline;

  card.innerHTML = `
    <div class="wsc-lemma-row">
      <span class="wsc-lemma">${escapeHtml(entry.lemma)}</span>
      <span class="wsc-translit">${escapeHtml(entry.translit)}</span>
      <span class="wsc-number">${escapeHtml(num)}</span>
    </div>
    <div class="wsc-pos">${escapeHtml(entry.pos || "")}</div>
    <div class="wsc-def">${escapeHtml(defText || "No definition available.")}</div>
    ${
      Object.keys(entry.translations || {}).length
        ? `<div><div class="wsc-section-label">Translated as</div>${buildTranslationDonut(entry.translations)}</div>`
        : ""
    }
    <div class="wsc-actions">
      <button type="button" class="btn btn-accent-solid btn-small" id="wscTagAllBtn">Tag all occurrences…</button>
      <button type="button" class="btn btn-outline btn-small" id="wscCopyNoteBtn">Copy study note</button>
      <button type="button" class="btn btn-outline btn-small" id="wscAutoTagBtn">Auto-tag this word…</button>
    </div>
    <button type="button" class="wsc-conc-toggle" id="wscConcToggle">${occurrences} occurrence${occurrences === 1 ? "" : "s"} in this text ${wordStudyConcExpanded ? "▴" : "▾"}</button>
    <div id="wscConcSection" class="wsc-conc-section ${wordStudyConcExpanded ? "" : "hidden"}"></div>
    ${allNums.length > 1 ? `<div class="wsc-section-label">This word also carries ${allNums.length - 1} other tag(s) — showing ${escapeHtml(num)}.</div>` : ""}
  `;

  el("wscAutoTagBtn").addEventListener("click", () => {
    closeWordStudyPanel();
    showView("topics");
    renderTopicsView();
    openNewTagModal({ strongs: num });
  });

  el("wscTagAllBtn").addEventListener("click", () => {
    if (!keys.length) return;
    openTagAssign(keys, false);
  });

  el("wscCopyNoteBtn").addEventListener("click", async () => {
    const primaryTranslation = Object.entries(entry.translations || {}).sort((a, b) => b[1] - a[1])[0];
    const glossWord = primaryTranslation ? primaryTranslation[0] : entry.translit;
    const note = `Word Study: ${glossWord} (${num} - ${entry.translit}) | Def: ${entry.def}`;
    try {
      await navigator.clipboard.writeText(note);
      const btn = el("wscCopyNoteBtn");
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1200);
    } catch (err) {
      console.error(err);
    }
  });

  el("wscConcToggle").addEventListener("click", () => {
    wordStudyConcExpanded = !wordStudyConcExpanded;
    renderWordStudyCard(num, allNums);
  });

  if (wordStudyConcExpanded) renderConcordanceSection(num, keys);
}

function renderConcordanceSection(num, keys) {
  const section = el("wscConcSection");

  const filtered = keys.filter((k) => {
    const { bookId } = parseVerseKey(k);
    if (wordStudyConcTestament && booksById.get(bookId)?.testament !== wordStudyConcTestament) return false;
    if (wordStudyConcBook && bookId !== wordStudyConcBook) return false;
    return true;
  });

  const booksInScope = (
    wordStudyConcTestament ? keys.filter((k) => booksById.get(parseVerseKey(k).bookId)?.testament === wordStudyConcTestament) : keys
  ).reduce((set, k) => set.add(parseVerseKey(k).bookId), new Set());

  const filterBar = document.createElement("div");
  filterBar.className = "tag-filter-bar wsc-conc-filters";

  const makePill = (label, active, onClick) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (active ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    filterBar.appendChild(btn);
  };

  makePill("All", wordStudyConcTestament === null, () => {
    wordStudyConcTestament = null;
    wordStudyConcBook = null;
    renderConcordanceSection(num, keys);
  });
  makePill("OT", wordStudyConcTestament === "OT", () => {
    wordStudyConcTestament = wordStudyConcTestament === "OT" ? null : "OT";
    wordStudyConcBook = null;
    renderConcordanceSection(num, keys);
  });
  makePill("NT", wordStudyConcTestament === "NT", () => {
    wordStudyConcTestament = wordStudyConcTestament === "NT" ? null : "NT";
    wordStudyConcBook = null;
    renderConcordanceSection(num, keys);
  });

  if (booksInScope.size > 1) {
    [...booksInScope]
      .sort((a, b) => (booksById.get(a)?.order ?? 0) - (booksById.get(b)?.order ?? 0))
      .forEach((bookId) => {
        const book = booksById.get(bookId);
        if (!book) return;
        makePill(book.name, wordStudyConcBook === bookId, () => {
          wordStudyConcBook = wordStudyConcBook === bookId ? null : bookId;
          renderConcordanceSection(num, keys);
        });
      });
  }

  const list = document.createElement("div");
  list.className = "wsc-conc-list";

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-msg">No occurrences in this filter.</div>';
  } else {
    filtered.slice(0, CONCORDANCE_RENDER_CAP).forEach((key) => {
      const { bookId, chapter, verse } = parseVerseKey(key);
      const tokens = strongsTokens[key] || [];
      const text = tokens.map((t) => t.t).join(" ");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "wsc-conc-row";
      row.innerHTML = `<span class="wsc-conc-ref">${refLabel(bookId, chapter, verse)}</span><span class="wsc-conc-text">${escapeHtml(text)}</span>`;
      row.addEventListener("click", () => {
        closeWordStudyPanel();
        goToVerseInChapter([key]);
      });
      list.appendChild(row);
    });
    if (filtered.length > CONCORDANCE_RENDER_CAP) {
      const more = document.createElement("div");
      more.className = "empty-msg";
      more.textContent = `Showing first ${CONCORDANCE_RENDER_CAP} of ${filtered.length} — narrow with a filter above to see more.`;
      list.appendChild(more);
    }
  }

  section.innerHTML = "";
  section.appendChild(filterBar);
  section.appendChild(list);
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
