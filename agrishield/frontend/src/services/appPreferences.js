const PREFERENCES_KEY = 'agrishield_preferences';
const LANGUAGE_KEY = 'agrishield_lang';
const APPEARANCE_KEY = 'agrishield_appearance';
const listeners = new Set();

function readPreferences() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
  } catch {
    saved = {};
  }

  const legacyLanguage = localStorage.getItem(LANGUAGE_KEY);
  const language = ['en', 'te', 'hi'].includes(saved.language)
    ? saved.language
    : ['en', 'te', 'hi'].includes(legacyLanguage)
      ? legacyLanguage
      : 'en';
  const legacyAppearance = localStorage.getItem(APPEARANCE_KEY);
  const appearance = ['light', 'dark'].includes(saved.appearance)
    ? saved.appearance
    : legacyAppearance === 'dark'
      ? 'dark'
      : 'light';

  return {
    language,
    appearance,
    notificationsEnabled: saved.notificationsEnabled !== false,
    voicePlaybackEnabled: saved.voicePlaybackEnabled !== false
  };
}

let preferences = readPreferences();

function applyPreferences() {
  document.documentElement.dataset.appearance = preferences.appearance;
  document.documentElement.lang = preferences.language;
  document.documentElement.style.colorScheme = preferences.appearance;
}

function emitChange() {
  listeners.forEach((listener) => listener());
  window.dispatchEvent(new CustomEvent('agrishield:preferences-changed', { detail: preferences }));
}

export function initializeAppPreferences() {
  applyPreferences();
}

export function getAppPreferences() {
  return preferences;
}

export function subscribeAppPreferences(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateAppPreferences(updates) {
  preferences = { ...preferences, ...updates };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  localStorage.setItem(LANGUAGE_KEY, preferences.language);
  localStorage.setItem(APPEARANCE_KEY, preferences.appearance);
  applyPreferences();
  emitChange();
}

window.addEventListener('storage', (event) => {
  if (event.key !== PREFERENCES_KEY && event.key !== LANGUAGE_KEY && event.key !== APPEARANCE_KEY) return;
  preferences = readPreferences();
  applyPreferences();
  emitChange();
});
