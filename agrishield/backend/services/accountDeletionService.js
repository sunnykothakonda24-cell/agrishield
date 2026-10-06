const { getFirebaseAuth } = require('./firebaseAdmin');
const firestoreRepository = require('./firestoreRepository');
const localStorageService = require('./storage/localStorageService');
const cloudinaryImageService = require('./cloudinaryImageService');

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
  if (!firestoreRepository.isConfigured() || !firestoreRepository.isPrivateConfigured()) {
    const error = new Error('Private account storage and application data storage must both be available before account deletion.');
    error.code = 'FIREBASE_PROJECT_STORAGE_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }

  const plan = await firestoreRepository.getAccountDataDeletionPlan(uid);
  await removeSupportAttachments(plan.attachments);
  try {
    await cloudinaryImageService.deleteUserAssets(uid);
  } catch (error) {
    console.warn('[AgriShield Account Deletion] Cloudinary cleanup needs follow-up:', error.code || error.name || 'cleanup_error');
  }
  const deletedDocuments = await firestoreRepository.deleteAccountData(plan);
  await getFirebaseAuth().deleteUser(uid);
  return { deletedDocuments };
}

module.exports = { deleteAccount, supportAttachmentFilename };
