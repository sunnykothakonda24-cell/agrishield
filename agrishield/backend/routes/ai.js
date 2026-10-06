const express = require('express');
const router = express.Router();
const { requireActiveFarm, requireFirebaseFarmer } = require('../middleware/firebaseAuth');
router.use(requireFirebaseFarmer);
const { aiService } = require('../services/aiService');
const conversationService = require('../services/conversationService');
const providerFactory = require('../services/ai/providerFactory');
const conversationStorageService = require('../services/conversationStorageService');
const firestoreRepository = require('../services/firestoreRepository');
const { receiveImage, audioUpload, validateChatInput, validateImageContent } = require('../middleware/validation');
const { AgriShieldError, ERROR_CODES } = require('../utils/errors');
const { detectLanguage } = require('../services/ai/languageIntent');
const { getAIConfig } = require('../services/ai/aiConfig');
const cloudinaryImageService = require('../services/cloudinaryImageService');
const { LANGUAGES, resolveLanguage } = require('../services/ai/languageRegistry');
const elevenLabsService = require('../services/elevenLabsService');

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
      },
      ...(error.imageMessageId ? { imageMessageId: error.imageMessageId } : {}),
      ...(error.imageUrl ? { imageUrl: error.imageUrl } : {})
    });
  }

  return res.status(500).json({
    success: false,
    error: {
      code: ERROR_CODES.AI_PROVIDER_ERROR,
      message: new AgriShieldError(ERROR_CODES.AI_PROVIDER_ERROR).getFarmerMessage(language)
    },
    ...(error.imageMessageId ? { imageMessageId: error.imageMessageId } : {}),
    ...(error.imageUrl ? { imageUrl: error.imageUrl } : {})
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
router.post('/conversations/:conversationId/messages/:messageId/retry', requireActiveFarm, async (req, res) => {
  const { conversationId, messageId } = req.params;
  if (!conversationId || conversationId.length > 128 || !messageId || messageId.length > 128) {
    return res.status(400).json({ success: false, message: 'Image retry details are invalid.' });
  }
  const language = resolveLanguage(req.body?.languageCode || req.body?.language || 'auto') || 'en';
  try {
    const storedMessage = await conversationStorageService.getMessage(
      req.farmerId, req.farmId, conversationId, messageId
    );
    const attachment = storedMessage?.attachment;
    if (!storedMessage || storedMessage.role !== 'user' ||
        storedMessage.analysisStatus !== 'FAILED' ||
        storedMessage.inputType !== 'image' && storedMessage.inputType !== 'voice_image' ||
        !attachment || attachment.ownerUid !== req.farmerId ||
        attachment.farmId !== req.farmId ||
        attachment.conversationId !== conversationId) {
      return res.status(403).json({
        success: false,
        error: { code: ERROR_CODES.FARM_ACCESS_DENIED, message: 'This saved image cannot be accessed in this conversation.' }
      });
    }
    const { buffer, mimeType } = await cloudinaryImageService.getImageBuffer(attachment, {
      ownerUid: req.farmerId,
      farmId: req.farmId,
      conversationId
    });
    const result = await aiService.generateResponse({
      message: storedMessage.message,
      language: storedMessage.language || language,
      conversationId,
      farmerId: req.farmerId,
      farmId: req.farmId,
      image: buffer,
      imageMimeType: mimeType,
      inputType: storedMessage.inputType || 'image',
      storedAttachment: attachment,
      existingMessageId: storedMessage._id
    });
    return res.json(result);
  } catch (error) {
    return handleRouteError(res, error, language === 'auto' ? detectLanguage('', 'en') : language);
  }
});

router.post('/chat', requireActiveFarm, receiveImage, validateImageContent, validateChatInput, async (req, res) => {
  const language = resolveLanguage(req.body.languageCode || req.body.language || 'auto');

  try {
    if (!language) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, te-IN, or auto.', 400);
    }
    const { message, conversationId, image } = req.body;
    if (req.body.requestId !== undefined &&
        (typeof req.body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(req.body.requestId))) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Image request ID is invalid.', 400);
    }
    const inlineImageMatch = typeof image === 'string'
      ? image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/)
      : null;
    const imageToProcess = req.file?.buffer ||
      (inlineImageMatch ? Buffer.from(inlineImageMatch[2], 'base64') : null);
    const parsedHistory = parseJsonField(req.body.history, 'history', []);

    const result = await aiService.generateResponse({
      message: message || (imageToProcess ? 'Uploaded photograph for analysis' : ''),
      language,
      conversationId: conversationId || `session-${Date.now()}`,
      farmerId: req.farmerId,
      farmId: req.farmId,
      image: imageToProcess,
      requestId: req.body.requestId || null,
      inputType: imageToProcess
        ? (req.body.inputType === 'voice' || req.body.inputType === 'voice_image' ? 'voice_image' : 'image')
        : (req.body.inputType === 'voice' ? 'voice' : 'text'),
      imageMimeType: req.file?.mimetype || inlineImageMatch?.[1] || req.body.imageMimeType || 'image/jpeg',
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
router.post('/analyze-image', requireActiveFarm, receiveImage, validateImageContent, validateChatInput, async (req, res) => {
  const language = resolveLanguage(req.body.languageCode || req.body.language || 'auto');

  try {
    if (!language) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, te-IN, or auto.', 400);
    }
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
      farmId: req.farmId,
      image: imageToProcess,
      inputType: 'image',
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
router.post('/transcribe', requireActiveFarm, audioUpload.single('audioFile'), async (req, res) => {
  const language = resolveLanguage(req.body.languageCode || req.body.language || 'auto');

  try {
    if (!language) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, te-IN, or auto.', 400);
    }
    const durationSeconds = Number(req.body.durationSeconds);
    const maxRecordingSeconds = getAIConfig().voiceMaxRecordingSeconds;
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > maxRecordingSeconds) {
      throw new AgriShieldError(
        ERROR_CODES.AUDIO_TOO_LARGE,
        `Voice recording duration must be from 1 to ${maxRecordingSeconds} seconds.`,
        413
      );
    }
    const audioBuffer = req.file ? req.file.buffer : null;
    const base64Data = req.body.audioData || null;
    const mimeType = req.file ? req.file.mimetype : (req.body.mimeType || 'audio/webm');

    const result = await aiService.transcribeAudio({
      audioBuffer,
      base64Data,
      mimeType,
      language,
      languageCode: req.body.languageCode
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
router.post('/speak', requireActiveFarm, async (req, res) => {
  const { text } = req.body;
  const requestedLanguage = req.body.languageCode || req.body.language || 'en-IN';
  const language = requestedLanguage === 'auto'
    ? 'en'
    : resolveLanguage(requestedLanguage, { allowAuto: false });

  try {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Speech text must contain 1 to 8000 characters.', 400);
    }
    if (!language) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, or te-IN.', 400);
    }
    const result = await aiService.generateSpeech({
      text,
      languageCode: req.body.languageCode,
      language,
      ownerUid: req.farmerId,
      farmId: req.farmId
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof AgriShieldError &&
        [
          ERROR_CODES.TTS_NOT_CONFIGURED,
          ERROR_CODES.TTS_FAILED,
          ERROR_CODES.ELEVENLABS_AUTH_FAILED,
          ERROR_CODES.ELEVENLABS_REQUEST_REJECTED,
          ERROR_CODES.ELEVENLABS_PROVIDER_ERROR,
          ERROR_CODES.ELEVENLABS_TIMEOUT,
          ERROR_CODES.VOICE_RATE_LIMITED
        ].includes(error.code)) {
      return res.status(error.statusCode).json({
        success: false,
        voiceAvailable: false,
        error: {
          code: error.code,
          message: error.getFarmerMessage(language || 'en')
        }
      });
    }
    return handleRouteError(res, error, language);
  }
});

router.post('/speak/stream', requireActiveFarm, async (req, res) => {
  const startedAt = req.ttsRequestReceivedAt || performance.now();
  const clientElapsedMs = req.ttsClientElapsedMs;
  const { text } = req.body;
  const requestedLanguage = req.body.languageCode || req.body.language || 'en-IN';
  const language = requestedLanguage === 'auto'
    ? 'en'
    : resolveLanguage(requestedLanguage, { allowAuto: false });
  const controller = new AbortController();
  req.once('aborted', () => controller.abort());
  res.once('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Speech text must contain 1 to 8000 characters.', 400);
    }
    if (!language) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, or te-IN.', 400);
    }
    if (process.env.NODE_ENV === 'development') {
      console.debug('[AgriShield TTS Timing]', {
        stage: 'backend_request_received',
        elapsedMs: Math.round(performance.now() - startedAt),
        clientElapsedMs,
        language
      });
    }
    const result = await aiService.generateSpeechStream({
      text,
      languageCode: req.body.languageCode,
      language,
      ownerUid: req.farmerId,
      farmId: req.farmId,
      signal: controller.signal
    });

    res.status(200);
    res.set({
      'Content-Type': result.contentType || 'audio/mpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    if (process.env.NODE_ENV === 'development') {
      console.debug('[AgriShield TTS Timing]', {
        stage: 'backend_response_headers_sent',
        elapsedMs: Math.round(performance.now() - startedAt),
        clientElapsedMs
      });
    }
    let firstAudioChunk = true;
    result.stream.on('data', () => {
      if (!firstAudioChunk) return;
      firstAudioChunk = false;
      if (process.env.NODE_ENV === 'development') {
        console.debug('[AgriShield TTS Timing]', {
          stage: 'backend_first_audio_byte',
          elapsedMs: Math.round(performance.now() - startedAt),
          cacheHit: result.cacheHit
        });
      }
    });
    result.stream.on('error', (error) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AgriShield TTS] Audio stream ended unexpectedly:', error.code || error.name || 'stream_error');
      }
      if (!res.headersSent) {
        handleRouteError(res, error, language);
      } else if (!res.destroyed) {
        res.destroy(error);
      }
    });
    res.on('finish', () => {
      if (process.env.NODE_ENV === 'development') {
        console.debug('[AgriShield TTS Timing]', {
          stage: 'backend_stream_finished',
          elapsedMs: Math.round(performance.now() - startedAt),
          cacheHit: result.cacheHit
        });
      }
    });
    result.stream.pipe(res);
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return;
    return handleRouteError(res, error, language || 'en');
  }
});

router.post('/live-token', requireActiveFarm, async (req, res) => {
  const language = resolveLanguage(req.body.languageCode || req.body.language, { allowAuto: false });
  try {
    if (!language) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Language must be en-IN, hi-IN, or te-IN.', 400);
    }
    const liveSession = await aiService.createLiveVoiceSession({
      farmerId: req.farmerId,
      farmId: req.farmId,
      language
    });
    return res.json({ success: true, farmId: req.farmId, ...liveSession });
  } catch (error) {
    return handleRouteError(res, error, language);
  }
});

router.post('/live-message', requireActiveFarm, async (req, res) => {
  const { conversationId, role, message } = req.body;
  const language = resolveLanguage(req.body.languageCode || req.body.language, { allowAuto: false });
  if (typeof conversationId !== 'string' || !conversationId.trim() || conversationId.length > 128 ||
      !['user', 'assistant'].includes(role) ||
      typeof message !== 'string' || !message.trim() || message.length > 4000 ||
      !language) {
    return res.status(400).json({
      success: false,
      message: 'Live conversation message details are invalid.'
    });
  }
  try {
    const messageId = await conversationStorageService.saveMessage({
      farmerId: req.farmerId,
      ownerUid: req.farmerId,
      farmId: req.farmId,
      conversationId,
      role,
      message: message.trim(),
      language,
      intent: 'LIVE_VOICE'
    });
    if (!messageId) {
      return res.status(503).json({
        success: false,
        message: 'The Live Voice conversation could not be saved right now.'
      });
    }
    return res.json({ success: true, messageId });
  } catch (error) {
    console.error('[AgriShield AI] Live conversation message could not be stored:', {
      code: error.code || error.name || 'storage_error'
    });
    return res.status(503).json({
      success: false,
      message: 'The Live Voice conversation could not be saved right now.'
    });
  }
});

router.get('/voice-config', (req, res) => {
  const voiceStatus = elevenLabsService.getStatus();
  return res.json({
    success: true,
    maxRecordingSeconds: getAIConfig().voiceMaxRecordingSeconds,
    languages: Object.values(LANGUAGES).map(({ languageCode, languageName }) => ({
      languageCode,
      languageName
    })),
    stt: voiceStatus.stt,
    tts: voiceStatus.tts
  });
});

/**
 * 5. Start New Chat / Reset Session
 * POST /api/ai/clear
 */
router.post('/clear', requireActiveFarm, (req, res) => {
  const { conversationId } = req.body;
  if (typeof conversationId === 'string' && conversationId.length <= 128) {
    conversationService.clearSession(`${req.farmerId}:${req.farmId}:${conversationId}`);
  }
  return res.json({
    success: true,
    message: 'Conversation reset successfully',
    newConversationId: `conv-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  });
});

router.get('/conversations/:conversationId', requireActiveFarm, async (req, res) => {
  const { conversationId } = req.params;
  if (!conversationId || conversationId.length > 128) {
    return res.status(400).json({ success: false, message: 'Conversation ID is invalid.' });
  }
  try {
    const storedMessages = await conversationStorageService.getMessages(req.farmerId, req.farmId, conversationId, 100);
    const messages = storedMessages.map((message) => {
      if (!message.attachment) return message;
      if (message.ownerUid !== req.farmerId || message.farmId !== req.farmId ||
          message.conversationId !== conversationId ||
          message.attachment.ownerUid !== req.farmerId ||
          message.attachment.farmId !== req.farmId ||
          message.attachment.conversationId !== conversationId) {
        throw new AgriShieldError(ERROR_CODES.FARM_ACCESS_DENIED, 'This conversation contains an unauthorized image reference.', 403);
      }
      return {
        ...message,
        imageUrl: cloudinaryImageService.getSignedDeliveryUrl(message.attachment, {
          ownerUid: req.farmerId,
          farmId: req.farmId,
          conversationId
        })
      };
    });
    return res.json({ success: true, conversationId, messages });
  } catch (error) {
    if (error instanceof AgriShieldError && error.statusCode === 403) {
      return res.status(403).json({
        success: false,
        error: { code: error.code, message: error.getFarmerMessage('en') }
      });
    }
    console.error('[AgriShield AI] Conversation history lookup failed:', {
      provider: 'firestore',
      code: error.code || error.name || 'storage_error'
    });
    return res.status(503).json({ success: false, message: 'Conversation history could not be loaded right now.' });
  }
});

router.post('/feedback', requireActiveFarm, async (req, res) => {
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
      ownerUid: req.farmerId,
      farmId: req.farmId,
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
