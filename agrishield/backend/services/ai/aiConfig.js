const languageRegistry = require('./languageRegistry');

function getAIConfig() {
  return {
    provider: (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase(),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    textModel: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
    visionModel: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
    liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
    liveEnabled: process.env.GEMINI_LIVE_ENABLED !== 'false',
    liveMaxMinutes: getBoundedInteger(process.env.GEMINI_LIVE_MAX_MINUTES, 30, 1, 60),
    voiceMaxRecordingSeconds: getBoundedInteger(process.env.VOICE_MAX_RECORDING_SECONDS, 60, 1, 60),
    maxOutputTokens: getBoundedInteger(process.env.AI_MAX_OUTPUT_TOKENS, 1024, 128, 4096)
  };
}

function getBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

module.exports = {
  getAIConfig,
  getLanguageConfig: languageRegistry.getLanguageConfig,
  getBoundedInteger,
  LANGUAGE_CONFIG: languageRegistry.LANGUAGES
};
