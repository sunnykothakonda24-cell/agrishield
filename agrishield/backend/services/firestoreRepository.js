const crypto = require('crypto');
const {
  FieldValue,
  applicationFirebaseAdminConfigured,
  getApplicationFirebaseFirestore,
  getPrivateFirebaseFirestore,
  privateFirebaseFirestoreConfigured
} = require('./firebaseAdmin');
const { cropKey } = require('./cropScheduleService');

const MAX_CONVERSATION_MESSAGES = 100;
const MAX_CONVERSATION_PAYLOAD_BYTES = 700 * 1024;
const COLLECTIONS = {
  users: 'users',
  farms: 'farms',
  conversations: 'aiConversations',
  notifications: 'notifications',
  cropProtocols: 'cropProtocols',
  farmActivities: 'farmActivities',
  products: 'shopItems',
  aiFeedback: 'aiFeedback',
  supportTickets: 'supportTickets',
  supportFeedback: 'supportFeedback'
};

function documentData(snapshot) {
  return snapshot.exists ? { _id: snapshot.id, ...snapshot.data() } : null;
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function conversationDocumentId(userId, farmId, conversationId) {
  return `${userId}_${farmId}_${crypto.createHash('sha256').update(conversationId).digest('hex')}`;
}

function mapFarmDocument(record) {
  if (!record) return null;
  const sourceLocation = record.location || record.farmLocation ||
    (record.latitude != null && record.longitude != null
      ? { latitude: record.latitude, longitude: record.longitude }
      : null);
  const location = sourceLocation
    ? {
        ...sourceLocation,
        latitude: sourceLocation.latitude ?? sourceLocation.lat,
        longitude: sourceLocation.longitude ?? sourceLocation.lng
      }
    : null;
  const sourceBoundary = record.boundary?.points || record.boundary || record.farmBoundary || [];
  const boundary = Array.isArray(sourceBoundary) ? sourceBoundary : [];
  const sourceArea = record.area && Object.keys(record.area).length
    ? record.area
    : record.boundary?.area || {};
  const boundaryArea = record.boundary && !Array.isArray(record.boundary) ? record.boundary : {};
  return {
    ...record,
    farmLocation: location,
    farmBoundary: boundary,
    area: {
      ...sourceArea,
      acres: sourceArea.acres ?? boundaryArea.areaAcres ?? record.areaAcres ?? null,
      hectares: sourceArea.hectares ?? boundaryArea.areaHectares ?? null,
      sqMeters: sourceArea.sqMeters ?? boundaryArea.areaSqMeters ?? null,
      perimeterMeters: sourceArea.perimeterMeters ?? boundaryArea.perimeterMeters ?? record.perimeter ?? null,
      lengthMeters: sourceArea.lengthMeters ?? boundaryArea.lengthMeters ?? record.length ?? null,
      widthMeters: sourceArea.widthMeters ?? boundaryArea.widthMeters ?? record.width ?? null
    },
    cropDetails: record.cropDetails || (record.crop ? { name: record.crop } : null),
    soilDetails: record.soilDetails || (record.soil ? { type: record.soil } : null)
  };
}

class FirestoreRepository {
  constructor({
    getFirestoreInstance = getApplicationFirebaseFirestore,
    getPrivateFirestoreInstance = getPrivateFirebaseFirestore,
    isConfigured = applicationFirebaseAdminConfigured,
    isPrivateConfigured = privateFirebaseFirestoreConfigured,
    fieldValue = FieldValue
  } = {}) {
  this.getFirestoreInstance = getFirestoreInstance;
  this.getPrivateFirestoreInstance = getPrivateFirestoreInstance;
    this.isAdminConfigured = isConfigured;
    this.isPrivateAdminConfigured = isPrivateConfigured;
    this.fieldValue = fieldValue;
  }

  firestore() {
    return this.getFirestoreInstance();
  }

  isConfigured() {
    return this.isAdminConfigured();
  }

  privateFirestore() {
    return this.getPrivateFirestoreInstance();
  }

  isPrivateConfigured() {
    return this.isPrivateAdminConfigured();
  }

  async checkHealth() {
    if (!this.isConfigured()) return { configured: false, connected: false };

    let database;
    try {
      database = this.firestore();
    } catch (error) {
      console.error('[AgriShield Firestore] Runtime initialization failed:', error.code || error.name || 'firestore_initialization_error');
      return { configured: false, connected: false };
    }

    try {
      await database.collection('_health').doc('connectivity').get();
      return { configured: true, connected: true };
    } catch (error) {
      console.warn('[AgriShield Firestore] Connectivity check failed:', error.code || error.name || 'firestore_error');
      return { configured: true, connected: false };
    }
  }

  async checkPrivateHealth() {
    if (!this.isPrivateConfigured()) return { configured: false, connected: false };
    let database;
    try {
      database = this.privateFirestore();
    } catch (error) {
      console.error('[AgriShield Private Firestore] Runtime initialization failed:', error.code || error.name || 'firestore_initialization_error');
      return { configured: false, connected: false };
    }
    try {
      await database.collection('_health').doc('private-connectivity').get();
      return { configured: true, connected: true };
    } catch (error) {
      console.warn('[AgriShield Private Firestore] Connectivity check failed:', error.code || error.name || 'firestore_error');
      return { configured: true, connected: false };
    }
  }

  async getUser(userId) {
    if (!userId) return null;
    return documentData(await this.privateFirestore().collection(COLLECTIONS.users).doc(String(userId)).get());
  }

  async createOrUpdateUser(userId, data) {
    if (!userId) throw new Error('A Firebase user ID is required.');
    const ref = this.privateFirestore().collection(COLLECTIONS.users).doc(String(userId));
    const existing = await ref.get();
    const values = { ...data, updatedAt: this.fieldValue.serverTimestamp() };
    if (!existing.exists) values.createdAt = this.fieldValue.serverTimestamp();
    await ref.set(values, { merge: true });
    return documentData(await ref.get());
  }

  async getFarmer(userId) {
    const user = await this.getUser(userId);
    if (!user) return null;
    return {
      ...user,
      _id: String(userId),
      name: user.name || '',
      mobile: user.phone || user.mobile || '',
      mobileVerified: user.mobileVerified !== false,
      accountStatus: user.accountStatus || 'active'
    };
  }

  async saveFarm(userId, farmId, farm) {
    if (!userId || !farmId) throw new Error('A user ID and farm ID are required.');
    const ref = this.firestore().collection(COLLECTIONS.farms).doc(String(farmId));
    const existing = await ref.get();
    if (existing.exists && existing.data().ownerUid !== String(userId)) {
      const error = new Error('The requested farm ID is already assigned to another account.');
      error.statusCode = 403;
      error.code = 'FARM_ACCESS_DENIED';
      throw error;
    }
    const farmName = typeof farm.farmName === 'string' && farm.farmName.trim()
      ? farm.farmName.trim()
      : typeof farm.name === 'string' && farm.name.trim()
        ? farm.name.trim()
        : 'My Farm';
    const record = {
      farmId: String(farmId),
      ownerUid: String(userId),
      name: farmName,
      farmName,
      displayName: typeof farm.displayName === 'string' && farm.displayName.trim()
        ? farm.displayName.trim()
        : farmName,
      location: farm.location || farm.farmLocation || null,
      latitude: (farm.location || farm.farmLocation)?.latitude ?? (farm.location || farm.farmLocation)?.lat ?? null,
      longitude: (farm.location || farm.farmLocation)?.longitude ?? (farm.location || farm.farmLocation)?.lng ?? null,
      boundary: farm.boundary || farm.farmBoundary || [],
      area: farm.area || {},
      perimeter: farm.area?.perimeterMeters ?? farm.perimeter ?? null,
      length: farm.area?.lengthMeters ?? farm.length ?? null,
      width: farm.area?.widthMeters ?? farm.width ?? null,
      crop: farm.crop ?? farm.cropDetails?.name ?? null,
      soil: farm.soil ?? farm.soilDetails?.type ?? null,
      waterSource: farm.waterSource || null,
      cropDetails: farm.cropDetails || null,
      soilDetails: farm.soilDetails || null,
      updatedAt: this.fieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdAt: this.fieldValue.serverTimestamp() } : {})
    };
    await ref.set(record, { merge: true });
    return mapFarmDocument(documentData(await ref.get()));
  }

  async getFarm(farmId) {
    if (!farmId) return null;
    return mapFarmDocument(documentData(
      await this.firestore().collection(COLLECTIONS.farms).doc(String(farmId)).get()
    ));
  }

  async deleteFarmForUser(userId, farmId) {
    if (!userId || !farmId) return false;
    const ref = this.firestore().collection(COLLECTIONS.farms).doc(String(farmId));
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data().ownerUid !== String(userId)) return false;
    await ref.delete();
    return true;
  }

  async getFarmOwnership(userId, farmId) {
    if (!userId || !farmId) return null;
    const ref = this.privateFirestore().collection(COLLECTIONS.users)
      .doc(String(userId)).collection('farms').doc(String(farmId));
    return documentData(await ref.get());
  }

  async getUserFarmOwnerships(userId) {
    if (!userId) return [];
    const snapshot = await this.privateFirestore().collection(COLLECTIONS.users)
      .doc(String(userId)).collection('farms').get();
    return snapshot.docs.map(documentData);
  }

  async setFarmOwnership(userId, farmId, data = {}) {
    if (!userId || !farmId) throw new Error('A user ID and farm ID are required.');
    const ref = this.privateFirestore().collection(COLLECTIONS.users)
      .doc(String(userId)).collection('farms').doc(String(farmId));
    const existing = await ref.get();
    const record = {
      farmId: String(farmId),
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'My Farm',
      farmName: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'My Farm',
      displayName: typeof data.displayName === 'string' && data.displayName.trim()
        ? data.displayName.trim()
        : (typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'My Farm'),
      locationSummary: typeof data.locationSummary === 'string' ? data.locationSummary : null,
      areaSummary: typeof data.areaSummary === 'string' ? data.areaSummary : null,
      updatedAt: this.fieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdAt: this.fieldValue.serverTimestamp() } : {})
    };
    await ref.set(record, { merge: true });
    return documentData(await ref.get());
  }

  async deleteFarmOwnership(userId, farmId) {
    if (!userId || !farmId) return false;
    const ref = this.privateFirestore().collection(COLLECTIONS.users)
      .doc(String(userId)).collection('farms').doc(String(farmId));
    const snapshot = await ref.get();
    if (!snapshot.exists) return false;
    await ref.delete();
    return true;
  }

  async setUserActiveFarmId(userId, farmId) {
    if (!userId || !farmId) throw new Error('A user ID and farm ID are required.');
    const ownership = await this.getFarmOwnership(userId, farmId);
    if (!ownership) return false;
    await this.privateFirestore().collection(COLLECTIONS.users).doc(String(userId)).set({
      activeFarmId: String(farmId),
      updatedAt: this.fieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  }

  async getOwnedFarm(userId, farmId) {
    const ownership = await this.getFarmOwnership(userId, farmId);
    if (!ownership) return null;
    const farm = await this.getFarm(farmId);
    if (!farm || farm.ownerUid !== String(userId)) return null;
    return { ...farm, ownership };
  }

  async getFarmForUser(userId, farmId = null) {
    if (!userId) return null;
    if (farmId) return this.getOwnedFarm(userId, farmId);

    const user = await this.getUser(userId);
    const activeFarmId = typeof user?.activeFarmId === 'string' ? user.activeFarmId : null;
    if (activeFarmId) {
      const activeFarm = await this.getOwnedFarm(userId, activeFarmId);
      if (activeFarm) return activeFarm;
    }

    const ownerships = await this.getUserFarmOwnerships(userId);
    if (ownerships.length !== 1) return null;

    const onlyOwnedFarmId = String(ownerships[0].farmId || ownerships[0]._id || '');
    const onlyFarm = onlyOwnedFarmId ? await this.getOwnedFarm(userId, onlyOwnedFarmId) : null;
    if (!onlyFarm) return null;
    await this.setUserActiveFarmId(userId, onlyOwnedFarmId);
    return onlyFarm;
  }

  async getCropProtocol(crop, variety = null) {
    if (!crop) return null;
    const cropId = cropKey(crop);
    const varietyId = cropKey(variety);
    if (varietyId) {
      const specific = documentData(await this.firestore().collection(COLLECTIONS.cropProtocols)
        .doc(`${cropId}-${varietyId}`).get());
      if (specific) return specific;
    }
    return documentData(await this.firestore().collection(COLLECTIONS.cropProtocols).doc(cropId).get());
  }

  async getFarmActivityStatuses(userId, farmId, limit = 500) {
    if (!userId || !farmId) return [];
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
    const snapshot = await this.firestore().collection(COLLECTIONS.farmActivities)
      .where('ownerUid', '==', String(userId))
      .where('farmId', '==', String(farmId))
      .limit(boundedLimit)
      .get();
    return snapshot.docs.map(documentData);
  }

  async setFarmActivityStatus({
    farmerId,
    farmId,
    cropId,
    activityId,
    scheduledDate,
    status
  }) {
    if (!farmerId || !farmId || !activityId || !scheduledDate) {
      throw new Error('Farmer, farm, activity, and scheduled date are required.');
    }
    const documentId = crypto.createHash('sha256')
      .update(`${farmId}:${activityId}:${scheduledDate}`)
      .digest('hex');
    const ref = this.firestore().collection(COLLECTIONS.farmActivities).doc(documentId);
    const existing = await ref.get();
    const record = {
      ownerUid: String(farmerId),
      farmerId: String(farmerId),
      farmId: String(farmId),
      cropId: String(cropId || ''),
      activityId: String(activityId),
      scheduledDate: String(scheduledDate),
      status,
      completedAt: status === 'COMPLETED' ? this.fieldValue.serverTimestamp() : null,
      updatedAt: this.fieldValue.serverTimestamp(),
      ...(!existing.exists ? { createdAt: this.fieldValue.serverTimestamp() } : {})
    };
    await ref.set(record, { merge: true });
    return documentData(await ref.get());
  }

  async getActiveProducts(limit = 1000) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 1000, 2000));
    const snapshot = await this.firestore().collection(COLLECTIONS.products)
      .where('active', '==', true)
      .limit(boundedLimit)
      .get();
    return snapshot.docs.map(documentData);
  }

  async getActiveProduct(productId) {
    if (!productId) return null;
    const product = documentData(await this.firestore().collection(COLLECTIONS.products).doc(String(productId)).get());
    return product?.active === true ? product : null;
  }

  async getFarmerFarms(userId) {
    if (!userId) return [];
    const ownerships = await this.getUserFarmOwnerships(userId);
    const farms = await Promise.all(ownerships.map(async ({ farmId }) => {
      if (!farmId) return null;
      return this.getOwnedFarm(userId, farmId);
    }));
    return farms.filter(Boolean);
  }

  async createAIConversation({ conversationId, userId, farmId }) {
    if (!conversationId || !userId || !farmId) throw new Error('Conversation, user, and farm IDs are required.');
    const ref = this.firestore().collection(COLLECTIONS.conversations)
      .doc(conversationDocumentId(userId, farmId, conversationId));
    const existing = await ref.get();
    if (!existing.exists) {
      await ref.create({
        ownerUid: String(userId),
        farmId: String(farmId),
        conversationId: String(conversationId),
        messages: [],
        createdAt: this.fieldValue.serverTimestamp(),
        updatedAt: this.fieldValue.serverTimestamp()
      });
    }
    return ref.id;
  }

  async appendAIMessage({ userId, conversationId, farmId, message }) {
    if (!message || !userId || !conversationId || !farmId) {
      throw new Error('Conversation message details and farm ID are required.');
    }
    const ref = this.firestore().collection(COLLECTIONS.conversations)
      .doc(conversationDocumentId(userId, farmId, conversationId));
    const messageRecord = {
      id: message.messageId || crypto.randomUUID(),
      role: message.role,
      message: String(message.message || '').slice(0, 8000),
      ownerUid: String(userId),
      farmId: String(farmId),
      conversationId: String(conversationId),
      language: message.language || null,
      intent: message.intent || null,
      imagePath: message.imagePath || null,
      attachment: message.attachment || null,
      analysisStatus: message.analysisStatus || null,
      requestId: message.requestId || null,
      inputType: message.inputType || 'text',
      createdAt: new Date().toISOString()
    };
    await this.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists ? snapshot.data() : null;
      const messages = Array.isArray(existing?.messages) ? existing.messages : [];
      const boundedMessages = [...messages, messageRecord].slice(-MAX_CONVERSATION_MESSAGES);
      while (boundedMessages.length > 1 &&
        Buffer.byteLength(JSON.stringify(boundedMessages), 'utf8') > MAX_CONVERSATION_PAYLOAD_BYTES) {
        boundedMessages.shift();
      }
      transaction.set(ref, {
        ownerUid: String(userId),
        farmId: String(farmId),
        conversationId: String(conversationId),
        messages: boundedMessages,
        createdAt: existing?.createdAt || this.fieldValue.serverTimestamp(),
        updatedAt: this.fieldValue.serverTimestamp()
      }, { merge: true });
    });
    return messageRecord.id;
  }

  async updateAIMessageAttachment({ userId, farmId, conversationId, messageId, attachment, analysisStatus }) {
    if (!userId || !farmId || !conversationId || !messageId) return false;
    const ref = this.firestore().collection(COLLECTIONS.conversations)
      .doc(conversationDocumentId(userId, farmId, conversationId));
    let updated = false;
    await this.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const existing = snapshot.data();
      if (existing.ownerUid !== String(userId) || existing.farmId !== String(farmId) ||
          existing.conversationId !== String(conversationId)) return;
      const messages = Array.isArray(existing.messages) ? existing.messages : [];
      const index = messages.findIndex((message) => message.id === String(messageId));
      if (index < 0 || messages[index].ownerUid !== String(userId) ||
          messages[index].farmId !== String(farmId) ||
          messages[index].conversationId !== String(conversationId) ||
          messages[index].role !== 'user' ||
          messages[index].attachment?.provider !== 'cloudinary') return;
      const nextMessages = [...messages];
      nextMessages[index] = {
        ...nextMessages[index],
        ...(attachment ? { attachment } : {}),
        ...(analysisStatus ? { analysisStatus } : {})
      };
      transaction.set(ref, {
        ...existing,
        messages: nextMessages,
        updatedAt: this.fieldValue.serverTimestamp()
      }, { merge: true });
      updated = true;
    });
    return updated;
  }

  async getAIConversationMessage(userId, farmId, conversationId, messageId) {
    if (!userId || !farmId || !conversationId || !messageId) return null;
    const conversation = await this.getAIConversationHistory(userId, farmId, conversationId, MAX_CONVERSATION_MESSAGES);
    const message = conversation?.messages.find((entry) => entry._id === String(messageId));
    if (!message || message.ownerUid !== String(userId) || message.farmId !== String(farmId) ||
        message.conversationId !== String(conversationId)) return null;
    return message;
  }

  async getAIConversationHistory(userId, farmId, conversationId, limit = 100) {
    if (!userId || !farmId || !conversationId) return null;
    const snapshot = await this.firestore().collection(COLLECTIONS.conversations)
      .doc(conversationDocumentId(userId, farmId, conversationId)).get();
    if (!snapshot.exists) return null;
    const conversation = snapshot.data();
    if (conversation.ownerUid !== String(userId) || conversation.farmId !== String(farmId)) return null;
    return {
      ...conversation,
      messages: (Array.isArray(conversation.messages) ? conversation.messages : [])
        .slice(-Math.max(1, Math.min(Number(limit) || 100, 100)))
        .map(({ id, ...message }) => ({ _id: id, ...message }))
    };
  }

  async saveConversationMessage(message) {
    const id = await this.appendAIMessage({
      userId: message.farmerId,
      conversationId: message.conversationId,
      farmId: message.farmId,
      message
    });
    return id;
  }

  async updateConversationAttachment(message) {
    return this.updateAIMessageAttachment({
      userId: message.farmerId,
      farmId: message.farmId,
      conversationId: message.conversationId,
      messageId: message.messageId,
      attachment: message.attachment,
      analysisStatus: message.analysisStatus
    });
  }

  async getConversationMessages(userId, farmId, conversationId, limit = 100) {
    const conversation = await this.getAIConversationHistory(userId, farmId, conversationId, limit);
    return conversation?.messages.map(({
      role, message, language, intent, imagePath, attachment, analysisStatus, requestId,
      inputType, createdAt, _id, ownerUid, farmId: messageFarmId, conversationId: messageConversationId
    }) => ({
      _id,
      role,
      message,
      language,
      intent,
      imagePath,
      attachment,
      analysisStatus,
      requestId,
      ownerUid,
      farmId: messageFarmId,
      conversationId: messageConversationId,
      inputType: inputType || 'text',
      createdAt
    })) || [];
  }

  async createNotification({ userId, farmId, type, title, message, severity = 'info' }) {
    if (!userId || !farmId || !type || !title || !message) {
      throw new Error('Notification owner, farm, type, title, and message are required.');
    }
    const ref = this.firestore().collection(COLLECTIONS.notifications).doc();
    await ref.set({
      ownerUid: String(userId),
      farmId: farmId ? String(farmId) : null,
      type: String(type),
      title: String(title),
      message: String(message),
      severity: String(severity),
      read: false,
      createdAt: this.fieldValue.serverTimestamp()
    });
    return ref.id;
  }

  async getUserNotifications(userId, farmId, limit = 100) {
    if (!userId || !farmId) return [];
    const snapshot = await this.firestore().collection(COLLECTIONS.notifications)
      .where('ownerUid', '==', String(userId))
      .where('farmId', '==', String(farmId))
      .get();
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
    return snapshot.docs
      .map(documentData)
      .filter((record) => record.farmId === (farmId ? String(farmId) : null))
      .sort((left, right) => timestampMillis(right.createdAt) - timestampMillis(left.createdAt))
      .slice(0, boundedLimit);
  }

  async markNotificationAsRead(userId, farmId, notificationId) {
    if (!userId || !farmId || !notificationId) return false;
    const ref = this.firestore().collection(COLLECTIONS.notifications).doc(String(notificationId));
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data().ownerUid !== String(userId) ||
        snapshot.data().farmId !== String(farmId)) return false;
    await ref.update({
      read: true,
      updatedAt: this.fieldValue.serverTimestamp()
    });
    return true;
  }

  async createRecord(collectionName, data) {
    const ref = this.firestore().collection(collectionName).doc();
    await ref.set({ ...data, createdAt: this.fieldValue.serverTimestamp() });
    return ref.id;
  }

  async getAccountDataDeletionPlan(userId) {
    if (!userId) throw new Error('A verified Firebase user ID is required.');
    const applicationDatabase = this.firestore();
    const privateDatabase = this.privateFirestore();
    const ownedCollections = [
      ['farms', 'ownerUid'],
      ['aiConversations', 'ownerUid'],
      ['notifications', 'ownerUid'],
      ['farmActivities', 'ownerUid'],
      ['aiFeedback', 'farmerId'],
      ['supportTickets', 'farmerId'],
      ['supportFeedback', 'farmerId']
    ];
    const legacyCollections = [
      ['farms', 'userId'],
      ['aiConversations', 'userId'],
      ['aiConversations', 'farmerId'],
      ['conversations', 'farmerId'],
      ['notifications', 'userId'],
      ['farmActivities', 'farmerId'],
      ['aiFeedback', 'farmerId'],
      ['supportTickets', 'farmerId'],
      ['supportFeedback', 'farmerId']
    ];
    const [userSnapshot, ...snapshots] = await Promise.all([
      privateDatabase.collection(COLLECTIONS.users).doc(String(userId)).get(),
      ...ownedCollections.map(([collectionName, ownerField]) =>
        applicationDatabase.collection(collectionName).where(ownerField, '==', String(userId)).get()
      ),
      ...legacyCollections.map(([collectionName, ownerField]) =>
        privateDatabase.collection(collectionName).where(ownerField, '==', String(userId)).get()
      )
    ]);
    const collectionSnapshots = snapshots.slice(0, ownedCollections.length);
    const legacySnapshots = snapshots.slice(ownedCollections.length);
    const privateReferences = [];
    const applicationReferences = [];
    const privateReferencePaths = new Set();
    const applicationReferencePaths = new Set();
    collectionSnapshots.forEach((snapshot, index) => {
      const [collectionName] = ownedCollections[index];
      snapshot.docs.forEach((document) => {
        const reference = document.ref || applicationDatabase.collection(collectionName).doc(document.id);
        const path = reference.path || `${collectionName}/${document.id}`;
        if (!applicationReferencePaths.has(path)) {
          applicationReferencePaths.add(path);
          applicationReferences.push(reference);
        }
      });
    });
    legacySnapshots.forEach((snapshot, index) => {
      const [collectionName] = legacyCollections[index];
      snapshot.docs.forEach((document) => {
        const reference = document.ref || privateDatabase.collection(collectionName).doc(document.id);
        const path = reference.path || `${collectionName}/${document.id}`;
        if (!privateReferencePaths.has(path)) {
          privateReferencePaths.add(path);
          privateReferences.push(reference);
        }
      });
    });
    const userReference = privateDatabase.collection(COLLECTIONS.users).doc(String(userId));
    if (userSnapshot.exists) {
      const path = userReference.path || `${COLLECTIONS.users}/${userId}`;
      if (!privateReferencePaths.has(path)) {
        privateReferencePaths.add(path);
        privateReferences.push(userReference);
      }
    }
    const ownershipSnapshot = await userReference.collection('farms').get();
    ownershipSnapshot.docs.forEach((document) => {
      const reference = document.ref || userReference.collection('farms').doc(document.id);
      const path = reference.path || `${COLLECTIONS.users}/${userId}/farms/${document.id}`;
      if (!privateReferencePaths.has(path)) {
        privateReferencePaths.add(path);
        privateReferences.push(reference);
      }
    });
    const supportTickets = collectionSnapshots[ownedCollections.findIndex(([name]) => name === 'supportTickets')];
    const attachments = supportTickets.docs
      .map((document) => document.data()?.attachmentPath)
      .filter((value) => typeof value === 'string' && value);
    return { privateReferences, applicationReferences, attachments };
  }

  async deleteAccountData(plan) {
    if (!plan || !Array.isArray(plan.privateReferences) || !Array.isArray(plan.applicationReferences)) {
      throw new Error('An account data deletion plan is required.');
    }
    const deleteReferences = async (database, references) => {
      let deleted = 0;
      for (let index = 0; index < references.length; index += 400) {
        const batch = database.batch();
        const group = references.slice(index, index + 400);
        group.forEach((reference) => batch.delete(reference));
        if (group.length) await batch.commit();
        deleted += group.length;
      }
      return deleted;
    };
    const applicationDeleted = await deleteReferences(this.firestore(), plan.applicationReferences);
    const privateDeleted = await deleteReferences(this.privateFirestore(), plan.privateReferences);
    return { privateDeleted, applicationDeleted };
  }
}

module.exports = new FirestoreRepository();
module.exports.FirestoreRepository = FirestoreRepository;
