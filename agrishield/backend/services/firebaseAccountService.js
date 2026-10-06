const firestoreRepository = require('./firestoreRepository');

async function syncFirebaseAccount(firebaseUser, requestedName = '') {
  const firebaseUid = firebaseUser?.uid;
  if (!firebaseUid) {
    const error = new Error('A verified Firebase user ID is required.');
    error.statusCode = 400;
    error.code = 'FIREBASE_UID_REQUIRED';
    throw error;
  }
  if (!firestoreRepository.isPrivateConfigured()) {
    const error = new Error('Private Firebase account storage is not configured.');
    error.statusCode = 503;
    error.code = 'PRIVATE_FIRESTORE_UNAVAILABLE';
    throw error;
  }

  const existing = await firestoreRepository.getUser(firebaseUid);
  const submittedName = typeof requestedName === 'string' ? requestedName.trim().slice(0, 100) : '';
  const email = typeof firebaseUser?.email === 'string'
    ? firebaseUser.email
    : existing?.email || null;
  const phone = typeof firebaseUser?.phone_number === 'string' && firebaseUser.phone_number
    ? firebaseUser.phone_number
    : existing?.phone || existing?.mobile || '';
  const photoURL = typeof firebaseUser?.picture === 'string'
    ? firebaseUser.picture
    : existing?.photoURL || null;

  const user = await firestoreRepository.createOrUpdateUser(firebaseUid, {
    name: submittedName || existing?.name || firebaseUser.displayName || firebaseUser.name || '',
    email,
    phone,
    photoURL,
    accountStatus: existing?.accountStatus || 'active',
    preferredLanguage: existing?.preferredLanguage || 'en',
    profilePhoto: existing?.profilePhoto || null,
    ...(existing?.activeFarmId ? { activeFarmId: existing.activeFarmId } : {})
  });
  return {
    ...user,
    _id: firebaseUid,
    name: user.name || '',
    email: user.email || '',
    mobile: user.phone || '',
    mobileVerified: Boolean(user.phone),
    accountStatus: user.accountStatus || 'active'
  };
}

module.exports = { syncFirebaseAccount };
