const FIREBASE_AUTH_MESSAGES = {
  'auth/invalid-phone-number': 'Enter a valid mobile number and try again.',
  'auth/too-many-requests': 'Too many attempts were made. Wait a while before trying again.',
  'auth/quota-exceeded': 'Phone verification is temporarily unavailable. Please try again later.',
  'auth/code-expired': 'This verification code has expired. Request a new code.',
  'auth/invalid-verification-code': 'That verification code is incorrect. Check it and try again.',
  'auth/captcha-check-failed': 'The security check could not be verified. Please try again.',
  'auth/invalid-app-credential': 'The security check could not be verified. Please try again.',
  'auth/network-request-failed': 'A network error interrupted phone verification. Check your connection and try again.',
  'auth/internal-error': 'Firebase could not complete phone verification. Wait a moment and try again.',
  'auth/operation-not-allowed': 'Phone sign-in is not enabled for this Firebase project.',
  'auth/unauthorized-domain': 'This app domain is not authorized for Firebase sign-in.'
};

export function logFirebaseAuthError(error, operation) {
  if (import.meta.env.DEV && typeof error?.code === 'string' && error.code.startsWith('auth/')) {
    console.warn(`[AgriShield Firebase Auth] ${operation} failed: ${error.code}`);
  }
}

export function logFirebaseAuthEvent(message) {
  if (import.meta.env.DEV) {
    console.info(`[Firebase Auth] ${message}`);
  }
}

export function getFirebaseAuthErrorMessage(error, fallback) {
  if (FIREBASE_AUTH_MESSAGES[error?.code]) return FIREBASE_AUTH_MESSAGES[error.code];
  if (typeof error?.code === 'string' && error.code.startsWith('auth/')) {
    return 'Phone verification failed. Please try again.';
  }
  return error?.message || fallback;
}
