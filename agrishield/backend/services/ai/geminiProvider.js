const { GoogleGenAI } = require('@google/genai');
const AIProviderInterface = require('./aiProviderInterface');
const { getAIConfig } = require('./aiConfig');
const { ERROR_CODES, AgriShieldError } = require('../../utils/errors');
const TRANSIENT_RETRY_DELAYS = [300, 900];

function getStatusCode(error) {
  return Number(error?.status || error?.statusCode || error?.code) || 0;
}

class GeminiProvider extends AIProviderInterface {
  constructor({ apiKey, client } = {}) {
    super('gemini');
    const config = getAIConfig();
    this.apiKey = apiKey || config.geminiApiKey;
    this.textModel = config.textModel;
    this.visionModel = config.visionModel;
    this.liveModel = config.liveModel;
    this.client = client || (this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null);
    this.liveClient = client || (this.apiKey
      ? new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: 'v1alpha' } })
      : null);
  }

  ensureConfigured(model = this.textModel) {
    if (!this.apiKey || !this.client) {
      throw new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, 'GEMINI_API_KEY is not configured on the backend.', 503);
    }
    if (!model || !/^[a-zA-Z0-9._-]+$/.test(model)) {
      throw new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, 'The configured Gemini model name is invalid.', 503);
    }
  }

  mapError(error) {
    const status = getStatusCode(error);
    if (status === 401 || status === 403 || status === 404) {
      return new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, `Gemini credentials or model configuration failed (HTTP ${status}).`, 503);
    }
    if (status === 503) {
      return new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, 'Gemini is temporarily unavailable (HTTP 503).', 503);
    }
    if (status === 504) {
      return new AgriShieldError(ERROR_CODES.AI_TIMEOUT, 'Gemini request timed out (HTTP 504).', 504);
    }
    if (status === 429) {
      return new AgriShieldError(ERROR_CODES.AI_RATE_LIMIT, 'Gemini is temporarily rate limited.', 429);
    }
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return new AgriShieldError(ERROR_CODES.AI_TIMEOUT, 'Gemini request timed out.', 504);
    }
    return new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, `Gemini request failed${status ? ` (HTTP ${status})` : ''}.`, 502);
  }

  logRequestFailure(operation, error, attempt, retrying) {
    const status = getStatusCode(error);
    const category = status === 503
      ? 'service_unavailable'
      : status === 504 || error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'timeout'
        : status === 429
          ? 'rate_limited'
          : status === 401 || status === 403
            ? 'authentication'
            : status === 404
              ? 'model_not_found'
              : 'provider_error';
    console.warn(`[AgriShield Gemini] ${operation} request failed.`, {
      configured: Boolean(this.apiKey),
      attempt,
      status: status || null,
      category,
      retrying
    });
  }

  async chat(options = {}) {
    this.ensureConfigured(this.textModel);
    for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS.length; attempt += 1) {
      try {
        const response = await this.client.models.generateContent({
          model: this.textModel,
          contents: (options.messages || []).map((message) => ({
            role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
            parts: [{ text: String(message.content || '') }]
          })),
          config: {
            systemInstruction: options.systemInstruction || undefined,
            temperature: options.temperature ?? 0.4,
            maxOutputTokens: options.maxTokens ?? 1024,
            httpOptions: { timeout: 45000 }
          }
        });
        const text = response.text || '';
        return { text, finishReason: response.candidates?.[0]?.finishReason || 'stop', provider: this.name };
      } catch (error) {
        const mapped = this.mapError(error);
        const retrying = [503, 504].includes(mapped.statusCode) && attempt < TRANSIENT_RETRY_DELAYS.length;
        this.logRequestFailure('text', error, attempt + 1, retrying);
        if (!retrying) throw mapped;
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS[attempt]));
      }
    }
    throw new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, 'Gemini is temporarily unavailable.', 503);
  }

  async analyzeImage({ imageBuffer, base64Data, mimeType = 'image/jpeg', prompt, systemInstruction = '', history = [] }) {
    this.ensureConfigured(this.visionModel);
    const encodedImage = imageBuffer
      ? imageBuffer.toString('base64')
      : String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
    if (!encodedImage) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'An image is required for Gemini analysis.', 400);
    }
    const contents = [
      ...history.slice(-4).map((message) => ({
        role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(message.content || '') }]
      })),
      {
        role: 'user',
        parts: [
          { text: prompt || 'Analyze the visible crop or plant.' },
          { inlineData: { mimeType, data: encodedImage } }
        ]
      }
    ];
    const retryDelays = [300, 800];
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        const response = await this.client.models.generateContent({
          model: this.visionModel,
          contents,
          config: {
            systemInstruction,
            temperature: 0.3,
            maxOutputTokens: 1200,
            httpOptions: { timeout: 60000 }
          }
        });
        return { text: response.text || '', finishReason: response.candidates?.[0]?.finishReason || 'stop', provider: this.name };
      } catch (error) {
        const mappedError = this.mapError(error);
        const retrying = [503, 504].includes(mappedError.statusCode) && attempt < retryDelays.length;
        this.logRequestFailure('vision', error, attempt + 1, retrying);
        if (retrying) {
          await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
          continue;
        }
        if (![503, 504].includes(mappedError.statusCode)) throw mappedError;
        throw new AgriShieldError(
          ERROR_CODES.IMAGE_ANALYSIS_UNAVAILABLE,
          'Gemini image analysis remained unavailable after bounded retries.',
          503
        );
      }
    }
    throw new AgriShieldError(ERROR_CODES.IMAGE_ANALYSIS_UNAVAILABLE, 'Gemini image analysis is temporarily unavailable.', 503);
  }

  async createLiveToken({ systemInstruction }) {
    this.ensureConfigured(this.liveModel);
    if (!this.liveClient?.authTokens?.create) {
      throw new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, 'The installed Gemini SDK does not support Live ephemeral tokens.', 503);
    }
    const now = Date.now();
    const maxMinutes = getAIConfig().liveMaxMinutes;
    const config = {
      uses: 1,
      expireTime: new Date(now + maxMinutes * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: `models/${this.liveModel}`,
        config: {
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: systemInstruction }] },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
          }
        }
      },
      lockAdditionalFields: [
        'model',
        'responseModalities',
        'inputAudioTranscription',
        'outputAudioTranscription',
        'systemInstruction',
        'speechConfig',
        'tools'
      ]
    };
    try {
      const token = await this.liveClient.authTokens.create({ config });
      if (!token?.name) {
        throw new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, 'Gemini did not return an ephemeral Live token.', 502);
      }
      return {
        token: token.name,
        model: `models/${this.liveModel}`,
        setup: {
          model: `models/${this.liveModel}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: systemInstruction }] }
        },
        expiresAt: token.expireTime || config.expireTime,
        maxMinutes
      };
    } catch (error) {
      if (error instanceof AgriShieldError) throw error;
      throw this.mapError(error);
    }
  }
}

module.exports = GeminiProvider;
