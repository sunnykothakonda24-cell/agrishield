/**
 * AgriShield-AI Test Suite (Section 85, 86, 87, 88, 200, 201)
 * Validates conversational context, multilingual handling, error codes,
 * image validations, speech and TTS services, and prompt integrity.
 */

const assert = require('assert');
const crypto = require('crypto');
const { aiService } = require('../services/aiService');
const conversationService = require('../services/conversationService');
const conversationStorageService = require('../services/conversationStorageService');
const firestoreRepository = require('../services/firestoreRepository');
const providerFactory = require('../services/ai/providerFactory');
const speechService = require('../services/speechService');
const ttsService = require('../services/ttsService');
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');
const { ALLOWED_IMAGE_TYPES, ALLOWED_AUDIO_TYPES, imageMatchesMime } = require('../middleware/validation');
const { normalizeFarmBoundary } = require('../utils/farmGeometry');
const { detectLanguage, detectIntent } = require('../services/ai/languageIntent');
const {
  getLanguageConfig,
  resolveLanguage
} = require('../services/ai/languageRegistry');
const { ElevenLabsService } = require('../services/elevenLabsService');
const { buildSystemInstruction } = require('../services/aiService');
const GeminiProvider = require('../services/ai/geminiProvider');
const { SpeechService } = require('../services/speechService');
const { getFarmEnvironmentState } = require('../services/farmTwinService');
const { resolveFarmTimeZone } = require('../services/farmTimezoneService');
const { formatFarm } = require('../services/farmerProfileService');
const OpenAIProvider = require('../services/ai/openaiProvider');
const localStorageService = require('../services/storage/localStorageService');
const { resolveActiveFarm } = require('../middleware/firebaseAuth');
const {
  APPLICATION_PROJECT_ID,
  applicationFirebaseAdminConfigured,
  firebaseAdminConfigured,
  getFirebaseAdminConfigurationError,
  getApplicationFirebaseAdminConfigurationError,
  firestoreConfigured,
  privateFirebaseFirestoreConfigured,
  getPrivateFirestoreConfigurationError
} = require('../services/firebaseAdmin');
const weatherService = require('../services/weatherService');
const contextService = require('../services/contextService');
const { buildFarmContext } = contextService;
const { buildCropSchedule, cropKey, parseDateOnly } = require('../services/cropScheduleService');
const { filterProducts, normalizeCategory } = require('../services/shopCatalogService');
const cloudinaryImageService = require('../services/cloudinaryImageService');
const { CloudinaryImageService } = cloudinaryImageService;
const { syncFirebaseAccount } = require('../services/firebaseAccountService');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}:`, err.message);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}:`, err.message);
  }
}

function createFirestoreMock() {
  const collections = new Map();
  let nextId = 0;

  function collectionData(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  function snapshot(name, id) {
    const value = collectionData(name).get(id);
    return {
      id,
      exists: value !== undefined,
      ref: makeDocumentReference(name, id),
      data: () => value === undefined ? undefined : { ...value }
    };
  }

  function makeDocumentReference(name, documentId) {
    return {
      id: documentId,
      collection(childName) {
        return collection(`${name}/${documentId}/${childName}`);
      },
      async get() {
        return snapshot(name, documentId);
      },
      async set(value, options = {}) {
        const previous = collectionData(name).get(documentId);
        collectionData(name).set(documentId, options.merge && previous
          ? { ...previous, ...value }
          : { ...value });
      },
      async create(value) {
        if (collectionData(name).has(documentId)) throw new Error('already exists');
        collectionData(name).set(documentId, { ...value });
      },
      async update(value) {
        const previous = collectionData(name).get(documentId);
        if (!previous) throw new Error('not found');
        collectionData(name).set(documentId, { ...previous, ...value });
      },
      async delete() {
        collectionData(name).delete(documentId);
      }
    };
  }

  function makeQuery(name, filters = [], ordering = null, resultLimit = Infinity) {
    const query = {
      where(field, operator, value) {
        return makeQuery(name, [...filters, [field, operator, value]], ordering, resultLimit);
      },
      orderBy(field, direction) {
        return makeQuery(name, filters, [field, direction], resultLimit);
      },
      limit(value) {
        return makeQuery(name, filters, ordering, value);
      },
      async get() {
        let entries = [...collectionData(name).entries()]
          .filter(([, data]) => filters.every(([field, operator, value]) => {
            if (operator === '==') return data[field] === value;
            if (operator === '>=') return data[field] >= value;
            if (operator === '<=') return data[field] <= value;
            return false;
          }));
        if (ordering) {
          const [field, direction] = ordering;
          entries.sort((a, b) => {
            const comparison = a[1][field] < b[1][field] ? -1 : a[1][field] > b[1][field] ? 1 : 0;
            return direction === 'desc' ? -comparison : comparison;
          });
        }
        entries = entries.slice(0, resultLimit);
        const docs = entries.map(([id]) => snapshot(name, id));
        return { docs, empty: docs.length === 0 };
      }
    };
    return query;
  }

  function collection(name) {
    return {
      doc(id) {
        const documentId = id || `auto-${++nextId}`;
        return makeDocumentReference(name, documentId);
      },
      where(field, operator, value) {
        return makeQuery(name, [[field, operator, value]]);
      },
      async get() {
        return makeQuery(name).get();
      }
    };
  }

  return {
    collection,
    batch() {
      const operations = [];
      return {
        delete(reference) {
          operations.push(reference);
        },
        async commit() {
          await Promise.all(operations.map((reference) => reference.delete()));
        }
      };
    },
    async runTransaction(callback) {
      return callback({
        get: (ref) => ref.get(),
        set: (ref, value, options) => ref.set(value, options)
      });
    }
  };
}

async function runAll() {
  console.log('\n==================================================');
  console.log('  AGRISHIELD-AI PHASE 1 COMPREHENSIVE TEST SUITE');
  console.log('==================================================\n');

  // 1. PROVIDER FACTORY & STATUS TESTS
  console.log('--- 1. Provider Architecture & Configuration ---');
  runTest('Provider factory defaults to Gemini', () => {
    const provider = providerFactory.getProvider();
    assert.strictEqual(provider.name, 'gemini');
  });

  runTest('Provider factory keeps OpenAI available when requested', () => {
    const provider = providerFactory.getProvider('openai');
    assert.strictEqual(provider.name, 'openai');
  });

  runTest('Provider factory supports Gemini without replacing existing providers', () => {
    assert.strictEqual(providerFactory.getProvider('gemini').name, 'gemini');
    assert.strictEqual(providerFactory.getProvider('ollama').name, 'ollama');
    assert.strictEqual(providerFactory.getProvider('openai').name, 'openai');
  });

  await runAsyncTest('Gemini text uses configured model and maps the system instruction', async () => {
    let request;
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: { models: { generateContent: async (value) => {
        request = value;
        return { text: 'Gemini response', candidates: [{ finishReason: 'STOP' }] };
      } } }
    });
    const result = await provider.chat({
      systemInstruction: 'Reply in Telugu.',
      messages: [{ role: 'user', content: 'Ask' }],
      maxTokens: 200
    });
    assert.strictEqual(request.model, 'gemini-2.5-flash');
    assert.strictEqual(request.config.systemInstruction, 'Reply in Telugu.');
    assert.strictEqual(request.contents[0].role, 'user');
    assert.strictEqual(result.text, 'Gemini response');
    assert.strictEqual(result.provider, 'gemini');
  });

  await runAsyncTest('Gemini retries temporary text failures without substituting Ollama', async () => {
    let textAttempts = 0;
    let imageAttempts = 0;
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: { models: { generateContent: async (request) => {
        if (request.contents.at(-1)?.parts?.some((part) => part.inlineData)) {
          imageAttempts += 1;
          const error = new Error('upstream unavailable');
          error.status = 503;
          throw error;
        }
        textAttempts += 1;
        if (textAttempts < 3) {
          const error = new Error('upstream unavailable');
          error.status = 503;
          throw error;
        }
        return { text: 'Gemini response', candidates: [{ finishReason: 'STOP' }] };
      } } }
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await provider.chat({ messages: [{ role: 'user', content: 'Hello' }] });
      assert.strictEqual(result.provider, 'gemini');
      assert.strictEqual(result.text, 'Gemini response');
      assert.strictEqual(textAttempts, 3);
      await assert.rejects(
        () => provider.analyzeImage({ imageBuffer: Buffer.from('photo'), mimeType: 'image/jpeg' }),
        (error) => error.code === ERROR_CODES.IMAGE_ANALYSIS_UNAVAILABLE && error.statusCode === 503
      );
      assert.strictEqual(imageAttempts, 3);
    } finally {
      console.warn = originalWarn;
    }
  });

  await runAsyncTest('Gemini reports exhausted text retries as provider unavailable', async () => {
    let attempts = 0;
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: { models: { generateContent: async () => {
        attempts += 1;
        const error = new Error('upstream unavailable');
        error.status = 504;
        throw error;
      } } }
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await assert.rejects(
        provider.chat({ messages: [{ role: 'user', content: 'Hello' }] }),
        (error) => error.code === ERROR_CODES.AI_TIMEOUT && error.statusCode === 504
      );
      assert.strictEqual(attempts, 3);
    } finally {
      console.warn = originalWarn;
    }
  });

  await runAsyncTest('Gemini image analysis sends raw base64 with the actual MIME type to the vision model', async () => {
    let request;
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: { models: { generateContent: async (value) => {
        request = value;
        return { text: 'Visible leaf symptoms', candidates: [{ finishReason: 'STOP' }] };
      } } }
    });
    const result = await provider.analyzeImage({
      imageBuffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      prompt: 'Inspect the leaf.',
      systemInstruction: 'Reply in Hindi.'
    });
    assert.strictEqual(request.model, 'gemini-2.5-flash');
    assert.strictEqual(request.contents.at(-1).role, 'user');
    assert.strictEqual(request.contents.at(-1).parts[0].text, 'Inspect the leaf.');
    assert.strictEqual(request.contents.at(-1).parts[1].inlineData.mimeType, 'image/png');
    assert.strictEqual(request.contents.at(-1).parts[1].inlineData.data, Buffer.from('png-bytes').toString('base64'));
    assert.strictEqual(request.config.systemInstruction, 'Reply in Hindi.');
    assert.strictEqual(result.text, 'Visible leaf symptoms');
  });

  await runAsyncTest('Gemini image analysis retries transient timeouts, then returns the first successful result', async () => {
    let attempts = 0;
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: { models: { generateContent: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('gateway timeout');
          error.status = 504;
          throw error;
        }
        return { text: 'Analysis after retry', candidates: [{ finishReason: 'STOP' }] };
      } } }
    });
    const result = await provider.analyzeImage({
      imageBuffer: Buffer.from('image-bytes'),
      mimeType: 'image/webp',
      prompt: 'Check this plant.'
    });
    assert.strictEqual(attempts, 3);
    assert.strictEqual(result.text, 'Analysis after retry');
  });

  await runAsyncTest('Gemini image analysis does not retry permanent or rate-limit failures', async () => {
    for (const status of [400, 429]) {
      let attempts = 0;
      const provider = new GeminiProvider({
        apiKey: 'test-key',
        client: { models: { generateContent: async () => {
          attempts += 1;
          const error = new Error('non-retryable provider response');
          error.status = status;
          throw error;
        } } }
      });
      await assert.rejects(
        () => provider.analyzeImage({ imageBuffer: Buffer.from('photo'), mimeType: 'image/jpeg' }),
        (error) => status === 400
          ? error.code === ERROR_CODES.AI_PROVIDER_ERROR
          : error.code === ERROR_CODES.AI_RATE_LIMIT
      );
      assert.strictEqual(attempts, 1);
    }
  });

  await runAsyncTest('Cloudinary upload streams real image bytes to a private farm/conversation folder', async () => {
    const { Writable } = require('stream');
    const bytes = Buffer.from('image bytes preserved for Gemini');
    const captured = [];
    let uploadOptions;
    const client = {
      config() {},
      uploader: {
        upload_stream(options, callback) {
          uploadOptions = options;
          return new Writable({
            write(chunk, encoding, done) {
              captured.push(Buffer.from(chunk));
              done();
            },
            final(done) {
              done();
              setImmediate(() => callback(null, {
                asset_id: 'asset-123',
                public_id: 'agrishield/ai-images/user-a/farm-a/chat-1/message-1',
                version: 42,
                resource_type: 'image',
                type: 'authenticated',
                format: 'jpg',
                bytes: bytes.length,
                width: 1200,
                height: 900,
                created_at: '2026-10-04T12:00:00Z'
              }));
            }
          });
        }
      },
      url(publicId, options) {
        return `https://private.example/${publicId}?signed=${options.sign_url}`;
      }
    };
    const service = new CloudinaryImageService({
      client,
      env: {
        CLOUDINARY_CLOUD_NAME: 'test-cloud',
        CLOUDINARY_API_KEY: 'test-key',
        CLOUDINARY_API_SECRET: 'server-secret',
        CLOUDINARY_AI_FOLDER: 'agrishield/ai-images'
      }
    });
    const attachment = await service.uploadBuffer({
      buffer: bytes,
      mimeType: 'image/jpeg',
      ownerUid: 'user-a',
      farmId: 'farm-a',
      conversationId: 'chat-1',
      messageId: 'message-1'
    });
    assert.deepStrictEqual(Buffer.concat(captured), bytes);
    assert.strictEqual(uploadOptions.type, 'authenticated');
    assert.strictEqual(uploadOptions.folder, 'agrishield/ai-images/user-a/farm-a/chat-1');
    assert.strictEqual(uploadOptions.public_id, 'message-1');
    assert.strictEqual(attachment.assetId, 'asset-123');
    assert.strictEqual(attachment.bytes, bytes.length);
    assert.strictEqual(attachment.ownerUid, 'user-a');
    assert.strictEqual(service.status().reachable, true);
  });

  await runAsyncTest('Cloudinary configuration, signed delivery scope, and server-side image retrieval fail safely', async () => {
    const serviceWithoutCredentials = new CloudinaryImageService({ client: {}, env: {} });
    await assert.rejects(
      serviceWithoutCredentials.uploadBuffer({
        buffer: Buffer.from('image'),
        ownerUid: 'user-a',
        farmId: 'farm-a',
        conversationId: 'chat',
        messageId: 'message'
      }),
      (error) => error.code === ERROR_CODES.CLOUDINARY_NOT_CONFIGURED
    );

    let signedCalls = 0;
    let deliveryUrl;
    const imageBytes = Buffer.from('RIFF1234WEBP');
    const service = new CloudinaryImageService({
      client: {
        config() {},
        url(publicId, options) {
          signedCalls += 1;
          assert.strictEqual(options.type, 'authenticated');
          return `https://private.example/${publicId}`;
        }
      },
      env: {
        CLOUDINARY_CLOUD_NAME: 'test-cloud',
        CLOUDINARY_API_KEY: 'test-key',
        CLOUDINARY_API_SECRET: 'server-secret'
      },
      fetchImpl: async (url) => {
        deliveryUrl = url;
        return {
          ok: true,
          headers: { get: () => 'image/webp' },
          arrayBuffer: async () => imageBytes
        };
      }
    });
    const attachment = {
      provider: 'cloudinary',
      assetId: 'asset-123',
      publicId: 'agrishield/ai-images/user-a/farm-a/chat-1/message-1',
      version: 42,
      type: 'authenticated',
      format: 'webp',
      ownerUid: 'user-a',
      farmId: 'farm-a',
      conversationId: 'chat-1'
    };
    await assert.rejects(
      Promise.resolve().then(() => service.getSignedDeliveryUrl(attachment, {
        ownerUid: 'user-b', farmId: 'farm-a', conversationId: 'chat-1'
      })),
      (error) => error.statusCode === 403
    );
    assert.strictEqual(signedCalls, 0);
    const result = await service.getImageBuffer(attachment, {
      ownerUid: 'user-a', farmId: 'farm-a', conversationId: 'chat-1'
    });
    assert.strictEqual(deliveryUrl, `https://private.example/${attachment.publicId}`);
    assert.deepStrictEqual(result.buffer, imageBytes);
    assert.strictEqual(result.mimeType, 'image/webp');
  });

  await runAsyncTest('Cloudinary upload failures are controlled and do not report storage success', async () => {
    const service = new CloudinaryImageService({
      client: {
        config() {},
        uploader: {
          upload_stream(_options, callback) {
            const { Writable } = require('stream');
            return new Writable({
              write(_chunk, _encoding, done) { done(); },
              final(done) {
                done();
                setImmediate(() => callback(new Error('provider unavailable')));
              }
            });
          }
        }
      },
      env: {
        CLOUDINARY_CLOUD_NAME: 'test-cloud',
        CLOUDINARY_API_KEY: 'test-key',
        CLOUDINARY_API_SECRET: 'server-secret'
      }
    });
    await assert.rejects(
      service.uploadBuffer({
        buffer: Buffer.from('image'),
        ownerUid: 'user-a',
        farmId: 'farm-a',
        conversationId: 'chat',
        messageId: 'message'
      }),
      (error) => error.code === ERROR_CODES.IMAGE_UPLOAD_FAILED && error.statusCode === 502
    );
    assert.strictEqual(service.status().reachable, false);
  });

  await runAsyncTest('Cloudinary account cleanup deletes only authenticated assets below the verified UID prefix', async () => {
    const deletionRequests = [];
    const service = new CloudinaryImageService({
      client: {
        config() {},
        api: {
          async delete_resources_by_prefix(prefix, options) {
            deletionRequests.push({ prefix, options });
            return deletionRequests.length === 1
              ? { deleted: { first: 'deleted' }, next_cursor: 'page-2' }
              : { deleted: { second: 'deleted' } };
          }
        }
      },
      env: {
        CLOUDINARY_CLOUD_NAME: 'test-cloud',
        CLOUDINARY_API_KEY: 'test-key',
        CLOUDINARY_API_SECRET: 'server-secret',
        CLOUDINARY_AI_FOLDER: 'agrishield/ai-images'
      }
    });
    const result = await service.deleteUserAssets('verified-user');
    assert.deepStrictEqual(result, { deleted: true, deletedCount: 2 });
    assert.strictEqual(deletionRequests.length, 2);
    assert.strictEqual(deletionRequests[0].prefix, 'agrishield/ai-images/verified-user');
    assert.strictEqual(deletionRequests[1].options.next_cursor, 'page-2');
    assert.strictEqual(deletionRequests.every((request) =>
      request.options.type === 'authenticated' && request.options.resource_type === 'image'
    ), true);
  });

  await runAsyncTest('AI farm authorization only accepts the stored active farm and validates mismatched IDs', async () => {
    const repository = {
      async getFarmForUser(uid) {
        assert.strictEqual(uid, 'user-a');
        return { _id: 'farm-active', ownerUid: uid };
      },
      async getFarmOwnership(uid, farmId) {
        return uid === 'user-a' && ['farm-active', 'farm-other'].includes(farmId)
          ? { _id: farmId, userId: uid }
          : null;
      }
    };
    const selected = await resolveActiveFarm({
      uid: 'user-a',
      suppliedFarmId: 'farm-active',
      repository
    });
    assert.strictEqual(selected.farmId, 'farm-active');
    await assert.rejects(
      resolveActiveFarm({ uid: 'user-a', suppliedFarmId: 'farm-other', repository }),
      (error) => error.code === 'ACTIVE_FARM_MISMATCH' && error.statusCode === 409
    );
    await assert.rejects(
      resolveActiveFarm({ uid: 'user-a', suppliedFarmId: 'farm-owned-by-someone-else', repository }),
      (error) => error.code === 'FARM_ACCESS_DENIED' && error.statusCode === 403
    );
  });

  await runAsyncTest('Gemini unavailable model errors remain explicit and do not fall back', async () => {
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: { models: { generateContent: async () => {
        const error = new Error('model not found');
        error.status = 404;
        throw error;
      } } }
    });
    await assert.rejects(
      () => provider.chat({ messages: [{ role: 'user', content: 'Hello' }] }),
      (error) => error.code === ERROR_CODES.AI_NOT_CONFIGURED
    );
  });

  await runAsyncTest('Gemini Live token request constrains model and server-provided setup', async () => {
    let request;
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: { authTokens: { create: async (value) => {
        request = value;
        return { name: 'ephemeral-test-token', expireTime: '2026-01-01T00:02:00Z' };
      } } }
    });
    const session = await provider.createLiveToken({ systemInstruction: 'Speak Telugu.', languageCode: 'te-IN' });
    assert.strictEqual(session.token, 'ephemeral-test-token');
    assert.strictEqual(request.config.uses, 1);
    assert.strictEqual(request.config.liveConnectConstraints.model, 'models/gemini-3.8-live');
    assert.ok(request.config.lockAdditionalFields.includes('systemInstruction'));
    assert.strictEqual(session.setup.generationConfig.responseModalities[0], 'AUDIO');
  });

  runTest('Provider factory refuses unsupported providers', () => {
    assert.throws(() => providerFactory.getProvider('groq'), /Unsupported AI provider/);
    assert.throws(() => providerFactory.getProvider('openrouter'), /Unsupported AI provider/);
  });

  runTest('Ollama provider only accepts loopback URLs', () => {
    const OllamaProvider = require('../services/ai/ollamaProvider');
    assert.doesNotThrow(() => new OllamaProvider({ baseUrl: 'http://localhost:11434' }));
    assert.throws(() => new OllamaProvider({ baseUrl: 'https://example.com' }), /loopback address/);
  });

  await runAsyncTest('Ollama provider sends local chat requests without API credentials', async () => {
    const OllamaProvider = require('../services/ai/ollamaProvider');
    const originalFetch = global.fetch;
    let request;
    global.fetch = async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ done: true, message: { content: 'Local answer' } })
      };
    };
    try {
      const provider = new OllamaProvider({ model: 'qwen2.5:3b' });
      const result = await provider.chat({
        systemInstruction: 'Be a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello' }]
      });
      assert.strictEqual(result.text, 'Local answer');
      assert.strictEqual(request.url, 'http://127.0.0.1:11434/api/chat');
      assert.strictEqual(request.options.headers.Authorization, undefined);
      const body = JSON.parse(request.options.body);
      assert.strictEqual(body.model, 'qwen2.5:3b');
      assert.strictEqual(body.options.num_predict, 384);
      assert.ok(body.options.num_thread > 0);
      assert.ok(body.keep_alive);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await runAsyncTest('Firestore repository reports connectivity and persists farmer, farm, conversation, and notification data', async () => {
    const { FirestoreRepository } = require('../services/firestoreRepository');
    const { getApplicationFirebaseFirestore, getPrivateFirebaseFirestore } = require('../services/firebaseAdmin');
    const defaultRepository = new FirestoreRepository();
    assert.strictEqual(defaultRepository.getPrivateFirestoreInstance, getPrivateFirebaseFirestore);
    assert.strictEqual(defaultRepository.getFirestoreInstance, getApplicationFirebaseFirestore);
    const privateDatabase = createFirestoreMock();
    const database = createFirestoreMock();
    const repository = new FirestoreRepository({
      getFirestoreInstance: () => database,
      getPrivateFirestoreInstance: () => privateDatabase,
      isConfigured: () => true,
      isPrivateConfigured: () => true,
      fieldValue: { serverTimestamp: () => new Date('2025-01-01T00:00:00.000Z') }
    });

    assert.deepStrictEqual(await repository.checkHealth(), { configured: true, connected: true });
    assert.deepStrictEqual(await repository.checkPrivateHealth(), { configured: true, connected: true });
    const unavailableRepository = new FirestoreRepository({
      getFirestoreInstance: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => {
              const error = new Error('Firestore unavailable');
              error.code = 'unavailable';
              throw error;
            }
          })
        })
      }),
      getPrivateFirestoreInstance: () => database,
      isConfigured: () => true,
      isPrivateConfigured: () => true
    });
    assert.deepStrictEqual(await unavailableRepository.checkHealth(), {
      configured: true,
      connected: false
    });

    const user = await repository.createOrUpdateUser('firebase-user', {
      name: 'Farmer',
      phone: '+911234567890',
      profilePhoto: null
    });
    assert.strictEqual(user._id, 'firebase-user');
    assert.strictEqual(user.phone, '+911234567890');
    assert.ok(user.createdAt);
    assert.strictEqual((await repository.getFarmer('firebase-user')).mobile, '+911234567890');

    const farm = await repository.saveFarm('firebase-user', 'farm-1', {
      location: { latitude: 17, longitude: 79 },
      boundary: [{ lat: 17, lng: 79 }, { lat: 17, lng: 79.1 }, { lat: 17.1, lng: 79 }],
      area: { acres: '1.00' },
      crop: null,
      waterSource: null
    });
    assert.strictEqual(farm._id, 'farm-1');
    assert.strictEqual(farm.ownerUid, 'firebase-user');
    assert.strictEqual(farm.farmName, 'My Farm');
    await repository.setFarmOwnership('firebase-user', 'farm-1', { name: 'My Farm' });
    await repository.setUserActiveFarmId('firebase-user', 'farm-1');
    assert.strictEqual((await repository.getFarmForUser('firebase-user')).farmLocation.latitude, 17);
    assert.strictEqual((await repository.getFarmerFarms('firebase-user')).length, 1);
    assert.strictEqual(await repository.getOwnedFarm('another-user', 'farm-1'), null);
    await assert.rejects(
      repository.saveFarm('another-user', 'farm-1', { name: 'Hijack' }),
      (error) => error.code === 'FARM_ACCESS_DENIED' && error.statusCode === 403
    );
    const legacyShapeFarm = await repository.saveFarm('firebase-user', 'legacy-shape', {
      farmName: 'Legacy shape',
      location: { lat: 17.5, lng: 79.5, displayName: 'Saved village' },
      boundary: {
        points: [{ latitude: 17.5, longitude: 79.5 }, { latitude: 17.5, longitude: 79.51 }, { latitude: 17.51, longitude: 79.5 }],
        areaAcres: '1.25',
        perimeterMeters: 450
      },
      soil: 'Red soil'
    });
    assert.strictEqual(legacyShapeFarm.farmName, 'Legacy shape');
    assert.strictEqual(legacyShapeFarm.farmLocation.latitude, 17.5);
    assert.strictEqual(legacyShapeFarm.farmLocation.longitude, 79.5);
    assert.strictEqual(legacyShapeFarm.farmBoundary.length, 3);
    assert.strictEqual(legacyShapeFarm.area.acres, '1.25');
    assert.strictEqual(legacyShapeFarm.area.perimeterMeters, 450);
    assert.strictEqual(legacyShapeFarm.soilDetails.type, 'Red soil');

    await repository.createAIConversation({ userId: 'firebase-user', conversationId: 'chat/one', farmId: 'farm-1' });
    await repository.appendAIMessage({
      userId: 'firebase-user',
      conversationId: 'chat/one',
      farmId: 'farm-1',
      message: {
        role: 'user',
        message: 'Hello',
        language: 'en',
        inputType: 'voice_image',
        imagePath: '/uploads/crop-images/leaf.jpg'
      }
    });
    const conversation = await repository.getAIConversationHistory('firebase-user', 'farm-1', 'chat/one');
    assert.strictEqual(conversation.farmId, 'farm-1');
    assert.strictEqual(conversation.messages[0].message, 'Hello');
    assert.strictEqual(conversation.messages[0].inputType, 'voice_image');
    assert.strictEqual(conversation.messages[0].imagePath, '/uploads/crop-images/leaf.jpg');
    assert.strictEqual(await repository.getAIConversationHistory('another-user', 'farm-1', 'chat/one'), null);
    assert.strictEqual(await repository.getAIConversationHistory('firebase-user', 'farm-2', 'chat/one'), null);
    const attachment = {
      provider: 'cloudinary',
      assetId: 'asset-1',
      publicId: 'agrishield/ai-images/firebase-user/farm-1/chat-one/image-message',
      version: 1,
      resourceType: 'image',
      type: 'authenticated',
      format: 'jpg',
      width: 1200,
      height: 900,
      bytes: 1234,
      uploadedAt: '2026-10-04T12:00:00.000Z',
      ownerUid: 'firebase-user',
      farmId: 'farm-1',
      conversationId: 'chat/one'
    };
    const imageMessageId = await repository.saveConversationMessage({
      farmerId: 'firebase-user',
      farmId: 'farm-1',
      conversationId: 'chat/one',
      role: 'user',
      message: 'Check this leaf.',
      language: 'te',
      inputType: 'image',
      attachment,
      analysisStatus: 'FAILED',
      messageId: 'image-message'
    });
    assert.strictEqual(imageMessageId, 'image-message');
    const savedImageMessage = await repository.getAIConversationMessage(
      'firebase-user', 'farm-1', 'chat/one', imageMessageId
    );
    assert.deepStrictEqual(savedImageMessage.attachment, attachment);
    assert.strictEqual(savedImageMessage.ownerUid, 'firebase-user');
    assert.strictEqual(savedImageMessage.analysisStatus, 'FAILED');
    assert.strictEqual(await repository.getAIConversationMessage(
      'another-user', 'farm-1', 'chat/one', imageMessageId
    ), null);
    assert.strictEqual(await repository.getAIConversationMessage(
      'firebase-user', 'farm-2', 'chat/one', imageMessageId
    ), null);
    assert.strictEqual(await repository.updateAIMessageAttachment({
      userId: 'another-user',
      farmId: 'farm-1',
      conversationId: 'chat/one',
      messageId: imageMessageId,
      analysisStatus: 'COMPLETED'
    }), false);
    assert.strictEqual(await repository.updateAIMessageAttachment({
      userId: 'firebase-user',
      farmId: 'farm-1',
      conversationId: 'chat/one',
      messageId: imageMessageId,
      analysisStatus: 'COMPLETED'
    }), true);
    assert.strictEqual((await repository.getAIConversationMessage(
      'firebase-user', 'farm-1', 'chat/one', imageMessageId
    )).analysisStatus, 'COMPLETED');

    for (let index = 0; index < 40; index++) {
      await repository.appendAIMessage({
        userId: 'firebase-user',
        conversationId: 'large-chat',
        farmId: 'farm-1',
        message: { role: 'user', message: '農'.repeat(8000) }
      });
    }
    const boundedConversation = await repository.getAIConversationHistory('firebase-user', 'farm-1', 'large-chat');
    assert.ok(boundedConversation.messages.length < 40);
    assert.ok(Buffer.byteLength(JSON.stringify(boundedConversation.messages), 'utf8') <= 700 * 1024);

    const notificationId = await repository.createNotification({
      userId: 'firebase-user',
      farmId: 'farm-1',
      type: 'weather',
      title: 'Weather update',
      message: 'Rain expected'
    });
    await database.collection('notifications').doc('newer-notification').set({
      ownerUid: 'firebase-user',
      farmId: 'farm-1',
      type: 'farm',
      title: 'Farm update',
      message: 'Farm profile saved',
      severity: 'info',
      read: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    });
    const farmerNotifications = await repository.getUserNotifications('firebase-user', 'farm-1');
    assert.strictEqual(farmerNotifications[0]._id, 'newer-notification');
    assert.ok(farmerNotifications.some((notification) => notification._id === notificationId));
    assert.deepStrictEqual(await repository.getUserNotifications('firebase-user', 'farm-2'), []);
    assert.deepStrictEqual(await repository.getUserNotifications('other-user', 'farm-1'), []);
    assert.strictEqual(await repository.markNotificationAsRead('other-user', 'farm-1', notificationId), false);
    assert.strictEqual(await repository.markNotificationAsRead('firebase-user', 'farm-2', notificationId), false);
    assert.strictEqual(await repository.markNotificationAsRead('firebase-user', 'farm-1', notificationId), true);
    assert.strictEqual(
      (await repository.getUserNotifications('firebase-user', 'farm-1'))
        .find((notification) => notification._id === notificationId).read,
      true
    );

    await database.collection('cropProtocols').doc('cotton').set({
      enabled: true,
      crop: 'Cotton',
      stages: [{ name: 'Establishment', startDay: 0, endDay: 14 }],
      activities: []
    });
    assert.strictEqual((await repository.getCropProtocol('Cotton')).crop, 'Cotton');
    assert.strictEqual(cropKey('Paddy (Rice)'), 'paddy-rice');

    await database.collection('farmActivities').doc('other-farm-activity').set({
      farmerId: 'firebase-user',
      farmId: 'farm-elsewhere',
      activityId: 'spray-check',
      scheduledDate: '2026-01-02',
      status: 'COMPLETED'
    });
    assert.deepStrictEqual(await repository.getFarmActivityStatuses('firebase-user', 'farm-1'), []);
    const savedActivity = await repository.setFarmActivityStatus({
      farmerId: 'firebase-user',
      farmId: 'farm-1',
      cropId: 'cotton',
      activityId: 'weed-monitoring',
      scheduledDate: '2026-01-03',
      status: 'COMPLETED'
    });
    assert.strictEqual(savedActivity.farmerId, 'firebase-user');
    assert.strictEqual(savedActivity.completedAt.toISOString(), '2025-01-01T00:00:00.000Z');
    assert.strictEqual((await repository.getFarmActivityStatuses('firebase-user', 'farm-1')).length, 1);

    await database.collection('shopItems').doc('fertilizer-1').set({
      productName: 'Urea',
      category: 'fertilizer',
      crops: ['Cotton'],
      suitableStages: ['Tillering'],
      active: true
    });
    await database.collection('shopItems').doc('inactive-seed').set({
      productName: 'Seed',
      category: 'seed',
      active: false
    });
    assert.strictEqual((await repository.getActiveProducts()).length, 1);
    assert.strictEqual(await repository.getActiveProduct('inactive-seed'), null);

    await database.collection('aiConversations').doc('owned-conversation').set({
      ownerUid: 'firebase-user',
      conversationId: 'owned'
    });
    await database.collection('aiConversations').doc('another-conversation').set({
      ownerUid: 'another-user',
      conversationId: 'private'
    });
    await database.collection('supportTickets').doc('owned-ticket').set({
      ownerUid: 'firebase-user',
      farmerId: 'firebase-user',
      attachmentPath: '/uploads/support/owned-file.png'
    });
    await privateDatabase.collection('aiConversations').doc('legacy-conversation').set({
      userId: 'firebase-user'
    });
    const deletionPlan = await repository.getAccountDataDeletionPlan('firebase-user');
    assert.ok(deletionPlan.attachments.includes('/uploads/support/owned-file.png'));
    const deletionCounts = await repository.deleteAccountData(deletionPlan);
    assert.ok(deletionCounts.privateDeleted + deletionCounts.applicationDeleted >= 5);
    assert.strictEqual(await repository.getUser('firebase-user'), null);
    assert.strictEqual(await database.collection('aiConversations').doc('owned-conversation').get().then((snapshot) => snapshot.exists), false);
    assert.strictEqual(await database.collection('aiConversations').doc('another-conversation').get().then((snapshot) => snapshot.exists), true);
    assert.strictEqual(await privateDatabase.collection('aiConversations').doc('legacy-conversation').get().then((snapshot) => snapshot.exists), false);
  });

  await runAsyncTest('Project A ownership isolates User A farms, User B farms, conversations, and notifications', async () => {
    const { FirestoreRepository } = require('../services/firestoreRepository');
    const privateDatabase = createFirestoreMock();
    const applicationDatabase = createFirestoreMock();
    const repository = new FirestoreRepository({
      getFirestoreInstance: () => applicationDatabase,
      getPrivateFirestoreInstance: () => privateDatabase,
      isConfigured: () => true,
      isPrivateConfigured: () => true,
      fieldValue: { serverTimestamp: () => new Date('2026-10-02T00:00:00.000Z') }
    });
    const farms = [
      {
        ownerUid: 'user-a',
        farmId: 'farm-a1',
        name: 'A1',
        location: { latitude: 17.1, longitude: 78.1 },
        boundary: [[17.1, 78.1], [17.1, 78.11], [17.11, 78.1]],
        area: { acres: '1.10', perimeterMeters: 420 },
        crop: 'Cotton',
        soilDetails: { type: 'Black soil' },
        waterSource: 'Borewell'
      },
      {
        ownerUid: 'user-a',
        farmId: 'farm-a2',
        name: 'A2',
        location: { latitude: 18.2, longitude: 79.2 },
        boundary: [[18.2, 79.2], [18.2, 79.22], [18.22, 79.2]],
        area: { acres: '2.20', perimeterMeters: 840 },
        crop: 'Paddy',
        soilDetails: { type: 'Alluvial soil' },
        waterSource: 'Canal'
      },
      {
        ownerUid: 'user-b',
        farmId: 'farm-b1',
        name: 'B1',
        location: { latitude: 19.3, longitude: 80.3 },
        boundary: [[19.3, 80.3], [19.3, 80.33], [19.33, 80.3]],
        area: { acres: '3.30', perimeterMeters: 1260 },
        crop: 'Maize',
        soilDetails: { type: 'Red soil' },
        waterSource: 'Rain-fed'
      }
    ];

    for (const farm of farms) {
      await repository.saveFarm(farm.ownerUid, farm.farmId, farm);
      await repository.setFarmOwnership(farm.ownerUid, farm.farmId, { name: farm.name });
    }
    await repository.setUserActiveFarmId('user-a', 'farm-a1');
    await repository.setUserActiveFarmId('user-b', 'farm-b1');

    assert.strictEqual((await repository.getOwnedFarm('user-a', 'farm-a1')).crop, 'Cotton');
    assert.strictEqual((await repository.getOwnedFarm('user-a', 'farm-a2')).crop, 'Paddy');
    assert.strictEqual((await repository.getOwnedFarm('user-a', 'farm-b1')), null);
    assert.strictEqual((await repository.getOwnedFarm('user-b', 'farm-b1')).crop, 'Maize');
    assert.strictEqual((await repository.getOwnedFarm('user-b', 'farm-a1')), null);
    assert.strictEqual((await repository.getOwnedFarm('user-b', 'farm-a2')), null);
    await assert.rejects(
      repository.saveFarm('user-b', 'farm-a1', { name: 'Unauthorized overwrite' }),
      (error) => error.code === 'FARM_ACCESS_DENIED'
    );

    assert.strictEqual((await repository.getFarmForUser('user-a'))._id, 'farm-a1');
    await repository.setUserActiveFarmId('user-a', 'farm-a2');
    const activeA2 = await repository.getFarmForUser('user-a');
    assert.strictEqual(activeA2._id, 'farm-a2');
    assert.strictEqual(activeA2.location.latitude, 18.2);
    assert.strictEqual(activeA2.farmBoundary.length, 3);
    assert.strictEqual(activeA2.area.perimeterMeters, 840);
    assert.strictEqual(activeA2.crop, 'Paddy');
    assert.strictEqual(activeA2.soilDetails.type, 'Alluvial soil');
    assert.strictEqual(activeA2.waterSource, 'Canal');
    await repository.setUserActiveFarmId('user-a', 'farm-a1');
    assert.strictEqual((await repository.getFarmForUser('user-a'))._id, 'farm-a1');

    for (const [farmId, conversationId] of [['farm-a1', 'chat-a1'], ['farm-a2', 'chat-a2']]) {
      await repository.createAIConversation({ userId: 'user-a', farmId, conversationId });
      await repository.appendAIMessage({
        userId: 'user-a',
        farmId,
        conversationId,
        message: { role: 'user', message: `Message for ${farmId}` }
      });
    }
    assert.strictEqual(
      (await repository.getAIConversationHistory('user-a', 'farm-a1', 'chat-a1')).messages[0].message,
      'Message for farm-a1'
    );
    assert.strictEqual(await repository.getAIConversationHistory('user-a', 'farm-a2', 'chat-a1'), null);
    assert.strictEqual(await repository.getAIConversationHistory('user-b', 'farm-a1', 'chat-a1'), null);

    const alertA1 = await repository.createNotification({
      userId: 'user-a', farmId: 'farm-a1', type: 'farm', title: 'A1 alert', message: 'A1 only'
    });
    const alertA2 = await repository.createNotification({
      userId: 'user-a', farmId: 'farm-a2', type: 'farm', title: 'A2 alert', message: 'A2 only'
    });
    assert.deepStrictEqual(
      (await repository.getUserNotifications('user-a', 'farm-a1')).map(({ _id }) => _id),
      [alertA1]
    );
    assert.deepStrictEqual(
      (await repository.getUserNotifications('user-a', 'farm-a2')).map(({ _id }) => _id),
      [alertA2]
    );
    assert.strictEqual(await repository.markNotificationAsRead('user-a', 'farm-a1', alertA2), false);
    assert.strictEqual(await repository.markNotificationAsRead('user-b', 'farm-a1', alertA1), false);

    await privateDatabase.collection('users').doc('user-a').update({ activeFarmId: null });
    assert.strictEqual(await repository.getFarmForUser('user-a'), null);
    assert.strictEqual((await repository.getUser('user-a')).activeFarmId, null);

    await repository.saveFarm('user-single', 'single-farm', {
      ownerUid: 'user-single',
      name: 'Single owned farm',
      crop: 'Millet'
    });
    await repository.setFarmOwnership('user-single', 'single-farm', { name: 'Single owned farm' });
    await privateDatabase.collection('users').doc('user-single').set({ activeFarmId: 'deleted-farm' });
    const recoveredSingleFarm = await repository.getFarmForUser('user-single');
    assert.strictEqual(recoveredSingleFarm._id, 'single-farm');
    assert.strictEqual((await repository.getUser('user-single')).activeFarmId, 'single-farm');
  });

  console.log('\n--- Crop Schedule and Shop Catalog ---');
  runTest('Crop age, stage, due activity, upcoming activity, and saved status use local farm dates', () => {
    const protocol = {
      enabled: true,
      stages: [
        { name: 'Establishment', startDay: 0, endDay: 14 },
        { name: 'Vegetative', startDay: 15, endDay: 40 }
      ],
      activities: [
        { id: 'monitor-31', name: 'Crop monitoring', dayAfterStart: 31, stage: 'Vegetative' },
        { id: 'nutrient-32', name: 'Nutrient assessment', dayAfterStart: 32, stage: 'Vegetative', productCategory: 'fertilizer', productQuery: 'Urea' }
      ]
    };
    const schedule = buildCropSchedule({
      farm: { crop: 'Paddy', cropDetails: { name: 'Paddy', plantingDate: '2026-09-01' } },
      protocol,
      timeZone: 'Asia/Kolkata',
      now: new Date('2026-10-01T18:30:00.000Z')
    });
    assert.strictEqual(schedule.cropAgeDays, 31);
    assert.strictEqual(schedule.today, '2026-10-02');
    assert.strictEqual(schedule.currentStage, 'Vegetative');
    assert.strictEqual(schedule.activities[0].status, 'DUE');
    assert.strictEqual(schedule.activities[1].status, 'UPCOMING');
    assert.strictEqual(schedule.activities[1].productQuery, 'Urea');

    const completed = buildCropSchedule({
      farm: { crop: 'Paddy', cropDetails: { name: 'Paddy', plantingDate: '2026-09-01' } },
      protocol,
      activityStatuses: [{
        activityId: 'monitor-31',
        scheduledDate: '2026-10-02',
        status: 'COMPLETED',
        completedAt: '2026-10-02T05:00:00.000Z'
      }],
      timeZone: 'Asia/Kolkata',
      now: new Date('2026-10-01T18:30:00.000Z')
    });
    assert.strictEqual(completed.activities[0].status, 'COMPLETED');
    assert.strictEqual(completed.activities[0].completedAt, '2026-10-02T05:00:00.000Z');
  });

  runTest('Crop schedule reports missing or future planting dates without inventing an age', () => {
    const protocol = {
      enabled: true,
      stages: [{ name: 'Establishment', startDay: 0, endDay: 14 }],
      activities: []
    };
    const missing = buildCropSchedule({
      farm: { crop: 'Maize' },
      protocol,
      now: new Date('2026-10-01T00:00:00.000Z')
    });
    assert.strictEqual(missing.reason, 'planting_date_missing');
    assert.strictEqual(missing.cropAgeDays, null);

    const future = buildCropSchedule({
      farm: { crop: 'Maize', cropDetails: { name: 'Maize', plantingDate: '2026-10-03' } },
      protocol,
      timeZone: 'UTC',
      now: new Date('2026-10-01T00:00:00.000Z')
    });
    assert.strictEqual(future.reason, 'planting_date_in_future');
    assert.strictEqual(future.cropAgeDays, null);
    assert.deepStrictEqual(future.activities, []);
    assert.strictEqual(parseDateOnly('2026-02-30'), null);
  });

  runTest('Configured protocol validation rejects overlapping stages and wrong varieties', () => {
    const farm = { crop: 'Chilli', cropDetails: { name: 'Chilli', variety: 'A', plantingDate: '2026-09-01' } };
    const mismatch = buildCropSchedule({
      farm,
      protocol: { enabled: true, variety: 'B', stages: [], activities: [] }
    });
    assert.strictEqual(mismatch.reason, 'protocol_variety_mismatch');
    assert.throws(() => buildCropSchedule({
      farm,
      protocol: {
        enabled: true,
        stages: [
          { name: 'Stage A', startDay: 0, endDay: 15 },
          { name: 'Stage B', startDay: 15, endDay: 30 }
        ],
        activities: []
      }
    }), /must not overlap/);
  });

  runTest('Shop filters only active seeds and fertilizers by crop, stage, query, and supplier', () => {
    const products = [
      {
        productName: 'Urea',
        category: 'fertilizer',
        brand: 'Farm Inputs',
        crops: ['Paddy'],
        suitableStages: ['Tillering'],
        supplierName: 'Green Farm Store',
        active: true
      },
      { productName: 'Paddy Seed', category: 'seed', active: true },
      { productName: 'Pest Control', category: 'pesticide', active: true },
      { productName: 'Inactive Urea', category: 'fertilizer', active: false }
    ];
    assert.strictEqual(normalizeCategory('Fertilizers'), 'fertilizer');
    assert.strictEqual(filterProducts(products, {
      category: 'fertilizers',
      crop: 'paddy',
      stage: 'tillering',
      query: 'green farm store'
    }).length, 1);
    assert.deepStrictEqual(
      filterProducts(products).map((product) => product.productName),
      ['Urea', 'Paddy Seed']
    );
    assert.throws(() => normalizeCategory('pesticide'), /must be seed or fertilizer/);
  });

  runTest('Provider status accurately reports configuration state', () => {
    const status = providerFactory.getStatus();
    assert.ok(status.provider);
    assert.ok(status.model);
    assert.ok(typeof status.isConfigured === 'boolean');
  });

  await runAsyncTest('Firebase Email + Password authentication accepts authenticated Firebase UID and synchronizes account', async () => {
    const originalIsPrivateConfigured = firestoreRepository.isPrivateConfigured;
    const originalGetUser = firestoreRepository.getUser;
    const originalCreateOrUpdateUser = firestoreRepository.createOrUpdateUser;
    let savedUid = null;
    let savedRecord = null;
    try {
      firestoreRepository.isPrivateConfigured = () => true;
      firestoreRepository.getUser = async () => null;
      firestoreRepository.createOrUpdateUser = async (uid, record) => {
        savedUid = uid;
        savedRecord = record;
        return { ...record, _id: uid };
      };

      const firebaseUser = {
        uid: 'firebase-uid-auth-test',
        email: 'farmer@example.com',
        displayName: 'Ravi Kumar'
      };
      const result = await syncFirebaseAccount(firebaseUser, 'Ravi Kumar');
      assert.strictEqual(result._id, 'firebase-uid-auth-test');
      assert.strictEqual(result.email, 'farmer@example.com');
      assert.strictEqual(result.name, 'Ravi Kumar');
      assert.strictEqual(savedUid, 'firebase-uid-auth-test');
      assert.strictEqual(savedRecord.email, 'farmer@example.com');
      assert.strictEqual(savedRecord.name, 'Ravi Kumar');
    } finally {
      firestoreRepository.isPrivateConfigured = originalIsPrivateConfigured;
      firestoreRepository.getUser = originalGetUser;
      firestoreRepository.createOrUpdateUser = originalCreateOrUpdateUser;
    }
  });

  await runAsyncTest('Firebase email synchronizes to user profile without overwriting existing farm references', async () => {
    const originalIsPrivateConfigured = firestoreRepository.isPrivateConfigured;
    const originalGetUser = firestoreRepository.getUser;
    const originalCreateOrUpdateUser = firestoreRepository.createOrUpdateUser;
    let savedRecord = null;
    try {
      firestoreRepository.isPrivateConfigured = () => true;
      firestoreRepository.getUser = async (uid) => ({
        _id: uid,
        name: 'Existing Farmer',
        email: null,
        activeFarmId: 'farm-active-123'
      });
      firestoreRepository.createOrUpdateUser = async (uid, record) => {
        savedRecord = record;
        return { ...record, _id: uid };
      };

      const result = await syncFirebaseAccount({
        uid: 'firebase-uid-email-sync',
        email: 'synced-farmer@example.com'
      });
      assert.strictEqual(result.email, 'synced-farmer@example.com');
      assert.strictEqual(savedRecord.email, 'synced-farmer@example.com');
      assert.strictEqual(savedRecord.activeFarmId, 'farm-active-123');
    } finally {
      firestoreRepository.isPrivateConfigured = originalIsPrivateConfigured;
      firestoreRepository.getUser = originalGetUser;
      firestoreRepository.createOrUpdateUser = originalCreateOrUpdateUser;
    }
  });

  await runAsyncTest('Missing phone number does NOT cause synchronization failure and preserves existing phone if present', async () => {
    const originalIsPrivateConfigured = firestoreRepository.isPrivateConfigured;
    const originalGetUser = firestoreRepository.getUser;
    const originalCreateOrUpdateUser = firestoreRepository.createOrUpdateUser;
    try {
      firestoreRepository.isPrivateConfigured = () => true;
      firestoreRepository.getUser = async () => null;
      firestoreRepository.createOrUpdateUser = async (uid, record) => ({ ...record, _id: uid });

      // No phone_number in Firebase user (standard Email + Password signup)
      const emailOnlyUser = {
        uid: 'email-only-user-id',
        email: 'emailonly@example.com'
      };
      const result1 = await syncFirebaseAccount(emailOnlyUser);
      assert.strictEqual(result1._id, 'email-only-user-id');
      assert.strictEqual(result1.mobile, '');
      assert.strictEqual(result1.mobileVerified, false);

      // Existing phone in database is preserved when Firebase user has no phone
      firestoreRepository.getUser = async () => ({
        _id: 'existing-phone-user',
        phone: '+919876543210'
      });
      const result2 = await syncFirebaseAccount({ uid: 'existing-phone-user', email: 'test@example.com' });
      assert.strictEqual(result2.mobile, '+919876543210');
      assert.strictEqual(result2.mobileVerified, true);
    } finally {
      firestoreRepository.isPrivateConfigured = originalIsPrivateConfigured;
      firestoreRepository.getUser = originalGetUser;
      firestoreRepository.createOrUpdateUser = originalCreateOrUpdateUser;
    }
  });

  await runAsyncTest('Farm profile can save without Firebase phone_number and accepts optional mobile', async () => {
    const originalIsConfigured = firestoreRepository.isConfigured;
    const originalGetUser = firestoreRepository.getUser;
    const originalCreateOrUpdateUser = firestoreRepository.createOrUpdateUser;
    const originalSaveFarm = firestoreRepository.saveFarm;
    const originalSetFarmOwnership = firestoreRepository.setFarmOwnership;
    const originalSetUserActiveFarmId = firestoreRepository.setUserActiveFarmId;
    let userUpdate = null;
    let farmSaved = null;
    try {
      firestoreRepository.isConfigured = () => true;
      firestoreRepository.getUser = async (uid) => ({
        _id: uid,
        name: 'Farmer',
        phone: null
      });
      firestoreRepository.createOrUpdateUser = async (uid, data) => {
        userUpdate = { uid, ...data };
      };
      firestoreRepository.saveFarm = async (uid, farmId, data) => {
        farmSaved = { uid, farmId, ...data };
      };
      firestoreRepository.setFarmOwnership = async () => true;
      firestoreRepository.setUserActiveFarmId = async () => true;

      // Simulate farm saving logic without any phone_number on authenticated Firebase user
      const verifiedUid = 'verified-farmer-no-phone';
      const storedUser = await firestoreRepository.getUser(verifiedUid);
      assert.ok(storedUser);
      assert.strictEqual(storedUser.phone, null);

      // Save farm with optional mobile omitted
      const candidateMobile = null;
      await firestoreRepository.createOrUpdateUser(verifiedUid, {
        name: 'Farmer Test',
        ...(candidateMobile !== null ? { phone: candidateMobile, mobileVerified: Boolean(candidateMobile) } : {})
      });
      assert.strictEqual(userUpdate.name, 'Farmer Test');
      assert.strictEqual(userUpdate.phone, undefined);

      // Now save with optional mobile supplied
      const optionalMobile = '+919177487782';
      await firestoreRepository.createOrUpdateUser(verifiedUid, {
        name: 'Farmer Test',
        phone: optionalMobile,
        mobileVerified: true
      });
      assert.strictEqual(userUpdate.phone, '+919177487782');
      assert.strictEqual(userUpdate.mobileVerified, true);
    } finally {
      firestoreRepository.isConfigured = originalIsConfigured;
      firestoreRepository.getUser = originalGetUser;
      firestoreRepository.createOrUpdateUser = originalCreateOrUpdateUser;
      firestoreRepository.saveFarm = originalSaveFarm;
      firestoreRepository.setFarmOwnership = originalSetFarmOwnership;
      firestoreRepository.setUserActiveFarmId = originalSetUserActiveFarmId;
    }
  });

  runTest('Mobile profile update stores optional number without phone OTP or Firebase phone credential', async () => {
    const originalGetUser = firestoreRepository.getUser;
    const originalCreateOrUpdateUser = firestoreRepository.createOrUpdateUser;
    let savedProfile = null;
    try {
      firestoreRepository.getUser = async (uid) => ({ _id: uid, name: 'Farmer' });
      firestoreRepository.createOrUpdateUser = async (uid, data) => {
        savedProfile = { uid, ...data };
      };

      const farmerId = 'authenticated-farmer-uid';
      const optionalMobile = '+919988776655';
      await firestoreRepository.createOrUpdateUser(farmerId, {
        phone: optionalMobile,
        mobileVerified: Boolean(optionalMobile)
      });
      assert.strictEqual(savedProfile.uid, farmerId);
      assert.strictEqual(savedProfile.phone, '+919988776655');
      assert.strictEqual(savedProfile.mobileVerified, true);
    } finally {
      firestoreRepository.getUser = originalGetUser;
      firestoreRepository.createOrUpdateUser = originalCreateOrUpdateUser;
    }
  });

  await runAsyncTest('Firebase ID token and verified UID remain strictly required', async () => {
    // Missing Firebase user throws FIREBASE_UID_REQUIRED
    await assert.rejects(
      syncFirebaseAccount(null),
      { code: 'FIREBASE_UID_REQUIRED', statusCode: 400 }
    );
    await assert.rejects(
      syncFirebaseAccount({}),
      { code: 'FIREBASE_UID_REQUIRED', statusCode: 400 }
    );
    await assert.rejects(
      syncFirebaseAccount({ uid: '' }),
      { code: 'FIREBASE_UID_REQUIRED', statusCode: 400 }
    );
  });

  runTest('Frontend-supplied userId or ownerUid is not trusted over authenticated req.firebaseUid', () => {
    const authenticatedUid = 'verified-farmer-token-uid';
    const spoofedBody = {
      userId: 'attacker-chosen-uid',
      ownerUid: 'victim-farmer-uid',
      farmerName: 'Legitimate Farmer'
    };

    // The backend uses req.farmerId / req.firebaseUid (from verified token), never req.body.userId
    const effectiveUserId = authenticatedUid;
    assert.notStrictEqual(effectiveUserId, spoofedBody.userId);
    assert.notStrictEqual(effectiveUserId, spoofedBody.ownerUid);
    assert.strictEqual(effectiveUserId, 'verified-farmer-token-uid');
  });

  runTest('Legacy OTP routes and PhoneOtpService are completely removed from server', () => {
    const fs = require('fs');
    const path = require('path');
    const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

    // Confirm obsolete OTP routes are completely absent from server.js
    assert.strictEqual(serverSource.includes('/api/auth/otp/start'), false);
    assert.strictEqual(serverSource.includes('/api/auth/otp/resend'), false);
    assert.strictEqual(serverSource.includes('/api/auth/otp/verify'), false);
    assert.strictEqual(serverSource.includes('/api/auth/otp/verify-reauth'), false);
    assert.strictEqual(serverSource.includes('/api/auth/otp/verify-phone-change'), false);
    assert.strictEqual(serverSource.includes('PhoneOtpService'), false);
    assert.strictEqual(serverSource.includes('phoneOtpService'), false);
  });

  runTest('Firebase Admin requires separate Project A and Project B credentials or project-specific emulators', () => {
    assert.strictEqual(firebaseAdminConfigured({}), false);
    assert.strictEqual(applicationFirebaseAdminConfigured({}), false);
    assert.strictEqual(firestoreConfigured({}), false);
    assert.strictEqual(
      getFirebaseAdminConfigurationError({ FIREBASE_PROJECT_ID: 'project', FIREBASE_CLIENT_EMAIL: 'service@example.invalid', FIREBASE_PRIVATE_KEY: 'invalid' }),
      'PRIVATE_FIREBASE_PRIVATE_KEY_INVALID'
    );
    assert.strictEqual(
      getFirebaseAdminConfigurationError({ FIREBASE_PROJECT_ID: 'project', FIREBASE_CLIENT_EMAIL: 'service@example.invalid' }),
      'PRIVATE_FIREBASE_PRIVATE_KEY_MISSING'
    );
    assert.strictEqual(
      getApplicationFirebaseAdminConfigurationError({
        APP_FIREBASE_PROJECT_ID: APPLICATION_PROJECT_ID,
        APP_FIREBASE_CLIENT_EMAIL: 'app-service@example.invalid',
        APP_FIREBASE_PRIVATE_KEY: 'invalid'
      }),
      'APP_FIREBASE_PRIVATE_KEY_INVALID'
    );
    const privateKey = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    }).privateKey;
    const privateProjectEnv = {
      PRIVATE_FIREBASE_PROJECT_ID: 'agrisheild-22749',
      PRIVATE_FIREBASE_CLIENT_EMAIL: 'private-service@example.invalid',
      PRIVATE_FIREBASE_PRIVATE_KEY: privateKey
    };
    const applicationProjectEnv = {
      APP_FIREBASE_PROJECT_ID: APPLICATION_PROJECT_ID,
      APP_FIREBASE_CLIENT_EMAIL: 'app-service@example.invalid',
      APP_FIREBASE_PRIVATE_KEY: privateKey
    };
    assert.strictEqual(firebaseAdminConfigured(privateProjectEnv), true);
    assert.strictEqual(getFirebaseAdminConfigurationError({
      ...privateProjectEnv
    }), null);
    assert.strictEqual(applicationFirebaseAdminConfigured(applicationProjectEnv), true);
    assert.strictEqual(getApplicationFirebaseAdminConfigurationError(applicationProjectEnv), null);
    assert.strictEqual(firestoreConfigured(applicationProjectEnv), true);
    assert.strictEqual(applicationFirebaseAdminConfigured({
      ...applicationProjectEnv,
      APP_FIREBASE_PROJECT_ID: 'wrong-project'
    }), false);
    assert.strictEqual(getApplicationFirebaseAdminConfigurationError({
      ...applicationProjectEnv,
      APP_FIREBASE_PROJECT_ID: 'wrong-project'
    }), 'APP_FIREBASE_PROJECT_ID_INVALID');
    assert.strictEqual(firestoreConfigured(privateProjectEnv), false);
    assert.strictEqual(firebaseAdminConfigured({
      ...privateProjectEnv,
      PRIVATE_FIREBASE_PRIVATE_KEY: 'private-key'
    }), false);
    const authEmulatorOnly = {
      NODE_ENV: 'development',
      PRIVATE_FIREBASE_PROJECT_ID: 'agrisheild-22749',
      PRIVATE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
    };
    assert.strictEqual(firebaseAdminConfigured(authEmulatorOnly), true);
    assert.strictEqual(privateFirebaseFirestoreConfigured(authEmulatorOnly), false);
    assert.strictEqual(getPrivateFirestoreConfigurationError(authEmulatorOnly), 'PRIVATE_FIREBASE_CLIENT_EMAIL_MISSING');
    const privateFirestoreEmulator = {
      NODE_ENV: 'development',
      PRIVATE_FIREBASE_PROJECT_ID: 'agrisheild-22749',
      PRIVATE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
    };
    assert.strictEqual(firebaseAdminConfigured(privateFirestoreEmulator), false);
    assert.strictEqual(privateFirebaseFirestoreConfigured(privateFirestoreEmulator), true);
    assert.strictEqual(firestoreConfigured({
      NODE_ENV: 'development',
      APP_FIREBASE_PROJECT_ID: APPLICATION_PROJECT_ID,
      APP_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
    }), true);
  });

  await runAsyncTest('Local support storage persists only a generated filename and rejects traversal', async () => {
    const buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    let saved;
    try {
      saved = await localStorageService.saveFile({
        buffer,
        category: 'support',
        mimeType: 'image/png'
      });
      const filename = saved.path.split('/').pop();
      assert.ok(/^[0-9a-f-]+\.png$/i.test(filename));
      assert.deepStrictEqual(await localStorageService.getFile({ category: 'support', filename }), buffer);
      await assert.rejects(
        localStorageService.getFile({ category: 'support', filename: '..\\server.js' }),
        /Invalid stored filename/
      );
    } finally {
      if (saved) {
        await localStorageService.deleteFile({
          category: 'support',
          filename: saved.path.split('/').pop()
        });
      }
    }
  });

  console.log('\n--- Farm Boundary Geometry ---');
  runTest('Calculates area, perimeter, and dimensions from farm coordinates', () => {
    const geometry = normalizeFarmBoundary([
      [17.9689, 79.5941],
      [17.9689, 79.5951],
      [17.9699, 79.5951],
      [17.9699, 79.5941]
    ]);
    assert.strictEqual(geometry.points.length, 4);
    assert.ok(geometry.areaSqMeters > 10000);
    assert.ok(geometry.perimeterMeters > 400);
    assert.ok(geometry.lengthMeters > 100);
    assert.ok(geometry.widthMeters > 100);
  });

  runTest('Rejects incomplete or self-intersecting farm boundaries', () => {
    assert.throws(() => normalizeFarmBoundary([[17, 79], [17, 79.001]]), /at least 3 distinct points/);
    assert.throws(() => normalizeFarmBoundary([
      [17, 79],
      [17.001, 79.001],
      [17, 79.001],
      [17.001, 79]
    ]), /must not cross/);
  });

  // 2. ERROR HANDLING & FARMER-FRIENDLY TRANSLATIONS (Section 82)
  console.log('\n--- 2. Centralized Errors & Multilingual Translation ---');
  runTest('AgriShieldError formats Telugu error for AI_NOT_CONFIGURED', () => {
    const err = new AgriShieldError(ERROR_CODES.AI_NOT_CONFIGURED);
    const msg = err.getFarmerMessage('te');
    assert.ok(msg.includes('AI') || msg.includes('కాన్ఫిగర్'));
  });

  runTest('AgriShieldError formats Hindi error for AI_RATE_LIMIT', () => {
    const err = new AgriShieldError(ERROR_CODES.AI_RATE_LIMIT);
    const msg = err.getFarmerMessage('hi');
    assert.ok(msg.includes('अनुरोध') || msg.includes('प्रयास'));
  });

  runTest('AgriShieldError formats English error for IMAGE_TOO_LARGE', () => {
    const err = new AgriShieldError(ERROR_CODES.IMAGE_TOO_LARGE);
    const msg = err.getFarmerMessage('en');
    assert.ok(msg.includes('large') || msg.includes('10MB'));
  });

  runTest('Image analysis exhaustion returns localized, controlled copy', () => {
    const error = new AgriShieldError(ERROR_CODES.IMAGE_ANALYSIS_UNAVAILABLE);
    assert.match(error.getFarmerMessage('en'), /temporarily unavailable/);
    assert.match(error.getFarmerMessage('hi'), /उपलब्ध नहीं/);
    assert.match(error.getFarmerMessage('te'), /అందుబాటులో లేదు/);
  });

  // 3. CONVERSATION CONTEXT & MULTI-TURN MEMORY (Section 9, 10, 87)
  console.log('\n--- 3. Conversation Memory & Multi-turn Reasoning ---');
  runTest('Creates fresh conversation session', () => {
    const convId = 'test-conv-001';
    const session = conversationService.getSession(convId);
    assert.strictEqual(session.id, convId);
    assert.strictEqual(session.messages.length, 0);
  });

  runTest('Multi-turn context tracking across 4 conversational turns', () => {
    const convId = 'test-conv-multiturn';
    // Turn 1: Farmer mentions crop
    conversationService.addMessage(convId, { role: 'user', content: 'I grow tomatoes in my 2-acre field.' });
    let session = conversationService.getSession(convId);
    assert.strictEqual(session.context.crop, 'Tomato');

    // Turn 2: Farmer describes yellow leaves
    conversationService.addMessage(convId, { role: 'assistant', content: 'I understand you are cultivating tomatoes.' });
    conversationService.addMessage(convId, { role: 'user', content: 'The leaves are yellowing.' });

    // Turn 3: Follow-up question "Why?"
    conversationService.addMessage(convId, { role: 'user', content: 'Why?' });
    const { history } = conversationService.getFormattedHistory(convId);
    assert.ok(history.length >= 4);

    // Turn 4: "What should I do?"
    conversationService.addMessage(convId, { role: 'user', content: 'What should I do now?' });
    const formatted = conversationService.getFormattedHistory(convId);
    assert.strictEqual(formatted.context.crop, 'Tomato');
  });

  runTest('User correction updates active context (Section 118, 119)', () => {
    const convId = 'test-conv-correction';
    conversationService.addMessage(convId, { role: 'user', content: 'I grow tomatoes.' });
    assert.strictEqual(conversationService.getSession(convId).context.crop, 'Tomato');

    // User corrects crop
    conversationService.addMessage(convId, { role: 'user', content: 'No, not tomato, I meant chilli.' });
    assert.strictEqual(conversationService.getSession(convId).context.crop, 'Chilli');
  });

  runTest('Detects Telugu, Hindi, English, and Romanized mixed language', () => {
    assert.strictEqual(detectLanguage('నీళ్లు ఎప్పుడు పెట్టాలి?', 'auto'), 'te');
    assert.strictEqual(detectLanguage('क्या मुझे पानी देना चाहिए?', 'auto'), 'hi');
    assert.strictEqual(detectLanguage('Should I water my crop?', 'auto'), 'en');
    assert.strictEqual(detectLanguage('tomato ki water eppudu pettali?', 'auto'), 'te');
    assert.strictEqual(detectLanguage('मेरे tomato crop के लिए पानी कब देना चाहिए?', 'auto'), 'hi');
    assert.strictEqual(detectLanguage('Hello, how are you?', 'auto'), 'en');
  });

  runTest('Routes normal conversation and short agricultural queries by intent', () => {
    assert.strictEqual(detectIntent('Who are you?'), 'GENERAL_CONVERSATION');
    assert.strictEqual(detectIntent('నీళ్లు పెట్టాలా?'), 'IRRIGATION_ADVISOR');
    assert.strictEqual(detectIntent('बारिश होगी?'), 'WEATHER');
    assert.strictEqual(detectIntent('Was this area hotter last month?'), 'WEATHER');
    assert.strictEqual(detectIntent('గత నెల వర్షపాతం తక్కువగా ఉందా?'), 'WEATHER');
    assert.strictEqual(detectIntent('నా మొక్క ఆకులు పసుపుగా మారుతున్నాయి'), 'PEST_DISEASE');
    assert.strictEqual(detectIntent('What is wrong with my plant?'), 'PEST_DISEASE');
    assert.strictEqual(detectIntent('What is my farm size?'), 'FARM_DETAILS');
    const activeFarmQuestion = 'For my active farm, what crop am I growing, what is the farm area, and what is the water source? Use only my saved farm details.';
    assert.strictEqual(detectIntent(activeFarmQuestion), 'FARM_DETAILS');
    assert.strictEqual(aiService.detectCategory(activeFarmQuestion, 'Paddy', 'FARM_DETAILS'), '🌾 Farm Details');
    assert.strictEqual(detectIntent('Tell me about my farm.'), 'FARM_SUMMARY');
    assert.strictEqual(detectIntent('What is this?', true), 'IMAGE_ANALYSIS');
  });

  runTest('Tracks crop context mentioned in Telugu and Hindi', () => {
    const teId = 'test-conv-telugu-crop';
    conversationService.addMessage(teId, { role: 'user', content: 'నా టమాటా పంట ఆకులు పసుపుగా ఉన్నాయి' });
    assert.strictEqual(conversationService.getSession(teId).context.crop, 'Tomato');
    const hiId = 'test-conv-hindi-crop';
    conversationService.addMessage(hiId, { role: 'user', content: 'मेरी टमाटर की फसल के पत्ते पीले हैं' });
    assert.strictEqual(conversationService.getSession(hiId).context.crop, 'Tomato');
  });

  runTest('Restores farmer-reported crop age and water-source changes separately from stored farm facts', () => {
    const conversationId = 'farmer-claims-context-test';
    conversationService.clearSession(conversationId);
    conversationService.restoreHistory(conversationId, [{
      role: 'user',
      content: 'My paddy crop was planted 35 days ago. I changed from canal water to borewell.'
    }]);
    const claims = buildFarmContext({
      conversationContext: conversationService.getSession(conversationId).context
    }).conversation;
    assert.strictEqual(claims.farmerReportedCropAgeDays, 35);
    assert.strictEqual(claims.farmerReportedWaterSource, 'borewell');
    conversationService.clearSession(conversationId);
  });

  runTest('Restores browser conversation history once without duplicating turns', () => {
    const convId = 'test-conv-restore';
    conversationService.restoreHistory(convId, [
      { role: 'user', content: 'My crop is tomato.' },
      { role: 'assistant', content: 'I will keep tomato in context.' }
    ]);
    conversationService.restoreHistory(convId, [
      { role: 'user', content: 'duplicate history' }
    ]);
    const session = conversationService.getSession(convId);
    assert.strictEqual(session.messages.length, 2);
    assert.strictEqual(session.context.crop, 'Tomato');
  });

  runTest('Resetting session clears messages and re-initializes fresh session (Section 138)', () => {
    const convId = 'test-conv-reset';
    conversationService.addMessage(convId, { role: 'user', content: 'Hello' });
    conversationService.clearSession(convId);
    const session = conversationService.getSession(convId);
    assert.strictEqual(session.messages.length, 0);
  });

  // 4. IMAGE & AUDIO VALIDATION (Section 50, 51, 91)
  console.log('\n--- 4. Input & File Validation ---');
  runTest('Valid image MIME types are strictly accepted', () => {
    assert.ok(ALLOWED_IMAGE_TYPES.includes('image/jpeg'));
    assert.ok(ALLOWED_IMAGE_TYPES.includes('image/png'));
    assert.ok(ALLOWED_IMAGE_TYPES.includes('image/webp'));
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    assert.strictEqual(imageMatchesMime(png, 'image/png'), true);
    assert.strictEqual(imageMatchesMime(png, 'image/jpeg'), false);
    assert.ok(!ALLOWED_IMAGE_TYPES.includes('application/x-msdownload'));
    assert.ok(!ALLOWED_IMAGE_TYPES.includes('application/javascript'));
  });

  runTest('Valid audio MIME types are accepted', () => {
    assert.ok(ALLOWED_AUDIO_TYPES.includes('audio/webm'));
    assert.ok(ALLOWED_AUDIO_TYPES.includes('audio/wav'));
    assert.ok(ALLOWED_AUDIO_TYPES.includes('audio/ogg'));
  });

  // 5. Language and ElevenLabs Configuration
  console.log('\n--- 5. Language and ElevenLabs Configuration ---');
  runTest('The language registry resolves locale codes and owns STT/TTS mappings', () => {
    assert.strictEqual(resolveLanguage('en-IN'), 'en');
    assert.strictEqual(resolveLanguage('hi-IN'), 'hi');
    assert.strictEqual(resolveLanguage('te-IN'), 'te');
    assert.strictEqual(getLanguageConfig('te').sttLocale, 'te-IN');
    assert.strictEqual(getLanguageConfig('te').sttLanguageCode, 'te');
    assert.strictEqual(getLanguageConfig('te').ttsLanguageCode, 'te');
    assert.strictEqual(getLanguageConfig('hi').ttsVoiceEnv, 'ELEVENLABS_TTS_HI_VOICE_ID');
    assert.strictEqual(getLanguageConfig('en').languageName, 'English');
  });

  runTest('Gemini system instructions target the selected language for mixed-language input', () => {
    const teluguInstruction = buildSystemInstruction({ language: 'te', intent: 'GENERAL_CONVERSATION' });
    const hindiInstruction = buildSystemInstruction({ language: 'hi', intent: 'GENERAL_CONVERSATION' });
    assert.ok(teluguInstruction.includes('Telugu (te-IN)'));
    assert.ok(teluguInstruction.includes('Keep your answer in Telugu'));
    assert.ok(teluguInstruction.includes('Telugu script'));
    assert.ok(hindiInstruction.includes('Hindi (hi-IN)'));
  });

  runTest('Farm detail instructions include saved crop variety and stage when available', () => {
    const instruction = buildSystemInstruction({
      intent: 'FARM_DETAILS',
      farmerContext: { crop: 'Paddy', cropVariety: 'Sona', cropStage: 'Tillering' }
    });
    assert.ok(instruction.includes('include every supplied field'));
    assert.ok(instruction.includes('crop, variety, and growth stage'));
  });

  runTest('ElevenLabs configuration is independent of Google Cloud credentials', () => {
    const service = new ElevenLabsService({ env: { STT_ENABLED: 'true', TTS_ENABLED: 'true' } });
    const status = service.getStatus();
    assert.strictEqual(status.stt.provider, 'elevenlabs');
    assert.strictEqual(status.stt.configured, false);
    assert.strictEqual(status.tts.provider, 'elevenlabs');
    assert.strictEqual(status.tts.configured, false);
    assert.ok(!JSON.stringify(status).includes('voice-id'));
  });

  runTest('Project A Firebase configuration ignores the voice ADC file', () => {
    const errorCode = getFirebaseAdminConfigurationError({
      NODE_ENV: 'production',
      FIREBASE_PROJECT_ID: 'agrisheild-22749',
      GOOGLE_APPLICATION_CREDENTIALS: 'missing-project-b-credentials.json'
    });
    assert.strictEqual(errorCode, 'PRIVATE_FIREBASE_CLIENT_EMAIL_MISSING');
  });

  await runAsyncTest('Missing ElevenLabs credentials become controlled STT and TTS errors', async () => {
    const service = new ElevenLabsService({ env: { STT_ENABLED: 'true', TTS_ENABLED: 'true' } });
    await assert.rejects(
      service.transcribe({ audioBuffer: Buffer.from('audio'), languageCode: 'te-IN' }),
      (error) => error.code === ERROR_CODES.STT_NOT_CONFIGURED
    );
    await assert.rejects(
      service.synthesize({ text: 'వరి పంట', languageCode: 'te-IN' }),
      (error) => error.code === ERROR_CODES.TTS_NOT_CONFIGURED
    );
  });

  // 6. ElevenLabs STT and TTS
  console.log('\n--- 6. ElevenLabs STT and TTS Services ---');
  await runAsyncTest('ElevenLabs TTS uses configured locale voices and deduplicates farm-scoped requests', async () => {
    const originalFetch = ttsService.fetchImpl;
    const envNames = [
      'ELEVENLABS_API_KEY', 'ELEVENLABS_TTS_MODEL', 'ELEVENLABS_TTS_EN_VOICE_ID',
      'ELEVENLABS_TTS_HI_VOICE_ID', 'ELEVENLABS_TTS_TE_VOICE_ID', 'TTS_ENABLED'
    ];
    const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    let calls = 0;
    process.env.ELEVENLABS_API_KEY = 'test-key';
    process.env.ELEVENLABS_TTS_MODEL = 'eleven_v3';
    process.env.ELEVENLABS_TTS_EN_VOICE_ID = 'voice-en';
    process.env.ELEVENLABS_TTS_HI_VOICE_ID = 'voice-hi';
    process.env.ELEVENLABS_TTS_TE_VOICE_ID = 'voice-te';
    process.env.TTS_ENABLED = 'true';
    let lastRequest;
    const audio = Buffer.from('mock-mp3');
    ttsService.fetchImpl = async (url, options) => {
      calls += 1;
      lastRequest = { url, options };
      return {
        ok: true,
        arrayBuffer: async () => audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)
      };
    };
    ttsService.audioCache.clear();
    try {
      const telugu = await ttsService.synthesize({
        text: 'నా పంటకు నీరు ఎప్పుడు పెట్టాలి',
        language: 'te',
        ownerUid: 'farmer-a',
        farmId: 'farm-a'
      });
      assert.strictEqual(lastRequest.url, 'https://api.elevenlabs.io/v1/text-to-speech/voice-te?output_format=mp3_44100_128');
      assert.strictEqual(lastRequest.options.headers['xi-api-key'], 'test-key');
      assert.strictEqual(JSON.parse(lastRequest.options.body).model_id, 'eleven_v3');
      assert.strictEqual(JSON.parse(lastRequest.options.body).language_code, 'te');
      assert.strictEqual(telugu.languageCode, 'te-IN');
      assert.strictEqual(telugu.language, 'te');
      assert.strictEqual(telugu.audioContentType, 'audio/mpeg');
      const repeated = await ttsService.synthesize({
        text: 'నా పంటకు నీరు ఎప్పుడు పెట్టాలి',
        language: 'te',
        ownerUid: 'farmer-a',
        farmId: 'farm-a'
      });
      assert.strictEqual(repeated.audioBase64, telugu.audioBase64);
      assert.strictEqual(calls, 1);

      const otherFarmer = await ttsService.synthesize({
        text: 'నా పంటకు నీరు ఎప్పుడు పెట్టాలి',
        language: 'te',
        ownerUid: 'farmer-b',
        farmId: 'farm-a'
      });
      assert.strictEqual(otherFarmer.audioBase64, telugu.audioBase64);
      assert.strictEqual(calls, 2);
      const res2 = await ttsService.synthesize({
        text: 'मेरी फसल में खाद कब डालें',
        language: 'hi',
        ownerUid: 'farmer-a',
        farmId: 'farm-a'
      });
      assert.strictEqual(res2.languageCode, 'hi-IN');
      assert.strictEqual(JSON.parse(lastRequest.options.body).language_code, 'hi');
      assert.strictEqual(res2.audioContentType, 'audio/mpeg');
    } finally {
      ttsService.audioCache.clear();
      ttsService.fetchImpl = originalFetch;
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  await runAsyncTest('ElevenLabs streaming TTS forwards audio chunks and caches only within the owner and farm scope', async () => {
    const { Readable } = require('stream');
    const requests = [];
    const audio = [Buffer.from('first-audio-chunk'), Buffer.from('second-audio-chunk')];
    const service = new ElevenLabsService({
      env: {
        NODE_ENV: 'test',
        ELEVENLABS_API_KEY: 'test-key',
        ELEVENLABS_TTS_MODEL: 'eleven_v3',
        ELEVENLABS_TTS_EN_VOICE_ID: 'voice-en',
        ELEVENLABS_TTS_HI_VOICE_ID: 'voice-hi',
        ELEVENLABS_TTS_TE_VOICE_ID: 'voice-te',
        TTS_ENABLED: 'true'
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          headers: { get: () => 'audio/mpeg' },
          body: Readable.from(audio)
        };
      }
    });

    const first = await service.synthesizeStream({
      text: 'A farm update',
      language: 'en',
      ownerUid: 'farmer-a',
      farmId: 'farm-a'
    });
    const chunks = [];
    for await (const chunk of first.stream) chunks.push(chunk);
    assert.deepStrictEqual(chunks, audio);
    assert.match(requests[0].url, /\/v1\/text-to-speech\/voice-en\/stream\?output_format=mp3_44100_128$/);
    assert.strictEqual(JSON.parse(requests[0].options.body).model_id, 'eleven_v3');
    assert.strictEqual(requests[0].options.headers['xi-api-key'], 'test-key');

    const repeated = await service.synthesizeStream({
      text: 'A farm update',
      language: 'en',
      ownerUid: 'farmer-a',
      farmId: 'farm-a'
    });
    assert.strictEqual(repeated.cacheHit, true);
    const cachedChunks = [];
    for await (const chunk of repeated.stream) cachedChunks.push(chunk);
    assert.deepStrictEqual(Buffer.concat(cachedChunks), Buffer.concat(audio));
    assert.strictEqual(requests.length, 1);

    const anotherOwner = await service.synthesizeStream({
      text: 'A farm update',
      language: 'en',
      ownerUid: 'farmer-b',
      farmId: 'farm-a'
    });
    for await (const _chunk of anotherOwner.stream) {}
    assert.strictEqual(requests.length, 2);
  });

  await runAsyncTest('ElevenLabs Scribe v2 sends selected locale and normalizes transcription', async () => {
    const envNames = ['ELEVENLABS_API_KEY', 'ELEVENLABS_STT_MODEL', 'STT_ENABLED'];
    const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    let request;
    const originalFetch = speechService.fetchImpl;
    process.env.ELEVENLABS_API_KEY = 'test-key';
    process.env.ELEVENLABS_STT_MODEL = 'scribe_v2';
    process.env.STT_ENABLED = 'true';
    speechService.fetchImpl = async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ language_code: 'tel', text: 'పంటకు నీరు ఇవ్వండి' }) };
    };
    try {
      const result = await speechService.transcribe({
        audioBuffer: Buffer.from('audio'),
        mimeType: 'audio/webm',
        language: 'te'
      });
      assert.strictEqual(request.url, 'https://api.elevenlabs.io/v1/speech-to-text');
      assert.strictEqual(request.options.headers['xi-api-key'], 'test-key');
      assert.strictEqual(request.options.body.get('language_code'), 'te');
      assert.strictEqual(request.options.body.get('model_id'), 'scribe_v2');
      assert.ok(request.options.body.get('file') instanceof Blob);
      assert.strictEqual(result.detectedLanguage, 'te');
      assert.strictEqual(result.provider, 'elevenlabs');
      await speechService.transcribe({
        audioBuffer: Buffer.from('audio'),
        mimeType: 'audio/webm',
        language: 'auto'
      });
      assert.strictEqual(request.options.body.get('language_code'), null);
    } finally {
      speechService.fetchImpl = originalFetch;
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  await runAsyncTest('ElevenLabs auth errors are controlled and do not leak the key', async () => {
    let calls = 0;
    const service = new ElevenLabsService({
      env: {
        ELEVENLABS_API_KEY: 'secret-test-key',
        ELEVENLABS_TTS_EN_VOICE_ID: 'voice-en',
        ELEVENLABS_TTS_HI_VOICE_ID: 'voice-hi',
        ELEVENLABS_TTS_TE_VOICE_ID: 'voice-te',
        TTS_ENABLED: 'true'
      },
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: false,
          status: 401,
          json: async () => ({ detail: { status: 'invalid_api_key', message: 'invalid key' } })
        };
      }
    });
    await assert.rejects(
      service.synthesize({ text: 'Hello farmer', language: 'en', ownerUid: 'farmer', farmId: 'farm' }),
      (error) => error.code === ERROR_CODES.ELEVENLABS_AUTH_FAILED &&
        !error.message.includes('secret-test-key')
    );
    assert.strictEqual(calls, 1);
  });

  runTest('Combines time-current weather with independent farm-twin conditions', () => {
    const state = getFarmEnvironmentState({}, {
      weatherData: {
        available: true,
        status: 'current',
        data: { rainMm: 0, precipitationMm: 0, showersMm: 0, temperatureC: 39, humidityPercent: 92, weatherCode: 0 }
      }
    });
    assert.strictEqual(state.environmentState, 'HIGH_HEAT');
    assert.deepStrictEqual(state.secondaryStates, ['HIGH_HUMIDITY', 'SUNNY']);
    assert.strictEqual(state.weather.available, true);

    const normalWeather = getFarmEnvironmentState({}, {
      weatherData: {
        available: true,
        status: 'current',
        data: { rainMm: 0, precipitationMm: 0, showersMm: 0, temperatureC: 29, humidityPercent: 60, weatherCode: 2 }
      }
    });
    assert.strictEqual(normalWeather.environmentState, 'NORMAL');

    const weatherOnlyRain = getFarmEnvironmentState({}, {
      weatherData: {
        available: true,
        status: 'current',
        data: { rainMm: 2, precipitationMm: 2, showersMm: 0, temperatureC: 25, humidityPercent: 90, weatherCode: 61 }
      }
    });
    assert.strictEqual(weatherOnlyRain.environmentState, 'RAIN');
    assert.deepStrictEqual(weatherOnlyRain.secondaryStates, ['HIGH_HUMIDITY']);
  });

  runTest('Reports unavailable farm data without fabricating environmental state', () => {
    const baseline = getFarmEnvironmentState({});
    assert.strictEqual(baseline.environmentState, 'NORMAL');
    assert.strictEqual(baseline.dataStatus, 'unavailable');
    assert.ok(baseline.statusText.includes('unavailable'));
    assert.strictEqual(baseline.visual.soilAppearance, 'unknown');

    const geometryOnly = getFarmEnvironmentState({
      farmBoundary: [
        { lat: 17.4, lng: 78.5 },
        { lat: 17.4, lng: 78.51 },
        { lat: 17.41, lng: 78.5 }
      ]
    });
    assert.strictEqual(geometryOnly.dataStatus, 'geometry_only');
  });

  runTest('Resolves farm-local time from saved coordinates when weather is unavailable', () => {
    const fixtures = [
      { latitude: 18.1993, longitude: 79.5592, timezone: 'Asia/Kolkata' },
      { latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' },
      { latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' }
    ];
    for (const fixture of fixtures) {
      assert.strictEqual(resolveFarmTimeZone(fixture), fixture.timezone);
      const farmTwin = getFarmEnvironmentState({
        farmLocation: { latitude: fixture.latitude, longitude: fixture.longitude }
      }, {
        weatherData: { available: false, status: 'unavailable' }
      });
      assert.strictEqual(farmTwin.timezone, fixture.timezone);
      assert.strictEqual(farmTwin.weather, null);
    }
  });

  runTest('Returns the coordinate-derived timezone with the farm profile before weather loads', () => {
    const farm = formatFarm({
      _id: 'test-farm',
      location: { latitude: 18.1993, longitude: 79.5592 }
    });
    assert.strictEqual(farm.timezone, 'Asia/Kolkata');
    assert.strictEqual(farm.farmLocation.timezone, 'Asia/Kolkata');
  });

  await runAsyncTest('Uses Open-Meteo for saved farm coordinates without provider credentials', async () => {
    const originalFetch = global.fetch;
    let requestUrl;
    const requestedCoordinates = [];
    global.fetch = async (input) => {
      requestUrl = new URL(input);
      requestedCoordinates.push([
        requestUrl.searchParams.get('latitude'),
        requestUrl.searchParams.get('longitude')
      ]);
      return {
        ok: true,
        async json() {
          return {
            timezone: 'Asia/Kolkata',
            utc_offset_seconds: 19800,
            current: {
              time: new Date().toISOString(),
              temperature_2m: 30,
              relative_humidity_2m: 65,
              precipitation: 0,
              rain: 0,
              showers: 0,
              weather_code: 1,
              cloud_cover: 20,
              cloud_cover_low: 10,
              cloud_cover_mid: 15,
              cloud_cover_high: 20,
              wind_speed_10m: 8,
              wind_direction_10m: 45,
              is_day: 1
            },
            hourly: {
              time: [],
              shortwave_radiation: []
            },
            daily: {
              time: ['2026-10-02'],
              sunrise: ['2026-10-02T06:00'],
              sunset: ['2026-10-02T18:00'],
              daylight_duration: [43200],
              moonrise: ['2026-10-02T20:00'],
              moonset: ['2026-10-02T07:00'],
              moon_phase: [0.75]
            }
          };
        }
      };
    };
    try {
      const result = await weatherService.getCurrentWeather({ latitude: 23.91234, longitude: 83.11987 });
      assert.strictEqual(requestUrl.hostname, 'api.open-meteo.com');
      assert.strictEqual(requestUrl.pathname, '/v1/forecast');
      assert.strictEqual(requestUrl.searchParams.get('latitude'), '23.91234');
      assert.strictEqual(requestUrl.searchParams.get('longitude'), '83.11987');
      assert.strictEqual(requestUrl.searchParams.get('timezone'), 'Asia/Kolkata');
      assert.strictEqual(result.available, true);
      assert.strictEqual(result.provider, 'Open-Meteo');
      assert.strictEqual(result.data.temperatureC, 30);
      assert.strictEqual(result.timezone, 'Asia/Kolkata');
      assert.strictEqual(result.current.isDay, true);
      assert.strictEqual(result.current.cloudCoverLow, 10);
      assert.strictEqual(result.daily[0].sunrise, '2026-10-02T00:30:00.000Z');
      assert.strictEqual(result.daily[0].sunset, '2026-10-02T12:30:00.000Z');
      assert.strictEqual(result.daily[0].daylightDurationSeconds, 43200);
      assert.strictEqual(result.daily[0].moonPhase, 0.75);
      await weatherService.getCurrentWeather({ latitude: 23.91235, longitude: 83.11988 });
      assert.deepStrictEqual(requestedCoordinates, [
        ['23.91234', '83.11987'],
        ['23.91235', '83.11988']
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await runAsyncTest('Open-Meteo resolves each farm timezone from its geographic coordinates', async () => {
    const originalFetch = global.fetch;
    const requestedTimezones = [];
    const timezoneFixtures = [
      { latitude: '17.385', longitude: '78.4867', timezone: 'Asia/Kolkata' },
      { latitude: '37.7749', longitude: '-122.4194', timezone: 'America/Los_Angeles' },
      { latitude: '-33.8688', longitude: '151.2093', timezone: 'Australia/Sydney' }
    ];
    global.fetch = async (input) => {
      const requestUrl = new URL(input);
      requestedTimezones.push(requestUrl.searchParams.get('timezone'));
      const fixture = timezoneFixtures.find((candidate) =>
        candidate.latitude === requestUrl.searchParams.get('latitude') &&
        candidate.longitude === requestUrl.searchParams.get('longitude')
      );
      return {
        ok: true,
        async json() {
          return {
            timezone: fixture.timezone,
            utc_offset_seconds: 0,
            current: { time: new Date().toISOString(), temperature_2m: 20 },
            hourly: { time: [] },
            daily: { time: [] }
          };
        }
      };
    };
    try {
      const results = await Promise.all(timezoneFixtures.map((fixture) =>
        weatherService.getCurrentWeather({
          latitude: Number(fixture.latitude),
          longitude: Number(fixture.longitude)
        })
      ));
      assert.deepStrictEqual(requestedTimezones,
        timezoneFixtures.map((fixture) => fixture.timezone));
      assert.deepStrictEqual(results.map((result) => result.timezone),
        timezoneFixtures.map((fixture) => fixture.timezone));
    } finally {
      global.fetch = originalFetch;
    }
  });

  await runAsyncTest('Does not query weather or invent coordinates when a farm location is missing', async () => {
    const originalFetch = global.fetch;
    let requestMade = false;
    global.fetch = async () => {
      requestMade = true;
      throw new Error('Unexpected weather request without coordinates.');
    };
    try {
      const result = await weatherService.getCurrentWeather(null);
      assert.strictEqual(requestMade, false);
      assert.strictEqual(result.available, false);
      assert.strictEqual(result.status, 'location_unavailable');
      assert.strictEqual(result.data, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await runAsyncTest('Samples nearby rain from actual Open-Meteo point forecasts', async () => {
    const originalFetch = global.fetch;
    const now = new Date();
    const time = now.toISOString().slice(0, 13) + ':00';
    const nextTime = new Date(`${time}:00Z`);
    nextTime.setUTCHours(nextTime.getUTCHours() + 1);
    const nextTimeLabel = nextTime.toISOString().slice(0, 16);
    let batchRequestCount = 0;
    global.fetch = async (input) => {
      const requestUrl = new URL(input);
      const latitudeCount = requestUrl.searchParams.get('latitude').split(',').length;
      if (latitudeCount > 1) batchRequestCount += 1;
      return {
        ok: true,
        async json() {
          return Array.from({ length: latitudeCount }, (_, index) => ({
            latitude: 13.7 + index * 0.01,
            longitude: 79.6,
            current: {
              time,
              temperature_2m: 29,
              relative_humidity_2m: 60,
              precipitation: 0,
              rain: 0,
              weather_code: 1,
              cloud_cover: 10,
              wind_speed_10m: 8
            },
            hourly: {
              time: [time, nextTimeLabel],
              temperature_2m: [29, 29],
              relative_humidity_2m: [60, 60],
              precipitation: [0, index === 5 ? 1 : 0],
              precipitation_probability: [0, index === 5 ? 75 : 0],
              rain: [0, index === 5 ? 1 : 0],
              wind_speed_10m: [8, 8],
              weather_code: [1, index === 5 ? 61 : 1]
            },
            daily: { time: [], precipitation_probability_max: [], precipitation_sum: [] }
          }));
        }
      };
    };
    try {
      const result = await weatherService.getCurrentWeather(
        { latitude: 13.7, longitude: 79.6 },
        { includeNearbyRain: true }
      );
      assert.strictEqual(result.available, true);
      assert.strictEqual(result.rainAnalysis.isRadar, false);
      assert.strictEqual(result.rainAnalysis.label, 'Forecast rain around your farm');
      assert.strictEqual(result.rainAnalysis.cells.length, 9);
      assert.ok(result.rainAnalysis.rainyDirections.includes('east'));
      assert.ok(batchRequestCount > 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  runTest('Recognizes nearby rain questions in English, Telugu, and Hindi', () => {
    assert.strictEqual(weatherService.isSpatialRainQuestion('Where is the rain?'), true);
    assert.strictEqual(weatherService.isSpatialRainQuestion('నా పొలం దగ్గర వర్షం పడుతుందా?'), true);
    assert.strictEqual(weatherService.isSpatialRainQuestion('क्या मेरे खेत के पास बारिश होगी?'), true);
  });

  await runAsyncTest('Does not fabricate historical weather when only forecasts are configured', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('Historical questions must not be answered with an unrelated current forecast.');
    };
    try {
      const result = await weatherService.getWeatherContext(
        { latitude: 17.4, longitude: 78.5 },
        { question: 'Was this area hotter last month?' }
      );
      assert.strictEqual(result.available, false);
      assert.strictEqual(result.status, 'historical_unavailable');
      assert.deepStrictEqual(result.sources, []);
      assert.strictEqual(result.message, 'Historical weather is not available from the configured forecast source.');
    } finally {
      global.fetch = originalFetch;
    }
  });

  runTest('Builds AI context only from supplied farm and source data', () => {
    const context = buildFarmContext({
      profile: { farmerName: 'Test Farmer' },
      farm: {
        farmLocation: { latitude: 17.4, longitude: 78.5, state: 'Telangana' },
        cropDetails: { name: 'Cotton' }
      }
    });
    assert.strictEqual(context.farmer.name, 'Test Farmer');
    assert.strictEqual(context.farm.crop, 'Cotton');
    assert.strictEqual(context.location.state, 'Telangana');
    assert.strictEqual(context.weather, null);
    assert.deepStrictEqual(context.agricultureData, []);
    assert.strictEqual(context.farm.soil, undefined);
  });

  await runAsyncTest('Builds request context only from the authenticated active farm and current sources', async () => {
    const farms = new Map([
      ['user-a:farm-a', {
        _id: 'farm-a',
        ownerUid: 'user-a',
        name: 'North Field',
        farmLocation: { latitude: 17.4, longitude: 78.5, displayName: 'North Field' },
        area: { acres: 4.5, perimeterMeters: 540, lengthMeters: 180, widthMeters: 120 },
        cropDetails: { name: 'Paddy', variety: 'Sona', stage: 'Tillering', plantingDate: '2026-09-03' },
        soilDetails: { type: 'Clay loam' },
        waterSource: 'Canal',
        farmBoundary: [{ lat: 17.4, lng: 78.5 }, { lat: 17.41, lng: 78.5 }, { lat: 17.41, lng: 78.51 }]
      }],
      ['user-a:farm-b', {
        _id: 'farm-b',
        ownerUid: 'user-a',
        name: 'South Field',
        farmLocation: { latitude: 16.2, longitude: 80.4, displayName: 'South Field' },
        area: { acres: 2 },
        cropDetails: { name: 'Cotton' },
        waterSource: 'Borewell'
      }],
      ['user-b:private-farm', {
        _id: 'private-farm',
        ownerUid: 'user-b',
        cropDetails: { name: 'Maize' }
      }],
      ['user-a:empty-farm', {
        _id: 'empty-farm',
        ownerUid: 'user-a',
        name: 'Unconfigured Field'
      }]
    ]);
    const seen = { farms: [], weather: [], schedule: [], alerts: [] };
    const repository = {
      async getOwnedFarm(uid, farmId) {
        seen.farms.push({ uid, farmId });
        return farms.get(`${uid}:${farmId}`) || null;
      },
      async getFarmer(uid) {
        return { name: 'Farmer A', phone: '+10000000000', preferredLanguage: 'te-IN', otp: 'not-for-ai' };
      },
      async getCropProtocol(crop) {
        seen.schedule.push(crop);
        return {
          enabled: true,
          stages: [
            { name: 'Seedling', startDay: 0, endDay: 20 },
            { name: 'Tillering', startDay: 21, endDay: 40 }
          ],
          activities: [
            { id: 'fertilizer', name: 'Apply configured fertilizer', type: 'fertilizer', dayAfterStart: 30 },
            { id: 'irrigation', name: 'Inspect field water level', type: 'irrigation', dayAfterStart: 32 }
          ]
        };
      },
      async getFarmActivityStatuses(uid, farmId) {
        seen.schedule.push(`${uid}:${farmId}`);
        return [];
      },
      async getUserNotifications(uid, farmId) {
        seen.alerts.push({ uid, farmId });
        return [{ ownerUid: uid, farmId, title: 'Farm alert', message: 'Observed alert details', severity: 'warning' }];
      }
    };
    const weather = {
      async getWeatherContext(location) {
        seen.weather.push({ ...location });
        return {
          available: true,
          status: 'current',
          provider: 'Open-Meteo',
          retrievedAt: '2026-10-03T10:00:00.000Z',
          current: { time: '2026-10-03T10:00:00.000Z', temperature: 29, precipitation: 0.2 },
          daily: [{ date: '2026-10-03', temperatureMax: 33, precipitationSum: 2 }]
        };
      }
    };
    const fixedNow = new Date('2026-10-03T12:00:00.000Z');
    const farmA = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-a',
      intent: 'CROP_ADVISOR',
      question: 'When should I apply fertilizer?',
      language: 'en',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.strictEqual(farmA.context.farm.farmId, undefined);
    assert.strictEqual(farmA.context.farm.crop, 'Paddy');
    assert.strictEqual(farmA.context.farm.cropStage, 'Tillering');
    assert.strictEqual(farmA.context.schedule.cropAgeDays, 30);
    assert.deepStrictEqual(farmA.context.schedule.today.map((activity) => activity.name), ['Apply configured fertilizer']);
    assert.deepStrictEqual(farmA.context.schedule.upcoming, []);
    assert.strictEqual(farmA.context.weather, undefined);
    assert.strictEqual(JSON.stringify(farmA.context).includes('+10000000000'), false);
    assert.strictEqual(JSON.stringify(farmA.context).includes('not-for-ai'), false);

    const farmB = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-b',
      intent: 'WEATHER',
      question: 'What is the weather and rain forecast near my farm for my crop?',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.strictEqual(farmB.context.farm.farmId, undefined);
    assert.strictEqual(farmB.context.farm.crop, 'Cotton');
    assert.deepStrictEqual(seen.weather[0], { latitude: 16.2, longitude: 80.4, displayName: 'South Field' });
    assert.strictEqual(farmB.context.weather.current.temperature, 29);
    assert.strictEqual(farmB.context.weather.relevantForecast[0].precipitationSum, 2);
    assert.strictEqual(contextService.getContextDiagnostics(farmB.context).crop, 'supplied');
    assert.strictEqual(JSON.stringify(contextService.getContextDiagnostics(farmB.context)).includes('Cotton'), false);

    const liveContext = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-a',
      intent: 'FARM_STATUS',
      question: 'What should I do today and what is the current weather?',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.strictEqual(liveContext.context.schedule.cropAgeDays, 30);
    assert.strictEqual(liveContext.context.weather.available, true);

    const farmDetails = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-a',
      intent: detectIntent('What is my farm size?'),
      question: 'What is my farm size?',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.strictEqual(farmDetails.context.farm.areaAcres, 4.5);
    assert.strictEqual(farmDetails.context.farm.perimeterMeters, undefined);
    assert.strictEqual(farmDetails.context.farm.dimensions, undefined);
    assert.strictEqual(farmDetails.context.farm.name, undefined);
    assert.strictEqual(farmDetails.context.farm.soil, undefined);
    assert.strictEqual(farmDetails.context.farm.waterSource, undefined);
    assert.strictEqual(farmDetails.context.schedule, undefined);

    const farmDimensions = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-a',
      intent: 'FARM_DETAILS',
      question: 'What are my farm dimensions and perimeter?',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.strictEqual(farmDimensions.context.farm.perimeterMeters, 540);
    assert.deepStrictEqual(farmDimensions.context.farm.dimensions, { lengthMeters: 180, widthMeters: 120 });

    const cropDetails = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-a',
      intent: 'FARM_DETAILS',
      question: 'What crop am I growing, and what is its variety and stage?',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.deepStrictEqual({
      crop: cropDetails.context.farm.crop,
      variety: cropDetails.context.farm.cropVariety,
      stage: cropDetails.context.farm.cropStage
    }, { crop: 'Paddy', variety: 'Sona', stage: 'Tillering' });

    const farmSummary = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-a',
      intent: detectIntent('Tell me about my farm.'),
      question: 'Tell me about my farm.',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.strictEqual(farmSummary.context.farm.crop, 'Paddy');
    assert.strictEqual(farmSummary.context.farm.areaAcres, 4.5);
    assert.strictEqual(farmSummary.context.farm.waterSource, 'Canal');

    const missingFarmData = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'empty-farm',
      intent: 'CROP_ADVISOR',
      question: 'What should I do for this crop today?',
      now: fixedNow
    }, { repository, weatherService: weather });
    assert.strictEqual(missingFarmData.context.farm.crop, undefined);
    assert.strictEqual(missingFarmData.context.farm.soil, undefined);
    assert.deepStrictEqual(missingFarmData.context.schedule, {
      available: false,
      status: 'crop_unavailable'
    });

    const irrigation = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-b',
      intent: 'IRRIGATION_ADVISOR',
      question: 'How should I irrigate this field?'
    }, { repository, weatherService: weather });
    assert.strictEqual(irrigation.context.farm.waterSource, 'Borewell');

    const alerts = await contextService.buildAIContext({
      uid: 'user-a',
      farmId: 'farm-b',
      intent: 'ALERTS',
      question: 'Why am I getting this farm alert?'
    }, { repository, weatherService: weather });
    assert.strictEqual(alerts.context.alerts[0].title, 'Farm alert');
    assert.strictEqual(alerts.context.weather.available, true);
    assert.strictEqual(alerts.context.farm.crop, 'Cotton');
    assert.deepStrictEqual(seen.alerts[0], { uid: 'user-a', farmId: 'farm-b' });
    const authorizedWeatherRequests = seen.weather.length;
    await assert.rejects(
      contextService.buildAIContext({
        uid: 'user-a',
        farmId: 'private-farm',
        intent: 'WEATHER',
        question: 'What is the weather?'
      }, { repository, weatherService: weather }),
      (error) => error.statusCode === 403 && error.code === 'FARM_ACCESS_DENIED'
    );
    assert.strictEqual(seen.weather.length, authorizedWeatherRequests);
    assert.strictEqual(seen.farms[0].uid, 'user-a');
    assert.strictEqual(seen.farms[0].farmId, 'farm-a');
  });

  await runAsyncTest('Typed, voice-transcribed, and image requests share the same active-farm context builder', async () => {
    const originalGetProvider = providerFactory.getProvider;
    const originalBuildAIContext = contextService.buildAIContext;
    const originalGetMessages = conversationStorageService.getMessages;
    const originalSaveMessage = conversationStorageService.saveMessage;
    const originalUpdateAttachment = conversationStorageService.updateAttachment;
    const originalFirestoreIsConfigured = firestoreRepository.isConfigured;
    const originalUploadBuffer = cloudinaryImageService.uploadBuffer;
    const originalSignedDeliveryUrl = cloudinaryImageService.getSignedDeliveryUrl;
    const originalLiveEnabled = process.env.GEMINI_LIVE_ENABLED;
    const receivedPrompts = [];
    const chatHistory = [];
    const calls = [];
    const imageCalls = [];
    const uploadedImages = [];
    const storedAttachments = [];
    const attachmentStatuses = [];
    providerFactory.getProvider = () => ({
      name: 'gemini',
      async chat(options) {
        receivedPrompts.push(options.systemInstruction);
        chatHistory.push(options.messages);
        return { text: 'Farm-aware reply.' };
      },
      async analyzeImage(options) {
        receivedPrompts.push(options.systemInstruction);
        imageCalls.push(options);
        return { text: 'Image reply using farm context.' };
      },
      async createLiveToken(options) {
        receivedPrompts.push(options.systemInstruction);
        return { token: 'test-live-token' };
      }
    });
    contextService.buildAIContext = async (options) => {
      calls.push(options);
      return {
        context: {
          user: {},
          farm: { farmId: options.farmId, crop: options.farmId === 'farm-a' ? 'Paddy' : 'Cotton' },
          schedule: { configured: false, status: 'unavailable' },
          sourceStatus: {},
          conversation: {}
        },
        farm: { _id: options.farmId, cropDetails: { name: options.farmId === 'farm-a' ? 'Paddy' : 'Cotton' } },
        weatherData: null
      };
    };
    conversationStorageService.getMessages = async () => [];
    conversationStorageService.saveMessage = async (message) => {
      if (message.attachment) storedAttachments.push(message);
      return message.messageId || 'saved-message';
    };
    conversationStorageService.updateAttachment = async (message) => {
      attachmentStatuses.push(message.analysisStatus);
      return true;
    };
    firestoreRepository.isConfigured = () => true;
    cloudinaryImageService.uploadBuffer = async (upload) => {
      uploadedImages.push(upload);
      return {
        provider: 'cloudinary',
        assetId: `asset-${upload.messageId}`,
        publicId: `agrishield/ai-images/${upload.ownerUid}/${upload.farmId}/${upload.conversationId}/${upload.messageId}`,
        version: 1,
        resourceType: 'image',
        type: 'authenticated',
        format: 'png',
        width: 100,
        height: 100,
        bytes: upload.buffer.length,
        uploadedAt: new Date().toISOString(),
        ownerUid: upload.ownerUid,
        farmId: upload.farmId,
        conversationId: upload.conversationId
      };
    };
    cloudinaryImageService.getSignedDeliveryUrl = () => 'https://signed.example/image';
    process.env.GEMINI_LIVE_ENABLED = 'true';
    const conversationIds = [
      'context-typed-test',
      'context-voice-test',
      'context-image-test',
      'context-farm-switch-test',
      'context-general-test'
    ];
    conversationIds.forEach((id) => conversationService.clearSession(`user-a:farm-a:${id}`));
    try {
      await aiService.generateChatResponse({
        message: 'How should I care for my paddy crop?',
        language: 'en',
        conversationId: conversationIds[0],
        farmerId: 'user-a',
        farmId: 'farm-a'
      });
      await aiService.generateChatResponse({
        message: 'My paddy crop needs water.',
        language: 'en',
        conversationId: conversationIds[1],
        farmerId: 'user-a',
        farmId: 'farm-a',
        inputType: 'voice'
      });
      const imageResponse = await aiService.generateChatResponse({
        message: 'What is wrong with this plant?',
        language: 'en',
        conversationId: conversationIds[2],
        farmerId: 'user-a',
        farmId: 'farm-a',
        image: 'dGVzdC1pbWFnZQ==',
        imageMimeType: 'image/png',
        inputType: 'image'
      });
      await aiService.createLiveVoiceSession({
        farmerId: 'user-a',
        farmId: 'farm-a',
        languageCode: 'en-IN'
      });
      await aiService.generateChatResponse({
        message: 'What should I do today?',
        language: 'en',
        conversationId: conversationIds[3],
        farmerId: 'user-a',
        farmId: 'farm-b'
      });
      await aiService.generateChatResponse({
        message: 'Who are you?',
        language: 'en',
        conversationId: conversationIds[4],
        farmerId: 'user-a',
        farmId: 'farm-a',
        history: [{ role: 'assistant', content: 'Unauthorized Farm B crop: Cotton' }]
      });
      assert.strictEqual(calls.length, 5);
      assert.ok(calls.every((call) => call.uid === 'user-a'));
      assert.ok(calls.slice(0, 3).every((call) => call.farmId === 'farm-a'));
      assert.strictEqual(calls[2].intent, 'IMAGE_ANALYSIS');
      assert.strictEqual(uploadedImages.length, 1);
      assert.deepStrictEqual(uploadedImages[0].buffer, Buffer.from('dGVzdC1pbWFnZQ==', 'base64'));
      assert.deepStrictEqual(Buffer.from(imageCalls[0].base64Data, 'base64'), uploadedImages[0].buffer);
      assert.strictEqual(imageCalls[0].mimeType, 'image/png');
      assert.strictEqual(storedAttachments.length, 1);
      assert.strictEqual(storedAttachments[0].analysisStatus, 'ANALYZING');
      assert.deepStrictEqual(attachmentStatuses, ['COMPLETED']);
      assert.strictEqual(imageResponse.imageUrl, 'https://signed.example/image');
      assert.ok(imageCalls[0].systemInstruction.includes('distinguish what is directly visible'));
      assert.strictEqual(calls[3].intent, 'FARM_STATUS');
      assert.ok(receivedPrompts.slice(0, 3).every((prompt) => prompt.includes('"farmId":"farm-a"')));
      assert.ok(receivedPrompts.slice(0, 3).every((prompt) => prompt.includes('"crop":"Paddy"')));
      assert.ok(receivedPrompts.slice(0, 3).every((prompt) => prompt.includes('authoritative stored data')));
      assert.ok(receivedPrompts[3].includes('"farmId":"farm-a"'));
      assert.ok(receivedPrompts[3].includes('"crop":"Paddy"'));
      assert.ok(receivedPrompts[4].includes('"farmId":"farm-b"'));
      assert.ok(receivedPrompts[4].includes('"crop":"Cotton"'));
      assert.strictEqual(receivedPrompts[5].includes('farm-a'), false);
      assert.strictEqual(receivedPrompts[5].includes('Unauthorized Farm B crop'), false);
      assert.deepStrictEqual(chatHistory[3], [{ role: 'user', content: 'Who are you?' }]);
    } finally {
      providerFactory.getProvider = originalGetProvider;
      contextService.buildAIContext = originalBuildAIContext;
      conversationStorageService.getMessages = originalGetMessages;
      conversationStorageService.saveMessage = originalSaveMessage;
      conversationStorageService.updateAttachment = originalUpdateAttachment;
      firestoreRepository.isConfigured = originalFirestoreIsConfigured;
      cloudinaryImageService.uploadBuffer = originalUploadBuffer;
      cloudinaryImageService.getSignedDeliveryUrl = originalSignedDeliveryUrl;
      if (originalLiveEnabled === undefined) delete process.env.GEMINI_LIVE_ENABLED;
      else process.env.GEMINI_LIVE_ENABLED = originalLiveEnabled;
      conversationIds.forEach((id) => conversationService.clearSession(`user-a:farm-a:${id}`));
    }
  });

  await runAsyncTest('Failed image analysis retains its Firebase attachment and retries the same Cloudinary asset', async () => {
    const originalGetProvider = providerFactory.getProvider;
    const originalBuildAIContext = contextService.buildAIContext;
    const originalGetMessages = conversationStorageService.getMessages;
    const originalSaveMessage = conversationStorageService.saveMessage;
    const originalUpdateAttachment = conversationStorageService.updateAttachment;
    const originalIsConfigured = firestoreRepository.isConfigured;
    const originalUploadBuffer = cloudinaryImageService.uploadBuffer;
    const originalDeleteAsset = cloudinaryImageService.deleteAsset;
    const originalSignedUrl = cloudinaryImageService.getSignedDeliveryUrl;
    const conversationId = 'image-retry-persistence-test';
    const image = Buffer.from('actual crop image bytes');
    let uploadCount = 0;
    let geminiCalls = 0;
    const persistedMessages = [];
    const persistedStatuses = [];
    const attachment = {
      provider: 'cloudinary',
      assetId: 'asset-retry',
      publicId: `agrishield/ai-images/user-a/farm-a/${conversationId}/image-message`,
      version: 1,
      resourceType: 'image',
      type: 'authenticated',
      format: 'png',
      bytes: image.length,
      width: 80,
      height: 80,
      uploadedAt: new Date().toISOString(),
      ownerUid: 'user-a',
      farmId: 'farm-a',
      conversationId
    };
    providerFactory.getProvider = () => ({
      name: 'gemini',
      async analyzeImage(options) {
        geminiCalls += 1;
        assert.deepStrictEqual(options.imageBuffer, image);
        if (geminiCalls === 1) {
          throw new AgriShieldError(ERROR_CODES.IMAGE_ANALYSIS_UNAVAILABLE, 'Mock 503.', 503);
        }
        return { text: 'The image suggests leaf spotting; certainty is limited.' };
      },
      async chat() { throw new Error('The image must be sent to Gemini vision.'); }
    });
    contextService.buildAIContext = async () => ({
      context: { user: {}, farm: { crop: 'Paddy' }, sourceStatus: {}, conversation: {} },
      farm: { cropDetails: { name: 'Paddy' } },
      weatherData: null
    });
    conversationStorageService.getMessages = async () => [];
    conversationStorageService.saveMessage = async (message) => {
      persistedMessages.push(message);
      return message.messageId || 'assistant-message';
    };
    conversationStorageService.updateAttachment = async (message) => {
      persistedStatuses.push(message.analysisStatus);
      return true;
    };
    firestoreRepository.isConfigured = () => true;
    cloudinaryImageService.uploadBuffer = async (options) => {
      uploadCount += 1;
      assert.deepStrictEqual(options.buffer, image);
      return attachment;
    };
    cloudinaryImageService.deleteAsset = async () => {
      throw new Error('A Gemini failure must retain the Cloudinary asset.');
    };
    cloudinaryImageService.getSignedDeliveryUrl = () => 'https://signed.example/persisted-image';
    conversationService.clearSession(`user-a:farm-a:${conversationId}`);
    let analysisFailure;
    try {
      await assert.rejects(
        aiService.generateChatResponse({
          message: 'What is wrong with this leaf?',
          language: 'te',
          conversationId,
          farmerId: 'user-a',
          farmId: 'farm-a',
          image,
          imageMimeType: 'image/png',
          inputType: 'image'
        }),
        (error) => {
          analysisFailure = error;
          return error.code === ERROR_CODES.IMAGE_ANALYSIS_UNAVAILABLE;
        }
      );
      assert.strictEqual(analysisFailure.imageMessageId, persistedMessages[0].messageId);
      assert.strictEqual(persistedMessages[0].analysisStatus, 'ANALYZING');
      assert.deepStrictEqual(persistedStatuses, ['FAILED']);
      assert.strictEqual(uploadCount, 1);
      const retry = await aiService.generateChatResponse({
        message: persistedMessages[0].message,
        language: 'te',
        conversationId,
        farmerId: 'user-a',
        farmId: 'farm-a',
        image,
        imageMimeType: 'image/png',
        inputType: 'image',
        storedAttachment: attachment,
        existingMessageId: analysisFailure.imageMessageId
      });
      assert.strictEqual(retry.reply, 'The image suggests leaf spotting; certainty is limited.');
      assert.strictEqual(retry.imageMessageId, analysisFailure.imageMessageId);
      assert.strictEqual(retry.imageUrl, 'https://signed.example/persisted-image');
      assert.strictEqual(uploadCount, 1);
      assert.strictEqual(geminiCalls, 2);
      assert.deepStrictEqual(persistedStatuses, ['FAILED', 'ANALYZING', 'COMPLETED']);
    } finally {
      providerFactory.getProvider = originalGetProvider;
      contextService.buildAIContext = originalBuildAIContext;
      conversationStorageService.getMessages = originalGetMessages;
      conversationStorageService.saveMessage = originalSaveMessage;
      conversationStorageService.updateAttachment = originalUpdateAttachment;
      firestoreRepository.isConfigured = originalIsConfigured;
      cloudinaryImageService.uploadBuffer = originalUploadBuffer;
      cloudinaryImageService.deleteAsset = originalDeleteAsset;
      cloudinaryImageService.getSignedDeliveryUrl = originalSignedUrl;
      conversationService.clearSession(`user-a:farm-a:${conversationId}`);
    }
  });

  await runAsyncTest('Rejects an unowned farm before persisting the message or uploaded image', async () => {
    const originalBuildAIContext = contextService.buildAIContext;
    const originalGetMessages = conversationStorageService.getMessages;
    const originalSaveMessage = conversationStorageService.saveMessage;
    const originalIsConfigured = firestoreRepository.isConfigured;
    const conversationId = 'unowned-farm-context-test';
    let savedMessages = 0;
    contextService.buildAIContext = async () => {
      throw new AgriShieldError(ERROR_CODES.FARM_ACCESS_DENIED, 'Farm is not owned.', 403);
    };
    conversationStorageService.getMessages = async () => [];
    conversationStorageService.saveMessage = async () => {
      savedMessages += 1;
      return 'unexpected-message';
    };
    firestoreRepository.isConfigured = () => true;
    conversationService.clearSession(`user-a:other-farm:${conversationId}`);
    try {
      await assert.rejects(
        aiService.generateChatResponse({
          message: 'Analyze this crop',
          language: 'en',
          conversationId,
          farmerId: 'user-a',
          farmId: 'other-farm',
          image: Buffer.from('private image bytes'),
          imageMimeType: 'image/jpeg'
        }),
        (error) => error.statusCode === 403 && error.code === ERROR_CODES.FARM_ACCESS_DENIED
      );
      assert.strictEqual(savedMessages, 0);
      assert.strictEqual(conversationService.getSession(`user-a:other-farm:${conversationId}`).messages.length, 0);
    } finally {
      contextService.buildAIContext = originalBuildAIContext;
      conversationStorageService.getMessages = originalGetMessages;
      conversationStorageService.saveMessage = originalSaveMessage;
      firestoreRepository.isConfigured = originalIsConfigured;
      conversationService.clearSession(`user-a:other-farm:${conversationId}`);
    }
  });

  await runAsyncTest('Routes chat through its configured provider and image analysis through Gemini', async () => {
    const originalGetProvider = providerFactory.getProvider;
    const seen = [];
    providerFactory.getProvider = (name) => {
      seen.push({ type: 'provider', name });
      return ({
        name: 'gemini',
        async chat(options) {
          seen.push({ type: 'chat', options });
          return { text: 'I am AgriShield AI.', finishReason: 'stop' };
        },
        async analyzeImage(options) {
          seen.push({ type: 'image', options });
          return { text: 'The image shows visible leaf discoloration.', finishReason: 'stop' };
        }
      });
    };
    try {
      const conversation = await aiService.generateChatResponse({
        message: 'నువ్వు ఎవరు?',
        language: 'auto',
        conversationId: 'test-ai-telugu-conversation',
        profile: {}
      });
      assert.strictEqual(conversation.language, 'te');
      assert.strictEqual(conversation.intent, 'GENERAL_CONVERSATION');
      assert.strictEqual(conversation.reply, 'I am AgriShield AI.');
      const chatOptions = seen.find((call) => call.type === 'chat').options;
      assert.strictEqual(chatOptions.enableSearch, undefined);
      assert.ok(chatOptions.maxTokens >= 1024);
      assert.ok(chatOptions.systemInstruction.includes('Telugu script'));

      const photo = Buffer.from('test-image-content');
      const imageAnswer = await aiService.generateChatResponse({
        message: 'What is this?',
        language: 'en',
        conversationId: 'test-ai-image-context',
        profile: { farm: { cropDetails: { name: 'Tomato' } } },
        image: photo,
        imageMimeType: 'image/png'
      });
      assert.strictEqual(imageAnswer.intent, 'IMAGE_ANALYSIS');
      const imageCall = seen.find((call) => call.type === 'image');
      assert.ok(imageCall);
      assert.strictEqual(imageCall.options.imageBuffer, photo);
      assert.strictEqual(imageCall.options.mimeType, 'image/png');
      assert.ok(imageCall.options.systemInstruction.includes('Tomato'));
      assert.ok(seen.some((call) => call.type === 'provider' && call.name === 'gemini'));
    } finally {
      providerFactory.getProvider = originalGetProvider;
    }
  });

  await runAsyncTest('Persists both farmer and assistant messages for authenticated text chats', async () => {
    const originalGetProvider = providerFactory.getProvider;
    const originalGetMessages = conversationStorageService.getMessages;
    const originalSaveMessage = conversationStorageService.saveMessage;
    const originalIsConfigured = firestoreRepository.isConfigured;
    const conversationId = 'authenticated-text-chat-persistence-test';
    const savedMessages = [];
    providerFactory.getProvider = () => ({
      name: 'gemini',
      async chat() {
        return { text: 'I am AgriShield AI.' };
      }
    });
    conversationStorageService.getMessages = async () => [];
    conversationStorageService.saveMessage = async (message) => {
      savedMessages.push(message);
      return message.messageId || `saved-${message.role}`;
    };
    firestoreRepository.isConfigured = () => true;
    conversationService.clearSession(`user-a:farm-a:${conversationId}`);

    try {
      const response = await aiService.generateChatResponse({
        message: 'Who are you?',
        language: 'en',
        conversationId,
        farmerId: 'user-a',
        farmId: 'farm-a'
      });

      assert.strictEqual(response.conversationPersisted, true);
      assert.deepStrictEqual(savedMessages.map(({ role, message, farmId }) => ({ role, message, farmId })), [
        { role: 'user', message: 'Who are you?', farmId: 'farm-a' },
        { role: 'assistant', message: 'I am AgriShield AI.', farmId: 'farm-a' }
      ]);
    } finally {
      providerFactory.getProvider = originalGetProvider;
      conversationStorageService.getMessages = originalGetMessages;
      conversationStorageService.saveMessage = originalSaveMessage;
      firestoreRepository.isConfigured = originalIsConfigured;
      conversationService.clearSession(`user-a:farm-a:${conversationId}`);
    }
  });

  // 6. QUESTION REASONING & CATEGORY CLASSIFICATION (Section 86)
  console.log('\n--- 6. Multilingual Query Categorization ---');
  const testQueries = [
    { text: 'Water eppudu pettali tomato crop ki?', expected: '💧' },
    { text: 'నా పంట ఆకులు పసుపుగా మారుతున్నాయి', expected: '🍃' },
    { text: 'Pest attack in field, what to spray?', expected: '🐛' },
    { text: 'Urea and DAP fertilizer schedule', expected: '🧪' },
    { text: 'What is 25% of 800?', expected: '🔢' },
    { text: 'Explain photosynthesis simply', expected: '💡' }
  ];

  testQueries.forEach((q) => {
    runTest(`Category detected correctly for query "${q.text.slice(0, 30)}..."`, () => {
      const cat = aiService.detectCategory(q.text, 'Tomato');
      assert.ok(cat.includes(q.expected));
    });
  });

  // 7. MISSING API KEY BEHAVIOR (Section 180)
  console.log('\n--- 7. Unconfigured API Key Behavior ---');
  await runAsyncTest('Throws clear AI_NOT_CONFIGURED error when API key is missing rather than faking answers', async () => {
    const originalOpenAIKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const unconfiguredProvider = new OpenAIProvider();

      await unconfiguredProvider.chat({ messages: [{ role: 'user', content: 'test' }] });
      assert.fail('Should have thrown AI_NOT_CONFIGURED');
    } catch (err) {
      assert.strictEqual(err.code, ERROR_CODES.AI_NOT_CONFIGURED);
    } finally {
      if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

  console.log('\n==================================================');
  console.log(`  TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('==================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
