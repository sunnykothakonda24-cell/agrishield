/**
 * Centralized AI Error Handling for AgriShield-AI
 * Maps technical exceptions and HTTP status codes into farmer-friendly messages in Telugu, Hindi, and English.
 */

const ERROR_CODES = {
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_RATE_LIMIT: 'AI_RATE_LIMIT',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  AUDIO_TOO_LARGE: 'AUDIO_TOO_LARGE',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  TTS_FAILED: 'TTS_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  AUTH_REQUIRED: 'AUTH_REQUIRED'
};

const FARMER_FRIENDLY_MESSAGES = {
  AI_NOT_CONFIGURED: {
    te: "AgriShield AI ప్రస్తుతం అందుబాటులో లేదు. దయచేసి కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.",
    hi: "AgriShield AI अभी उपलब्ध नहीं है। कृपया कुछ देर बाद फिर से प्रयास करें।",
    en: "AgriShield AI is temporarily unavailable. Please try again in a moment."
  },
  AUTH_REQUIRED: {
    te: "మీ సెషన్ ముగిసింది. దయచేసి మళ్లీ సైన్ ఇన్ చేయండి.",
    hi: "आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।",
    en: "Your session has expired. Please sign in again."
  },
  AI_TIMEOUT: {
    te: "కనెక్ట్ కావడానికి ఎక్కువ సమయం పడుతోంది. దయచేసి ఒక క్షణం తర్వాత మళ్ళీ ప్రయత్నించండి.",
    hi: "जवाब मिलने में अधिक समय लग रहा है। कृपया कुछ देर बाद पुनः प्रयास करें।",
    en: "The AI service took too long to respond. Please try again in a moment."
  },
  AI_RATE_LIMIT: {
    te: "చాలా ప్రశ్నలు అడిగారు. దయచేసి కాసేపు ఆగి మళ్ళీ ప్రయత్నించండి.",
    hi: "बहुत सारे अनुरोध प्राप्त हुए हैं। कृपया कुछ क्षण रुककर पुनः प्रयास करें।",
    en: "We're receiving many requests right now. Please wait a brief moment and try again."
  },
  IMAGE_TOO_LARGE: {
    te: "మీరు పంపిన ఫోటో చాలా పెద్దదిగా ఉంది. దయచేసి 10MB లోపు ఫోటోను అప్‌లోడ్ చేయండి.",
    hi: "अपलोड किया गया फोटो बहुत बड़ा है। कृपया 10MB से छोटा फोटो चुनें।",
    en: "The uploaded image is too large. Please select an image under 10MB."
  },
  AUDIO_TOO_LARGE: {
    te: "వాయిస్ రికార్డింగ్ చాలా పెద్దదిగా ఉంది. దయచేసి చిన్న సందేశాన్ని పంపండి.",
    hi: "आवाज रिकॉर्डिंग बहुत लंबी है। कृपया छोटा संदेश भेजें।",
    en: "Audio recording is too large. Please send a shorter voice message."
  },
  UNSUPPORTED_FILE: {
    te: "ఈ ఫైల్ ఫార్మాట్ సపోర్ట్ చేయదు. దయచేసి JPG, PNG లేదా WEBP ఫోటోను ఎంచుకోండి.",
    hi: "यह फाइल फॉर्मेट समर्थित नहीं है। कृपया JPG, PNG या WEBP फोटो चुनें।",
    en: "Unsupported file format. Please upload a JPG, PNG, or WEBP image."
  },
  TRANSCRIPTION_FAILED: {
    te: "మీరు మాట్లాడింది స్పష్టంగా రికార్డ్ కాలేదు. దయచేసి మైక్రోఫోన్‌కు దగ్గరగా మాట్లాడండి.",
    hi: "आपकी आवाज स्पष्ट सुनाई नहीं दी। कृपया माइक के पास आकर दोबारा बोलें।",
    en: "I couldn't hear clearly. Please speak closer to the microphone and try again."
  },
  TTS_FAILED: {
    te: "వాయిస్ ఆడియో ప్లే చేయడంలో సమస్య వచ్చింది. దయచేసి సమాధానం చదవండి.",
    hi: "आवाज चलाने में समस्या आई। कृपया उत्तर पढ़कर देखें।",
    en: "Could not generate speech audio. Please read the response text."
  },
  DEFAULT: {
    te: "సమాధానం తీసుకురావడంలో చిన్న సమస్య ఎదురైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
    hi: "उत्तर लाने में समस्या हुई। कृपया दोबारा प्रयास करें।",
    en: "Something went wrong while connecting to the AI. Please try again."
  }
};

class AgriShieldError extends Error {
  constructor(code, technicalMessage = '', statusCode = 500) {
    super(technicalMessage || code);
    this.name = 'AgriShieldError';
    this.code = code;
    this.statusCode = statusCode;
    this.technicalMessage = technicalMessage;
  }

  getFarmerMessage(lang = 'te') {
    const messages = FARMER_FRIENDLY_MESSAGES[this.code] || FARMER_FRIENDLY_MESSAGES.DEFAULT;
    return messages[lang] || messages.en || messages.te;
  }
}

module.exports = {
  ERROR_CODES,
  FARMER_FRIENDLY_MESSAGES,
  AgriShieldError
};
