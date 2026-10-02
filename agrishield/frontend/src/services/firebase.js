import { getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
};

const requiredConfig = ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId'];
let emulatorConnected = false;

export function getFirebaseAuth() {
  const missing = requiredConfig.filter((key) => !firebaseConfig[key]);
  if (missing.length > 0) {
    throw new Error('Firebase web authentication is not configured. Set the VITE_FIREBASE_* values in frontend/.env and restart Vite.');
  }

  const existingApp = getApps().find((candidate) => candidate.name === '[DEFAULT]');
  const app = existingApp || initializeApp(firebaseConfig);
  if (existingApp && (
    existingApp.options.projectId !== firebaseConfig.projectId ||
    existingApp.options.authDomain !== firebaseConfig.authDomain ||
    existingApp.options.appId !== firebaseConfig.appId
  )) {
    throw new Error('The initialized Firebase app does not match the configured Firebase project. Check the VITE_FIREBASE_* values.');
  }
  const auth = getAuth(app);
  const emulatorUrl = import.meta.env.DEV && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;
  if (emulatorUrl && !emulatorConnected) {
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
    emulatorConnected = true;
  }
  return auth;
}
