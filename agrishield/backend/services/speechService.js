const elevenLabsService = require('./elevenLabsService');

module.exports = elevenLabsService;
module.exports.SpeechService = class SpeechService extends elevenLabsService.ElevenLabsService {
  isConfigured() {
    return this.isSttConfigured();
  }
};
