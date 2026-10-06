const FIREBASE_AUTH_MESSAGES = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already exists with this email.',
  'auth/weak-password': 'Password is too weak. Use at least 8 characters.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'A network error occurred. Check your connection and try again.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled for this Firebase project.',
  'auth/missing-password': 'Please enter your password.',
  'auth/missing-email': 'Please enter your email.'
};

const PASSWORD_RESET_MESSAGES = {
  'auth/user-not-found': 'No account was found with this email.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many requests. Please try again later.',
  'auth/missing-email': 'Please enter your email.'
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

export function getFirebaseAuthErrorMessage(error, fallback = 'Authentication failed. Please try again.') {
  if (FIREBASE_AUTH_MESSAGES[error?.code]) return FIREBASE_AUTH_MESSAGES[error.code];
  if (typeof error?.code === 'string' && error.code.startsWith('auth/')) {
    return 'Authentication failed. Please check your credentials and try again.';
  }
  return error?.message || fallback;
}

export function getPasswordResetErrorMessage(error, fallback = 'Unable to send password reset email. Please try again.') {
  if (PASSWORD_RESET_MESSAGES[error?.code]) return PASSWORD_RESET_MESSAGES[error.code];
  if (FIREBASE_AUTH_MESSAGES[error?.code]) return FIREBASE_AUTH_MESSAGES[error.code];
  return error?.message || fallback;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Password must contain at least 8 characters.';
  }
  return null;
}

export function validatePasswordMatch(password, confirmPassword) {
  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }
  return null;
}

