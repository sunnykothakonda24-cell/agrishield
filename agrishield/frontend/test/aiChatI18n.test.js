import test from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../src/i18n.js';

test('AI chat context and image recovery copy is localized in English, Hindi, and Telugu', () => {
  for (const language of ['en', 'hi', 'te']) {
    const farmContext = translate(language, 'ai.usingFarm', { farm: 'North Field', area: '5.49' });
    assert.match(farmContext, /North Field/);
    assert.match(farmContext, /5\.49/);
    assert.notEqual(translate(language, 'aiChat.assistantSub'), 'aiChat.assistantSub');
    assert.notEqual(translate(language, 'ai.imageUnavailable'), 'ai.imageUnavailable');
    assert.notEqual(translate(language, 'ai.attachPhoto'), 'ai.attachPhoto');
    for (const key of [
      'ai.cropPhoto',
      'ai.cropPhotoAttached',
      'ai.conversationNotSaved',
      'ai.sources',
      'ai.startRecording',
      'ai.uploadingImage',
      'ai.analyzingUploadedImage',
      'ai.analysisComplete',
      'ai.imageUploadFailed'
    ]) {
      assert.notEqual(translate(language, key), key);
    }
    const weatherMeta = translate(language, 'ai.weatherMeta', { provider: 'Open-Meteo', date: '10:30' });
    assert.match(weatherMeta, /Open-Meteo/);
    assert.match(weatherMeta, /10:30/);
  }
});
