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
  MoreHorizontal,
  ShieldCheck,
  StopCircle,
  MicOff,
  PhoneOff
} from 'lucide-react';
import { updateAppPreferences } from '../services/appPreferences';
import { useAppPreferences } from '../services/useAppPreferences';
import { connectGeminiLiveVoice } from '../services/geminiLiveVoice';
import { requestMicrophoneAccess } from '../services/microphone';
import { translate } from '../i18n';
import { 
  sendMessageToAI, 
  transcribeVoice, 
  getAIConversation,
  clearAIConversation,
  speakVoiceStream,
  getLiveVoiceToken,
  saveLiveVoiceMessage,
  getVoiceConfig,
  submitAIFeedback,
  retryAIImageAnalysis
} from '../services/api';

function voiceDiagnostic(stage, details = {}) {
  if (!import.meta.env.DEV) return;
  const event = { stage, monotonicMs: highResolutionNow(), ...details };
  window.__AGRISHIELD_TTS_TIMINGS__ ||= [];
  window.__AGRISHIELD_TTS_TIMINGS__.push(event);
  console.debug(`[AgriShield voice] ${stage}`, details);
}

function highResolutionNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

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

export default function AIChatView({ farmerId, farmId, profile = {}, initialLanguage = 'auto' }) {
  const conversationOwnerKey = farmerId && farmId
    ? `${farmerId}_${farmId}`
    : farmerId || 'unverified';
  const conversationIdStorageKey = `agrishield_conv_id_${conversationOwnerKey}`;
  const preferences = useAppPreferences();
  const [useAutomaticLanguage, setUseAutomaticLanguage] = useState(initialLanguage === 'auto' && !localStorage.getItem('agrishield_lang'));
  const language = useAutomaticLanguage ? 'auto' : preferences.language;
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const browserLanguage = navigator.language?.toLowerCase() || '';
  const uiLanguage = language === 'auto'
    ? (browserLanguage.startsWith('te') ? 'te' : browserLanguage.startsWith('hi') ? 'hi' : 'en')
    : language;
  const t = new Proxy(Object.create(null), {
    get: (_target, key) => typeof key === 'string'
      ? translate(uiLanguage, `aiChat.${key}`)
      : undefined
  });
  const aiT = (key, values = {}) => translate(uiLanguage, `ai.${key}`, values);
  const activeFarm = profile?.farm || {};
  const farmLabel = activeFarm.farmName || activeFarm.name || profile?.farmName || '';
  const farmArea = activeFarm.area?.acres ?? activeFarm.areaAcres ?? profile?.area?.acres;
  const farmContextLabel = farmLabel
    ? (farmArea !== undefined && farmArea !== null && farmArea !== ''
      ? aiT('usingFarm', { farm: farmLabel, area: farmArea })
      : aiT('usingFarmNoArea', { farm: farmLabel }))
    : aiT('usingFarmData');

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
  const sendLockRef = useRef(false);
  const previewUrlsRef = useRef(new Set());

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
  const [maxRecordingSeconds, setMaxRecordingSeconds] = useState(60);
  const [voiceConfigLoading, setVoiceConfigLoading] = useState(true);
  const recordingSecondsRef = useRef(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  // 6. Voice Playback / Text-to-Speech state (Section 19, 20, 21)
  const [playingMessageId, setPlayingMessageId] = useState(null);
  const [preparingMessageId, setPreparingMessageId] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const activeAudioElementRef = useRef(null);
  const ttsAbortControllerRef = useRef(null);
  const ttsReaderRef = useRef(null);
  const audioObjectUrlRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('idle');
  const [liveError, setLiveError] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [livePartialTranscript, setLivePartialTranscript] = useState('');
  const [liveMuted, setLiveMuted] = useState(false);
  const [liveSessionSeconds, setLiveSessionSeconds] = useState(0);
  const [liveMaxMinutes, setLiveMaxMinutes] = useState(30);
  const liveSessionRef = useRef(null);
  const liveStartIdRef = useRef(0);
  const liveFarmIdRef = useRef(farmId);

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
      image: typeof message.image === 'string' &&
        (message.image.startsWith('data:image/') || message.image.startsWith('blob:'))
        ? null
        : message.image
    }));
    sessionStorage.setItem(`agrishield_msgs_${conversationOwnerKey}_${conversationId}`, JSON.stringify(storedMessages));
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isThinking, conversationId, conversationOwnerKey]);

  useEffect(() => {
    let active = true;
    if (!farmerId) return () => { active = false; };

    getAIConversation(conversationId)
      .then(({ messages: storedMessages = [] }) => {
        if (!active || !storedMessages.length) return;
        setMessages((currentMessages) => {
          const mergedMessages = [...currentMessages];
          const matchedIndexes = new Set();
          storedMessages.forEach((storedMessage) => {
            const sender = storedMessage.role === 'assistant' ? 'ai' : 'farmer';
            const matchedIndex = mergedMessages.findIndex((message, index) =>
              !matchedIndexes.has(index) &&
              message.sender === sender &&
              message.text === storedMessage.message
            );
            const restoredMessage = {
              id: storedMessage.id || storedMessage._id,
              sender,
              text: storedMessage.message,
              language: storedMessage.language || 'en',
              intent: storedMessage.intent || null,
              inputType: storedMessage.inputType || 'text',
              isVoice: storedMessage.inputType === 'voice' || storedMessage.inputType === 'voice_image',
              imagePath: storedMessage.imagePath || null,
              image: storedMessage.imageUrl || null,
              serverMessageId: storedMessage._id || null,
              analysisStatus: storedMessage.analysisStatus || null,
              attachment: storedMessage.attachment || null,
              conversationPersisted: true,
              timestamp: storedMessage.createdAt
                ? new Date(storedMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''
            };
            if (matchedIndex >= 0) {
              matchedIndexes.add(matchedIndex);
              mergedMessages[matchedIndex] = {
                ...mergedMessages[matchedIndex],
                ...restoredMessage,
                id: mergedMessages[matchedIndex].id,
                image: mergedMessages[matchedIndex].image?.startsWith('blob:')
                  ? mergedMessages[matchedIndex].image
                  : restoredMessage.image,
                voiceBlobUrl: mergedMessages[matchedIndex].voiceBlobUrl || null
              };
            } else {
              mergedMessages.push(restoredMessage);
            }
          });
          return mergedMessages;
        });
      })
      .catch((error) => {
        if (active && error.status !== 503) {
          console.warn('[AIChatView] Saved conversation history could not be loaded:', error.message);
        }
      });

    return () => { active = false; };
  }, [farmerId, conversationId]);

  useEffect(() => {
    let active = true;
    getVoiceConfig()
      .then(({ maxRecordingSeconds: configuredLimit }) => {
        if (active) setMaxRecordingSeconds(Math.min(Math.max(configuredLimit, 1), 60));
      })
      .catch((error) => {
        console.warn('[AIChatView] Voice recording configuration could not be loaded:', error.message);
      })
      .finally(() => {
        if (active) setVoiceConfigLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    liveStartIdRef.current += 1;
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
    messagesRef.current.forEach((message) => {
      if (message.voiceBlobUrl) URL.revokeObjectURL(message.voiceBlobUrl);
    });
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current?.stop();
    }
    activeAudioElementRef.current?.pause();
  }, []);

  useEffect(() => {
    if (liveFarmIdRef.current === farmId) return;
    liveStartIdRef.current += 1;
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    liveFarmIdRef.current = farmId;
    setLiveDialogOpen(false);
    setLiveStatus('idle');
    setLiveTranscript('');
    setLivePartialTranscript('');
    setLiveSessionSeconds(0);
    setLiveMuted(false);
  }, [farmId]);

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
    if (liveStatus !== 'idle' || liveSessionRef.current) endLiveVoice();
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
      setVoiceError(error.message || aiT('previousConversationClearError'));
    }
  };

  // Handle Image File Selection
  const handleImageFile = (file) => {
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAttachmentError(aiT('imageTypeError'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAttachmentError(aiT('imageTooLarge'));
      return;
    }

    if (attachedImage?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(attachedImage.url);
      previewUrlsRef.current.delete(attachedImage.url);
    }
    setAttachmentError('');
    const previewUrl = URL.createObjectURL(file);
    previewUrlsRef.current.add(previewUrl);
    setAttachedImage({
      url: previewUrl,
      name: file.name,
      type: file.type,
      file
    });
  };

  const releasePreviewUrl = (url) => {
    if (!url?.startsWith('blob:')) return;
    URL.revokeObjectURL(url);
    previewUrlsRef.current.delete(url);
  };

  const removeAttachedImage = () => {
    releasePreviewUrl(attachedImage?.url);
    setAttachedImage(null);
    setAttachmentError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Send Message Core Handler (Section 1, 44, 45, 58, 59)
  const handleSendMessage = async (textToSend, options = {}) => {
    const text = (textToSend !== undefined ? textToSend : inputText).trim();
    const imagePayload = options.image || attachedImage;

    if (sendLockRef.current || (!text && !imagePayload)) return;

    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    sendLockRef.current = true;

    // Build Farmer User Message Object
    const existingFarmerMessage = options.isRetry
      ? messages.find((message) => message.id === options.userMessageId)
      : null;
    const farmerMessage = existingFarmerMessage || {
      id: `msg-${Date.now()}`,
      sender: 'farmer',
      text: text || (imagePayload ? aiT('imageOnlyPrompt') : ''),
      isVoice: options.isVoice || false,
      voiceDuration: options.voiceDuration || null,
      voiceBlobUrl: options.voiceBlobUrl || null,
      image: imagePayload ? imagePayload.url : null,
      analysisStatus: imagePayload ? 'UPLOADING' : null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (!options.isRetry) setMessages((prev) => [...prev, farmerMessage]);
    else if (imagePayload) {
      setMessages((current) => current.map((message) => message.id === farmerMessage.id
        ? { ...message, analysisStatus: 'UPLOADING' }
        : message));
    }
    setInputText('');
    setAttachedImage(null);
    setAttachmentError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    setIsThinking(true);
    setRequestStage(imagePayload ? aiT('uploadingImage') : aiT('generating'));
    setLastFailedQuery(null);

    // Setup AbortController for cancel / stop generation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const imageRequestId = imagePayload
      ? (options.requestId || window.crypto?.randomUUID?.() || `image-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      : null;

    try {
      const res = await sendMessageToAI({
        message: text,
        conversationId,
        history: messages.slice(-10).map((m) => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.text })),
        image: imagePayload || null,
        language: language === 'auto' ? options.detectedLanguage || 'auto' : language,
        inputType: options.isVoice
          ? (imagePayload ? 'voice_image' : 'voice')
          : (imagePayload ? 'image' : 'text'),
        signal: abortController.signal,
        requestId: imageRequestId,
        onUploadComplete: imagePayload
          ? () => {
            setRequestStage(aiT('analyzingUploadedImage'));
            setMessages((current) => current.map((message) => message.id === farmerMessage.id
              ? { ...message, analysisStatus: 'ANALYZING' }
              : message));
          }
          : undefined
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
      setLastFailedQuery(null);
      if (imagePayload) {
        setMessages((current) => current.map((message) => message.id === farmerMessage.id
          ? {
            ...message,
            image: res.imageUrl || message.image,
            serverMessageId: res.imageMessageId || message.serverMessageId,
            analysisStatus: 'COMPLETED'
          }
          : message));
        releasePreviewUrl(farmerMessage.image);
      }
      if (res.imagePath) {
        setMessages((prev) => prev.map((message) => message.id === farmerMessage.id
          ? { ...message, imagePath: res.imagePath }
          : message));
      }

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
      const errorMessageId = `msg-err-${Date.now()}`;
      setLastFailedQuery({
        text,
        userMessageId: farmerMessage.id,
        imageMessageId: err.imageMessageId || null,
        requestId: imageRequestId,
        errorMessageId,
        options: { ...options, image: imagePayload || null, requestId: imageRequestId }
      });
      if (imagePayload) {
        setMessages((current) => current.map((message) => message.id === farmerMessage.id
          ? {
            ...message,
            image: err.imageUrl || message.image,
            serverMessageId: err.imageMessageId || message.serverMessageId,
            analysisStatus: err.imageMessageId ? 'FAILED' : 'UPLOAD_FAILED'
          }
          : message));
        if (err.imageUrl) releasePreviewUrl(farmerMessage.image);
      }

      const errorMessage = {
        id: errorMessageId,
        sender: 'ai',
        isError: true,
        text: err.code === 'IMAGE_ANALYSIS_UNAVAILABLE'
          ? aiT('imageUnavailable')
          : ['IMAGE_UPLOAD_FAILED', 'CLOUDINARY_NOT_CONFIGURED'].includes(err.code)
            ? aiT('imageUploadFailed')
          : err.message || t.errorGeneral,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      sendLockRef.current = false;
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
  const handleRetry = async (errorMessageId, explicitImageMessageId = null) => {
    const persistedImageMessage = explicitImageMessageId
      ? messages.find((message) => message.serverMessageId === explicitImageMessageId)
      : null;
    const retry = lastFailedQuery || (persistedImageMessage
      ? {
        text: persistedImageMessage.text,
        userMessageId: persistedImageMessage.id,
        imageMessageId: persistedImageMessage.serverMessageId,
        options: {}
      }
      : null);
    if (!retry || sendLockRef.current) return;
    setMessages((current) => current.filter((message) => message.id !== errorMessageId));

    if (!retry.imageMessageId) {
      handleSendMessage(retry.text, { ...retry.options, isRetry: true, userMessageId: retry.userMessageId });
      return;
    }

    sendLockRef.current = true;
    const errorId = `msg-err-${Date.now()}`;
    setIsThinking(true);
    setRequestStage(aiT('analyzingUploadedImage'));
    setMessages((current) => current.map((message) => message.serverMessageId === retry.imageMessageId
      ? { ...message, analysisStatus: 'ANALYZING' }
      : message));
    try {
      const response = await retryAIImageAnalysis({
        conversationId,
        messageId: retry.imageMessageId,
        language
      });
      const aiMessage = {
        id: `msg-${Date.now()}-ai`,
        serverMessageId: response.messageId || null,
        conversationPersisted: response.conversationPersisted,
        sender: 'ai',
        text: response.reply,
        language: response.language || language,
        category: response.category || null,
        structured: response.structured || null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        weather: response.weather || null,
        sources: response.sources || [],
        intent: response.intent || null
      };
      setMessages((current) => [
        ...current.map((message) => message.serverMessageId === retry.imageMessageId
          ? { ...message, image: response.imageUrl || message.image, analysisStatus: 'COMPLETED' }
          : message),
        aiMessage
      ]);
      setLastFailedQuery(null);
    } catch (error) {
      setMessages((current) => [
        ...current.map((message) => message.serverMessageId === retry.imageMessageId
          ? { ...message, image: error.imageUrl || message.image, analysisStatus: 'FAILED' }
          : message),
        {
          id: errorId,
          sender: 'ai',
          isError: true,
          text: error.code === 'IMAGE_ANALYSIS_UNAVAILABLE'
            ? aiT('imageUnavailable')
            : error.message || t.errorGeneral,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setLastFailedQuery({ ...retry, imageMessageId: error.imageMessageId || retry.imageMessageId, errorMessageId: errorId });
    } finally {
      sendLockRef.current = false;
      setIsThinking(false);
      setRequestStage('');
    }
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
      setFeedbackError(error.message || aiT('feedbackError'));
    } finally {
      setFeedbackPendingId(null);
    }
  };

  // Voice Input: Start Microphone Recording (Section 16, 17, 18)
  const startRecording = async () => {
    if (voiceConfigLoading) return;
    audioChunksRef.current = [];
    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
    setVoiceError('');
    let stream;

    try {
      if (!window.MediaRecorder) {
        throw new Error(t.microphoneUnavailable);
      }
      const microphoneAccess = await requestMicrophoneAccess({
        mediaDevices: navigator.mediaDevices,
        permissions: navigator.permissions
      });
      stream = microphoneAccess.stream;
      voiceDiagnostic('microphonePermission', { state: microphoneAccess.permissionState });
      const supportedType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .concat(['audio/ogg', 'audio/wav'])
        .find((type) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type));
      const mediaRecorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
          voiceDiagnostic('audioChunkReceived', { byteSize: e.data.size, mimeType: e.data.type || mediaRecorder.mimeType });
        }
      };

      mediaRecorder.onstart = () => {
        voiceDiagnostic('recordingStarted', { mimeType: mediaRecorder.mimeType });
        setIsRecording(true);
        recordTimerRef.current = setInterval(() => {
          const next = Math.min(recordingSecondsRef.current + 1, maxRecordingSeconds);
          recordingSecondsRef.current = next;
          setRecordingSeconds(next);
          if (next >= maxRecordingSeconds) handleSendRecording();
        }, 1000);
      };
      mediaRecorder.onerror = () => {
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        mediaRecorder.stream?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setVoiceError(t.microphoneStartError);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      voiceDiagnostic('recordingStartFailed', { name: err.name, code: err.code });
      const message = err.code === 'MICROPHONE_UNAVAILABLE'
        ? t.microphoneUnavailable
        : err.name === 'NotAllowedError' || err.name === 'SecurityError'
        ? t.microphoneBlocked
        : err.name === 'NotFoundError'
          ? t.microphoneNotFound
          : err.message || t.microphoneStartError;
      setVoiceError(message);
      setIsRecording(false);
    }
  };

  // Upload the recording for server-side transcription before sending the recognized text to chat.
  const handleSendRecording = async () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    const recordingDuration = recordingSecondsRef.current;
    const durationStr = `${Math.floor(recordingDuration / 60)}:${String(recordingDuration % 60).padStart(2, '0')}`;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      recorder?.stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      setVoiceError(t.errorSpeech);
      setIsRecording(false);
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      return;
    }
    if (recorder) {
      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || audioChunksRef.current.find((chunk) => chunk.type)?.type || '';
        const audioBlob = new Blob(audioChunksRef.current, mimeType ? { type: mimeType } : undefined);
        recorder.stream?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        voiceDiagnostic('recordingStopped', { byteSize: audioBlob.size, mimeType: audioBlob.type });
        setIsTranscribing(true);
        setVoiceError('');
        let voiceBlobUrl;

        try {
          if (!audioBlob.size) throw new Error(t.errorSpeech);
          if (!audioBlob.type.startsWith('audio/')) {
            throw new Error(t.microphoneStartError);
          }
          const playbackProbe = new Audio();
          const playbackMimeType = audioBlob.type.split(';')[0];
          if (playbackMimeType && playbackProbe.canPlayType(playbackMimeType)) {
            voiceBlobUrl = URL.createObjectURL(audioBlob);
          }
          const sttRes = await transcribeVoice({
            audioBlob,
            mimeType: audioBlob.type,
            language,
            durationSeconds: Math.max(1, recordingDuration)
          });
          if (!sttRes?.text?.trim()) throw new Error(t.errorSpeech);
          voiceDiagnostic('transcriptReceived', { received: true });
          setIsTranscribing(false);
          await handleSendMessage(sttRes.text, {
            isVoice: true,
            voiceDuration: durationStr,
            voiceBlobUrl,
            detectedLanguage: sttRes.detectedLanguage || sttRes.language
          });
        } catch (sttError) {
          if (voiceBlobUrl) URL.revokeObjectURL(voiceBlobUrl);
          voiceDiagnostic('transcriptionFailed', { name: sttError.name, code: sttError.code, status: sttError.status });
          const localizedError = sttError.name === 'TimeoutError'
            ? t.voiceTimeout
            : sttError.code === 'API_NETWORK_ERROR'
              ? t.voiceNetworkError
              : sttError.message || t.errorSpeech;
          setVoiceError(localizedError);
        } finally {
          setIsTranscribing(false);
        }
      };
      try {
        recorder.stop();
      } catch {
        recorder.stream?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setVoiceError(t.microphoneStartError);
      }
    }

    setIsRecording(false);
    recordingSecondsRef.current = 0;
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
    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
  };

  // Stream synthesized speech so playback can begin before the full answer is generated.
  const handlePlayAudio = async (messageId, textToRead, msgLang) => {
    if (preparingMessageId === messageId) {
      handleStopAudio();
      return;
    }
    if (playingMessageId === messageId) {
      const audio = activeAudioElementRef.current;
      if (!audio) return;
      if (audio.paused) {
        try {
          await audio.play();
          setIsPaused(false);
        } catch (error) {
          setVoiceError(error.message || aiT('audioResumeError'));
        }
      } else {
        audio.pause();
        setIsPaused(true);
      }
      return;
    }

    handleStopAudio();
    setVoiceError('');
    setPreparingMessageId(messageId);
    voiceDiagnostic('listenClicked');
    const startedAt = highResolutionNow();
    const controller = new AbortController();
    ttsAbortControllerRef.current = controller;
    let voiceStartTimedOut = false;
    let audioStarted = false;
    let timeoutId = window.setTimeout(() => {
      voiceStartTimedOut = true;
      controller.abort();
      if (activeAudioElementRef.current === audio) {
        void ttsReaderRef.current?.cancel().catch(() => {});
        audio?.pause();
        setVoiceError(aiT('audioPrepareTimeout'));
        setPlayingMessageId(null);
        setPreparingMessageId(null);
        setIsPaused(false);
        activeAudioElementRef.current = null;
        mediaSourceRef.current = null;
        if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    }, 15000);
    const finishPlayback = () => {
      setPlayingMessageId(null);
      setPreparingMessageId(null);
      setIsPaused(false);
      activeAudioElementRef.current = null;
      mediaSourceRef.current = null;
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    };
    let audio = null;

    try {
      if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) {
        throw new Error(aiT('streamingAudioUnsupported'));
      }
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      const objectUrl = URL.createObjectURL(mediaSource);
      audioObjectUrlRef.current = objectUrl;
      audio = new Audio(objectUrl);
      activeAudioElementRef.current = audio;
      audio.onended = finishPlayback;
      audio.onerror = () => {
        finishPlayback();
        setVoiceError(aiT('audioPlaybackError'));
      };
      audio.onplaying = () => {
        audioStarted = true;
        window.clearTimeout(timeoutId);
        timeoutId = null;
        setPreparingMessageId(null);
        setPlayingMessageId(messageId);
        setIsPaused(false);
        voiceDiagnostic('playbackStarted', { elapsedMs: Math.round(highResolutionNow() - startedAt) });
      };

      const sourceOpen = new Promise((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', () => {
          voiceDiagnostic('ttsMediaSourceOpen', { elapsedMs: Math.round(highResolutionNow() - startedAt) });
          resolve();
        }, { once: true });
        mediaSource.addEventListener('error', () => reject(new Error(aiT('audioPlaybackError'))), { once: true });
      });
      const responsePromise = speakVoiceStream({
        text: textToRead,
        language: msgLang || 'en',
        signal: controller.signal
      });
      const [, response] = await Promise.all([sourceOpen, responsePromise]);
      voiceDiagnostic('ttsResponseHeadersReceived', { elapsedMs: Math.round(highResolutionNow() - startedAt) });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error?.message || aiT('audioPlaybackError'));
      }

      const sourceBuffer = mediaSource.addSourceBuffer(response.headers.get('Content-Type')?.split(';')[0] || 'audio/mpeg');
      const reader = response.body.getReader();
      ttsReaderRef.current = reader;
      let firstChunk = true;
      let playbackStarted = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        if (firstChunk) {
          firstChunk = false;
          voiceDiagnostic('firstAudioChunkReceived', {
            elapsedMs: Math.round(highResolutionNow() - startedAt),
            bytes: value.byteLength
          });
        }
        await new Promise((resolve, reject) => {
          sourceBuffer.addEventListener('updateend', resolve, { once: true });
          sourceBuffer.addEventListener('error', () => reject(new Error(aiT('audioPlaybackError'))), { once: true });
          try {
            sourceBuffer.appendBuffer(value);
          } catch (error) {
            reject(error);
          }
        });
        if (!playbackStarted) {
          playbackStarted = true;
          void audio.play().catch((error) => {
            if (activeAudioElementRef.current !== audio) return;
            handleStopAudio();
            setVoiceError(error.message || aiT('audioPlaybackError'));
          });
        }
      }
      if (firstChunk) throw new Error(aiT('audioPlaybackError'));
      if (mediaSource.readyState === 'open' && !sourceBuffer.updating) mediaSource.endOfStream();
      ttsReaderRef.current = null;
      if (!audio.paused) setPlayingMessageId(messageId);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[TTS Error]:', error);
      }
      if (voiceStartTimedOut) {
        setVoiceError(aiT('audioPrepareTimeout'));
      } else if (error.name !== 'AbortError') {
        setVoiceError(error.voiceAvailable
          ? translate(uiLanguage, 'voice.unavailable')
          : error.message || aiT('audioPlaybackError'));
      }
      if (audio) audio.pause();
      if (ttsReaderRef.current) {
        await ttsReaderRef.current.cancel().catch(() => {});
        ttsReaderRef.current = null;
      }
      if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
      mediaSourceRef.current = null;
      activeAudioElementRef.current = null;
      setPlayingMessageId(null);
      setPreparingMessageId(null);
      setIsPaused(false);
    } finally {
      if (audioStarted || !audio) window.clearTimeout(timeoutId);
      if (ttsAbortControllerRef.current === controller) ttsAbortControllerRef.current = null;
    }
  };

  const handleStopAudio = () => {
    ttsAbortControllerRef.current?.abort();
    ttsAbortControllerRef.current = null;
    if (ttsReaderRef.current) {
      void ttsReaderRef.current.cancel().catch(() => {});
      ttsReaderRef.current = null;
    }
    if (activeAudioElementRef.current) {
      activeAudioElementRef.current.onended = null;
      activeAudioElementRef.current.onerror = null;
      activeAudioElementRef.current.onplaying = null;
      activeAudioElementRef.current.pause();
      activeAudioElementRef.current.currentTime = 0;
      activeAudioElementRef.current.removeAttribute('src');
      activeAudioElementRef.current.load();
      activeAudioElementRef.current = null;
    }
    if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
    audioObjectUrlRef.current = null;
    mediaSourceRef.current = null;
    setPlayingMessageId(null);
    setPreparingMessageId(null);
    setIsPaused(false);
  };

  // Playback recorded farmer voice audio
  const handlePlayFarmerVoice = (blobUrl) => {
    if (!blobUrl) return;
    handleStopAudio();
    const audio = new Audio(blobUrl);
    activeAudioElementRef.current = audio;
    audio.play().catch((error) => {
      console.warn('[AIChatView] Recorded voice playback failed:', error.message);
      setVoiceError(aiT('recordedPlaybackError'));
    });
  };

  const startLiveVoice = async () => {
    if (liveSessionRef.current || !farmId || isRecording || isThinking || isTranscribing) return;
    const startId = ++liveStartIdRef.current;
    setLiveError('');
    setLiveTranscript('');
    setLivePartialTranscript('');
    setLiveSessionSeconds(0);
    setLiveMuted(false);
    setLiveStatus('connecting');
    try {
      const sessionConfig = await getLiveVoiceToken({ language: uiLanguage, farmId });
      if (startId !== liveStartIdRef.current) return;
      setLiveMaxMinutes(sessionConfig.maxMinutes || 30);
      const sessionFarmId = sessionConfig.farmId || farmId;
      const session = await connectGeminiLiveVoice({
        token: sessionConfig.token,
        setup: sessionConfig.setup,
        onStatus: (status) => {
          setLiveStatus(status);
          if (status === 'disconnected') liveSessionRef.current = null;
        },
        onTranscript: (text, isFinal, role) => {
          if (isFinal) {
            setLiveTranscript((previous) => `${previous}${previous ? '\n' : ''}${text}`.slice(-3000));
            setLivePartialTranscript('');
            saveLiveVoiceMessage({
              conversationId,
              role,
              message: text,
              language: uiLanguage,
              farmId: sessionFarmId
            }).catch((error) => {
              console.error('[AgriShield Live Voice] Transcript could not be saved:', error.message);
              setLiveError(error.message || 'The Live Voice transcript could not be saved.');
            });
          } else {
            setLivePartialTranscript(text);
          }
        },
        onError: (error) => setLiveError(error.message || t.liveUnavailable)
      });
      if (startId !== liveStartIdRef.current) {
        session.stop();
        return;
      }
      liveSessionRef.current = session;
    } catch (error) {
      if (startId !== liveStartIdRef.current) return;
      console.error('[AgriShield Live Voice] Session could not start:', error);
      setLiveStatus('disconnected');
      setLiveError(error.message || t.liveUnavailable);
    }
  };

  const endLiveVoice = ({ closeDialog = false } = {}) => {
    liveStartIdRef.current += 1;
    liveSessionRef.current?.stop();
    liveSessionRef.current = null;
    setLiveStatus('idle');
    setLiveMuted(false);
    setLiveSessionSeconds(0);
    setLivePartialTranscript('');
    if (closeDialog) setLiveDialogOpen(false);
  };

  const toggleLiveMute = () => {
    const nextMuted = !liveMuted;
    liveSessionRef.current?.setMuted(nextMuted);
    setLiveMuted(nextMuted);
  };

  useEffect(() => {
    if (!['listening', 'thinking', 'speaking'].includes(liveStatus)) return undefined;
    const timer = window.setInterval(() => setLiveSessionSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [liveStatus]);

  useEffect(() => {
    if (!liveSessionRef.current || liveSessionSeconds < liveMaxMinutes * 60) return;
    endLiveVoice();
    setLiveError(t.liveTimeLimit);
  }, [liveSessionSeconds, liveMaxMinutes, t.liveTimeLimit]);

  return (
    <div className="agrishield-conversation-screen ai-chat-surface animate-fadeIn">
      {/* 1. TOP HEADER WITH BRANDING, NEW CHAT, LANGUAGE SELECTOR, AND PROFILE */}
      <header className="ai-chat-header">
        <div className="header-left">
          <div className="ai-brand-icon">
            <Bot size={21} aria-hidden="true" />
          </div>
          <div>
            <div className="title-row">
              <h2 className="ai-brand-heading">AgriShield AI</h2>
            </div>
            <p className="ai-brand-sub">{t.assistantSub}</p>
            {farmId && <p className="ai-farm-context">{farmContextLabel}</p>}
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="ai-header-live-button"
            onClick={() => setLiveDialogOpen(true)}
            disabled={isRecording || isThinking || isTranscribing}
            title={t.liveVoice}
            aria-label={t.liveVoice}
          >
            <Mic size={16} aria-hidden="true" />
            <span>{t.liveVoice}</span>
          </button>
          <button 
            className="btn-new-chat"
            type="button"
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
        </div>
      </header>

      {liveDialogOpen && (
        <div className="live-voice-backdrop">
          <section className="live-voice-dialog" role="dialog" aria-modal="true" aria-labelledby="live-voice-title">
            <header className="live-voice-dialog-header">
              <div className="live-voice-heading">
                <span className={`live-voice-status-dot ${liveStatus}`} aria-hidden="true" />
                <div>
                  <h3 id="live-voice-title">{t.liveVoice}</h3>
                  <span aria-live="polite">
                    {liveStatus === 'connecting' ? t.liveConnecting :
                      liveStatus === 'listening' ? t.liveListening :
                        liveStatus === 'thinking' ? t.liveThinking :
                          liveStatus === 'speaking' ? t.liveSpeaking :
                            liveStatus === 'disconnected' ? t.liveUnavailable :
                              liveStatus === 'idle' ? t.liveReady : t.liveConnected}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="live-voice-close"
                onClick={() => endLiveVoice({ closeDialog: true })}
                aria-label={t.close}
                title={t.close}
              >
                <X size={18} />
              </button>
            </header>
            <p className="live-voice-intro">{t.liveIntro}</p>
            {liveStatus !== 'idle' && liveStatus !== 'disconnected' && (
              <div className="live-voice-duration" aria-live="off">
                {String(Math.floor(liveSessionSeconds / 60)).padStart(2, '0')}:{String(liveSessionSeconds % 60).padStart(2, '0')}
                <span> / {liveMaxMinutes}:00</span>
              </div>
            )}
            <div className="live-voice-transcript" aria-label={t.liveTranscript} aria-live="polite">
              <strong>{t.liveTranscript}</strong>
              <p>{liveTranscript || livePartialTranscript
                ? [liveTranscript, livePartialTranscript].filter(Boolean).join('\n')
                : t.liveIntro}</p>
            </div>
            {liveError && <p className="live-voice-error" role="alert">{liveError}</p>}
            <div className="live-voice-controls">
              {['idle', 'disconnected'].includes(liveStatus) ? (
                <button type="button" className="live-voice-start" onClick={startLiveVoice}>
                  <Mic size={17} />
                  <span>{t.startLive}</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="live-voice-mute"
                    onClick={toggleLiveMute}
                    aria-pressed={liveMuted}
                    disabled={liveStatus === 'connecting'}
                  >
                    {liveMuted ? <Mic size={17} /> : <MicOff size={17} />}
                    <span>{liveMuted ? t.resumeMic : t.mute}</span>
                  </button>
                  <button type="button" className="live-voice-end" onClick={() => endLiveVoice({ closeDialog: true })}>
                    <PhoneOff size={17} />
                    <span>{t.endLive}</span>
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}

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
            <h3 className="welcome-title">{aiT('emptyTitle')}</h3>
            <p className="welcome-sub">{aiT('emptySubtitle')}</p>
            <p className="ai-empty-prompt">{aiT('emptyPrompt')}</p>
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
                  {m.voiceBlobUrl && <div className="voice-audio-bar">
                    <button 
                      className="voice-play-icon"
                      onClick={() => handlePlayFarmerVoice(m.voiceBlobUrl)}
                      title={aiT('playRecordedAudio')}
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
                  </div>}
                  {m.text && (
                    <div className="voice-recognized-confirmation">
                      <span className="confirmation-label">{t.voiceBubblePrefix}:</span>
                      <p className="confirmation-text">"{m.text}"</p>
                    </div>
                  )}
                </div>
              )}

              {/* Farmer Uploaded Image Attachment (Section 22, 23) */}
              {(m.image || m.imageUrl) && (
                <div className="message-image-attachment">
                  <img src={m.image || m.imageUrl} alt={aiT('cropSample')} className="attached-crop-image" />
                  <span className="image-tag"><ImageIcon size={14} aria-hidden="true" /> {aiT('cropPhoto')}</span>
                </div>
              )}
              {m.analysisStatus && !(isThinking && ['UPLOADING', 'ANALYZING'].includes(m.analysisStatus)) && (
                <div className={`ai-image-processing-status ${m.analysisStatus.toLowerCase()}`} role="status">
                  {m.analysisStatus === 'UPLOADING'
                    ? aiT('uploadingImage')
                    : m.analysisStatus === 'ANALYZING'
                      ? aiT('analyzingUploadedImage')
                      : m.analysisStatus === 'COMPLETED'
                        ? aiT('analysisComplete')
                        : m.analysisStatus === 'FAILED'
                          ? aiT('analysisFailed')
                          : aiT('imageUploadFailed')}
                </div>
              )}
              {m.sender === 'farmer' && m.analysisStatus === 'FAILED' &&
                (!lastFailedQuery || lastFailedQuery.imageMessageId !== m.serverMessageId) && (
                  <div className="error-retry-action">
                    <button
                      className="btn-retry-query"
                      onClick={() => handleRetry(`retry-${m.id}`, m.serverMessageId)}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      <span>{t.tryAgain}</span>
                    </button>
                  </div>
                )}
              {!m.image && m.imagePath && (
                <div className="image-tag"><ImageIcon size={14} aria-hidden="true" /> {aiT('cropPhotoAttached')}</div>
              )}

              {/* Text Message Content */}
              {(!m.isVoice || m.sender === 'ai') && (
                <div className={`message-bubble ${m.sender} ${m.isError ? 'error-bubble' : ''}`}>
                  {m.sender === 'ai' && (
                    <div className="ai-response-meta-header">
                      <span className="ai-sender-name"><Bot size={15} aria-hidden="true" /> AgriShield AI</span>
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
                          <span>{m.intent === 'WEATHER' ? `${aiT('weatherData')} ` : `${aiT('sources')} `}{m.sources.map((source) => (
                            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                              {source.publisher || source.title}
                            </a>
                          ))}</span>
                        </div>
                      )}
                      {m.conversationPersisted === false && (
                        <p className="ai-chat-input-status error" role="status">
                          {aiT('conversationNotSaved')}
                        </p>
                      )}
                      {m.weather?.available && (
                        <div className="weather-data-badge" title={`Retrieved ${m.weather.timestamp}`}>
                          <CloudRain size={13} color="#94a3b8" />
                          <span>{aiT('weatherMeta', {
                            provider: m.weather.provider,
                            date: new Date(m.weather.timestamp).toLocaleString()
                          })}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Response Actions Bar: TTS, Copy & Feedback (Section 19, 21, 135, 136) */}
                  {m.sender === 'ai' && !m.isError && (
                    <div className="ai-card-actions-bar ai-compact-actions">
                      <button
                        type="button"
                        className="ai-listen-action"
                        onClick={() => handlePlayAudio(m.id, m.text, m.language)}
                        aria-label={preparingMessageId === m.id
                          ? aiT('preparingVoice')
                          : playingMessageId === m.id ? (isPaused ? t.resume : t.pause) : t.listen}
                        title={preparingMessageId === m.id
                          ? aiT('preparingVoice')
                          : playingMessageId === m.id ? (isPaused ? t.resume : t.pause) : t.listen}
                      >
                        {preparingMessageId === m.id
                          ? <StopCircle size={15} aria-hidden="true" />
                          : playingMessageId === m.id && !isPaused
                          ? <Pause size={15} aria-hidden="true" />
                          : <Play size={15} aria-hidden="true" />}
                      </button>
                      {preparingMessageId === m.id && (
                        <span className="ai-speaking-status" role="status">{aiT('preparingVoice')}</span>
                      )}
                      {playingMessageId === m.id && (
                        <span className="ai-speaking-status" role="status">
                          {aiT('speakingIn', {
                            language: m.language === 'te' ? 'తెలుగు' : m.language === 'hi' ? 'हिंदी' : 'English'
                          })}
                        </span>
                      )}
                      <details className="ai-message-actions-menu">
                        <summary aria-label={aiT('messageActions')} title={aiT('messageActions')}>
                          <MoreHorizontal size={17} aria-hidden="true" />
                        </summary>
                        <div className="ai-message-actions-list">
                          <button
                            type="button"
                            onClick={() => handleCopy(m.id, m.text)}
                            aria-label={copiedId === m.id ? t.copied : t.copy}
                          >
                            {copiedId === m.id ? <Check size={15} /> : <Copy size={15} />}
                            <span>{copiedId === m.id ? t.copied : t.copy}</span>
                          </button>
                          <button
                            type="button"
                            className={feedbackState[m.id] === 'up' ? 'active' : ''}
                            onClick={() => handleFeedback(m.id, 'up')}
                            aria-label={aiT('helpful')}
                            disabled={feedbackPendingId === m.id}
                          >
                            <ThumbsUp size={15} />
                            <span>{aiT('helpful')}</span>
                          </button>
                          <button
                            type="button"
                            className={feedbackState[m.id] === 'down' ? 'active' : ''}
                            onClick={() => handleFeedback(m.id, 'down')}
                            aria-label={aiT('notHelpful')}
                            disabled={feedbackPendingId === m.id}
                          >
                            <ThumbsDown size={15} />
                            <span>{aiT('notHelpful')}</span>
                          </button>
                        </div>
                      </details>
                    </div>
                  )}

                  {/* Error Retry Button (Section 46) */}
                  {m.isError && (
                    <div className="error-retry-action">
                      <button className="btn-retry-query" onClick={() => handleRetry(m.id)}>
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

      {attachedImage && (
        <div className="attached-image-preview-bar animate-fadeIn">
          <div className="preview-image-box">
            <img src={attachedImage.url} alt={aiT('cropSample')} />
            <button
              type="button"
              className="btn-remove-attachment"
              onClick={removeAttachedImage}
              title={aiT('removeImage')}
              aria-label={aiT('removeImageAction')}
            >
              <X size={12} />
            </button>
          </div>
          <span className="preview-filename">{attachedImage.name} ({aiT('readyToSend')})</span>
        </div>
      )}
      {attachmentError && <div className="ai-chat-input-status error" role="alert">{attachmentError}</div>}
      {voiceError && <div className="ai-chat-input-status error" role="alert">{voiceError}</div>}
      {feedbackError && <div className="ai-chat-input-status error" role="alert">{feedbackError}</div>}
      {isTranscribing && <div className="ai-chat-input-status" role="status">{t.transcribing}</div>}

      <footer className="ai-chat-input-footer">
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

        {isRecording ? (
          <div className="ai-recording-controls" role="status">
            <span className="recording-pulsing-badge">
              <span className="red-record-dot" aria-hidden="true" />
              <span>{aiT('recordingStatus', {
                time: `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`
              })}</span>
            </span>
            <button type="button" className="btn-record-cancel" onClick={handleCancelRecording}>
              <X size={15} aria-hidden="true" />
              <span>{t.cancel}</span>
            </button>
            <button type="button" className="btn-record-send" onClick={handleSendRecording}>
              <Square size={15} aria-hidden="true" />
              <span>{t.stopAndTranscribe}</span>
            </button>
          </div>
        ) : (
          <>
            <div className="ai-attach-menu">
              <button
                type="button"
                className="btn-input-accessory ai-attach-trigger"
                onClick={() => setAttachMenuOpen((open) => !open)}
                aria-expanded={attachMenuOpen}
                aria-label={aiT('attachPhoto')}
                title={aiT('attachPhoto')}
                disabled={isThinking || isTranscribing}
              >
                <ImageIcon size={19} aria-hidden="true" />
              </button>
              {attachMenuOpen && (
                <div className="ai-attach-options" role="group" aria-label={aiT('attachPhoto')}>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      cameraInputRef.current?.click();
                    }}
                  >
                    <Camera size={16} aria-hidden="true" />
                    <span>{aiT('takePhoto')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <ImageIcon size={16} aria-hidden="true" />
                    <span>{aiT('chooseImage')}</span>
                  </button>
                </div>
              )}
            </div>

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
                disabled={isThinking || isTranscribing}
              />
              <button
                type="button"
                className="btn-input-accessory mic"
                onClick={startRecording}
                title={aiT('startRecording')}
                aria-label={aiT('startRecording')}
                disabled={isThinking || isTranscribing || voiceConfigLoading}
              >
                <Mic size={20} aria-hidden="true" />
              </button>
              <button
                type="submit"
                className="btn-send-message"
                disabled={(!inputText.trim() && !attachedImage) || isThinking || isTranscribing}
                title={t.send}
                aria-label={t.send}
              >
                <Send size={18} aria-hidden="true" />
              </button>
            </form>
          </>
        )}
      </footer>
    </div>
  );
}
