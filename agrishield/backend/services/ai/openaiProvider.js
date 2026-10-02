const AIProviderInterface = require('./aiProviderInterface');
const { ERROR_CODES, AgriShieldError } = require('../../utils/errors');
const { detectLanguage } = require('./languageIntent');

class OpenAIProvider extends AIProviderInterface {
  constructor(config = {}) {
    super('openai');
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = 'https://api.openai.com/v1';
    this.modelName = config.model || process.env.AI_MODEL || 'gpt-4o-mini';
    this.visionModelName = config.visionModel || process.env.AI_VISION_MODEL || 'gpt-4o-mini';
    this.sttModelName = config.sttModel || process.env.AI_STT_MODEL || 'whisper-1';
    this.ttsModelName = config.ttsModel || process.env.AI_TTS_MODEL || 'tts-1';
  }

  ensureConfigured() {
    if (!this.apiKey) {
      throw new AgriShieldError(
        ERROR_CODES.AI_NOT_CONFIGURED,
        'OpenAI API key is missing. Set OPENAI_API_KEY in backend/.env',
        503
      );
    }
  }

  handleApiError(statusCode, errorData) {
    const providerCode = errorData?.error?.code || errorData?.error?.type || 'unknown';
    console.error('[OpenAI] Request failed:', { statusCode, providerCode });

    if (statusCode === 401) {
      return new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, 'The configured AI provider rejected its credentials.', 503);
    }
    if (statusCode === 429) {
      return new AgriShieldError(ERROR_CODES.AI_RATE_LIMIT, 'The configured AI provider is rate limited or out of quota.', 429);
    }
    if (statusCode >= 500) {
      return new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, `The AI provider returned HTTP ${statusCode}.`, 502);
    }
    return new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, `The AI provider returned HTTP ${statusCode}.`, 502);
  }

  /**
   * Multi-turn chat generation
   */
  async chat({ messages = [], systemInstruction = '', temperature = 0.4, maxTokens = 1024 }) {
    this.ensureConfigured();

    const formattedMessages = [];
    if (systemInstruction) {
      formattedMessages.push({ role: 'system', content: systemInstruction });
    }

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens
        }),
        signal: AbortSignal.timeout(45000)
      });

      const data = await response.json();
      if (!response.ok) {
        throw this.handleApiError(response.status, data);
      }

      const text = data.choices?.[0]?.message?.content || '';
      return {
        text,
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
        raw: data
      };
    } catch (err) {
      if (err instanceof AgriShieldError) throw err;
      throw new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, err.message, 500);
    }
  }

  /**
   * Multimodal vision analysis
   */
  async analyzeImage({
    imageBuffer,
    base64Data,
    mimeType = 'image/jpeg',
    prompt = 'Analyze this plant or crop image carefully.',
    systemInstruction = '',
    history = []
  }) {
    this.ensureConfigured();

    let fullDataUrl = base64Data;
    if (!fullDataUrl && imageBuffer) {
      fullDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    } else if (fullDataUrl && !fullDataUrl.startsWith('data:')) {
      fullDataUrl = `data:${mimeType};base64,${fullDataUrl}`;
    }

    const formattedMessages = [];
    if (systemInstruction) {
      formattedMessages.push({ role: 'system', content: systemInstruction });
    }

    if (history && history.length > 0) {
      for (const h of history.slice(-4)) {
        formattedMessages.push({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content
        });
      }
    }

    formattedMessages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: fullDataUrl,
            detail: 'high'
          }
        }
      ]
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.visionModelName,
          messages: formattedMessages,
          temperature: 0.3,
          max_tokens: 1200
        }),
        signal: AbortSignal.timeout(60000)
      });

      const data = await response.json();
      if (!response.ok) {
        throw this.handleApiError(response.status, data);
      }

      const text = data.choices?.[0]?.message?.content || '';
      return {
        text,
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
        raw: data
      };
    } catch (err) {
      if (err instanceof AgriShieldError) throw err;
      throw new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, err.message, 500);
    }
  }

  /**
   * Audio transcription using OpenAI Whisper API
   */
  async transcribeAudio({ audioBuffer, mimeType = 'audio/webm', language = 'auto' }) {
    this.ensureConfigured();

    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType });
      const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' :
        mimeType.includes('wav') ? 'wav' : mimeType.includes('mpeg') ? 'mp3' : 'webm';
      formData.append('file', blob, `audio.${extension}`);
      formData.append('model', this.sttModelName);
      formData.append('response_format', 'verbose_json');
      if (language && language !== 'auto') {
        formData.append('language', language);
      }

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData,
        signal: AbortSignal.timeout(60000)
      });

      const data = await response.json();
      if (!response.ok) {
        throw this.handleApiError(response.status, data);
      }

      return {
        text: data.text || '',
        detectedLanguage: ({
          telugu: 'te',
          hindi: 'hi',
          english: 'en'
        })[String(data.language || '').toLowerCase()] || detectLanguage(data.text || '', language)
      };
    } catch (err) {
      if (err instanceof AgriShieldError) throw err;
      throw new AgriShieldError(ERROR_CODES.TRANSCRIPTION_FAILED, err.message, 500);
    }
  }

  /**
   * Synthesize speech using OpenAI TTS API
   */
  async synthesizeSpeech({ text, language }) {
    this.ensureConfigured();

    try {
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.ttsModelName,
          input: text,
          voice: 'alloy'
        }),
        signal: AbortSignal.timeout(45000)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleApiError(response.status, errorData);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      return {
        audioBuffer,
        format: 'audio/mpeg',
        provider: 'openai-tts'
      };
    } catch (err) {
      if (err instanceof AgriShieldError) throw err;
      throw new AgriShieldError(ERROR_CODES.TTS_FAILED, err.message, 500);
    }
  }
}

module.exports = OpenAIProvider;
