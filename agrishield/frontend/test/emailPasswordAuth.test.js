import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const loginSource = fs.readFileSync(path.resolve(__dirname, '../src/pages/Login.jsx'), 'utf8');

test('1. Login UI contains email and password input elements', () => {
  assert.match(loginSource, /type="email"/);
  assert.match(loginSource, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(loginSource, /signInWithEmailAndPassword/);
  assert.match(loginSource, /handleLogin/);
});

test('2. Create Account contains email, password, and confirm password fields', () => {
  assert.match(loginSource, /placeholder="Re-enter your password"/);
  assert.match(loginSource, /type=\{showConfirmPassword \? 'text' : 'password'\}/);
  assert.match(loginSource, /createUserWithEmailAndPassword/);
  assert.match(loginSource, /handleCreateAccount/);
  assert.match(loginSource, /confirmPassword/);
});

test('3. Forgot Password exists and triggers password reset', () => {
  assert.match(loginSource, /sendPasswordResetEmail/);
  assert.match(loginSource, /handleForgotPassword/);
  assert.match(loginSource, /Send Password Reset Link/);
  assert.match(loginSource, /Forgot Password\?/);
  assert.match(loginSource, /mode === 'forgot'/);
});

test('4. OTP UI elements and modals are absent from authentication', () => {
  assert.strictEqual(loginSource.includes('PhoneOtpModal'), false);
  assert.strictEqual(loginSource.includes('verificationCode'), false);
  assert.strictEqual(loginSource.includes('resendCode'), false);
  assert.strictEqual(loginSource.includes('otp-input'), false);
  assert.strictEqual(loginSource.includes('recaptcha'), false);
});

test('5. OTP service calls and phone OTP workflows are absent', () => {
  assert.strictEqual(loginSource.includes('startPhoneOtp'), false);
  assert.strictEqual(loginSource.includes('verifyPhoneOtp'), false);
  assert.strictEqual(loginSource.includes('resendPhoneOtp'), false);
  assert.strictEqual(loginSource.includes('PhoneOtpService'), false);
  assert.strictEqual(loginSource.includes('phoneOtpFlow'), false);
  assert.strictEqual(loginSource.includes('phoneOtpMessages'), false);
});
