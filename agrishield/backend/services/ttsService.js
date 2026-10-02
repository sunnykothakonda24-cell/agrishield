const crypto = require('crypto');
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');
const providerFactory = require('./ai/providerFactory');

const VOICES = {
  te: { locale: 'te-IN', name: 'te-IN-Standard-A' },
  hi: { locale: 'hi-IN', name: 'hi-IN-Neural2-A' },
  en: { locale: 'en-IN', name: 'en-IN-Neural2-A' }
};

function normalizeSpeechText(text, language) {
  const words = {
    te: { degrees: 'డిగ్రీల సెల్సియస్', percent: 'శాతం', lux: 'లక్స్', acres: 'ఎకరాలు', hectares: 'హెక్టార్లు', meters: 'మీటర్లు' },
    hi: { degrees: 'डिग्री सेल्सियस', percent: 'प्रतिशत', lux: 'लक्स', acres: 'एकड़', hectares: 'हेक्टेयर', meters: 'मीटर' },
    en: { degrees: 'degrees Celsius', percent: 'percent', lux: 'lux', acres: 'acres', hectares: 'hectares', meters: 'meters' }
  }[language] || { degrees: 'degrees Celsius', percent: 'percent', lux: 'lux', acres: 'acres', hectares: 'hectares', meters: 'meters' };

  return String(text)
    .replace(/(\d+(?:\.\d+)?)\s*°\s*C\b/gi, `$1 ${words.degrees}`)
    .replace(/(\d+(?:\.\d+)?)\s*%/g, `$1 ${words.percent}`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:lux|లక్స్|लक्स)(?=$|\s|[,.])/gi, `$1 ${words.lux}`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:acres?|ఎకరాలు|एकड़)(?=$|\s|[,.])/gi, `$1 ${words.acres}`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:hectares?|హెక్టార్లు|हेक्टेयर)(?=$|\s|[,.])/gi, `$1 ${words.hectares}`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:m²|m2|meters?)(?=$|\s|[,.])/gi, `$1 ${words.meters}`)
    .replace(/[#*_•]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class TTSService {
  constructor() {
    this.audioCache = new Map();
  }

  getCacheKey(text, language, voice) {
    return crypto.createHash('sha256').update(`${language}:${voice}:${text}`).digest('hex');
  }

  async synthesize({ text, language = 'en' }) {
    if (!text || typeof text !== 'string') {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Text is required for TTS', 400);
    }
    const voice = VOICES[language] || VOICES.en;
    const speechText = normalizeSpeechText(text, language);
    const provider = process.env.AI_TTS_PROVIDER || 'google-cloud';
    if (provider === 'openai') {
      const result = await providerFactory.getProvider('openai').synthesizeSpeech({
        text: speechText,
        language
      });
      return {
        success: true,
        audioBase64: result.audioBuffer.toString('base64'),
        format: result.format,
        speechText,
        language,
        voiceLocale: voice.locale,
        voiceName: 'alloy',
        provider: result.provider
      };
    }
    if (provider === 'web-speech' || (provider === 'google-cloud' && !process.env.GOOGLE_CLOUD_TTS_API_KEY)) {
      return {
        success: true,
        speechText,
        language,
        voiceLocale: voice.locale,
        voiceName: voice.name,
        provider: 'web-speech',
        fallbackReason: provider === 'google-cloud' ? 'Google Cloud TTS is not configured; the browser must have a matching language voice.' : null
      };
    }
    if (provider !== 'google-cloud') {
      throw new AgriShieldError(ERROR_CODES.TTS_FAILED, `Unsupported TTS provider '${provider}'.`, 503);
    }

    const cacheKey = this.getCacheKey(speechText, language, voice.name);
    if (this.audioCache.has(cacheKey)) return this.audioCache.get(cacheKey);

    const url = new URL('https://texttospeech.googleapis.com/v1/text:synthesize');
    url.searchParams.set('key', process.env.GOOGLE_CLOUD_TTS_API_KEY);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: speechText },
        voice: { languageCode: voice.locale, name: voice.name },
        audioConfig: { audioEncoding: 'MP3' }
      }),
      signal: AbortSignal.timeout(15000)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.audioContent !== 'string') {
      throw new AgriShieldError(ERROR_CODES.TTS_FAILED, `Google Cloud TTS returned HTTP ${response.status}.`, 502);
    }

    const synthesized = {
      success: true,
      audioBase64: result.audioContent,
      format: 'audio/mpeg',
      speechText,
      language,
      voiceLocale: voice.locale,
      voiceName: voice.name,
      provider: 'google-cloud-tts'
    };
    if (this.audioCache.size >= 50) this.audioCache.delete(this.audioCache.keys().next().value);
    this.audioCache.set(cacheKey, synthesized);
    return synthesized;
  }
}

const ttsService = new TTSService();
module.exports = ttsService;
module.exports.normalizeSpeechText = normalizeSpeechText;
