const LIVE_SOCKET_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function downsampleAndEncode(samples, inputRate, outputRate = 16000) {
  const ratio = inputRate / outputRate;
  const length = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), samples.length);
    let sum = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) sum += samples[sampleIndex];
    const sample = end > start ? sum / (end - start) : 0;
    pcm[index] = Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff);
  }
  return encodeBase64(new Uint8Array(pcm.buffer));
}

function stopPlayback(resources) {
  resources.outputSources.forEach((source) => {
    try { source.stop(); } catch {}
  });
  resources.outputSources.clear();
  resources.nextPlaybackTime = 0;
}

export async function connectGeminiLiveVoice({ token, setup, onStatus, onTranscript, onError }) {
  if (!window.WebSocket || !window.AudioContext) {
    throw new Error('Live Voice audio is not supported in this browser.');
  }
  const resources = {
    socket: null,
    stream: null,
    context: null,
    source: null,
    processor: null,
    silentGain: null,
    outputSources: new Set(),
    nextPlaybackTime: 0,
    transcriptDrafts: { user: '', assistant: '' },
    muted: false,
    stopped: false
  };

  const stop = () => {
    if (resources.stopped) return;
    resources.stopped = true;
    if (resources.processor) {
      resources.processor.onaudioprocess = null;
      resources.processor.disconnect();
    }
    resources.source?.disconnect();
    resources.silentGain?.disconnect();
    resources.stream?.getTracks().forEach((track) => track.stop());
    stopPlayback(resources);
    if (resources.socket) {
      resources.socket.onopen = null;
      resources.socket.onmessage = null;
      resources.socket.onerror = null;
      resources.socket.onclose = null;
      if (resources.socket.readyState < WebSocket.CLOSING) resources.socket.close(1000, 'Session ended');
    }
    if (resources.context && resources.context.state !== 'closed') void resources.context.close();
  };

  const setMuted = (muted) => {
    resources.muted = Boolean(muted);
    resources.stream?.getAudioTracks().forEach((track) => { track.enabled = !resources.muted; });
    if (!resources.muted) onStatus?.('listening');
  };

  try {
    resources.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    resources.context = new AudioContext({ sampleRate: 16000 });
    await resources.context.resume();
    resources.source = resources.context.createMediaStreamSource(resources.stream);
    resources.processor = resources.context.createScriptProcessor(4096, 1, 1);
    resources.silentGain = resources.context.createGain();
    resources.silentGain.gain.value = 0;

    const socketUrl = `${LIVE_SOCKET_BASE}?access_token=${encodeURIComponent(token)}`;
    resources.socket = new WebSocket(socketUrl);
    resources.socket.binaryType = 'arraybuffer';
    onStatus?.('connecting');

    await new Promise((resolve, reject) => {
      let ready = false;
      const timeout = window.setTimeout(() => reject(new Error('Gemini Live connection timed out.')), 15000);
      resources.socket.onopen = () => {
        resources.socket.send(JSON.stringify({ setup }));
      };
      resources.socket.onerror = () => {
        window.clearTimeout(timeout);
        const error = new Error('Gemini Live could not connect. Check the Live API configuration and try again.');
        if (!ready) reject(error);
        else onError?.(error);
      };
      resources.socket.onclose = (event) => {
        window.clearTimeout(timeout);
        if (!resources.stopped) {
          const error = new Error(event.reason || 'Gemini Live disconnected.');
          if (!ready) reject(error);
          onError?.(error);
          onStatus?.('disconnected');
          stop();
        }
      };
      resources.socket.onmessage = async (event) => {
        try {
          const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
          if (message.error) {
            const error = new Error(message.error.message || 'Gemini Live reported an error.');
            if (!ready) reject(error);
            else {
              onError?.(error);
              onStatus?.('disconnected');
              stop();
            }
            return;
          }
          if (message.setupComplete) {
            ready = true;
            window.clearTimeout(timeout);
            onStatus?.('listening');
            resolve();
          }
          const content = message.serverContent;
          for (const [role, transcription] of [
            ['user', content?.inputTranscription],
            ['assistant', content?.outputTranscription]
          ]) {
            if (!transcription?.text) continue;
            if (transcription.finished) {
              onTranscript?.(transcription.text, true, role);
              resources.transcriptDrafts[role] = '';
            } else {
              resources.transcriptDrafts[role] = transcription.text;
              onTranscript?.(transcription.text, false, role);
            }
          }
          if (content?.interrupted) {
            stopPlayback(resources);
            onStatus?.('listening');
          }
          const parts = content?.modelTurn?.parts || [];
          const audioParts = parts.filter((part) => part.inlineData?.data);
          if (content?.modelTurn && !audioParts.length) onStatus?.('thinking');
          if (audioParts.length) {
            onStatus?.('speaking');
            for (const part of audioParts) {
              const rateMatch = String(part.inlineData.mimeType || '').match(/rate=(\d+)/);
              const sampleRate = Number(rateMatch?.[1]) || 24000;
              const bytes = decodeBase64(part.inlineData.data);
              const sampleCount = Math.floor(bytes.byteLength / 2);
              if (!sampleCount) continue;
              const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
              const audioBuffer = resources.context.createBuffer(1, sampleCount, sampleRate);
              const channel = audioBuffer.getChannelData(0);
              for (let index = 0; index < sampleCount; index += 1) channel[index] = pcm[index] / (pcm[index] < 0 ? 0x8000 : 0x7fff);
              const source = resources.context.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(resources.context.destination);
              source.onended = () => resources.outputSources.delete(source);
              const startAt = Math.max(resources.context.currentTime, resources.nextPlaybackTime);
              source.start(startAt);
              resources.nextPlaybackTime = startAt + audioBuffer.duration;
              resources.outputSources.add(source);
            }
          }
          if (content?.turnComplete) {
            Object.entries(resources.transcriptDrafts).forEach(([role, text]) => {
              if (text) onTranscript?.(text, true, role);
              resources.transcriptDrafts[role] = '';
            });
            onStatus?.('listening');
          }
        } catch (error) {
          onError?.(error);
        }
      };
    });

    resources.processor.onaudioprocess = (event) => {
      if (resources.muted || resources.socket.readyState !== WebSocket.OPEN) return;
      const data = downsampleAndEncode(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
      resources.socket.send(JSON.stringify({
        realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data }] }
      }));
    };
    resources.source.connect(resources.processor);
    resources.processor.connect(resources.silentGain);
    resources.silentGain.connect(resources.context.destination);
    return { stop, setMuted };
  } catch (error) {
    stop();
    throw error;
  }
}
