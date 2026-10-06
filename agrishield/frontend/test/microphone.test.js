import assert from 'node:assert/strict';
import test from 'node:test';
import { requestMicrophoneAccess } from '../src/services/microphone.js';

test('a denied Permissions API hint does not block an allowed getUserMedia request', async () => {
  let requested = false;
  const stream = { id: 'live-stream' };
  const result = await requestMicrophoneAccess({
    permissions: { async query() { return { state: 'denied' }; } },
    mediaDevices: {
      async getUserMedia(constraints) {
        requested = true;
        assert.deepEqual(constraints, { audio: true });
        return stream;
      }
    }
  });
  assert.equal(requested, true);
  assert.equal(result.stream, stream);
  assert.equal(result.permissionState, 'denied');
});

test('actual microphone denial is returned to the caller for localized handling', async () => {
  const denied = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  await assert.rejects(
    () => requestMicrophoneAccess({
      permissions: { async query() { return { state: 'granted' }; } },
      mediaDevices: { async getUserMedia() { throw denied; } }
    }),
    (error) => error === denied && error.name === 'NotAllowedError'
  );
});

test('missing microphone APIs produce an explicit unavailable error', async () => {
  await assert.rejects(
    () => requestMicrophoneAccess({ mediaDevices: {}, permissions: {} }),
    (error) => error.code === 'MICROPHONE_UNAVAILABLE'
  );
});
