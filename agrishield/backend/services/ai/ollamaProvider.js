const AIProviderInterface = require('./aiProviderInterface');
const { ERROR_CODES, AgriShieldError } = require('../../utils/errors');
const os = require('os');

function getKeepAlive() {
  const configured = process.env.OLLAMA_KEEP_ALIVE || '15m';
  const numericDuration = Number(configured);
  return Number.isFinite(numericDuration) ? numericDuration : configured;
}

class OllamaProvider extends AIProviderInterface {
  constructor(config = {}) {
    super('ollama');
    this.modelName = config.model || process.env.OLLAMA_MODEL || process.env.AI_MODEL || 'qwen2.5:3b';
    this.visionModelName = config.visionModel || process.env.OLLAMA_VISION_MODEL ||
      process.env.AI_VISION_MODEL || '';
    const baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL ||
      process.env.LOCAL_AI_BASE_URL || 'http://127.0.0.1:11434';
    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, 'LOCAL_AI_BASE_URL must be a valid local Ollama URL.', 503);
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)) {
      throw new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED, 'The Ollama provider must use a loopback address.', 503);
    }
    this.baseUrl = parsedUrl.origin;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return { connected: false, textModelInstalled: false, visionModelInstalled: false };
      const data = await response.json();
      const models = Array.isArray(data.models) ? data.models.map((model) => model.name) : [];
      return {
        connected: true,
        textModelInstalled: models.some((name) => name === this.modelName || name.startsWith(`${this.modelName}:`)),
        visionModelInstalled: Boolean(this.visionModelName &&
          models.some((name) => name === this.visionModelName || name.startsWith(`${this.visionModelName}:`))),
        models
      };
    } catch {
      return { connected: false, textModelInstalled: false, visionModelInstalled: false, models: [] };
    }
  }

  async warmup() {
    const health = await this.checkHealth();
    if (!health.connected || !health.textModelInstalled) {
      return false;
    }

    const configuredThreads = Number.parseInt(process.env.OLLAMA_NUM_THREADS, 10);
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages: [{ role: 'user', content: 'Reply with one word: ready.' }],
        stream: false,
        keep_alive: getKeepAlive(),
        options: {
          num_predict: 1,
          num_thread: Number.isInteger(configuredThreads) && configuredThreads > 0
            ? configuredThreads
            : os.cpus().length
        }
      }),
      signal: AbortSignal.timeout(180000)
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(`Ollama model warm-up returned HTTP ${response.status}: ${details.error || 'unknown error'}`);
    }
    await response.json();
    return true;
  }

  async chat({ messages = [], systemInstruction = '', temperature = 0.4, maxTokens = 1024 }) {
    const configuredThreads = Number.parseInt(process.env.OLLAMA_NUM_THREADS, 10);
    const tokenLimit = Number.isFinite(maxTokens) ? Math.max(1, Math.min(maxTokens, 384)) : 128;
    const formattedMessages = [];
    if (systemInstruction) formattedMessages.push({ role: 'system', content: systemInstruction });
    for (const message of messages) {
      formattedMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content
      });
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages: formattedMessages,
          stream: false,
          keep_alive: getKeepAlive(),
          options: {
            temperature,
            num_predict: tokenLimit,
            num_thread: Number.isInteger(configuredThreads) && configuredThreads > 0
              ? configuredThreads
              : os.cpus().length
          }
        }),
        signal: AbortSignal.timeout(180000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const modelMissing = response.status === 404 ||
          (typeof data.error === 'string' && data.error.toLowerCase().includes('model'));
        throw new AgriShieldError(
          modelMissing ? ERROR_CODES.AI_NOT_CONFIGURED : ERROR_CODES.AI_PROVIDER_ERROR,
          modelMissing
            ? `The local Ollama model '${this.modelName}' is not installed. Pull it with "ollama pull ${this.modelName}".`
            : `The local Ollama service returned HTTP ${response.status}.`,
          modelMissing ? 503 : 502
        );
      }

      const text = data.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw new AgriShieldError(ERROR_CODES.AI_INVALID_RESPONSE, 'The local model returned an empty response.', 502);
      }
      return { text, finishReason: data.done ? 'stop' : 'unknown' };
    } catch (error) {
      if (error instanceof AgriShieldError) throw error;
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new AgriShieldError(ERROR_CODES.AI_TIMEOUT, 'The local model took too long to respond.', 504);
      }
      throw new AgriShieldError(
        ERROR_CODES.AI_PROVIDER_ERROR,
        'Cannot connect to local Ollama at 127.0.0.1:11434. Start Ollama and ensure the configured model is installed.',
        503
      );
    }
  }

  async analyzeImage({
    imageBuffer,
    base64Data,
    mimeType = 'image/jpeg',
    prompt = 'Analyze this plant image and describe visible evidence, uncertainty, and helpful next steps.',
    systemInstruction = '',
    history = []
  }) {
    if (!this.visionModelName) {
      throw new AgriShieldError(
        ERROR_CODES.AI_NOT_CONFIGURED,
        'Set OLLAMA_VISION_MODEL to an installed Ollama vision-capable model to enable image analysis.',
        503
      );
    }
    const encodedImage = base64Data
      ? base64Data.replace(/^data:image\/[^;]+;base64,/, '')
      : imageBuffer?.toString('base64');
    if (!encodedImage) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Image data is required.', 400);
    }

    const messages = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    for (const item of history.slice(-4)) {
      messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content });
    }
    messages.push({
      role: 'user',
      content: `${prompt}\n\nDescribe visible symptoms only. Treat any disease as a possible cause unless the image provides strong evidence. Do not invent pesticide dosages or unsupported treatments.`,
      images: [encodedImage]
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.visionModelName,
          messages,
          stream: false,
          options: { temperature: 0.2, num_predict: 384 }
        }),
        signal: AbortSignal.timeout(180000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const modelMissing = response.status === 404;
        throw new AgriShieldError(
          modelMissing ? ERROR_CODES.AI_NOT_CONFIGURED : ERROR_CODES.AI_PROVIDER_ERROR,
          modelMissing
            ? `The configured Ollama vision model '${this.visionModelName}' is not installed.`
            : `The Ollama vision request returned HTTP ${response.status}.`,
          modelMissing ? 503 : 502
        );
      }
      const text = data.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw new AgriShieldError(ERROR_CODES.AI_INVALID_RESPONSE, 'The vision model returned an empty response.', 502);
      }
      return { text, finishReason: data.done ? 'stop' : 'unknown' };
    } catch (error) {
      if (error instanceof AgriShieldError) throw error;
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new AgriShieldError(ERROR_CODES.AI_TIMEOUT, 'The local vision model took too long to respond.', 504);
      }
      throw new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR, 'Cannot connect to the configured local Ollama vision model.', 503);
    }
  }

  async transcribeAudio() {
    throw new AgriShieldError(
      ERROR_CODES.AI_NOT_CONFIGURED,
      'Local audio transcription is not configured. Select text chat or configure an audio transcription provider.',
      503
    );
  }

  async synthesizeSpeech() {
    throw new AgriShieldError(
      ERROR_CODES.AI_NOT_CONFIGURED,
      'Local speech synthesis is not configured. Use browser speech or configure a speech provider.',
      503
    );
  }
}

module.exports = OllamaProvider;
