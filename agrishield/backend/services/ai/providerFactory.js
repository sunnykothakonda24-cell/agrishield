const OpenAIProvider = require('./openaiProvider');
const OllamaProvider = require('./ollamaProvider');
const GeminiProvider = require('./geminiProvider');
const { getAIConfig } = require('./aiConfig');
const elevenLabsService = require('../elevenLabsService');
const { ERROR_CODES, AgriShieldError } = require('../../utils/errors');

class ProviderFactory {
  constructor() {
    this.instances = new Map();
  }

  getProvider(providerName) {
    const selected = (providerName || process.env.AI_PROVIDER || 'gemini').toLowerCase().trim();

    if (this.instances.has(selected)) {
      return this.instances.get(selected);
    }

    let instance;
    switch (selected) {
      case 'openai':
        instance = new OpenAIProvider();
        break;
      case 'ollama':
        instance = new OllamaProvider();
        break;
      case 'gemini':
        instance = new GeminiProvider();
        break;
      default:
        throw new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, `Unsupported AI provider '${selected}'.`, 503);
    }

    this.instances.set(selected, instance);
    return instance;
  }

  getStatus() {
    const config = getAIConfig();
    const currentName = config.provider;
    const apiKey = process.env.OPENAI_API_KEY;
    const openaiConfigured = Boolean(apiKey && apiKey.length > 5);
    const textModel = currentName === 'gemini'
      ? config.textModel
      : process.env.OLLAMA_MODEL || process.env.AI_MODEL ||
        (currentName === 'ollama' ? 'qwen2.5:3b' : 'gpt-4o-mini');
    const isConfigured = currentName === 'ollama'
      ? Boolean(textModel)
      : currentName === 'openai'
        ? openaiConfigured
        : currentName === 'gemini' && Boolean(config.geminiApiKey);
    const defaultModel = textModel;
    const voiceStatus = elevenLabsService.getStatus();

    return {
      provider: currentName,
      isConfigured,
      localBaseUrl: currentName === 'ollama'
        ? process.env.OLLAMA_BASE_URL || process.env.LOCAL_AI_BASE_URL || 'http://127.0.0.1:11434'
        : null,
      model: defaultModel,
      visionModel: config.visionModel,
      visionConfigured: Boolean(config.geminiApiKey),
      geminiVisionModel: config.visionModel,
      geminiVisionConfigured: Boolean(config.geminiApiKey),
      liveModel: config.liveModel,
      liveConfigured: Boolean(config.geminiApiKey) && config.liveEnabled,
      geminiConfigured: Boolean(config.geminiApiKey),
      sttProvider: voiceStatus.stt.provider,
      sttConfigured: voiceStatus.stt.configured,
      sttStatus: voiceStatus.stt,
      ttsProvider: voiceStatus.tts.provider,
      voiceStatus,
      openaiConfigured,
      ttsConfigured: voiceStatus.tts.configured,
      ttsStatus: voiceStatus.tts,
      weatherProvider: 'open-meteo'
    };
  }
}

const factory = new ProviderFactory();
module.exports = factory;
