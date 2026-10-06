import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFirebaseAuthErrorMessage,
  getPasswordResetErrorMessage,
  isValidEmail,
  validatePassword,
  validatePasswordMatch
} from '../src/services/firebaseAuthErrors.js';

test('6. Password mismatch validation rejects non-matching passwords', () => {
  const password = 'SecretPassword123';
  const confirmPassword = 'DifferentPassword456';
  assert.notStrictEqual(password, confirmPassword);

  assert.strictEqual(validatePasswordMatch(password, confirmPassword), 'Passwords do not match.');
  assert.strictEqual(validatePasswordMatch(password, password), null);
});

test('7. Invalid email validation correctly rejects malformed emails and accepts valid ones', () => {
  assert.strictEqual(isValidEmail('farmer@example.com'), true);
  assert.strictEqual(isValidEmail('user.name+tag@subdomain.example.org'), true);
  assert.strictEqual(isValidEmail('not-an-email'), false);
  assert.strictEqual(isValidEmail('farmer@'), false);
  assert.strictEqual(isValidEmail('@example.com'), false);
  assert.strictEqual(isValidEmail(''), false);
  assert.strictEqual(isValidEmail(null), false);
  assert.strictEqual(isValidEmail(undefined), false);
});

test('8. Password minimum length validation enforces at least 8 characters', () => {
  assert.strictEqual(validatePassword('1234567'), 'Password must contain at least 8 characters.');
  assert.strictEqual(validatePassword(''), 'Password must contain at least 8 characters.');
  assert.strictEqual(validatePassword(null), 'Password must contain at least 8 characters.');
  assert.strictEqual(validatePassword('12345678'), null);
  assert.strictEqual(validatePassword('SecurePassword2026!'), null);
});

test('Firebase auth error messages map known authentication errors correctly', () => {
  assert.strictEqual(getFirebaseAuthErrorMessage({ code: 'auth/invalid-credential' }), 'Incorrect email or password.');
  assert.strictEqual(getFirebaseAuthErrorMessage({ code: 'auth/user-not-found' }), 'Incorrect email or password.');
  assert.strictEqual(getFirebaseAuthErrorMessage({ code: 'auth/wrong-password' }), 'Incorrect email or password.');
  assert.strictEqual(getFirebaseAuthErrorMessage({ code: 'auth/email-already-in-use' }), 'An account already exists with this email.');
  assert.strictEqual(getFirebaseAuthErrorMessage({ code: 'auth/weak-password' }), 'Password is too weak. Use at least 8 characters.');
  assert.strictEqual(getFirebaseAuthErrorMessage({ code: 'auth/invalid-email' }), 'Please enter a valid email address.');
  assert.strictEqual(getPasswordResetErrorMessage({ code: 'auth/user-not-found' }), 'No account was found with this email.');
  assert.strictEqual(getPasswordResetErrorMessage({ code: 'auth/invalid-email' }), 'Please enter a valid email address.');
});
