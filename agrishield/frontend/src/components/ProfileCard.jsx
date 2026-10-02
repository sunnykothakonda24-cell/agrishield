import React, { useEffect, useState, useRef } from 'react';
import { PhoneAuthProvider, RecaptchaVerifier, updatePhoneNumber } from 'firebase/auth';
import { 
  User, 
  Phone, 
  CheckCircle, 
  Shield, 
  Edit3, 
  ArrowRight, 
  KeyRound, 
  RefreshCw, 
  AlertCircle, 
  X,
  Smartphone,
  Sparkles
} from 'lucide-react';
import { updateMobileNumber } from '../services/api';
import { getFirebaseAuthErrorMessage, logFirebaseAuthError } from '../services/firebaseAuthErrors';
import { getFirebaseAuth } from '../services/firebase';

export default function ProfileCard({ 
  farmerName = '', 
  setFarmerName, 
  mobile = '', 
  setMobile,
  userId = null, 
  productId = null, 
  onNext 
}) {
  // Name field starts completely EMPTY if not yet entered (Requirements 1, 2)
  const [nameInput, setNameInput] = useState(farmerName || '');
  const [errorMsg, setErrorMsg] = useState('');

  // Mobile Editing OTP Flow state
  const [showMobileModal, setShowMobileModal] = useState(false);
  const [newMobile, setNewMobile] = useState('');
  const [otpStage, setOtpStage] = useState('input'); // 'input' | 'otp'
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpSuccess, setOtpSuccess] = useState('');
  const otpInputRefs = useRef([]);
  const captchaVerifierRef = useRef(null);
  const captchaContainerRef = useRef(null);
  const verificationIdRef = useRef(null);
  const otpRequestInFlightRef = useRef(false);

  useEffect(() => () => {
    captchaVerifierRef.current?.clear();
    captchaVerifierRef.current = null;
    verificationIdRef.current = null;
  }, []);

  const isValidName = nameInput.trim().length >= 2;

  const handleContinue = (e) => {
    e?.preventDefault();
    if (!isValidName) {
      setErrorMsg('Please enter your full name to proceed.');
      return;
    }
    setErrorMsg('');
    setFarmerName(nameInput.trim());
    onNext();
  };

  // Mobile OTP Handlers
  const handleOpenMobileModal = () => {
    captchaVerifierRef.current?.clear();
    captchaVerifierRef.current = null;
    verificationIdRef.current = null;
    setNewMobile('');
    setOtpStage('input');
    setOtpDigits(['', '', '', '', '', '']);
    setOtpError('');
    setOtpSuccess('');
    setShowMobileModal(true);
  };

  const handleCloseMobileModal = () => {
    captchaVerifierRef.current?.clear();
    captchaVerifierRef.current = null;
    verificationIdRef.current = null;
    setShowMobileModal(false);
  };

  const handleSendOtp = async (e) => {
    e?.preventDefault();
    if (otpRequestInFlightRef.current) return;
    const cleaned = newMobile.trim().replace(/\D/g, '');
    if (cleaned.length !== 10) {
      setOtpError('Please enter a valid 10-digit mobile number');
      return;
    }
    if (mobile && cleaned === mobile.replace(/\D/g, '').slice(-10)) {
      setOtpError('New mobile number must be different from current registered number');
      return;
    }

    setOtpError('');
    setOtpSuccess('');
    otpRequestInFlightRef.current = true;
    setOtpLoading(true);

    try {
      const auth = getFirebaseAuth();
      if (!auth.currentUser) throw new Error('Sign in again before changing your verified mobile number.');
      if (!captchaContainerRef.current) {
        throw new Error('The phone verification security check is not ready. Please try again.');
      }
      captchaVerifierRef.current = new RecaptchaVerifier(auth, captchaContainerRef.current, { size: 'invisible' });
      verificationIdRef.current = await new PhoneAuthProvider(auth)
        .verifyPhoneNumber(`+91${cleaned}`, captchaVerifierRef.current);
      setOtpStage('otp');
      setOtpSuccess(`Verification code sent to +91 ${cleaned}`);
    } catch (err) {
      logFirebaseAuthError(err, 'Mobile OTP send');
      captchaVerifierRef.current?.clear();
      captchaVerifierRef.current = null;
      verificationIdRef.current = null;
      setOtpError(getFirebaseAuthErrorMessage(err, 'Failed to send OTP. Please try again.'));
    } finally {
      otpRequestInFlightRef.current = false;
      setOtpLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (isNaN(value)) return;
    const nextOtp = [...otpDigits];
    if (value.length > 1) {
      const chars = value.slice(0, 6).split('');
      chars.forEach((c, i) => {
        if (index + i < 6) nextOtp[index + i] = c;
      });
      setOtpDigits(nextOtp);
      const focusIdx = Math.min(index + chars.length, 5);
      otpInputRefs.current[focusIdx]?.focus();
      return;
    }

    nextOtp[index] = value;
    setOtpDigits(nextOtp);
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyAndUpdateMobile = async (e) => {
    e?.preventDefault();
    if (otpRequestInFlightRef.current) return;
    const otpValue = otpDigits.join('').trim();
    if (otpValue.length < 6) {
      setOtpError('Please enter the complete 6-digit OTP code');
      return;
    }

    setOtpError('');
    otpRequestInFlightRef.current = true;
    setOtpLoading(true);

    try {
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      if (!user || !verificationIdRef.current) {
        throw new Error('The Firebase verification request expired. Send a new code and try again.');
      }
      const credential = PhoneAuthProvider.credential(verificationIdRef.current, otpValue);
      await updatePhoneNumber(user, credential);
      await user.getIdToken(true);
      const res = await updateMobileNumber();

      setOtpSuccess('Mobile number updated successfully.');
      if (setMobile) {
        setMobile(res.mobile || `+91${newMobile.trim()}`);
      }
      setTimeout(() => {
        setShowMobileModal(false);
      }, 1400);
    } catch (err) {
      logFirebaseAuthError(err, 'Mobile OTP verification');
      setOtpError(getFirebaseAuthErrorMessage(err, 'The mobile number could not be verified and updated.'));
    } finally {
      otpRequestInFlightRef.current = false;
      setOtpLoading(false);
    }
  };

  return (
    <div className="flow-card premium-card animate-fadeIn">
      {/* Step Badge */}
      <div className="card-header-badge">
        <User size={18} className="badge-icon" />
        <span>Step 1 • Farmer Identification</span>
      </div>

      {/* Required Name Entry Heading & Subheading (Requirement 2) */}
      <div className="name-setup-header">
        <h2 className="step-title">Let's set up your farm</h2>
        <p className="step-subtitle">First, tell us your name.</p>
      </div>

      <form onSubmit={handleContinue} className="name-entry-form">
        <div className="field-group">
          <label className="field-label" htmlFor="farmer-name-input">
            <span>Your Name</span>
          </label>
          <div className="input-with-icon">
            <User size={18} className="input-leading-icon" />
            <input 
              id="farmer-name-input"
              type="text" 
              className="input-field with-icon" 
              value={nameInput} 
              onChange={(e) => {
                setNameInput(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="Enter your name"
              autoFocus
              autoComplete="name"
            />
          </div>
          {errorMsg && (
            <div className="alert-message error animate-fadeIn">
              <AlertCircle size={15} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Mobile Number Verification Info */}
        <div className="field-group mobile-verify-preview">
          <label className="field-label">
            <span>Registered Mobile</span>
            <button 
              type="button" 
              className="btn-text-action" 
              onClick={handleOpenMobileModal}
              title="Edit mobile number with OTP verification"
            >
              <Smartphone size={13} /> Edit Mobile
            </button>
          </label>
          <div className="readonly-display-box verified-box">
            <div className="phone-wrapper">
              <Phone size={16} className="text-muted" />
              <span className="display-value font-mono">{mobile || 'Mobile not set'}</span>
            </div>
            {mobile && (
              <span className="verified-pill">
                <CheckCircle size={14} /> Verified
              </span>
            )}
          </div>
        </div>

        {/* Continue Button (Disabled until valid name entered - Requirement 2) */}
        <div className="step-actions single">
          <button 
            type="submit" 
            className="btn-primary-action large" 
            disabled={!isValidName}
          >
            <span>Continue</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </form>

      {/* OTP Mobile Editing Modal */}
      {showMobileModal && (
        <div className="modal-backdrop animate-fadeIn">
          <div className="modal-dialog-box animate-scaleUp">
            <div className="modal-header-row">
              <div className="title-with-icon">
                <Smartphone size={20} color="#10b981" />
                <h3 className="modal-title">Edit Mobile Number</h3>
              </div>
              <button 
                type="button" 
                className="btn-close-modal" 
                onClick={handleCloseMobileModal}
                disabled={otpLoading}
              >
                <X size={18} />
              </button>
            </div>

            <p className="modal-description">
              {otpStage === 'input' 
                ? 'Enter your new 10-digit mobile number to receive a secure verification code.'
                : `Enter the 6-digit OTP code sent to +91 ${newMobile} to confirm your mobile number.`}
            </p>
            <div id="mobile-update-recaptcha" ref={captchaContainerRef} />

            {otpStage === 'input' ? (
              <form onSubmit={handleSendOtp} className="modal-form-flow">
                <div className="input-group">
                  <label className="input-label">New Mobile Number</label>
                  <div className="phone-input-wrapper">
                    <span className="country-code">+91</span>
                    <input 
                      type="tel"
                      className="input-field phone-field"
                      placeholder="98765 43210"
                      value={newMobile}
                      onChange={(e) => setNewMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      disabled={otpLoading}
                      autoFocus
                    />
                  </div>
                </div>

                {otpError && (
                  <div className="alert-message error">
                    <AlertCircle size={15} />
                    <span>{otpError}</span>
                  </div>
                )}

                <div className="modal-actions-row">
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={handleCloseMobileModal}
                    disabled={otpLoading}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary" 
                    disabled={otpLoading || newMobile.length < 10}
                  >
                    {otpLoading ? 'Sending OTP...' : 'Send OTP'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyAndUpdateMobile} className="modal-form-flow">
                <div className="otp-inputs">
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (otpInputRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      className="otp-input"
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      disabled={otpLoading}
                      autoFocus={idx === 0}
                    />
                  ))}
                </div>

                {otpSuccess && (
                  <div className="alert-message success">
                    <CheckCircle size={15} />
                    <span>{otpSuccess}</span>
                  </div>
                )}

                {otpError && (
                  <div className="alert-message error">
                    <AlertCircle size={15} />
                    <span>{otpError}</span>
                  </div>
                )}

                <div className="otp-modal-subactions">
                  <button 
                    type="button" 
                    className="btn-text" 
                    onClick={handleSendOtp}
                    disabled={otpLoading}
                  >
                    <RefreshCw size={13} /> Resend OTP
                  </button>
                  <button 
                    type="button" 
                    className="btn-text secondary" 
                    onClick={() => { setOtpStage('input'); setOtpError(''); }}
                    disabled={otpLoading}
                  >
                    Change Number
                  </button>
                </div>

                <div className="modal-actions-row">
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={handleCloseMobileModal}
                    disabled={otpLoading}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary" 
                    disabled={otpLoading || otpDigits.join('').length < 6}
                  >
                    {otpLoading ? 'Verifying...' : 'Verify & Update Mobile'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
