const firestoreRepository = require('./firestoreRepository');

async function syncFirebaseAccount(firebaseUser, requestedName = '') {
  const firebaseUid = firebaseUser?.uid;
  const phone = typeof firebaseUser?.phone_number === 'string' ? firebaseUser.phone_number : '';
  if (!firebaseUid || !phone) {
    const error = new Error('Verify a phone number with Firebase before creating the farmer profile.');
    error.statusCode = 400;
    error.code = 'FIREBASE_PHONE_REQUIRED';
    throw error;
  }
  if (!firestoreRepository.isConfigured()) {
    const error = new Error('Firebase Firestore is not configured. Your Firebase account is signed in, but farmer data cannot be synchronized yet.');
    error.statusCode = 503;
    error.code = 'FIRESTORE_UNAVAILABLE';
    throw error;
  }

  const existing = await firestoreRepository.getUser(firebaseUid);
  const submittedName = typeof requestedName === 'string' ? requestedName.trim().slice(0, 100) : '';
  const user = await firestoreRepository.createOrUpdateUser(firebaseUid, {
    name: submittedName || existing?.name || firebaseUser.name || '',
    phone,
    mobileVerified: true,
    accountStatus: 'active',
    preferredLanguage: existing?.preferredLanguage || 'en',
    profilePhoto: existing?.profilePhoto || null
  });
  return {
    ...user,
    _id: firebaseUid,
    name: user.name || '',
    mobile: user.phone || '',
    mobileVerified: user.mobileVerified !== false,
    accountStatus: user.accountStatus || 'active'
  };
}

module.exports = { syncFirebaseAccount };
