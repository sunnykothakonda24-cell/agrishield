const firestoreRepository = require('./firestoreRepository');

class ConversationStorageService {
  async saveMessage(message) {
    if (!message.farmerId || !firestoreRepository.isConfigured()) return null;
    return firestoreRepository.saveConversationMessage(message);
  }

  async getMessages(userId, conversationId, limit = 100) {
    if (!firestoreRepository.isConfigured()) {
      throw new Error('Firebase Firestore is not configured.');
    }
    return firestoreRepository.getConversationMessages(userId, conversationId, limit);
  }

  async checkHealth() {
    const health = await firestoreRepository.checkHealth();
    return {
      provider: 'firestore',
      ...health
    };
  }
}

module.exports = new ConversationStorageService();
