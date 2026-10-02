const { spawn } = require('child_process');
const path = require('path');
const { pipeline, env } = require('@huggingface/transformers');
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');

const MODEL_ID = process.env.WHISPER_MODEL || 'onnx-community/whisper-tiny';
const CACHE_DIR = process.env.WHISPER_CACHE_DIR || path.join(__dirname, '..', 'models', 'whisper');
env.cacheDir = CACHE_DIR;
env.allowRemoteModels = true;
env.allowLocalModels = true;

let transcriberPromise;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'cpu',
      dtype: 'q8'
    }).catch((error) => {
      transcriberPromise = null;
      throw new AgriShieldError(
        ERROR_CODES.TRANSCRIPTION_FAILED,
        `Could not load the local Whisper model '${MODEL_ID}': ${error.message}`,
        503
      );
    });
  }
  return transcriberPromise;
}

function decodeAudio(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    const child = spawn(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-f', 'f32le', '-acodec', 'pcm_f32le',
      '-ac', '1', '-ar', '16000', 'pipe:1'
    ], { windowsHide: true });
    const output = [];
    const errors = [];
    let outputLength = 0;

    child.stdout.on('data', (chunk) => {
      outputLength += chunk.length;
      if (outputLength > 100 * 1024 * 1024) {
        child.kill();
        reject(new AgriShieldError(ERROR_CODES.AUDIO_TOO_LARGE, 'Decoded audio exceeds the processing limit.', 413));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', (error) => {
      reject(new AgriShieldError(
        ERROR_CODES.TRANSCRIPTION_FAILED,
        `Local audio decoding is unavailable. Install FFmpeg or set FFMPEG_PATH. ${error.message}`,
        503
      ));
    });
    child.on('close', (code) => {
      if (code !== 0 || !outputLength) {
        reject(new AgriShieldError(
          ERROR_CODES.TRANSCRIPTION_FAILED,
          `FFmpeg could not decode the uploaded audio: ${Buffer.concat(errors).toString('utf8').slice(0, 400)}`,
          400
        ));
        return;
      }
      const pcm = Buffer.concat(output);
      const alignedPcm = pcm.subarray(0, pcm.length - (pcm.length % 4));
      resolve(new Float32Array(alignedPcm.buffer, alignedPcm.byteOffset, alignedPcm.length / 4));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(audioBuffer);
  });
}

async function transcribe({ audioBuffer, language = 'auto' }) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'No audio data received.', 400);
  }
  const audio = await decodeAudio(audioBuffer);
  const transcriber = await getTranscriber();
  const languageName = ({ en: 'english', te: 'telugu', hi: 'hindi' })[language];
  let result;
  try {
    result = await transcriber({ raw: audio, sampling_rate: 16000 }, {
      task: 'transcribe',
      ...(languageName ? { language: languageName } : {}),
      return_timestamps: false
    });
  } catch (error) {
    throw new AgriShieldError(ERROR_CODES.TRANSCRIPTION_FAILED, `Local Whisper transcription failed: ${error.message}`, 502);
  }

  const text = typeof result?.text === 'string' ? result.text.trim() : '';
  if (!text) {
    throw new AgriShieldError(ERROR_CODES.TRANSCRIPTION_FAILED, 'The local speech model did not detect speech.', 422);
  }
  return { text, language };
}

module.exports = { transcribe, MODEL_ID };
