import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInternationalPhone } from '../src/services/internationalPhone.js';

test('normalizes Indian phone number to E.164', () => {
  assert.equal(normalizeInternationalPhone('+91', '9177487782'), '+919177487782');
});

test('normalizes international phone numbers without replacing their country code', () => {
  assert.equal(normalizeInternationalPhone('+1', '(415) 555-2671'), '+14155552671');
  assert.equal(normalizeInternationalPhone('44', '7911 123456'), '+447911123456');
});

test('rejects malformed or out-of-range E.164 numbers', () => {
  assert.equal(normalizeInternationalPhone('', '9177487782'), null);
  assert.equal(normalizeInternationalPhone('+91', '123'), null);
  assert.equal(normalizeInternationalPhone('+1234', '123456789012'), null);
});
