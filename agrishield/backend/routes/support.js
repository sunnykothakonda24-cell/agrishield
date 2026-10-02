const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireFirebaseFarmer } = require('../middleware/firebaseAuth');
const localStorageService = require('../services/storage/localStorageService');
const firestoreRepository = require('../services/firestoreRepository');

const ISSUE_TYPES = [
  'Account',
  'Farm Setup',
  'Satellite Map',
  'Farm Data & Location',
  'AI Assistant',
  'Voice',
  'Image Analysis',
  'Notifications',
  'Other'
];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const FAQS = [
  { id: 'farm-setup', category: 'Farm Setup', question: 'How do I add my farm?', answer: 'Open your profile setup, enter your name, select or locate your farm, draw its boundary on the map, and save. Crop and soil details are optional.' },
  { id: 'boundary', category: 'Farm Setup', question: 'How do I mark my farm boundary?', answer: 'On Step 2, click or tap each corner of your farm on the map. Add at least three points to form a boundary. You can undo the last point, clear the boundary, and drag points to edit them.' },
  { id: 'satellite-map', category: 'Farm Setup', question: 'How does the satellite map work?', answer: 'Search for a place or use your device location, then select boundary points directly on the map. The selected coordinates are used to calculate farm area and perimeter.' },
  { id: 'farm-data', category: 'Farm Data & Location', question: 'How does AgriShield use my farm information?', answer: 'Your saved location and boundary identify the farm area used for weather and regional agriculture information. Crop, soil, and water details are optional and use only the information you provide.' },
  { id: 'farm-twin', category: 'Farm Twin', question: 'How does Farm Twin work?', answer: 'Farm Twin visualizes the saved farm boundary and uses current weather information from the configured external weather provider when available. It never claims a physical device observed a condition.' },
  { id: 'voice-ai', category: 'AgriShield AI Support', question: 'How do I use voice AI?', answer: 'Open AI Chat, allow microphone access when prompted, record your question, and submit it. Voice processing requires the backend transcription provider to be configured.' },
  { id: 'telugu', category: 'AgriShield AI Support', question: 'Can I ask questions in Telugu?', answer: 'The AI chat supports Telugu text and voice flows when the configured AI and speech services are available.' },
  { id: 'hindi', category: 'AgriShield AI Support', question: 'Can I ask questions in Hindi?', answer: 'The AI chat supports Hindi text and voice flows when the configured AI and speech services are available.' },
  { id: 'mobile-edit', category: 'Account Status', question: 'How do I edit my mobile number?', answer: 'Open your profile, choose the mobile-number edit option, and complete OTP verification for the new number.' },
  { id: 'report-issue', category: 'Contact Us', question: 'How do I report an issue?', answer: 'Open Contact Us, choose Report an Issue, describe what happened, select an issue type and priority, and submit the report.' },
  { id: 'otp-security', category: 'Account Status', question: 'How is my account protected?', answer: 'Sign-in and mobile-number changes use phone OTP verification. Never share an OTP with anyone.' }
];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return callback(null, true);
    return callback(new Error('Screenshot must be a JPG, PNG, or WEBP image.'));
  }
});

function respondWithError(res, error, label) {
  console.error(`[AgriShield Support] ${label}:`, error.message);
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'Screenshot must be 5 MB or smaller.' });
  }
  if (error.message === 'Screenshot must be a JPG, PNG, or WEBP image.') {
    return res.status(400).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: 'Unable to complete this request right now.' });
}

function verifiedImageMimeType(file) {
  const bytes = file.buffer;
  if (file.mimetype === 'image/jpeg' &&
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return file.mimetype;
  if (file.mimetype === 'image/png' &&
      bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return file.mimetype;
  if (file.mimetype === 'image/webp' &&
      bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return file.mimetype;
  return null;
}

router.get('/contact', (req, res) => {
  const phone = process.env.SUPPORT_PHONE?.trim() || null;
  const email = process.env.SUPPORT_EMAIL?.trim() || null;
  const phoneIsValid = phone && /^\+?[0-9().\-\s]{7,24}$/.test(phone);
  const emailIsValid = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return res.json({
    success: true,
    contact: {
      phone: phoneIsValid ? phone : null,
      email: emailIsValid ? email : null,
      available: Boolean(phoneIsValid || emailIsValid)
    }
  });
});

router.get('/faqs', (req, res) => res.json({ success: true, faqs: FAQS }));

router.get('/account-status', requireFirebaseFarmer, async (req, res) => {
  try {
    const [user, farm] = await Promise.all([
      firestoreRepository.getFarmer(req.farmerId),
      firestoreRepository.getFarmForUser(req.farmerId)
    ]);
    if (!user) return res.status(404).json({ success: false, message: 'Account information is not available.' });

    return res.json({
      success: true,
      account: {
        status: 'active',
        userId: req.farmerId,
        mobile: user.mobile || null,
        verified: typeof user.mobileVerified === 'boolean' ? user.mobileVerified : null,
        farmLocationSaved: Boolean(farm?.farmLocation?.latitude != null && farm?.farmLocation?.longitude != null)
      }
    });
  } catch (error) {
    return respondWithError(res, error, 'Account status lookup failed');
  }
});

router.post('/ticket', requireFirebaseFarmer, upload.single('screenshot'), async (req, res) => {
  let storedFile = null;
  try {
    if (!firestoreRepository.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Issue reports cannot be saved because Firestore is not configured. Please try again later.'
      });
    }
    const { issueType, description, priority = 'Normal' } = req.body;
    if (!ISSUE_TYPES.includes(issueType)) {
      return res.status(400).json({ success: false, message: 'Choose a valid issue type.' });
    }
    if (typeof description !== 'string' || description.trim().length < 5 || description.trim().length > 4000) {
      return res.status(400).json({ success: false, message: 'Describe the issue in 5 to 4,000 characters.' });
    }
    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Choose a valid priority.' });
    }

    if (req.file) {
      const mimeType = verifiedImageMimeType(req.file);
      if (!mimeType) return res.status(400).json({ success: false, message: 'The uploaded screenshot content does not match its image type.' });
      storedFile = await localStorageService.saveFile({
        buffer: req.file.buffer,
        category: 'support',
        mimeType
      });
    }

    const ticketId = await firestoreRepository.createRecord('supportTickets', {
      farmerId: req.farmerId,
      issueType,
      description: description.trim(),
      priority,
      attachmentPath: storedFile?.path || null,
      status: 'open'
    });
    return res.status(201).json({ success: true, ticketId, message: 'Your issue has been submitted successfully.' });
  } catch (error) {
    if (storedFile) {
      try {
        await localStorageService.deleteFile({ category: 'support', filename: storedFile.path.split('/').pop() });
      } catch (cleanupError) {
        console.error('[AgriShield Support] Failed to clean up an unlinked attachment:', cleanupError.message);
      }
    }
    return respondWithError(res, error, 'Ticket submission failed');
  }
});

router.post('/feedback', requireFirebaseFarmer, express.json(), async (req, res) => {
  try {
    if (!firestoreRepository.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Feedback cannot be saved because Firestore is not configured. Please try again later.'
      });
    }
    const { rating, message } = req.body;
    if (typeof message !== 'string' || message.trim().length < 2 || message.trim().length > 4000) {
      return res.status(400).json({ success: false, message: 'Enter feedback between 2 and 4,000 characters.' });
    }
    const parsedRating = rating === '' || rating === null || rating === undefined ? null : Number(rating);
    if (parsedRating !== null && (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5)) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }
    const feedbackId = await firestoreRepository.createRecord('supportFeedback', {
      farmerId: req.farmerId,
      rating: parsedRating,
      message: message.trim()
    });
    return res.status(201).json({ success: true, feedbackId, message: 'Your feedback has been submitted successfully.' });
  } catch (error) {
    return respondWithError(res, error, 'Feedback submission failed');
  }
});

module.exports = router;
