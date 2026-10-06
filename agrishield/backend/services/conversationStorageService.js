const firestoreRepository = require('./firestoreRepository');

class ConversationStorageService {
  async saveMessage(message) {
    if (!message.farmerId || !message.farmId || !firestoreRepository.isConfigured()) return null;
    return firestoreRepository.saveConversationMessage(message);
  }

  async getMessages(userId, farmId, conversationId, limit = 100) {
    if (!firestoreRepository.isConfigured()) {
      throw new Error('Firebase Firestore is not configured.');
    }
    return firestoreRepository.getConversationMessages(userId, farmId, conversationId, limit);
  }

  async getMessage(userId, farmId, conversationId, messageId) {
    if (!firestoreRepository.isConfigured()) {
      throw new Error('Firebase Firestore is not configured.');
    }
    return firestoreRepository.getAIConversationMessage(userId, farmId, conversationId, messageId);
  }

  async getMessageByRequestId(userId, farmId, conversationId, requestId) {
    if (!firestoreRepository.isConfigured()) {
      throw new Error('Firebase Firestore is not configured.');
    }
    const messages = await firestoreRepository.getConversationMessages(userId, farmId, conversationId, 100);
    return messages.find((message) => message.requestId === requestId) || null;
  }

  async updateAttachment(message) {
    if (!message.farmerId || !message.farmId || !firestoreRepository.isConfigured()) {
      throw new Error('Firebase Firestore is not configured for image status updates.');
    }
    return firestoreRepository.updateConversationAttachment(message);
  }

  async checkHealth() {
    const health = await firestoreRepository.checkHealth();
    return {
      provider: 'firestore',
      project: 'application',
      ...health
    };
  }
}

module.exports = new ConversationStorageService();
