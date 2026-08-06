// State
let bible = null;
let booksById = new Map();
let tagsData = { tags: [], verseTags: {}, links: [] }; // tags: [{id,name,hue}], verseTags[key] = { tagIds:[], note:'' }, links: [{id, a:[keys], b:[keys], note}]
let currentUser = null; // { sub, email, name, picture, role } once signed in, else null
let categoriesData = { categories: [] }; // categories: [{id, name, description, tagIds:[], entries:[{id,key,note}]}]
let currentStudyId = null; // for study detail view
let editingStudyId = null; // set when the New Study modal is in edit mode

let currentBookId = null;
let currentChapter = 1;
let currentView = "read"; // 'read' | 'verse' | 'tags' | 'search'
let currentVerseKey = null; // for verse detail view
let activeTagFilter = null; // null = "All"
let advancedFilterClauses = []; // [{id, tagId, negate}], ANDed together
let advancedFilterActive = false;
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
let categoriesSaveTimer = null;

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

function sessionHeaders() {
  const sessionToken = localStorage.getItem("bible-study:sessionToken");
  return sessionToken ? { "X-Session-Token": sessionToken } : {};
}

// The only reason an API call 401s now is a missing/expired session — the
// site password gate was removed, browsing is public, and only saving
// tags/notes (or owner-only Studies writes) needs an account.
async function handleAuthFailure() {
  showLoginScreen();
}

async function fetchJSON(url) {
  const isApi = url.startsWith("/api/");
  const res = await fetch(url, { cache: "no-store", headers: isApi ? sessionHeaders() : undefined });
  if (isApi && res.status === 401) {
    await handleAuthFailure();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

// The session token is base64url(JSON payload).base64url(HMAC signature) —
// not encrypted, just signed, so the payload can be read client-side for
// display (name/photo/role) without a round trip. The server always
// re-verifies the signature itself on every write; this decode is purely
// for the UI and is never trusted for anything security-relevant.
function decodeSessionToken(token) {
  try {
    const [body] = token.split(".");
    let base64 = body.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "="; // atob expects padded input
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function loadCurrentUserFromStorage() {
  const token = localStorage.getItem("bible-study:sessionToken");
  currentUser = token ? decodeSessionToken(token) : null;
  if (currentUser && currentUser.exp && Date.now() > currentUser.exp) {
    localStorage.removeItem("bible-study:sessionToken");
    currentUser = null;
  }
}

function handleGoogleSessionParam() {
  const params = new URLSearchParams(window.location.search);
  const sessionToken = params.get("sessionToken");
  const googleConnect = params.get("googleConnect");
  if (!sessionToken && !googleConnect) return;

  window.history.replaceState({}, "", window.location.pathname);
  if (sessionToken) {
    localStorage.setItem("bible-study:sessionToken", sessionToken);
    loadCurrentUserFromStorage();
  } else {
    const detail = params.get("detail");
    alert(`Couldn't sign in with Google.\nReason: ${params.get("reason") || "unknown"}${detail ? `\nDetail: ${detail}` : ""}`);
  }
}

function isOwner() {
  // Local dev (.claude/server.ps1) has no session concept at all — it
  // keeps serving the flat tags.json/categories.json unconditionally, same
  // as before accounts existed — so treat local dev as the owner rather
  // than hiding every Studies edit control during local testing.
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return true;
  return !!currentUser && currentUser.role === "owner";
}

async function init() {
  handleGoogleSessionParam();
  loadCurrentUserFromStorage();

  try {
    const [bibleData, tagsJson, categoriesJson] = await Promise.all([
      fetchJSON("data/bible.json"),
      fetchJSON("/api/tags").catch(() => ({ tags: [], verseTags: {} })),
      fetchJSON("/api/categories").catch(() => ({ categories: [] })),
    ]);
    bible = bibleData;
    tagsData = tagsJson;
    if (!tagsData.tags) tagsData.tags = [];
    if (!tagsData.verseTags) tagsData.verseTags = {};
    if (!tagsData.links) tagsData.links = [];
    categoriesData = categoriesJson;
    if (!categoriesData.categories) categoriesData.categories = [];

    booksById = new Map(bible.books.map((b) => [b.id, b]));

    if (anySmartTagsDefined()) await loadAnyDefinedSmartTagSources();

    const lastView = localStorage.getItem("bible-study:lastView");

    const last = JSON.parse(localStorage.getItem("bible-study:lastLocation") || "null");
    if (last && booksById.has(last.bookId)) {
      selectBook(last.bookId, last.chapter || 1);
    } else {
      selectBook("genesis", 1);
    }

    if (lastView === "dashboard") {
      renderDashboardView();
      showView("dashboard");
    } else if (lastView === "tags") {
      renderTagsView();
      showView("tags");
    } else if (lastView === "topics" || lastView === "studies") {
      setStudiesTab(lastView === "topics" ? "topics" : "studies");
      showView("studies");
    } else if (lastView === "timeline" || lastView === "insights") {
      renderInsightsView();
      setInsightsTab(lastView === "timeline" ? "timeline" : "crossref");
      showView("insights");
    } else if (lastView === "settings") {
      renderSharesSection();
      showView("settings");
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
  el("dashboardView").classList.toggle("hidden", view !== "dashboard");
  el("readView").classList.toggle("hidden", view !== "read");
  el("verseView").classList.toggle("hidden", view !== "verse");
  el("tagsView").classList.toggle("hidden", view !== "tags");
  el("topicReadingView").classList.toggle("hidden", view !== "topicReading");
  el("studiesView").classList.toggle("hidden", view !== "studies");
  el("studyDetailView").classList.toggle("hidden", view !== "studyDetail");
  el("insightsView").classList.toggle("hidden", view !== "insights");
  el("settingsView").classList.toggle("hidden", view !== "settings");
  el("searchView").classList.toggle("hidden", view !== "search");

  const showBack = view === "verse" || view === "search" || view === "topicReading" || view === "studyDetail";
  el("backBtn").classList.toggle("hidden", !showBack);
  el("collapseBtn").classList.toggle("hidden", showBack);

  const breadcrumbs = {
    dashboard: "Dashboard",
    read: "Reading",
    verse: "Verse & Notes",
    tags: "Your tagged verses",
    topicReading: "Topic reading",
    studies: "Studies",
    studyDetail: "Study",
    insights: "Insights",
    settings: "Settings",
    search: "Search",
  };
  el("breadcrumb").textContent = breadcrumbs[view] || "";

  if (["dashboard", "read", "tags", "studies", "insights", "settings"].includes(view)) {
    localStorage.setItem("bible-study:lastView", view);
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.view === view ||
        (view === "verse" && item.dataset.view === "read") ||
        (view === "search" && item.dataset.view === "read") ||
        (view === "topicReading" && item.dataset.view === "studies") ||
        (view === "studyDetail" && item.dataset.view === "studies")
    );
  });
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    closeMobileNav();
    if (item.dataset.view === "dashboard") {
      renderDashboardView();
      showView("dashboard");
    } else if (item.dataset.view === "read") {
      showView("read");
    } else if (item.dataset.view === "tags") {
      renderTagsView();
      showView("tags");
    } else if (item.dataset.view === "studies") {
      setStudiesTab("studies");
      showView("studies");
    } else if (item.dataset.view === "insights") {
      renderInsightsView();
      setInsightsTab("crossref");
      showView("insights");
    } else if (item.dataset.view === "settings") {
      renderSharesSection();
      showView("settings");
    }
  });
});

el("backBtn").addEventListener("click", () => {
  if (currentView === "topicReading") {
    setStudiesTab("topics");
    showView("studies");
  } else if (currentView === "studyDetail") {
    renderStudiesView();
    showView("studies");
  } else {
    showView("read");
  }
});

el("collapseBtn").addEventListener("click", () => {
  const collapsed = document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
  localStorage.setItem("bible-study:sidebarCollapsed", collapsed ? "1" : "0");
});

function closeMobileNav() {
  document.querySelector(".app-shell").classList.remove("mobile-nav-open");
}

el("mobileNavToggleBtn").addEventListener("click", () => {
  document.querySelector(".app-shell").classList.toggle("mobile-nav-open");
});

el("sidebarBackdrop").addEventListener("click", closeMobileNav);

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

// ---------- Scripture cross-references (manual links) ----------

let linkFromKeys = [];

function refLabelForKeys(keys) {
  if (!keys.length) return "";
  const sorted = [...keys].sort((k1, k2) => {
    const a = parseVerseKey(k1);
    const b = parseVerseKey(k2);
    return a.verse - b.verse;
  });
  const first = parseVerseKey(sorted[0]);
  const last = parseVerseKey(sorted[sorted.length - 1]);
  const book = booksById.get(first.bookId);
  const bookName = book ? book.name : first.bookId;
  if (first.bookId !== last.bookId || first.chapter !== last.chapter) {
    return `${refLabel(first.bookId, first.chapter, first.verse)}–${refLabel(last.bookId, last.chapter, last.verse)}`;
  }
  const count = chapterVerseCountFor(book, first.chapter);
  if (sorted.length === count && first.verse === 1 && last.verse === count) {
    return `${bookName} ${first.chapter}`;
  }
  if (first.verse === last.verse) return `${bookName} ${first.chapter}:${first.verse}`;
  return `${bookName} ${first.chapter}:${first.verse}-${last.verse}`;
}

el("linkSelectionBtn").addEventListener("click", () => {
  linkFromKeys = [...selection];
  if (!linkFromKeys.length) return;
  el("linkFromRef").textContent = refLabelForKeys(linkFromKeys);
  el("linkToInput").value = "";
  el("linkNoteInput").value = "";
  el("linkToError").classList.add("hidden");
  el("linkOverlay").classList.remove("hidden");
  el("linkToInput").focus();
});

el("linkCancelBtn").addEventListener("click", () => el("linkOverlay").classList.add("hidden"));

document.addEventListener("click", (e) => {
  if (e.target === el("linkOverlay")) el("linkOverlay").classList.add("hidden");
});

el("linkSaveBtn").addEventListener("click", () => {
  const { resolvedKeys, unresolved } = parseBulkReferences(el("linkToInput").value);
  if (!resolvedKeys.length || unresolved.length) {
    el("linkToError").textContent = unresolved.length
      ? `Couldn't recognize: "${unresolved[0]}"`
      : "Enter a reference, e.g. Psalm 22 or Psalm 22:1-18.";
    el("linkToError").classList.remove("hidden");
    return;
  }
  tagsData.links.push({
    id: crypto.randomUUID(),
    a: linkFromKeys,
    b: resolvedKeys,
    note: el("linkNoteInput").value.trim(),
  });
  scheduleSave();
  el("linkOverlay").classList.add("hidden");
  if (currentView === "verse") renderVerseDetailLinks();
});

function linksForKey(key) {
  return tagsData.links.filter((l) => l.a.includes(key) || l.b.includes(key));
}

function renderVerseDetailLinks() {
  const panel = el("verseDetailLinks");
  const list = el("verseDetailLinksList");
  list.innerHTML = "";
  const links = linksForKey(currentVerseKey);
  panel.classList.toggle("hidden", links.length === 0);
  if (!links.length) return;

  links.forEach((link) => {
    const otherKeys = link.a.includes(currentVerseKey) ? link.b : link.a;
    const row = document.createElement("div");
    row.className = "verse-link-row";

    const refBtn = document.createElement("button");
    refBtn.type = "button";
    refBtn.className = "verse-link-ref";
    refBtn.textContent = refLabelForKeys(otherKeys);
    refBtn.addEventListener("click", () => goToVerseInChapter(otherKeys));
    row.appendChild(refBtn);

    if (link.note) {
      const note = document.createElement("div");
      note.className = "verse-link-note";
      note.textContent = link.note;
      row.appendChild(note);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "note-clear-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      tagsData.links = tagsData.links.filter((l) => l.id !== link.id);
      scheduleSave();
      renderVerseDetailLinks();
    });
    row.appendChild(removeBtn);

    list.appendChild(row);
  });
}
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
  renderVerseDetailLinks();
  renderVerseDetailCrossRefs();
  showView("verse");
}

// ---------- Cross references (OpenBible.info / Treasury of Scripture Knowledge) ----------
//
// Read-only reference data, never touches tagsData — same "external library,
// not yours to edit" treatment as topics/persons.

let crossReferencesData = null;
let crossReferencesPromise = null;

function ensureCrossReferencesLoaded() {
  if (crossReferencesData) return Promise.resolve();
  if (!crossReferencesPromise) {
    crossReferencesPromise = fetchJSON("data/cross-references.json").then((d) => {
      crossReferencesData = d;
    });
  }
  return crossReferencesPromise;
}

function renderCrossRefChips(container, key, onNavigate) {
  ensureCrossReferencesLoaded().then(() => {
    const refs = (crossReferencesData && crossReferencesData[key]) || [];
    container.innerHTML = "";
    if (!refs.length) {
      container.innerHTML = '<div class="empty-msg">No cross-references for this verse.</div>';
      return;
    }
    refs.forEach((ref) => {
      const { bookId, chapter, verse } = parseVerseKey(ref.key);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cross-ref-chip";
      chip.textContent = refLabel(bookId, chapter, verse);
      chip.title = crossRefPreview(ref.key);
      chip.addEventListener("click", () => onNavigate(ref.key));
      container.appendChild(chip);
    });
  });
}

function crossRefPreview(key) {
  const { bookId, chapter, verse } = parseVerseKey(key);
  const book = booksById.get(bookId);
  return book ? book.chapters[chapter - 1].verses[verse - 1] : "";
}

function renderVerseDetailCrossRefs() {
  const panel = el("verseDetailCrossRefs");
  const key = currentVerseKey;
  ensureCrossReferencesLoaded().then(() => {
    if (currentVerseKey !== key) return; // user navigated away before this resolved
    const refs = (crossReferencesData && crossReferencesData[key]) || [];
    panel.classList.toggle("hidden", refs.length === 0);
  });
  renderCrossRefChips(el("verseDetailCrossRefsList"), key, (otherKey) => openVerseDetail(otherKey));
}

el("verseDetailCrossRefsExpandBtn").addEventListener("click", () => openCrossRefsSidebar(currentVerseKey));

// ---------- Word study / cross-reference sidebar tabs ----------

let sidebarActiveTab = "word";

function setSidebarTab(tab) {
  sidebarActiveTab = tab;
  el("wordStudyTabBtn").classList.toggle("active", tab === "word");
  el("crossRefsTabBtn").classList.toggle("active", tab === "crossrefs");
  el("wordStudyTabPanel").classList.toggle("hidden", tab !== "word");
  el("crossRefsTabPanel").classList.toggle("hidden", tab !== "crossrefs");
}

el("wordStudyTabBtn").addEventListener("click", () => setSidebarTab("word"));
el("crossRefsTabBtn").addEventListener("click", () => setSidebarTab("crossrefs"));

// Cross-ref chips clicked inside the sidebar jump to a *different* verse —
// keep the main reading/verse-detail view in sync with whatever the sidebar
// is currently showing, and remember where we came from so there's a way
// back (rather than silently stranding the user on a verse they didn't
// explicitly navigate to).
let crossRefSidebarHistory = [];

function openCrossRefsSidebar(key, opts = {}) {
  if (opts.pushCurrent && wordStudyVerseKey && wordStudyVerseKey !== key) {
    crossRefSidebarHistory.push(wordStudyVerseKey);
  } else if (!opts.pushCurrent && !opts.fromBack) {
    crossRefSidebarHistory = []; // fresh open (expand button / word-study panel), not a chip navigation
  }
  el("crossRefSidebarBackBtn").classList.toggle("hidden", crossRefSidebarHistory.length === 0);

  wordStudyVerseKey = key;
  const { bookId, chapter, verse } = parseVerseKey(key);
  el("wordStudyRef").textContent = refLabel(bookId, chapter, verse);
  el("wordStudyPanel").classList.remove("hidden");
  el("wordStudyDetail").classList.add("hidden");
  el("wordStudyChips").classList.add("hidden");
  el("wordStudyLoading").classList.add("hidden");
  setSidebarTab("crossrefs");
  renderCrossRefChips(el("sidebarCrossRefsList"), key, (otherKey) => {
    openVerseDetail(otherKey);
    openCrossRefsSidebar(otherKey, { pushCurrent: true });
  });

  if (currentView === "verse" && currentVerseKey !== key) openVerseDetail(key);
}

el("crossRefSidebarBackBtn").addEventListener("click", () => {
  const prevKey = crossRefSidebarHistory.pop();
  if (!prevKey) return;
  openVerseDetail(prevKey);
  openCrossRefsSidebar(prevKey, { fromBack: true });
});

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
  el("newTagPlace").value = opts.place || (tag && tag.rule && tag.rule.place) || "";
  el("newTagPhrase").value = opts.phrase || (tag && tag.rule && tag.rule.phrase) || "";
  el("newTagPhraseAnd").value = opts.phraseAnd || (tag && tag.rule && tag.rule.phraseAnd) || "";
  selectedHue = tag ? tag.hue : HUE_PRESETS[Math.floor(Math.random() * HUE_PRESETS.length)];
  renderHueSwatches();

  el("newTagStrongsRow").classList.toggle("hidden", manualOnly);
  el("newTagTopicRow").classList.toggle("hidden", manualOnly);
  el("newTagPersonRow").classList.toggle("hidden", manualOnly);
  el("newTagPlaceRow").classList.toggle("hidden", manualOnly);
  el("newTagPhraseRow").classList.toggle("hidden", manualOnly);
  el("newTagPhraseAndRow").classList.toggle("hidden", manualOnly);

  if (!manualOnly) {
    ensureTopicsLoaded().then(() => populateDatalist("topicsDatalist", Object.keys(topicsData)));
    ensurePersonsLoaded().then(() => populateDatalist("personsDatalist", Object.keys(personsData)));
    ensurePlaceVersesIndexLoaded().then(() => populateDatalist("placesDatalist", Object.keys(placeVersesIndex)));
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
  const placeInput = el("newTagPlace").value.trim();
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
  } else if (placeInput) {
    const matched = Object.keys(placeVersesIndex || {}).find((p) => p.toLowerCase() === placeInput.toLowerCase());
    if (matched) rule = { place: matched };
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
    if (currentView === "studies" && !el("studiesTopicsPanel").classList.contains("hidden")) renderTopicsView();
    if (wordStudyConcNum) renderWordStudyCard(wordStudyConcNum, [wordStudyConcNum]);
  };
  if (rule && rule.strongs) ensureConcordanceLoaded().then(finish);
  else finish();

  el("newTagOverlay").classList.add("hidden");
});

// ---------- Tags browse view (manual tags only) ----------

function isSmartTag(tag) {
  return !!(tag.rule && (tag.rule.strongs || tag.rule.topic || tag.rule.person || tag.rule.place));
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
    // highlights/notes/bookmarks were dropped from this list: that data
    // lives behind a separate internal API (moments.youversionapi.com)
    // this app's OAuth token isn't accepted by — see the connect flow's
    // one purpose now, showing who's connected via the token's own claims.
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
    const res = await fetch("/api/youversion/status", { headers: sessionHeaders() });
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
    await fetch("/api/youversion/status", { method: "DELETE", headers: sessionHeaders() });
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
  if (rule.place) return `Place: ${rule.place}`;
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
  allBtn.className = "filter-pill" + (activeTagFilter === null && !advancedFilterActive ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    activeTagFilter = null;
    advancedFilterActive = false;
    renderTagsView();
  });
  bar.appendChild(allBtn);

  function tagCount(tag) {
    return Object.values(tagsData.verseTags).filter((e) => e.tagIds.includes(tag.id)).length;
  }

  const manualTags = tagsData.tags.filter((t) => !isSmartTag(t));
  manualTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (activeTagFilter === tag.id && !advancedFilterActive ? " active" : "");
    btn.textContent = `${tag.name} · ${tagCount(tag)}`;
    btn.addEventListener("click", () => {
      activeTagFilter = tag.id;
      advancedFilterActive = false;
      renderTagsView();
    });
    bar.appendChild(btn);
  });

  // Auto-tags aren't listed as pills here — managed on the Topics page instead.
}

// ---------- Advanced filter (AND/NOT combinations of manual tags) ----------

el("toggleAdvancedFilterBtn").addEventListener("click", () => {
  const panel = el("advancedFilterPanel");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (opening && advancedFilterClauses.length === 0) {
    advancedFilterClauses.push({ id: crypto.randomUUID(), tagId: "", negate: false });
  }
  renderAdvancedFilterClauses();
});

function renderAdvancedFilterClauses() {
  const container = el("advancedFilterClauses");
  container.innerHTML = "";
  const manualTags = tagsData.tags.filter((t) => !isSmartTag(t));

  advancedFilterClauses.forEach((clause) => {
    const row = document.createElement("div");
    row.className = "filter-clause-row";

    const negateSelect = document.createElement("select");
    ["has", "does not have"].forEach((label, i) => {
      const opt = document.createElement("option");
      opt.value = i === 1 ? "true" : "false";
      opt.textContent = label;
      negateSelect.appendChild(opt);
    });
    negateSelect.value = clause.negate ? "true" : "false";
    negateSelect.addEventListener("change", () => {
      clause.negate = negateSelect.value === "true";
    });
    row.appendChild(negateSelect);

    const tagSelect = document.createElement("select");
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "Choose a tag…";
    tagSelect.appendChild(placeholderOpt);
    manualTags.forEach((tag) => {
      const opt = document.createElement("option");
      opt.value = tag.id;
      opt.textContent = tag.name;
      tagSelect.appendChild(opt);
    });
    tagSelect.value = clause.tagId;
    tagSelect.addEventListener("change", () => {
      clause.tagId = tagSelect.value;
    });
    row.appendChild(tagSelect);

    if (advancedFilterClauses.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "filter-clause-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove condition";
      removeBtn.addEventListener("click", () => {
        advancedFilterClauses = advancedFilterClauses.filter((c) => c.id !== clause.id);
        renderAdvancedFilterClauses();
      });
      row.appendChild(removeBtn);
    }

    container.appendChild(row);
  });
}

el("addFilterClauseBtn").addEventListener("click", () => {
  advancedFilterClauses.push({ id: crypto.randomUUID(), tagId: "", negate: false });
  renderAdvancedFilterClauses();
});

el("applyAdvancedFilterBtn").addEventListener("click", () => {
  activeTagFilter = null;
  advancedFilterActive = true;
  renderTagsView();
});

el("clearAdvancedFilterBtn").addEventListener("click", () => {
  advancedFilterClauses = [{ id: crypto.randomUUID(), tagId: "", negate: false }];
  advancedFilterActive = false;
  renderAdvancedFilterClauses();
  renderTagsView();
});

function sameTagIds(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

const TAG_VERSE_LIST_CAP = 500;

function matchesAdvancedFilter(key) {
  const tagIds = tagsData.verseTags[key]?.tagIds || [];
  return advancedFilterClauses
    .filter((c) => c.tagId)
    .every((c) => (c.negate ? !tagIds.includes(c.tagId) : tagIds.includes(c.tagId)));
}

function renderTagVerseList() {
  const container = el("tagVerseList");
  container.innerHTML = "";

  const usingAdvanced = advancedFilterActive && advancedFilterClauses.some((c) => c.tagId);

  let entries = Object.keys(tagsData.verseTags)
    .filter((key) => {
      if (usingAdvanced) return matchesAdvancedFilter(key);
      return activeTagFilter ? (tagsData.verseTags[key].tagIds || []).includes(activeTagFilter) : true;
    })
    .map((key) => ({ key, ...parseVerseKey(key) }))
    .sort((a, b) => {
      const oa = booksById.get(a.bookId)?.order ?? 0;
      const ob = booksById.get(b.bookId)?.order ?? 0;
      return oa - ob || a.chapter - b.chapter || a.verse - b.verse;
    });

  if (entries.length === 0) {
    container.innerHTML = usingAdvanced
      ? '<div class="empty-msg">No verses match this filter.</div>'
      : '<div class="empty-msg">No tagged verses yet. Select a verse while reading to add a tag or note.</div>';
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

// ---------- Export (JSON / Markdown / Obsidian) ----------
//
// One shared "grouped passage" builder feeds all three formats, so a note
// written across consecutive verses reads as one passage in the export too
// (same grouping convention as the Tags page's own verse list). Notion has
// no distinct export format here — it natively imports Markdown, so the
// plain Markdown export doubles as the Notion path.

function buildExportGroups(scope) {
  const filterTagId = scope === "filtered" ? activeTagFilter : null;

  let entries = Object.keys(tagsData.verseTags)
    .filter((key) => (filterTagId ? (tagsData.verseTags[key].tagIds || []).includes(filterTagId) : true))
    .map((key) => ({ key, ...parseVerseKey(key) }))
    .sort((a, b) => {
      const oa = booksById.get(a.bookId)?.order ?? 0;
      const ob = booksById.get(b.bookId)?.order ?? 0;
      return oa - ob || a.chapter - b.chapter || a.verse - b.verse;
    });

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
      groups.push({ bookId, chapter, startVerse: verse, endVerse: verse, note, tagIds, keys: [key] });
    }
  });

  return groups.map((group) => {
    const book = booksById.get(group.bookId);
    const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];
    const text = group.keys.map((k) => chapters[group.chapter - 1].verses[parseVerseKey(k).verse - 1]).join(" ");
    const refText =
      group.startVerse === group.endVerse
        ? refLabel(group.bookId, group.chapter, group.startVerse)
        : `${refLabel(group.bookId, group.chapter, group.startVerse)}–${group.endVerse}`;
    const tagNames = group.tagIds.map((id) => tagsData.tags.find((t) => t.id === id)?.name).filter(Boolean);
    return { refText, text, note: group.note, tagNames };
  });
}

function formatExportAsJSON(groups) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      tags: tagsData.tags.map((t) => ({ name: t.name })),
      entries: groups,
    },
    null,
    2
  );
}

function formatExportAsMarkdown(groups) {
  return groups
    .map((g) => {
      const tagLine = g.tagNames.length ? `**Tags:** ${g.tagNames.join(", ")}\n\n` : "";
      const noteLine = g.note ? `${g.note}\n\n` : "";
      return `## ${g.refText}\n\n> ${g.text}\n\n${tagLine}${noteLine}`;
    })
    .join("---\n\n");
}

function formatExportAsObsidian(groups) {
  const allTags = [...new Set(groups.flatMap((g) => g.tagNames))];
  const frontmatter = `---\ntags: [${allTags.map((t) => t.replace(/\s+/g, "-")).join(", ")}]\n---\n\n`;
  const body = groups
    .map((g) => {
      const tagLine = g.tagNames.length ? g.tagNames.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" ") + "\n\n" : "";
      const noteLine = g.note ? `${g.note}\n\n` : "";
      return `## [[${g.refText}]]\n\n> ${g.text}\n\n${tagLine}${noteLine}`;
    })
    .join("---\n\n");
  return frontmatter + body;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const EXPORT_FORMAT_HINTS = {
  json: "A complete, self-contained backup — every tagged verse with its text, tags, and notes.",
  markdown: "Plain Markdown. Notion imports this directly (File → Import → Markdown).",
  obsidian: "Markdown with a YAML frontmatter tag list, inline #tags, and [[wiki-links]] for Obsidian.",
};

el("exportTagsBtn").addEventListener("click", () => {
  el("exportScopeFilteredOption").disabled = !activeTagFilter;
  document.querySelector('input[name="exportScope"][value="all"]').checked = true;
  updateExportHint();
  el("exportOverlay").classList.remove("hidden");
});

function updateExportHint() {
  const format = document.querySelector('input[name="exportFormat"]:checked').value;
  el("exportFormatHint").textContent = EXPORT_FORMAT_HINTS[format];
}

document.querySelectorAll('input[name="exportFormat"]').forEach((input) => {
  input.addEventListener("change", updateExportHint);
});

el("exportCancelBtn").addEventListener("click", () => el("exportOverlay").classList.add("hidden"));

el("exportDownloadBtn").addEventListener("click", () => {
  const format = document.querySelector('input[name="exportFormat"]:checked').value;
  const scope = document.querySelector('input[name="exportScope"]:checked').value;
  const groups = buildExportGroups(scope);

  const date = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    downloadFile(`bible-study-export-${date}.json`, formatExportAsJSON(groups), "application/json");
  } else if (format === "markdown") {
    downloadFile(`bible-study-export-${date}.md`, formatExportAsMarkdown(groups), "text/markdown");
  } else {
    downloadFile(`bible-study-export-${date}.md`, formatExportAsObsidian(groups), "text/markdown");
  }

  el("exportOverlay").classList.add("hidden");
});

// ---------- Bulk import (paste references, then bulk-tag) ----------
//
// Reference parsing only — the actual "apply a tag to N verses" step reuses
// the existing tag-assign modal (openTagAssign), the same mechanism as
// search-and-select and everywhere else in the app that bulk-tags verses.

let bulkImportResolvedKeys = [];

function chapterVerseCountFor(book, chapter) {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];
  const ch = chapters[chapter - 1];
  return ch ? ch.verses.length : 0;
}

// Splits pasted text into individual reference entries (newline/semicolon =
// unambiguous new reference), then within each entry, comma-separated
// segments either extend the previous book+chapter with more verses/ranges
// ("John 3:16,18,20") or — if a segment doesn't parse as a bare number/range
// — start a fresh full reference ("John 3:16, Romans 8:28").
function parseBulkReferences(text) {
  const resolvedKeys = [];
  const seen = new Set();
  const unresolved = [];

  const addKey = (book, chapter, verse, label) => {
    if (verse < 1 || verse > chapterVerseCountFor(book, chapter)) {
      unresolved.push(`${label} (no such verse)`);
      return;
    }
    const key = verseKey(book.id, chapter, verse);
    if (!seen.has(key)) {
      seen.add(key);
      resolvedKeys.push(key);
    }
  };

  const rawEntries = text
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  rawEntries.forEach((entry) => {
    const segments = entry
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let currentBook = null;
    let currentChapter = null;

    segments.forEach((segment, idx) => {
      const bareMatch = segment.match(/^(\d+)(?:-(\d+))?$/);
      if (idx > 0 && currentBook && bareMatch) {
        const lo = Number(bareMatch[1]);
        const hi = bareMatch[2] ? Number(bareMatch[2]) : lo;
        for (let v = lo; v <= hi; v++) addKey(currentBook, currentChapter, v, `${currentBook.name} ${currentChapter}:${v}`);
        return;
      }

      const fullMatch = segment.match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
      if (fullMatch) {
        const [, bookQuery, chapterStr, verseStr, verseEndStr] = fullMatch;
        const book = findBookByName(bookQuery);
        if (book) {
          currentBook = book;
          currentChapter = Number(chapterStr);
          if (verseStr) {
            const lo = Number(verseStr);
            const hi = verseEndStr ? Number(verseEndStr) : lo;
            for (let v = lo; v <= hi; v++) addKey(book, currentChapter, v, `${book.name} ${currentChapter}:${v}`);
          } else {
            const count = chapterVerseCountFor(book, currentChapter);
            for (let v = 1; v <= count; v++) addKey(book, currentChapter, v, `${book.name} ${currentChapter}`);
          }
          return;
        }
      }

      unresolved.push(segment);
    });
  });

  return { resolvedKeys, unresolved };
}

el("bulkImportBtn").addEventListener("click", () => {
  el("bulkImportInput").value = "";
  el("bulkImportPreview").classList.add("hidden");
  el("bulkImportContinueBtn").classList.add("hidden");
  bulkImportResolvedKeys = [];
  el("bulkImportOverlay").classList.remove("hidden");
  el("bulkImportInput").focus();
});

el("bulkImportCancelBtn").addEventListener("click", () => el("bulkImportOverlay").classList.add("hidden"));

el("bulkImportParseBtn").addEventListener("click", () => {
  const { resolvedKeys, unresolved } = parseBulkReferences(el("bulkImportInput").value);
  bulkImportResolvedKeys = resolvedKeys;

  el("bulkImportPreview").classList.remove("hidden");
  el("bulkImportSummary").textContent = `${resolvedKeys.length} verse${resolvedKeys.length === 1 ? "" : "s"} resolved${
    unresolved.length ? `, ${unresolved.length} not recognized` : ""
  }.`;

  const unresolvedEl = el("bulkImportUnresolved");
  unresolvedEl.innerHTML = "";
  unresolved.forEach((u) => {
    const div = document.createElement("div");
    div.textContent = `Couldn't resolve: "${u}"`;
    unresolvedEl.appendChild(div);
  });

  el("bulkImportContinueBtn").classList.toggle("hidden", resolvedKeys.length === 0);
});

el("bulkImportContinueBtn").addEventListener("click", () => {
  el("bulkImportOverlay").classList.add("hidden");
  openTagAssign(bulkImportResolvedKeys, true);
});

// ---------- Dashboard ----------

// A curated pool of well-known, standalone verses for Verse of the Day —
// deliberately not a uniform-random pick over the whole Bible, since that
// can just as easily land on a genealogy or a verse that needs a page of
// context to not read strangely out of place.
const VOTD_POOL = [
  "genesis-1-1", "genesis-1-27", "genesis-28-15", "exodus-14-14", "exodus-15-2",
  "deuteronomy-31-6", "joshua-1-9", "1samuel-16-7", "1chronicles-16-11", "nehemiah-8-10",
  "job-19-25", "psalms-19-1", "psalms-23-1", "psalms-27-1", "psalms-28-7", "psalms-34-8",
  "psalms-37-4", "psalms-46-1", "psalms-51-10", "psalms-56-3", "psalms-62-1", "psalms-91-1",
  "psalms-100-5", "psalms-118-24", "psalms-119-105", "psalms-121-1", "psalms-127-1",
  "psalms-139-14", "psalms-143-8", "psalms-145-18", "psalms-147-3", "proverbs-3-5",
  "proverbs-3-6", "proverbs-16-3", "proverbs-16-9", "proverbs-18-10", "proverbs-22-6",
  "ecclesiastes-3-1", "isaiah-9-6", "isaiah-26-3", "isaiah-40-8", "isaiah-40-31",
  "isaiah-41-10", "isaiah-43-2", "isaiah-53-5", "isaiah-55-8", "isaiah-55-11",
  "jeremiah-17-7", "jeremiah-29-11", "jeremiah-33-3", "lamentations-3-22", "lamentations-3-23",
  "micah-6-8", "nahum-1-7", "habakkuk-3-19", "zephaniah-3-17", "malachi-3-10",
  "matthew-5-16", "matthew-6-33", "matthew-6-34", "matthew-7-7", "matthew-11-28",
  "matthew-19-26", "matthew-28-19", "matthew-28-20", "mark-11-24", "mark-12-30",
  "luke-1-37", "luke-6-31", "luke-12-25", "john-1-1", "john-3-16", "john-8-12",
  "john-10-10", "john-11-25", "john-13-34", "john-14-6", "john-14-27", "john-15-5",
  "john-15-13", "john-16-33", "acts-1-8", "romans-5-8", "romans-8-1", "romans-8-28",
  "romans-8-31", "romans-8-38", "romans-10-9", "romans-12-2", "romans-12-12",
  "romans-15-13", "1corinthians-10-13", "1corinthians-13-4", "1corinthians-13-13",
  "1corinthians-16-14", "2corinthians-1-3", "2corinthians-4-16", "2corinthians-5-7",
  "2corinthians-5-17", "2corinthians-9-8", "2corinthians-12-9", "galatians-2-20",
  "galatians-5-22", "galatians-6-9", "ephesians-2-8", "ephesians-2-10", "ephesians-3-20",
  "ephesians-4-32", "ephesians-6-10", "philippians-1-6", "philippians-4-6", "philippians-4-7",
  "philippians-4-8", "philippians-4-13", "philippians-4-19", "colossians-3-2",
  "colossians-3-23", "1thessalonians-5-16", "1thessalonians-5-18", "2thessalonians-3-3",
  "1timothy-4-12", "2timothy-1-7", "hebrews-4-16", "hebrews-11-1", "hebrews-12-1",
  "hebrews-13-5", "james-1-2", "james-1-5", "james-1-17", "james-4-8", "1peter-3-15",
  "1peter-5-7", "2peter-1-3", "1john-1-9", "1john-4-8", "1john-4-18", "1john-4-19",
  "1john-5-14", "revelation-3-20", "revelation-21-4",
];

function verseOfDayKey() {
  const dateStr = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  }
  return VOTD_POOL[hash % VOTD_POOL.length];
}

function renderDashboardView() {
  const key = verseOfDayKey();
  const { bookId, chapter, verse } = parseVerseKey(key);
  const book = booksById.get(bookId);
  el("dashboardVerseText").textContent = book.chapters[chapter - 1].verses[verse - 1];
  el("dashboardVerseRef").textContent = refLabel(bookId, chapter, verse);
  el("dashboardVotdCard").dataset.verseKey = key;

  const entries = Object.values(tagsData.verseTags);
  el("dashboardStatTagged").textContent = entries.length;
  el("dashboardStatNotes").textContent = entries.filter((e) => e.note).length;
  el("dashboardStatTags").textContent = tagsData.tags.filter((t) => !isSmartTag(t)).length;
}

el("dashboardVotdCard").addEventListener("click", () => {
  const key = el("dashboardVotdCard").dataset.verseKey;
  if (key) openVerseDetail(key);
});

// ---------- Studies (tag categories) ----------

function scheduleSaveCategories() {
  clearTimeout(categoriesSaveTimer);
  categoriesSaveTimer = setTimeout(saveCategories, 500);
}

async function saveCategories() {
  try {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sessionHeaders() },
      body: JSON.stringify(categoriesData),
    });
    if (res.status === 401) {
      await handleAuthFailure();
      return;
    }
    if (res.status === 403) {
      console.error("Studies save rejected: owner-only");
      return;
    }
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  } catch (err) {
    console.error(err);
  }
}

function applyOwnerGating() {
  document.querySelectorAll(".owner-only").forEach((elm) => elm.classList.toggle("hidden", !isOwner()));
}

function renderStudiesView() {
  applyOwnerGating();
  const list = el("studiesList");
  list.innerHTML = "";

  if (!categoriesData.categories.length) {
    list.innerHTML = '<div class="empty-msg">No studies yet. Create one to group tags and verses under a named topic.</div>';
    return;
  }

  categoriesData.categories.forEach((study) => {
    const card = document.createElement("div");
    card.className = "study-card";
    const verseCount = study.entries.length;
    const tagCount = study.tagIds.length;
    card.innerHTML = `
      <div class="study-card-name">${escapeHtml(study.name)}</div>
      <div class="study-card-desc">${escapeHtml(study.description || "")}</div>
      <div class="study-card-meta">${tagCount} tag${tagCount === 1 ? "" : "s"} · ${verseCount} verse${verseCount === 1 ? "" : "s"}</div>
    `;
    card.addEventListener("click", () => openStudyDetail(study.id));
    list.appendChild(card);
  });
}

function openStudyDetail(id) {
  currentStudyId = id;
  renderStudyDetail();
  showView("studyDetail");
}

function renderStudyDetail() {
  applyOwnerGating();
  const study = categoriesData.categories.find((c) => c.id === currentStudyId);
  if (!study) {
    renderStudiesView();
    showView("studies");
    return;
  }

  el("studyDetailName").textContent = study.name;
  el("studyDetailDescription").textContent = study.description || "";
  el("studyDetailDescription").classList.toggle("hidden", !study.description);

  const chipsContainer = el("studyTagChips");
  chipsContainer.innerHTML = "";
  study.tagIds.forEach((tagId) => {
    const tag = tagsData.tags.find((t) => t.id === tagId);
    if (!tag) return;
    const { bg, text: fg } = chipColors(tag.hue);
    const chip = document.createElement(isOwner() ? "button" : "span");
    chip.className = isOwner() ? "tag-chip-removable" : "tag-chip-smart";
    chip.style.background = bg;
    chip.style.color = fg;
    chip.innerHTML = isOwner() ? `<span>${escapeHtml(tag.name)}</span><span class="x">×</span>` : `<span>${escapeHtml(tag.name)}</span>`;
    if (isOwner()) {
      chip.addEventListener("click", () => {
        study.tagIds = study.tagIds.filter((id) => id !== tagId);
        scheduleSaveCategories();
        renderStudyDetail();
      });
    }
    chipsContainer.appendChild(chip);
  });

  const addTagSelect = el("studyAddTagSelect");
  addTagSelect.innerHTML = '<option value="">+ link a tag…</option>';
  tagsData.tags
    .filter((t) => !isSmartTag(t) && !study.tagIds.includes(t.id))
    .forEach((tag) => {
      const opt = document.createElement("option");
      opt.value = tag.id;
      opt.textContent = tag.name;
      addTagSelect.appendChild(opt);
    });

  const entriesList = el("studyEntriesList");
  entriesList.innerHTML = "";
  if (!study.entries.length) {
    entriesList.innerHTML = '<div class="empty-msg">No verses added to this study yet.</div>';
  } else {
    study.entries
      .slice()
      .sort((a, b) => {
        const pa = parseVerseKey(a.key);
        const pb = parseVerseKey(b.key);
        const oa = booksById.get(pa.bookId)?.order ?? 0;
        const ob = booksById.get(pb.bookId)?.order ?? 0;
        return oa - ob || pa.chapter - pb.chapter || pa.verse - pb.verse;
      })
      .forEach((entry) => {
        const { bookId, chapter, verse } = parseVerseKey(entry.key);
        const book = booksById.get(bookId);
        const text = book ? book.chapters[chapter - 1].verses[verse - 1] : "";
        const card = document.createElement("div");
        card.className = "study-entry-card";
        card.innerHTML = `
          <div class="study-entry-ref">${escapeHtml(refLabel(bookId, chapter, verse))}</div>
          <div class="study-entry-text">${escapeHtml(text)}</div>
          ${entry.note ? `<div class="study-entry-note">${escapeHtml(entry.note)}</div>` : ""}
        `;
        if (isOwner()) {
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "btn btn-outline btn-small";
          removeBtn.textContent = "Remove";
          removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            study.entries = study.entries.filter((en) => en.id !== entry.id);
            scheduleSaveCategories();
            renderStudyDetail();
          });
          card.appendChild(removeBtn);
        }
        card.addEventListener("click", () => openVerseDetail(entry.key));
        entriesList.appendChild(card);
      });
  }

  const tagVersesList = el("studyTagVersesList");
  tagVersesList.innerHTML = "";
  const rollupKeys = new Set();
  study.tagIds.forEach((tagId) => {
    Object.keys(tagsData.verseTags).forEach((key) => {
      if ((tagsData.verseTags[key].tagIds || []).includes(tagId)) rollupKeys.add(key);
    });
  });
  if (!rollupKeys.size) {
    tagVersesList.innerHTML = study.tagIds.length
      ? '<div class="empty-msg">No verses tagged with these tags yet.</div>'
      : '<div class="empty-msg">Link a tag above to pull in its tagged verses.</div>';
  } else {
    Array.from(rollupKeys)
      .map((key) => ({ key, ...parseVerseKey(key) }))
      .sort((a, b) => {
        const oa = booksById.get(a.bookId)?.order ?? 0;
        const ob = booksById.get(b.bookId)?.order ?? 0;
        return oa - ob || a.chapter - b.chapter || a.verse - b.verse;
      })
      .forEach(({ key, bookId, chapter, verse }) => {
        const book = booksById.get(bookId);
        const text = book.chapters[chapter - 1].verses[verse - 1];
        const note = tagsData.verseTags[key]?.note || "";
        const card = document.createElement("div");
        card.className = "study-entry-card";
        card.innerHTML = `
          <div class="study-entry-ref">${escapeHtml(refLabel(bookId, chapter, verse))}</div>
          <div class="study-entry-text">${escapeHtml(text)}</div>
          ${note ? `<div class="study-entry-note">${escapeHtml(note)}</div>` : ""}
        `;
        card.addEventListener("click", () => openVerseDetail(key));
        tagVersesList.appendChild(card);
      });
  }
}

el("studyAddTagSelect").addEventListener("change", () => {
  const tagId = el("studyAddTagSelect").value;
  if (!tagId) return;
  const study = categoriesData.categories.find((c) => c.id === currentStudyId);
  if (!study || study.tagIds.includes(tagId)) return;
  study.tagIds.push(tagId);
  scheduleSaveCategories();
  renderStudyDetail();
});

el("newStudyBtn").addEventListener("click", () => {
  editingStudyId = null;
  el("newStudyModalTitle").textContent = "New Study";
  el("newStudySubmitBtn").textContent = "Create";
  el("newStudyName").value = "";
  el("newStudyDescription").value = "";
  el("newStudyOverlay").classList.remove("hidden");
});

el("studyEditBtn").addEventListener("click", () => {
  const study = categoriesData.categories.find((c) => c.id === currentStudyId);
  if (!study) return;
  editingStudyId = study.id;
  el("newStudyModalTitle").textContent = "Edit Study";
  el("newStudySubmitBtn").textContent = "Save";
  el("newStudyName").value = study.name;
  el("newStudyDescription").value = study.description || "";
  el("newStudyOverlay").classList.remove("hidden");
});

el("newStudyCancel").addEventListener("click", () => {
  editingStudyId = null;
  el("newStudyOverlay").classList.add("hidden");
});

el("newStudyForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el("newStudyName").value.trim();
  if (!name) return;
  const description = el("newStudyDescription").value.trim();

  if (editingStudyId) {
    const study = categoriesData.categories.find((c) => c.id === editingStudyId);
    study.name = name;
    study.description = description;
    renderStudyDetail();
  } else {
    categoriesData.categories.push({ id: crypto.randomUUID(), name, description, tagIds: [], entries: [] });
    renderStudiesView();
  }

  editingStudyId = null;
  scheduleSaveCategories();
  el("newStudyOverlay").classList.add("hidden");
});

el("studyDeleteBtn").addEventListener("click", () => {
  const study = categoriesData.categories.find((c) => c.id === currentStudyId);
  if (!study) return;
  if (!confirm(`Delete "${study.name}"? This won't delete the linked tags or your notes, only this study's grouping and any standalone verse entries.`)) return;
  categoriesData.categories = categoriesData.categories.filter((c) => c.id !== currentStudyId);
  scheduleSaveCategories();
  renderStudiesView();
  showView("studies");
});

// ---------- Import Studies from Topics ----------

let selectedImportTopics = new Set();
const IMPORT_TOPICS_RESULT_CAP = 150;

el("importTopicsBtn").addEventListener("click", () => {
  selectedImportTopics = new Set();
  el("importTopicsSearch").value = "";
  el("importTopicsCategoryFilter").value = "";
  Promise.all([ensureTopicsLoaded(), ensureTopicCategoriesLoaded()]).then(() => {
    renderImportTopicsList();
    el("importTopicsOverlay").classList.remove("hidden");
  });
});

el("importTopicsCancel").addEventListener("click", () => {
  el("importTopicsOverlay").classList.add("hidden");
});

el("importTopicsSearch").addEventListener("input", renderImportTopicsList);
el("importTopicsCategoryFilter").addEventListener("change", renderImportTopicsList);

function renderImportTopicsList() {
  const query = el("importTopicsSearch").value.trim().toLowerCase();
  const categoryFilter = el("importTopicsCategoryFilter").value;
  const existingNames = new Set(categoriesData.categories.map((c) => c.name.toLowerCase()));

  let names = Object.keys(topicsData || {});
  if (query) names = names.filter((n) => n.toLowerCase().includes(query));
  if (categoryFilter) names = names.filter((n) => (topicCategories ? topicCategories[n] : null) === categoryFilter);
  names.sort();

  el("importTopicsCount").textContent = `${names.length} match${names.length === 1 ? "" : "es"}${
    names.length > IMPORT_TOPICS_RESULT_CAP ? ` (showing first ${IMPORT_TOPICS_RESULT_CAP})` : ""
  }`;

  const truncated = names.length > IMPORT_TOPICS_RESULT_CAP;
  if (truncated) names = names.slice(0, IMPORT_TOPICS_RESULT_CAP);

  const list = el("importTopicsList");
  list.innerHTML = "";
  if (!names.length) {
    list.innerHTML = '<div class="empty-msg">No topics match.</div>';
    return;
  }

  names.forEach((name) => {
    const alreadyImported = existingNames.has(name.toLowerCase());
    const row = document.createElement("label");
    row.className = "import-topics-row" + (alreadyImported ? " import-topics-row-disabled" : "");
    const verseCount = (topicsData[name] || []).length;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedImportTopics.has(name);
    checkbox.disabled = alreadyImported;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedImportTopics.add(name);
      else selectedImportTopics.delete(name);
    });
    row.appendChild(checkbox);
    const label = document.createElement("span");
    label.textContent = alreadyImported ? `${name} (already a study)` : `${name} (${verseCount} verse${verseCount === 1 ? "" : "s"})`;
    row.appendChild(label);
    list.appendChild(row);
  });
}

el("importTopicsSubmit").addEventListener("click", () => {
  if (!selectedImportTopics.size) {
    el("importTopicsOverlay").classList.add("hidden");
    return;
  }

  selectedImportTopics.forEach((name) => {
    const keys = topicsData[name] || [];
    const entries = keys.map((key) => ({ id: crypto.randomUUID(), key, note: "" }));
    categoriesData.categories.push({
      id: crypto.randomUUID(),
      name,
      description: "Imported from Nave's Topical Dictionary.",
      tagIds: [],
      entries,
    });
  });

  scheduleSaveCategories();
  selectedImportTopics = new Set();
  el("importTopicsOverlay").classList.add("hidden");
  renderStudiesView();
});

el("studyAddEntryBtn").addEventListener("click", () => {
  const select = el("studyEntryBook");
  if (!select.childElementCount) {
    bible.books.forEach((book) => {
      const opt = document.createElement("option");
      opt.value = book.id;
      opt.textContent = book.name;
      select.appendChild(opt);
    });
  }
  el("studyEntryChapter").value = "1";
  el("studyEntryVerse").value = "1";
  el("studyEntryNote").value = "";
  el("addStudyEntryOverlay").classList.remove("hidden");
});

el("addStudyEntryCancel").addEventListener("click", () => {
  el("addStudyEntryOverlay").classList.add("hidden");
});

el("addStudyEntryForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const study = categoriesData.categories.find((c) => c.id === currentStudyId);
  if (!study) return;

  const bookId = el("studyEntryBook").value;
  const chapter = Number(el("studyEntryChapter").value);
  const verse = Number(el("studyEntryVerse").value);
  const note = el("studyEntryNote").value.trim();

  const book = booksById.get(bookId);
  if (!book || !book.chapters[chapter - 1] || !book.chapters[chapter - 1].verses[verse - 1]) {
    alert("That reference doesn't exist — check the chapter and verse numbers.");
    return;
  }

  const key = verseKey(bookId, chapter, verse);
  if (study.entries.some((entry) => entry.key === key)) {
    alert("That verse is already in this study.");
    return;
  }

  study.entries.push({ id: crypto.randomUUID(), key, note });
  scheduleSaveCategories();
  renderStudyDetail();
  el("addStudyEntryOverlay").classList.add("hidden");
});

// ---------- Timeline: Adam to Jesus ----------

let genealogyData = null;
let genealogyPromise = null;

function ensureGenealogyLoaded() {
  if (genealogyData) return Promise.resolve();
  if (!genealogyPromise) {
    genealogyPromise = fetchJSON("data/genealogy.json").then((d) => {
      genealogyData = d;
    });
  }
  return genealogyPromise;
}

function renderTimelineView() {
  const datedWrap = el("timelineDatedWrap");
  const undatedList = el("timelineUndatedList");
  datedWrap.innerHTML = '<div class="empty-msg">Loading…</div>';
  undatedList.innerHTML = "";

  ensureGenealogyLoaded().then(() => {
    const dated = genealogyData.chain.filter((p) => p.bornYear != null);
    const undated = genealogyData.chain.filter((p) => p.bornYear == null);

    const maxYear = Math.max(...dated.map((p) => p.diedYear));
    const rowHeight = 30;
    const labelWidth = 110;
    const chartWidth = 1500;
    const yearToX = (year) => labelWidth + (year / maxYear) * (chartWidth - labelWidth - 20);
    const svgWidth = chartWidth;
    const svgHeight = dated.length * rowHeight + 30;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
    svg.setAttribute("width", svgWidth);
    svg.setAttribute("height", svgHeight);
    svg.setAttribute("class", "timeline-svg");

    // AM-year axis ticks along the top.
    for (let year = 0; year <= maxYear; year += 500) {
      const x = yearToX(year);
      const tick = document.createElementNS(SVG_NS, "line");
      tick.setAttribute("x1", x);
      tick.setAttribute("y1", 0);
      tick.setAttribute("x2", x);
      tick.setAttribute("y2", svgHeight);
      tick.setAttribute("class", "timeline-tick");
      svg.appendChild(tick);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", x);
      label.setAttribute("y", 12);
      label.setAttribute("class", "timeline-tick-label");
      label.textContent = `AM ${year}`;
      svg.appendChild(label);
    }

    dated.forEach((person, i) => {
      const y = 24 + i * rowHeight;
      const x1 = yearToX(person.bornYear);
      const x2 = yearToX(person.diedYear);

      const nameLabel = document.createElementNS(SVG_NS, "text");
      nameLabel.setAttribute("x", labelWidth - 8);
      nameLabel.setAttribute("y", y + 4);
      nameLabel.setAttribute("text-anchor", "end");
      nameLabel.setAttribute("class", "timeline-row-label");
      nameLabel.textContent = person.displayName;
      svg.appendChild(nameLabel);

      const bar = document.createElementNS(SVG_NS, "rect");
      bar.setAttribute("x", x1);
      bar.setAttribute("y", y - 8);
      bar.setAttribute("width", Math.max(2, x2 - x1));
      bar.setAttribute("height", 16);
      bar.setAttribute("rx", 4);
      bar.setAttribute("class", "timeline-bar");
      bar.addEventListener("click", () => openVerseDetail(person.genesisVerseKey));

      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${person.displayName}: born AM ${person.bornYear}, died AM ${person.diedYear} (lived ${person.diedYear - person.bornYear} years)`;
      bar.appendChild(title);

      svg.appendChild(bar);
    });

    datedWrap.innerHTML = "";
    datedWrap.appendChild(svg);

    undatedList.innerHTML = "";
    undated.forEach((person, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "timeline-chip";
      chip.textContent = person.displayName;
      chip.addEventListener("click", () => openVerseDetail(person.verseKey));
      undatedList.appendChild(chip);
      if (i < undated.length - 1) {
        const arrow = document.createElement("span");
        arrow.className = "timeline-chip-arrow";
        arrow.textContent = "→";
        undatedList.appendChild(arrow);
      }
    });

    const matthewList = el("timelineMatthewList");
    matthewList.innerHTML = "";
    genealogyData.matthewBranch.forEach((person, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "timeline-chip";
      chip.textContent = person.displayName;
      chip.addEventListener("click", () => openVerseDetail(person.verseKey));
      matthewList.appendChild(chip);
      if (i < genealogyData.matthewBranch.length - 1) {
        const arrow = document.createElement("span");
        arrow.className = "timeline-chip-arrow";
        arrow.textContent = "→";
        matthewList.appendChild(arrow);
      }
    });
  });
}

// ---------- Insights: tag/note density heatmap ----------
//
// Counts only manual tags/notes (every key present in tagsData.verseTags is
// already guaranteed to have at least one, per the invariant enforced
// elsewhere: an entry is deleted once both its tagIds and note are empty).
// Auto-tags aren't counted, same reasoning as keeping them off the reading
// view — this is meant to reflect what the user actually studied, not what
// a broad topic/phrase rule happens to match.

const HEATMAP_BUCKETS = 4;

// ---------- Studies / Insights sub-tabs ----------
//
// Topics (a read-only reference library) lives under Studies, and the three
// visualization pages live under Insights, as sibling tabs within the same
// outer view rather than separate sidebar icons — kept as simple
// visibility toggles since the expensive one (the full cross-reference
// canvas) is rendered once on Insights entry and just persists in the DOM
// across tab switches, no re-render needed.

function setStudiesTab(tab) {
  document.querySelectorAll("[data-studiestab]").forEach((btn) => btn.classList.toggle("active", btn.dataset.studiestab === tab));
  el("studiesStudiesPanel").classList.toggle("hidden", tab !== "studies");
  el("studiesTopicsPanel").classList.toggle("hidden", tab !== "topics");
  if (tab === "studies") renderStudiesView();
  else renderTopicsView();
}

document.querySelectorAll("[data-studiestab]").forEach((btn) => {
  btn.addEventListener("click", () => setStudiesTab(btn.dataset.studiestab));
});

function setInsightsTab(tab) {
  document.querySelectorAll("[data-insightstab]").forEach((btn) => btn.classList.toggle("active", btn.dataset.insightstab === tab));
  el("insightsCrossRefPanel").classList.toggle("hidden", tab !== "crossref");
  el("insightsTagsPanel").classList.toggle("hidden", tab !== "tags");
  el("insightsTimelinePanel").classList.toggle("hidden", tab !== "timeline");
  el("insightsMapPanel").classList.toggle("hidden", tab !== "map");
  if (tab === "map") renderPlacesMap();
}

// ---------- Bible places map ----------

let placesData = null;
let placesPromise = null;
let routesData = null;
let routesPromise = null;
let placesMapInstance = null;
let placesLayerGroup = null;
const PLACES_POPUP_VERSE_CAP = 20;

function ensurePlacesLoaded() {
  if (placesData) return Promise.resolve();
  if (!placesPromise) {
    placesPromise = fetchJSON("data/places.json").then((d) => {
      placesData = d;
    });
  }
  return placesPromise;
}

function ensureRoutesLoaded() {
  if (routesData) return Promise.resolve();
  if (!routesPromise) {
    routesPromise = fetchJSON("data/routes.json").then((d) => {
      routesData = d;
    });
  }
  return routesPromise;
}

function buildPlacePopup(place) {
  const wrap = document.createElement("div");
  wrap.className = "place-popup";

  const title = document.createElement("div");
  title.className = "place-popup-title";
  title.textContent = place.name;
  wrap.appendChild(title);

  if (place.comment) {
    const comment = document.createElement("div");
    comment.className = "place-popup-comment";
    comment.textContent = place.comment;
    wrap.appendChild(comment);
  }

  const list = document.createElement("div");
  list.className = "place-popup-verses";
  const shown = place.verseKeys.slice(0, PLACES_POPUP_VERSE_CAP);
  shown.forEach((key) => {
    const { bookId, chapter, verse } = parseVerseKey(key);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cross-ref-chip";
    chip.textContent = refLabel(bookId, chapter, verse);
    chip.addEventListener("click", () => openVerseDetail(key));
    list.appendChild(chip);
  });
  wrap.appendChild(list);

  if (place.verseKeys.length > PLACES_POPUP_VERSE_CAP) {
    const more = document.createElement("div");
    more.className = "place-popup-more";
    more.textContent = `+${place.verseKeys.length - PLACES_POPUP_VERSE_CAP} more`;
    wrap.appendChild(more);
  }

  return wrap;
}

// Route titles are event/place names as much as person names ("Mesopotamian
// Invasion", "Fall of Samaria"), so there's no reliable structured "person"
// field to filter on — this keyword list is a best-effort tag pulled from
// the title text itself, checked in order (first match wins for titles
// mentioning more than one figure, e.g. "Elijah and Elisha" tags Elijah).
// Titles matching none of these still show under "All People".
const ROUTE_PERSON_KEYWORDS = [
  "Abram", "Abraham", "Isaac", "Jacob", "Joseph", "Moses", "Aaron", "Balaam",
  "Joshua", "Deborah", "Gideon", "Jephthah", "Samson", "Ruth", "Hannah",
  "Samuel", "Saul", "David", "Solomon", "Elijah", "Elisha", "Naaman", "Jehu",
  "Hezekiah", "Jonah", "Josiah", "Jesus", "John", "Philip", "Peter", "Paul",
];

function personTagForRouteTitle(title) {
  return ROUTE_PERSON_KEYWORDS.find((name) => new RegExp(`\\b${name}\\b`).test(title)) || null;
}

// Same best-effort keyword approach as the person tags above, for titles
// that are event/place names rather than a person's ("Fall of Samaria",
// "Mesopotamian Invasion") — checked in order, first match wins. Anything
// matching none of these still shows under "Other".
const ROUTE_CATEGORY_RULES = [
  ["Patriarchs", /Abram|Isaac|Jacob|Joseph|Melchizedek|Hagar|Lot |GEN /i],
  ["Exodus & Conquest", /Moses|Aaron|Exodus|Spies|wandering|Transjordan|Sihon|Og battle|Balaam|Jordan|Jericho|^Ai\b|Gibeon|Hazor|Conquest/i],
  ["Judges Era", /Ehud|Deborah|Gideon|Abimelech|Jephthah|Samson|Dan Migration|Benjamites|Hannah|Ruth/i],
  ["Kings & Wars", /Kingdom|anointed|Shishak|Jeroboam|Rehoboam|Baasha|Zerah|Uzziah|Jehoiakim|Josiah|Amaziah|Tiglath|Rezin|Sennacherib|Hezekiah|Sargon|Samaria|Invasion|Siege|War|Revolt|Rebellion|Battle|battle|Campaign|Michmash|Jabesh|Aphek|donkey|David|Saul|Solomon|Ark Journeys|Nebuchadnezzar|Babylon|Exile|Gedaliah|Deportation|Naboth|Jehu|Jehoash|Neco/i],
  ["Elijah & Elisha", /Elijah|Elisha|Naaman|Benhadad|Hazael|Moabite/i],
  ["Jesus' Ministry", /Nazareth|Bethlehem|Cana|Galilee|Capernaum|Transfiguration|Lazarus|Emmaus|Ascension|Jesus|synagogues|Tyre|Sidon|Nain|Ephraim|Dedication|Storm|Herod|John the baptist|Bethabara/i],
  ["Paul & Early Church", /Philip|Paul|Peter|Missionary|Antioch|Rome|Damascus|Ethiopian Eunuch/i],
];

function categoryTagForRouteTitle(title) {
  const match = ROUTE_CATEGORY_RULES.find(([, re]) => re.test(title));
  return match ? match[0] : "Other";
}

let routeLineLayers = []; // [{layer, personTag, categoryTag}]
let selectedRoutePeople = new Set(); // empty = show all people
let selectedRouteCategories = new Set(); // empty = show all categories

function updateRouteVisibility() {
  if (!placesMapInstance) return;
  const showRoutes = el("mapToggleRoutes").checked;
  routeLineLayers.forEach(({ layer, personTag, categoryTag }) => {
    const personOk = selectedRoutePeople.size === 0 || selectedRoutePeople.has(personTag);
    const categoryOk = selectedRouteCategories.size === 0 || selectedRouteCategories.has(categoryTag);
    const shouldShow = showRoutes && personOk && categoryOk;
    const onMap = placesMapInstance.hasLayer(layer);
    if (shouldShow && !onMap) layer.addTo(placesMapInstance);
    else if (!shouldShow && onMap) placesMapInstance.removeLayer(layer);
  });
}

function renderFilterChips(containerId, selectedSet, allLabel, options) {
  const container = el(containerId);
  container.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "cross-ref-chip map-person-chip" + (selectedSet.size === 0 ? " active" : "");
  allChip.textContent = allLabel;
  allChip.addEventListener("click", () => {
    selectedSet.clear();
    renderFilterChips(containerId, selectedSet, allLabel, options);
    updateRouteVisibility();
  });
  container.appendChild(allChip);

  options.forEach((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cross-ref-chip map-person-chip" + (selectedSet.has(name) ? " active" : "");
    chip.textContent = name;
    chip.addEventListener("click", () => {
      if (selectedSet.has(name)) selectedSet.delete(name);
      else selectedSet.add(name);
      renderFilterChips(containerId, selectedSet, allLabel, options);
      updateRouteVisibility();
    });
    container.appendChild(chip);
  });
}

function renderPlacesMap() {
  Promise.all([ensurePlacesLoaded(), ensureRoutesLoaded()]).then(() => {
    if (!placesMapInstance) {
      placesMapInstance = L.map("placesMapContainer").setView([31.5, 35.2], 7);
      // CartoDB's tiles instead of stock OSM ones — stock OSM renders place
      // labels in the local script for this region (Arabic/Hebrew), CartoDB
      // renders Latin-script/English labels worldwide.
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(placesMapInstance);

      // Routes drawn first so points sit visually on top of them.
      routesData.forEach((route) => {
        const latLngs = route.coordinates.map(([lon, lat]) => [lat, lon]);
        const line = L.polyline(latLngs, {
          color: "#a5443b",
          weight: 2,
          opacity: 0.6,
          dashArray: "4 4",
        });
        line.bindTooltip(route.title, { sticky: true });
        routeLineLayers.push({
          layer: line,
          personTag: personTagForRouteTitle(route.title),
          categoryTag: categoryTagForRouteTitle(route.title),
        });
      });

      const people = [...new Set(routeLineLayers.map((r) => r.personTag).filter(Boolean))].sort();
      renderFilterChips("mapPersonFilterChips", selectedRoutePeople, "All People", people);
      const categories = [...new Set(routeLineLayers.map((r) => r.categoryTag))].sort();
      renderFilterChips("mapCategoryFilterChips", selectedRouteCategories, "All Categories", categories);

      placesLayerGroup = L.layerGroup();
      placesData.forEach((place) => {
        const marker = L.circleMarker([place.lat, place.lon], {
          radius: 5,
          weight: 1,
          color: "#8a5a2b",
          fillColor: "#c98a3e",
          fillOpacity: 0.85,
        });
        marker.bindPopup(buildPlacePopup(place));
        placesLayerGroup.addLayer(marker);
      });
      placesLayerGroup.addTo(placesMapInstance);

      updateRouteVisibility();
    }
    setTimeout(() => placesMapInstance.invalidateSize(), 0);
  });
}

el("mapTogglePlaces").addEventListener("change", () => {
  if (!placesMapInstance || !placesLayerGroup) return;
  if (el("mapTogglePlaces").checked) placesLayerGroup.addTo(placesMapInstance);
  else placesMapInstance.removeLayer(placesLayerGroup);
});

el("mapToggleRoutes").addEventListener("change", updateRouteVisibility);

document.querySelectorAll("[data-insightstab]").forEach((btn) => {
  btn.addEventListener("click", () => setInsightsTab(btn.dataset.insightstab));
});

function renderInsightsView() {
  renderHeatmap();
  renderTagGraph();
  renderRefGraph();
  renderCrossRefGraph();
  renderFullCrossRefMap();
  renderTimelineView();
}

function renderHeatmap() {
  const container = el("heatmapGrid");
  container.innerHTML = "";

  const densityByBook = new Map(); // bookId -> number[] (per chapter)
  let maxCount = 0;

  bible.books.forEach((book) => {
    const chapters = Array.isArray(book.chapters) ? book.chapters : [book.chapters];
    densityByBook.set(book.id, new Array(chapters.length).fill(0));
  });

  Object.keys(tagsData.verseTags).forEach((key) => {
    const { bookId, chapter } = parseVerseKey(key);
    const counts = densityByBook.get(bookId);
    if (!counts || chapter - 1 >= counts.length) return;
    counts[chapter - 1]++;
    if (counts[chapter - 1] > maxCount) maxCount = counts[chapter - 1];
  });

  bible.books.forEach((book) => {
    const counts = densityByBook.get(book.id);
    const row = document.createElement("div");
    row.className = "heatmap-row";

    const label = document.createElement("div");
    label.className = "heatmap-row-label";
    label.textContent = book.name;
    row.appendChild(label);

    const cellsWrap = document.createElement("div");
    cellsWrap.className = "heatmap-cells";
    counts.forEach((count, i) => {
      const chapterNum = i + 1;
      const bucket = count === 0 ? 0 : Math.min(HEATMAP_BUCKETS, Math.ceil((count / maxCount) * HEATMAP_BUCKETS));
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "heatmap-cell";
      cell.style.background = `var(--heatmap-${bucket})`;
      cell.title = `${book.name} ${chapterNum} — ${count} tagged/noted verse${count === 1 ? "" : "s"}`;
      cell.addEventListener("click", () => {
        selectBook(book.id, chapterNum);
        showView("read");
      });
      cellsWrap.appendChild(cell);
    });
    row.appendChild(cellsWrap);

    container.appendChild(row);
  });
}

// ---------- Tag connection graph (circular node-link diagram) ----------
//
// A physics-based force layout would need a first real dependency and real
// simulation code; at the tag counts a personal app actually has, a fixed
// circular layout shows the same information (which tags co-occur, how
// strongly) without any of that — nodes evenly spaced around a circle,
// edges between tags that share at least one verse, weighted by overlap.

const SVG_NS = "http://www.w3.org/2000/svg";

function renderTagGraph() {
  const wrap = el("tagGraphWrap");
  wrap.innerHTML = "";

  const manualTags = tagsData.tags.filter((t) => !isSmartTag(t));
  if (manualTags.length < 2) {
    wrap.innerHTML = '<div class="tag-graph-empty">Create at least two manual tags to see connections.</div>';
    return;
  }

  const overlap = new Map(); // "tagIdA|tagIdB" (sorted) -> count
  const verseCounts = new Map(manualTags.map((t) => [t.id, 0]));

  Object.values(tagsData.verseTags).forEach((entry) => {
    const ids = (entry.tagIds || []).filter((id) => verseCounts.has(id));
    ids.forEach((id) => verseCounts.set(id, verseCounts.get(id) + 1));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join("|");
        overlap.set(key, (overlap.get(key) || 0) + 1);
      }
    }
  });

  const maxOverlap = Math.max(1, ...overlap.values());
  const maxVerseCount = Math.max(1, ...verseCounts.values());

  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 55;
  const positions = new Map();
  manualTags.forEach((tag, i) => {
    const angle = (2 * Math.PI * i) / manualTags.length - Math.PI / 2;
    positions.set(tag.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);

  overlap.forEach((count, key) => {
    const [aId, bId] = key.split("|");
    const a = positions.get(aId);
    const b = positions.get(bId);
    const tagA = tagsData.tags.find((t) => t.id === aId);
    const tagB = tagsData.tags.find((t) => t.id === bId);
    if (!a || !b || !tagA || !tagB) return;

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("class", "tag-graph-edge");
    line.setAttribute("stroke-width", String(1 + (count / maxOverlap) * 6));
    line.setAttribute("stroke-opacity", String(0.25 + (count / maxOverlap) * 0.55));

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${tagA.name} + ${tagB.name}: ${count} verse${count === 1 ? "" : "s"}`;
    line.appendChild(title);

    svg.appendChild(line);
  });

  manualTags.forEach((tag) => {
    const pos = positions.get(tag.id);
    const count = verseCounts.get(tag.id);
    const r = 10 + (count / maxVerseCount) * 14;
    const { bg } = chipColors(tag.hue);

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "tag-graph-node");
    g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
    g.addEventListener("click", () => {
      activeTagFilter = tag.id;
      advancedFilterActive = false;
      showView("tags");
      renderTagsView();
    });

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", bg);
    circle.setAttribute("stroke", "currentColor");
    g.appendChild(circle);

    const titleEl = document.createElementNS(SVG_NS, "title");
    titleEl.textContent = `${tag.name}: ${count} verse${count === 1 ? "" : "s"}`;
    g.appendChild(titleEl);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "tag-graph-label");
    const isRight = pos.x > cx + 5;
    const isLeft = pos.x < cx - 5;
    label.setAttribute("text-anchor", isRight ? "start" : isLeft ? "end" : "middle");
    label.setAttribute("x", String(isRight ? r + 4 : isLeft ? -(r + 4) : 0));
    label.setAttribute("y", "4");
    label.textContent = tag.name;
    g.appendChild(label);

    svg.appendChild(g);
  });

  wrap.appendChild(svg);
}

// ---------- Scripture reference graph (chapter-level, from manual links) ----------
//
// Verse-level nodes would be too dense to read (a single link can span a
// whole chapter), so links are aggregated up to "bookId-chapter" nodes,
// weighted by how many verse-pairs connect two chapters. Same fixed-circle
// layout as the tag graph, for the same reason (no simulation dependency
// needed at this scale).

function chapterNodeId(key) {
  const { bookId, chapter } = parseVerseKey(key);
  return `${bookId}-${chapter}`;
}

function renderRefGraph() {
  const wrap = el("refGraphWrap");
  wrap.innerHTML = "";

  if (!tagsData.links.length) {
    wrap.innerHTML = '<div class="tag-graph-empty">Link verses together (select verses → "Link to…") to see connections here.</div>';
    return;
  }

  const nodeIds = new Set();
  const edgeWeight = new Map(); // "nodeA|nodeB" (sorted) -> count of links
  const nodeLinkCount = new Map();

  tagsData.links.forEach((link) => {
    const aNodes = new Set(link.a.map(chapterNodeId));
    const bNodes = new Set(link.b.map(chapterNodeId));
    aNodes.forEach((n) => nodeIds.add(n));
    bNodes.forEach((n) => nodeIds.add(n));
    aNodes.forEach((aNode) => {
      bNodes.forEach((bNode) => {
        if (aNode === bNode) return;
        const key = [aNode, bNode].sort().join("|");
        edgeWeight.set(key, (edgeWeight.get(key) || 0) + 1);
      });
    });
    [...aNodes, ...bNodes].forEach((n) => nodeLinkCount.set(n, (nodeLinkCount.get(n) || 0) + 1));
  });

  const nodes = [...nodeIds];
  if (nodes.length < 2) {
    wrap.innerHTML = '<div class="tag-graph-empty">Link at least two different chapters to see connections here.</div>';
    return;
  }

  const nodeLabel = (nodeId) => {
    const [bookId, chapter] = [nodeId.slice(0, nodeId.lastIndexOf("-")), nodeId.slice(nodeId.lastIndexOf("-") + 1)];
    const book = booksById.get(bookId);
    return `${book ? book.name : bookId} ${chapter}`;
  };

  const maxWeight = Math.max(1, ...edgeWeight.values());
  const maxLinkCount = Math.max(1, ...nodeLinkCount.values());

  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 55;
  const positions = new Map();
  nodes.forEach((nodeId, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    positions.set(nodeId, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);

  edgeWeight.forEach((count, key) => {
    const [aNode, bNode] = key.split("|");
    const a = positions.get(aNode);
    const b = positions.get(bNode);
    if (!a || !b) return;

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("class", "tag-graph-edge");
    line.setAttribute("stroke-width", String(1 + (count / maxWeight) * 6));
    line.setAttribute("stroke-opacity", String(0.25 + (count / maxWeight) * 0.55));

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${nodeLabel(aNode)} + ${nodeLabel(bNode)}: ${count} link${count === 1 ? "" : "s"}`;
    line.appendChild(title);

    svg.appendChild(line);
  });

  nodes.forEach((nodeId) => {
    const pos = positions.get(nodeId);
    const count = nodeLinkCount.get(nodeId) || 0;
    const r = 10 + (count / maxLinkCount) * 14;

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "tag-graph-node");
    g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
    g.addEventListener("click", () => {
      const [bookId, chapter] = [nodeId.slice(0, nodeId.lastIndexOf("-")), Number(nodeId.slice(nodeId.lastIndexOf("-") + 1))];
      selectBook(bookId, chapter);
      showView("read");
    });

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "var(--heatmap-3)");
    circle.setAttribute("stroke", "currentColor");
    g.appendChild(circle);

    const titleEl = document.createElementNS(SVG_NS, "title");
    titleEl.textContent = `${nodeLabel(nodeId)}: ${count} link${count === 1 ? "" : "s"}`;
    g.appendChild(titleEl);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "tag-graph-label");
    const isRight = pos.x > cx + 5;
    const isLeft = pos.x < cx - 5;
    label.setAttribute("text-anchor", isRight ? "start" : isLeft ? "end" : "middle");
    label.setAttribute("x", String(isRight ? r + 4 : isLeft ? -(r + 4) : 0));
    label.setAttribute("y", "4");
    label.textContent = nodeLabel(nodeId);
    g.appendChild(label);

    svg.appendChild(g);
  });

  wrap.appendChild(svg);
}

// ---------- Cross-reference map (book-level, OpenBible.info data) ----------
//
// data/cross-references.json is verse-level and symmetric (~30k verses,
// ~300k edges) — far too dense to plot directly. Aggregating up to book
// pairs and keeping only the strongest connections gives a readable
// "how the Bible points at itself" picture, same circular layout as the
// other two graphs above.

const CROSS_REF_GRAPH_EDGE_CAP = 90;

function renderCrossRefGraph() {
  const wrap = el("crossRefGraphWrap");
  wrap.innerHTML = '<div class="tag-graph-empty">Loading…</div>';

  ensureCrossReferencesLoaded().then(() => {
    if (currentView !== "insights") return; // user navigated away while loading

    const bookEdgeCount = new Map(); // "bookA|bookB" (sorted) -> count
    Object.entries(crossReferencesData).forEach(([fromKey, refs]) => {
      const fromBook = parseVerseKey(fromKey).bookId;
      refs.forEach((ref) => {
        const toBook = parseVerseKey(ref.key).bookId;
        if (fromBook === toBook) return;
        const edgeKey = [fromBook, toBook].sort().join("|");
        bookEdgeCount.set(edgeKey, (bookEdgeCount.get(edgeKey) || 0) + 1);
      });
    });

    // Data is symmetric (A→B and B→A both stored), so every pair was
    // counted twice — halve for an accurate distinct-crossref count.
    const edges = [...bookEdgeCount.entries()]
      .map(([key, count]) => [key, Math.round(count / 2)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, CROSS_REF_GRAPH_EDGE_CAP);

    if (!edges.length) {
      wrap.innerHTML = '<div class="tag-graph-empty">No cross-reference data loaded.</div>';
      return;
    }

    const nodeIds = new Set();
    const nodeLinkCount = new Map();
    edges.forEach(([key, count]) => {
      const [a, b] = key.split("|");
      nodeIds.add(a);
      nodeIds.add(b);
      nodeLinkCount.set(a, (nodeLinkCount.get(a) || 0) + count);
      nodeLinkCount.set(b, (nodeLinkCount.get(b) || 0) + count);
    });

    const nodes = [...nodeIds].sort((a, b) => (booksById.get(a)?.order ?? 0) - (booksById.get(b)?.order ?? 0));
    const nodeLabel = (bookId) => booksById.get(bookId)?.name || bookId;

    const maxWeight = Math.max(1, ...edges.map(([, count]) => count));
    const maxLinkCount = Math.max(1, ...nodeLinkCount.values());

    const size = 420;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 60;
    const positions = new Map();
    nodes.forEach((nodeId, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      positions.set(nodeId, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);

    edges.forEach(([key, count]) => {
      const [a, b] = key.split("|");
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) return;

      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", pa.x);
      line.setAttribute("y1", pa.y);
      line.setAttribute("x2", pb.x);
      line.setAttribute("y2", pb.y);
      line.setAttribute("class", "tag-graph-edge");
      line.setAttribute("stroke-width", String(1 + (count / maxWeight) * 5));
      line.setAttribute("stroke-opacity", String(0.2 + (count / maxWeight) * 0.5));

      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${nodeLabel(a)} + ${nodeLabel(b)}: ${count} cross-reference${count === 1 ? "" : "s"}`;
      line.appendChild(title);

      svg.appendChild(line);
    });

    nodes.forEach((nodeId) => {
      const pos = positions.get(nodeId);
      const count = nodeLinkCount.get(nodeId) || 0;
      const r = 7 + (count / maxLinkCount) * 11;

      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", "tag-graph-node");
      g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
      g.addEventListener("click", () => {
        selectBook(nodeId, 1);
        showView("read");
      });

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", String(r));
      circle.setAttribute("fill", "var(--heatmap-2)");
      circle.setAttribute("stroke", "currentColor");
      g.appendChild(circle);

      const titleEl = document.createElementNS(SVG_NS, "title");
      titleEl.textContent = `${nodeLabel(nodeId)}: ${count} cross-reference${count === 1 ? "" : "s"}`;
      g.appendChild(titleEl);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "tag-graph-label");
      const isRight = pos.x > cx + 5;
      const isLeft = pos.x < cx - 5;
      label.setAttribute("text-anchor", isRight ? "start" : isLeft ? "end" : "middle");
      label.setAttribute("x", String(isRight ? r + 4 : isLeft ? -(r + 4) : 0));
      label.setAttribute("y", "4");
      label.textContent = nodeLabel(nodeId);
      g.appendChild(label);

      svg.appendChild(g);
    });

    wrap.innerHTML = "";
    wrap.appendChild(svg);
  });
}

// ---------- Full cross-reference map (every verse, canvas-rendered) ----------
//
// ~151,000 distinct verse-pair edges — an order of magnitude past what an
// SVG/DOM graph (or a human eye tracing individual lines) can handle. Same
// approach as the well-known Chris Harrison Bible cross-reference
// visualization: every verse placed around a circle in canonical reading
// order, colored by book, every cross-reference a thin arc bowed toward the
// center. Drawn once to an offscreen canvas (a few hundred thousand stroke
// calls, still only takes ~1s) and reused as a static backdrop; hovering
// finds the nearest verse by angle and overlays just its own ~12 links —
// individual-edge interactivity without redrawing the whole picture.

let verseOrderCache = null;
let fullCrossRefBaseCanvas = null;

function buildVerseOrder() {
  if (verseOrderCache) return verseOrderCache;
  const order = [];
  const indexByKey = new Map();
  const bookRanges = new Map(); // bookId -> {start, end (exclusive), hue}

  bible.books.forEach((book, bi) => {
    const start = order.length;
    book.chapters.forEach((ch, ci) => {
      ch.verses.forEach((_, vi) => {
        const key = verseKey(book.id, ci + 1, vi + 1);
        indexByKey.set(key, order.length);
        order.push(key);
      });
    });
    bookRanges.set(book.id, { start, end: order.length, hue: Math.round((bi / bible.books.length) * 360) });
  });

  verseOrderCache = { order, indexByKey, bookRanges };
  return verseOrderCache;
}

function verseCirclePoint(index, total, cx, cy, radius) {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), angle };
}

function strokeCrossRefArc(ctx, pa, pb, cx, cy, color, alpha, width) {
  const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  const bow = 0.22; // how far the control point is pulled toward center — smaller = more bowed
  const control = { x: cx + (mid.x - cx) * bow, y: cy + (mid.y - cy) * bow };
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.quadraticCurveTo(control.x, control.y, pb.x, pb.y);
  ctx.stroke();
}

function bookHueForIndex(index, order, bookRanges) {
  const bookId = parseVerseKey(order[index]).bookId;
  return bookRanges.get(bookId)?.hue ?? 0;
}

function renderFullCrossRefMap() {
  const canvas = el("fullCrossRefCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#888";
  ctx.textAlign = "center";
  ctx.fillText("Loading…", canvas.width / 2, canvas.height / 2);

  ensureCrossReferencesLoaded().then(() => {
    if (currentView !== "insights") return;

    const { order, indexByKey, bookRanges } = buildVerseOrder();
    const total = order.length;
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 90;

    const base = document.createElement("canvas");
    base.width = size;
    base.height = size;
    const bctx = base.getContext("2d");

    Object.entries(crossReferencesData).forEach(([fromKey, refs]) => {
      const i = indexByKey.get(fromKey);
      if (i == null) return;
      refs.forEach((ref) => {
        const j = indexByKey.get(ref.key);
        if (j == null || j <= i) return; // draw each unordered pair once
        const pa = verseCirclePoint(i, total, cx, cy, radius);
        const pb = verseCirclePoint(j, total, cx, cy, radius);
        const hue = bookHueForIndex(i, order, bookRanges);
        strokeCrossRefArc(bctx, pa, pb, cx, cy, `hsl(${hue}, 70%, 55%)`, 0.05, 0.6);
      });
    });

    // Book arc ring around the outside, colored to match, as a legend/guide —
    // plus a radial label per book so the ring reads as "which book is this"
    // rather than just a color code you have to memorize.
    bctx.globalAlpha = 1;
    bookRanges.forEach(({ start, end, hue }, bookId) => {
      const a1 = verseCirclePoint(start, total, cx, cy, radius).angle;
      const a2 = verseCirclePoint(Math.max(start, end - 1), total, cx, cy, radius).angle;
      bctx.strokeStyle = `hsl(${hue}, 70%, 55%)`;
      bctx.lineWidth = 4;
      bctx.beginPath();
      bctx.arc(cx, cy, radius + 8, a1, a2);
      bctx.stroke();

      const midIndex = Math.floor((start + end - 1) / 2);
      const midAngle = verseCirclePoint(midIndex, total, cx, cy, radius).angle;
      const book = booksById.get(bookId);
      const name = book ? (book.name.length > 14 ? book.name.replace(/^(\d) /, "$1") : book.name) : bookId;

      bctx.save();
      bctx.translate(cx, cy);
      bctx.rotate(midAngle);
      // Keep text upright: flip it on the left half of the circle instead
      // of rendering it sideways-down.
      const flip = midAngle > Math.PI / 2 && midAngle < (3 * Math.PI) / 2;
      bctx.translate(radius + 24, 0);
      if (flip) bctx.rotate(Math.PI);
      bctx.textAlign = flip ? "right" : "left";
      bctx.textBaseline = "middle";
      bctx.font = "10px sans-serif";
      bctx.fillStyle = `hsl(${hue}, 55%, 35%)`;
      bctx.fillText(name, 0, 0);
      bctx.restore();
    });

    fullCrossRefBaseCanvas = base;
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0);
  });
}

let fullCrossRefHoverKey = null;

function handleFullCrossRefHover(evt) {
  if (!fullCrossRefBaseCanvas || !crossReferencesData) return;
  const canvas = el("fullCrossRefCanvas");
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (evt.clientX - rect.left) * scaleX;
  const my = (evt.clientY - rect.top) * scaleY;

  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 90;

  const dist = Math.hypot(mx - cx, my - cy);
  if (dist < radius - 40 || dist > radius + 40) {
    if (fullCrossRefHoverKey) {
      fullCrossRefHoverKey = null;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(fullCrossRefBaseCanvas, 0, 0);
      el("fullCrossRefTooltip").classList.add("hidden");
    }
    return;
  }

  const { order, indexByKey, bookRanges } = buildVerseOrder();
  const total = order.length;
  let angle = Math.atan2(my - cy, mx - cx) + Math.PI / 2;
  if (angle < 0) angle += 2 * Math.PI;
  const index = Math.round((angle / (2 * Math.PI)) * total) % total;
  const key = order[index];
  if (key === fullCrossRefHoverKey) return;
  fullCrossRefHoverKey = key;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(fullCrossRefBaseCanvas, 0, 0);

  const refs = crossReferencesData[key] || [];
  const pa = verseCirclePoint(index, total, cx, cy, radius);
  refs.forEach((ref) => {
    const j = indexByKey.get(ref.key);
    if (j == null) return;
    const pb = verseCirclePoint(j, total, cx, cy, radius);
    strokeCrossRefArc(ctx, pa, pb, cx, cy, "#e0392b", 0.85, 1.6);
  });

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e0392b";
  ctx.beginPath();
  ctx.arc(pa.x, pa.y, 4, 0, 2 * Math.PI);
  ctx.fill();

  const { bookId, chapter, verse } = parseVerseKey(key);
  const tooltip = el("fullCrossRefTooltip");
  tooltip.textContent = `${refLabel(bookId, chapter, verse)} — ${refs.length} cross-reference${refs.length === 1 ? "" : "s"}`;
  tooltip.classList.remove("hidden");
  tooltip.style.left = `${evt.clientX - rect.left + 12}px`;
  tooltip.style.top = `${evt.clientY - rect.top + 12}px`;
}

el("fullCrossRefCanvas").addEventListener("mousemove", handleFullCrossRefHover);
el("fullCrossRefCanvas").addEventListener("mouseleave", () => {
  fullCrossRefHoverKey = null;
  el("fullCrossRefTooltip").classList.add("hidden");
  if (fullCrossRefBaseCanvas) {
    const canvas = el("fullCrossRefCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fullCrossRefBaseCanvas, 0, 0);
  }
});
el("fullCrossRefCanvas").addEventListener("click", () => {
  if (fullCrossRefHoverKey) openVerseDetail(fullCrossRefHoverKey);
});

// ---------- Read-only share links ----------

function shareUrlFor(token) {
  return `${window.location.origin}/share.html?t=${token}`;
}

function populateShareTagSelect() {
  const select = el("shareTagSelect");
  select.innerHTML = "";
  const manualTags = tagsData.tags.filter((t) => !isSmartTag(t));
  if (!manualTags.length) {
    const opt = document.createElement("option");
    opt.textContent = "No manual tags yet";
    opt.disabled = true;
    select.appendChild(opt);
    el("createShareBtn").disabled = true;
    return;
  }
  el("createShareBtn").disabled = false;
  manualTags.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag.id;
    opt.textContent = tag.name;
    select.appendChild(opt);
  });
}

function renderAccountPanel() {
  const panel = el("accountPanel");
  if (!currentUser) {
    panel.innerHTML = '<div class="empty-msg">Not signed in — you can browse everything shared, but your own tags/notes need an account.</div>';
    const signInBtn = document.createElement("button");
    signInBtn.type = "button";
    signInBtn.className = "btn btn-accent-solid btn-small";
    signInBtn.textContent = "Sign in with Google";
    signInBtn.addEventListener("click", connectGoogle);
    panel.appendChild(signInBtn);
    return;
  }
  panel.innerHTML = `
    <div class="account-row">
      ${currentUser.picture ? `<img src="${escapeHtml(currentUser.picture)}" class="account-avatar" alt="" />` : ""}
      <div class="account-info">
        <div class="account-name">${escapeHtml(currentUser.name || currentUser.email || "Signed in")}</div>
        <div class="account-role">${currentUser.role === "owner" ? "Owner" : "Member"} · ${escapeHtml(currentUser.email || "")}</div>
      </div>
    </div>
  `;
  const signOutBtn = document.createElement("button");
  signOutBtn.type = "button";
  signOutBtn.className = "btn btn-outline btn-small";
  signOutBtn.textContent = "Sign out";
  signOutBtn.addEventListener("click", () => {
    localStorage.removeItem("bible-study:sessionToken");
    window.location.reload();
  });
  panel.appendChild(signOutBtn);
}

async function renderSharesSection() {
  renderAccountPanel();
  populateShareTagSelect();
  const list = el("sharesList");
  list.innerHTML = '<div class="empty-msg">Loading…</div>';

  try {
    const res = await fetch("/api/shares", { headers: sessionHeaders() });
    if (res.status === 401) {
      await handleAuthFailure();
      return;
    }
    const shares = await res.json();
    const entries = Object.entries(shares).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

    list.innerHTML = "";
    if (!entries.length) {
      list.innerHTML = '<div class="empty-msg">No shared links yet.</div>';
      return;
    }

    entries.forEach(([token, share]) => {
      const row = document.createElement("div");
      row.className = "share-row";
      const url = shareUrlFor(token);
      const viewCount = share.viewCount || 0;
      const viewLabel = viewCount === 1 ? "1 view" : `${viewCount} views`;
      const lastViewedLabel = share.lastViewedAt
        ? `, last viewed ${new Date(share.lastViewedAt).toLocaleDateString()}`
        : "";
      row.innerHTML = `
        <span class="share-row-name">${escapeHtml(share.tagName)}</span>
        <span class="share-row-link">${escapeHtml(url)}</span>
        <span class="share-row-stats">${viewLabel}${lastViewedLabel}</span>
      `;
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-outline btn-small";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(url);
          copyBtn.textContent = "Copied!";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
        } catch (err) {
          console.error(err);
        }
      });
      row.appendChild(copyBtn);

      const revokeBtn = document.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.className = "btn btn-outline btn-small";
      revokeBtn.textContent = "Revoke";
      revokeBtn.addEventListener("click", async () => {
        await fetch(`/api/shares?t=${encodeURIComponent(token)}`, { method: "DELETE", headers: sessionHeaders() });
        renderSharesSection();
      });
      row.appendChild(revokeBtn);

      list.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    list.innerHTML = '<div class="empty-msg">Couldn\'t load shared links.</div>';
  }
}

el("createShareBtn").addEventListener("click", async () => {
  const select = el("shareTagSelect");
  const tagId = select.value;
  const tag = tagsData.tags.find((t) => t.id === tagId);
  if (!tag) return;

  const btn = el("createShareBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sessionHeaders() },
      body: JSON.stringify({ tagId: tag.id, tagName: tag.name }),
    });
    if (res.status === 401) {
      await handleAuthFailure();
      return;
    }
    await renderSharesSection();
  } catch (err) {
    console.error(err);
  } finally {
    btn.disabled = false;
  }
});

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
  showView("studies");
  setStudiesTab("topics");
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
// A tag with a `rule: {strongs: "G26"}`, `rule: {topic: "AARON"}`,
// `rule: {person: "David"}`, or `rule: {place: "Jerusalem"}` field
// auto-applies to every matching verse, computed live from the relevant
// index rather than written into verseTags — so it never mutates saved
// verse data.

let concordanceOnlyPromise = null;
let topicsData = null;
let topicsPromise = null;
let topicCategories = null; // { topicName: "person" | "place" | "topic" }
let topicCategoriesPromise = null;
let personsData = null;
let personsPromise = null;
let placeVersesIndex = null;
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

function ensurePlaceVersesIndexLoaded() {
  if (placeVersesIndex) return Promise.resolve();
  return ensurePlacesLoaded().then(() => {
    placeVersesIndex = {};
    placesData.forEach((place) => {
      if (place.verseKeys && place.verseKeys.length) placeVersesIndex[place.name] = place.verseKeys;
    });
  });
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
      } else if (tag.rule && tag.rule.place && placeVersesIndex) {
        smartTagSetsCache.set(tag.id, new Set(placeVersesIndex[tag.rule.place] || []));
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
  return tagsData.tags.some((t) => t.rule && (t.rule.strongs || t.rule.topic || t.rule.person || t.rule.place));
}

function loadAnyDefinedSmartTagSources() {
  const jobs = [];
  if (tagsData.tags.some((t) => t.rule && t.rule.strongs)) jobs.push(ensureConcordanceLoaded());
  if (tagsData.tags.some((t) => t.rule && t.rule.topic)) jobs.push(ensureTopicsLoaded());
  if (tagsData.tags.some((t) => t.rule && t.rule.person)) jobs.push(ensurePersonsLoaded());
  if (tagsData.tags.some((t) => t.rule && t.rule.place)) jobs.push(ensurePlaceVersesIndexLoaded());
  return Promise.all(jobs);
}

async function openWordStudyPanel(key) {
  wordStudyVerseKey = key;
  crossRefSidebarHistory = [];
  el("crossRefSidebarBackBtn").classList.add("hidden");
  const { bookId, chapter, verse } = parseVerseKey(key);
  el("wordStudyRef").textContent = refLabel(bookId, chapter, verse);
  el("wordStudyPanel").classList.remove("hidden");
  el("wordStudyDetail").classList.add("hidden");
  el("wordStudyChips").classList.add("hidden");
  el("wordStudyLoading").classList.remove("hidden");
  setSidebarTab("word");
  renderCrossRefChips(el("sidebarCrossRefsList"), key, (otherKey) => {
    openVerseDetail(otherKey);
    openCrossRefsSidebar(otherKey, { pushCurrent: true });
  });

  await loadStrongsData();
  if (wordStudyVerseKey !== key) return; // panel closed or moved on while loading

  el("wordStudyLoading").classList.add("hidden");
  el("wordStudyChips").classList.remove("hidden");
  renderWordStudyChips(key);
}

function closeWordStudyPanel() {
  wordStudyVerseKey = null;
  crossRefSidebarHistory = [];
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
    showView("studies");
    setStudiesTab("topics");
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
      headers: { "Content-Type": "application/json", ...sessionHeaders() },
      body: JSON.stringify(tagsData),
    });
    if (res.status === 401) {
      await handleAuthFailure();
      return;
    }
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  } catch (err) {
    console.error(err);
  }
}

// ---------- Site password lock screen ----------

// ---------- Google sign-in ----------

const GOOGLE_CLIENT_ID = "207642071914-gaplnloqc7bi2be69ocbc45b9vee56f5.apps.googleusercontent.com";
const GOOGLE_AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

function connectGoogle() {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${window.location.origin}/api/google/callback`,
    scope: "openid profile email",
    prompt: "select_account",
  });
  window.location.href = `${GOOGLE_AUTHORIZE_ENDPOINT}?${params}`;
}

function showLoginScreen() {
  if (document.getElementById("loginScreenOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "loginScreenOverlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal lock-screen-modal">
      <img src="assets/anchor.svg" class="lock-screen-logo" alt="Anchor" />
      <h2>Sign in to save</h2>
      <p class="settings-section-hint">Your own tags and notes need an account so they stay private to you. Browsing everything shared (Studies, Topics, Insights) doesn't require signing in.</p>
      <button type="button" id="googleSignInBtn" class="btn btn-accent-solid">Sign in with Google</button>
      <button type="button" id="loginScreenDismissBtn" class="btn btn-outline">Not now</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("googleSignInBtn").addEventListener("click", connectGoogle);
  document.getElementById("loginScreenDismissBtn").addEventListener("click", () => overlay.remove());
}

init();
