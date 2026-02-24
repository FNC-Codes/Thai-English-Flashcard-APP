const THEME_KEY = "thaiFlashTheme";
function applyTheme(isDark) {
  document.body.classList.toggle("dark-mode", isDark);
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  document.getElementById("themeToggle").checked = isDark;
  const btm = document.getElementById("bottomThemeToggle");
  if (btm) btm.checked = isDark;
  document.querySelectorAll(".theme-label").forEach(el => el.textContent = isDark ? "Dark Mode" : "Light Mode");
  const meta = document.getElementById("metaThemeColor");
  if (meta) meta.setAttribute("content", isDark ? "#16161a" : "#F7F1E3");
}
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark") applyTheme(true);
})();
document.getElementById("themeToggle").addEventListener("change", (e) => applyTheme(e.target.checked));
const btmToggle = document.getElementById("bottomThemeToggle");
if (btmToggle) btmToggle.addEventListener("change", (e) => applyTheme(e.target.checked));

const DATA_PATH = "./thai_vocab_v1.json";
const BUILD_TAG = "2026-02-21b";
const dataUrl = new URL(DATA_PATH, window.location.href);
dataUrl.searchParams.set("v", BUILD_TAG);
const DATA_URL = dataUrl.toString();
const DATA_API = "/api/data";
const FORCE_STATIC = true;

const STORAGE_KEY = "thaiFlashProfiles";
const ACTIVE_PROFILE_KEY = "thaiFlashActiveProfile";
const STORAGE_VERSION_KEY = "thaiFlashStorageVersion";
const STORAGE_VERSION = "v2";

const FIELD_DEFS = [
  { key: "thai", label: "Thai", className: "field-thai" },
  { key: "english", label: "English", className: "field-english" },
  { key: "roman_tone", label: "Roman", className: "field-roman" },
  { key: "phonetic_easy", label: "Phonetic", className: "field-phonetic" },
];

const IS_DESKTOP = window.matchMedia
  ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
  : false;

const ensureTtsButton = () => {
  if (IS_DESKTOP) return null;
  let btn = document.getElementById("ttsBtn");
  if (btn) return btn;
  const center = document.querySelector(".session-controls__center");
  if (!center) return null;
  btn = document.createElement("button");
  btn.id = "ttsBtn";
  btn.className = "tts-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Speak");
  btn.textContent = "Speak";
  center.prepend(btn);
  return btn;
};

const state = {
  rawCategories: [],
  selectedCategories: new Set(),
  deck: [],
  wrongDeck: [],
  currentIndex: 0,
  flipped: false,
  shuffle: false,
  srsEnabled: false,
  sessionStarted: false,
  mode: "srs",
  round: 1,
  sessionStats: {
    total: 0,
    right: 0,
    wrong: 0,
    perCategory: {},
  },
  frontFields: new Set(["thai", "roman_tone", "phonetic_easy"]),
  backFields: new Set(["english", "roman_tone"]),
  bigFieldFront: "roman_tone",
  bigFieldBack: "english",
  profiles: [],
  activeProfileId: null,
  srsState: {},
  mastered: new Set(),
  backendAvailable: false,
};

const updateSelectionCounts = () => {
  const selected = state.selectedCategories.size
    ? state.rawCategories.filter((cat) => state.selectedCategories.has(cat.category))
    : state.rawCategories;
  const total = selected.reduce((sum, cat) => sum + cat.items.length, 0);
  const available = state.srsEnabled
    ? selected.reduce((sum, cat) => {
        const due = cat.items.filter((item, idx) => {
          const id = cardId(cat.category, idx, item);
          const srs = state.srsState[id] || createSrsState();
          return srs.due <= today();
        }).length;
        return sum + due;
      }, 0)
    : total;
  els.progressText.textContent = `${available} / ${total}`;
};

const updateSetupSummary = () => {
  const categories = state.selectedCategories.size
    ? Array.from(state.selectedCategories).join(", ")
    : "All categories";
  const srs = state.srsEnabled ? "SRS on" : "SRS off";
  const shuffle = state.shuffle ? "Shuffle" : "Ordered";
  els.setupSummary.textContent = `${categories} • ${srs} • ${shuffle}`;
};

const setSetupCollapsed = (collapsed) => {
  els.setupSection.classList.toggle("collapsed", collapsed);
  els.setupToggle.textContent = collapsed ? "Change flash cards" : "Minimize";
  els.setupToggle.setAttribute("aria-expanded", (!collapsed).toString());
  updateSetupSummary();
};


const pickVoice = (lang) => {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices ? synth.getVoices() : [];
  if (!voices || voices.length === 0) return null;
  const target = lang.toLowerCase();
  const exact = voices.find((v) => (v.lang || "").toLowerCase() === target);
  if (exact) return exact;
  const prefix = voices.find((v) => (v.lang || "").toLowerCase().startsWith(`${target.split("-")[0]}-`));
  if (prefix) return prefix;
  return null;
};

let voicesLoaded = false;

const initVoices = () => {
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const load = () => {
    const voices = synth.getVoices ? synth.getVoices() : [];
    if (voices && voices.length) voicesLoaded = true;
  };
  load();
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", load);
  }
  setTimeout(load, 200);
};

const hasVoiceForLang = (lang) => {
  if (!("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  const voices = synth.getVoices ? synth.getVoices() : [];
  if (!voices || voices.length === 0) return false;
  return Boolean(pickVoice(lang));
};

const speakText = (text, lang) => {
  if (!text) return;
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setStatus("Text-to-speech not supported on this browser.");
    return;
  }
  const synth = window.speechSynthesis;
  const doSpeak = () => {
    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      if (lang.toLowerCase().startsWith("th")) {
        utter.rate = 0.95;
        utter.pitch = 1.0;
      }
      const voice = pickVoice(lang);
      if (voice) utter.voice = voice;
      synth.speak(utter);
    } catch {
      setStatus("Text-to-speech failed.");
    }
  };

  const voices = synth.getVoices ? synth.getVoices() : [];
  if (!voices || voices.length === 0) {
    setTimeout(doSpeak, 200);
  } else {
    doSpeak();
  }
};

const speakCurrentCard = () => {
  if (!state.sessionStarted || state.deck.length === 0) return;
  const card = state.deck[state.currentIndex];
  if (!card) return;
  const thaiText = (card.thai || "").toString();
  if (voicesLoaded && hasVoiceForLang("th-TH")) {
    speakText(thaiText, "th-TH");
    return;
  }
  if (!voicesLoaded) {
    setTimeout(() => {
      if (hasVoiceForLang("th-TH")) speakText(thaiText, "th-TH");
      else {
        const roman = (card.roman_tone || "").toString();
        if (roman) {
          setStatus("Thai voice not available on this PC. Speaking romanization instead.");
          speakText(roman, "en-US");
        } else {
          setStatus("Thai voice not available on this PC.");
        }
      }
    }, 250);
    return;
  }

  const roman = (card.roman_tone || "").toString();
  if (roman) {
    setStatus("Thai voice not available on this PC. Speaking romanization instead.");
    speakText(roman, "en-US");
  } else {
    setStatus("Thai voice not available on this PC.");
  }
};


const els = {
  progressText: document.getElementById("progressText"),
  activeCategories: document.getElementById("activeCategories"),
  shuffleToggle: document.getElementById("shuffleToggle"),
  srsToggle: document.getElementById("srsToggle"),
  resetSrsBtn: document.getElementById("resetSrsBtn"),
  activeProfile: document.getElementById("activeProfile"),
  switchProfileBtn: document.getElementById("switchProfileBtn"),
  frontFields: document.getElementById("frontFields"),
  backFields: document.getElementById("backFields"),
  selectAllBtn: document.getElementById("selectAllBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  startBtn: document.getElementById("startBtn"),
  mangoCounter: document.getElementById("mangoCounter"),
  categoryList: document.getElementById("categoryList"),
  cardSection: document.getElementById("cardSection"),
  flashcard: document.getElementById("flashcard"),
  frontFieldsView: document.getElementById("frontFieldsView"),
  backFieldsView: document.getElementById("backFieldsView"),
  frontHint: document.getElementById("frontHint"),
  wrongBtn: document.getElementById("wrongBtn"),
  correctBtn: document.getElementById("correctBtn"),
  cardTracker: document.getElementById("cardTracker"),
  sessionStatus: document.getElementById("sessionStatus"),
  ttsBtn: null,
  setupSection: document.getElementById("setupSection"),
  setupToggle: document.getElementById("setupToggle"),
  setupSummary: document.getElementById("setupSummary"),
  profileModal: document.getElementById("profileModal"),
  summaryModal: document.getElementById("summaryModal"),
  summaryTop: document.getElementById("summaryTop"),
  summaryList: document.getElementById("summaryList"),
  reviewWrongBtn: document.getElementById("reviewWrongBtn"),
  exitSummaryBtn: document.getElementById("exitSummaryBtn"),
  profileList: document.getElementById("profileList"),
  newProfileName: document.getElementById("newProfileName"),
  createProfileBtn: document.getElementById("createProfileBtn"),
};

const today = () => new Date().toISOString().split("T")[0];

const createSrsState = () => ({
  repetitions: 0,
  interval: 0,
  ease: 2.5,
  due: today(),
});

const sm2 = (card, quality) => {
  const srs = card.srs;
  if (quality < 3) {
    srs.repetitions = 0;
    srs.interval = 1;
  } else {
    srs.repetitions += 1;
    if (srs.repetitions === 1) srs.interval = 1;
    else if (srs.repetitions === 2) srs.interval = 6;
    else srs.interval = Math.round(srs.interval * srs.ease);
  }
  srs.ease = Math.max(1.3, srs.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + srs.interval);
  srs.due = dueDate.toISOString().split("T")[0];
};

const shuffle = (array) => {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const formatCategoryLabel = (name, count, dueCount, srsEnabled) =>
  srsEnabled ? `${name} (${dueCount}/${count})` : `${name} (${count}/${count})`;

const setStatus = (text) => {
  els.sessionStatus.textContent = text;
};

const updateTopbar = () => {
  const deckSize = state.deck.length;
  const current = deckSize === 0 ? 0 : state.currentIndex + 1;
  updateSelectionCounts();
  if (state.sessionStarted) {
    els.cardTracker.textContent = `${current} / ${deckSize}`;
  }
  if (state.selectedCategories.size === 0) {
    els.activeCategories.textContent = "All categories";
  } else {
    els.activeCategories.textContent = Array.from(state.selectedCategories).join(", ");
  }
  const profile = state.profiles.find((item) => item.id === state.activeProfileId);
  els.activeProfile.textContent = profile ? profile.name : "—";
};

const renderFields = (target, card, fields, bigField) => {
  target.innerHTML = "";
  const orderedFields = [...fields];
  if (bigField && !orderedFields.includes(bigField)) {
    orderedFields.unshift(bigField);
  } else if (orderedFields.includes(bigField)) {
    orderedFields.splice(orderedFields.indexOf(bigField), 1);
    orderedFields.unshift(bigField);
  }
  orderedFields.forEach((fieldKey) => {
    const fieldDef = FIELD_DEFS.find((def) => def.key === fieldKey);
    if (!fieldDef) return;
    const value = card[fieldKey];
    if (!value) return;
    const div = document.createElement("div");
    div.className = fieldDef.className;
    if (fieldKey === bigField) div.classList.add("field-big");
    else div.classList.add("field-secondary");
    div.textContent = value;
    target.appendChild(div);
  });
};

const updateCard = () => {
  if (!state.sessionStarted || state.deck.length === 0) {
    els.frontFieldsView.innerHTML = "";
    els.backFieldsView.innerHTML = "";
    els.frontHint.textContent = "Select categories to begin";
    return;
  }

  const card = state.deck[state.currentIndex];
  renderFields(els.frontFieldsView, card, state.frontFields, state.bigFieldFront);
  renderFields(els.backFieldsView, card, state.backFields, state.bigFieldBack);
  els.frontHint.textContent = state.flipped ? "" : "Tap to flip";
};

const applyFlip = () => {
  if (state.flipped) {
    els.flashcard.classList.add("flipped");
  } else {
    els.flashcard.classList.remove("flipped");
  }
};

const cardId = (category, idx, item) => `${category}-${idx}-${item.thai}-${item.english}`;

const buildDeck = () => {
  const selected = state.selectedCategories.size
    ? state.rawCategories.filter((cat) => state.selectedCategories.has(cat.category))
    : state.rawCategories;

  const deck = selected.flatMap((cat) =>
    cat.items.map((item, idx) => {
      const id = cardId(cat.category, idx, item);
      const srs = state.srsState[id] || createSrsState();
      return {
        id,
        category: cat.category,
        index: idx,
        thai: item.thai,
        english: item.english,
        roman_tone: item.roman_tone,
        phonetic_easy: item.phonetic_easy,
        srs,
      };
    })
  );

  const dueDeck = deck.filter((card) => card.srs.due <= today());
  const effectiveDeck = state.srsEnabled ? (dueDeck.length > 0 ? dueDeck : []) : deck;
  state.deck = state.shuffle ? shuffle([...effectiveDeck]) : effectiveDeck;
  state.wrongDeck = [];
  state.round = 1;
  state.sessionStats = {
    total: state.deck.length,
    right: 0,
    wrong: 0,
    perCategory: {},
  };
  state.currentIndex = 0;
  state.flipped = false;
  applyFlip();
  updateTopbar();

  if (state.deck.length === 0) {
    setStatus(state.srsEnabled ? "No due cards right now." : "No cards available. Select more categories.");
  } else {
    setStatus("");
  }
};

const advanceCard = () => {
  if (state.deck.length === 0) return;
  els.flashcard.classList.add("loading");
  els.frontFieldsView.innerHTML = "";
  els.backFieldsView.innerHTML = "";
  if (state.currentIndex < state.deck.length - 1) {
    state.currentIndex += 1;
  } else {
    openSummary();
  }
  state.flipped = false;
  applyFlip();
  updateTopbar();
  setTimeout(() => {
    updateCard();
    els.flashcard.classList.remove("loading");
  }, 200);
};

const handleRating = (quality) => {
  if (!state.sessionStarted || state.deck.length === 0) return;
  const card = state.deck[state.currentIndex];
  const isRight = quality >= 3;
  if (isRight) state.sessionStats.right += 1;
  else state.sessionStats.wrong += 1;
  if (!state.sessionStats.perCategory[card.category]) {
    state.sessionStats.perCategory[card.category] = { right: 0, wrong: 0 };
  }
  if (isRight) state.sessionStats.perCategory[card.category].right += 1;
  else state.sessionStats.perCategory[card.category].wrong += 1;
  if (!isRight) state.wrongDeck.push(card);
  sm2(card, quality);
  state.srsState[card.id] = card.srs;
  saveProfiles();
  advanceCard();
};

const renderSummary = () => {
  const { right, wrong, total, perCategory } = state.sessionStats;
  const percent = total === 0 ? 0 : Math.round((right / total) * 100);
  els.summaryTop.innerHTML = `<span style="color:#2F6B3D">${right} right</span> • <span style="color:#D94F4F">${wrong} wrong</span> • ${percent}%`;
  els.summaryList.innerHTML = "";
  Object.entries(perCategory).forEach(([category, stats]) => {
    const item = document.createElement("div");
    item.className = "summary-item";
    const name = document.createElement("span");
    name.textContent = category;
    const counts = document.createElement("span");
    counts.innerHTML = `<span style="color:#2F6B3D">${stats.right} right</span> / <span style="color:#D94F4F">${stats.wrong} wrong</span>`;
    item.appendChild(name);
    item.appendChild(counts);
    els.summaryList.appendChild(item);
  });
  els.reviewWrongBtn.disabled = state.wrongDeck.length === 0;
};

const openSummary = () => {
  const { perCategory } = state.sessionStats;
  Object.entries(perCategory).forEach(([category, stats]) => {
    const cat = state.rawCategories.find((c) => c.category === category);
    if (cat && stats.wrong === 0 && stats.right === cat.items.length) {
      state.mastered.add(category);
    }
  });
  persistSettings();
  renderSummary();
  els.summaryModal.classList.add("show");
  setStatus("Session complete.");
};

const closeSummary = () => {
  els.summaryModal.classList.remove("show");
};

const resetSrs = () => {
  const profile = state.profiles.find((item) => item.id === state.activeProfileId);
  if (!profile) return;
  const confirmed = confirm("Reset spaced repetition for this profile?");
  if (!confirmed) return;
  profile.srsState = {};
  state.srsState = {};
  saveProfiles();
  renderCategories();
  updateTopbar();
  updateSetupSummary();
  setStatus("SRS reset for this profile.");
};

const reviewWrongCards = () => {
  if (state.wrongDeck.length === 0) return;
  state.deck = state.shuffle ? shuffle([...state.wrongDeck]) : [...state.wrongDeck];
  state.wrongDeck = [];
  state.currentIndex = 0;
  state.round += 1;
  closeSummary();
  setStatus(`Wrong review round ${state.round}.`);
  updateTopbar();
  updateCard();
};


const renderCategories = () => {
  els.categoryList.innerHTML = "";
  state.rawCategories.forEach((cat) => {
    const wrapper = document.createElement("div");
    wrapper.className = "category-item";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedCategories.has(cat.category);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedCategories.add(cat.category);
      else state.selectedCategories.delete(cat.category);
      updateTopbar();
      updateSelectionCounts();
      updateSetupSummary();
    });

    const name = document.createElement("span");
    const dueCount = cat.items.filter((item, idx) => {
      const id = cardId(cat.category, idx, item);
      const srs = state.srsState[id] || createSrsState();
      return srs.due <= today();
    }).length;
    name.textContent = formatCategoryLabel(cat.category, cat.items.length, dueCount, state.srsEnabled);

    label.appendChild(checkbox);
    label.appendChild(name);

    wrapper.appendChild(label);

    if (state.mastered.has(cat.category)) {
      const badge = document.createElement("span");
      badge.className = "mango-badge";
      badge.textContent = "🥭";
      wrapper.appendChild(badge);
    }

    els.categoryList.appendChild(wrapper);
  });
  const masteredCount = state.mastered.size;
  const totalCategories = state.rawCategories.length;
  els.mangoCounter.textContent = `${masteredCount} / ${totalCategories} \uD83E\uDD6D`;
};

const renderFieldToggles = (target, activeSet, side) => {
  target.innerHTML = "";
  FIELD_DEFS.forEach((field) => {
    const label = document.createElement("label");
    label.className = "field-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = activeSet.has(field.key);
    input.addEventListener("change", () => {
      if (input.checked) activeSet.add(field.key);
      else activeSet.delete(field.key);
      persistSettings();
      updateCard();
    });
    const bigRadio = document.createElement("input");
    bigRadio.type = "radio";
    bigRadio.name = `bigField-${side}`;
    bigRadio.className = "big-radio";
    const currentBigField = side === "front" ? state.bigFieldFront : state.bigFieldBack;
    bigRadio.checked = currentBigField === field.key;
    bigRadio.addEventListener("change", () => {
      if (!bigRadio.checked) return;
      if (side === "front") state.bigFieldFront = field.key;
      else state.bigFieldBack = field.key;
      persistSettings();
      updateCard();
    });
    const bigLabel = document.createElement("span");
    bigLabel.className = "muted";
    bigLabel.textContent = "Main";
    const text = document.createElement("span");
    text.textContent = field.label;
    label.appendChild(input);
    label.appendChild(text);
    label.appendChild(bigRadio);
    label.appendChild(bigLabel);
    target.appendChild(label);
  });
};


const loadProfiles = () => {
  const version = localStorage.getItem(STORAGE_VERSION_KEY);
  if (version !== STORAGE_VERSION) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
    localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  try {
    state.profiles = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(state.profiles)) state.profiles = [];
  } catch {
    state.profiles = [];
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  }
  state.activeProfileId = localStorage.getItem(ACTIVE_PROFILE_KEY) || null;
};

const saveProfiles = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profiles));
  if (state.activeProfileId) localStorage.setItem(ACTIVE_PROFILE_KEY, state.activeProfileId);
};

const applyProfile = (profile) => {
  state.activeProfileId = profile.id;
  const settings = profile.settings || {};
  state.selectedCategories = new Set(settings.categories || []);
  state.mode = "srs";
  state.shuffle = settings.shuffle ?? false;
  state.srsEnabled = settings.srsEnabled ?? false;
  state.frontFields = new Set(settings.frontFields || ["thai", "roman_tone", "phonetic_easy"]);
  state.backFields = new Set(settings.backFields || ["english", "roman_tone"]);
  state.bigFieldFront = settings.bigFieldFront || "roman_tone";
  state.bigFieldBack = settings.bigFieldBack || "english";
  state.srsState = profile.srsState || {};
  state.mastered = new Set(profile.mastered || []);
  els.shuffleToggle.checked = state.shuffle;
  els.srsToggle.checked = state.srsEnabled;
  renderFieldToggles(els.frontFields, state.frontFields, "front");
  renderFieldToggles(els.backFields, state.backFields, "back");
  renderCategories();
  updateTopbar();
  updateSelectionCounts();
  updateSetupSummary();
  updateCard();
};

const persistSettings = () => {
  const profile = state.profiles.find((item) => item.id === state.activeProfileId);
  if (!profile) return;
  const settings = {
    categories: Array.from(state.selectedCategories),
    shuffle: state.shuffle,
    srsEnabled: state.srsEnabled,
    frontFields: Array.from(state.frontFields),
    backFields: Array.from(state.backFields),
    bigFieldFront: state.bigFieldFront,
    bigFieldBack: state.bigFieldBack,
  };
  profile.settings = settings;
  profile.srsState = state.srsState;
  profile.mastered = Array.from(state.mastered);
  profile.lastUsed = new Date().toISOString();
  saveProfiles();
};

const renderProfiles = () => {
  els.profileList.innerHTML = "";
  state.profiles.forEach((profile) => {
    const item = document.createElement("div");
    item.className = "profile-item";
    const name = document.createElement("span");
    name.textContent = profile.name;
    const actions = document.createElement("div");
    actions.className = "profile-actions";

    const useBtn = document.createElement("button");
    useBtn.className = "ghost small";
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", () => {
      applyProfile(profile);
      persistSettings();
      els.profileModal.classList.remove("show");
    });

    const renameBtn = document.createElement("button");
    renameBtn.className = "ghost small";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", () => {
      const newName = prompt("Rename profile", profile.name);
      if (!newName) return;
      profile.name = newName.trim();
      persistSettings();
      renderProfiles();
      updateTopbar();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost small";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete profile '${profile.name}'?`)) return;
      state.profiles = state.profiles.filter((p) => p.id !== profile.id);
      if (state.activeProfileId === profile.id) {
        state.activeProfileId = null;
        localStorage.removeItem(ACTIVE_PROFILE_KEY);
      }
      saveProfiles();
      renderProfiles();
      updateTopbar();
      ensureProfile();
    });

    actions.appendChild(useBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(name);
    item.appendChild(actions);
    els.profileList.appendChild(item);
  });
};

const ensureProfile = () => {
  if (!state.activeProfileId || !state.profiles.find((p) => p.id === state.activeProfileId)) {
    els.profileModal.classList.add("show");
  } else {
    const profile = state.profiles.find((p) => p.id === state.activeProfileId);
    applyProfile(profile);
  }
};

const init = async () => {
  if (!IS_DESKTOP) initVoices();
  els.ttsBtn = ensureTtsButton();
  try {
    const response = await fetch(DATA_API).catch(() => null);
    state.backendAvailable = FORCE_STATIC ? false : Boolean(response && response.ok);
    const resolvedResponse = state.backendAvailable
      ? response
      : await fetch(DATA_URL, { cache: "no-store" });
    if (!resolvedResponse.ok) {
      throw new Error(`Data fetch failed (${resolvedResponse.status})`);
    }
    const data = await resolvedResponse.json();
    state.rawCategories = data.categories || [];
    loadProfiles();
    renderProfiles();
    renderFieldToggles(els.frontFields, state.frontFields, "front");
    renderFieldToggles(els.backFields, state.backFields, "back");
    renderCategories();
    updateTopbar();
    updateCard();
    if (state.rawCategories.length === 0) {
      setStatus("Check that the JSON has a 'categories' array.");
    } else {
      setStatus("");
    }
    updateSetupSummary();
    updateSelectionCounts();
    setSetupCollapsed(false);
    document.querySelector(".app").classList.remove("in-session");
    ensureProfile();
    if (!IS_DESKTOP && els.ttsBtn) {
      els.ttsBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        speakCurrentCard();
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setStatus(`Failed to load JSON (${message}). Open ${DATA_URL} to verify it loads.`);
    console.error(error);
  }
};

els.flashcard.addEventListener("click", (event) => {
  if (!state.sessionStarted) return;
  if (event.target && event.target.closest && event.target.closest("#ttsBtn")) return;
  state.flipped = !state.flipped;
  applyFlip();
});


document.getElementById("srsHelpBtn").addEventListener("click", () => {
  document.getElementById("srsHelpModal").classList.add("show");
});
document.getElementById("srsHelpCloseBtn").addEventListener("click", () => {
  document.getElementById("srsHelpModal").classList.remove("show");
});

els.shuffleToggle.addEventListener("change", (event) => {
  state.shuffle = event.target.checked;
  updateSetupSummary();
  persistSettings();
});

els.srsToggle.addEventListener("change", (event) => {
  state.srsEnabled = event.target.checked;
  renderCategories();
  updateSetupSummary();
  updateSelectionCounts();
  persistSettings();
});

els.resetSrsBtn.addEventListener("click", resetSrs);

els.selectAllBtn.addEventListener("click", () => {
  state.rawCategories.forEach((cat) => state.selectedCategories.add(cat.category));
  renderCategories();
  updateTopbar();
  updateSetupSummary();
  updateSelectionCounts();
  persistSettings();
});

els.clearAllBtn.addEventListener("click", () => {
  state.selectedCategories.clear();
  renderCategories();
  updateTopbar();
  updateSetupSummary();
  updateSelectionCounts();
  persistSettings();
});

els.startBtn.addEventListener("click", () => {
  state.sessionStarted = true;
  buildDeck();
  updateCard();
  persistSettings();
  els.setupToggle.classList.remove("hidden");
  setSetupCollapsed(true);
  document.querySelector(".app").classList.add("in-session");
});

els.setupToggle.addEventListener("click", () => {
  const collapsed = els.setupSection.classList.contains("collapsed");
  if (collapsed) {
    state.sessionStarted = false;
    document.querySelector(".app").classList.remove("in-session");
    setSetupCollapsed(false);
    els.setupToggle.classList.add("hidden");
    renderCategories();
    updateSelectionCounts();
    updateSetupSummary();
    updateTopbar();
  } else {
    setSetupCollapsed(true);
  }
});


els.wrongBtn.addEventListener("click", () => handleRating(2));

els.correctBtn.addEventListener("click", () => handleRating(4));


els.reviewWrongBtn.addEventListener("click", reviewWrongCards);
els.exitSummaryBtn.addEventListener("click", () => {
  closeSummary();
  state.sessionStarted = false;
  document.querySelector(".app").classList.remove("in-session");
  setSetupCollapsed(false);
  els.setupToggle.classList.add("hidden");
  renderCategories();
  updateSelectionCounts();
  updateSetupSummary();
  updateTopbar();
  setStatus("Pick categories and start a session.");
});


els.switchProfileBtn.addEventListener("click", () => {
  renderProfiles();
  els.profileModal.classList.add("show");
});

els.createProfileBtn.addEventListener("click", () => {
  const name = els.newProfileName.value.trim();
  if (!name) return;
  const profile = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    settings: {
      categories: ["Greetings / Basics"],
      shuffle: false,
      srsEnabled: false,
      frontFields: ["thai", "roman_tone", "phonetic_easy"],
      backFields: ["english", "roman_tone"],
      bigFieldFront: "roman_tone",
      bigFieldBack: "english",
    },
    srsState: {},
  };
  state.profiles.push(profile);
  els.newProfileName.value = "";
  saveProfiles();
  renderProfiles();
  applyProfile(profile);
  els.profileModal.classList.remove("show");
});

init();
