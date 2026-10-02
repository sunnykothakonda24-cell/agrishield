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

async function verifyFirebaseRequest(req) {
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

function requireRecentFirebaseIdentity(req, res, next) {
  const authenticatedAt = Number(req.firebaseUser?.auth_time);
  const ageSeconds = Math.floor(Date.now() / 1000) - authenticatedAt;
  if (!Number.isFinite(authenticatedAt) || ageSeconds < 0 || ageSeconds > 300) {
    return res.status(401).json({
      success: false,
      code: 'RECENT_AUTH_REQUIRED',
      message: 'Verify your phone again before deleting your account.'
    });
  }
  return next();
}

function requireFirebaseFarmer(req, res, next) {
  verifyFirebaseRequest(req)
    .then(async (decodedToken) => {
      req.firebaseUser = decodedToken;
      req.firebaseUid = decodedToken.uid;
      if (!firestoreRepository.isConfigured()) {
        return res.status(503).json({
          success: false,
          code: 'FIRESTORE_UNAVAILABLE',
          message: 'Some farm data could not be loaded because Firestore is unavailable. Check the backend Firebase configuration and retry.'
        });
      }

      const farmer = await firestoreRepository.getUser(decodedToken.uid);
      if (!farmer) {
        return res.status(403).json({
          success: false,
          code: 'FARMER_PROFILE_NOT_SYNCED',
          message: 'Your account is verified, but its farmer profile has not synchronized. Please retry account setup.'
        });
      }
      req.farmerId = decodedToken.uid;
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
  requireFirebaseFarmer,
  requireFirebaseIdentity,
  requireRecentFirebaseIdentity,
  verifyFirebaseRequest
};
