import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Dashboard from './pages/Dashboard';
import { getCurrentSession, logoutSession, selectActiveFarm } from './services/api';
import { getFirebaseAuth } from './services/firebase';

const CLEAN_BASELINE_PROFILE = {
  userId: null,
  farmerName: '',
  verifiedMobile: '',
  productId: null,
  farm: {
    location: null,
    boundary: {
      points: [],
      areaAcres: null,
      areaSqMeters: 0,
      perimeterMeters: 0,
      lengthMeters: 0,
      widthMeters: 0
    },
    crop: null,
    variety: null,
    stage: null,
    plantingDate: null,
    harvestDate: null,
    soilType: null,
    waterSource: null
  }
};

function App() {
  // Persisted stage: 'login' | 'profile' | 'dashboard'
  const [stage, setStage] = useState('checking');
  const [sessionError, setSessionError] = useState('');
  const [sessionErrorCode, setSessionErrorCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [profile, setProfile] = useState(CLEAN_BASELINE_PROFILE);
  const [farmTransitionError, setFarmTransitionError] = useState('');
  const [createNewFarm, setCreateNewFarm] = useState(false);
  const firebaseAuthRef = useRef(null);

  useEffect(() => {
    let active = true;
    let syncGeneration = 0;
    let unsubscribe = () => {};

    const restoreFirebaseAccount = async (firebaseUser) => {
      const generation = ++syncGeneration;
      if (!firebaseUser) {
        setProfile(CLEAN_BASELINE_PROFILE);
        setMobile('');
        setSessionError('');
        setSessionErrorCode('');
        setStage('login');
        return;
      }

      setStage('checking');
      setSessionError('');
      setSessionErrorCode('');
      try {
        const serverProfile = await getCurrentSession(firebaseUser.displayName || '');
        if (!active || generation !== syncGeneration) return;
        const restored = {
          ...CLEAN_BASELINE_PROFILE,
          ...serverProfile,
          farm: { ...CLEAN_BASELINE_PROFILE.farm, ...serverProfile.farm }
        };
        setProfile(restored);
        setFarmTransitionError('');
        setCreateNewFarm(false);
        setMobile(firebaseUser.phoneNumber || restored.verifiedMobile || '');
        const hasSavedBoundary = (restored.farm?.boundary?.points?.length || restored.farm?.farmBoundary?.length || 0) >= 3;
        setStage(restored.farmerName && hasSavedBoundary ? 'dashboard' : 'profile');
      } catch (error) {
        if (!active || generation !== syncGeneration) return;
        console.warn('[AgriShield App] Firebase account synchronization failed.', {
          code: error.code || 'ACCOUNT_SYNC_FAILED',
          status: error.status || null
        });
        setSessionError(error.message || 'Some farm data could not be loaded. Check your connection and retry.');
        setSessionErrorCode(error.code || 'ACCOUNT_SYNC_FAILED');
        setStage('account-error');
      }
    };

    try {
      const auth = getFirebaseAuth();
      firebaseAuthRef.current = auth;
      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        void restoreFirebaseAccount(firebaseUser);
      }, (error) => {
        if (!active) return;
        setSessionError(error.message || 'Firebase authentication could not be initialized.');
        setSessionErrorCode('FIREBASE_AUTH_INITIALIZATION_FAILED');
        setStage('login');
      });
    } catch (error) {
      setSessionError(error.message || 'Firebase authentication could not be initialized.');
      setSessionErrorCode('FIREBASE_AUTH_INITIALIZATION_FAILED');
      setStage('login');
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleLoginSuccess = () => {
    setStage('checking');
  };

  const handleProfileComplete = (savedProfile) => {
    const restored = {
      ...CLEAN_BASELINE_PROFILE,
      ...savedProfile,
      farm: { ...CLEAN_BASELINE_PROFILE.farm, ...savedProfile.farm }
    };
    setProfile(restored);
    setCreateNewFarm(false);
    setStage('dashboard');
  };

  const handleFarmSwitch = async (farmId) => {
    if (!farmId || farmId === profile.activeFarmId) return;
    setFarmTransitionError('');
    setStage('farm-transition');
    try {
      const selectedProfile = await selectActiveFarm(farmId);
      const restored = {
        ...CLEAN_BASELINE_PROFILE,
        ...selectedProfile,
        farm: { ...CLEAN_BASELINE_PROFILE.farm, ...selectedProfile.farm }
      };
      setProfile(restored);
      setMobile(restored.verifiedMobile || mobile);
      setStage('dashboard');
    } catch (error) {
      setFarmTransitionError(error.message || 'The selected farm could not be loaded.');
      setStage('dashboard');
    }
  };

  const handleLogout = async () => {
    try {
      await logoutSession();
    } catch (error) {
      setSessionError(error.message || 'Unable to sign out of Firebase.');
    }
  };

  const handleAccountDeleted = async () => {
    const userId = profile?.userId;
    if (userId) {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith(`agrishield_conv_id_${userId}`) || key.startsWith(`agrishield_msgs_${userId}_`)) {
          sessionStorage.removeItem(key);
        }
      });
    }
    localStorage.removeItem('agrishield_stage');
    setProfile(CLEAN_BASELINE_PROFILE);
    setMobile('');
    setSessionError('');
    setSessionErrorCode('');
    setStage('login');
    try {
      await logoutSession();
    } catch (error) {
      console.warn('[AgriShield App] Sign-out after account deletion failed:', error.code || error.name || 'signout_error');
    }
  };

  const retryAccountSync = async () => {
    const firebaseUser = firebaseAuthRef.current?.currentUser;
    if (!firebaseUser) {
      setStage('login');
      return;
    }
    setStage('checking');
    setSessionError('');
    setSessionErrorCode('');
    try {
      const savedProfile = await getCurrentSession(firebaseUser.displayName || '');
      const restored = {
        ...CLEAN_BASELINE_PROFILE,
        ...savedProfile,
        farm: { ...CLEAN_BASELINE_PROFILE.farm, ...savedProfile.farm }
      };
      setProfile(restored);
      setFarmTransitionError('');
      setMobile(firebaseUser.phoneNumber || restored.verifiedMobile || '');
      const hasSavedBoundary = (restored.farm?.boundary?.points?.length || restored.farm?.farmBoundary?.length || 0) >= 3;
      setStage(restored.farmerName && hasSavedBoundary ? 'dashboard' : 'profile');
    } catch (error) {
      console.warn('[AgriShield App] Firebase account synchronization retry failed.', {
        code: error.code || 'ACCOUNT_SYNC_FAILED',
        status: error.status || null
      });
      setSessionError(error.message || 'Some farm data could not be loaded. Check your connection and retry.');
      setSessionErrorCode(error.code || 'ACCOUNT_SYNC_FAILED');
      setStage('account-error');
    }
  };

  const farmServiceConfigurationErrors = [
    'FIRESTORE_UNAVAILABLE',
    'FARM_DATA_UNAVAILABLE',
    'FIREBASE_ADMIN_NOT_CONFIGURED',
    'FIREBASE_PROJECT_ID_MISSING',
    'FIREBASE_CLIENT_EMAIL_MISSING',
    'FIREBASE_CLIENT_EMAIL_INVALID',
    'FIREBASE_PRIVATE_KEY_MISSING',
    'FIREBASE_PRIVATE_KEY_INVALID'
  ];
  const isFirebaseAuthError = sessionErrorCode === 'FIREBASE_AUTH_FAILED' ||
    sessionErrorCode === 'AUTH_NOT_AUTHENTICATED' || sessionErrorCode.startsWith('auth/');
  const accountErrorTitle = sessionErrorCode === 'API_NETWORK_ERROR'
    ? 'Could not reach farm data service'
    : farmServiceConfigurationErrors.includes(sessionErrorCode)
      ? 'Farm data service is unavailable'
      : sessionErrorCode === 'FIREBASE_CLIENT_NOT_CONFIGURED'
        ? 'Firebase sign-in is not configured'
        : isFirebaseAuthError
          ? 'Firebase sign-in needs attention'
          : sessionErrorCode === 'FARM_ACCESS_DENIED'
            ? 'Account access denied'
            : sessionErrorCode === 'RESOURCE_NOT_FOUND'
              ? 'Service endpoint not found'
              : sessionErrorCode === 'BACKEND_SERVICE_ERROR'
                ? 'Server error loading farm data'
                : 'Could not load your farm data';

  return (
    <div className="agrishield-app-root">
      {stage === 'checking' && (
        <div className="login-viewport" role="status">Loading account...</div>
      )}
      {stage === 'farm-transition' && (
        <div className="login-viewport" role="status">Loading farm data...</div>
      )}
      {stage === 'login' && (
        <div className="login-viewport">
          <Login onLoginSuccess={handleLoginSuccess} sessionError={sessionError} />
        </div>
      )}

      {stage === 'account-error' && (
        <div className="login-viewport">
          <div className="auth-container" role="alert">
            <h2 className="form-title">{accountErrorTitle}</h2>
            <p className="form-subtitle">{sessionError}</p>
            <button type="button" className="btn-primary" onClick={retryAccountSync}>Retry account sync</button>
            <button type="button" className="btn-text" onClick={() => void handleLogout()}>Sign out</button>
          </div>
        </div>
      )}

      {stage === 'profile' && (
        <Profile
          verifiedMobile={mobile || profile.verifiedMobile || ''}
          initialProfile={profile}
          onProfileComplete={handleProfileComplete}
          createNewFarm={createNewFarm}
        />
      )}

      {stage === 'dashboard' && (
        <Dashboard
          profile={profile}
          farmTransitionError={farmTransitionError}
          onFarmSwitch={handleFarmSwitch}
          onAddFarm={() => {
            setCreateNewFarm(true);
            setStage('profile');
          }}
          onEditFarm={() => {
            setStage('profile');
            localStorage.setItem('agrishield_stage', 'profile');
          }}
          onLogout={handleLogout}
          onAccountDeleted={() => void handleAccountDeleted()}
        />
      )}
    </div>
  );
}

export default App;
