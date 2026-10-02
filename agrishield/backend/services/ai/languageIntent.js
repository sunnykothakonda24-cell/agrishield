const LANGUAGE_CODES = new Set(['auto', 'en', 'te', 'hi']);

const ROMAN_TELUGU = /\b(?:eppudu|epudu|pettali|pettala|petala|pettal|petali|pettaala|neellu|neeru|pantaku|aakulu|pasupu|naaku|cheppandi|vasthunda|avuthundi)\b/i;
const ROMAN_HINDI = /\b(?:paani|pani|fasal|khet|kheti|kab|chahiye|meri|mera|mere|mitti|sichai|sinchai|barish|baarish|kya|hai|kaise|karna|dena)\b/i;

const INTENT_PATTERNS = [
  ['IMAGE_ANALYSIS', /(?:image|photo|picture|photograph|ఫోటో|చిత్రం|चित्र|फोटो|तस्वीर)/i],
  ['ALERTS', /(?:alert|notification|warning|అలర్ట్|హెచ్చరిక|सूचना|चेतावनी)/i],
  ['FARM_TWIN', /(?:farm twin|digital twin|simulation|simulate|సిమ్యులేషన్|डिजिटल ट्विन)/i],
  ['WEATHER', /(?:weather|forecast|rain|rainfall|temperature|hotter|precipitation|clouds?|wind|spray.*today|spray.*rain|irrigat.*rain|वातावरणం|వర్షం|వర్షపాతం|వాన|మేఘం|మబ్బులు|గాలి.*దిశ|స్ప్రే.*ఈరోజు|గత నెల.*(?:వేడి|ఉష్ణోగ్రత)|बारिश|मौसम|वर्षा|तापमान|गर्मी|बादल|हवा.*दिशा|छिड़काव.*आज|पिछले महीने.*(?:गर्म|तापमान))/i],
  ['SOIL', /(?:soil| मिट्टी|మట్టి|నేల|భూసారం|soil type|మట్టిరకం|मिट्टी|मृदा)/i],
  ['MARKET', /(?:market|price|mandi|మార్కెట్|ధర|ధరలు|మండీ|बाजार|मंडी|भाव|कीमत)/i],
  ['GOVERNMENT_SCHEME', /(?:scheme|subsidy|government|yojana|పథకం|సబ్సిడీ|ప్రభుత్వం|योजना|सरकारी|सब्सिडी)/i],
  ['EXPERT_SUPPORT', /(?:expert|kvk|extension officer|agronomist|నిపుణుడు|వ్యవసాయ అధికారి|కేవీకే|विशेषज्ञ|कृषि अधिकारी|केवीके)/i],
  ['PEST_DISEASE', /(?:pest|disease|insect|yellow|spot|wilting|rot|fungus|what.*(?:wrong|happening).*plant|leaves? turning|తెగులు|పురుగు|పసుపు|మచ్చ|వాడిపో|కుళ్ళు|ఆకులు.*మార|ఆకు.*సమస్య|రంగు మారిన|रोग|कीट|पीले|धब्बे|मुरझा|पत्ते.*पीले)/i],
  ['IRRIGATION_ADVISOR', /(?:water|irrigat|paani|neeru|neellu|తడి|నీళ్లు|నీరు|పెట్టాలా|నీళ్లు పెట్ట|पानी|सिंचाई|सींच|पानी देना)/i],
  ['CROP_RECOMMENDATION', /(?:which crop|recommend.*crop|crop.*recommend|what to grow|ఏ పంట వేయాలి|పంట సూచించ|कौन सी फसल|फसल.*सुझाव)/i],
  ['CROP_ADVISOR', /(?:crop|cultivat|yield|harvest|fertiliz|nutrient|పంట|సాగు|దిగుబడి|ఎరువు|పంటకు|फसल|खेती|उपज|खाद|उर्वरक)/i],
  ['FARM_STATUS', /(?:my farm|farm status|my field|నా పొలం|నా వ్యవసాయం|मेरा खेत|मेरे खेत)/i]
];

function normalizeLanguage(language) {
  return LANGUAGE_CODES.has(language) ? language : 'auto';
}

function detectLanguage(text = '', preferredLanguage = 'auto') {
  const source = String(text);
  let teluguCount = 0;
  let devanagariCount = 0;
  for (const character of source) {
    const code = character.codePointAt(0);
    if (code >= 0x0c00 && code <= 0x0c7f) teluguCount += 1;
    if (code >= 0x0900 && code <= 0x097f) devanagariCount += 1;
  }

  if (teluguCount > 0 || devanagariCount > 0) {
    return teluguCount >= devanagariCount ? 'te' : 'hi';
  }

  if (ROMAN_TELUGU.test(source)) return 'te';
  if (ROMAN_HINDI.test(source)) return 'hi';
  if (preferredLanguage === 'en' || preferredLanguage === 'te' || preferredLanguage === 'hi') {
    return preferredLanguage;
  }
  return 'en';
}

function detectIntent(text = '', hasImage = false) {
  if (hasImage) return 'IMAGE_ANALYSIS';
  const source = String(text);
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(source)) return intent;
  }
  return 'GENERAL_CONVERSATION';
}

module.exports = { detectLanguage, detectIntent, normalizeLanguage };
