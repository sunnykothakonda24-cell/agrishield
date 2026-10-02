import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Bot, Volume2 } from 'lucide-react';
import { sendMessageToAI, speakVoice } from '../services/api';

export default function AIAssistantModal({
  isOpen,
  onClose,
  crop = null,
  farmHealth = null,
  onSpeak
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState('');
  const conversationIdRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    conversationIdRef.current = `modal-${Date.now()}`;
  }, []);

  if (!isOpen) return null;

  const handleSend = async (prompt = input) => {
    const message = prompt.trim();
    if (!message || isThinking) return;
    const history = messages.map((item) => ({
      role: item.sender === 'ai' ? 'assistant' : 'user',
      content: item.text
    }));
    setMessages((current) => [...current, { sender: 'user', text: message }]);
    setInput('');
    setIsThinking(true);
    setError('');

    try {
      const response = await sendMessageToAI({
        message,
        language: 'auto',
        conversationId: conversationIdRef.current,
        profile: { farm: crop ? { crop } : {} },
        history
      });
      setMessages((current) => [...current, {
        sender: 'ai',
        text: response.reply,
        language: response.language || 'en'
      }]);
    } catch (requestError) {
      setError(requestError.message || 'The assistant is unavailable. Please try again.');
    } finally {
      setIsThinking(false);
    }
  };

  const playResponse = async (message) => {
    try {
      if (onSpeak) {
        onSpeak(message.text, message.language);
        return;
      }
      const response = await speakVoice({ text: message.text, language: message.language });
      if (!response.audioBase64) {
        throw new Error('A matching speech voice is not configured.');
      }
      audioRef.current?.pause();
      audioRef.current = new Audio(`data:${response.format};base64,${response.audioBase64}`);
      await audioRef.current.play();
    } catch (speechError) {
      setError(speechError.message || 'Speech playback failed. The answer remains available as text.');
    }
  };

  const profileDescription = [crop, farmHealth].filter(Boolean).join(' · ');

  return (
    <div className="modal-backdrop-blur animate-fadeIn" onClick={onClose}>
      <div className="ai-modal-card animate-scaleUp" onClick={(event) => event.stopPropagation()}>
        <div className="ai-modal-header">
          <div className="ai-header-left">
            <div className="ai-avatar-badge"><Bot size={22} color="#10b981" /></div>
            <div>
              <h3 className="ai-modal-title">AgriShield AI</h3>
              <p className="ai-modal-subtitle">{profileDescription || 'Ask a question or start a conversation'}</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close assistant">
            <X size={20} />
          </button>
        </div>

        <div className="ai-chat-body">
          {messages.map((message, index) => (
            <div key={`${message.sender}-${index}`} className={`ai-message-row ${message.sender}`}>
              <div className="message-bubble">
                <p>{message.text}</p>
                {message.sender === 'ai' && (
                  <button className="btn-speak-bubble" onClick={() => playResponse(message)} title="Listen to this answer">
                    <Volume2 size={14} />
                    <span>Listen</span>
                  </button>
                )}
              </div>
            </div>
          ))}
          {isThinking && <div className="ai-message-row ai"><div className="message-bubble typing">Thinking…</div></div>}
          {error && <p role="alert" className="ai-modal-error">{error}</p>}
        </div>

        <form className="ai-input-form" onSubmit={(event) => { event.preventDefault(); handleSend(); }}>
          <input
            type="text"
            className="ai-chat-input"
            placeholder="Ask me anything..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isThinking}
          />
          <button type="submit" className="btn-ai-send" disabled={!input.trim() || isThinking} aria-label="Send question">
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
