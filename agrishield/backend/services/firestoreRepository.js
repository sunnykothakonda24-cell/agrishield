const crypto = require('crypto');
const { FieldValue } = require('./firebaseAdmin');
const { getFirebaseFirestore, firestoreConfigured } = require('./firebaseAdmin');
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
  products: 'products',
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

function conversationDocumentId(userId, conversationId) {
  return `${userId}_${crypto.createHash('sha256').update(conversationId).digest('hex')}`;
}

function mapFarmDocument(record) {
  if (!record) return null;
  const location = record.location || record.farmLocation || null;
  const boundary = record.boundary || record.farmBoundary || [];
  return {
    ...record,
    farmLocation: location,
    farmBoundary: boundary,
    cropDetails: record.cropDetails || (record.crop ? { name: record.crop } : null)
  };
}

class FirestoreRepository {
  constructor({
    getFirestoreInstance = getFirebaseFirestore,
    isConfigured = firestoreConfigured,
    fieldValue = FieldValue
  } = {}) {
    this.getFirestoreInstance = getFirestoreInstance;
    this.isAdminConfigured = isConfigured;
    this.fieldValue = fieldValue;
  }

  firestore() {
    return this.getFirestoreInstance();
  }

  isConfigured() {
    return this.isAdminConfigured();
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

  async getUser(userId) {
    if (!userId) return null;
    return documentData(await this.firestore().collection(COLLECTIONS.users).doc(String(userId)).get());
  }

  async createOrUpdateUser(userId, data) {
    if (!userId) throw new Error('A Firebase user ID is required.');
    const ref = this.firestore().collection(COLLECTIONS.users).doc(String(userId));
    const existing = await ref.get();
    const values = { ...data, updatedAt: FieldValue.serverTimestamp() };
    if (!existing.exists) values.createdAt = FieldValue.serverTimestamp();
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
    const record = {
      userId: String(userId),
      location: farm.location || farm.farmLocation || null,
      boundary: farm.boundary || farm.farmBoundary || [],
      area: farm.area || {},
      crop: farm.crop ?? farm.cropDetails?.name ?? null,
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

  async getFarmForUser(userId) {
    if (!userId) return null;
    const snapshot = await this.firestore().collection(COLLECTIONS.farms)
      .where('userId', '==', String(userId))
      .limit(1)
      .get();
    return snapshot.empty ? null : mapFarmDocument(documentData(snapshot.docs[0]));
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
      .where('farmerId', '==', String(userId))
      .limit(boundedLimit)
      .get();
    return snapshot.docs
      .map(documentData)
      .filter((record) => record.farmId === String(farmId));
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
    const snapshot = await this.firestore().collection(COLLECTIONS.farms)
      .where('userId', '==', String(userId))
      .get();
    return snapshot.docs.map((doc) => mapFarmDocument(documentData(doc)));
  }

  async createAIConversation({ conversationId, userId, farmId = null }) {
    if (!conversationId || !userId) throw new Error('Conversation and user IDs are required.');
    const ref = this.firestore().collection(COLLECTIONS.conversations)
      .doc(conversationDocumentId(userId, conversationId));
    const existing = await ref.get();
    if (!existing.exists) {
      await ref.create({
        userId: String(userId),
        farmId: farmId ? String(farmId) : null,
        conversationId: String(conversationId),
        messages: [],
        createdAt: this.fieldValue.serverTimestamp(),
        updatedAt: this.fieldValue.serverTimestamp()
      });
    }
    return ref.id;
  }

  async appendAIMessage({ userId, conversationId, farmId = null, message }) {
    if (!message || !userId || !conversationId) throw new Error('Conversation message details are required.');
    const ref = this.firestore().collection(COLLECTIONS.conversations)
      .doc(conversationDocumentId(userId, conversationId));
    const messageRecord = {
      id: crypto.randomUUID(),
      role: message.role,
      message: String(message.message || '').slice(0, 8000),
      language: message.language || null,
      intent: message.intent || null,
      imagePath: message.imagePath || null,
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
        userId: String(userId),
        farmId: farmId ? String(farmId) : (existing?.farmId || null),
        conversationId: String(conversationId),
        messages: boundedMessages,
        createdAt: existing?.createdAt || this.fieldValue.serverTimestamp(),
        updatedAt: this.fieldValue.serverTimestamp()
      }, { merge: true });
    });
    return messageRecord.id;
  }

  async getAIConversationHistory(userId, conversationId, limit = 100) {
    if (!userId || !conversationId) return null;
    const snapshot = await this.firestore().collection(COLLECTIONS.conversations)
      .doc(conversationDocumentId(userId, conversationId)).get();
    if (!snapshot.exists) return null;
    const conversation = snapshot.data();
    if (conversation.userId !== String(userId)) return null;
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

  async getConversationMessages(userId, conversationId, limit = 100) {
    const conversation = await this.getAIConversationHistory(userId, conversationId, limit);
    return conversation?.messages.map(({ role, message, language, intent, imagePath, createdAt, _id }) => ({
      _id,
      role,
      message,
      language,
      intent,
      imagePath,
      createdAt
    })) || [];
  }

  async createNotification({ userId, type, title, message, severity = 'info' }) {
    if (!userId || !type || !title || !message) throw new Error('Notification details are required.');
    const ref = this.firestore().collection(COLLECTIONS.notifications).doc();
    await ref.set({
      userId: String(userId),
      type: String(type),
      title: String(title),
      message: String(message),
      severity: String(severity),
      read: false,
      createdAt: this.fieldValue.serverTimestamp()
    });
    return ref.id;
  }

  async getUserNotifications(userId, limit = 100) {
    if (!userId) return [];
    const snapshot = await this.firestore().collection(COLLECTIONS.notifications)
      .where('userId', '==', String(userId))
      .get();
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
    return snapshot.docs
      .map(documentData)
      .sort((left, right) => timestampMillis(right.createdAt) - timestampMillis(left.createdAt))
      .slice(0, boundedLimit);
  }

  async markNotificationAsRead(userId, notificationId) {
    const ref = this.firestore().collection(COLLECTIONS.notifications).doc(String(notificationId));
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data().userId !== String(userId)) return false;
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
    const database = this.firestore();
    const ownedCollections = [
      ['farms', 'userId'],
      ['aiConversations', 'userId'],
      ['notifications', 'userId'],
      ['farmActivities', 'farmerId'],
      ['aiFeedback', 'farmerId'],
      ['supportTickets', 'farmerId'],
      ['supportFeedback', 'farmerId']
    ];
    const [userSnapshot, ...collectionSnapshots] = await Promise.all([
      database.collection(COLLECTIONS.users).doc(String(userId)).get(),
      ...ownedCollections.map(([collectionName, ownerField]) =>
        database.collection(collectionName).where(ownerField, '==', String(userId)).get()
      )
    ]);
    const references = [];
    collectionSnapshots.forEach((snapshot, index) => {
      const [collectionName] = ownedCollections[index];
      snapshot.docs.forEach((document) => {
        references.push(document.ref || database.collection(collectionName).doc(document.id));
      });
    });
    if (userSnapshot.exists) references.push(database.collection(COLLECTIONS.users).doc(String(userId)));
    const supportTickets = collectionSnapshots[ownedCollections.findIndex(([name]) => name === 'supportTickets')];
    const attachments = supportTickets.docs
      .map((document) => document.data()?.attachmentPath)
      .filter((value) => typeof value === 'string' && value);
    return { references, attachments };
  }

  async deleteAccountData(plan) {
    if (!plan || !Array.isArray(plan.references)) throw new Error('An account data deletion plan is required.');
    let deleted = 0;
    for (let index = 0; index < plan.references.length; index += 400) {
      const batch = this.firestore().batch();
      const references = plan.references.slice(index, index + 400);
      references.forEach((reference) => batch.delete(reference));
      if (references.length) await batch.commit();
      deleted += references.length;
    }
    return deleted;
  }
}

module.exports = new FirestoreRepository();
module.exports.FirestoreRepository = FirestoreRepository;
