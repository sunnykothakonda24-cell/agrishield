const { getFirebaseAuth } = require('./firebaseAdmin');
const firestoreRepository = require('./firestoreRepository');
const localStorageService = require('./storage/localStorageService');

function supportAttachmentFilename(value) {
  const match = /^\/uploads\/support\/([a-f0-9-]+\.(?:jpg|png|webp))$/i.exec(value);
  return match?.[1] || null;
}

async function removeSupportAttachments(paths) {
  for (const path of paths) {
    const filename = supportAttachmentFilename(path);
    if (!filename) continue;
    try {
      await localStorageService.deleteFile({ category: 'support', filename });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function deleteAccount(uid) {
  if (typeof uid !== 'string' || !uid) throw new Error('A verified Firebase UID is required.');
  if (!firestoreRepository.isConfigured()) {
    const error = new Error('Account data storage is unavailable. Please try again later.');
    error.code = 'FIRESTORE_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }

  const plan = await firestoreRepository.getAccountDataDeletionPlan(uid);
  await removeSupportAttachments(plan.attachments);
  const deletedDocuments = await firestoreRepository.deleteAccountData(plan);
  await getFirebaseAuth().deleteUser(uid);
  return { deletedDocuments };
}

module.exports = { deleteAccount, supportAttachmentFilename };
