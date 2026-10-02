import { getFirebaseAuth } from './firebase';
import { signOut } from 'firebase/auth';

const API_HOST = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
const API_BASE = (import.meta.env.VITE_API_BASE_URL || `http://${API_HOST}:5000/api`).replace(/\/+$/, '');

const fetchWithFirebaseAuth = async (url, options = {}, { forceRefresh = false } = {}) => {
  const headers = new Headers(options.headers || {});
  try {
    const user = getFirebaseAuth().currentUser;
    if (user) headers.set('Authorization', `Bearer ${await user.getIdToken(forceRefresh)}`);
  } catch (error) {
    if (!error.message?.includes('Firebase web authentication is not configured')) throw error;
  }
  try {
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
    const error = new Error(data.message || 'Your AgriShield account could not be synchronized.');
    error.status = response.status;
    error.code = data.code || (response.status === 401 || response.status === 403
      ? 'FIREBASE_AUTH_FAILED'
      : response.status === 503
        ? 'FARM_DATA_UNAVAILABLE'
        : 'ACCOUNT_SYNC_FAILED');
    throw error;
  }
  return data.data;
};

export const logoutSession = async () => {
  await signOut(getFirebaseAuth());
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

export const updateMobileNumber = async () => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/profile/update-mobile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
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
// AGRISHIELD-AI — PHASE 1 MULTIMODAL AI API CLIENT
// ==========================================

export const sendMessageToAI = async ({
  message,
  language = 'auto',
  conversationId = 'default-session',
  history = [],
  image = null,
  signal = null
}) => {
  try {
    const payload = {
        message,
        language,
        conversationId,
        history
    };
    let requestBody = JSON.stringify(payload);
    let headers = { 'Content-Type': 'application/json' };

    if (image) {
      const formData = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      });
      if (image.file instanceof Blob) {
        formData.append('imageFile', image.file, image.name || 'farm-image');
      } else if (typeof image === 'string' && image.startsWith('data:image/')) {
        const imageBlob = await fetch(image).then((response) => response.blob());
        formData.append('imageFile', imageBlob, 'farm-image');
      } else {
        throw new Error('The selected image could not be attached. Please choose it again.');
      }
      requestBody = formData;
      headers = {};
    }

    const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers,
      signal,
      body: requestBody
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const errorMsg = data?.error?.message || data?.reply || data?.message || 'Failed to get AI response';
      const error = new Error(errorMsg);
      error.code = data?.error?.code || 'AI_PROVIDER_ERROR';
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

export const transcribeVoice = async ({ audioBlob, audioData, mimeType = 'audio/webm', language = 'auto' }) => {
  try {
    let body;
    let headers = {};

    if (audioBlob) {
      const formData = new FormData();
      const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      formData.append('audioFile', audioBlob, `voice.${extension}`);
      formData.append('language', language);
      body = formData;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ audioData, mimeType, language });
    }

    const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/transcribe`, {
      method: 'POST',
      headers,
      body
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data?.error?.message || 'Transcription failed');
    }
    return data;
  } catch (err) {
    console.warn('[AgriShield Voice] Transcription request error:', err.message);
    throw err;
  }
};

export const speakVoice = async ({ text, language = 'en' }) => {
  const response = await fetchWithFirebaseAuth(`${API_BASE}/ai/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data?.error?.message || 'Speech synthesis is unavailable right now.');
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
