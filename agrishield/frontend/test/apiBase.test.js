import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBase } from '../src/services/apiBase.js';

test('requires an explicitly configured API URL', () => {
  assert.throws(
    () => resolveApiBase('', true),
    (error) => error.code === 'API_CONFIG_MISSING'
  );
});

test('accepts a public HTTPS API URL in production and strips trailing slashes', () => {
  assert.equal(
    resolveApiBase('https://api.example.invalid/api///', true),
    'https://api.example.invalid/api'
  );
});

test('rejects insecure or local production API URLs', () => {
  for (const url of ['http://api.example.invalid/api', 'http://localhost:5000/api', 'https://127.0.0.1/api']) {
    assert.throws(() => resolveApiBase(url, true), (error) => error.code === 'HTTPS_REQUIRED');
  }
});

test('allows local HTTP API URLs only outside production', () => {
  assert.equal(resolveApiBase('http://localhost:5000/api', false), 'http://localhost:5000/api');
  assert.throws(
    () => resolveApiBase('ftp://api.example.invalid/api', false),
    (error) => error.code === 'API_CONFIG_INVALID'
  );
});
