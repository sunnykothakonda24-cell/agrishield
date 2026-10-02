const express = require('express');
const router = express.Router();
const { requireFirebaseFarmer } = require('../middleware/firebaseAuth');
router.use(requireFirebaseFarmer);
const { aiService } = require('../services/aiService');
const conversationService = require('../services/conversationService');
const providerFactory = require('../services/ai/providerFactory');
const conversationStorageService = require('../services/conversationStorageService');
const firestoreRepository = require('../services/firestoreRepository');
const { receiveImage, audioUpload, validateChatInput, validateImageContent } = require('../middleware/validation');
const { AgriShieldError, ERROR_CODES } = require('../utils/errors');
const { detectLanguage } = require('../services/ai/languageIntent');

/**
 * Helper to safely format error responses
 */
function handleRouteError(res, error, language = 'te') {
  console.error('[AgriShield AI Route Error]:', {
    code: error.code || ERROR_CODES.AI_PROVIDER_ERROR,
    statusCode: error.statusCode || 500
  });
  if (error instanceof AgriShieldError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.getFarmerMessage(language)
      }
    });
  }

  return res.status(500).json({
    success: false,
    error: {
      code: ERROR_CODES.AI_PROVIDER_ERROR,
      message: new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR).getFarmerMessage(language)
    }
  });
}

function parseJsonField(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, `Invalid ${fieldName} JSON: ${error.message}`, 400);
  }
}

/**
 * 1. Primary Multimodal Chat Endpoint
 * POST /api/ai/chat
 */
router.post('/chat', receiveImage, validateImageContent, validateChatInput, async (req, res) => {
  const language = req.body.language || 'auto';

  try {
    const { message, conversationId, image } = req.body;

    const imageToProcess = req.file ? req.file.buffer : image || null;
    const parsedHistory = parseJsonField(req.body.history, 'history', []);

    const result = await aiService.generateResponse({
      message: message || (imageToProcess ? 'Please analyze this plant/crop image.' : ''),
      language,
      conversationId: conversationId || `session-${Date.now()}`,
      farmerId: req.farmerId,
      image: imageToProcess,
      imageMimeType: req.file?.mimetype || req.body.imageMimeType || 'image/jpeg',
      history: parsedHistory
    });

    return res.json(result);
  } catch (error) {
    return handleRouteError(res, error, language === 'auto' ? detectLanguage(req.body.message, 'en') : language);
  }
});

/**
 * 2. Dedicated Image Analysis Endpoint
 * POST /api/ai/analyze-image
 */
router.post('/analyze-image', receiveImage, validateImageContent, validateChatInput, async (req, res) => {
  const language = req.body.language || 'auto';

  try {
    const prompt = req.body.message || req.body.prompt;
    const { conversationId, image } = req.body;
    let imageToProcess = req.file ? req.file.buffer : image;

    if (!imageToProcess) {
      return res.status(400).json({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_INPUT,
          message: 'An image is required for analysis.'
        }
      });
    }

    const result = await aiService.analyzeImage({
      message: prompt || 'Analyze this crop/plant photograph and describe visible symptoms.',
      language,
      conversationId: conversationId || `session-${Date.now()}`,
      farmerId: req.farmerId,
      image: imageToProcess,
      imageMimeType: req.file?.mimetype || req.body.imageMimeType || 'image/jpeg',
      history: parseJsonField(req.body.history, 'history', [])
    });

    return res.json(result);
  } catch (error) {
    return handleRouteError(res, error, language === 'auto' ? detectLanguage(req.body.prompt, 'en') : language);
  }
});

/**
 * 3. Speech-to-Text Transcription Endpoint
 * POST /api/ai/transcribe
 */
router.post('/transcribe', audioUpload.single('audioFile'), async (req, res) => {
  const language = req.body.language || 'auto';

  try {
    const audioBuffer = req.file ? req.file.buffer : null;
    const base64Data = req.body.audioData || null;
    const mimeType = req.file ? req.file.mimetype : (req.body.mimeType || 'audio/webm');

    const result = await aiService.transcribeAudio({
      audioBuffer,
      base64Data,
      mimeType,
      language
    });

    return res.json(result);
  } catch (error) {
    return handleRouteError(res, error, language === 'auto' ? 'en' : language);
  }
});

/**
 * 4. Text-to-Speech Voice Synthesis Endpoint
 * POST /api/ai/speak
 */
router.post('/speak', async (req, res) => {
  const { text, language = 'en' } = req.body;

  try {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Speech text must contain 1 to 8000 characters.', 400);
    }
    if (!['auto', 'en', 'te', 'hi'].includes(language)) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be auto, en, te, or hi.', 400);
    }
    const result = await aiService.generateSpeech({ text, language });
    return res.json(result);
  } catch (error) {
    return handleRouteError(res, error, language);
  }
});

/**
 * 5. Start New Chat / Reset Session
 * POST /api/ai/clear
 */
router.post('/clear', (req, res) => {
  const { conversationId } = req.body;
  if (typeof conversationId === 'string' && conversationId.length <= 128) {
    conversationService.clearSession(`${req.farmerId}:${conversationId}`);
  }
  return res.json({
    success: true,
    message: 'Conversation reset successfully',
    newConversationId: `conv-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  });
});

router.get('/conversations/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  if (!conversationId || conversationId.length > 128) {
    return res.status(400).json({ success: false, message: 'Conversation ID is invalid.' });
  }
  try {
    const messages = await conversationStorageService.getMessages(req.farmerId, conversationId, 100);
    return res.json({ success: true, conversationId, messages });
  } catch (error) {
    console.error('[AgriShield AI] Conversation history lookup failed:', {
      provider: 'firestore',
      code: error.code || error.name || 'storage_error'
    });
    return res.status(503).json({ success: false, message: 'Conversation history could not be loaded right now.' });
  }
});

router.post('/feedback', async (req, res) => {
  const { conversationId, messageId, rating, feedbackText = '' } = req.body;
  if (typeof conversationId !== 'string' || !conversationId.trim() || conversationId.length > 128 ||
      typeof messageId !== 'string' || !messageId.trim() || messageId.length > 128 ||
      ![1, -1].includes(rating) ||
      typeof feedbackText !== 'string' || feedbackText.length > 2000) {
    return res.status(400).json({ success: false, message: 'Feedback details are invalid.' });
  }
  if (!firestoreRepository.isConfigured()) {
    return res.status(503).json({ success: false, message: 'Feedback cannot be saved while the database is unavailable.' });
  }
  try {
    await firestoreRepository.createRecord('aiFeedback', {
      farmerId: req.farmerId,
      conversationId,
      messageId,
      rating,
      feedbackText: feedbackText.trim(),
      createdAt: new Date()
    });
    return res.json({ success: true, message: 'Thank you for your feedback.' });
  } catch (error) {
    console.error('[AgriShield AI] Feedback could not be stored:', { code: error.code || 'database_error' });
    return res.status(503).json({ success: false, message: 'Feedback cannot be saved right now. Please try again later.' });
  }
});

/**
 * 6. AI Engine Configuration & Status
 * GET /api/ai/status
 */
router.get('/status', async (req, res) => {
  const status = providerFactory.getStatus();
  status.conversationStorage = await conversationStorageService.checkHealth();
  return res.json({
    success: true,
    status
  });
});

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const language = req.body?.language || 'en';
  const isAudioUpload = req.path === '/transcribe';
  const code = error instanceof AgriShieldError
    ? error.code
    : error.code === 'LIMIT_FILE_SIZE'
      ? (isAudioUpload ? ERROR_CODES.AUDIO_TOO_LARGE : ERROR_CODES.IMAGE_TOO_LARGE)
      : ERROR_CODES.UNSUPPORTED_FILE;
  const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || 400;
  const knownError = error instanceof AgriShieldError
    ? error
    : new AgriShieldError(code, error.message, statusCode);
  return res.status(knownError.statusCode).json({
    success: false,
    error: {
      code: knownError.code,
      message: knownError.getFarmerMessage(language)
    }
  });
});

module.exports = router;
