import React, { useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sprout,
  User
} from 'lucide-react';
import { getFirebaseAuth } from '../services/firebase';
import { getAppPreferences } from '../services/appPreferences';
import { translate } from '../i18n';
import {
  getFirebaseAuthErrorMessage,
  getPasswordResetErrorMessage,
  isValidEmail,
  logFirebaseAuthError
} from '../services/firebaseAuthErrors';

export default function Login({ onLoginSuccess, sessionError = '' }) {
  // mode: 'login' | 'create' | 'forgot'
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(sessionError);
  const [infoMessage, setInfoMessage] = useState('');
  const requestInFlightRef = useRef(false);

  const language = getAppPreferences().language;
  const t = (key, values) => translate(language, key, values);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setInfoMessage('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleLogin = async (event) => {
    event?.preventDefault();
    if (requestInFlightRef.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setError('');
    setInfoMessage('');
    requestInFlightRef.current = true;
    setLoading(true);

    try {
      const auth = getFirebaseAuth();
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      onLoginSuccess?.();
    } catch (err) {
      logFirebaseAuthError(err, 'signInWithEmailAndPassword');
      setError(getFirebaseAuthErrorMessage(err));
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleCreateAccount = async (event) => {
    event?.preventDefault();
    if (requestInFlightRef.current) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setError('Please enter your name.');
      return;
    }
    if (!trimmedEmail) {
      setError('Please enter your email.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setInfoMessage('');
    requestInFlightRef.current = true;
    setLoading(true);

    try {
      const auth = getFirebaseAuth();
      const credential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      if (trimmedName && credential.user) {
        await updateProfile(credential.user, { displayName: trimmedName });
      }
      onLoginSuccess?.();
    } catch (err) {
      logFirebaseAuthError(err, 'createUserWithEmailAndPassword');
      setError(getFirebaseAuthErrorMessage(err));
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleForgotPassword = async (event) => {
    event?.preventDefault();
    if (requestInFlightRef.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setError('');
    setInfoMessage('');
    requestInFlightRef.current = true;
    setLoading(true);

    try {
      const auth = getFirebaseAuth();
      await sendPasswordResetEmail(auth, trimmedEmail);
      setInfoMessage('Password reset email sent. Please check your inbox.');
    } catch (err) {
      logFirebaseAuthError(err, 'sendPasswordResetEmail');
      setError(getPasswordResetErrorMessage(err));
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className={`auth-container auth-shell auth-mode-${mode} animate-slideUp`}>
      <aside className="auth-visual-panel">
        <div className="auth-brand-lockup">
          <span className="auth-brand-mark"><ShieldCheck size={23} /></span>
          <span className="auth-brand-name">AgriShield</span>
        </div>

        <div className="auth-visual-copy">
          <span className="auth-visual-kicker">{t('auth.brandTagline')}</span>
          <h1>{t('auth.visualHeading')}</h1>
          <p>{t('auth.visualDescription')}</p>
        </div>

        <div className="auth-field-art" aria-hidden="true">
          <div className="auth-field-sun" />
          <div className="auth-field-orbit auth-field-orbit-one" />
          <div className="auth-field-orbit auth-field-orbit-two" />
          <div className="auth-field-lines" />
          <span className="auth-field-leaf"><Sprout size={92} strokeWidth={1.1} /></span>
        </div>

        <div className="auth-visual-promises">
          <div className="auth-promise">
            <span><LockKeyhole size={16} /></span>
            <p>{t('auth.promiseSecure')}</p>
          </div>
          <div className="auth-promise">
            <span><CheckCircle size={16} /></span>
            <p>{t('auth.promiseFarm')}</p>
          </div>
        </div>
      </aside>

      <section className="auth-form-panel" aria-label={t('auth.formRegion')}>
        <div className="auth-secure-label"><ShieldCheck size={15} />{t('auth.secureAccess')}</div>

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="auth-form">
            <div className="form-heading-block">
              <h2 className="form-title">{t('auth.loginHeading')}</h2>
              <p className="form-subtitle">{t('auth.loginDescription')}</p>
            </div>

            {infoMessage && (
              <div className="alert-message info" role="status">
                <CheckCircle size={15} /><span>{infoMessage}</span>
              </div>
            )}

            <div className="input-group auth-input-group">
              <label className="input-label" htmlFor="login-email">
                <span>Email</span>
              </label>
              <div className="auth-password-wrapper">
                <input
                  id="login-email"
                  type="email"
                  className="input-field auth-text-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  autoComplete="email"
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div className="input-group auth-input-group">
              <div className="input-label-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="input-label" htmlFor="login-password" style={{ margin: 0 }}>
                  <span>Password</span>
                </label>
                <button
                  type="button"
                  className="btn-text secondary"
                  onClick={() => switchMode('forgot')}
                  disabled={loading}
                  style={{ fontSize: '0.82rem', padding: 0 }}
                >
                  Forgot Password?
                </button>
              </div>
              <div className="auth-password-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field auth-text-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={loading}
                  style={{ width: '100%', paddingRight: '44px' }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={loading}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px'
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="alert-message error" role="alert">
                <AlertCircle size={15} /><span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary auth-submit-button"
              disabled={loading || !email.trim() || !password}
            >
              {loading ? (
                <><div className="loader" />Logging in...</>
              ) : (
                <><span>Login</span><ArrowRight size={18} /></>
              )}
            </button>

            <div className="auth-account-switch">
              <span>Don't have an account?</span>
              <button
                type="button"
                className="btn-text"
                onClick={() => switchMode('create')}
                disabled={loading}
              >
                Create Account
              </button>
            </div>
          </form>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreateAccount} className="auth-form">
            <div className="form-heading-block">
              <h2 className="form-title">Create Account</h2>
              <p className="form-subtitle">Join AgriShield to manage and protect your farms</p>
            </div>

            <div className="input-group auth-input-group">
              <label className="input-label" htmlFor="signup-name">
                <span>Name</span>
              </label>
              <input
                id="signup-name"
                type="text"
                className="input-field auth-text-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                autoComplete="name"
                disabled={loading}
                required
              />
            </div>

            <div className="input-group auth-input-group">
              <label className="input-label" htmlFor="signup-email">
                <span>Email</span>
              </label>
              <input
                id="signup-email"
                type="email"
                className="input-field auth-text-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                autoComplete="email"
                disabled={loading}
                required
              />
            </div>

            <div className="input-group auth-input-group">
              <label className="input-label" htmlFor="signup-password">
                <span>Password</span>
              </label>
              <div className="auth-password-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field auth-text-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  disabled={loading}
                  style={{ width: '100%', paddingRight: '44px' }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={loading}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px'
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="input-group auth-input-group">
              <label className="input-label" htmlFor="signup-confirm-password">
                <span>Confirm Password</span>
              </label>
              <div className="auth-password-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="input-field auth-text-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  disabled={loading}
                  style={{ width: '100%', paddingRight: '44px' }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  disabled={loading}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px'
                  }}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="alert-message error" role="alert">
                <AlertCircle size={15} /><span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary auth-submit-button"
              disabled={loading || !name.trim() || !email.trim() || !password || !confirmPassword}
            >
              {loading ? (
                <><div className="loader" />Creating Account...</>
              ) : (
                <><span>Create Account</span><ArrowRight size={18} /></>
              )}
            </button>

            <div className="auth-account-switch">
              <span>Already have an account?</span>
              <button
                type="button"
                className="btn-text"
                onClick={() => switchMode('login')}
                disabled={loading}
              >
                Login
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="auth-form">
            <div className="form-heading-block">
              <h2 className="form-title">Forgot Password?</h2>
              <p className="form-subtitle">Enter your registered email to receive a password reset link</p>
            </div>

            {infoMessage && (
              <div className="alert-message info" role="status">
                <CheckCircle size={15} /><span>{infoMessage}</span>
              </div>
            )}

            <div className="input-group auth-input-group">
              <label className="input-label" htmlFor="reset-email">
                <span>Email</span>
              </label>
              <input
                id="reset-email"
                type="email"
                className="input-field auth-text-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                autoComplete="email"
                disabled={loading}
                required
              />
            </div>

            {error && (
              <div className="alert-message error" role="alert">
                <AlertCircle size={15} /><span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary auth-submit-button"
              disabled={loading || !email.trim()}
            >
              {loading ? (
                <><div className="loader" />Sending Link...</>
              ) : (
                <><span>Send Password Reset Link</span><Mail size={18} /></>
              )}
            </button>

            <div className="auth-account-switch" style={{ justifyContent: 'center', marginTop: '24px' }}>
              <button
                type="button"
                className="btn-text secondary"
                onClick={() => switchMode('login')}
                disabled={loading}
              >
                <ArrowLeft size={16} /> Back to Login
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
