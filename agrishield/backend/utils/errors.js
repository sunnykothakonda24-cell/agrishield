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
  IMAGE_ANALYSIS_UNAVAILABLE: 'IMAGE_ANALYSIS_UNAVAILABLE',
  CLOUDINARY_NOT_CONFIGURED: 'CLOUDINARY_NOT_CONFIGURED',
  IMAGE_UPLOAD_FAILED: 'IMAGE_UPLOAD_FAILED',
  IMAGE_RETRIEVAL_FAILED: 'IMAGE_RETRIEVAL_FAILED',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  AUDIO_TOO_LARGE: 'AUDIO_TOO_LARGE',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  STT_NOT_CONFIGURED: 'STT_NOT_CONFIGURED',
  ELEVENLABS_AUTH_FAILED: 'ELEVENLABS_AUTH_FAILED',
  ELEVENLABS_REQUEST_REJECTED: 'ELEVENLABS_REQUEST_REJECTED',
  ELEVENLABS_PROVIDER_ERROR: 'ELEVENLABS_PROVIDER_ERROR',
  ELEVENLABS_TIMEOUT: 'ELEVENLABS_TIMEOUT',
  VOICE_RATE_LIMITED: 'VOICE_RATE_LIMITED',
  TTS_FAILED: 'TTS_FAILED',
  TTS_NOT_CONFIGURED: 'TTS_NOT_CONFIGURED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FARM_ACCESS_DENIED: 'FARM_ACCESS_DENIED'
};

const FARMER_FRIENDLY_MESSAGES = {
  AI_PROVIDER_ERROR: {
    te: "AI సేవ ప్రస్తుతం స్పందించడం లేదు. దయచేసి కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.",
    hi: "AI सेवा अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर से प्रयास करें।",
    en: "The AI service is temporarily unavailable. Please try again shortly."
  },
  IMAGE_ANALYSIS_UNAVAILABLE: {
    te: "చిత్ర విశ్లేషణ తాత్కాలికంగా అందుబాటులో లేదు. దయచేసి మళ్లీ ప్రయత్నించండి.",
    hi: "छवि विश्लेषण अभी अस्थायी रूप से उपलब्ध नहीं है। कृपया फिर से प्रयास करें।",
    en: "Image analysis is temporarily unavailable. Please try again."
  },
  CLOUDINARY_NOT_CONFIGURED: {
    te: "చిత్ర నిల్వ సేవ సర్వర్‌లో కాన్ఫిగర్ కాలేదు. దయచేసి మద్దతును సంప్రదించండి.",
    hi: "चित्र संग्रहण सेवा सर्वर पर कॉन्फ़िगर नहीं है। कृपया सहायता से संपर्क करें।",
    en: "Image storage is not configured on the server. Please contact support."
  },
  IMAGE_UPLOAD_FAILED: {
    te: "చిత్రాన్ని అప్‌లోడ్ చేయలేకపోయాం. దయచేసి మళ్లీ ప్రయత్నించండి.",
    hi: "छवि अपलोड नहीं हो सकी। कृपया फिर से प्रयास करें।",
    en: "Image upload failed. Please try again."
  },
  IMAGE_RETRIEVAL_FAILED: {
    te: "సేవ్ చేసిన చిత్రాన్ని పొందలేకపోయాం. దయచేసి చిత్రాన్ని మళ్లీ ఎంచుకోండి.",
    hi: "सहेजी गई छवि प्राप्त नहीं हो सकी। कृपया छवि फिर से चुनें।",
    en: "The saved image could not be retrieved. Please select it again."
  },
  AI_NOT_CONFIGURED: {
    te: "AgriShield AI సర్వర్‌లో సరిగా కాన్ఫిగర్ కాలేదు. దయచేసి మద్దతును సంప్రదించండి.",
    hi: "AgriShield AI सर्वर पर कॉन्फ़िगर नहीं है। कृपया सहायता से संपर्क करें।",
    en: "AgriShield AI is not configured on the server. Please contact support."
  },
  AUTH_REQUIRED: {
    te: "మీ సెషన్ ముగిసింది. దయచేసి మళ్లీ సైన్ ఇన్ చేయండి.",
    hi: "आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।",
    en: "Your session has expired. Please sign in again."
  },
  FARM_ACCESS_DENIED: {
    te: "ఈ పొలం మీ ఖాతాకు అందుబాటులో లేదు. దయచేసి మీ సక్రియ పొలాన్ని ఎంచుకోండి.",
    hi: "यह खेत आपके खाते के लिए उपलब्ध नहीं है। कृपया अपना सक्रिय खेत चुनें।",
    en: "This farm is not available to your account. Please select your active farm."
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
  STT_NOT_CONFIGURED: {
    te: "వాయిస్ గుర్తింపు సేవ ప్రస్తుతం అందుబాటులో లేదు. మీరు సందేశాన్ని టైప్ చేయవచ్చు.",
    hi: "वॉइस पहचान सेवा अभी उपलब्ध नहीं है। आप संदेश टाइप कर सकते हैं।",
    en: "Voice transcription is unavailable right now. You can type your message instead."
  },
  ELEVENLABS_AUTH_FAILED: {
    te: "వాయిస్ సేవ ధృవీకరణ విఫలమైంది. సందేశాన్ని టైప్ చేసి ప్రయత్నించండి.",
    hi: "वॉइस सेवा का प्रमाणीकरण विफल हुआ। कृपया संदेश टाइप करें।",
    en: "ElevenLabs authentication failed. Please type your message instead."
  },
  ELEVENLABS_REQUEST_REJECTED: {
    te: "వాయిస్ సేవ ఈ అభ్యర్థనను అంగీకరించలేదు. సందేశాన్ని టైప్ చేసి ప్రయత్నించండి.",
    hi: "वॉइस सेवा ने इस अनुरोध को स्वीकार नहीं किया। कृपया संदेश टाइप करें।",
    en: "ElevenLabs could not accept this voice request. Please try again or type your message."
  },
  ELEVENLABS_PROVIDER_ERROR: {
    te: "వాయిస్ సేవలో తాత్కాలిక సమస్య ఉంది. దయచేసి మళ్లీ ప్రయత్నించండి.",
    hi: "वॉइस सेवा में अस्थायी समस्या है। कृपया फिर से प्रयास करें।",
    en: "ElevenLabs is temporarily unavailable. Please try again."
  },
  ELEVENLABS_TIMEOUT: {
    te: "వాయిస్ సేవ స్పందించడానికి ఎక్కువ సమయం తీసుకుంది. దయచేసి మళ్లీ ప్రయత్నించండి.",
    hi: "वॉइस सेवा ने जवाब देने में बहुत समय लिया। कृपया फिर से प्रयास करें।",
    en: "ElevenLabs took too long to respond. Please try again."
  },
  VOICE_RATE_LIMITED: {
    te: "వాయిస్ అభ్యర్థనలు చాలా ఎక్కువయ్యాయి. కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.",
    hi: "वॉइस अनुरोधों की सीमा पूरी हुई। थोड़ी देर बाद फिर प्रयास करें।",
    en: "Voice requests are temporarily rate limited. Please try again shortly."
  },
  TTS_NOT_CONFIGURED: {
    te: "వాయిస్ ప్లేబ్యాక్ ప్రస్తుతం అందుబాటులో లేదు. సమాధానం టెక్స్ట్‌గా ఉంది.",
    hi: "आवाज प्लेबैक अभी उपलब्ध नहीं है। उत्तर टेक्स्ट में उपलब्ध है।",
    en: "Voice playback is unavailable right now. The answer is still available as text."
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
