const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getFarmEnvironmentState } = require('./services/farmTwinService');
const { resolveFarmTimeZone } = require('./services/farmTimezoneService');
const weatherService = require('./services/weatherService');
const rainViewerService = require('./services/rainViewerService');
const { queueFarmDataRefresh } = require('./services/farmDataRefreshService');
const { normalizeFarmBoundary } = require('./utils/farmGeometry');
const {
  requireFirebaseFarmer,
  requireFirebaseIdentity,
  requireActiveFarm,
  requireRecentFirebaseIdentity
} = require('./middleware/firebaseAuth');
const {
  getFirebaseAdminConfigurationError,
  getPrivateFirestoreConfigurationError,
  getApplicationFirebaseAdminConfigurationError,
  getFirebaseAdminRuntimeStatus,
  getFirebaseAuth
} = require('./services/firebaseAdmin');
const firestoreRepository = require('./services/firestoreRepository');
const { buildCropSchedule, cropKey, parseDateOnly, SAVED_ACTIVITY_STATUSES } = require('./services/cropScheduleService');
const { filterProducts, normalizeCategory } = require('./services/shopCatalogService');
const { syncFirebaseAccount } = require('./services/firebaseAccountService');
const accountDeletionService = require('./services/accountDeletionService');
const { getFarmerProfile } = require('./services/farmerProfileService');
const providerFactory = require('./services/ai/providerFactory');
const conversationStorageService = require('./services/conversationStorageService');
const elevenLabsService = require('./services/elevenLabsService');
const { LANGUAGES } = require('./services/ai/languageRegistry');
const { getAIConfig } = require('./services/ai/aiConfig');
const cloudinaryImageService = require('./services/cloudinaryImageService');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && getAIConfig().provider !== 'gemini') {
  throw new Error('AI_PROVIDER must be gemini in production.');
}
const defaultOrigins = isProduction
  ? ['https://agrishield-gamma.vercel.app']
  : ['https://agrishield-gamma.vercel.app', 'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
const configuredCorsOrigins = process.env.CORS_ALLOWED_ORIGINS ||
  (!isProduction ? process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://localhost:3000' : '');
const allowedOrigins = Array.from(new Set([
  ...defaultOrigins,
  ...configuredCorsOrigins
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
]));
if (isProduction) {
  if (allowedOrigins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain the HTTPS deployment origin in production.');
  }
  for (const origin of allowedOrigins) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must contain valid HTTPS origins only.');
    }
    if (origin === '*' || parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin ||
        ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname)) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact public HTTPS origins in production.');
    }
  }
}
app.use(cors({
  origin(origin, callback) {
    const normalized = origin ? origin.trim().replace(/\/+$/, '') : '';
    if (!origin || allowedOrigins.includes(normalized) || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by the AgriShield API.'));
  },
  credentials: true
}));
app.use(express.json());
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use('/api/ai/speak/stream', (req, res, next) => {
  req.ttsRequestReceivedAt = performance.now();
  const clientStartedAt = Number(req.get('X-AgriShield-TTS-Client-Started-At'));
  req.ttsClientElapsedMs = Number.isSafeInteger(clientStartedAt)
    ? Math.max(0, Date.now() - clientStartedAt)
    : undefined;
  next();
});

let lastGeocodeRequestAt = 0;
let geocodeQueue = Promise.resolve();

async function waitForGeocodeSlot() {
  let release;
  const previous = geocodeQueue;
  geocodeQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  const waitMs = Math.max(0, 1000 - (Date.now() - lastGeocodeRequestAt));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastGeocodeRequestAt = Date.now();
  release();
}

function isoTimestamp(value) {
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function serializeProduct(product) {
  const price = product.price === null || product.price === undefined ? null : Number(product.price);
  return {
    id: product._id,
    productName: product.productName || product.name || '',
    category: String(product.category || '').toLowerCase().replace(/s$/, ''),
    brand: product.brand || null,
    crops: Array.isArray(product.crops) ? product.crops : [],
    varieties: Array.isArray(product.varieties) ? product.varieties : [],
    suitableStages: Array.isArray(product.suitableStages) ? product.suitableStages : [],
    packSize: product.packSize || null,
    price: Number.isFinite(price) ? price : null,
    currency: product.currency || null,
    priceUpdatedAt: isoTimestamp(product.priceUpdatedAt),
    imageUrl: product.imageUrl || null,
    supplierName: product.supplierName || null,
    supplierPhone: product.supplierPhone || null,
    supplierWhatsApp: product.supplierWhatsApp || null,
    supplierLocation: product.supplierLocation || null,
    availability: product.availability || null,
    contactMethod: product.contactMethod || null,
    description: product.description || null
  };
}

app.get('/api/health', async (req, res) => {
  let ollama = {
    connected: false,
    textModelInstalled: false,
    visionModelInstalled: false
  };
  if (getAIConfig().provider === 'ollama') {
    try {
      ollama = await providerFactory.getProvider('ollama').checkHealth();
    } catch (error) {
      console.error('[AgriShield Health] Ollama status check failed:', { code: error.code || 'provider_error' });
    }
  }
  const firebaseAdmin = getFirebaseAdminRuntimeStatus();
  const [privateFirestore, applicationFirestore] = await Promise.all([
    firestoreRepository.checkPrivateHealth(),
    firestoreRepository.checkHealth()
  ]);
  const conversationStorage = await conversationStorageService.checkHealth();
  const aiStatus = providerFactory.getStatus();
  const voiceStatus = elevenLabsService.getStatus();
  const aiReady = aiStatus.provider === 'ollama'
    ? Boolean(ollama.connected && ollama.textModelInstalled)
    : aiStatus.isConfigured;
  const storageReady = conversationStorage.connected && privateFirestore.connected && applicationFirestore.connected;
  const projectAStatus = {
    projectId: firebaseAdmin.privateProject.projectId,
    adminConfigured: firebaseAdmin.privateProject.adminConfigured,
    authConfigured: firebaseAdmin.privateProject.authConfigured,
    firestoreConfigured: privateFirestore.configured,
    firestoreConnected: privateFirestore.connected,
    authConfigurationError: firebaseAdmin.privateProject.authConfigurationError ||
      (firebaseAdmin.privateProject.authConfigured ? null : getFirebaseAdminConfigurationError()),
    firestoreConfigurationError: firebaseAdmin.privateProject.firestoreConfigurationError ||
      (privateFirestore.configured ? null : getPrivateFirestoreConfigurationError())
  };
  const projectBStatus = {
    projectId: firebaseAdmin.applicationProject.projectId,
    adminConfigured: firebaseAdmin.applicationProject.adminConfigured,
    firestoreConfigured: applicationFirestore.configured,
    firestoreConnected: applicationFirestore.connected,
    configurationError: firebaseAdmin.applicationProject.adminConfigured
      ? null
      : getApplicationFirebaseAdminConfigurationError()
  };
  return res.status(aiReady && storageReady ? 200 : 503).json({
    server: 'ok',
    authentication: {
      emailPassword: true,
      firebaseIdentity: true
    },
    firebasePrivateConfigured: firebaseAdmin.privateProject.authConfigured &&
      firebaseAdmin.privateProject.firestoreConfigured,
    firebaseApplicationConfigured: firebaseAdmin.applicationProject.adminConfigured,
    firebase: {
      projectA: projectAStatus,
      projectB: projectBStatus,
      privateProject: {
        ...firebaseAdmin.privateProject,
        firestoreConfigured: privateFirestore.configured,
        firestoreConnected: privateFirestore.connected
      },
      applicationProject: {
        ...firebaseAdmin.applicationProject,
        firestoreConfigured: applicationFirestore.configured,
        firestoreConnected: applicationFirestore.connected
      }
    },
    firestoreConfigured: conversationStorage.configured,
    firestoreConnected: conversationStorage.connected,
    conversationStorage,
    ollamaStatus: {
      configured: (process.env.AI_PROVIDER || 'ollama').toLowerCase() === 'ollama',
      connected: ollama.connected,
      textModelInstalled: ollama.textModelInstalled,
      visionModelInstalled: ollama.visionModelInstalled
    },
    ollama: ollama.connected ? 'connected' : 'disconnected',
    textModel: ollama.textModelInstalled ? 'installed' : 'unavailable',
    visionModel: ollama.visionModelInstalled ? 'installed' : 'unavailable',
    ai: {
      gemini: { configured: aiStatus.geminiConfigured },
      imageAnalysis: { configured: aiStatus.geminiVisionConfigured, reachable: null },
      live: { configured: aiStatus.liveConfigured, model: aiStatus.liveModel }
    },
    cloudinary: cloudinaryImageService.status(),
    voice: {
      stt: voiceStatus.stt,
      tts: voiceStatus.tts
    }
  });
});

app.get('/api/voice-config', requireFirebaseFarmer, (req, res) => {
  const voiceStatus = elevenLabsService.getStatus();
  return res.json({
    success: true,
    maxRecordingSeconds: getAIConfig().voiceMaxRecordingSeconds,
    languages: Object.values(LANGUAGES).map(({ languageCode, languageName }) => ({
      languageCode,
      languageName
    })),
    stt: voiceStatus.stt,
    tts: voiceStatus.tts
  });
});

app.get('/api/geocode', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2) {
    return res.status(400).json({ success: false, message: 'Enter at least 2 characters to search for a location.' });
  }

  try {
    const providerUrl = new URL('https://nominatim.openstreetmap.org/search');
    providerUrl.searchParams.set('format', 'jsonv2');
    providerUrl.searchParams.set('q', query);
    providerUrl.searchParams.set('limit', '5');
    providerUrl.searchParams.set('addressdetails', '1');
    if (process.env.NOMINATIM_CONTACT_EMAIL) {
      providerUrl.searchParams.set('email', process.env.NOMINATIM_CONTACT_EMAIL);
    }

    await waitForGeocodeSlot();
    const providerResponse = await fetch(providerUrl, {
      headers: { 'User-Agent': 'AgriShield-AI/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!providerResponse.ok) {
      console.error(`[AgriShield Geocoding] Nominatim returned HTTP ${providerResponse.status}.`);
      return res.status(providerResponse.status === 429 ? 429 : 502).json({
        success: false,
        message: providerResponse.status === 429
          ? 'Location search is temporarily rate limited. Please wait a moment and try again.'
          : 'The location service is temporarily unavailable. Please try again.'
      });
    }

    const providerResults = await providerResponse.json();
    const results = Array.isArray(providerResults)
      ? providerResults.map((item) => ({
        displayName: typeof item.display_name === 'string' ? item.display_name : '',
        latitude: Number(item.lat),
        longitude: Number(item.lon)
      })).filter((item) =>
        item.displayName &&
        Number.isFinite(item.latitude) &&
        Number.isFinite(item.longitude) &&
        item.latitude >= -90 && item.latitude <= 90 &&
        item.longitude >= -180 && item.longitude <= 180
      )
      : [];

    return res.json({ success: true, results });
  } catch (error) {
    console.error('[AgriShield Geocoding] Provider request failed:', error.message);
    return res.status(502).json({
      success: false,
      message: 'Unable to search locations right now. Check your connection and try again.'
    });
  }
});

app.post('/api/auth/bootstrap', requireFirebaseIdentity, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.info(`[AgriShield Account Sync] Starting UID-backed Firestore synchronization. uid=${req.firebaseUid}`);
    }
    const farmer = await syncFirebaseAccount(req.firebaseUser, req.body?.farmerName);
    const profile = await getFarmerProfile(farmer._id);
    if (!profile) {
      console.warn(`[AgriShield Account Sync] Profile missing after sync. uid=${req.firebaseUid}`);
      return res.status(503).json({
        success: false,
        message: 'The Firebase account is verified, but its AgriShield farmer profile could not be loaded.'
      });
    }
    if (process.env.NODE_ENV === 'development') {
      console.info(`[AgriShield Account Sync] Account synchronized successfully. uid=${req.firebaseUid}, farmerId=${farmer._id}`);
    }
    return res.json({
      success: true,
      firebaseUid: req.firebaseUid,
      farmerId: farmer._id,
      data: profile
    });
  } catch (error) {
    console.error('[AgriShield Auth] Account synchronization failed:', {
      uid: req.firebaseUid,
      code: error.code || error.name || 'sync_error',
      message: error.message
    });
    const status = error.statusCode || 503;
    return res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || (status === 400 ? 'ACCOUNT_SYNC_FAILED' : 'FARM_DATA_UNAVAILABLE'),
      message: error.statusCode === 400 || error.statusCode === 503
        ? error.message
        : 'Your Firebase account could not be synchronized with AgriShield. Please retry.'
    });
  }
});

app.post('/api/auth/active-farm', requireFirebaseIdentity, async (req, res) => {
  const farmId = typeof req.body?.farmId === 'string' ? req.body.farmId.trim() : '';
  if (!farmId) {
    return res.status(400).json({ success: false, code: 'FARM_ID_REQUIRED', message: 'Choose one of your farms.' });
  }
  if (!firestoreRepository.isPrivateConfigured() || !firestoreRepository.isConfigured()) {
    return res.status(503).json({
      success: false,
      code: 'APPLICATION_FIRESTORE_UNAVAILABLE',
      message: 'Farm application data is temporarily unavailable. Your sign-in remains active; please retry.'
    });
  }
  try {
    const ownedFarm = await firestoreRepository.getOwnedFarm(req.firebaseUid, farmId);
    if (!ownedFarm) {
      return res.status(403).json({
        success: false,
        code: 'FARM_ACCESS_DENIED',
        message: 'This farm is not available to your account.'
      });
    }
    const profile = await getFarmerProfile(req.firebaseUid, farmId);
    if (!profile?.farm) {
      return res.status(403).json({
        success: false,
        code: 'FARM_ACCESS_DENIED',
        message: 'This farm is not available to your account.'
      });
    }
    if (!await firestoreRepository.setUserActiveFarmId(req.firebaseUid, farmId)) {
      return res.status(403).json({
        success: false,
        code: 'FARM_ACCESS_DENIED',
        message: 'This farm is not available to your account.'
      });
    }
    return res.json({ success: true, data: profile });
  } catch (error) {
    console.error('[AgriShield Farm Switch] Farm selection failed:', error.code || error.name || 'farm_switch_error');
    return res.status(503).json({
      success: false,
      code: 'FARM_DATA_UNAVAILABLE',
      message: 'The selected farm could not be loaded. Your current farm selection has not changed.'
    });
  }
});

app.delete('/api/account', requireFirebaseIdentity, requireRecentFirebaseIdentity, async (req, res) => {
  try {
    await accountDeletionService.deleteAccount(req.firebaseUid);
    return res.json({ success: true });
  } catch (error) {
    console.error('[AgriShield Account Deletion] Deletion failed:', error.code || error.name || 'account_deletion_error');
    return res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || 'ACCOUNT_DELETION_FAILED',
      message: error.statusCode ? error.message : 'Account deletion could not be completed. Please try again.'
    });
  }
});

app.get('/api/system/status', async (req, res) => {
  const ai = providerFactory.getStatus();
  const voiceStatus = elevenLabsService.getStatus();
  const conversationStorage = await conversationStorageService.checkHealth();
  const firebaseAdmin = getFirebaseAdminRuntimeStatus();
  const [privateFirestore, applicationFirestore] = await Promise.all([
    firestoreRepository.checkPrivateHealth(),
    firestoreRepository.checkHealth()
  ]);
  let ollama = null;
  if (ai.provider === 'ollama') {
    try {
      ollama = await providerFactory.getProvider('ollama').checkHealth();
    } catch (error) {
      console.error('[AgriShield System Status] Ollama health check failed:', error.code || error.name || 'provider_error');
      ollama = { connected: false, textModelInstalled: false, visionModelInstalled: false };
    }
  }
  const projectAStatus = {
    projectId: firebaseAdmin.privateProject.projectId,
    adminConfigured: firebaseAdmin.privateProject.adminConfigured,
    authConfigured: firebaseAdmin.privateProject.authConfigured,
    firestoreConfigured: privateFirestore.configured,
    firestoreConnected: privateFirestore.connected,
    authConfigurationError: firebaseAdmin.privateProject.authConfigurationError ||
      (firebaseAdmin.privateProject.authConfigured ? null : getFirebaseAdminConfigurationError()),
    firestoreConfigurationError: firebaseAdmin.privateProject.firestoreConfigurationError ||
      (privateFirestore.configured ? null : getPrivateFirestoreConfigurationError())
  };
  const projectBStatus = {
    projectId: firebaseAdmin.applicationProject.projectId,
    adminConfigured: firebaseAdmin.applicationProject.adminConfigured,
    firestoreConfigured: applicationFirestore.configured,
    firestoreConnected: applicationFirestore.connected,
    configurationError: firebaseAdmin.applicationProject.adminConfigured
      ? null
      : getApplicationFirebaseAdminConfigurationError()
  };
  return res.json({
    success: true,
    status: {
      aiProvider: ai.provider,
      aiConfigured: ai.provider === 'ollama'
        ? Boolean(ollama?.connected && ollama.textModelInstalled)
        : ai.isConfigured,
      localAiBaseUrl: ai.localBaseUrl,
      ollamaConnected: ollama?.connected || false,
      textModel: ai.model,
      geminiTextModel: ai.provider === 'gemini' ? ai.model : null,
      geminiVisionModel: ai.provider === 'gemini' ? ai.visionModel : null,
      geminiLiveModel: ai.liveModel,
      geminiConfigured: ai.provider === 'gemini' ? ai.isConfigured : Boolean(process.env.GEMINI_API_KEY),
      geminiLiveConfigured: ai.liveConfigured,
      ai: {
        gemini: { configured: ai.geminiConfigured, provider: 'google-gemini' },
        imageAnalysis: { configured: ai.geminiVisionConfigured, reachable: null },
        live: { configured: ai.liveConfigured, model: ai.liveModel }
      },
      cloudinary: cloudinaryImageService.status(),
      voice: {
        stt: voiceStatus.stt,
        tts: voiceStatus.tts
      },
      geminiVisionModel: ai.geminiVisionModel,
      geminiVisionConfigured: ai.geminiVisionConfigured,
      textModelInstalled: ollama?.textModelInstalled || false,
      visionModel: ai.visionModel,
      visionModelInstalled: ollama?.visionModelInstalled || false,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      firebaseAdmin: {
        projectA: projectAStatus,
        projectB: projectBStatus,
        privateProject: { ...firebaseAdmin.privateProject, firestoreConfigured: privateFirestore.configured, firestoreConnected: privateFirestore.connected },
        applicationProject: { ...firebaseAdmin.applicationProject, firestoreConfigured: applicationFirestore.configured, firestoreConnected: applicationFirestore.connected }
      },
      firebaseAdminConfigured: firebaseAdmin.configured,
      firebaseAdminConfigurationError: firebaseAdmin.errorCode || getFirebaseAdminConfigurationError(),
      authentication: {
        emailPassword: true,
        firebaseIdentity: true
      },
      firebasePrivateConfigured: firebaseAdmin.privateProject.authConfigured &&
        privateFirestore.configured,
      firebaseApplicationConfigured: firebaseAdmin.applicationProject.adminConfigured,
      firestoreConfigured: conversationStorage.configured,
      firestoreConnected: conversationStorage.connected,
      conversationStorage,
      ollamaStatus: {
        configured: ai.provider === 'ollama',
        connected: ollama?.connected || false,
        textModelInstalled: ollama?.textModelInstalled || false,
        visionModelInstalled: ollama?.visionModelInstalled || false
      },
      ttsProvider: ai.ttsProvider,
      ttsConfigured: ai.ttsConfigured,
      sttProvider: ai.sttProvider,
      sttConfigured: ai.sttConfigured,
      maxVoiceRecordingSeconds: require('./services/ai/aiConfig').getAIConfig().voiceMaxRecordingSeconds,
      weatherProvider: ai.weatherProvider
    }
  });
});

app.get('/api/session', requireFirebaseFarmer, async (req, res) => {
  try {
    const profile = await getFarmerProfile(req.farmerId, req.farmId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Farmer profile could not be loaded.' });
    }
    return res.json({ success: true, authenticated: true, profile });
  } catch (error) {
    console.error('[AgriShield Auth] Could not load the authenticated farmer profile:', error.code || error.name || 'profile_error');
    return res.status(503).json({
      success: false,
      message: 'Unable to load your account right now. Please try again.'
    });
  }
});

app.get('/api/weather', requireFirebaseFarmer, requireActiveFarm, async (req, res) => {
  try {
    const weather = await weatherService.getCurrentWeather(
      req.farmData.farmLocation || null,
      { includeNearbyRain: true }
    );
    return res.json({
      success: true,
      weather: {
        ...weather,
        sourceStatus: weatherService.getSourceStatus()
      }
    });
  } catch (error) {
    console.error('[AgriShield Weather] Current weather request failed:', error.message);
    return res.status(502).json({
      success: false,
      message: 'Weather information is temporarily unavailable.',
      timezone: resolveFarmTimeZone(req.farmData.farmLocation || {})
    });
  }
});

app.get('/api/notifications', requireFirebaseFarmer, requireActiveFarm, async (req, res) => {
  try {
    const records = await firestoreRepository.getUserNotifications(req.farmerId, req.farmId);
    const notifications = records.map((record) => {
      const createdAt = record.createdAt?.toDate instanceof Function
        ? record.createdAt.toDate().toISOString()
        : record.createdAt instanceof Date
          ? record.createdAt.toISOString()
          : record.createdAt || null;
      const updatedAt = record.updatedAt?.toDate instanceof Function
        ? record.updatedAt.toDate().toISOString()
        : record.updatedAt instanceof Date
          ? record.updatedAt.toISOString()
          : record.updatedAt || null;
      return {
        id: record._id,
        type: String(record.type || 'farm'),
        title: String(record.title || ''),
        message: String(record.message || ''),
        severity: String(record.severity || 'info'),
        read: record.read === true,
        createdAt,
        ...(updatedAt ? { updatedAt } : {})
      };
    });
    return res.json({ success: true, notifications });
  } catch (error) {
    console.error('[AgriShield Notifications] Could not load farmer notifications:', error.code || error.name || 'notification_list_error');
    return res.status(503).json({
      success: false,
      message: 'Notifications are temporarily unavailable. Please try again.'
    });
  }
});

app.patch('/api/notifications/:id/read', requireFirebaseFarmer, requireActiveFarm, async (req, res) => {
  const notificationId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  if (!notificationId) {
    return res.status(400).json({ success: false, message: 'A notification ID is required.' });
  }
  try {
    const updated = await firestoreRepository.markNotificationAsRead(req.farmerId, req.farmId, notificationId);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Notification was not found.' });
    }
    return res.json({ success: true, id: notificationId, read: true });
  } catch (error) {
    console.error('[AgriShield Notifications] Could not update farmer notification:', error.code || error.name || 'notification_update_error');
    return res.status(503).json({
      success: false,
      message: 'This notification could not be updated. Please try again.'
    });
  }
});

app.get('/api/farms/:farmId/crop-schedule', requireFirebaseFarmer, requireActiveFarm, async (req, res) => {
  try {
    const farm = req.farmData;

    const crop = farm.cropDetails?.name || farm.crop;
    const protocol = crop ? await firestoreRepository.getCropProtocol(crop, farm.cropDetails?.variety) : null;
    const statuses = crop && protocol?.enabled === true
      ? await firestoreRepository.getFarmActivityStatuses(req.farmerId, farm._id)
      : [];
    const schedule = buildCropSchedule({
      farm,
      protocol,
      activityStatuses: statuses,
      timeZone: typeof req.query.timeZone === 'string' ? req.query.timeZone : 'UTC'
    });
    const data = {
      ...schedule,
      activities: schedule.activities.map((activity) => ({
        ...activity,
        completedAt: activity.completedAt?.toDate instanceof Function
          ? activity.completedAt.toDate().toISOString()
          : activity.completedAt instanceof Date
            ? activity.completedAt.toISOString()
            : activity.completedAt || null
      }))
    };
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[AgriShield Crop Schedule] Could not load schedule:', error.code || error.message);
    return res.status(503).json({
      success: false,
      message: 'Crop schedule is temporarily unavailable. Please try again.'
    });
  }
});

app.post('/api/farms/:farmId/activity/:activityId/status', requireFirebaseFarmer, requireActiveFarm, async (req, res) => {
  const { scheduledDate, status } = req.body || {};
  if (!parseDateOnly(scheduledDate)) {
    return res.status(400).json({ success: false, message: 'A valid scheduled date is required.' });
  }
  if (!SAVED_ACTIVITY_STATUSES.has(status)) {
    return res.status(400).json({
      success: false,
      message: 'Activity status must be COMPLETED, NOT_YET, or SKIPPED.'
    });
  }

  try {
    const farm = req.farmData;
    const crop = farm.cropDetails?.name || farm.crop;
    const protocol = crop ? await firestoreRepository.getCropProtocol(crop, farm.cropDetails?.variety) : null;
    if (!protocol || protocol.enabled !== true) {
      return res.status(404).json({ success: false, message: 'No approved crop schedule is configured for this crop.' });
    }
    const schedule = buildCropSchedule({
      farm,
      protocol,
      timeZone: typeof req.body.timeZone === 'string' ? req.body.timeZone : 'UTC'
    });
    const activity = schedule.activities.find((entry) =>
      entry.id === req.params.activityId && entry.scheduledDate === scheduledDate
    );
    if (!activity) {
      return res.status(400).json({ success: false, message: 'The scheduled activity does not match the configured crop protocol.' });
    }

    const record = await firestoreRepository.setFarmActivityStatus({
      farmerId: req.farmerId,
      farmId: farm._id,
      cropId: protocol._id || cropKey(crop),
      activityId: activity.id,
      scheduledDate,
      status
    });
    return res.json({
      success: true,
      activity: {
        activityId: record.activityId,
        farmId: record.farmId,
        cropId: record.cropId,
        scheduledDate: record.scheduledDate,
        status: record.status,
        completedAt: record.completedAt?.toDate instanceof Function
          ? record.completedAt.toDate().toISOString()
          : record.completedAt instanceof Date
            ? record.completedAt.toISOString()
            : record.completedAt || null
      }
    });
  } catch (error) {
    console.error('[AgriShield Crop Schedule] Could not update activity:', error.code || error.message);
    return res.status(503).json({
      success: false,
      message: 'Activity status could not be saved. Please try again.'
    });
  }
});

app.get('/api/shop/products', requireFirebaseFarmer, async (req, res) => {
  let category;
  try {
    category = normalizeCategory(req.query.category);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }

  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 24);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return res.status(400).json({ success: false, message: 'Page must be positive and page size must be between 1 and 100.' });
  }

  try {
    const products = filterProducts(await firestoreRepository.getActiveProducts(), {
      category,
      crop: typeof req.query.crop === 'string' ? req.query.crop : '',
      variety: typeof req.query.variety === 'string' ? req.query.variety : '',
      stage: typeof req.query.stage === 'string' ? req.query.stage : '',
      query: typeof req.query.query === 'string' ? req.query.query : ''
    });
    const start = (page - 1) * pageSize;
    return res.json({
      success: true,
      products: products.slice(start, start + pageSize).map(serializeProduct),
      pagination: {
        page,
        pageSize,
        total: products.length,
        hasMore: start + pageSize < products.length
      }
    });
  } catch (error) {
    console.error('[AgriShield Shop] Could not load products:', error.code || error.message);
    return res.status(error.statusCode || 503).json({
      success: false,
      message: error.statusCode === 400 ? error.message : 'Products are temporarily unavailable. Please try again.'
    });
  }
});

app.get('/api/shop/products/:id', requireFirebaseFarmer, async (req, res) => {
  try {
    const product = await firestoreRepository.getActiveProduct(req.params.id);
    if (!product || !['seed', 'fertilizer'].includes(String(product.category || '').toLowerCase().replace(/s$/, ''))) {
      return res.status(404).json({ success: false, message: 'Product was not found.' });
    }
    return res.json({ success: true, product: serializeProduct(product) });
  } catch (error) {
    console.error('[AgriShield Shop] Could not load product details:', error.code || error.message);
    return res.status(503).json({ success: false, message: 'Product details are temporarily unavailable.' });
  }
});

app.get('/api/weather/radar', requireFirebaseFarmer, async (req, res) => {
  try {
    const radar = await rainViewerService.getRecentRadarFrame();
    return res.json({ success: true, radar });
  } catch (error) {
    console.warn('[AgriShield Radar] Recent radar metadata unavailable:', error.message);
    return res.json({
      success: true,
      radar: {
        available: false,
        provider: 'RainViewer',
        status: 'unavailable',
        message: 'Radar data is unavailable for this area right now.'
      }
    });
  }
});

app.post('/api/profile/update-mobile', requireFirebaseFarmer, async (req, res) => {
  const mobile = typeof req.body?.mobile === 'string' ? req.body.mobile.trim() : '';
  try {
    const existing = await firestoreRepository.getUser(req.farmerId);
    if (!existing) return res.status(404).json({ success: false, message: 'Farmer profile not found.' });
    await firestoreRepository.createOrUpdateUser(req.farmerId, {
      phone: mobile || null,
      mobileVerified: Boolean(mobile)
    });
    return res.json({ success: true, message: 'Mobile number updated.', mobile });
  } catch (error) {
    console.error('[AgriShield Auth] Mobile update failed:', error.code || error.name || 'mobile_update_error');
    return res.status(503).json({ success: false, message: 'The mobile number could not be updated. Please retry.' });
  }
});

// 4. Save Farm Profile Endpoint
app.post('/api/save-farm-profile', requireFirebaseFarmer, async (req, res) => {
  let createdFarmId = null;
  let createdOwnership = false;
  try {
    if (!firestoreRepository.isConfigured()) {
      return res.status(503).json({
        success: false,
        code: 'APPLICATION_FIRESTORE_UNAVAILABLE',
        message: 'Farm location could not be saved because application data storage is unavailable. Your sign-in remains active; retry after the service is configured.'
      });
    }
    const { farmerName, farm, verifiedMobile } = req.body;
    const userId = req.farmerId;
    if (!farmerName || !farmerName.trim()) {
      return res.status(400).json({ success: false, message: 'Farmer name is required' });
    }

    const storedUser = await firestoreRepository.getUser(userId);
    if (!storedUser) {
      return res.status(401).json({
        success: false,
        message: 'Your verified farmer account could not be confirmed. Please sign in again.'
      });
    }

    const candidateMobile = typeof verifiedMobile === 'string' && verifiedMobile.trim()
      ? verifiedMobile.trim()
      : typeof req.body?.mobile === 'string' && req.body.mobile.trim()
        ? req.body.mobile.trim()
        : null;
    if (candidateMobile && candidateMobile !== storedUser.phone) {
      await firestoreRepository.createOrUpdateUser(userId, { phone: candidateMobile });
    }

    // Validate location & boundary
    const location = farm?.location || farm?.farmLocation;
    const boundaryPoints = farm?.boundary?.points || farm?.farmBoundary || [];

    const latitude = Number(location?.lat ?? location?.latitude);
    const longitude = Number(location?.lng ?? location?.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Precise farm location coordinates (latitude and longitude) are required'
      });
    }

    const distinctBoundaryPoints = Array.isArray(boundaryPoints)
      ? boundaryPoints.filter((point, index, list) => {
          const current = Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point?.lat ?? point?.latitude), Number(point?.lng ?? point?.longitude)];
          if (!Number.isFinite(current[0]) || !Number.isFinite(current[1])) return false;
          const duplicateOfExisting = list.slice(0, index).some((existingPoint) => {
            const other = Array.isArray(existingPoint)
              ? [Number(existingPoint[0]), Number(existingPoint[1])]
              : [Number(existingPoint?.lat ?? existingPoint?.latitude), Number(existingPoint?.lng ?? existingPoint?.longitude)];
            return Number.isFinite(other[0]) && Number.isFinite(other[1]) &&
              Number(other[0].toFixed(6)) === Number(current[0].toFixed(6)) &&
              Number(other[1].toFixed(6)) === Number(current[1].toFixed(6));
          });
          return !duplicateOfExisting;
        })
      : [];

    if (distinctBoundaryPoints.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Farm boundary must contain at least 3 distinct points.'
      });
    }

    let geometry;
    try {
      geometry = normalizeFarmBoundary(distinctBoundaryPoints);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    const optionalText = (value) =>
      typeof value === 'string' && value.trim() ? value.trim() : null;
    const waterSource = optionalText(
      farm?.waterSource ||
      (typeof farm?.water === 'string' ? farm.water : farm?.water?.source || farm?.water?.otherSource)
    );
    const submittedLocation = farm?.location || farm?.farmLocation || {};
    const timezone = resolveFarmTimeZone({
      ...submittedLocation,
      latitude,
      longitude
    });
    const savedLocation = {
      latitude,
      longitude,
      timezone,
      displayName: optionalText(submittedLocation.displayName),
      village: optionalText(submittedLocation.village),
      district: optionalText(submittedLocation.district),
      state: optionalText(submittedLocation.state),
      country: optionalText(submittedLocation.country)
    };

    // Crop & Soil details (strictly optional — do NOT invent fake data if empty)
    const cropName = optionalText(farm?.cropDetails?.name || farm?.crop);
    const cropVariety = optionalText(farm?.cropDetails?.variety || farm?.variety);
    const cropStage = optionalText(farm?.cropDetails?.stage || farm?.stage);
    const cropPlanting = optionalText(farm?.cropDetails?.plantingDate || farm?.plantingDate);
    const cropHarvest = optionalText(farm?.cropDetails?.harvestDate || farm?.harvestDate);

    const cropDetails = cropName ? {
      name: cropName,
      variety: cropVariety,
      stage: cropStage,
      plantingDate: cropPlanting || null,
      harvestDate: cropHarvest || null
    } : null;

    const soilType = optionalText(farm?.soilDetails?.type || farm?.soilType);
    const soilDetails = (soilType && soilType !== "Don't Know") ? {
      type: soilType
    } : null;

    const area = {
      acres: (geometry.areaSqMeters / 4046.8564224).toFixed(2),
      hectares: (geometry.areaSqMeters / 10000).toFixed(4),
      sqMeters: Math.round(geometry.areaSqMeters),
      perimeterMeters: Math.round(geometry.perimeterMeters),
      lengthMeters: Math.round(geometry.lengthMeters),
      widthMeters: Math.round(geometry.widthMeters)
    };

    const requestedFarmId = typeof farm?._id === 'string' && farm._id.trim() ? farm._id.trim() : null;
    if (requestedFarmId && !await firestoreRepository.getOwnedFarm(userId, requestedFarmId)) {
      return res.status(403).json({
        success: false,
        code: 'FARM_ACCESS_DENIED',
        message: 'This farm cannot be updated from your account.'
      });
    }
    const farmId = requestedFarmId || crypto.randomUUID();
    const isNewFarm = !requestedFarmId;
    const normalizedBoundary = geometry.points;

    await firestoreRepository.createOrUpdateUser(userId, {
      name: farmerName.trim(),
      ...(candidateMobile !== null ? { phone: candidateMobile, mobileVerified: Boolean(candidateMobile) } : {})
    });

    await firestoreRepository.saveFarm(userId, farmId, {
      name: optionalText(farm?.name) || 'My Farm',
      location: savedLocation,
      boundary: normalizedBoundary,
      area,
      crop: cropDetails?.name || null,
      cropDetails,
      soilDetails,
      waterSource
    });
    if (isNewFarm) createdFarmId = farmId;
    await firestoreRepository.setFarmOwnership(userId, farmId, {
      name: optionalText(farm?.name) || 'My Farm',
      locationSummary: savedLocation.displayName,
      areaSummary: area.acres
    });
    if (isNewFarm) createdOwnership = true;
    if (!await firestoreRepository.setUserActiveFarmId(userId, farmId)) {
      throw new Error('The farm ownership relationship could not be activated.');
    }

    console.log('[AgriShield] Farmer profile and farm saved successfully.');

    // Return full structured response matching frontend state expectations
    const savedData = {
      userId,
      farmerName: farmerName.trim(),
      verifiedMobile: candidateMobile || storedUser.phone || '',
      mobile: candidateMobile || storedUser.phone || '',
      activeFarmId: farmId,
      farms: (await firestoreRepository.getFarmerFarms(userId)).map((ownedFarm) => ({
        farmId: ownedFarm._id,
        name: ownedFarm.name || 'My Farm',
        areaAcres: ownedFarm.area?.acres || null,
        locationSummary: ownedFarm.farmLocation?.displayName || null
      })),
      applicationDataAvailable: true,
      farm: {
        name: optionalText(farm?.name) || 'My Farm',
        farmLocation: savedLocation,
        _id: farmId,
        location: {
          lat: latitude,
          lng: longitude
        },
        boundary: {
          points: normalizedBoundary.map(p => [p.lat, p.lng]),
          areaAcres: area.acres,
          areaSqMeters: area.sqMeters,
          perimeterMeters: area.perimeterMeters,
          lengthMeters: area.lengthMeters,
          widthMeters: area.widthMeters
        },
        area,
        crop: cropDetails ? cropDetails.name : null,
        variety: cropDetails ? cropDetails.variety : null,
        soilType: soilDetails ? soilDetails.type : null,
        cropDetails,
        soilDetails,
        waterSource,
        water: waterSource ? { source: waterSource, otherSource: waterSource } : null
      }
    };

    queueFarmDataRefresh({
      farmId,
      location: savedLocation
    });

    return res.json({
      success: true,
      message: 'Farm profile saved successfully',
      data: savedData
    });
  } catch (error) {
    if (createdFarmId) {
      try {
        if (createdOwnership) await firestoreRepository.deleteFarmOwnership(req.farmerId, createdFarmId);
        await firestoreRepository.deleteFarmForUser(req.farmerId, createdFarmId);
      } catch (cleanupError) {
        console.error('[AgriShield Farm Setup] Incomplete farm rollback failed:', cleanupError.code || cleanupError.name || 'farm_rollback_error');
      }
    }
    console.error('[AgriShield] Failed to save farm profile:', error.code || error.name || 'farm_save_error');
    return res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || 'FARM_SAVE_FAILED',
      message: error.statusCode ? error.message : 'Unable to save your farm details right now. Please try again.'
    });
  }
});

// 5. Get Farm Profile Endpoint
app.get('/api/farm-profile/:userId', requireFirebaseFarmer, async (req, res) => {
  const { userId } = req.params;
  if (userId !== req.farmerId) {
    return res.status(403).json({ success: false, message: 'You cannot view another farmer account.' });
  }

  try {
    const responseData = await getFarmerProfile(userId, req.farmId);
    if (!responseData) {
      return res.status(404).json({ success: false, message: 'Farm profile not found in Firestore' });
    }
    return res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('[AgriShield] Error fetching farm profile:', error.code || error.name || 'farm_profile_error');
    return res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || 'FARM_DATA_UNAVAILABLE',
      message: 'Unable to retrieve farm details right now. Please try again.'
    });
  }
});

// 6. Farm Twin 3D State Endpoint
app.get('/api/farms/:id/farm-twin', requireFirebaseFarmer, requireActiveFarm, async (req, res) => {
  try {
    const farmDoc = req.farmData;

    let weatherContext = null;
    try {
      weatherContext = await weatherService.getCurrentWeather(farmDoc?.farmLocation);
    } catch (error) {
      console.warn('[AgriShield Farm Twin] Weather could not be retrieved:', error.message);
      weatherContext = {
        available: false,
        status: 'unavailable',
        data: null,
        sources: [],
        timezone: resolveFarmTimeZone(farmDoc?.farmLocation || {})
      };
    }
    const twinState = getFarmEnvironmentState(farmDoc, {
      weatherData: weatherContext
    });

    return res.json({
      success: true,
      data: twinState
    });
  } catch (error) {
    console.error('[AgriShield] Failed to generate Farm Twin:', error.code || error.name || 'farm_twin_error');
    return res.status(503).json({
      success: false,
      message: 'Unable to load this farm’s Farm Twin right now. Please retry.'
    });
  }
});

// ==========================================
// AGRISHIELD-AI — MULTIMODAL CONVERSATIONAL AI ENGINE
// ==========================================
const aiRouter = require('./routes/ai');
app.use('/api/ai', aiRouter);
app.use('/api/support', require('./routes/support'));

app.listen(PORT, () => {
  console.log(`AgriShield backend listening on port ${PORT}`);
  const status = providerFactory.getStatus();
  void (async () => {
    const firebaseAdmin = getFirebaseAdminRuntimeStatus();
    const [privateFirestore, applicationFirestore] = await Promise.all([
      firestoreRepository.checkPrivateHealth(),
      firestoreRepository.checkHealth()
    ]);
    console.log('[AgriShield Configuration]', {
      aiProvider: status.provider,
      aiConfigured: status.isConfigured,
      privateFirebaseProjectId: firebaseAdmin.privateProject.projectId,
      privateFirebaseConfigured: firebaseAdmin.privateProject.configured,
      privateFirestoreConnected: privateFirestore.connected,
      applicationFirebaseProjectId: firebaseAdmin.applicationProject.projectId,
      applicationFirebaseConfigured: firebaseAdmin.applicationProject.configured,
      applicationFirestoreConnected: applicationFirestore.connected,
      ttsConfigured: status.ttsConfigured,
      weatherProvider: status.weatherProvider
    });
  })();
  if (status.provider === 'ollama' && process.env.OLLAMA_PREWARM !== 'false') {
    console.log('[AgriShield Ollama] Warming the configured text model in the background.');
    void providerFactory.getProvider('ollama').warmup()
      .then((ready) => {
        if (ready) console.log('[AgriShield Ollama] Text model is warm and ready.');
        else console.warn('[AgriShield Ollama] Text model warm-up skipped; Ollama or the model is unavailable.');
      })
      .catch((error) => {
        console.warn('[AgriShield Ollama] Text model warm-up failed:', error.message);
      });
  }
});
