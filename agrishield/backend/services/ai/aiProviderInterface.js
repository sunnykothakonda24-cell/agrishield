/**
 * AIProviderInterface
 * Defines the contract that configured AI providers must implement.
 */

class AIProviderInterface {
  constructor(name) {
    this.name = name;
  }

  /**
   * Generates a conversational chat response
   * @param {Object} options
   * @param {Array<{role: string, content: string}>} options.messages - Formatted history
   * @param {string} options.systemInstruction - Strict system personality and domain boundaries
   * @param {number} [options.temperature]
   * @param {number} [options.maxTokens]
   * @returns {Promise<{text: string, finishReason: string, usage?: object}>}
   */
  async chat(options) {
    throw new Error(`chat() is not implemented in provider ${this.name}`);
  }

  /**
   * Analyzes an uploaded image with multimodal vision
   * @param {Object} options
   * @param {Buffer|string} options.image - Image buffer or base64 data URL
   * @param {string} options.mimeType - e.g. 'image/jpeg'
   * @param {string} options.prompt - Farmer question or prompt
   * @param {string} options.systemInstruction
   * @param {Array} [options.history]
   * @returns {Promise<{text: string, finishReason: string}>}
   */
  async analyzeImage(options) {
    throw new Error(`analyzeImage() is not implemented in provider ${this.name}`);
  }

  /**
   * Transcribes audio into text
   * @param {Object} options
   * @param {Buffer} options.audioBuffer
   * @param {string} options.mimeType
   * @param {string} options.language - e.g. 'te', 'hi', 'en'
   * @returns {Promise<{text: string, detectedLanguage?: string}>}
   */
  async transcribeAudio(options) {
    throw new Error(`transcribeAudio() is not implemented in provider ${this.name}`);
  }

  /**
   * Synthesizes text into spoken audio
   * @param {Object} options
   * @param {string} options.text
   * @param {string} options.language
   * @returns {Promise<{audioBuffer?: Buffer, audioUrl?: string, format: string}>}
   */
  async synthesizeSpeech(options) {
    throw new Error(`synthesizeSpeech() is not implemented in provider ${this.name}`);
  }
}

module.exports = AIProviderInterface;
