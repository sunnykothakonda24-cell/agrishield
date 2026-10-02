const providerFactory = require('./ai/providerFactory');
const localWhisperService = require('./localWhisperService');
const { detectLanguage, normalizeLanguage } = require('./ai/languageIntent');
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');

class SpeechService {
  async transcribe({ audioBuffer, base64Data, mimeType = 'audio/webm', language = 'auto' }) {
    if (!audioBuffer && !base64Data) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'No audio data received', 400);
    }

    const normalizedAudioBuffer = audioBuffer || (base64Data
      ? Buffer.from(base64Data.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : null);

    try {
      const sttProviderName = process.env.AI_STT_PROVIDER ||
        (process.env.AI_PROVIDER === 'ollama' ? 'whisper-local' : 'openai');
      const result = sttProviderName === 'whisper-local'
        ? await localWhisperService.transcribe({
          audioBuffer: normalizedAudioBuffer,
          language: normalizeLanguage(language)
        })
        : await providerFactory.getProvider(sttProviderName).transcribeAudio({
          audioBuffer: normalizedAudioBuffer,
          mimeType,
          language: normalizeLanguage(language)
        });

      return {
        success: true,
        text: result.text,
        language: result.detectedLanguage || detectLanguage(result.text, language),
        detectedLanguage: result.detectedLanguage || detectLanguage(result.text, language),
        provider: sttProviderName
      };
    } catch (err) {
      console.error('[SpeechService Error]:', err.message);
      if (err instanceof AgriShieldError) throw err;
      throw new AgriShieldError(ERROR_CODES.TRANSCRIPTION_FAILED, err.message, 500);
    }
  }
}

const speechService = new SpeechService();
module.exports = speechService;
