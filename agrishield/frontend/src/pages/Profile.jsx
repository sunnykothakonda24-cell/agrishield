import React, { useState, useEffect } from 'react';
import { 
  User, 
  MapPin, 
  Square, 
  Sprout, 
  CheckCircle2, 
  Bell, 
  Check, 
  ArrowLeft,
  Shield,
  Droplet,
  Layers
} from 'lucide-react';
import ProfileCard from '../components/ProfileCard';
import FarmLocation from '../components/FarmLocation';

import FarmDetails from '../components/FarmDetails';
import WaterDetails from '../components/WaterDetails';
import ReviewFarm from '../components/ReviewFarm';
import { saveFarmProfile, getFarmProfile } from '../services/api';

const PROGRESS_STEPS = [
  { key: 'name', number: '1', label: 'Name' },
  { key: 'location', number: '2', label: 'Location' },
  { key: 'boundary', number: '3', label: 'Boundary' },
  { key: 'crop', number: '4', label: 'Crop' },
  { key: 'soil', number: '5', label: 'Soil' },
  { key: 'water', number: '6', label: 'Water' },
  { key: 'review', number: '7', label: 'Review' },
];

const hasCoordinates = (value) => value?.lat !== null && value?.lat !== undefined &&
  value?.lng !== null && value?.lng !== undefined &&
  Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng)) &&
  Number(value.lat) >= -90 && Number(value.lat) <= 90 &&
  Number(value.lng) >= -180 && Number(value.lng) <= 180;

const hasValidBoundaryPoints = (points) => Array.isArray(points) && points.length >= 3 &&
  points.every((point) => {
    const lat = Array.isArray(point) ? Number(point[0]) : Number(point?.lat ?? point?.latitude);
    const lng = Array.isArray(point) ? Number(point[1]) : Number(point?.lng ?? point?.longitude);
    return Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
      Number.isFinite(lng) && lng >= -180 && lng <= 180;
  });

export default function Profile({ 
  verifiedMobile = '', 
  initialProfile = {}, 
  onProfileComplete, 
  onLogout 
}) {
  // Start on step 1 ('name'). Only after entering name does location become available.
  const [currentStep, setCurrentStep] = useState('name');
  const [saving, setSaving] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const [error, setError] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Form State — Starts EMPTY if not already saved (Requirements 1, 3)
  const [farmerName, setFarmerName] = useState(initialProfile?.farmerName || '');
  const [currentMobile, setCurrentMobile] = useState(verifiedMobile || initialProfile?.verifiedMobile || '');
  const [userId] = useState(initialProfile?.userId || null);
  const [location, setLocation] = useState(initialProfile?.farm?.location || null);

  const [boundaryData, setBoundaryData] = useState(initialProfile?.farm?.boundary || {
    points: [],
    areaAcres: '0.00',
    areaSqMeters: 0,
    lengthMeters: 0,
    widthMeters: 0
  });

  const [farmData, setFarmData] = useState({
    crop: initialProfile?.farm?.crop || '',
    variety: initialProfile?.farm?.variety || '',
    stage: initialProfile?.farm?.stage || '',
    plantingDate: initialProfile?.farm?.plantingDate || '',
    harvestDate: initialProfile?.farm?.harvestDate || '',
    soilType: initialProfile?.farm?.soilType || ''
  });

  const [waterData, setWaterData] = useState(
    initialProfile?.farm?.waterSource || initialProfile?.farm?.water?.otherSource || ''
  );

  // Restore the saved farmer profile on mount.
  useEffect(() => {
    const fetchFarmerProfile = async () => {
      if (!userId) return;
      setLoadingProfile(true);
      try {
        const res = await getFarmProfile(userId);
        if (res && res.data) {
          const d = res.data;
          if (d.farmerName) setFarmerName(d.farmerName);
          if (d.verifiedMobile) setCurrentMobile(d.verifiedMobile);
          if (hasCoordinates(d.farm?.location)) {
            setLocation(d.farm.location);
          }
          if (d.farm?.boundary) {
            setBoundaryData(d.farm.boundary);
          }
          if (d.farm) {
            setFarmData({
              crop: d.farm?.cropDetails?.name || d.farm?.crop || '',
              variety: d.farm?.cropDetails?.variety || d.farm?.variety || '',
              stage: d.farm?.cropDetails?.stage || '',
              plantingDate: d.farm?.cropDetails?.plantingDate || '',
              harvestDate: d.farm?.cropDetails?.harvestDate || '',
              soilType: d.farm?.soilDetails?.type || d.farm?.soilType || ''
            });
          }
          setWaterData(d.farm?.waterSource || '');
        }
      } catch (err) {
        if (err.message !== 'Farm profile not found in Firestore') {
          console.error('[Profile] Failed to restore saved farm profile:', err);
          setError(err.message || 'Unable to restore saved farm details. Please try again.');
        }
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchFarmerProfile();
  }, [userId]);

  const getActiveStepIndex = () => {
    if (currentStep === 'location') {
      return PROGRESS_STEPS.findIndex((step) => step.key === 'location');
    }
    const idx = PROGRESS_STEPS.findIndex(s => s.key === currentStep);
    return idx >= 0 ? idx : 0;
  };

  const buildProfilePayload = () => {
    const crop = farmData.crop?.trim() || '';
    const soilType = farmData.soilType?.trim() || '';
    const waterSource = typeof waterData === 'string'
      ? waterData.trim() || null
      : waterData?.source?.trim() || waterData?.otherSource?.trim() || null;

    return {
      userId,
      farmerName: farmerName.trim(),
      verifiedMobile: currentMobile,
      farm: {
        _id: initialProfile?.farm?._id || `farm-${userId}`,
        location: {
          lat: Number(location.lat),
          lng: Number(location.lng),
          displayName: location.displayName || null,
          village: location.village || null,
          district: location.district || null,
          state: location.state || null,
          country: location.country || null
        },
        boundary: boundaryData,
        crop: crop || null,
        cropDetails: crop ? {
          name: crop,
          variety: farmData.variety?.trim() || null,
          stage: farmData.stage?.trim() || null,
          plantingDate: farmData.plantingDate || null,
          harvestDate: farmData.harvestDate || null
        } : null,
        variety: farmData.variety?.trim() || null,
        stage: farmData.stage?.trim() || null,
        plantingDate: farmData.plantingDate || null,
        harvestDate: farmData.harvestDate || null,
        soilType: soilType || null,
        soilDetails: soilType ? { type: soilType } : null,
        waterSource,
        water: waterSource ? { source: waterSource, otherSource: waterSource } : null
      }
    };
  };

  const validateFarmForSave = () => {
    const boundaryPoints = boundaryData?.points || [];
    if (!userId || !currentMobile) {
      setError('Your verified account is required before saving farm details.');
      return false;
    }
    if (!farmerName.trim()) {
      setError('Enter your name before saving farm details.');
      return false;
    }
    if (!hasCoordinates(location)) {
      setError('Select a farm location before saving.');
      return false;
    }
    if (!hasValidBoundaryPoints(boundaryPoints)) {
      setError('Add at least 3 valid points to mark your farm boundary.');
      return false;
    }

    return true;
  };

  const handleConfirmBoundary = async () => {
    setError('');
    if (!validateFarmForSave()) return;

    setSaving(true);
    setLocationSaved(false);
    try {
      await saveFarmProfile(buildProfilePayload());
      setLocationSaved(true);
      setCurrentStep('crop');
    } catch (err) {
      console.error('[Profile] Farm save failed:', err);
      setError(err.message || 'Unable to save farm details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndContinue = async () => {
    setError('');
    if (!validateFarmForSave()) return;

    setSaving(true);
    try {
      const res = await saveFarmProfile(buildProfilePayload());
      setLocationSaved(true);
      onProfileComplete(res?.data || buildProfilePayload());
    } catch (err) {
      console.error('[Profile] Farm save failed:', err);
      setError(err.message || 'Unable to save farm details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const activeIndex = getActiveStepIndex();

  return (
    <div className="flow-page-shell animate-fadeIn">
      {/* Top Header */}
      <header className="agri-header wizard-header">
        <div className="header-left">
          <div className="header-brand">
            <div className="brand-logo-badge">
              <Shield size={20} color="#10b981" />
            </div>
            <div className="brand-titles">
              <h1 className="header-logo-text">AgriShield-AI</h1>
              <span className="header-subtag">Smart Farm Setup</span>
            </div>
          </div>
        </div>

        <div className="header-right">
          <button className="icon-action-btn" title="Notifications">
            <Bell size={18} />
          </button>
          <div className="farmer-profile-pill">
            <div className="header-avatar">
              <User size={16} />
            </div>
            <div className="farmer-name-tag">
              <span className="name-bold">{farmerName || 'Profile Setup'}</span>
              <span className="mobile-small font-mono">{currentMobile || 'Verified'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Stepper Progress Bar (Requirements 1, 30) */}
      <div className="stepper-container">
        <div className="stepper-track">
          {PROGRESS_STEPS.map((step, idx) => {
            const isCompleted = idx < activeIndex;
            const isCurrent = idx === activeIndex;

            return (
              <React.Fragment key={step.key}>
                <div 
                  className={`stepper-node ${isCurrent ? 'current' : ''} ${isCompleted ? 'completed' : ''} ${step.key === 'boundary' ? 'stepper-boundary-node' : ''}`}
                  onClick={() => {
                    // Allow navigating backwards or to already visited steps
                    if (isCompleted || (step.key === 'location' && farmerName.trim())) {
                      setCurrentStep(step.key === 'boundary' ? 'location' : step.key);
                    }
                  }}
                  title={step.label}
                >
                  <div className="node-circle">
                    {isCompleted ? <Check size={14} strokeWidth={3} /> : step.number}
                  </div>
                  <span className="node-label">{step.label}</span>
                </div>

                {idx < PROGRESS_STEPS.length - 1 && (
                  <div className={`stepper-line ${idx < activeIndex ? 'filled' : ''}`}></div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Step Render Area */}
      <div className="flow-content-area">
        {error && <div className="location-feedback" role="alert">{error}</div>}
        {currentStep === 'location' && saving && (
          <div className="location-feedback" role="status">Saving farm location...</div>
        )}
        {currentStep === 'location' && locationSaved && (
          <div className="location-feedback success" role="status">Farm location saved.</div>
        )}
        {currentStep === 'name' && (
          <ProfileCard
            farmerName={farmerName}
            setFarmerName={setFarmerName}
            mobile={currentMobile}
            setMobile={setCurrentMobile}
            userId={userId}
            onNext={() => setCurrentStep('location')}
          />
        )}

        {currentStep === 'location' && (
          <FarmLocation
            location={location}
            setLocation={setLocation}
            boundaryData={boundaryData}
            setBoundaryData={setBoundaryData}
            onNext={handleConfirmBoundary}
            onBack={() => setCurrentStep('name')}
            saving={saving}
          />
        )}

        {currentStep === 'crop' && (
          <FarmDetails
            mode="crop"
            farmData={farmData}
            setFarmData={setFarmData}
            onNext={() => setCurrentStep('soil')}
            onBack={() => setCurrentStep('location')}
          />
        )}

        {currentStep === 'soil' && (
          <FarmDetails
            mode="soil"
            farmData={farmData}
            setFarmData={setFarmData}
            onNext={() => setCurrentStep('water')}
            onBack={() => setCurrentStep('crop')}
          />
        )}

        {currentStep === 'water' && (
          <WaterDetails
            waterData={waterData}
            setWaterData={setWaterData}
            onNext={() => setCurrentStep('review')}
            onBack={() => setCurrentStep('soil')}
          />
        )}

        {currentStep === 'review' && (
          <ReviewFarm
            farmerName={farmerName}
            mobile={currentMobile}
            userId={userId}
            location={location}
            boundaryData={boundaryData}
            farmData={farmData}
            waterData={waterData}
            onEditStep={(stepKey) => setCurrentStep(stepKey)}
            onSaveAndContinue={handleSaveAndContinue}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}
