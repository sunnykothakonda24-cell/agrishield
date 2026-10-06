const LANGUAGE_CODE_BY_KEY = Object.freeze({
  en: 'en-IN',
  hi: 'hi-IN',
  te: 'te-IN'
});

export function toSpeechLanguageCode(language, { preserveAuto = false } = {}) {
  const normalized = String(language || 'auto').trim().toLowerCase();
  if (normalized === 'auto') return preserveAuto ? 'auto' : LANGUAGE_CODE_BY_KEY.en;
  const languageKey = normalized.split('-')[0];
  return LANGUAGE_CODE_BY_KEY[languageKey] || LANGUAGE_CODE_BY_KEY.en;
}

export function getAudioFileExtension(mimeType) {
  const baseMimeType = String(mimeType || '').split(';')[0].toLowerCase();
  const extensions = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3'
  };
  return extensions[baseMimeType] ||
    (baseMimeType.startsWith('audio/') && baseMimeType.slice('audio/'.length).replace(/[^a-z0-9]+/g, '')) ||
    'audio';
}

export function createVoiceUploadFormData({ audioBlob, mimeType, language, durationSeconds }) {
  const formData = new FormData();
  formData.append('audioFile', audioBlob, `voice.${getAudioFileExtension(mimeType)}`);
  formData.append('languageCode', toSpeechLanguageCode(language, { preserveAuto: true }));
  formData.append('durationSeconds', String(durationSeconds));
  return formData;
}

export function createImageUploadFormData(payload, image) {
  const formData = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  if (image.file instanceof Blob) {
    formData.append('image', image.file, image.name || 'farm-image');
  } else if (typeof image === 'string' && image.startsWith('data:image/')) {
    throw new Error('Convert data URLs to a Blob before creating the image upload.');
  } else {
    throw new Error('The selected image could not be attached. Please choose it again.');
  }
  return formData;
}
