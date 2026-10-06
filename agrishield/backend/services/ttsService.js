const elevenLabsService = require('./elevenLabsService');

class TTSService extends elevenLabsService.ElevenLabsService {
  isConfigured() {
    return this.isTtsConfigured();
  }
}

module.exports = elevenLabsService;
module.exports.TTSService = TTSService;
