const {
  firebaseAdminConfigured,
  getFirebaseAdminConfigurationError,
  getFirebaseAuth
} = require('../services/firebaseAdmin');
const firestoreRepository = require('../services/firestoreRepository');

function logDevelopmentAuth(message, details = {}) {
  if (process.env.NODE_ENV === 'development') {
    console.info(`[AgriShield Auth] ${message}`, details);
  }
}

function getFailureStatus(error) {
  if (error.statusCode) return error.statusCode;
  if (error.code === 'FIREBASE_ADMIN_NOT_CONFIGURED') return 503;
  return typeof error.code === 'string' && error.code.startsWith('auth/') ? 401 : 503;
}

function logDevelopmentTtsTiming(req, stage, startedAt) {
  if (process.env.NODE_ENV === 'development' && req.originalUrl?.startsWith('/api/ai/speak/stream')) {
    console.debug('[AgriShield TTS Timing]', {
      stage,
      elapsedMs: Math.round(performance.now() - startedAt)
    });
  }
}

async function verifyFirebaseRequest(req) {
  const startedAt = performance.now();
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  logDevelopmentAuth('Firebase token received.', { received: Boolean(match) });

  if (!firebaseAdminConfigured()) {
    const configurationError = getFirebaseAdminConfigurationError();
    const error = new Error(configurationError === 'FIREBASE_PRIVATE_KEY_INVALID'
      ? 'The backend Firebase Admin private key is invalid. Replace FIREBASE_PRIVATE_KEY in backend/.env with the private key from the Firebase service-account JSON, then restart the backend.'
      : 'Firebase authentication is not configured on the server. Check the Firebase Admin service-account settings in backend/.env, then restart the backend.');
    error.statusCode = 503;
    error.code = configurationError || 'FIREBASE_ADMIN_NOT_CONFIGURED';
    throw error;
  }

  if (!match) {
    const error = new Error('A valid Firebase sign-in is required.');
    error.statusCode = 401;
    throw error;
  }

  const decodedToken = await getFirebaseAuth().verifyIdToken(match[1], true);
  if (!decodedToken.uid) {
    const error = new Error('The Firebase identity token is invalid.');
    error.statusCode = 401;
    throw error;
  }
  logDevelopmentTtsTiming(req, 'firebase_identity_verified', startedAt);
  logDevelopmentAuth('Firebase token verified.', { uidPresent: true });
  return decodedToken;
}

function requireFirebaseIdentity(req, res, next) {
  verifyFirebaseRequest(req)
    .then((decodedToken) => {
      req.firebaseUser = decodedToken;
      req.firebaseUid = decodedToken.uid;
      next();
    })
    .catch((error) => {
      console.error('[AgriShield Auth] Firebase identity verification failed:', error.code || error.name || 'verification_error');
      res.status(getFailureStatus(error)).json({
        success: false,
        code: error.code || 'FIREBASE_AUTH_FAILED',
        message: getFailureStatus(error) === 503
          ? error.message
          : 'Your Firebase sign-in could not be verified. Please sign in again.'
      });
    });
}

function requireActiveFarm(req, res, next) {
  if (req.activeFarmVerified && req.farmData && req.activeFarmId) return next();
  if (!firestoreRepository.isConfigured()) {
    return res.status(503).json({
      success: false,
      code: 'APPLICATION_FIRESTORE_UNAVAILABLE',
      message: 'Farm application data is temporarily unavailable. Your sign-in remains active; please retry.'
    });
  }
  resolveActiveFarm({
    uid: req.firebaseUid,
    suppliedFarmId: req.params.farmId || req.get('x-farm-id')
  })
    .then(({ farmId, farm }) => {
      req.activeFarmId = farmId;
      req.farmId = farmId;
      req.farmData = farm;
      next();
    })
    .catch((error) => {
      if ([400, 403, 409].includes(error.statusCode)) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message
        });
      }
      console.error('[AgriShield Auth] Active farm resolution failed:', error.code || error.name || 'farm_resolution_error');
      return res.status(getFailureStatus(error)).json({
        success: false,
        code: error.code || 'APPLICATION_FIRESTORE_UNAVAILABLE',
        message: getFailureStatus(error) === 503
          ? error.message
          : 'Farm application data is temporarily unavailable. Your sign-in remains active; please retry.'
      });
    });
}

async function resolveActiveFarm({ uid, suppliedFarmId, repository = firestoreRepository }) {
  const farm = await repository.getFarmForUser(uid);
  if (!farm) {
    if (suppliedFarmId && !await repository.getFarmOwnership(uid, suppliedFarmId)) {
      const error = new Error('This farm is not available to your account.');
      error.code = 'FARM_ACCESS_DENIED';
      error.statusCode = 403;
      throw error;
    }
    const error = new Error('Select one of your farms before requesting farm-specific data.');
    error.code = 'ACTIVE_FARM_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const activeFarmId = String(farm._id || farm.farmId);
  if (suppliedFarmId && String(suppliedFarmId) !== activeFarmId) {
    if (!await repository.getFarmOwnership(uid, suppliedFarmId)) {
      const error = new Error('This farm is not available to your account.');
      error.code = 'FARM_ACCESS_DENIED';
      error.statusCode = 403;
      throw error;
    }
    const error = new Error('The requested farm is not the active farm for this account.');
    error.code = 'ACTIVE_FARM_MISMATCH';
    error.statusCode = 409;
    throw error;
  }

  return { farmId: activeFarmId, farm };
}

function requireRecentFirebaseIdentity(req, res, next) {
  const authenticatedAt = Number(req.firebaseUser?.auth_time);
  const ageSeconds = Math.floor(Date.now() / 1000) - authenticatedAt;
  if (!Number.isFinite(authenticatedAt) || ageSeconds < 0 || ageSeconds > 300) {
    return res.status(401).json({
      success: false,
      code: 'RECENT_AUTH_REQUIRED',
      message: 'Please sign in again before deleting your account.'
    });
  }
  return next();
}

function requireFirebaseFarmer(req, res, next) {
  verifyFirebaseRequest(req)
    .then(async (decodedToken) => {
      req.firebaseUser = decodedToken;
      req.firebaseUid = decodedToken.uid;
      if (!firestoreRepository.isPrivateConfigured()) {
        return res.status(503).json({
          success: false,
          code: 'PRIVATE_FIRESTORE_UNAVAILABLE',
          message: 'Your private account data could not be loaded. Check the backend Firebase configuration and retry.'
        });
      }

      const profileReadStartedAt = performance.now();
      const farmer = await firestoreRepository.getUser(decodedToken.uid);
      logDevelopmentTtsTiming(req, 'private_profile_loaded', profileReadStartedAt);
      if (!farmer) {
        return res.status(403).json({
          success: false,
          code: 'FARMER_PROFILE_NOT_SYNCED',
          message: 'Your account is verified, but its farmer profile has not synchronized. Please retry account setup.'
        });
      }
      req.farmerId = decodedToken.uid;

      const suppliedFarmId = req.params.farmId || req.get('x-farm-id');
      const activeFarmId = farmer.activeFarmId || null;
      if (suppliedFarmId || activeFarmId) {
        if (!firestoreRepository.isConfigured()) {
          return res.status(503).json({
            success: false,
            code: 'APPLICATION_FIRESTORE_UNAVAILABLE',
            message: 'Farm application data is temporarily unavailable. Your sign-in remains active; please retry.'
          });
        }
        const farmReadStartedAt = performance.now();
        const farm = await firestoreRepository.getFarmForUser(decodedToken.uid);
        logDevelopmentTtsTiming(req, 'active_farm_loaded', farmReadStartedAt);
        const resolvedFarmId = farm ? String(farm._id || farm.farmId) : null;
        if (suppliedFarmId && String(suppliedFarmId) !== resolvedFarmId) {
          const ownership = await firestoreRepository.getFarmOwnership(decodedToken.uid, suppliedFarmId);
          if (!ownership) {
            return res.status(403).json({
              success: false,
              code: 'FARM_ACCESS_DENIED',
              message: 'This farm is not available to your account.'
            });
          }
          if (!farm) {
            return res.status(400).json({
              success: false,
              code: 'ACTIVE_FARM_REQUIRED',
              message: 'Select one of your farms before requesting farm-specific data.'
            });
          }
          return res.status(409).json({
            success: false,
            code: 'ACTIVE_FARM_MISMATCH',
            message: 'The requested farm is not the active farm for this account.'
          });
        }
        if (farm) {
          req.activeFarmId = resolvedFarmId;
          req.farmId = resolvedFarmId;
          req.farmData = farm;
          req.activeFarmVerified = true;
        }
      }
      return next();
    })
    .catch((error) => {
      console.error('[AgriShield Auth] Farmer authorization failed:', error.code || error.name || 'authorization_error');
      return res.status(getFailureStatus(error)).json({
        success: false,
        code: error.code || 'FIREBASE_AUTH_FAILED',
        message: getFailureStatus(error) === 503
          ? error.message
          : 'Your Firebase sign-in could not be verified. Please sign in again.'
      });
    });
}

module.exports = {
  requireActiveFarm,
  requireFirebaseFarmer,
  requireFirebaseIdentity,
  requireRecentFirebaseIdentity,
  resolveActiveFarm,
  verifyFirebaseRequest
};
