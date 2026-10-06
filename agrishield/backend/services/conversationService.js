/**
 * Conversation Service
 * Manages in-memory conversation sessions, message history, context compression,
 * temporal tracking, and farmer-specific context updates.
 */

class ConversationService {
  constructor() {
    this.sessions = new Map();
    // Maximum turns before compression kicks in
    this.maxRecentTurns = 10;
  }

  /**
   * Retrieves or creates a conversation session
   */
  getSession(conversationId = 'default-session') {
    if (!this.sessions.has(conversationId)) {
      this.sessions.set(conversationId, {
        id: conversationId,
        title: 'New Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        context: {
          crop: null,
          cropStage: null,
          soilType: null,
          location: null,
          activeIssue: null,
          symptoms: [],
          lastCategory: null,
          farmerReportedCropAgeDays: null,
          farmerReportedPlantingDate: null,
          farmerReportedWaterSource: null
        },
        summary: '',
        messages: []
      });
    }
    return this.sessions.get(conversationId);
  }

  /**
   * Adds a message to the session and updates active context
   */
  addMessage(conversationId, { role, content, image = null, audio = null, metadata = {} }) {
    const session = this.getSession(conversationId);
    const timestamp = new Date().toISOString();

    const messageObj = {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      role, // 'user' | 'assistant' | 'system'
      content,
      image,
      audio,
      metadata,
      timestamp
    };

    session.messages.push(messageObj);
    session.updatedAt = timestamp;

    // Auto-generate title from the first user message if still default
    if (session.messages.length === 1 && role === 'user' && typeof content === 'string') {
      const cleanTitle = content.trim().slice(0, 35);
      session.title = cleanTitle.length >= 35 ? `${cleanTitle}...` : cleanTitle;
    }

    // Context tracking & user correction detection (e.g. "I meant chilli, not tomato")
    if (role === 'user' && typeof content === 'string') {
      this.extractAndUpdateContext(session, content);
    }

    // Context window compression if message list exceeds 20
    if (session.messages.length > 20) {
      this.compressHistory(session);
    }

    return messageObj;
  }

  /**
   * Extracts farmer context and detects user corrections
   */
  extractAndUpdateContext(session, text) {
    const lower = text.toLowerCase();

    const correctionMatch = lower.match(/(?:not|kaadhu|nahi)\s+([a-z]+)[,\s]+(?:it is|i meant|meant|but|kaani|lekin)\s+([a-z]+)/i);
    if (correctionMatch) {
      const correctedNew = correctionMatch[2].trim();
      session.context.crop = correctedNew.charAt(0).toUpperCase() + correctedNew.slice(1);
    } else {
      const crops = [
        ['Tomato', /\btomato(?:es)?\b|टमाटर|టమాట(?:ా)?|టమోట(?:ా)?/i],
        ['Chilli', /\b(?:chilli|chili|pepper)\b|మిరప|మిర్చి|मिर्च/i],
        ['Cotton', /\bcotton\b|పత్తి|कपास/i],
        ['Rice', /\b(?:rice|paddy)\b|వరి|धान|चावल/i],
        ['Groundnut', /\bgroundnut\b|వేరుశెనగ|मूंगफली/i],
        ['Maize', /\bmaize\b|మొక్కజొన్న|मक्का/i],
        ['Onion', /\bonion\b|ఉల్లిపాయ|प्याज/i],
        ['Brinjal', /\bbrinjal\b|వంకాయ|बैंगन/i],
        ['Turmeric', /\bturmeric\b|పసుపు పంట|हल्दी/i]
      ];
      for (const [crop, pattern] of crops) {
        if (pattern.test(text)) {
          session.context.crop = crop;
          break;
        }
      }
    }

    if (/(?:yellow|spot|wilting|rot|disease|పసుపు|మచ్చ|వాడిపో|తెగులు|पीले|धब्बे|मुरझा|रोग)/i.test(text)) {
      session.context.activeIssue = text.trim().slice(0, 240);
      session.context.symptoms = [...new Set([...session.context.symptoms, text.trim().slice(0, 120)])].slice(-5);
    }

    const cropAgeMatch = text.match(
      /(?:crop|paddy|rice|field|plant|పంట|వరి|खेत|फसल)[^\d]{0,40}(\d{1,3})\s*(?:days?|రోజుల|दिन)(?:\s*(?:old|ago|వయస్సు|వయసు|पुराना|पहले))?/i
    ) || text.match(/\b(\d{1,3})\s*(?:days?|రోజుల|दिन)\s*(?:old|ago|పాత|पुराना|पहले)\b/i);
    if (cropAgeMatch) session.context.farmerReportedCropAgeDays = Number(cropAgeMatch[1]);

    const plantingDateMatch = text.match(
      /(?:planted|sown|transplanted|నాటిన|విత్తిన|बोया|रोपा)[^\d]{0,24}(\d{4}-\d{2}-\d{2})/i
    );
    if (plantingDateMatch) session.context.farmerReportedPlantingDate = plantingDateMatch[1];

    const waterSourceNames = '(canal|borewell|bore\\s*well|open\\s*well|rain[ -]?fed|river|tank|drip|కాలువ|బోర్‌వెల్|బోరు|బావి|विहीर|नहर|बोरवेल|कुआँ)';
    const changedWaterSource = text.match(new RegExp(
      `(?:changed|switched|చేర్చాను|మార్చాను|बदला|बदलकर)[\\s\\S]{0,40}?${waterSourceNames}[\\s\\S]{0,24}?(?:to|గా|కు|में)\\s*${waterSourceNames}`,
      'i'
    ));
    const currentWaterSource = changedWaterSource?.[2] || text.match(new RegExp(
      `(?:use|using|water source is|నీటి వనరు|నీరు|पानी का स्रोत|सिंचाई)[\\s\\S]{0,24}?${waterSourceNames}`,
      'i'
    ))?.[1];
    if (currentWaterSource) {
      session.context.farmerReportedWaterSource = currentWaterSource.trim();
    }
  }

  restoreHistory(conversationId, history = []) {
    const session = this.getSession(conversationId);
    if (session.messages.length > 0 || !Array.isArray(history)) return;

    history.slice(-20).forEach((message) => {
      if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') return;
      const content = message.content.trim().slice(0, 4000);
      if (content) this.addMessage(conversationId, { role: message.role, content });
    });
  }

  /**
   * Condenses older messages into a compact summary to maintain token bounds
   */
  compressHistory(session) {
    const olderMessages = session.messages.slice(0, -this.maxRecentTurns);
    const recentMessages = session.messages.slice(-this.maxRecentTurns);

    const summarizedPoints = olderMessages
      .filter(m => m.role === 'user')
      .map(m => m.content.slice(0, 80))
      .join('; ');

    session.summary = `Earlier discussion topics: ${summarizedPoints}`;
    session.messages = recentMessages;
  }

  /**
   * Gets context-trimmed message history formatted for AI providers
   */
  getFormattedHistory(conversationId) {
    const session = this.getSession(conversationId);
    const history = [];

    for (const msg of session.messages) {
      history.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    return {
      history,
      context: session.context,
      summary: session.summary
    };
  }

  /**
   * Resets / clears a conversation session
   */
  clearSession(conversationId) {
    if (this.sessions.has(conversationId)) {
      this.sessions.delete(conversationId);
    }
    return this.getSession(conversationId);
  }
}

const conversationService = new ConversationService();
module.exports = conversationService;
