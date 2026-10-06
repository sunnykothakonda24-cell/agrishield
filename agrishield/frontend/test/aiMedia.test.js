import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createImageUploadFormData,
  createVoiceUploadFormData,
  getAudioFileExtension,
  toSpeechLanguageCode
} from '../src/services/aiMedia.js';

test('automatic speech language detection remains unforced and locales map to supported language keys', () => {
  assert.equal(toSpeechLanguageCode('auto'), 'en-IN');
  assert.equal(toSpeechLanguageCode('auto', { preserveAuto: true }), 'auto');
  assert.equal(toSpeechLanguageCode('en-IN'), 'en-IN');
  assert.equal(toSpeechLanguageCode('hi'), 'hi-IN');
  assert.equal(toSpeechLanguageCode('te-IN'), 'te-IN');
});

test('voice multipart upload preserves MIME type, filename extension, language and duration', async () => {
  for (const [mimeType, extension] of [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/ogg', 'ogg'],
    ['audio/mp4', 'mp4'],
    ['audio/wav', 'wav']
  ]) {
    assert.equal(getAudioFileExtension(mimeType), extension);
    const blob = new Blob(['voice-bytes'], { type: mimeType });
    const form = createVoiceUploadFormData({
      audioBlob: blob,
      mimeType,
      language: 'auto',
      durationSeconds: 3
    });
    const file = form.get('audioFile');
    assert.equal(file.type, mimeType);
    assert.equal(file.name, `voice.${extension}`);
    assert.equal(form.get('languageCode'), 'auto');
    assert.equal(form.get('durationSeconds'), '3');
  }
});

test('image multipart upload attaches the original file and JSON-encodes request metadata', () => {
  const image = new Blob(['png-bytes'], { type: 'image/png' });
  const form = createImageUploadFormData({
    message: 'Check the leaf.',
    language: 'hi',
    languageCode: 'hi-IN',
    requestId: 'image-request-1',
    history: [{ role: 'user', content: 'Previous question' }]
  }, { file: image, name: 'leaf.png' });
  const file = form.get('image');
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'leaf.png');
  assert.equal(form.get('message'), 'Check the leaf.');
  assert.equal(form.get('languageCode'), 'hi-IN');
  assert.equal(form.get('requestId'), 'image-request-1');
  assert.equal(form.get('history'), JSON.stringify([{ role: 'user', content: 'Previous question' }]));
});
