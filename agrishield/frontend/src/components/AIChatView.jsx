import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  User, 
  Send, 
  Mic, 
  Camera, 
  Image as ImageIcon, 
  CloudRain,
  CheckCircle2, 
  AlertTriangle,
  X, 
  Play, 
  Pause, 
  Square,
  Globe, 
  ChevronDown, 
  WifiOff, 
  RefreshCw,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  PlusCircle,
  ShieldCheck,
  StopCircle
} from 'lucide-react';
import { updateAppPreferences } from '../services/appPreferences';
import { useAppPreferences } from '../services/useAppPreferences';
import { 
  sendMessageToAI, 
  transcribeVoice, 
  getAIConversation,
  clearAIConversation,
  speakVoice,
  submitAIFeedback
} from '../services/api';

// Multi-lingual UI Strings (Section 4, 14, 15, 43, 193)
const TRANSLATIONS = {
  te: {
    title: 'అగ్రిషీల్డ్ AI',
    subtitle: 'రైతు నేస్తం • నిజమైన AI సంభాషణ సహాయకుడు',
    assistantLabel: 'ఏఐ సహాయకుడు',
    assistantSub: 'మీ వ్యవసాయ సహాయకుడు',
    weatherMap: 'వాతావరణ మ్యాప్',
    openWeatherMap: 'వాతావరణ, వర్షపు మ్యాప్ తెరవండి',
    changeLanguage: 'భాష మార్చండి',
    auto: 'ఆటో',
    autoDetect: 'భాషను స్వయంచాలకంగా గుర్తించండి',
    farmerProfile: 'రైతు ప్రొఫైల్',
    farmer: 'రైతు',
    cropNotSpecified: 'పంట వివరాలు లేవు',
    placeholder: 'ఏదైనా అడగండి లేదా మాట్లాడటానికి మైక్ నొక్కండి...',
    recording: 'రికార్డింగ్ అవుతోంది...',
    recordingSub: 'స్పష్టంగా మాట్లాడండి',
    cancel: 'రద్దు',
    send: 'పంపండి',
    thinking: 'అగ్రిషీల్డ్-AI సమాధానం సిద్ధం చేస్తోంది...',
    stopGenerating: 'ఆపండి',
    tryAgain: 'మళ్ళీ ప్రయత్నించండి',
    errorGeneral: 'మీ ప్రశ్నకు సమాధానం ఇవ్వడంలో సమస్య ఎదురైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.',
    errorSpeech: 'మీరు చెప్పింది సరిగ్గా అర్థం కాలేదు. దయచేసి మరోసారి చెప్పగలరా?',
    offlineAlert: 'ఇంటర్నెట్ కనెక్షన్ అందుబాటులో లేదు. దయచేసి మీ నెట్‌వర్క్ తనిఖీ చేయండి.',
    listen: 'వినండి',
    pause: 'పాజ్',
    resume: 'ప్లే',
    stop: 'ఆపండి',
    copy: 'కాపీ',
    copied: 'కాపీ చేయబడింది!',
    newChat: 'కొత్త సంభాషణ',
    whatIsHappening: 'ఏం జరుగుతోంది',
    whatYouShouldDo: 'మీరు చేయాల్సింది',
    warning: 'ముఖ్యమైన హెచ్చరిక',
    nextStep: 'తదుపరి అడుగు',
    welcomeTitle: 'నమస్కారం! నేను అగ్రిషీల్డ్-AI.',
    welcomeSub: 'మీ వ్యవసాయం, పంటలు, వాతావరణం లేదా ఇతర అవసరాల గురించి అడగండి.',
    voiceBubblePrefix: 'మీరు చెప్పారు'
  },
  hi: {
    title: 'एग्रीशील्ड AI',
    subtitle: 'किसान साथी • वास्तविक AI कृषि संवाद सहायक',
    assistantLabel: 'AI सहायक',
    assistantSub: 'आपका खेती सहायक',
    weatherMap: 'मौसम मानचित्र',
    openWeatherMap: 'मौसम और वर्षा मानचित्र खोलें',
    changeLanguage: 'भाषा बदलें',
    auto: 'ऑटो',
    autoDetect: 'भाषा अपने आप पहचानें',
    farmerProfile: 'किसान प्रोफ़ाइल',
    farmer: 'किसान',
    cropNotSpecified: 'फसल की जानकारी नहीं',
    placeholder: 'कुछ भी पूछें या बोलने के लिए माइक दबाएं...',
    recording: 'रिकॉर्डिंग जारी है...',
    recordingSub: 'माइक के पास स्पष्ट बोलें',
    cancel: 'रद्द करें',
    send: 'भेजें',
    thinking: 'एग्रीशील्ड-AI जवाब तैयार कर रहा है...',
    stopGenerating: 'रोकें',
    tryAgain: 'पुनः प्रयास करें',
    errorGeneral: 'आपके प्रश्न का उत्तर देने में समस्या हुई। कृपया दोबारा प्रयास करें।',
    errorSpeech: 'आपकी आवाज स्पष्ट सुनाई नहीं दी। कृपया दोबारा बोलें।',
    offlineAlert: 'इंटरनेट कनेक्शन उपलब्ध नहीं है। कृपया नेटवर्क जांचें।',
    listen: 'सुनें',
    pause: 'रोकें',
    resume: 'चलाएं',
    stop: 'बंद करें',
    copy: 'कॉपी',
    copied: 'कॉपी हो गया!',
    newChat: 'नई बातचीत',
    whatIsHappening: 'क्या हो रहा है',
    whatYouShouldDo: 'आपको क्या करना चाहिए',
    warning: 'महत्वपूर्ण सावधानी',
    nextStep: 'अगला कदम',
    welcomeTitle: 'नमस्ते! मैं एग्रीशील्ड-AI हूँ।',
    welcomeSub: 'खेती, फसलों, पौधों, मिट्टी या दैनिक जीवन के बारे में कुछ भी पूछें।',
    voiceBubblePrefix: 'आपने कहा'
  },
  en: {
    title: 'AgriShield AI',
    subtitle: 'Farmer Companion • Multimodal Agronomy Assistant',
    assistantLabel: 'AI Assistant',
    assistantSub: 'Your farming assistant',
    weatherMap: 'Weather map',
    openWeatherMap: 'Open Weather and Rain Map',
    changeLanguage: 'Change language',
    auto: 'Auto',
    autoDetect: 'Auto detect',
    farmerProfile: 'Farmer Profile',
    farmer: 'Farmer',
    cropNotSpecified: 'Crop not specified',
    placeholder: 'Message AgriShield AI...',
    recording: 'Recording...',
    recordingSub: 'Speak clearly into the microphone',
    cancel: 'Cancel',
    send: 'Send',
    thinking: 'AgriShield-AI is preparing a response...',
    stopGenerating: 'Stop',
    tryAgain: 'Try Again',
    errorGeneral: "I couldn't process your question right now. Please try again.",
    errorSpeech: "I couldn't understand that clearly. Please say it again.",
    offlineAlert: 'Internet connection is unavailable. Please check your connection.',
    listen: 'Listen',
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    copy: 'Copy',
    copied: 'Copied!',
    newChat: 'New chat',
    whatIsHappening: 'What is happening',
    whatYouShouldDo: 'What you should do',
    warning: 'Important Precautions',
    nextStep: 'Next Step',
    welcomeTitle: "Hello! I'm AgriShield-AI.",
    welcomeSub: 'Ask me anything about farming, crops, plants, soil, or everyday questions.',
    voiceBubblePrefix: 'You said'
  }
};

/**
 * XSS-Safe Markdown to JSX Parser (Section 80, 81, 104)
 * Parses bold, headings, bullets, numbers, and paragraphs safely without dangerouslySetInnerHTML.
 */
function SafeMarkdownRenderer({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let currentList = [];
  let listType = null; // 'ul' | 'ol'

  const flushList = () => {
    if (currentList.length > 0) {
      if (listType === 'ol') {
        elements.push(<ol key={`ol-${elements.length}`}>{currentList}</ol>);
      } else {
        elements.push(<ul key={`ul-${elements.length}`}>{currentList}</ul>);
      }
      currentList = [];
      listType = null;
    }
  };

  const parseInline = (text) => {
    // Splits **bold** text safely
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      return;
    }

    // Headings
    if (line.startsWith('### ')) {
      flushList();
      elements.push(<h3 key={idx}>{parseInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      flushList();
      elements.push(<h3 key={idx}>{parseInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      flushList();
      elements.push(<h3 key={idx}>{parseInline(line.slice(2))}</h3>);
    }
    // Numbered list items
    else if (/^\d+\.\s/.test(line)) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      const text = line.replace(/^\d+\.\s/, '');
      currentList.push(<li key={`li-${idx}`}>{parseInline(text)}</li>);
    }
    // Bullet list items
    else if (line.startsWith('• ') || line.startsWith('- ') || line.startsWith('* ')) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      const text = line.slice(2);
      currentList.push(<li key={`li-${idx}`}>{parseInline(text)}</li>);
    }
    // Normal paragraph
    else {
      flushList();
      elements.push(<p key={idx}>{parseInline(line)}</p>);
    }
  });

  flushList();
  return <div className="message-markdown-text">{elements}</div>;
}

export default function AIChatView({ farmerId, profile = {}, initialLanguage = 'auto', onOpenWeatherMap }) {
  const conversationOwnerKey = farmerId || 'unverified';
  const conversationIdStorageKey = `agrishield_conv_id_${conversationOwnerKey}`;
  const preferences = useAppPreferences();
  const [useAutomaticLanguage, setUseAutomaticLanguage] = useState(initialLanguage === 'auto' && !localStorage.getItem('agrishield_lang'));
  const language = useAutomaticLanguage ? 'auto' : preferences.language;
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const browserLanguage = navigator.language?.toLowerCase() || '';
  const uiLanguage = language === 'auto'
    ? (browserLanguage.startsWith('te') ? 'te' : browserLanguage.startsWith('hi') ? 'hi' : 'en')
    : language;
  const t = TRANSLATIONS[uiLanguage] || TRANSLATIONS.en;

  // 2. Conversation session state (Section 9, 138, 139)
  const [conversationId, setConversationId] = useState(() => {
    let sid = sessionStorage.getItem(conversationIdStorageKey);
    if (!sid) {
      sid = `conv-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      sessionStorage.setItem(conversationIdStorageKey, sid);
    }
    return sid;
  });

  // 3. Messages state
  const [messages, setMessages] = useState(() => {
    const saved = sessionStorage.getItem(`agrishield_msgs_${conversationOwnerKey}_${conversationId}`);
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return []; // Empty initially to show welcoming state
  });
  const messagesRef = useRef(messages);

  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [requestStage, setRequestStage] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastFailedQuery, setLastFailedQuery] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [feedbackState, setFeedbackState] = useState({});
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackPendingId, setFeedbackPendingId] = useState(null);

  // 4. Multimodal Image attachments state (Section 22, 23, 29)
  const [attachedImage, setAttachedImage] = useState(null);
  const [attachmentError, setAttachmentError] = useState('');
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // 5. Voice Recording & Speech-to-Text state (Section 16, 17, 18)
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [speechTranscript, setSpeechTranscript] = useState('');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  // 6. Voice Playback / Text-to-Speech state (Section 19, 20, 21)
  const [playingMessageId, setPlayingMessageId] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const currentUtteranceRef = useRef(null);
  const activeAudioElementRef = useRef(null);

  // 7. Request AbortController for Stop Generation (Section 45, 144)
  const abortControllerRef = useRef(null);

  // 8. Auto-scroll container
  const chatScrollRef = useRef(null);

  // Sync messages with session storage
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const storedMessages = messages.map((message) => ({
      ...message,
      voiceBlobUrl: null,
      image: typeof message.image === 'string' && message.image.startsWith('data:image/')
        ? null
        : message.image
    }));
    sessionStorage.setItem(`agrishield_msgs_${conversationOwnerKey}_${conversationId}`, JSON.stringify(storedMessages));
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isThinking, speechTranscript, conversationId, conversationOwnerKey]);

  useEffect(() => {
    let active = true;
    if (!farmerId || messages.length > 0) return () => { active = false; };

    getAIConversation(conversationId)
      .then(({ messages: storedMessages = [] }) => {
        if (!active || messagesRef.current.length > 0 || !storedMessages.length) return;
        setMessages(storedMessages.map((message) => ({
          id: message.id || message._id,
          sender: message.role === 'assistant' ? 'ai' : 'farmer',
          text: message.message,
          language: message.language || 'en',
          intent: message.intent || null,
          conversationPersisted: true,
          timestamp: message.createdAt
            ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : ''
        })));
      })
      .catch((error) => {
        if (active && error.status !== 503) {
          console.warn('[AIChatView] Saved conversation history could not be loaded:', error.message);
        }
      });

    return () => { active = false; };
  }, [farmerId, conversationId, messages.length]);

  useEffect(() => () => {
    messagesRef.current.forEach((message) => {
      if (message.voiceBlobUrl) URL.revokeObjectURL(message.voiceBlobUrl);
    });
  }, []);

  // Monitor Network Connectivity (Section 47)
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update language preference
  const handleLanguageChange = (newLang) => {
    if (newLang === 'auto') {
      setUseAutomaticLanguage(true);
    } else {
      setUseAutomaticLanguage(false);
      updateAppPreferences({ language: newLang });
    }
    setLangDropdownOpen(false);

    // Stop active audio
    handleStopAudio();
  };

  // Start a fresh conversation (Section 138, 139)
  const handleNewChat = async () => {
    handleStopAudio();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const newId = `conv-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setConversationId(newId);
    sessionStorage.setItem(conversationIdStorageKey, newId);
    setMessages([]);
    setInputText('');
    setAttachedImage(null);
    setAttachmentError('');
    setIsThinking(false);
    setLastFailedQuery(null);
    setVoiceError('');

    try {
      await clearAIConversation(conversationId);
    } catch (error) {
      console.error('[AIChatView] Could not clear the previous server conversation:', error);
      setVoiceError(error.message || 'The previous conversation could not be cleared on the server.');
    }
  };

  // Handle Image File Selection
  const handleImageFile = (file) => {
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAttachmentError('Choose a JPG, PNG, or WEBP image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAttachmentError(t.imageTooLarge || 'Please upload an image smaller than 10MB');
      return;
    }

    setAttachmentError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      setAttachedImage({
        url: e.target.result,
        name: file.name,
        type: file.type,
        file
      });
    };
    reader.onerror = () => setAttachmentError('The selected image could not be read. Please choose it again.');
    reader.readAsDataURL(file);
  };

  const removeAttachedImage = () => {
    setAttachedImage(null);
    setAttachmentError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Send Message Core Handler (Section 1, 44, 45, 58, 59)
  const handleSendMessage = async (textToSend, options = {}) => {
    const text = (textToSend !== undefined ? textToSend : inputText).trim();
    const imagePayload = options.image || attachedImage;

    if (!text && !imagePayload) return;

    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }

    // Build Farmer User Message Object
    const farmerMessage = {
      id: `msg-${Date.now()}`,
      sender: 'farmer',
      text: text || (imagePayload ? 'Uploaded photograph for analysis' : ''),
      isVoice: options.isVoice || false,
      voiceDuration: options.voiceDuration || null,
      voiceBlobUrl: options.voiceBlobUrl || null,
      image: imagePayload ? imagePayload.url : null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, farmerMessage]);
    setInputText('');
    setAttachedImage(null);
    setAttachmentError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    setIsThinking(true);
    setRequestStage(imagePayload ? 'Uploading image and analyzing it...' : 'Generating an answer...');
    setLastFailedQuery(null);

    // Setup AbortController for cancel / stop generation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await sendMessageToAI({
        message: text,
        conversationId,
        history: messages.slice(-10).map((m) => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.text })),
        image: imagePayload || null,
        language: language === 'auto' ? options.detectedLanguage || 'auto' : language,
        signal: abortController.signal
      });

      const aiMessage = {
        id: `msg-${Date.now()}-ai`,
        serverMessageId: res.messageId || null,
        conversationPersisted: res.conversationPersisted,
        sender: 'ai',
        text: res.reply,
        language: res.language || language,
        category: res.category || null,
        structured: res.structured || null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        weather: res.weather || null,
        sources: res.sources || [],
        intent: res.intent || null
      };

      setMessages((prev) => [...prev, aiMessage]);

      // If user submitted via voice, auto-play response for natural voice experience
      if (options.isVoice && preferences.voicePlaybackEnabled) {
        setTimeout(() => {
          handlePlayAudio(aiMessage.id, aiMessage.text, aiMessage.language);
        }, 400);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('[AIChatView] Request cancelled by user');
        return;
      }

      console.error('[AIChatView] AI response error:', err);
      setLastFailedQuery({ text, options: { ...options, image: imagePayload || null } });

      const errorMessage = {
        id: `msg-err-${Date.now()}`,
        sender: 'ai',
        isError: true,
        text: err.message || t.errorGeneral,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsThinking(false);
      setRequestStage('');
      abortControllerRef.current = null;
    }
  };

  // Stop Generation Handler (Section 45)
  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsThinking(false);
    }
  };

  // Retry last failed query (Section 46)
  const handleRetry = () => {
    if (!lastFailedQuery) return;
    const { text, options } = lastFailedQuery;
    handleSendMessage(text, options);
  };

  // Copy AI response to clipboard (Section 135)
  const handleCopy = (messageId, text) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Feedback 👍 / 👎 (Section 136)
  const handleFeedback = async (messageId, type) => {
    if (feedbackState[messageId] === type || feedbackPendingId) return;
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;
    setFeedbackError('');
    setFeedbackPendingId(messageId);
    try {
      await submitAIFeedback({
        conversationId,
        messageId: message.serverMessageId || message.id,
        rating: type === 'up' ? 1 : -1
      });
      setFeedbackState((prev) => ({ ...prev, [messageId]: type }));
    } catch (error) {
      setFeedbackError(error.message || 'Feedback could not be saved right now.');
    } finally {
      setFeedbackPendingId(null);
    }
  };

  // Voice Input: Start Microphone Recording (Section 16, 17, 18)
  const startRecording = async () => {
    audioChunksRef.current = [];
    setSpeechTranscript('');
    setRecordingSeconds(0);
    setVoiceError('');
    let stream;

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error('Audio recording is not supported in this browser. Please type your question.');
      }
      if (navigator.permissions?.query) {
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' });
          if (permission.state === 'denied') {
            const denied = new Error('Microphone access is blocked. Please allow microphone permission in your browser settings.');
            denied.name = 'NotAllowedError';
            throw denied;
          }
        } catch (permissionError) {
          if (permissionError.name === 'NotAllowedError') throw permissionError;
        }
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((type) => MediaRecorder.isTypeSupported?.(type));
      const mediaRecorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstart = () => {
        setIsRecording(true);
        recordTimerRef.current = setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      console.error('[Audio Capture Error]:', err);
      const message = err.name === 'NotAllowedError' || err.name === 'SecurityError'
        ? 'Microphone access is blocked. Please allow microphone permission in your browser settings.'
        : err.name === 'NotFoundError'
          ? 'No microphone was found. Connect a microphone or type your question.'
          : err.message || 'Unable to start microphone recording. Please try again.';
      setVoiceError(message);
      setIsRecording(false);
    }
  };

  // Upload the recording for server-side transcription before sending the recognized text to chat.
  const handleSendRecording = async () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    const durationStr = `0:${recordingSeconds < 10 ? '0' : ''}${recordingSeconds}`;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      const recorder = mediaRecorderRef.current;
      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const voiceBlobUrl = URL.createObjectURL(audioBlob);
        recorder.stream?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setIsTranscribing(true);
        setVoiceError('');

        try {
          if (!audioBlob.size) throw new Error(t.errorSpeech);
          const sttRes = await transcribeVoice({
            audioBlob,
            mimeType: audioBlob.type,
            language
          });
          if (!sttRes?.text?.trim()) throw new Error(t.errorSpeech);
          setSpeechTranscript(sttRes.text);
          await handleSendMessage(sttRes.text, {
            isVoice: true,
            voiceDuration: durationStr,
            voiceBlobUrl,
            detectedLanguage: sttRes.detectedLanguage || sttRes.language
          });
        } catch (sttError) {
          URL.revokeObjectURL(voiceBlobUrl);
          console.error('[Voice STT Error]:', sttError);
          setVoiceError(sttError.message || t.errorSpeech);
        } finally {
          setIsTranscribing(false);
          setSpeechTranscript('');
        }
      };
      recorder.stop();
    }

    setIsRecording(false);
    setRecordingSeconds(0);
  };

  // Cancel Recording
  const handleCancelRecording = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setSpeechTranscript('');
    setRecordingSeconds(0);
  };

  // Text-To-Speech Play / Pause / Resume / Stop (Section 19, 20, 21)
  const handlePlayAudio = async (messageId, textToRead, msgLang) => {
    if (playingMessageId === messageId) {
      const audio = activeAudioElementRef.current;
      if (audio) {
        if (audio.paused) {
          await audio.play();
          setIsPaused(false);
        } else {
          audio.pause();
          setIsPaused(true);
        }
      } else {
        if (isPaused) {
          window.speechSynthesis?.resume();
          setIsPaused(false);
        } else {
          window.speechSynthesis?.pause();
          setIsPaused(true);
        }
      }
      return;
    }

    handleStopAudio();
    setVoiceError('');
    try {
      const response = await speakVoice({ text: textToRead, language: msgLang || 'en' });
      if (response.audioBase64) {
        const audio = new Audio(`data:${response.format || 'audio/mpeg'};base64,${response.audioBase64}`);
        activeAudioElementRef.current = audio;
        audio.onended = () => {
          setPlayingMessageId(null);
          setIsPaused(false);
          activeAudioElementRef.current = null;
        };
        audio.onerror = () => {
          setPlayingMessageId(null);
          setIsPaused(false);
          activeAudioElementRef.current = null;
          setVoiceError('Audio playback failed. The response is still available as text.');
        };
        await audio.play();
        setPlayingMessageId(messageId);
        setIsPaused(false);
        return;
      }

      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        throw new Error('Speech playback is not supported in this browser. The response is still available as text.');
      }
      const locale = response.voiceLocale || 'en-IN';
      let voices = window.speechSynthesis.getVoices();
      if (!voices.length) {
        voices = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
          window.speechSynthesis.onvoiceschanged = () => {
            clearTimeout(timeout);
            resolve(window.speechSynthesis.getVoices());
          };
        });
      }
      const selectedVoice = voices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase());
      const compatibleVoice = selectedVoice || voices.find((voice) => voice.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase()));
      if (!compatibleVoice) {
        throw new Error(`No ${locale} voice is installed. Configure Google Cloud TTS for multilingual voice playback.`);
      }
      const utterance = new SpeechSynthesisUtterance(response.speechText || textToRead);
      utterance.voice = compatibleVoice;
      utterance.lang = locale;
      utterance.rate = 0.92;
      utterance.onend = () => {
        setPlayingMessageId(null);
        setIsPaused(false);
      };
      utterance.onerror = () => {
        setPlayingMessageId(null);
        setIsPaused(false);
        setVoiceError('Speech playback failed. The response is still available as text.');
      };
      currentUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setPlayingMessageId(messageId);
      setIsPaused(false);
    } catch (error) {
      console.error('[TTS Error]:', error);
      setPlayingMessageId(null);
      setIsPaused(false);
      setVoiceError(error.message || 'Speech playback failed. The response is still available as text.');
    }
  };

  const handleStopAudio = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (activeAudioElementRef.current) {
      activeAudioElementRef.current.pause();
      activeAudioElementRef.current = null;
    }
    setPlayingMessageId(null);
    setIsPaused(false);
  };

  // Playback recorded farmer voice audio
  const handlePlayFarmerVoice = (blobUrl) => {
    if (!blobUrl) return;
    handleStopAudio();
    const audio = new Audio(blobUrl);
    activeAudioElementRef.current = audio;
    audio.play();
  };

  return (
    <div className="agrishield-conversation-screen animate-fadeIn">
      {/* 1. TOP HEADER WITH BRANDING, NEW CHAT, LANGUAGE SELECTOR, AND PROFILE */}
      <header className="ai-chat-header">
        <div className="header-left">
          <div className="ai-brand-icon">
            <Bot size={21} aria-hidden="true" />
          </div>
          <div>
            <div className="title-row">
              <h2 className="ai-brand-heading">AgriShield-AI</h2>
              <span className="live-engine-tag">{t.assistantLabel}</span>
            </div>
            <p className="ai-brand-sub">{t.assistantSub}</p>
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="ai-header-weather-button"
            onClick={onOpenWeatherMap}
            title={t.openWeatherMap}
            aria-label={t.openWeatherMap}
          >
            <CloudRain size={17} aria-hidden="true" />
            <span>{t.weatherMap}</span>
          </button>
          {/* + New Chat Button (Section 138, 139) */}
          <button 
            className="btn-new-chat"
            onClick={handleNewChat}
            title={t.newChat}
            aria-label={t.newChat}
          >
            <PlusCircle size={15} />
            <span>{t.newChat}</span>
          </button>

          {/* Language Selector Dropdown (Section 4, 14, 15) */}
          <div className="language-selector-wrapper">
            <button 
              className="btn-language-selector"
              onClick={() => setLangDropdownOpen(!langDropdownOpen)}
              title={t.changeLanguage}
              aria-label={t.changeLanguage}
            >
              <Globe size={16} />
              <span className="lang-text">
                {language === 'auto' ? t.auto : (language === 'te' ? 'తెలుగు' : (language === 'hi' ? 'हिंदी' : 'English'))}
              </span>
              <ChevronDown size={14} />
            </button>

            {langDropdownOpen && (
              <div className="language-dropdown-menu animate-fadeIn">
                <button
                  className={`lang-option ${language === 'auto' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('auto')}
                >
                  <span>{t.autoDetect}</span>
                </button>
                <button 
                  className={`lang-option ${language === 'te' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('te')}
                >
                  <span>తెలుగు</span>
                </button>
                <button 
                  className={`lang-option ${language === 'hi' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('hi')}
                >
                  <span>हिंदी</span>
                </button>
                <button 
                  className={`lang-option ${language === 'en' ? 'active' : ''}`}
                  onClick={() => handleLanguageChange('en')}
                >
                  <span>English</span>
                </button>
              </div>
            )}
          </div>

          {/* Farmer Profile Badge */}
          <div className="header-farmer-badge" title={t.farmerProfile}>
            <div className="farmer-badge-avatar">
              <User size={15} />
            </div>
            <div className="farmer-badge-texts">
              <span className="farmer-name">{profile?.farmerName || t.farmer}</span>
              <span className="farmer-crop">{profile?.farm?.crop || t.cropNotSpecified}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="offline-network-banner animate-slideUp">
          <WifiOff size={18} />
          <span>{t.offlineAlert}</span>
        </div>
      )}

      {/* 2. CONVERSATION MESSAGES BODY */}
      <div className="ai-chat-messages-container" ref={chatScrollRef}>
        {/* Empty Chat Welcoming Hero State (Section 43) */}
        {messages.length === 0 && (
          <div className="ai-empty-chat-welcome animate-fadeIn">
            <div className="welcome-avatar-large">
              <Bot size={32} aria-hidden="true" />
            </div>
            <h3 className="welcome-title">{t.welcomeTitle}</h3>
            <p className="welcome-sub">{t.welcomeSub}</p>
          </div>
        )}

        {/* Message Cards List */}
        {messages.map((m) => (
          <div key={m.id} className={`chat-message-row ${m.sender}`}>
            {/* Avatar */}
            {m.sender === 'ai' ? (
              <div className="chat-avatar ai-avatar">
                <Bot size={18} color="#10b981" />
              </div>
            ) : (
              <div className="chat-avatar farmer-avatar">
                <User size={18} color="#38bdf8" />
              </div>
            )}

            {/* Bubble Content */}
            <div className="message-card-wrapper">
              {/* Farmer Voice Message Player (Section 18) */}
              {m.sender === 'farmer' && m.isVoice && (
                <div className="farmer-voice-bubble">
                  <div className="voice-audio-bar">
                    <button 
                      className="voice-play-icon"
                      onClick={() => handlePlayFarmerVoice(m.voiceBlobUrl)}
                      title="Play recorded audio"
                      style={{ border: 'none', cursor: 'pointer' }}
                    >
                      <Play size={15} aria-hidden="true" />
                    </button>
                    <div className="voice-wave-timeline">
                      <span className="timeline-bar"></span>
                      <span className="timeline-bar active"></span>
                      <span className="timeline-bar active"></span>
                      <span className="timeline-bar"></span>
                      <span className="timeline-bar active"></span>
                      <span className="timeline-bar"></span>
                    </div>
                    <span className="voice-duration">{m.voiceDuration || '0:06'}</span>
                  </div>
                  {m.text && (
                    <div className="voice-recognized-confirmation">
                      <span className="confirmation-label">{t.voiceBubblePrefix}:</span>
                      <p className="confirmation-text">"{m.text}"</p>
                    </div>
                  )}
                </div>
              )}

              {/* Farmer Uploaded Image Attachment (Section 22, 23) */}
              {m.image && (
                <div className="message-image-attachment">
                  <img src={m.image} alt="Crop sample" className="attached-crop-image" />
                  <span className="image-tag"><ImageIcon size={14} aria-hidden="true" /> Crop photo</span>
                </div>
              )}

              {/* Text Message Content */}
              {(!m.isVoice || m.sender === 'ai') && (
                <div className={`message-bubble ${m.sender} ${m.isError ? 'error-bubble' : ''}`}>
                  {m.sender === 'ai' && (
                    <div className="ai-response-meta-header">
                      <span className="ai-sender-name"><Bot size={15} aria-hidden="true" /> AgriShield-AI</span>
                      {m.category && (
                        <span className="ai-category-pill">{m.category}</span>
                      )}
                    </div>
                  )}

                  {/* Main Response Text (Safe Markdown Rendered) */}
                  <SafeMarkdownRenderer content={m.text} />

                  {/* Structured Details Card (Section 6, 32) */}
                  {m.structured && (
                    <div className="structured-advisory-card">
                      {m.structured.whatYouShouldDo && (
                        <div className="structured-block">
                          <span className="block-title action">
                            <CheckCircle2 size={14} />
                            <span>{t.whatYouShouldDo}:</span>
                          </span>
                          <ul className="action-list">
                            {m.structured.whatYouShouldDo.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {m.structured.warning && (
                        <div className="structured-block warning">
                          <span className="block-title warn">
                            <AlertTriangle size={14} />
                            <span>{t.warning}:</span>
                          </span>
                          <p className="warning-text">{m.structured.warning}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show available weather and citations returned by configured backend providers. */}
                  {m.sender === 'ai' && !m.isError && (
                    <div className="ai-card-subsections">
                      {m.sources?.length > 0 && (
                        <div className="sources-phase2-badge">
                          <ShieldCheck size={13} color="#94a3b8" />
                          <span>{m.intent === 'WEATHER' ? 'Weather data: ' : 'Sources: '}{m.sources.map((source) => (
                            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                              {source.publisher || source.title}
                            </a>
                          ))}</span>
                        </div>
                      )}
                      {m.conversationPersisted === false && (
                        <p className="ai-chat-input-status error" role="status">
                          This conversation could not be saved because conversation storage is unavailable.
                        </p>
                      )}
                      {m.weather?.available && (
                        <div className="weather-data-badge" title={`Retrieved ${m.weather.timestamp}`}>
                          <CloudRain size={13} color="#94a3b8" />
                          <span>Weather data · {m.weather.provider} · Updated {new Date(m.weather.timestamp).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Response Actions Bar: TTS, Copy & Feedback (Section 19, 21, 135, 136) */}
                  {m.sender === 'ai' && !m.isError && (
                    <div className="ai-card-actions-bar">
                      <div className="actions-left">
                        {/* Audio Controls */}
                        {playingMessageId === m.id ? (
                          <div className="active-player-controls">
                            <button 
                              className="btn-audio-control pause"
                              onClick={() => handlePlayAudio(m.id, m.text, m.language)}
                              title={isPaused ? t.resume : t.pause}
                            >
                              {isPaused ? <Play size={13} /> : <Pause size={13} />}
                              <span>{isPaused ? t.resume : t.pause}</span>
                            </button>
                            <button 
                              className="btn-audio-control stop"
                              onClick={handleStopAudio}
                              title={t.stop}
                            >
                              <Square size={12} />
                              <span>{t.stop}</span>
                            </button>
                            <span className="audio-playing-indicator animate-pulse">
                            Speaking in {m.language === 'te' ? 'తెలుగు' : (m.language === 'hi' ? 'हिंदी' : 'English')}...
                            </span>
                          </div>
                        ) : (
                          <button 
                            className="btn-audio-control play"
                            onClick={() => handlePlayAudio(m.id, m.text, m.language)}
                            title={t.listen}
                          >
                            <Play size={13} />
                            <span>{t.listen}</span>
                          </button>
                        )}

                        {/* Copy Response Button */}
                        <button 
                          className={`btn-text-action ${copiedId === m.id ? 'copied' : ''}`}
                          onClick={() => handleCopy(m.id, m.text)}
                          title="Copy advice"
                        >
                          {copiedId === m.id ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedId === m.id ? t.copied : t.copy}</span>
                        </button>
                      </div>

                      <div className="actions-right">
                        {/* Helpful Feedback Buttons */}
                        <button 
                          className={`feedback-btn ${feedbackState[m.id] === 'up' ? 'active' : ''}`}
                          onClick={() => handleFeedback(m.id, 'up')}
                          title="Helpful response"
                          aria-label="Mark response as helpful"
                          disabled={feedbackPendingId === m.id}
                        >
                          <ThumbsUp size={13} />
                        </button>
                        <button 
                          className={`feedback-btn ${feedbackState[m.id] === 'down' ? 'active' : ''}`}
                          onClick={() => handleFeedback(m.id, 'down')}
                          title="Not helpful"
                          aria-label="Mark response as not helpful"
                          disabled={feedbackPendingId === m.id}
                        >
                          <ThumbsDown size={13} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Error Retry Button (Section 46) */}
                  {m.isError && (
                    <div className="error-retry-action">
                      <button className="btn-retry-query" onClick={handleRetry}>
                        <RefreshCw size={14} />
                        <span>{t.tryAgain}</span>
                      </button>
                    </div>
                  )}

                  <span className="message-timestamp">{m.timestamp}</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading / Thinking Indicator with Stop Button (Section 44, 45, 73, 154) */}
        {isThinking && (
          <div className="chat-message-row ai animate-fadeIn">
            <div className="chat-avatar ai-avatar">
              <Bot size={18} color="#10b981" />
            </div>
            <div className="message-card-wrapper" style={{ width: '100%' }}>
              <div className="ai-thinking-card">
                <span className="thinking-text">{requestStage || t.thinking}</span>
                <div className="thinking-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <button 
                  className="btn-stop-generating"
                  onClick={handleStopGenerating}
                  title="Stop generating response"
                >
                  <StopCircle size={13} />
                  <span>{t.stopGenerating}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. VOICE RECORDING VISUALIZER OVERLAY (Section 16, 17, 18) */}
      {isRecording && (
        <div className="voice-recording-modal animate-slideUp">
          <div className="recording-indicator-row">
            <div className="recording-pulsing-badge">
              <span className="red-record-dot"></span>
              <span className="record-label">{t.recording}</span>
            </div>
            <span className="recording-timer">0:{recordingSeconds < 10 ? '0' : ''}{recordingSeconds}</span>
          </div>

          {/* Animated Waveform Visualizer */}
          <div className="waveform-visualizer">
            <div className="wave-bar bar-1"></div>
            <div className="wave-bar bar-2"></div>
            <div className="wave-bar bar-3"></div>
            <div className="wave-bar bar-4"></div>
            <div className="wave-bar bar-5"></div>
            <div className="wave-bar bar-6"></div>
            <div className="wave-bar bar-7"></div>
            <div className="wave-bar bar-8"></div>
          </div>

          <p className="speech-live-preview">
            {speechTranscript ? `"${speechTranscript}"` : t.recordingSub}
          </p>

          <div className="recording-controls-row">
            <button className="btn-record-cancel" onClick={handleCancelRecording}>
              <X size={16} />
              <span>{t.cancel}</span>
            </button>
            <button className="btn-record-send" onClick={handleSendRecording}>
              <Send size={16} />
              <span>{t.send}</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. ATTACHED IMAGE PREVIEW BAR (Section 132, 197) */}
      {attachedImage && !isRecording && (
        <div className="attached-image-preview-bar animate-fadeIn">
          <div className="preview-image-box">
            <img src={attachedImage.url} alt="Attached crop" />
            <button className="btn-remove-attachment" onClick={removeAttachedImage} title="Remove image">
              <X size={12} />
            </button>
          </div>
          <span className="preview-filename">{attachedImage.name} (Ready to send)</span>
        </div>
      )}
      {attachmentError && <div className="ai-chat-input-status error" role="alert">{attachmentError}</div>}
      {voiceError && <div className="ai-chat-input-status error" role="alert">{voiceError}</div>}
      {feedbackError && <div className="ai-chat-input-status error" role="alert">{feedbackError}</div>}
      {isTranscribing && <div className="ai-chat-input-status" role="status">Processing voice recording and detecting language...</div>}

      {/* 6. INPUT BAR (Camera, Gallery, Text, Mic, Send) (Section 42, 131, 194, 195) */}
      <footer className="ai-chat-input-footer">
        {/* Hidden File Inputs */}
        <input 
          type="file" 
          ref={fileInputRef} 
          accept="image/jpeg,image/png,image/webp" 
          style={{ display: 'none' }}
          onChange={(e) => {
            handleImageFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input 
          type="file" 
          ref={cameraInputRef} 
          accept="image/jpeg,image/png,image/webp" 
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleImageFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {/* Camera Direct Button (Section 131) */}
        <button 
          type="button" 
          className="btn-input-accessory camera"
          onClick={() => cameraInputRef.current?.click()}
          title="Take photo of crop leaf with camera"
          aria-label="Take crop photo with camera"
          disabled={isRecording || isThinking || isTranscribing}
        >
          <Camera size={20} />
        </button>

        {/* Gallery Image Upload Button */}
        <button 
          type="button" 
          className="btn-input-accessory gallery"
          onClick={() => fileInputRef.current?.click()}
          title="Choose photo from gallery"
          aria-label="Upload photo from gallery"
          disabled={isRecording || isThinking || isTranscribing}
        >
          <ImageIcon size={20} />
        </button>

        {/* Chat Text Input Form */}
        <form 
          className="input-form-inner"
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
        >
          <input 
            type="text" 
            className="farmer-text-input"
            placeholder={t.placeholder}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isRecording || isThinking || isTranscribing}
          />

          {/* Microphone Voice Button (Section 194) */}
          <button 
            type="button"
            className={`btn-input-accessory mic ${isRecording ? 'recording-active' : ''}`}
            onClick={isRecording ? handleCancelRecording : startRecording}
            title="Speak into microphone"
            aria-label="Record voice query"
            disabled={isThinking || isTranscribing}
          >
            <Mic size={20} />
          </button>

          {/* Send Button (Section 195) */}
          <button 
            type="submit" 
            className="btn-send-message"
            disabled={(!inputText.trim() && !attachedImage) || isRecording || isThinking || isTranscribing}
            title="Send query"
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
        </form>
      </footer>
    </div>
  );
}
