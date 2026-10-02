/**
 * AgriShield-AI Test Suite (Section 85, 86, 87, 88, 200, 201)
 * Validates conversational context, multilingual handling, error codes,
 * image validations, speech and TTS services, and prompt integrity.
 */

const assert = require('assert');
const crypto = require('crypto');
const { aiService } = require('../services/aiService');
const conversationService = require('../services/conversationService');
const providerFactory = require('../services/ai/providerFactory');
const speechService = require('../services/speechService');
const ttsService = require('../services/ttsService');
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');
const { ALLOWED_IMAGE_TYPES, ALLOWED_AUDIO_TYPES, imageMatchesMime } = require('../middleware/validation');
const { normalizeFarmBoundary } = require('../utils/farmGeometry');
const { detectLanguage, detectIntent } = require('../services/ai/languageIntent');
const { normalizeSpeechText } = require('../services/ttsService');
const { getFarmEnvironmentState } = require('../services/farmTwinService');
const OpenAIProvider = require('../services/ai/openaiProvider');
const localStorageService = require('../services/storage/localStorageService');
const {
  firebaseAdminConfigured,
  getFirebaseAdminConfigurationError,
  firestoreConfigured
} = require('../services/firebaseAdmin');
const weatherService = require('../services/weatherService');
const { buildFarmContext } = require('../services/contextService');
const { buildCropSchedule, cropKey, parseDateOnly } = require('../services/cropScheduleService');
const { filterProducts, normalizeCategory } = require('../services/shopCatalogService');

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
      data: () => value ? { ...value } : undefined
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
        const ref = {
          id: documentId,
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
        return ref;
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
  runTest('Provider factory defaults to the local Ollama provider', () => {
    const provider = providerFactory.getProvider();
    assert.strictEqual(provider.name, 'ollama');
  });

  runTest('Provider factory keeps OpenAI available when requested', () => {
    const provider = providerFactory.getProvider('openai');
    assert.strictEqual(provider.name, 'openai');
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
    const database = createFirestoreMock();
    const repository = new FirestoreRepository({
      getFirestoreInstance: () => database,
      isConfigured: () => true,
      fieldValue: { serverTimestamp: () => new Date('2025-01-01T00:00:00.000Z') }
    });

    assert.deepStrictEqual(await repository.checkHealth(), { configured: true, connected: true });
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
      isConfigured: () => true
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
    assert.strictEqual((await repository.getFarmForUser('firebase-user')).farmLocation.latitude, 17);
    assert.strictEqual((await repository.getFarmerFarms('firebase-user')).length, 1);

    await repository.createAIConversation({ userId: 'firebase-user', conversationId: 'chat/one', farmId: 'farm-1' });
    await repository.appendAIMessage({
      userId: 'firebase-user',
      conversationId: 'chat/one',
      message: { role: 'user', message: 'Hello', language: 'en' }
    });
    const conversation = await repository.getAIConversationHistory('firebase-user', 'chat/one');
    assert.strictEqual(conversation.farmId, 'farm-1');
    assert.strictEqual(conversation.messages[0].message, 'Hello');
    assert.strictEqual(await repository.getAIConversationHistory('another-user', 'chat/one'), null);

    for (let index = 0; index < 40; index++) {
      await repository.appendAIMessage({
        userId: 'firebase-user',
        conversationId: 'large-chat',
        message: { role: 'user', message: '農'.repeat(8000) }
      });
    }
    const boundedConversation = await repository.getAIConversationHistory('firebase-user', 'large-chat');
    assert.ok(boundedConversation.messages.length < 40);
    assert.ok(Buffer.byteLength(JSON.stringify(boundedConversation.messages), 'utf8') <= 700 * 1024);

    const notificationId = await repository.createNotification({
      userId: 'firebase-user',
      type: 'weather',
      title: 'Weather update',
      message: 'Rain expected'
    });
    await database.collection('notifications').doc('newer-notification').set({
      userId: 'firebase-user',
      type: 'farm',
      title: 'Farm update',
      message: 'Farm profile saved',
      severity: 'info',
      read: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    });
    const farmerNotifications = await repository.getUserNotifications('firebase-user');
    assert.strictEqual(farmerNotifications[0]._id, 'newer-notification');
    assert.ok(farmerNotifications.some((notification) => notification._id === notificationId));
    assert.deepStrictEqual(await repository.getUserNotifications('other-user'), []);
    assert.strictEqual(await repository.markNotificationAsRead('other-user', notificationId), false);
    assert.strictEqual(await repository.markNotificationAsRead('firebase-user', notificationId), true);
    assert.strictEqual(
      (await repository.getUserNotifications('firebase-user'))
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

    await database.collection('products').doc('fertilizer-1').set({
      productName: 'Urea',
      category: 'fertilizer',
      crops: ['Cotton'],
      suitableStages: ['Tillering'],
      active: true
    });
    await database.collection('products').doc('inactive-seed').set({
      productName: 'Seed',
      category: 'seed',
      active: false
    });
    assert.strictEqual((await repository.getActiveProducts()).length, 1);
    assert.strictEqual(await repository.getActiveProduct('inactive-seed'), null);

    await database.collection('aiConversations').doc('owned-conversation').set({
      userId: 'firebase-user',
      conversationId: 'owned'
    });
    await database.collection('aiConversations').doc('another-conversation').set({
      userId: 'another-user',
      conversationId: 'private'
    });
    await database.collection('supportTickets').doc('owned-ticket').set({
      farmerId: 'firebase-user',
      attachmentPath: '/uploads/support/owned-file.png'
    });
    const deletionPlan = await repository.getAccountDataDeletionPlan('firebase-user');
    assert.ok(deletionPlan.attachments.includes('/uploads/support/owned-file.png'));
    const deletedDocuments = await repository.deleteAccountData(deletionPlan);
    assert.ok(deletedDocuments >= 5);
    assert.strictEqual(await repository.getUser('firebase-user'), null);
    assert.strictEqual(await database.collection('aiConversations').doc('owned-conversation').get().then((snapshot) => snapshot.exists), false);
    assert.strictEqual(await database.collection('aiConversations').doc('another-conversation').get().then((snapshot) => snapshot.exists), true);
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

  runTest('Firebase Admin and Firestore require valid service credentials or configured emulators', () => {
    assert.strictEqual(firebaseAdminConfigured({}), false);
    assert.strictEqual(firestoreConfigured({}), false);
    assert.strictEqual(
      getFirebaseAdminConfigurationError({ FIREBASE_PROJECT_ID: 'project', FIREBASE_CLIENT_EMAIL: 'service@example.invalid', FIREBASE_PRIVATE_KEY: 'invalid' }),
      'FIREBASE_PRIVATE_KEY_INVALID'
    );
    assert.strictEqual(
      getFirebaseAdminConfigurationError({ FIREBASE_PROJECT_ID: 'project', FIREBASE_CLIENT_EMAIL: 'service@example.invalid' }),
      'FIREBASE_PRIVATE_KEY_MISSING'
    );
    const privateKey = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    }).privateKey;
    assert.strictEqual(firebaseAdminConfigured({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
      FIREBASE_PRIVATE_KEY: privateKey
    }), true);
    assert.strictEqual(getFirebaseAdminConfigurationError({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
      FIREBASE_PRIVATE_KEY: privateKey
    }), null);
    assert.strictEqual(firestoreConfigured({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
      FIREBASE_PRIVATE_KEY: privateKey
    }), true);
    assert.strictEqual(firebaseAdminConfigured({
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
      FIREBASE_PRIVATE_KEY: 'private-key'
    }), false);
    assert.strictEqual(firebaseAdminConfigured({
      NODE_ENV: 'development',
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
    }), true);
    assert.strictEqual(firestoreConfigured({
      NODE_ENV: 'development',
      FIREBASE_PROJECT_ID: 'project',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
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

  // 5. TTS CACHE & LOCAL SYNTHESIS (Section 19, 20, 142)
  console.log('\n--- 5. Text-To-Speech Synthesis Service ---');
  await runAsyncTest('TTS service generates speech parameters and caches', async () => {
    const res1 = await ttsService.synthesize({ text: 'నా పంటకు నీరు ఎప్పుడు పెట్టాలి', language: 'te' });
    assert.strictEqual(res1.voiceLocale, 'te-IN');
    assert.strictEqual(res1.language, 'te');

    const res2 = await ttsService.synthesize({ text: 'मेरी फसल में खाद कब डालें', language: 'hi' });
    assert.strictEqual(res2.voiceLocale, 'hi-IN');
  });

  runTest('Normalizes units into Telugu, Hindi, and English spoken forms', () => {
    assert.ok(normalizeSpeechText('29°C, 62%, 620 lux, 5 acres, 2.5 hectares', 'te').includes('డిగ్రీల సెల్సియస్'));
    assert.ok(normalizeSpeechText('29°C, 62%, 620 lux, 5 acres, 2.5 hectares', 'te').includes('శాతం'));
    assert.ok(normalizeSpeechText('29°C, 62%, 620 lux, 5 acres, 2.5 hectares', 'hi').includes('डिग्री सेल्सियस'));
    assert.ok(normalizeSpeechText('29°C, 62%, 620 lux, 5 acres, 2.5 hectares', 'hi').includes('प्रतिशत'));
    assert.ok(normalizeSpeechText('29°C and 62%', 'en').includes('degrees Celsius'));
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

  await runAsyncTest('Uses Open-Meteo for saved farm coordinates without provider credentials', async () => {
    const originalFetch = global.fetch;
    let requestUrl;
    global.fetch = async (input) => {
      requestUrl = new URL(input);
      return {
        ok: true,
        async json() {
          return {
            current: {
              time: new Date().toISOString(),
              temperature_2m: 30,
              relative_humidity_2m: 65,
              precipitation: 0,
              rain: 0,
              showers: 0,
              weather_code: 1,
              cloud_cover: 20,
              wind_speed_10m: 8
            },
            daily: {}
          };
        }
      };
    };
    try {
      const result = await weatherService.getCurrentWeather({ latitude: 29.94, longitude: 41.01 });
      assert.strictEqual(requestUrl.hostname, 'api.open-meteo.com');
      assert.strictEqual(requestUrl.pathname, '/v1/forecast');
      assert.strictEqual(requestUrl.searchParams.get('latitude'), '29.94');
      assert.strictEqual(requestUrl.searchParams.get('longitude'), '41.01');
      assert.strictEqual(result.available, true);
      assert.strictEqual(result.provider, 'Open-Meteo');
      assert.strictEqual(result.data.temperatureC, 30);
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

  await runAsyncTest('Routes conversational and image requests through the configured provider with detected language', async () => {
    const originalGetProvider = providerFactory.getProvider;
    const seen = [];
    providerFactory.getProvider = () => ({
      name: 'test-provider',
      async chat(options) {
        seen.push({ type: 'chat', options });
        return { text: 'I am AgriShield AI.', finishReason: 'stop' };
      },
      async analyzeImage(options) {
        seen.push({ type: 'image', options });
        return { text: 'The image shows visible leaf discoloration.', finishReason: 'stop' };
      }
    });
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
      assert.strictEqual(seen[0].options.enableSearch, undefined);

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
      assert.strictEqual(seen[1].type, 'image');
      assert.strictEqual(seen[1].options.imageBuffer, photo);
      assert.strictEqual(seen[1].options.mimeType, 'image/png');
      assert.ok(seen[1].options.systemInstruction.includes('Tomato'));
    } finally {
      providerFactory.getProvider = originalGetProvider;
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
