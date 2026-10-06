const crypto = require('crypto');
const fs = require('fs');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PRIVATE_APP_NAME = 'privateFirebaseAdmin';
const APPLICATION_APP_NAME = 'applicationFirebaseAdmin';
const APPLICATION_PROJECT_ID = 'agrishield-61486';

function normalizePrivateKey(privateKey) {
  return String(privateKey || '').replace(/\\n/g, '\n');
}

function hasValidServicePrivateKey(privateKey) {
  try {
    return crypto.createPrivateKey(normalizePrivateKey(privateKey)).asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

function readCredentialFile(filePath) {
  if (!filePath) return null;
  try {
    const credentials = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return credentials.project_id && credentials.client_email && hasValidServicePrivateKey(credentials.private_key)
      ? credentials
      : null;
  } catch {
    return null;
  }
}

function getProjectConfiguration(project, env = process.env) {
  if (project === 'private') {
    const credentialPath = env.PRIVATE_FIREBASE_CREDENTIALS_FILE;
    const fileCredentials = readCredentialFile(credentialPath);
    return {
      appName: PRIVATE_APP_NAME,
      projectId: env.PRIVATE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || fileCredentials?.project_id || '',
      clientEmail: env.PRIVATE_FIREBASE_CLIENT_EMAIL || env.FIREBASE_CLIENT_EMAIL || '',
      privateKey: env.PRIVATE_FIREBASE_PRIVATE_KEY || env.FIREBASE_PRIVATE_KEY || '',
      credentialPath,
      fileCredentials,
      authEmulator: env.PRIVATE_FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST,
      firestoreEmulator: env.PRIVATE_FIRESTORE_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST
    };
  }
  const credentialPath = env.APP_FIREBASE_CREDENTIALS_FILE;
  const fileCredentials = readCredentialFile(credentialPath);
  return {
    appName: APPLICATION_APP_NAME,
    projectId: env.APP_FIREBASE_PROJECT_ID || APPLICATION_PROJECT_ID,
    clientEmail: env.APP_FIREBASE_CLIENT_EMAIL || '',
    privateKey: env.APP_FIREBASE_PRIVATE_KEY || '',
    credentialPath,
    fileCredentials,
    authEmulator: '',
    firestoreEmulator: env.APP_FIRESTORE_EMULATOR_HOST
  };
}

function credentialsConfigured(configuration) {
  if (configuration.fileCredentials) return true;
  if (configuration.credentialPath) return false;
  return Boolean(
    configuration.clientEmail &&
    /^[^\s@]+@[^\s@]+$/.test(configuration.clientEmail) &&
    hasValidServicePrivateKey(configuration.privateKey)
  );
}

function credentialProjectMatches(configuration) {
  return !configuration.fileCredentials ||
    !configuration.projectId ||
    configuration.fileCredentials.project_id === configuration.projectId;
}

function isEmulatorAllowed(env = process.env) {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

function privateFirebaseAuthConfigured(env = process.env) {
  const configuration = getProjectConfiguration('private', env);
  return Boolean(configuration.projectId &&
    credentialProjectMatches(configuration) &&
    (credentialsConfigured(configuration) ||
      (isEmulatorAllowed(env) && Boolean(configuration.authEmulator))));
}

function privateFirebaseFirestoreConfigured(env = process.env) {
  const configuration = getProjectConfiguration('private', env);
  return Boolean(configuration.projectId &&
    credentialProjectMatches(configuration) &&
    (credentialsConfigured(configuration) ||
      (isEmulatorAllowed(env) && Boolean(configuration.firestoreEmulator))));
}

function privateFirebaseAdminConfigured(env = process.env) {
  return privateFirebaseAuthConfigured(env) || privateFirebaseFirestoreConfigured(env);
}

function applicationFirebaseAdminConfigured(env = process.env) {
  const configuration = getProjectConfiguration('application', env);
  return Boolean(configuration.projectId === APPLICATION_PROJECT_ID &&
    credentialProjectMatches(configuration) &&
    (credentialsConfigured(configuration) ||
      (isEmulatorAllowed(env) && Boolean(configuration.firestoreEmulator))));
}

function firebaseAdminConfigured(env = process.env) {
  return privateFirebaseAuthConfigured(env);
}

function firestoreConfigured(env = process.env) {
  return applicationFirebaseAdminConfigured(env);
}

function getFirebaseAdminConfigurationError(env = process.env) {
  const configuration = getProjectConfiguration('private', env);
  if (!configuration.projectId) return 'PRIVATE_FIREBASE_PROJECT_ID_MISSING';
  if (!credentialProjectMatches(configuration)) return 'PRIVATE_FIREBASE_CREDENTIAL_PROJECT_MISMATCH';
  if (configuration.credentialPath && !configuration.fileCredentials) return 'PRIVATE_FIREBASE_CREDENTIALS_INVALID';
  if (credentialsConfigured(configuration) || (isEmulatorAllowed(env) && configuration.authEmulator)) return null;
  if (!configuration.clientEmail) return 'PRIVATE_FIREBASE_CLIENT_EMAIL_MISSING';
  if (!/^[^\s@]+@[^\s@]+$/.test(configuration.clientEmail)) return 'PRIVATE_FIREBASE_CLIENT_EMAIL_INVALID';
  if (!configuration.privateKey) return 'PRIVATE_FIREBASE_PRIVATE_KEY_MISSING';
  if (!hasValidServicePrivateKey(configuration.privateKey)) return 'PRIVATE_FIREBASE_PRIVATE_KEY_INVALID';
  return null;
}

function getPrivateFirestoreConfigurationError(env = process.env) {
  const configuration = getProjectConfiguration('private', env);
  if (!configuration.projectId) return 'PRIVATE_FIREBASE_PROJECT_ID_MISSING';
  if (!credentialProjectMatches(configuration)) return 'PRIVATE_FIREBASE_CREDENTIAL_PROJECT_MISMATCH';
  if (configuration.credentialPath && !configuration.fileCredentials) return 'PRIVATE_FIREBASE_CREDENTIALS_INVALID';
  if (credentialsConfigured(configuration) || (isEmulatorAllowed(env) && configuration.firestoreEmulator)) return null;
  if (!configuration.clientEmail) return 'PRIVATE_FIREBASE_CLIENT_EMAIL_MISSING';
  if (!/^[^\s@]+@[^\s@]+$/.test(configuration.clientEmail)) return 'PRIVATE_FIREBASE_CLIENT_EMAIL_INVALID';
  if (!configuration.privateKey) return 'PRIVATE_FIREBASE_PRIVATE_KEY_MISSING';
  if (!hasValidServicePrivateKey(configuration.privateKey)) return 'PRIVATE_FIREBASE_PRIVATE_KEY_INVALID';
  return null;
}

function getApplicationFirebaseAdminConfigurationError(env = process.env) {
  const configuration = getProjectConfiguration('application', env);
  if (!configuration.projectId) return 'APP_FIREBASE_PROJECT_ID_MISSING';
  if (configuration.projectId !== APPLICATION_PROJECT_ID) return 'APP_FIREBASE_PROJECT_ID_INVALID';
  if (!credentialProjectMatches(configuration)) return 'APP_FIREBASE_CREDENTIAL_PROJECT_MISMATCH';
  if (configuration.credentialPath && !configuration.fileCredentials) return 'APP_FIREBASE_CREDENTIALS_INVALID';
  if (credentialsConfigured(configuration) || (isEmulatorAllowed(env) && configuration.firestoreEmulator)) return null;
  if (!configuration.clientEmail) return 'APP_FIREBASE_CLIENT_EMAIL_MISSING';
  if (!/^[^\s@]+@[^\s@]+$/.test(configuration.clientEmail)) return 'APP_FIREBASE_CLIENT_EMAIL_INVALID';
  if (!configuration.privateKey) return 'APP_FIREBASE_PRIVATE_KEY_MISSING';
  if (!hasValidServicePrivateKey(configuration.privateKey)) return 'APP_FIREBASE_PRIVATE_KEY_INVALID';
  return null;
}

function getAdminApp(project) {
  const configuration = getProjectConfiguration(project);
  const configured = project === 'private'
    ? privateFirebaseAdminConfigured()
    : applicationFirebaseAdminConfigured();
  if (!configured) {
    const error = new Error(`Firebase Admin for the ${project} project is not configured.`);
    error.code = project === 'private'
      ? getFirebaseAdminConfigurationError()
      : getApplicationFirebaseAdminConfigurationError();
    throw error;
  }

  const existing = getApps().find((app) => app.name === configuration.appName);
  if (existing) {
    if (existing.options.projectId !== configuration.projectId) {
      const error = new Error(`The initialized ${project} Firebase Admin app does not match its configured project.`);
      error.code = 'FIREBASE_ADMIN_PROJECT_MISMATCH';
      throw error;
    }
    return existing;
  }

  const options = { projectId: configuration.projectId };
  const fileCredentials = configuration.fileCredentials;
  if (fileCredentials) {
    options.credential = cert(fileCredentials);
  } else if (configuration.clientEmail && configuration.privateKey) {
    options.credential = cert({
      projectId: configuration.projectId,
      clientEmail: configuration.clientEmail,
      privateKey: normalizePrivateKey(configuration.privateKey)
    });
  }
  return initializeApp(options, configuration.appName);
}

function getPrivateFirebaseAdminApp() {
  return getAdminApp('private');
}

function getApplicationFirebaseAdminApp() {
  return getAdminApp('application');
}

function getPrivateFirebaseAuth() {
  return getAuth(getPrivateFirebaseAdminApp());
}

function getPrivateFirebaseFirestore() {
  return getFirestore(getPrivateFirebaseAdminApp());
}

function getApplicationFirebaseFirestore() {
  return getFirestore(getApplicationFirebaseAdminApp());
}

function getFirebaseAuth() {
  return getPrivateFirebaseAuth();
}

function getFirebaseFirestore() {
  return getPrivateFirebaseFirestore();
}

function getFirebaseAdminRuntimeStatus() {
  const privateConfigured = privateFirebaseAdminConfigured();
  const privateAuthConfigured = privateFirebaseAuthConfigured();
  const privateFirestoreIsConfigured = privateFirebaseFirestoreConfigured();
  const applicationConfigured = applicationFirebaseAdminConfigured();
  return {
    configured: privateConfigured && applicationConfigured,
    privateProject: {
      projectId: getProjectConfiguration('private').projectId || null,
      configured: privateConfigured,
      adminConfigured: privateConfigured,
      authConfigured: privateAuthConfigured,
      firestoreConfigured: privateFirestoreIsConfigured,
      authConfigurationError: privateAuthConfigured ? null : getFirebaseAdminConfigurationError(),
      firestoreConfigurationError: privateFirestoreIsConfigured ? null : getPrivateFirestoreConfigurationError()
    },
    applicationProject: {
      projectId: getProjectConfiguration('application').projectId || null,
      configured: applicationConfigured,
      adminConfigured: applicationConfigured,
      firestoreConfigured: applicationConfigured
    },
    errorCode: !privateAuthConfigured
      ? getFirebaseAdminConfigurationError()
      : !privateFirestoreIsConfigured
        ? getPrivateFirestoreConfigurationError()
      : !applicationConfigured
        ? getApplicationFirebaseAdminConfigurationError()
        : null
  };
}

module.exports = {
  APPLICATION_PROJECT_ID,
  FieldValue,
  applicationFirebaseAdminConfigured,
  firebaseAdminConfigured,
  privateFirebaseAuthConfigured,
  privateFirebaseFirestoreConfigured,
  getAdminApp,
  getApplicationFirebaseAdminConfigurationError,
  getApplicationFirebaseFirestore,
  getApplicationFirebaseAdminApp,
  getFirebaseAdminConfigurationError,
  getPrivateFirestoreConfigurationError,
  getFirebaseAdminRuntimeStatus,
  getFirebaseAuth,
  getFirebaseFirestore,
  getPrivateFirebaseAdminApp,
  getPrivateFirebaseAuth,
  getPrivateFirebaseFirestore,
  firestoreConfigured,
  privateFirebaseAdminConfigured
};
