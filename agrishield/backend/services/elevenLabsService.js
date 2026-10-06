const crypto = require('crypto');
const { Readable } = require('stream');
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');
const { getLanguageConfig, resolveLanguage } = require('./ai/languageRegistry');

const ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_STT_MODEL = 'scribe_v2';
const DEFAULT_TTS_MODEL = 'eleven_v3';
const MAX_STT_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_TTS_CHARACTERS = 5000;
const REQUEST_TIMEOUT_MS = 60000;

function audioExtension(mimeType = 'audio/webm') {
  const baseMimeType = String(mimeType).split(';')[0].toLowerCase();
  const extensions = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/opus': 'opus',
    'audio/amr': 'amr'
  };
  return extensions[baseMimeType] || 'webm';
}

function providerErrorDetails(body, apiKey) {
  const detail = body?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const message = typeof detail.message === 'string'
      ? detail.message.replaceAll(apiKey, '[redacted]').replace(/\s+/g, ' ').slice(0, 300)
      : '';
    return {
      code: typeof detail.status === 'string' ? detail.status : null,
      message
    };
  }
  if (typeof detail === 'string') {
    return { code: null, message: detail.replaceAll(apiKey, '[redacted]').replace(/\s+/g, ' ').slice(0, 300) };
  }
  return { code: null, message: '' };
}

function normalizedDetectedLanguage(languageCode, fallbackLanguage) {
  const code = String(languageCode || '').toLowerCase();
  const language = ({ eng: 'en', hin: 'hi', tel: 'te' })[code] ||
    resolveLanguage(code, { allowAuto: false });
  return language || (fallbackLanguage === 'auto' ? 'en' : fallbackLanguage);
}

class ElevenLabsService {
  constructor({ fetchImpl = (...args) => fetch(...args), env = process.env } = {}) {
    this.fetchImpl = fetchImpl;
    this.env = env;
    this.reachability = {
      stt: { reachable: null, lastError: null, lastSuccessAt: null },
      tts: { reachable: null, lastError: null, lastSuccessAt: null }
    };
    this.audioCache = new Map();
    this.pendingTts = new Map();
  }

  isSttConfigured() {
    return this.env.STT_ENABLED !== 'false' &&
      Boolean(String(this.env.ELEVENLABS_API_KEY || '').trim());
  }

  isTtsConfigured() {
    return this.env.TTS_ENABLED !== 'false' &&
      Boolean(String(this.env.ELEVENLABS_API_KEY || '').trim()) &&
      Object.values(require('./ai/languageRegistry').LANGUAGES)
        .every((config) => Boolean(String(this.env[config.ttsVoiceEnv] || '').trim()));
  }

  getStatus() {
    const languages = Object.entries(require('./ai/languageRegistry').LANGUAGES).map(([key, config]) => ({
      languageCode: config.languageCode,
      voiceConfigured: Boolean(String(this.env[config.ttsVoiceEnv] || '').trim())
    }));
    return {
      stt: {
        provider: 'elevenlabs',
        model: this.env.ELEVENLABS_STT_MODEL || DEFAULT_STT_MODEL,
        configured: this.isSttConfigured(),
        ...this.reachability.stt
      },
      tts: {
        provider: 'elevenlabs',
        model: this.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL,
        configured: this.isTtsConfigured(),
        ...this.reachability.tts,
        languages
      }
    };
  }

  requireConfigured(service) {
    const configured = service === 'stt' ? this.isSttConfigured() : this.isTtsConfigured();
    if (!configured) {
      const code = service === 'stt' ? ERROR_CODES.STT_NOT_CONFIGURED : ERROR_CODES.TTS_NOT_CONFIGURED;
      throw new AgriShieldError(code, `ElevenLabs ${service.toUpperCase()} is not configured.`, 503);
    }
  }

  async request(endpoint, init, service) {
    const state = this.reachability[service];
    const apiKey = String(this.env.ELEVENLABS_API_KEY || '').trim();
    let response;
    const startedAt = performance.now();
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = init.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([init.signal, timeoutSignal])
      : init.signal || timeoutSignal;
    try {
      response = await this.fetchImpl(`${ELEVENLABS_API_BASE_URL}${endpoint}`, {
        ...init,
        headers: { 'xi-api-key': apiKey, ...init.headers },
        signal
      });
    } catch (error) {
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      const code = timeout ? ERROR_CODES.ELEVENLABS_TIMEOUT
        : service === 'stt' ? ERROR_CODES.TRANSCRIPTION_FAILED : ERROR_CODES.TTS_FAILED;
      state.reachable = false;
      state.lastError = code;
      throw new AgriShieldError(
        code,
        timeout ? `ElevenLabs ${service.toUpperCase()} request timed out.` : `ElevenLabs ${service.toUpperCase()} network request failed.`,
        timeout ? 504 : 502
      );
    }
    if (service === 'tts' && this.env.NODE_ENV === 'development') {
      console.debug('[AgriShield TTS Timing]', {
        stage: 'provider_headers_received',
        elapsedMs: Math.round(performance.now() - startedAt)
      });
    }

    if (!response.ok) {
      let body;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const providerError = providerErrorDetails(body, apiKey);
      const code = response.status === 401 || response.status === 403
        ? ERROR_CODES.ELEVENLABS_AUTH_FAILED
        : response.status === 429
          ? ERROR_CODES.VOICE_RATE_LIMITED
          : response.status === 400 || response.status === 413 || response.status === 422
            ? ERROR_CODES.ELEVENLABS_REQUEST_REJECTED
            : response.status >= 500
              ? service === 'stt' ? ERROR_CODES.TRANSCRIPTION_FAILED : ERROR_CODES.TTS_FAILED
              : ERROR_CODES.ELEVENLABS_PROVIDER_ERROR;
      state.reachable = response.status !== 401 && response.status !== 403;
      state.lastError = providerError.code || code;
      const statusCode = response.status === 401 || response.status === 403
        ? 503
        : response.status === 429
          ? 429
          : response.status === 400 || response.status === 413 || response.status === 422
            ? 400
            : 502;
      const message = providerError.message ||
        `ElevenLabs ${service.toUpperCase()} request failed with HTTP ${response.status}.`;
      throw new AgriShieldError(code, message, statusCode);
    }

    state.reachable = true;
    state.lastError = null;
    state.lastSuccessAt = new Date().toISOString();
    return response;
  }

  async transcribe({ audioBuffer, base64Data, mimeType = 'audio/webm', languageCode, language = 'auto' }) {
    this.requireConfigured('stt');
    if (!audioBuffer && !base64Data) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'No audio data received.', 400);
    }
    const audio = audioBuffer || Buffer.from(String(base64Data).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!audio.length) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Audio data is empty.', 400);
    }
    if (audio.length > MAX_STT_AUDIO_BYTES) {
      throw new AgriShieldError(ERROR_CODES.AUDIO_TOO_LARGE, 'Audio recording exceeds the 15 MB upload limit.', 413);
    }

    const normalizedLanguage = resolveLanguage(languageCode || language);
    if (!normalizedLanguage) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, te-IN, or auto.', 400);
    }
    const form = new FormData();
    form.append('model_id', this.env.ELEVENLABS_STT_MODEL || DEFAULT_STT_MODEL);
    form.append('file', new Blob([audio], { type: mimeType }), `voice.${audioExtension(mimeType)}`);
    if (normalizedLanguage !== 'auto') {
      form.append('language_code', getLanguageConfig(normalizedLanguage).sttLanguageCode);
    }

    const response = await this.request('/v1/speech-to-text', {
      method: 'POST',
      body: form
    }, 'stt');
    let result;
    try {
      result = await response.json();
    } catch {
      throw new AgriShieldError(ERROR_CODES.TRANSCRIPTION_FAILED, 'ElevenLabs returned an invalid transcription response.', 502);
    }
    const transcript = typeof result.text === 'string' ? result.text.trim() : '';
    if (!transcript) {
      throw new AgriShieldError(ERROR_CODES.TRANSCRIPTION_FAILED, 'ElevenLabs returned no transcript.', 422);
    }
    const detected = normalizedDetectedLanguage(result.language_code, normalizedLanguage);
    const config = getLanguageConfig(detected);
    return {
      success: true,
      text: transcript,
      transcript,
      language: detected,
      detectedLanguage: detected,
      languageCode: config.languageCode,
      inputType: 'voice',
      provider: 'elevenlabs',
      mimeType
    };
  }

  async synthesize({ text, languageCode, language = 'en', ownerUid, farmId }) {
    const speech = this.prepareSpeech({ text, languageCode, language, ownerUid, farmId });
    const { speechText, config, voiceId, cacheKey } = speech;
    if (cacheKey && this.audioCache.has(cacheKey)) return this.audioCache.get(cacheKey);
    if (cacheKey && this.pendingTts.has(cacheKey)) return this.pendingTts.get(cacheKey);

    const synthesis = this.synthesizeOnce({ speechText, config, voiceId });
    if (!cacheKey) return synthesis;
    this.pendingTts.set(cacheKey, synthesis);
    try {
      const result = await synthesis;
      this.cacheAudio(cacheKey, result);
      return result;
    } finally {
      this.pendingTts.delete(cacheKey);
    }
  }

  prepareSpeech({ text, languageCode, language = 'en', ownerUid, farmId }) {
    this.requireConfigured('tts');
    if (typeof text !== 'string' || !text.trim()) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Text is required for TTS.', 400);
    }
    const normalizedLanguage = resolveLanguage(languageCode || language, { allowAuto: false });
    if (!normalizedLanguage) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, or te-IN.', 400);
    }
    const speechText = text.trim();
    if (speechText.length > MAX_TTS_CHARACTERS) {
      throw new AgriShieldError(ERROR_CODES.TTS_FAILED, `Speech text must not exceed ${MAX_TTS_CHARACTERS} characters.`, 413);
    }
    const config = getLanguageConfig(normalizedLanguage);
    const voiceId = String(this.env[config.ttsVoiceEnv] || '').trim();
    if (!voiceId) {
      throw new AgriShieldError(ERROR_CODES.TTS_NOT_CONFIGURED, `${config.ttsVoiceEnv} is required.`, 503);
    }
    const modelId = this.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;
    const cacheKey = ownerUid && farmId
      ? crypto.createHash('sha256')
        .update(`${ownerUid}:${farmId}:${config.languageCode}:${voiceId}:${modelId}:${speechText}`)
        .digest('hex')
      : null;
    return { speechText, config, voiceId, modelId, cacheKey };
  }

  cacheAudio(cacheKey, result) {
    if (this.audioCache.size >= 50) this.audioCache.delete(this.audioCache.keys().next().value);
    this.audioCache.set(cacheKey, result);
  }

  async synthesizeStream({ text, languageCode, language = 'en', ownerUid, farmId, signal }) {
    const speech = this.prepareSpeech({ text, languageCode, language, ownerUid, farmId });
    const { speechText, config, voiceId, modelId, cacheKey } = speech;
    const cachedAudio = cacheKey && this.audioCache.get(cacheKey)?.audioBase64;
    if (cachedAudio) {
      return {
        stream: Readable.from([Buffer.from(cachedAudio, 'base64')]),
        contentType: 'audio/mpeg',
        cacheHit: true
      };
    }

    if (this.env.NODE_ENV === 'development') {
      console.debug('[AgriShield TTS Timing]', { stage: 'provider_request_started' });
    }
    const response = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: speechText,
          model_id: modelId,
          language_code: config.ttsLanguageCode
        }),
        signal
      },
      'tts'
    );
    if (!response.body) {
      throw new AgriShieldError(ERROR_CODES.TTS_FAILED, 'ElevenLabs returned no streaming audio.', 502);
    }

    const source = typeof response.body[Symbol.asyncIterator] === 'function'
      ? response.body
      : Readable.fromWeb(response.body);
    const service = this;
    let receivedAudio = false;
    const chunks = [];
    const stream = Readable.from((async function* streamAudio() {
      let completed = false;
      try {
        for await (const chunk of source) {
          const audioChunk = Buffer.from(chunk);
          if (!audioChunk.length) continue;
          chunks.push(audioChunk);
          if (!receivedAudio) {
            receivedAudio = true;
            if (service.env.NODE_ENV === 'development') {
              console.debug('[AgriShield TTS Timing]', { stage: 'provider_first_audio_byte' });
            }
          }
          yield audioChunk;
        }
        completed = true;
      } finally {
        if (completed && cacheKey && chunks.length) {
          const audio = Buffer.concat(chunks);
          service.cacheAudio(cacheKey, {
            success: true,
            voiceAvailable: true,
            audioBase64: audio.toString('base64'),
            format: 'audio/mpeg',
            audioContentType: 'audio/mpeg',
            language: config.languageCode.slice(0, 2),
            languageCode: config.languageCode,
            provider: 'elevenlabs'
          });
        }
      }
    })());

    return {
      stream,
      contentType: response.headers?.get?.('content-type') || 'audio/mpeg',
      cacheHit: false
    };
  }

  async synthesizeOnce({ speechText, config, voiceId }) {
    const modelId = this.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;
    const response = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: speechText,
          model_id: modelId,
          language_code: config.ttsLanguageCode
        })
      },
      'tts'
    );
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) {
      throw new AgriShieldError(ERROR_CODES.TTS_FAILED, 'ElevenLabs returned an empty audio response.', 502);
    }
    return {
      success: true,
      voiceAvailable: true,
      audioBase64: audio.toString('base64'),
      format: 'audio/mpeg',
      audioContentType: 'audio/mpeg',
      language: config.languageCode.slice(0, 2),
      languageCode: config.languageCode,
      provider: 'elevenlabs'
    };
  }
}

const elevenLabsService = new ElevenLabsService();

module.exports = elevenLabsService;
module.exports.ElevenLabsService = ElevenLabsService;
module.exports.DEFAULT_STT_MODEL = DEFAULT_STT_MODEL;
module.exports.DEFAULT_TTS_MODEL = DEFAULT_TTS_MODEL;
