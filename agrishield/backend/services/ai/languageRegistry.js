const LANGUAGES = Object.freeze({
  en: Object.freeze({
    languageCode: 'en-IN',
    languageName: 'English',
    responseInstruction: 'Use clear, conversational English.',
    sttLocale: 'en-IN',
    sttLanguageCode: 'en',
    ttsLanguageCode: 'en',
    ttsVoiceEnv: 'ELEVENLABS_TTS_EN_VOICE_ID'
  }),
  hi: Object.freeze({
    languageCode: 'hi-IN',
    languageName: 'Hindi',
    responseInstruction: 'Write natural Hindi in Devanagari script; retain familiar agricultural terms in English only when useful.',
    sttLocale: 'hi-IN',
    sttLanguageCode: 'hi',
    ttsLanguageCode: 'hi',
    ttsVoiceEnv: 'ELEVENLABS_TTS_HI_VOICE_ID'
  }),
  te: Object.freeze({
    languageCode: 'te-IN',
    languageName: 'Telugu',
    responseInstruction: 'Write natural Telugu in Telugu script; retain familiar agricultural terms in English only when useful.',
    sttLocale: 'te-IN',
    sttLanguageCode: 'te',
    ttsLanguageCode: 'te',
    ttsVoiceEnv: 'ELEVENLABS_TTS_TE_VOICE_ID'
  })
});

const SUPPORTED_LANGUAGE_LOCALES = Object.freeze(
  Object.values(LANGUAGES).map(({ sttLocale }) => sttLocale)
);

function resolveLanguage(language, { allowAuto = true } = {}) {
  if (language === undefined || language === null || language === '') {
    return allowAuto ? 'auto' : null;
  }
  const normalized = String(language).trim().toLowerCase();
  if (allowAuto && normalized === 'auto') return 'auto';
  return Object.entries(LANGUAGES)
    .find(([key, config]) => normalized === key || normalized === config.languageCode.toLowerCase())
    ?.[0] || null;
}

function getLanguageConfig(language) {
  const key = resolveLanguage(language, { allowAuto: false }) || 'en';
  return LANGUAGES[key];
}

module.exports = {
  LANGUAGES,
  SUPPORTED_LANGUAGE_LOCALES,
  getLanguageConfig,
  resolveLanguage
};
