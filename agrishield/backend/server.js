const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getFarmEnvironmentState } = require('./services/farmTwinService');
const weatherService = require('./services/weatherService');
const rainViewerService = require('./services/rainViewerService');
const { queueFarmDataRefresh } = require('./services/farmDataRefreshService');
const { normalizeFarmBoundary } = require('./utils/farmGeometry');
const {
  requireFirebaseFarmer,
  requireFirebaseIdentity,
  requireRecentFirebaseIdentity
} = require('./middleware/firebaseAuth');
const {
  getFirebaseAdminConfigurationError,
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

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by the AgriShield API.'));
  },
  credentials: true
}));
app.use(express.json());

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
  if ((process.env.AI_PROVIDER || 'ollama').toLowerCase() === 'ollama') {
    try {
      ollama = await providerFactory.getProvider('ollama').checkHealth();
    } catch (error) {
      console.error('[AgriShield Health] Ollama status check failed:', { code: error.code || 'provider_error' });
    }
  }
  const firebaseAdmin = getFirebaseAdminRuntimeStatus();
  const conversationStorage = await conversationStorageService.checkHealth();
  const aiReady = (process.env.AI_PROVIDER || 'ollama').toLowerCase() !== 'ollama' ||
    (ollama.connected && ollama.textModelInstalled);
  const storageReady = conversationStorage.connected;
  return res.status(aiReady && storageReady ? 200 : 503).json({
    server: 'ok',
    firebaseAdmin: firebaseAdmin.configured ? 'configured' : 'not_configured',
    firestoreConfigured: conversationStorage.configured,
    firestoreConnected: conversationStorage.connected,
    conversationStorage,
    ollama: ollama.connected ? 'connected' : 'disconnected',
    textModel: ollama.textModelInstalled ? 'installed' : 'unavailable',
    visionModel: ollama.visionModelInstalled ? 'installed' : 'unavailable'
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
      console.info('[AgriShield Account Sync] Starting UID-backed Firestore synchronization.');
    }
    const farmer = await syncFirebaseAccount(req.firebaseUser, req.body?.farmerName);
    const profile = await getFarmerProfile(farmer._id);
    if (!profile) {
      return res.status(503).json({
        success: false,
        message: 'The Firebase account is verified, but its AgriShield farmer profile could not be loaded.'
      });
    }
    if (process.env.NODE_ENV === 'development') {
      console.info('[AgriShield Account Sync] Firestore user and farm profile loaded.');
    }
    return res.json({
      success: true,
      firebaseUid: req.firebaseUid,
      farmerId: farmer._id,
      data: profile
    });
  } catch (error) {
    console.error('[AgriShield Auth] Account synchronization failed:', error.code || error.name || 'sync_error');
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
  const ttsProvider = process.env.AI_TTS_PROVIDER || 'google-cloud';
  const conversationStorage = await conversationStorageService.checkHealth();
  const firebaseAdmin = getFirebaseAdminRuntimeStatus();
  let ollama = null;
  if (ai.provider === 'ollama') {
    ollama = await providerFactory.getProvider('ollama').checkHealth();
  }
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
      textModelInstalled: ollama?.textModelInstalled || false,
      visionModel: ai.visionModel,
      visionModelInstalled: ollama?.visionModelInstalled || false,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      firebaseAdminConfigured: firebaseAdmin.configured,
      firebaseAdminConfigurationError: firebaseAdmin.errorCode || getFirebaseAdminConfigurationError(),
      firestoreConfigured: conversationStorage.configured,
      firestoreConnected: conversationStorage.connected,
      conversationStorage,
      ttsProvider,
      ttsConfigured: ai.ttsConfigured,
      weatherProvider: ai.weatherProvider
    }
  });
});

app.get('/api/session', requireFirebaseFarmer, async (req, res) => {
  try {
    const profile = await getFarmerProfile(req.farmerId);
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

app.get('/api/weather', requireFirebaseFarmer, async (req, res) => {
  try {
    const profile = await getFarmerProfile(req.farmerId);
    const weather = await weatherService.getCurrentWeather(
      profile?.farm?.farmLocation || null,
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
      message: 'Weather information is temporarily unavailable.'
    });
  }
});

app.get('/api/notifications', requireFirebaseFarmer, async (req, res) => {
  try {
    const records = await firestoreRepository.getUserNotifications(req.farmerId);
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

app.patch('/api/notifications/:id/read', requireFirebaseFarmer, async (req, res) => {
  const notificationId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  if (!notificationId) {
    return res.status(400).json({ success: false, message: 'A notification ID is required.' });
  }
  try {
    const updated = await firestoreRepository.markNotificationAsRead(req.farmerId, notificationId);
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

app.get('/api/farms/:farmId/crop-schedule', requireFirebaseFarmer, async (req, res) => {
  try {
    const farm = await firestoreRepository.getFarmForUser(req.farmerId);
    if (!farm || farm._id !== req.params.farmId) {
      return res.status(404).json({ success: false, message: 'Farm information is not configured yet.' });
    }

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

app.post('/api/farms/:farmId/activity/:activityId/status', requireFirebaseFarmer, async (req, res) => {
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
    const farm = await firestoreRepository.getFarmForUser(req.farmerId);
    if (!farm || farm._id !== req.params.farmId) {
      return res.status(404).json({ success: false, message: 'Farm information is not configured yet.' });
    }
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
  const verifiedPhone = req.firebaseUser.phone_number;
  if (typeof verifiedPhone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(verifiedPhone)) {
    return res.status(400).json({
      success: false,
      message: 'The Firebase identity does not contain a verified phone number.'
    });
  }

  try {
    const existing = await firestoreRepository.getUser(req.farmerId);
    if (!existing) return res.status(404).json({ success: false, message: 'Farmer profile not found.' });
    await firestoreRepository.createOrUpdateUser(req.farmerId, {
      phone: verifiedPhone,
      mobileVerified: true
    });
    await getFirebaseAuth().getUser(req.firebaseUid);
    return res.json({ success: true, message: 'Verified mobile number updated.', mobile: verifiedPhone });
  } catch (error) {
    console.error('[AgriShield Auth] Verified mobile update failed:', error.code || error.name || 'mobile_update_error');
    return res.status(503).json({ success: false, message: 'The verified mobile number could not be synchronized. Please retry.' });
  }
});

// 4. Save Farm Profile Endpoint
app.post('/api/save-farm-profile', requireFirebaseFarmer, async (req, res) => {
  try {
    if (!firestoreRepository.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Farm location could not be saved because Firestore is unavailable. Check the backend Firebase configuration and retry.'
      });
    }
    const { farmerName, farm } = req.body;
    const userId = req.farmerId;
    const verifiedMobile = req.firebaseUser.phone_number;
    if (!farmerName || !farmerName.trim()) {
      return res.status(400).json({ success: false, message: 'Farmer name is required' });
    }
    if (typeof verifiedMobile !== 'string' || !/^\+[1-9]\d{7,14}$/.test(verifiedMobile)) {
      return res.status(400).json({ success: false, message: 'Verified mobile number is required' });
    }

    const normalizedMobile = verifiedMobile;
    const storedUser = await firestoreRepository.getUser(userId);
    if (!storedUser || storedUser.mobileVerified === false ||
        (storedUser.phone || storedUser.mobile) !== normalizedMobile) {
      return res.status(401).json({
        success: false,
        message: 'Your verified farmer account could not be confirmed. Please sign in again.'
      });
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
    const savedLocation = {
      latitude,
      longitude,
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

    let farmId = farm?._id || `farm-${userId}`;
    const normalizedBoundary = geometry.points;

    await firestoreRepository.createOrUpdateUser(userId, {
      name: farmerName.trim(),
      phone: normalizedMobile,
      mobileVerified: true
    });

    const existingFarm = await firestoreRepository.getFarmForUser(userId);
    farmId = existingFarm?._id || farmId;
    await firestoreRepository.saveFarm(userId, farmId, {
      location: savedLocation,
      boundary: normalizedBoundary,
      area,
      crop: cropDetails?.name || null,
      cropDetails,
      soilDetails,
      waterSource
    });

    console.log('[AgriShield] Farmer profile and farm saved successfully.');

    // Return full structured response matching frontend state expectations
    const savedData = {
      userId,
      farmerName: farmerName.trim(),
      verifiedMobile,
      farm: {
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
    console.error('[AgriShield] Failed to save farm profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to save your farm details right now. Please try again.'
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
    if (!firestoreRepository.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Farm profile is unavailable because Firestore is disconnected. Check the backend Firebase configuration and network access.'
      });
    }
    const [userDoc, farmDoc] = await Promise.all([
      firestoreRepository.getFarmer(userId),
      firestoreRepository.getFarmForUser(userId)
    ]);

    if (!userDoc && !farmDoc) {
      return res.status(404).json({ success: false, message: 'Farm profile not found in Firestore' });
    }

    const boundaryPoints = farmDoc?.farmBoundary || [];
    const formattedPoints = boundaryPoints.map(p => (Array.isArray(p) ? p : [p.lat, p.lng]));

    const responseData = {
      userId,
      farmerName: userDoc?.name || '',
      verifiedMobile: userDoc?.mobile || '',
      farm: {
        _id: farmDoc?._id || `farm-${userId}`,
        location: farmDoc?.farmLocation ? {
          lat: farmDoc.farmLocation.latitude,
          lng: farmDoc.farmLocation.longitude,
          displayName: farmDoc.farmLocation.displayName || null,
          village: farmDoc.farmLocation.village || null,
          district: farmDoc.farmLocation.district || null,
          state: farmDoc.farmLocation.state || null,
          country: farmDoc.farmLocation.country || null
        } : null,
        boundary: {
          points: formattedPoints,
          areaAcres: farmDoc?.area?.acres || null,
          areaSqMeters: farmDoc?.area?.sqMeters || 0,
          perimeterMeters: farmDoc?.area?.perimeterMeters || 0,
          lengthMeters: farmDoc?.area?.lengthMeters || 0,
          widthMeters: farmDoc?.area?.widthMeters || 0
        },
        area: farmDoc?.area || {},
        crop: farmDoc?.cropDetails?.name || farmDoc?.crop || null,
        variety: farmDoc?.cropDetails?.variety || null,
        soilType: farmDoc?.soilDetails?.type || null,
        cropDetails: farmDoc?.cropDetails || null,
        soilDetails: farmDoc?.soilDetails || null,
        waterSource: farmDoc?.waterSource || null,
        water: {
          source: farmDoc?.waterSource || null,
          otherSource: farmDoc?.waterSource || null
        }
      }
    };

    return res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('[AgriShield] Error fetching farm profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve farm details right now. Please try again.'
    });
  }
});

// 6. Farm Twin 3D State Endpoint
app.get('/api/farms/:id/farm-twin', requireFirebaseFarmer, async (req, res) => {
  const { id } = req.params;

  try {
    if (!firestoreRepository.isConfigured()) {
      return res.status(503).json({ success: false, message: 'Farm data is unavailable because Firestore is disconnected. Check the backend Firebase configuration and network access.' });
    }
    const farmDoc = await firestoreRepository.getFarmForUser(req.farmerId);
    if (!farmDoc || ![farmDoc._id, `farm-${req.farmerId}`, req.farmerId].includes(id)) {
      return res.status(404).json({ success: false, message: 'Farm data is not available for this account.' });
    }

    let weatherContext = null;
    try {
      weatherContext = await weatherService.getCurrentWeather(farmDoc?.farmLocation);
    } catch (error) {
      console.warn('[AgriShield Farm Twin] Weather could not be retrieved:', error.message);
      weatherContext = { available: false, status: 'unavailable', data: null, sources: [] };
    }
    const twinState = getFarmEnvironmentState(farmDoc, {
      weatherData: weatherContext
    });

    return res.json({
      success: true,
      data: twinState
    });
  } catch (error) {
    console.error('[AgriShield] Failed to generate Farm Twin:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to calibrate Farm Twin right now. Reverting to safe baseline.'
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
  console.log(`AgriShield backend running on http://localhost:${PORT}`);
  const status = providerFactory.getStatus();
  void (async () => {
    const firebaseAdmin = getFirebaseAdminRuntimeStatus();
    const firestore = await firestoreRepository.checkHealth();
    console.log('[AgriShield Configuration]', {
      aiProvider: status.provider,
      aiConfigured: status.isConfigured,
      firebaseAdminConfigured: firebaseAdmin.configured,
      firestoreConfigured: firestore.configured,
      firestoreConnected: firestore.connected,
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
