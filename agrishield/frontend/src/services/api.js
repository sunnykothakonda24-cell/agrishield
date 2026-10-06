import { getFirebaseAuth } from './firebase';
import { signOut } from 'firebase/auth';
import { resolveApiBase } from './apiBase';
import {
  createImageUploadFormData,
  createVoiceUploadFormData,
  toSpeechLanguageCode
} from './aiMedia';

const DEFAULT_PRODUCTION_API_BASE = 'https://agrishield-8mbp.onrender.com/api';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? DEFAULT_PRODUCTION_API_BASE : '')).trim().replace(/\/+$/, '');
let activeFarmId = null;

function validateApiBase() {
  return resolveApiBase(API_BASE, import.meta.env.PROD);
}

export const setActiveFarmId = (farmId) => {
  activeFarmId = typeof farmId === 'string' && farmId.trim() ? farmId.trim() : null;
};

const fetchWithFirebaseAuth = async (url, options = {}, { forceRefresh = false, onRequestStart } = {}) => {
  validateApiBase();
  const headers = new Headers(options.headers || {});
  if (activeFarmId) headers.set('X-Farm-Id', activeFarmId);
  try {
    const user = getFirebaseAuth().currentUser;
    if (user) headers.set('Authorization', `Bearer ${await user.getIdToken(forceRefresh)}`);
  } catch (error) {
    if (!error.message?.includes('Firebase web authentication is not configured')) throw error;
  }
  try {
    onRequestStart?.();
    return await fetch(url, { ...options, headers });
  } catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    const error = new Error('The AgriShield API could not be reached.');
    error.code = 'API_NETWORK_ERROR';
    error.cause = cause;
    throw error;
  }
};

export const searchLocations = async (query, { signal } = {}) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/geocode?q=${encodeURIComponent(query)}`, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Location search failed. Please try again.');
  }
  return Array.isArray(data.results) ? data.results : [];
};

export const getCurrentSession = async (farmerName = '') => {
  let user;
  try {
    user = getFirebaseAuth().currentUser;
  } catch (cause) {
    const error = new Error(cause.message || 'Firebase web authentication is not configured.');
    error.code = 'FIREBASE_CLIENT_NOT_CONFIGURED';
    error.cause = cause;
    throw error;
  }
  if (!user) {
    const error = new Error('Sign in with Firebase to load your AgriShield account.');
    error.status = 401;
    error.code = 'AUTH_NOT_AUTHENTICATED';
    throw error;
  }
  const url = `${API_BASE}/auth/bootstrap`;
  let response;
  try {
    response = await fetchWithFirebaseAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ farmerName })
    });
  } catch (cause) {
    if (cause.code !== 'API_NETWORK_ERROR') throw cause;
    console.warn('[AgriShield API] Account bootstrap did not receive an HTTP response.', {
      url,
      errorName: cause.cause?.name || cause.name || 'network_error',
      networkError: cause.cause?.message || 'request_failed'
    });
    const error = new Error('Could not reach the farm data service. Check that the AgriShield backend is running, then retry.');
    error.code = 'API_NETWORK_ERROR';
    error.cause = cause;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.data) {
    let errorCode = data.code;
    let errorMessage = data.message;
    if (!errorCode) {
      if (response.status === 401) {
        errorCode = 'FIREBASE_AUTH_FAILED';
      } else if (response.status === 403) {
        errorCode = 'FARM_ACCESS_DENIED';
      } else if (response.status === 404) {
        errorCode = 'RESOURCE_NOT_FOUND';
      } else if (response.status === 503) {
        errorCode = 'FARM_DATA_UNAVAILABLE';
      } else if (response.status >= 500) {
        errorCode = 'BACKEND_SERVICE_ERROR';
      } else {
        errorCode = 'ACCOUNT_SYNC_FAILED';
      }
    }
    if (!errorMessage) {
      if (response.status === 401) {
        errorMessage = 'Your authentication session could not be verified. Please sign in again.';
      } else if (response.status === 403) {
        errorMessage = 'You do not have permission to access this account or farm data.';
      } else if (response.status === 404) {
        errorMessage = 'The requested account service endpoint was not found.';
      } else if (response.status === 503) {
        errorMessage = 'Farm data service is temporarily unavailable. Please retry shortly.';
      } else if (response.status >= 500) {
        errorMessage = 'A server error occurred while loading farm data. Please retry.';
      } else {
        errorMessage = 'Your AgriShield account could not be synchronized.';
      }
    }
    const error = new Error(errorMessage);
    error.status = response.status;
    error.code = errorCode;
    throw error;
  }
  setActiveFarmId(data.data.activeFarmId || data.data.farm?._id || null);
  return data.data;
};

export const selectActiveFarm = async (farmId) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/auth/active-farm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ farmId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.message || 'The selected farm could not be loaded.');
  }
  setActiveFarmId(data.data.activeFarmId);
  return data.data;
};

export const logoutSession = async () => {
  await signOut(getFirebaseAuth());
  setActiveFarmId(null);
};

export const deleteCurrentAccount = async () => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/account`, { method: 'DELETE' }, { forceRefresh: true });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data.message || 'Account deletion could not be completed. Please try again.');
    error.code = data.code || 'ACCOUNT_DELETION_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
};

async function supportRequest(path, options = {}) {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/support/${path}`, {
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data.message || 'Unable to load this information right now.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export const getSupportContact = () => supportRequest('contact');
export const getSupportFaqs = () => supportRequest('faqs');
export const getSupportAccountStatus = () => supportRequest('account-status');

export const submitSupportTicket = (formData) => supportRequest('ticket', {
  method: 'POST',
  body: formData
});

export const submitSupportFeedback = ({ rating, message }) => supportRequest('feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rating, message })
});

export const updateMobileNumber = async (mobile = '') => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/profile/update-mobile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile })
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Failed to update mobile number');
  }
  return data;
};

export const getFarmTwinState = async (farmId) => {
  const url = `${API_BASE}/farms/${encodeURIComponent(farmId)}/farm-twin`;
  const response = await fetchWithFirebaseAuth(url);
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Failed to fetch farm twin state');
  }
  return data.data;
};

export const saveFarmProfile = async (profileData) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/save-farm-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profileData)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to save farm profile');
  }
  setActiveFarmId(data.data?.activeFarmId || data.data?.farm?._id || activeFarmId);
  return data;
};

export const getFarmProfile = async (userId) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/farm-profile/${encodeURIComponent(userId)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch farm profile');
  }
  return data;
};

export const getFarmWeather = async ({ signal } = {}) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/weather`, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Weather information is temporarily unavailable.');
  }
  return data.weather;
};

export const getNotifications = async ({ signal } = {}) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/notifications`, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !Array.isArray(data.notifications)) {
    throw new Error(data.message || 'Notifications are temporarily unavailable. Please try again.');
  }
  return data.notifications;
};

export const markNotificationAsRead = async (notificationId) => {
  const response = await fetchWithFirebaseAuth(
    `${API_BASE}/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'PATCH' }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'This notification could not be updated. Please try again.');
  }
  return data;
};

export const getCropSchedule = async (farmId, { timeZone, signal } = {}) => {
  const params = new URLSearchParams();
  if (timeZone) params.set('timeZone', timeZone);
  const query = params.size ? `?${params}` : '';
  const response = await fetchWithFirebaseAuth(
    `${API_BASE}/farms/${encodeURIComponent(farmId)}/crop-schedule${query}`,
    { signal }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.data) {
    throw new Error(data.message || 'Crop schedule is temporarily unavailable.');
  }
  return data.data;
};

export const updateCropActivityStatus = async (farmId, activityId, { scheduledDate, status, timeZone }) => {
  const response = await fetchWithFirebaseAuth(
    `${API_BASE}/farms/${encodeURIComponent(farmId)}/activity/${encodeURIComponent(activityId)}/status`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledDate, status, timeZone })
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Activity status could not be saved.');
  }
  return data.activity;
};

export const getShopProducts = async (filters = {}, { signal } = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const response = await fetchWithFirebaseAuth(`${API_BASE}/shop/products?${params}`, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !Array.isArray(data.products)) {
    throw new Error(data.message || 'Products are temporarily unavailable.');
  }
  return data;
};

export const getShopProduct = async (productId, { signal } = {}) => {
  const response = await fetchWithFirebaseAuth(
    `${API_BASE}/shop/products/${encodeURIComponent(productId)}`,
    { signal }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.product) {
    throw new Error(data.message || 'Product details are temporarily unavailable.');
  }
  return data.product;
};

export const getRecentRadarFrame = async ({ signal } = {}) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/weather/radar`, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Radar data is unavailable for this area right now.');
  }
  return data.radar;
};

// ==========================================
// AgriShield multimodal AI API client
// ==========================================

function mediaDiagnostic(stage, details = {}) {
  if (!import.meta.env.DEV) return;
  if (stage.startsWith('tts') && typeof window !== 'undefined') {
    window.__AGRISHIELD_TTS_TIMINGS__ ||= [];
    window.__AGRISHIELD_TTS_TIMINGS__.push({
      stage,
      monotonicMs: globalThis.performance?.now?.() ?? Date.now(),
      ...details
    });
  }
  console.debug(`[AgriShield media] ${stage}`, details);
}

export const sendMessageToAI = async ({
  message,
  language = 'auto',
  conversationId = 'default-session',
  history = [],
  image = null,
  inputType = image ? 'image' : 'text',
  signal = null,
  requestId = null,
  onUploadComplete = () => {}
}) => {
  try {
    const payload = {
      message,
      language,
      languageCode: toSpeechLanguageCode(language, { preserveAuto: true }),
      inputType,
      conversationId,
      history,
      ...(requestId ? { requestId } : {})
    };

    if (image) {
      let imageForUpload = image;
      if (image.file instanceof Blob) {
        imageForUpload = image;
      } else if (typeof image === 'string' && image.startsWith('data:image/')) {
        const imageBlob = await fetch(image).then((response) => response.blob());
        imageForUpload = { file: imageBlob, name: 'farm-image', type: imageBlob.type };
      }
      const formData = createImageUploadFormData(payload, imageForUpload);
      mediaDiagnostic('imageUploadStarted', {
        byteSize: imageForUpload.file.size,
        mimeType: imageForUpload.file.type
      });
      const response = await sendAuthenticatedMultipart(`${API_BASE}/ai/chat`, formData, {
        signal,
        onUploadComplete
      });
      mediaDiagnostic('imageUploadResponse', { status: response.status });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const error = new Error(data?.error?.message || data?.reply || data?.message || 'Failed to get AI response');
        error.code = data?.error?.code || 'AI_PROVIDER_ERROR';
        error.status = response.status;
        error.imageMessageId = data?.imageMessageId || null;
        error.imageUrl = data?.imageUrl || null;
        throw error;
      }
      return data;
    }

    const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const error = new Error(data?.error?.message || data?.reply || data?.message || 'Failed to get AI response');
      error.code = data?.error?.code || 'AI_PROVIDER_ERROR';
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('[AgriShield AI] Request was stopped by farmer.');
      throw err;
    }
    console.error('[AgriShield AI] Backend fetch error:', err);
    throw err;
  }
};

function sendAuthenticatedMultipart(url, body, { signal, onUploadComplete }) {
  return new Promise((resolve, reject) => {
    let xhr;
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => xhr?.abort();

    try {
      validateApiBase();
      xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.timeout = 120000;
      if (activeFarmId) xhr.setRequestHeader('X-Farm-Id', activeFarmId);
      const user = getFirebaseAuth().currentUser;
      if (signal?.aborted) {
        fail(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve(user?.getIdToken())
        .then((token) => {
          if (settled || signal?.aborted) return;
          if (!token) {
            const error = new Error('Sign in with Firebase to send a crop image.');
            error.code = 'AUTH_NOT_AUTHENTICATED';
            throw error;
          }
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.upload.addEventListener('load', () => onUploadComplete());
          xhr.addEventListener('load', () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
              json: async () => {
                try { return JSON.parse(xhr.responseText); } catch { return {}; }
              }
            });
          });
          xhr.addEventListener('error', () => {
            const error = new Error('The AgriShield API could not be reached.');
            error.code = 'API_NETWORK_ERROR';
            fail(error);
          });
          xhr.addEventListener('timeout', () => {
            const error = new Error('The image request timed out. Please try again.');
            error.code = 'API_TIMEOUT';
            fail(error);
          });
          xhr.addEventListener('abort', () => {
            fail(new DOMException('The operation was aborted.', 'AbortError'));
          });
          xhr.send(body);
        })
        .catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

export const retryAIImageAnalysis = async ({ conversationId, messageId, language = 'auto' }) => {
  const response = await fetchWithFirebaseAuth(
    `${API_BASE}/ai/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/retry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ languageCode: toSpeechLanguageCode(language, { preserveAuto: true }) })
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data?.error?.message || data?.message || 'Image analysis is temporarily unavailable.');
    error.code = data?.error?.code || 'IMAGE_ANALYSIS_UNAVAILABLE';
    error.status = response.status;
    error.imageMessageId = data?.imageMessageId || null;
    error.imageUrl = data?.imageUrl || null;
    throw error;
  }
  return data;
};

export const transcribeVoice = async ({
  audioBlob,
  audioData,
  mimeType = 'audio/webm',
  language = 'auto',
  durationSeconds,
  signal
}) => {
  try {
    let body;
    let headers = {};

    if (audioBlob) {
      body = createVoiceUploadFormData({ audioBlob, mimeType, language, durationSeconds });
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        audioData,
        mimeType,
        languageCode: toSpeechLanguageCode(language, { preserveAuto: true }),
        durationSeconds
      });
    }

    mediaDiagnostic('voiceUploadStarted', {
      byteSize: audioBlob?.size,
      mimeType,
      languageCode: toSpeechLanguageCode(language)
    });
    const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/transcribe`, {
      method: 'POST',
      headers,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(65000)])
        : AbortSignal.timeout(65000),
      body
    });
    mediaDiagnostic('voiceUploadResponse', { status: response.status });

    const data = await response.json();
    if (!response.ok || !data.success) {
      const error = new Error(data?.error?.message || 'Transcription failed');
      error.status = response.status;
      error.code = data?.error?.code;
      throw error;
    }
    mediaDiagnostic('transcriptReceived', { received: Boolean(data?.text?.trim()) });
    return data;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[AgriShield media] voiceUploadFailed', {
        name: err.name,
        code: err.code,
        status: err.status
      });
    }
    throw err;
  }
};

export const speakVoice = async ({ text, language = 'en' }) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, languageCode: toSpeechLanguageCode(language) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data?.error?.message || 'Speech synthesis is unavailable right now.');
    error.voiceAvailable = data?.voiceAvailable === false;
    error.code = data?.error?.code;
    throw error;
  }
  return data;
};

export const speakVoiceStream = ({ text, language = 'en', signal }) => {
  const clientStartedAt = Date.now();
  mediaDiagnostic('ttsRequestStarted', { language: toSpeechLanguageCode(language) });
  return fetchWithFirebaseAuth(`${API_BASE}/ai/speak/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(import.meta.env.DEV
        ? { 'X-AgriShield-TTS-Client-Started-At': String(clientStartedAt) }
        : {})
    },
    body: JSON.stringify({ text, languageCode: toSpeechLanguageCode(language) }),
    signal
  }, {
    onRequestStart: () => mediaDiagnostic('ttsHttpRequestStarted', { language: toSpeechLanguageCode(language) })
  });
};

export const getLiveVoiceToken = async ({ language, farmId }) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/live-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(farmId ? { 'X-Farm-Id': farmId } : {}) },
    body: JSON.stringify({ languageCode: toSpeechLanguageCode(language) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.token || !data.setup) {
    throw new Error(data?.error?.message || 'Live Voice is unavailable right now.');
  }
  return data;
};

export const saveLiveVoiceMessage = async ({ conversationId, role, message, language, farmId }) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/live-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(farmId ? { 'X-Farm-Id': farmId } : {}) },
    body: JSON.stringify({ conversationId, role, message, languageCode: toSpeechLanguageCode(language) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'The Live Voice conversation could not be saved.');
  }
  return data;
};

export const getVoiceConfig = async () => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/voice-config`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !Number.isInteger(data.maxRecordingSeconds)) {
    throw new Error(data?.error?.message || 'Voice recording settings could not be loaded.');
  }
  return data;
};

export const submitAIFeedback = async ({ conversationId, messageId, rating }) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, messageId, rating })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Feedback could not be saved right now.');
  }
  return data;
};

export const getAIConversation = async (conversationId) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/conversations/${encodeURIComponent(conversationId)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data.message || 'Conversation history could not be loaded.');
    error.status = response.status;
    throw error;
  }
  return data;
};

export const clearAIConversation = async (conversationId) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data?.error?.message || data?.message || 'Could not clear the previous AI conversation.');
  }
  return data;
};

export const getAIStatus = async () => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/status`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data?.error?.message || data?.message || 'Could not retrieve AI service status.');
  }
  return data;
};
