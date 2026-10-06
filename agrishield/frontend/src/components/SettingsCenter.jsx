import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  Camera,
  ChevronRight,
  Check,
  Droplet,
  Info,
  Languages,
  LockKeyhole,
  LogOut,
  MapPin,
  Mail,
  Mic,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Sprout,
  Trash2,
  UserRound
} from 'lucide-react';
import { updateAppPreferences } from '../services/appPreferences';
import { useAppPreferences } from '../services/useAppPreferences';
import { translate } from '../i18n';
import { deleteCurrentAccount } from '../services/api';

const PERMISSION_NAMES = ['geolocation', 'microphone', 'camera', 'notifications'];

function translatePermission(status, t) {
  if (status === 'Allowed') return t('permission.allowed');
  if (status === 'Blocked in browser settings') return t('permission.denied');
  if (status === 'Not requested' || status === 'prompt' || status === 'default') return t('permission.prompt');
  if (status === 'Not available in this browser' || status === 'unavailable') return t('permission.unavailable');
  return t('permission.checkSettings');
}

function readPermissionValue(name) {
  if (name === 'notifications') {
    if (!('Notification' in window)) return 'Not available in this browser';
    return window.Notification.permission === 'granted'
      ? 'Allowed'
      : window.Notification.permission === 'denied'
        ? 'Blocked in browser settings'
        : 'Not requested';
  }

  return 'Checking browser permission';
}

async function queryPermission(name) {
  if (name === 'notifications') {
    if (!('Notification' in window)) return 'Not available in this browser';
    return window.Notification.permission === 'granted'
      ? 'Allowed'
      : window.Notification.permission === 'denied'
        ? 'Blocked in browser settings'
        : 'Not requested';
  }
  if (!navigator.permissions?.query) return 'Not available in this browser';
  try {
    const status = await navigator.permissions.query({ name });
    return status.state === 'granted'
      ? 'Allowed'
      : status.state === 'denied'
        ? 'Blocked in browser settings'
        : 'Not requested';
  } catch {
    return 'Not available in this browser';
  }
}

function SettingRow({ icon: Icon, title, description, value, action, onClick, disabled = false }) {
  const content = (
    <>
      <span className="settings-row-icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="settings-row-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      {value && <span className="settings-row-value">{value}</span>}
      {action && <span className="settings-row-action">{action}<ChevronRight size={16} aria-hidden="true" /></span>}
    </>
  );
  return onClick ? (
    <button type="button" className="settings-row" onClick={onClick} disabled={disabled}>
      {content}
    </button>
  ) : (
    <div className={`settings-row ${disabled ? 'disabled' : ''}`}>{content}</div>
  );
}

function PermissionRow({ icon: Icon, name, title, description, permission, t, onAction }) {
  const status = permission[name];
  const action = status === 'Allowed'
    ? 'permission.manage'
    : status === 'Not requested'
      ? 'permission.enable'
      : status === 'Blocked in browser settings'
        ? 'permission.manageBrowser'
        : null;

  return (
    <div className="settings-row settings-permission-row">
      <span className="settings-row-icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="settings-row-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="settings-row-value">{translatePermission(status, t)}</span>
      {action && (
        <button type="button" className="settings-permission-action"
          onClick={() => onAction(name, status)}>
          {t(action)}
        </button>
      )}
    </div>
  );
}

function PreferenceToggle({ label, description, enabled, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function PreferencePicker({ mode, value, language, onSelect, onClose }) {
  const t = (key, values) => translate(language, key, values);
  const isLanguage = mode === 'language';
  const options = isLanguage
    ? [
      ['en', 'settings.english', 'settings.englishDescription', Languages],
      ['te', 'settings.telugu', 'settings.teluguDescription', Languages],
      ['hi', 'settings.hindi', 'settings.hindiDescription', Languages]
    ]
    : [
      ['light', 'settings.light', 'settings.lightDescription', Sun],
      ['dark', 'settings.dark', 'settings.darkDescription', Moon]
    ];

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="settings-dialog preference-picker" role="dialog" aria-modal="true"
        aria-labelledby="settings-picker-title">
        <header>
          <h2 id="settings-picker-title">
            {t(isLanguage ? 'settings.selectLanguage' : 'settings.selectAppearance')}
          </h2>
          <button type="button" className="settings-picker-close" onClick={onClose} aria-label={t('delete.cancel')}>×</button>
        </header>
        <div className="settings-option-list">
          {options.map(([option, titleKey, descriptionKey, Icon]) => (
            <button type="button" className="settings-option-row" key={option}
              aria-pressed={value === option} onClick={() => onSelect(option)}>
              <Icon size={18} aria-hidden="true" />
              <span><strong>{t(titleKey)}</strong><small>{t(descriptionKey)}</small></span>
              {value === option && <Check size={19} aria-label={t('settings.selected')} />}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountDeletionDialog({ language, onClose, onDeleted }) {
  const t = (key) => translate(language, key);
  const [step, setStep] = useState('warning');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (busy) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && step !== 'success') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose, step]);

  const confirmDeletion = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteCurrentAccount();
      setStep('success');
    } catch (deleteError) {
      console.warn('[Settings] Account deletion request failed:', deleteError.code || deleteError.name || 'account_deletion_error');
      setError(deleteError.code === 'RECENT_AUTH_REQUIRED'
        ? (t('delete.recentAuth') || 'Please sign in again before deleting your account.')
        : t('delete.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (!busy && step !== 'success' && event.target === event.currentTarget) onClose();
    }}>
      <section className="settings-dialog account-delete-dialog" role="dialog" aria-modal="true"
        aria-labelledby="account-delete-title">
        {step === 'warning' && (
          <>
            <h2 id="account-delete-title">{t('delete.warningTitle')}</h2>
            <p>{t('delete.permanentWarning')}</p>
            <p>{t('delete.dataExplanation')}</p>
            {error && <p className="settings-dialog-error" role="alert">{error}</p>}
            <footer>
              <button type="button" className="settings-secondary-button" onClick={onClose}>{t('delete.cancel')}</button>
              <button type="button" className="settings-primary-button danger" disabled={busy}
                onClick={() => { setStep('final'); setError(''); }}>
                {t('delete.continue')}
              </button>
            </footer>
          </>
        )}
        {step === 'final' && (
          <>
            <h2 id="account-delete-title">{t('delete.finalTitle')}</h2>
            <p>{t('delete.finalWarning')}</p>
            {error && <p className="settings-dialog-error" role="alert">{error}</p>}
            <footer>
              <button type="button" className="settings-secondary-button" disabled={busy} onClick={onClose}>{t('delete.cancel')}</button>
              <button type="button" className="settings-primary-button danger" disabled={busy} onClick={() => void confirmDeletion()}>
                {busy ? t('delete.deleting') : t('delete.confirm')}
              </button>
            </footer>
          </>
        )}
        {step === 'success' && (
          <>
            <h2 id="account-delete-title">{t('delete.success')}</h2>
            <footer>
              <button type="button" className="settings-primary-button" onClick={onDeleted}>{t('delete.successButton')}</button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

export default function SettingsCenter({ profile = {}, onEditFarm, onLogout, onOpenHelp, onOpenWeather, onAccountDeleted }) {
  const preferences = useAppPreferences();
  const { language, appearance, notificationsEnabled, voicePlaybackEnabled } = preferences;
  const t = (key, values) => translate(language, key, values);
  const [picker, setPicker] = useState('');
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [permissionGuide, setPermissionGuide] = useState(false);
  const [permission, setPermission] = useState(() =>
    Object.fromEntries(PERMISSION_NAMES.map((name) => [name, readPermissionValue(name)]))
  );

  const farm = profile.farm || {};
  const location = farm.location || farm.farmLocation || null;
  const latitude = Number(location?.latitude ?? location?.lat);
  const longitude = Number(location?.longitude ?? location?.lng);
  const hasLocation = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const boundary = farm.boundary?.points || farm.farmBoundary || farm.boundary || [];
  const pointCount = Array.isArray(boundary) ? boundary.length : 0;
  const area = farm.boundary?.areaAcres || farm.area?.acres || null;
  const perimeter = farm.boundary?.perimeterMeters || farm.area?.perimeterMeters || null;
  const crop = farm.crop || farm.cropDetails?.name || null;
  const water = farm.waterSource || farm.water?.source || farm.water?.otherSource || null;
  const mobile = profile.verifiedMobile || profile.phone || profile.mobile || 'Not available';
  const isVerified = profile.mobileVerified === true || profile.phoneVerified === true;

  useEffect(() => {
    let active = true;
    const refreshPermissions = async () => {
      const entries = await Promise.all(PERMISSION_NAMES.map(async (name) => [name, await queryPermission(name)]));
      if (active) setPermission((current) => ({ ...current, ...Object.fromEntries(entries) }));
    };
    const onFocus = () => void refreshPermissions();
    void refreshPermissions();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!permissionGuide) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPermissionGuide(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [permissionGuide]);

  const handlePermissionAction = async (name, status) => {
    if (status !== 'Not requested') {
      setPermissionGuide(true);
      return;
    }

    try {
      if (name === 'notifications') {
        await window.Notification.requestPermission();
      } else if (name === 'geolocation') {
        await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 0 });
        });
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: name === 'microphone',
          video: name === 'camera'
        });
        stream.getTracks().forEach((track) => track.stop());
      }
      const currentStatus = await queryPermission(name);
      setPermission((current) => ({ ...current, [name]: currentStatus }));
    } catch (error) {
      console.warn(`[Settings] Browser ${name} permission request failed:`, error.name || 'permission_request_error');
      const currentStatus = await queryPermission(name);
      setPermission((current) => ({ ...current, [name]: currentStatus }));
      if (currentStatus !== 'Blocked in browser settings') setPermissionGuide(true);
    }
  };

  return (
    <div className="settings-center">
      <header className="settings-center-header">
        <span className="settings-section-icon"><Settings size={22} aria-hidden="true" /></span>
        <div>
          <h2>{t('settings.title')}</h2>
          <p>{t('settings.description')}</p>
        </div>
      </header>

      <div className="settings-center-grid">
        <section className="settings-group">
          <h3>{t('settings.account')}</h3>
          <div className="settings-group-list">
            <SettingRow
              icon={UserRound}
              title={t('settings.profile')}
              description={profile.farmerName || profile.name || t('settings.profileDescription')}
              action={t('settings.edit')}
              onClick={onEditFarm}
            />
            <SettingRow
              icon={ShieldCheck}
              title={t('settings.verifiedPhone')}
              description={mobile}
              value={isVerified ? t('permission.allowed') : t('permission.checkSettings')}
            />
            <SettingRow
              icon={LockKeyhole}
              title={t('settings.security')}
              description={t('settings.securityDescription')}
              value={profile.userId ? t('settings.signedIn') : t('settings.versionUnavailable')}
            />
          </div>
        </section>

        <section className="settings-group">
          <h3>{t('settings.farm')}</h3>
          <div className="settings-group-list">
            <SettingRow
              icon={Sprout}
              title={t('settings.farmSetup')}
              description={t('settings.farmSetupDescription')}
              action={t('settings.editFarm')}
              onClick={onEditFarm}
            />
            <SettingRow
              icon={MapPin}
              title={t('settings.farmLocation')}
              description={hasLocation ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : t('settings.locationMissing')}
              action={hasLocation ? t('settings.openMap') : t('settings.setLocation')}
              onClick={hasLocation ? onOpenWeather : onEditFarm}
            />
            <SettingRow
              icon={MapPin}
              title={t('settings.farmBoundary')}
              description={pointCount >= 3 ? `${t('settings.savedBoundary', { count: pointCount })}${area ? ` · ${area} acres` : ''}${perimeter ? ` · ${perimeter} m` : ''}` : t('settings.noBoundary')}
              action={t('settings.review')}
              onClick={onEditFarm}
            />
            <SettingRow
              icon={Droplet}
              title={t('settings.waterSource')}
              description={water || t('settings.notSpecified')}
              action={t('settings.edit')}
              onClick={onEditFarm}
            />
            <SettingRow
              icon={Sprout}
              title={t('settings.cropInformation')}
              description={crop || t('settings.noCrop')}
              action={t('settings.edit')}
              onClick={onEditFarm}
            />
            <SettingRow
              icon={MapPin}
              title={t('settings.farmData')}
              description={t('settings.farmDataDescription')}
              action={t('settings.reviewFarmData')}
              onClick={onEditFarm}
            />
          </div>
        </section>

        <section className="settings-group">
          <h3>{t('settings.experience')}</h3>
          <div className="settings-group-list settings-preference-list">
            <SettingRow icon={Languages} title={t('settings.language')} description={t('settings.languageDescription')}
              value={t(`settings.${language === 'te' ? 'telugu' : language === 'hi' ? 'hindi' : 'english'}`)}
              action={t('settings.change')} onClick={() => setPicker('language')} />
            <SettingRow icon={Settings} title={t('settings.appearance')} description={t('settings.appearanceDescription')}
              value={t(`settings.${appearance}`)} action={t('settings.change')} onClick={() => setPicker('appearance')} />
            <PreferenceToggle
              label={t('settings.notifications')}
              description={t('settings.notificationsDescription')}
              enabled={notificationsEnabled}
              onChange={(value) => updateAppPreferences({ notificationsEnabled: value })}
            />
            <PreferenceToggle
              label={t('settings.voicePlayback')}
              description={t('settings.voicePlaybackDescription')}
              enabled={voicePlaybackEnabled}
              onChange={(value) => updateAppPreferences({ voicePlaybackEnabled: value })}
            />
          </div>
        </section>

        <section className="settings-group">
          <h3>{t('settings.permissions')}</h3>
          <div className="settings-group-list">
            <PermissionRow icon={MapPin} name="geolocation" title={t('settings.farmLocation')} description={t('settings.locationPermission')} permission={permission} t={t} onAction={handlePermissionAction} />
            <PermissionRow icon={Mic} name="microphone" title={t('permission.microphone')} description={t('settings.microphonePermission')} permission={permission} t={t} onAction={handlePermissionAction} />
            <PermissionRow icon={Camera} name="camera" title={t('permission.camera')} description={t('settings.cameraPermission')} permission={permission} t={t} onAction={handlePermissionAction} />
            <PermissionRow icon={Bell} name="notifications" title={t('settings.notifications')} description={t('settings.browserNotifications')} permission={permission} t={t} onAction={handlePermissionAction} />
            <p className="settings-permission-note">{t('settings.permissionNote')}</p>
          </div>
        </section>
        {permissionGuide && createPortal(
          <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPermissionGuide(false);
          }}>
            <section className="settings-dialog" role="dialog" aria-modal="true"
              aria-labelledby="permission-guide-title">
              <h2 id="permission-guide-title">{t('permission.manageTitle')}</h2>
              <p>{t('permission.manageDescription')}</p>
              <footer>
                <button type="button" className="settings-primary-button" onClick={() => setPermissionGuide(false)}>
                  {t('delete.cancel')}
                </button>
              </footer>
            </section>
          </div>,
          document.body
        )}

        <section className="settings-group">
          <h3>{t('settings.support')}</h3>
          <div className="settings-group-list">
            <SettingRow icon={Bell} title={t('settings.help')} description={t('settings.helpDescription')} action={t('settings.openHelp')} onClick={onOpenHelp} />
            <SettingRow icon={Mail} title={t('settings.contact')} description={t('settings.helpDescription')} action={t('settings.openHelp')} onClick={onOpenHelp} />
            <SettingRow icon={Info} title={t('settings.about')} description="AgriShield" action={t('settings.openHelp')} onClick={onOpenHelp} />
            <SettingRow icon={Info} title={t('settings.appVersion')} description={import.meta.env.VITE_APP_VERSION || t('settings.versionUnavailable')} />
          </div>
        </section>
      </div>

      <section className="settings-group settings-account-actions">
        <h3>{t('settings.accountActions')}</h3>
        <div className="settings-group-list">
          <SettingRow icon={Trash2} title={t('settings.deleteAccount')} description={t('settings.deleteDescription')}
            action={t('settings.deleteAccount')} onClick={() => setDeleteAccountOpen(true)} />
          <SettingRow icon={LogOut} title={t('settings.signOut')} description={t('settings.signOutDescription')}
            action={t('settings.signOut')} onClick={onLogout} />
        </div>
      </section>
      {picker && createPortal(
        <PreferencePicker
          mode={picker}
          value={picker === 'language' ? language : appearance}
          language={language}
          onClose={() => setPicker('')}
          onSelect={(value) => {
            updateAppPreferences(picker === 'language' ? { language: value } : { appearance: value });
            setPicker('');
          }}
        />,
        document.body
      )}
      {deleteAccountOpen && createPortal(
        <AccountDeletionDialog
          language={language}
          onClose={() => setDeleteAccountOpen(false)}
          onDeleted={() => {
            setDeleteAccountOpen(false);
            onAccountDeleted?.();
          }}
        />,
        document.body
      )}
    </div>
  );
}
