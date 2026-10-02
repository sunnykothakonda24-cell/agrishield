import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
  Shield, 
  Bell, 
  User, 
  MapPin, 
  Sprout, 
  Droplet, 
  Settings as SettingsIcon, 
  Rotate3d, 
  Layers, 
  LogOut, 
  Bot, 
  CloudRain,
  ArrowRight,
  ArrowLeft,
  Info,
  ShoppingBag,
  TriangleAlert,
  Check,
  RefreshCw,
} from 'lucide-react';
import Farm3DModel from '../components/Farm3DModel';
import AIChatView from '../components/AIChatView';
import AIChatErrorBoundary from '../components/AIChatErrorBoundary';
import CropsInfoView from '../components/CropsInfoView';
import WeatherView from '../components/WeatherView';
import ExpertHelpView from '../components/ExpertHelpView';
import SettingsCenter from '../components/SettingsCenter';
import CropSchedule from '../components/CropSchedule';
import ShopView from '../components/ShopView';
import { useAppPreferences } from '../services/useAppPreferences';
import { translate } from '../i18n';
import '../components/dashboardScheduleShop.css';
import {
  getFarmTwinState,
  getNotifications,
  markNotificationAsRead
} from '../services/api';

const ALERT_FILTER_TYPES = {
  Weather: 'weather',
  Farm: 'farm',
  AI: 'ai',
  Emergency: 'emergency'
};

function alertIcon(type) {
  switch (String(type || '').toLowerCase()) {
    case 'weather': return CloudRain;
    case 'farm': return Sprout;
    case 'ai': return Bot;
    case 'emergency': return TriangleAlert;
    default: return Bell;
  }
}

function alertAge(createdAt) {
  if (!createdAt) return 'Date unavailable';
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return elapsedDays < 7 ? `${elapsedDays}d ago` : new Date(timestamp).toLocaleDateString();
}

const FARM_CONDITIONS = {
  NORMAL: {
    key: 'NORMAL',
    bgClass: 'bg-normal'
  },
  RAIN: {
    key: 'RAIN',
    bgClass: 'bg-rain'
  },
  SUNNY: {
    key: 'SUNNY',
    bgClass: 'bg-sunny'
  },
  HIGH_HEAT: {
    key: 'HIGH_HEAT',
    bgClass: 'bg-high-heat'
  },
};

export default function Dashboard({ 
  profile, 
  onEditFarm, 
  onLogout,
  onAccountDeleted
}) {
  const preferences = useAppPreferences();
  const t = (key, values) => translate(preferences.language, key, values);
  const [activeTab, setActiveTab] = useState('home');
  const [shopContext, setShopContext] = useState({});

  // Farm data synced from the authenticated profile.
  const [currentProfile] = useState(profile);

  // Environmental state for Farm Twin and dynamic background
  const [environmentState, setEnvironmentState] = useState('NORMAL');
  const [weatherDataStatus, setWeatherDataStatus] = useState('unavailable');
  const [alertsNotifications, setAlertsNotifications] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(preferences.notificationsEnabled);
  const [alertsError, setAlertsError] = useState('');
  const [notificationUpdateError, setNotificationUpdateError] = useState('');
  const [alertsFilter, setAlertsFilter] = useState('All');
  const [alertsRefreshKey, setAlertsRefreshKey] = useState(0);
  const notificationsRequestRef = useRef(null);
  const notificationsRequestGenerationRef = useRef(0);
  const unreadAlertsCount = preferences.notificationsEnabled
    ? alertsNotifications.filter((notification) => !notification.read).length
    : 0;
  const farmLocation = currentProfile?.farm?.location || currentProfile?.farm?.farmLocation;
  const farmLatitude = Number(farmLocation?.latitude ?? farmLocation?.lat);
  const farmLongitude = Number(farmLocation?.longitude ?? farmLocation?.lng);
  const hasSavedCoordinates = Number.isFinite(farmLatitude) && farmLatitude >= -90 && farmLatitude <= 90 &&
    Number.isFinite(farmLongitude) && farmLongitude >= -180 && farmLongitude <= 180;
  const openAlerts = () => {
    setAlertsLoading(preferences.notificationsEnabled);
    setAlertsError('');
    setNotificationUpdateError('');
    setActiveTab('alerts');
    setAlertsRefreshKey((previous) => previous + 1);
  };

  const loadAlertsNotifications = useCallback(() => {
    if (!preferences.notificationsEnabled) {
      notificationsRequestGenerationRef.current += 1;
      notificationsRequestRef.current = null;
      setAlertsNotifications([]);
      setAlertsLoading(false);
      setAlertsError('');
      return Promise.resolve();
    }
    if (notificationsRequestRef.current) return notificationsRequestRef.current;
    const requestGeneration = ++notificationsRequestGenerationRef.current;
    notificationsRequestRef.current = getNotifications()
      .then((notifications) => {
        if (requestGeneration !== notificationsRequestGenerationRef.current) return;
        setAlertsNotifications(notifications);
        setAlertsError('');
      })
      .catch((error) => {
        if (requestGeneration !== notificationsRequestGenerationRef.current) return;
        setAlertsNotifications([]);
        setAlertsError(error.message || 'Notifications are temporarily unavailable. Please try again.');
      })
      .finally(() => {
        if (requestGeneration === notificationsRequestGenerationRef.current) {
          notificationsRequestRef.current = null;
          setAlertsLoading(false);
        }
      });
    return notificationsRequestRef.current;
  }, [preferences.notificationsEnabled]);

  useEffect(() => {
    if (activeTab !== 'alerts') return undefined;
    void loadAlertsNotifications();
  }, [activeTab, alertsRefreshKey, loadAlertsNotifications]);

  const retryAlerts = () => {
    setAlertsLoading(true);
    setAlertsError('');
    setNotificationUpdateError('');
    setAlertsRefreshKey((previous) => previous + 1);
  };

  const handleMarkNotificationRead = async (notificationId) => {
    setNotificationUpdateError('');
    try {
      await markNotificationAsRead(notificationId);
      setAlertsNotifications((notifications) => notifications.map((notification) =>
        notification.id === notificationId ? { ...notification, read: true } : notification
      ));
    } catch (error) {
      setNotificationUpdateError(error.message || 'This notification could not be updated. Please try again.');
    }
  };

  // The authenticated bootstrap already supplied the farmer and farm profile.
  const farmId = currentProfile?.farm?._id ||
    (currentProfile?.userId ? `farm-${currentProfile.userId}` : null);

  useEffect(() => {
    if (!farmId) return undefined;
    let active = true;
    getFarmTwinState(farmId)
      .then((twinRes) => {
        if (!active || !twinRes) return;
        setEnvironmentState(twinRes.environmentState || 'NORMAL');
        setWeatherDataStatus(twinRes.dataStatus || 'unavailable');
      })
      .catch((error) => {
        if (active) console.warn('[Dashboard] Could not load Farm Twin status:', error.message);
      });
    return () => { active = false; };
  }, [farmId]);

  const hasFarmSetup = Boolean(
    Number.isFinite(Number(currentProfile?.farm?.location?.lat)) &&
    currentProfile?.farm?.location?.lat !== null &&
    currentProfile?.farm?.location?.lat !== undefined &&
    (currentProfile?.farm?.boundary?.points?.length >= 3 || currentProfile?.farm?.farmBoundary?.length >= 3)
  );

  const enteredName = currentProfile?.farmerName?.trim() || '';
  const hasName = Boolean(enteredName);
  const cropName = currentProfile?.farm?.crop || currentProfile?.farm?.cropDetails?.name || null;
  const currentStage = currentProfile?.farm?.stage || currentProfile?.farm?.cropDetails?.stage || '';
  const areaAcres = currentProfile?.farm?.boundary?.areaAcres || currentProfile?.farm?.area?.acres || null;
  const waterSource = currentProfile?.farm?.waterSource || currentProfile?.farm?.water?.otherSource || null;

  const currentCondition = FARM_CONDITIONS[environmentState];
  const conditionTranslation = {
    NORMAL: 'normal',
    RAIN: 'rain',
    SUNNY: 'sunny',
    HIGH_HEAT: 'highHeat'
  }[environmentState];
  const conditionLabel = weatherDataStatus === 'unavailable' || !currentCondition
    ? t('weather.unavailable')
    : t(`weather.${conditionTranslation}.label`);
  const conditionMessage = weatherDataStatus === 'unavailable'
    ? t('weather.baseline')
    : conditionTranslation
      ? t(`weather.${conditionTranslation}.status`)
      : t('weather.fallback');

  // Dynamic greeting based on time of day
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'dashboard.morning' : hour < 17 ? 'dashboard.afternoon' : 'dashboard.evening');
  const greetingDisplay = hasName ? `${greeting}, ${enteredName}` : greeting;
  const farmCoordinateText = hasSavedCoordinates
    ? `${Math.abs(farmLatitude).toFixed(5)}° ${farmLatitude < 0 ? 'S' : 'N'}, ${Math.abs(farmLongitude).toFixed(5)}° ${farmLongitude < 0 ? 'W' : 'E'}`
    : 'Farm location not configured';
  const hasCriticalAlert = alertsNotifications.some((notification) =>
    !notification.read && ['critical', 'emergency'].includes(String(notification.severity).toLowerCase())
  );
  const attentionCount = alertsNotifications.filter((notification) =>
    !notification.read && ['advisory', 'important'].includes(String(notification.severity).toLowerCase())
  ).length;
  const alertsStatusTitle = hasCriticalAlert
    ? 'Critical farm alert'
    : attentionCount
      ? `${attentionCount} ${attentionCount === 1 ? 'advisory' : 'advisories'} needs attention`
      : 'No critical alerts';
  const filteredAlerts = alertsFilter === 'All'
    ? alertsNotifications
    : alertsNotifications.filter((notification) =>
      String(notification.type || '').toLowerCase() === ALERT_FILTER_TYPES[alertsFilter]
    );

  return (
    <div className={`agri-dashboard-layout dynamic-env-${environmentState.toLowerCase()} animate-fadeIn`}>
      {/* 1. TOP BAR (AgriShield-AI branding, Notification bell, Profile button) */}
      <header className="agri-top-navbar">
        <div className="top-navbar-inner">
          <div className="top-brand" onClick={() => setActiveTab('home')} role="button" tabIndex={0}>
            <div className="brand-logo-icon">
              <Shield size={22} color="#10b981" />
            </div>
            <div className="brand-labels">
              <h1 className="brand-title-text">AgriShield-AI</h1>
              <span className="brand-subline">Intelligent Agricultural Defense System</span>
            </div>
          </div>

          <div className="top-user-controls">
            <button
              type="button"
              className="dashboard-weather-entry"
              onClick={() => setActiveTab('weather')}
              title={t('dashboard.weatherMap')}
              aria-label={t('dashboard.weatherMap')}
            >
              <CloudRain size={18} aria-hidden="true" />
              <span>{t('dashboard.weatherMap')}</span>
            </button>
            {/* Notification Bell */}
            <button 
              type="button" 
              className={`btn-top-icon ${unreadAlertsCount > 0 ? 'has-badge' : ''}`}
              onClick={openAlerts}
              title="System Alerts & Notifications"
            >
              <Bell size={19} />
              {unreadAlertsCount > 0 && <span className="top-icon-badge">{unreadAlertsCount}</span>}
            </button>

            {/* Profile Avatar Button */}
            <button 
              type="button" 
              className="btn-top-profile" 
              onClick={onEditFarm}
              title={t('dashboard.profile')}
            >
              <div className="profile-avatar-circle">
                <User size={16} />
              </div>
              <div className="profile-names-wrap">
                <span className="profile-name-text">{hasName ? enteredName : t('dashboard.profile')}</span>
                <span className="profile-badge-pill">{hasName ? t('dashboard.active') : t('dashboard.setup')}</span>
              </div>
            </button>

            {/* Log Out */}
            <button 
              type="button" 
              className="btn-top-logout" 
              onClick={onLogout}
              title={t('settings.signOut')}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN VIEW CONTAINER */}
      <main className="agri-main-viewport">
        {/* TAB: HOME / DYNAMIC FARM TWIN DASHBOARD */}
        {activeTab === 'home' && (
          <div className="home-farm-dashboard animate-fadeIn">
            {/* Greeting & Farm Header (Requirement 102 & 117) */}
            <div className="farm-header-welcome">
              <div className="greeting-col">
                <h2 className="greeting-main">{greetingDisplay}</h2>
                <span className="greeting-sub">{t('dashboard.yourFarm')}</span>
              </div>

              {hasFarmSetup && (
                <div className="farm-meta-chips">
                  {cropName && (
                    <div className="meta-chip green">
                      <Sprout size={14} />
                      <span>{cropName}</span>
                    </div>
                  )}
                  {areaAcres && (
                    <div className="meta-chip neutral">
                      <Layers size={14} />
                      <span>{areaAcres} Acres</span>
                    </div>
                  )}
                  {waterSource && (
                    <div className="meta-chip blue">
                      <Droplet size={14} />
                      <span>{waterSource}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {!hasFarmSetup ? (
              /* Requirement 79: Clean Empty State */
              <div className="empty-farm-setup-card animate-scaleUp">
                <div className="empty-icon-box">
                  <Rotate3d size={36} color="#10b981" />
                </div>
                <h3>{t('dashboard.emptyTitle')}</h3>
                <p>{t('dashboard.emptyDescription')}</p>
                <button type="button" className="btn-setup-farm-action" onClick={onEditFarm}>
                  <span>{t('dashboard.setupFarm')}</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            ) : (
              /* Primary Visual Section: 3D Farm Twin + Environmental Status */
              <div className="visual-farm-centerpiece-card">
                {/* 3D Farm Model */}
                <div className="centerpiece-3d-wrapper">
                  <Farm3DModel 
                    boundaryData={currentProfile?.farm?.boundary}
                    environmentState={environmentState}
                    farmInfo={currentProfile?.farm}
                    height={380}
                  />
                </div>

                {/* Natural-Language Environmental Status Banner (Requirement 96) */}
                <div className={`farm-condition-status-bar ${environmentState.toLowerCase()}`}>
                  <div className="status-indicator-dot"></div>
                  <div className="status-text-content">
                    <span className="condition-pill-tag font-mono">{conditionLabel}</span>
                    <p className="condition-status-sentence">{conditionMessage}</p>
                  </div>

                  <button 
                    type="button" 
                    className="btn-expand-twin"
                    onClick={() => setActiveTab('farmtwin')}
                    title="Open full interactive 3D Farm Twin view"
                  >
                    <Rotate3d size={16} />
                    <span>{t('dashboard.dedicated3d')}</span>
                  </button>
                </div>
              </div>
            )}

            <CropSchedule
              farm={currentProfile?.farm}
              onViewInShop={(context) => {
                setShopContext(context);
                setActiveTab('shop');
              }}
            />
          </div>
        )}

        {/* TAB: AI CHAT (Dedicated Multimodal Conversational Interface) */}
        {activeTab === 'ai' && (
          <div className="tab-pane-container animate-fadeIn">
            <AIChatErrorBoundary>
              <AIChatView
                farmerId={currentProfile?.userId}
                profile={currentProfile}
                onOpenWeatherMap={() => setActiveTab('weather')}
              />
            </AIChatErrorBoundary>
          </div>
        )}

        {activeTab === 'shop' && (
          <div className="tab-pane-container animate-fadeIn">
            <ShopView
              key={`${shopContext.category || ''}|${shopContext.crop || ''}|${shopContext.variety || ''}|${shopContext.stage || ''}|${shopContext.query || ''}`}
              profile={currentProfile}
              initialFilters={{
                ...shopContext,
                crop: shopContext.crop || cropName || '',
                variety: shopContext.variety || currentProfile?.farm?.variety || currentProfile?.farm?.cropDetails?.variety || '',
                stage: shopContext.stage || currentStage
              }}
            />
          </div>
        )}

        {/* TAB: CROPS INFO (Crop Guides and Specifications) */}
        {activeTab === 'crops' && (
          <div className="tab-pane-container animate-fadeIn">
            <CropsInfoView
              profile={currentProfile}
              onSelectCropForChat={() => setActiveTab('ai')}
            />
          </div>
        )}

        {/* TAB: WEATHER */}
        {activeTab === 'weather' && (
          <div className="tab-pane-container animate-fadeIn">
            <WeatherView
              profile={currentProfile}
              onAskWeatherToAI={() => setActiveTab('ai')}
              onOpenFarmSetup={onEditFarm}
            />
          </div>
        )}

        {/* TAB: HELP & SUPPORT */}
        {activeTab === 'expert' && (
          <div className="tab-pane-container animate-fadeIn">
            <ExpertHelpView
              onOpenAssistant={() => setActiveTab('ai')}
              onOpenPage={(page) => setActiveTab(page)}
              onOpenFarmSetup={onEditFarm}
            />
          </div>
        )}

        {/* TAB: DEDICATED FULL FARM TWIN (Requirements 58, 151) */}
        {activeTab === 'farmtwin' && (
          <div className="tab-pane-container animate-fadeIn">
            <div className="dedicated-farmtwin-view">
              <div className="farmtwin-header-bar">
                <div className="farmtwin-title-col">
                  <div className="title-row">
                    <Rotate3d size={24} color="#10b981" />
                    <h3>3D Farm Twin & Topography</h3>
                  </div>
                  <p className="subtext">
                    Farm visualization from your saved boundary, with current weather shown when available.
                  </p>
                </div>

                <button 
                  type="button" 
                  className="btn-back-farm"
                  onClick={() => setActiveTab('home')}
                >
                  Back to Dashboard
                </button>
              </div>

              <div className="full-twin-canvas-card">
                <Farm3DModel 
                  boundaryData={currentProfile?.farm?.boundary}
                  environmentState={environmentState}
                  farmInfo={currentProfile?.farm}
                  height={500}
                />
              </div>

              {/* Farm Twin Geospatial & Environmental Context */}
              <div className="farmtwin-details-grid">
                <div className="twin-detail-card">
                  <div className="detail-icon"><MapPin size={20} color="#10b981" /></div>
                  <h4>Geospatial Coordinates</h4>
                  <p className="font-mono">
                    {currentProfile?.farm?.location?.lat 
                      ? `${Number(currentProfile.farm.location.lat).toFixed(6)}° N, ${Number(currentProfile.farm.location.lng).toFixed(6)}° E` 
                      : 'Coordinates not calibrated'}
                  </p>
                  <span className="detail-sub">Mapped on satellite layer</span>
                </div>

                <div className="twin-detail-card">
                  <div className="detail-icon"><Layers size={20} color="#10b981" /></div>
                  <h4>Surface Area & Boundary</h4>
                  <p>
                    {areaAcres ? `${areaAcres} Acres` : 'Boundary unmeasured'}
                  </p>
                  <span className="detail-sub">
                    {currentProfile?.farm?.boundary?.points?.length || 0} polygon corner vertices
                  </span>
                </div>

                <div className="twin-detail-card">
                  <div className="detail-icon"><Droplet size={20} color="#0284c7" /></div>
                  <h4>Water Source</h4>
                  <p>{waterSource || 'Not specified'}</p>
                  <span className="detail-sub">Direct Farm Twin calibration</span>
                </div>

                <div className="twin-detail-card">
                  <div className="detail-icon"><Sprout size={20} color="#10b981" /></div>
                  <h4>Registered Crop</h4>
                  <p>{cropName ? `${cropName} ${currentProfile?.farm?.variety ? `(${currentProfile.farm.variety})` : ''}` : 'None specified (Optional)'}</p>
                  <span className="detail-sub">{currentProfile?.farm?.soilType || 'Soil: Default terrain'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: ALERTS (Dedicated Full Alerts Page - Requirement 145) */}
        {activeTab === 'alerts' && (
          <div className="tab-pane-container alerts-tab-pane animate-fadeIn">
            <div className="alerts-full-page">
              <header className="alerts-page-heading">
                <button
                  type="button"
                  className="alerts-back-button"
                  onClick={() => setActiveTab('home')}
                >
                  <ArrowLeft size={18} aria-hidden="true" />
                  <span>Back to Farm</span>
                </button>
                <div className="alerts-title-row">
                  <span className="alerts-title-icon"><Bell size={22} aria-hidden="true" /></span>
                  <div>
                    <h2>Farm Alerts</h2>
                    <p>Important updates and advisories for your farm</p>
                  </div>
                </div>
              </header>

              <section className="alerts-farm-context" aria-label="Saved farm location">
                <span className="alerts-context-icon"><MapPin size={20} aria-hidden="true" /></span>
                <div>
                  <strong>Your Farm</strong>
                  <span>{farmCoordinateText}</span>
                  <small>{hasSavedCoordinates ? 'Saved farm coordinates for location-based farm updates.' : 'Add a farm location to receive location-based farm updates.'}</small>
                </div>
                {!hasSavedCoordinates && (
                  <button type="button" onClick={onEditFarm}>Set up farm</button>
                )}
              </section>

              <section className={`alerts-status-card ${hasCriticalAlert ? 'critical' : attentionCount ? 'advisory' : ''}`} aria-live="polite">
                <div className="alerts-status-icon"><Info size={20} aria-hidden="true" /></div>
                <div>
                  <span className="alerts-section-label">Farm status</span>
                  <h3>{!preferences.notificationsEnabled ? t('alerts.disabledTitle') : alertsLoading ? 'Checking farm updates…' : alertsError ? 'Alerts unavailable' : alertsStatusTitle}</h3>
                  <p>
                    {!preferences.notificationsEnabled
                      ? t('alerts.disabledDescription')
                      : alertsLoading
                      ? 'Loading notifications for your account.'
                      : alertsError
                        ? 'We could not retrieve your notifications.'
                        : hasCriticalAlert
                          ? 'Review the critical notification below.'
                          : attentionCount
                            ? 'Review your latest farm advisories below.'
                            : 'Your farm is being monitored. No critical alerts have been reported.'}
                  </p>
                </div>
                {!alertsLoading && !alertsError && (
                  <span className="alerts-status-pill">
                    {unreadAlertsCount ? `${unreadAlertsCount} unread` : 'All caught up'}
                  </span>
                )}
              </section>

              <div className="alerts-filter-row" role="group" aria-label="Filter farm alerts">
                {['All', 'Weather', 'Farm', 'AI', 'Emergency'].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`alerts-filter-chip ${alertsFilter === filter ? 'selected' : ''}`}
                    aria-pressed={alertsFilter === filter}
                    onClick={() => setAlertsFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <section className="alerts-items-feed" aria-live="polite">
                <div className="alerts-feed-heading">
                  <h3>{alertsFilter === 'All' ? 'Recent updates' : `${alertsFilter} updates`}</h3>
                  {!alertsLoading && !alertsError && <span>{filteredAlerts.length} updates</span>}
                </div>
                {!preferences.notificationsEnabled ? (
                  <div className="alerts-empty-state" role="status">
                    <Info size={22} aria-hidden="true" />
                    <button type="button" onClick={() => setActiveTab('settings')}>
                      {t('alerts.openSettings')} <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                ) : alertsLoading ? (
                  <div className="alerts-loading-list" role="status" aria-label="Loading notifications">
                    <div /><div /><div />
                  </div>
                ) : alertsError ? (
                  <div className="alerts-request-error" role="alert">
                    <Info size={21} aria-hidden="true" />
                    <div><strong>Notifications are temporarily unavailable</strong><span>{alertsError}</span></div>
                    <button type="button" onClick={retryAlerts}>Try again <RefreshCw size={15} aria-hidden="true" /></button>
                  </div>
                ) : filteredAlerts.length ? (
                  <div className="alerts-notification-list">
                    {notificationUpdateError && <p className="alerts-inline-error" role="alert">{notificationUpdateError}</p>}
                    {filteredAlerts.map((notification) => {
                      const type = String(notification.type || 'farm').toLowerCase();
                      const severityValue = String(notification.severity || 'info').toLowerCase();
                      const severity = ['info', 'advisory', 'important', 'emergency', 'critical'].includes(severityValue)
                        ? severityValue
                        : 'info';
                      const Icon = alertIcon(type);
                      return (
                        <article className={`alerts-notification-card severity-${severity} ${notification.read ? 'is-read' : 'is-unread'}`} key={notification.id}>
                          <span className="alerts-notification-icon"><Icon size={19} aria-hidden="true" /></span>
                          <div className="alerts-notification-copy">
                            <div className="alerts-notification-meta">
                              <span>{type === 'ai' ? 'AI' : type.charAt(0).toUpperCase() + type.slice(1)}</span>
                              <span className={`alerts-severity-label severity-${severity}`}>{severity}</span>
                              {!notification.read && <span className="alerts-unread-indicator">Unread</span>}
                              <time dateTime={notification.createdAt || undefined}>{alertAge(notification.createdAt)}</time>
                            </div>
                            <h4>{notification.title}</h4>
                            <p>{notification.message}</p>
                            {!notification.read && (
                              <button
                                type="button"
                                className="alerts-mark-read"
                                onClick={() => void handleMarkNotificationRead(notification.id)}
                              >
                                <Check size={15} aria-hidden="true" /> Mark as read
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="alerts-empty-state">
                    <span className="alerts-empty-icon"><Bell size={26} aria-hidden="true" /></span>
                    <h3>You're all caught up</h3>
                    <p>{alertsFilter === 'All' ? 'No new alerts or advisories for your farm.' : `No ${alertsFilter.toLowerCase()} alerts are available.`}</p>
                    <span>Important weather and farm updates will appear here when available.</span>
                    <button type="button" onClick={() => setActiveTab('home')}>Back to Farm</button>
                  </div>
                )}
              </section>

            </div>
          </div>
        )}

        {/* TAB: SETTINGS (Farm Configuration & Setup - Requirement 57) */}
        {activeTab === 'settings' && (
          <div className="tab-pane-container animate-fadeIn">
            <SettingsCenter
              profile={currentProfile}
              onEditFarm={onEditFarm}
              onLogout={onLogout}
              onAccountDeleted={onAccountDeleted}
              onOpenHelp={() => setActiveTab('expert')}
              onOpenWeather={() => setActiveTab('weather')}
            />
          </div>
        )}
      </main>

      {/* 3. BOTTOM NAVIGATION BAR */}
      <nav className="agri-bottom-navbar">
        <button 
          type="button" 
          className={`bottom-nav-item ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => setActiveTab('ai')}
          title="AgriShield AI"
          aria-label="AI"
        >
          <Bot size={20} />
          <span className="bottom-nav-label">{t('nav.ai')}</span>
          {activeTab === 'ai' && <span className="bottom-nav-pill-indicator"></span>}
        </button>

        <button
          type="button"
          className={`bottom-nav-item ${activeTab === 'shop' ? 'active' : ''}`}
          onClick={() => {
            setShopContext({});
            setActiveTab('shop');
          }}
          title="Shop seeds and fertilizers"
          aria-label="Shop"
        >
          <ShoppingBag size={20} aria-hidden="true" />
          <span className="bottom-nav-label">{t('nav.shop')}</span>
          {activeTab === 'shop' && <span className="bottom-nav-pill-indicator"></span>}
        </button>

        <button 
          type="button" 
          className={`bottom-nav-item ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={openAlerts}
          title="System Alerts & Notifications"
        >
          <Bell size={20} />
          <span className="bottom-nav-label">{t('nav.alerts')}</span>
          {activeTab === 'alerts' && <span className="bottom-nav-pill-indicator"></span>}
        </button>

        <button 
          type="button" 
          className={`bottom-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
          title="Settings & Setup"
        >
          <SettingsIcon size={20} />
          <span className="bottom-nav-label">{t('nav.settings')}</span>
          {activeTab === 'settings' && <span className="bottom-nav-pill-indicator"></span>}
        </button>
      </nav>
    </div>
  );
}
