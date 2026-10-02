import React, { useEffect, useRef, useState } from 'react';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  updateProfile
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  KeyRound,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import { getFirebaseAuthErrorMessage, logFirebaseAuthError, logFirebaseAuthEvent } from '../services/firebaseAuthErrors';
import { getFirebaseAuth } from '../services/firebase';

const emptyOtp = ['', '', '', '', '', ''];

export default function Login({ onLoginSuccess, sessionError = '' }) {
  const [stage, setStage] = useState('phone');
  const [accountMode, setAccountMode] = useState('login');
  const [farmerName, setFarmerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState(emptyOtp);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(sessionError);
  const [infoMessage, setInfoMessage] = useState('');
  const captchaVerifierRef = useRef(null);
  const captchaContainerRef = useRef(null);
  const confirmationResultRef = useRef(null);
  const otpInputRef = useRef(null);
  const requestInFlightRef = useRef(false);

  const clearCaptcha = () => {
    captchaVerifierRef.current?.clear();
    captchaVerifierRef.current = null;
    confirmationResultRef.current = null;
  };

  useEffect(() => () => {
    captchaVerifierRef.current?.clear();
    captchaVerifierRef.current = null;
    confirmationResultRef.current = null;
  }, []);

  const createCaptchaVerifier = (auth) => {
    if (!captchaVerifierRef.current) {
      if (!captchaContainerRef.current) {
        throw new Error('The phone verification security check is not ready. Please try again.');
      }
      logFirebaseAuthEvent('Creating reCAPTCHA verifier');
      captchaVerifierRef.current = new RecaptchaVerifier(auth, captchaContainerRef.current, {
        size: 'invisible'
      });
    }
    return captchaVerifierRef.current;
  };

  const sendPhoneOtp = async (event) => {
    event?.preventDefault();
    if (requestInFlightRef.current) return;
    const cleanedPhone = mobile.replace(/\D/g, '');
    if (cleanedPhone.length !== 10) {
      setError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (accountMode === 'create' && farmerName.trim().length < 2) {
      setError('Enter your name to create an account.');
      return;
    }

    setError('');
    setInfoMessage('');
    requestInFlightRef.current = true;
    setLoading(true);
    try {
      logFirebaseAuthEvent('Initializing phone authentication');
      const auth = getFirebaseAuth();
      clearCaptcha();
      logFirebaseAuthEvent('Requesting phone verification');
      confirmationResultRef.current = await signInWithPhoneNumber(
        auth,
        `+91${cleanedPhone}`,
        createCaptchaVerifier(auth)
      );
      logFirebaseAuthEvent('Verification request succeeded');
      setInfoMessage(`Verification code sent to +91 ${cleanedPhone}.`);
      setStage('otp');
      setOtp(emptyOtp);
      window.setTimeout(() => otpInputRef.current?.focus(), 0);
    } catch (sendError) {
      logFirebaseAuthError(sendError, 'OTP send');
      logFirebaseAuthEvent(`Verification request failed: ${sendError?.code || 'unknown_error'}`);
      clearCaptcha();
      setError(getFirebaseAuthErrorMessage(
        sendError,
        'Could not send a verification code. Check Firebase Phone Authentication and authorized domains.'
      ));
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const verifyPhoneOtp = async (event) => {
    event?.preventDefault();
    if (requestInFlightRef.current) return;
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Enter the complete 6-digit verification code.');
      return;
    }

    setError('');
    requestInFlightRef.current = true;
    setLoading(true);
    try {
      if (!confirmationResultRef.current) {
        throw new Error('The verification request expired. Send a new code and try again.');
      }
      const result = await confirmationResultRef.current.confirm(code);
      const user = result.user;
      logFirebaseAuthEvent('OTP confirmation succeeded');

      if (accountMode === 'create' && farmerName.trim()) {
        await updateProfile(user, { displayName: farmerName.trim() });
      }
      clearCaptcha();
      onLoginSuccess?.();
    } catch (verifyError) {
      logFirebaseAuthError(verifyError, 'OTP verification');
      logFirebaseAuthEvent(`OTP confirmation failed: ${verifyError?.code || 'unknown_error'}`);
      setError(getFirebaseAuthErrorMessage(
        verifyError,
        'The verification code was not accepted. Please try again.'
      ));
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const changeAccountMode = (mode) => {
    clearCaptcha();
    setAccountMode(mode);
    setError('');
    setInfoMessage('');
    setStage('phone');
  };

  return (
    <div className="auth-container animate-slideUp">
      <div className="brand-badge-center">
        <div className="brand-icon-box">
          <ShieldCheck size={28} color="#10b981" />
        </div>
        <h1 className="logo-text">AgriShield-AI</h1>
        <span className="brand-tagline">Smart Farming • Smarter Decisions</span>
      </div>

      <div id="firebase-recaptcha-container" ref={captchaContainerRef} />

      {stage === 'phone' ? (
        <form onSubmit={sendPhoneOtp} className="auth-form">
          <div className="form-heading-block">
            <h2 className="form-title">{accountMode === 'create' ? 'Create your AgriShield-AI account' : 'Farmer Login'}</h2>
            <p className="form-subtitle">
              {accountMode === 'create'
                ? 'Enter your name and mobile number to get started.'
                : 'Sign in securely with a phone verification code.'}
            </p>
          </div>

          {accountMode === 'create' && (
            <div className="input-group">
              <label className="input-label" htmlFor="signup-farmer-name">Farmer Name</label>
              <input
                id="signup-farmer-name"
                type="text"
                className="input-field"
                value={farmerName}
                onChange={(event) => setFarmerName(event.target.value)}
                placeholder="Enter your name"
                autoComplete="name"
                disabled={loading}
                required
              />
            </div>
          )}

          <div className="input-group">
            <label className="input-label" htmlFor="login-mobile">Mobile Number</label>
            <div className="phone-input-wrapper">
              <span className="country-code">+91</span>
              <input
                id="login-mobile"
                type="tel"
                className="input-field phone-field"
                placeholder="98765 43210"
                value={mobile}
                onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 10))}
                disabled={loading}
                autoComplete="tel-national"
                inputMode="numeric"
                required
              />
            </div>
          </div>

          {error && <div className="alert-message error" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}

          <button type="submit" className="btn-primary" disabled={loading || mobile.length !== 10}>
            {loading ? <><div className="loader" /> Sending code...</> : <><span>Send OTP</span><ArrowRight size={18} /></>}
          </button>

          <div className="auth-account-switch">
            {accountMode === 'login' ? (
              <span>New to AgriShield-AI?</span>
            ) : (
              <span>Already have an account?</span>
            )}
            <button
              type="button"
              className="btn-text"
              onClick={() => changeAccountMode(accountMode === 'login' ? 'create' : 'login')}
              disabled={loading}
            >
              {accountMode === 'login' ? 'Create Account' : 'Login'}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={verifyPhoneOtp} className="auth-form">
          <div className="form-heading-block">
            <h2 className="form-title">Verify your number</h2>
            <p className="form-subtitle">Enter the 6-digit code sent to +91 {mobile}.</p>
          </div>

          {infoMessage && <div className="alert-message info" role="status"><CheckCircle size={15} /><span>{infoMessage}</span></div>}

          <label className="input-label" htmlFor="firebase-otp">Verification code</label>
          <input
            id="firebase-otp"
            ref={otpInputRef}
            type="text"
            className="input-field otp-code-field"
            value={otp.join('')}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6).split('').concat(emptyOtp).slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            disabled={loading}
            required
          />
          {error && <div className="alert-message error" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}

          <button type="submit" className="btn-primary" disabled={loading || otp.join('').length !== 6}>
            {loading ? <><div className="loader" /> Verifying...</> : <><KeyRound size={18} /><span>Verify & Continue</span></>}
          </button>
          <div className="otp-footer-actions">
            <button type="button" className="btn-text" onClick={sendPhoneOtp} disabled={loading}>
              <RefreshCw size={14} /> Resend code
            </button>
            <button type="button" className="btn-text secondary" onClick={() => { clearCaptcha(); setStage('phone'); setOtp(emptyOtp); setError(''); }} disabled={loading}>
              <ArrowLeft size={14} /> Change number
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
