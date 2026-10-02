const crypto = require('crypto');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function normalizePrivateKey(privateKey) {
  return String(privateKey || '').replace(/\\n/g, '\n');
}

function hasValidServicePrivateKey(privateKey) {
  try {
    const key = crypto.createPrivateKey(normalizePrivateKey(privateKey));
    return key.asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

function getFirebaseAdminConfigurationError(env = process.env) {
  if (!env.FIREBASE_PROJECT_ID) return 'FIREBASE_PROJECT_ID_MISSING';

  const applicationCredentialsPresent = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
  const localEmulator = env.NODE_ENV === 'development' &&
    Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST);
  if (applicationCredentialsPresent || localEmulator) return null;

  if (!env.FIREBASE_CLIENT_EMAIL) return 'FIREBASE_CLIENT_EMAIL_MISSING';
  if (!/^[^\s@]+@[^\s@]+$/.test(env.FIREBASE_CLIENT_EMAIL)) return 'FIREBASE_CLIENT_EMAIL_INVALID';
  if (!env.FIREBASE_PRIVATE_KEY) return 'FIREBASE_PRIVATE_KEY_MISSING';
  if (!hasValidServicePrivateKey(env.FIREBASE_PRIVATE_KEY)) return 'FIREBASE_PRIVATE_KEY_INVALID';
  return null;
}

function firebaseAdminConfigured(env = process.env) {
  const serviceCredentialsPresent = Boolean(
    env.FIREBASE_CLIENT_EMAIL &&
    /^[^\s@]+@[^\s@]+$/.test(env.FIREBASE_CLIENT_EMAIL) &&
    hasValidServicePrivateKey(env.FIREBASE_PRIVATE_KEY)
  );
  const applicationCredentialsPresent = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
  const localEmulator = env.NODE_ENV === 'development' &&
    Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST);
  return Boolean(env.FIREBASE_PROJECT_ID &&
    (serviceCredentialsPresent || applicationCredentialsPresent || localEmulator));
}

function firestoreConfigured(env = process.env) {
  const serviceCredentialsPresent = Boolean(
    env.FIREBASE_CLIENT_EMAIL &&
    /^[^\s@]+@[^\s@]+$/.test(env.FIREBASE_CLIENT_EMAIL) &&
    hasValidServicePrivateKey(env.FIREBASE_PRIVATE_KEY)
  );
  const applicationCredentialsPresent = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
  const firestoreEmulator = env.NODE_ENV === 'development' && Boolean(env.FIRESTORE_EMULATOR_HOST);
  return Boolean(env.FIREBASE_PROJECT_ID &&
    (serviceCredentialsPresent || applicationCredentialsPresent || firestoreEmulator));
}

function getFirebaseApp() {
  if (!firebaseAdminConfigured()) {
    const error = new Error('Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.');
    error.code = 'FIREBASE_ADMIN_NOT_CONFIGURED';
    throw error;
  }

  const existing = getApps().find((app) => app.name === 'agrishield');
  if (existing) return existing;

  const options = { projectId: process.env.FIREBASE_PROJECT_ID };
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    options.credential = cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY)
    });
  }
  return initializeApp(options, 'agrishield');
}

function getFirebaseAuth() {
  return getAuth(getFirebaseApp());
}

function getFirebaseFirestore() {
  return getFirestore(getFirebaseApp());
}

function getFirebaseAdminRuntimeStatus() {
  try {
    const app = getFirebaseApp();
    getAuth(app);
    getFirestore(app);
    return { configured: true, errorCode: null };
  } catch (error) {
    const errorCode = error.code || error.name || 'firebase_admin_initialization_error';
    console.error('[AgriShield Firebase Admin] Runtime initialization failed:', errorCode);
    return { configured: false, errorCode };
  }
}

module.exports = {
  FieldValue,
  firebaseAdminConfigured,
  getFirebaseAdminConfigurationError,
  firestoreConfigured,
  getFirebaseAdminRuntimeStatus,
  getFirebaseAuth,
  getFirebaseFirestore
};
