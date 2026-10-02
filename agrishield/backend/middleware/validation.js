const multer = require('multer');
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');

// Memory storage for temporary in-memory processing (no permanent file leak)
const storage = multer.memoryStorage();

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

// Allowed audio MIME types
const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/m4a',
  'audio/mp4'
];

function imageMatchesMime(image, mime) {
  if (!Buffer.isBuffer(image)) return false;
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  }
  if (mime === 'image/png') {
    return image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mime === 'image/webp') {
    return image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

const imageUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AgriShieldError(ERROR_CODES.UNSUPPORTED_FILE, `Unsupported file mime: ${file.mimetype}`, 400));
    }
  }
});

function receiveImage(req, res, next) {
  imageUpload.fields([
    { name: 'imageFile', maxCount: 1 },
    { name: 'image', maxCount: 1 }
  ])(req, res, (error) => {
    if (error) return next(error);
    const uploaded = req.files?.imageFile?.[0] || req.files?.image?.[0] || null;
    if (req.files?.imageFile?.length && req.files?.image?.length) {
      return next(new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Send only one image per request.', 400));
    }
    if (uploaded) req.file = uploaded;
    return next();
  });
}

const audioUpload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_AUDIO_TYPES.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new AgriShieldError(ERROR_CODES.UNSUPPORTED_FILE, `Unsupported audio mime: ${file.mimetype}`, 400));
    }
  }
});

/**
 * Validate chat request body
 */
function validateChatInput(req, res, next) {
  const { message, image } = req.body;
  const file = req.file;
  const language = req.body.language;
  const conversationId = req.body.conversationId;

  if (!message && !image && !file) {
    return res.status(400).json({
      success: false,
      error: {
        code: ERROR_CODES.INVALID_INPUT,
        message: 'A message or image is required to consult AgriShield-AI.'
      }
    });
  }

  if (message !== undefined && (typeof message !== 'string' || message.length > 4000)) {
    return res.status(400).json({
      success: false,
      error: { code: ERROR_CODES.INVALID_INPUT, message: 'Message must be 4000 characters or fewer.' }
    });
  }
  if (language !== undefined && !['auto', 'en', 'te', 'hi'].includes(language)) {
    return res.status(400).json({
      success: false,
      error: { code: ERROR_CODES.INVALID_INPUT, message: 'Language must be auto, en, te, or hi.' }
    });
  }
  if (conversationId !== undefined && (typeof conversationId !== 'string' || conversationId.length > 128)) {
    return res.status(400).json({
      success: false,
      error: { code: ERROR_CODES.INVALID_INPUT, message: 'Conversation ID is invalid.' }
    });
  }

  let history = req.body.history;
  if (typeof history === 'string') {
    try {
      history = JSON.parse(history);
    } catch {
      return res.status(400).json({
        success: false,
        error: { code: ERROR_CODES.INVALID_INPUT, message: 'Conversation history is invalid.' }
      });
    }
  }
  if (history !== undefined && (!Array.isArray(history) || history.length > 20 ||
      history.some((entry) => !['user', 'assistant'].includes(entry?.role) ||
        typeof entry.content !== 'string' || entry.content.length > 4000))) {
    return res.status(400).json({
      success: false,
      error: { code: ERROR_CODES.INVALID_INPUT, message: 'Conversation history is invalid.' }
    });
  }

  // Check base64 image size if sent as base64 string
  if (image && typeof image === 'string' && image.startsWith('data:image')) {
    const stringLength = image.length - 'data:image/png;base64,'.length;
    const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.5624896334383612;
    if (sizeInBytes > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: {
          code: ERROR_CODES.IMAGE_TOO_LARGE,
          message: 'Image size exceeds maximum limit of 10MB.'
        }
      });
    }
  }

  next();
}

function validateImageContent(req, res, next) {
  if (req.file && !imageMatchesMime(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: { code: ERROR_CODES.UNSUPPORTED_FILE, message: 'The image content does not match its file type.' }
    });
  }

  if (req.body.image !== undefined) {
    const match = typeof req.body.image === 'string' &&
      req.body.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || !imageMatchesMime(Buffer.from(match[2], 'base64'), match[1])) {
      return res.status(400).json({
        success: false,
        error: { code: ERROR_CODES.UNSUPPORTED_FILE, message: 'The image content does not match its file type.' }
      });
    }
  }
  return next();
}

module.exports = {
  imageUpload,
  receiveImage,
  audioUpload,
  validateChatInput,
  validateImageContent,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_AUDIO_TYPES,
  imageMatchesMime
};
