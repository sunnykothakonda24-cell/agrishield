const OpenAIProvider = require('./openaiProvider');
const OllamaProvider = require('./ollamaProvider');
const { ERROR_CODES, AgriShieldError } = require('../../utils/errors');

class ProviderFactory {
  constructor() {
    this.instances = new Map();
  }

  getProvider(providerName) {
    const selected = (providerName || process.env.AI_PROVIDER || 'ollama').toLowerCase().trim();

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
      default:
        throw new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, `Unsupported AI provider '${selected}'.`, 503);
    }

    this.instances.set(selected, instance);
    return instance;
  }

  getStatus() {
    const currentName = (process.env.AI_PROVIDER || 'ollama').toLowerCase().trim();
    const apiKey = process.env.OPENAI_API_KEY;
    const openaiConfigured = Boolean(apiKey && apiKey.length > 5);
    const textModel = process.env.OLLAMA_MODEL || process.env.AI_MODEL ||
      (currentName === 'ollama' ? 'qwen2.5:3b' : 'gpt-4o-mini');
    const visionModel = process.env.OLLAMA_VISION_MODEL || process.env.AI_VISION_MODEL || '';
    const isConfigured = currentName === 'ollama'
      ? Boolean(textModel)
      : currentName === 'openai' && openaiConfigured;
    const defaultModel = textModel;
    const ttsProvider = process.env.AI_TTS_PROVIDER || 'google-cloud';

    return {
      provider: currentName,
      isConfigured,
      localBaseUrl: currentName === 'ollama'
        ? process.env.OLLAMA_BASE_URL || process.env.LOCAL_AI_BASE_URL || 'http://127.0.0.1:11434'
        : null,
      model: defaultModel,
      visionModel: visionModel || null,
      visionConfigured: currentName === 'openai'
        ? Boolean(process.env.OPENAI_API_KEY && process.env.AI_VISION_MODEL)
        : Boolean(visionModel),
      sttProvider: process.env.AI_STT_PROVIDER || (currentName === 'ollama' ? 'whisper-local' : 'openai'),
      sttConfigured: (process.env.AI_STT_PROVIDER || (currentName === 'ollama' ? 'whisper-local' : 'openai')) === 'whisper-local'
        ? Boolean(process.env.WHISPER_MODEL || 'onnx-community/whisper-tiny')
        : Boolean(openaiConfigured),
      ttsProvider,
      openaiConfigured,
      ttsConfigured: ttsProvider === 'openai'
        ? openaiConfigured
        : ttsProvider === 'google-cloud'
          ? Boolean(process.env.GOOGLE_CLOUD_TTS_API_KEY)
          : ttsProvider === 'google-cloud-service-account'
            ? Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)
          : ttsProvider === 'web-speech',
      weatherProvider: 'open-meteo'
    };
  }
}

const factory = new ProviderFactory();
module.exports = factory;
