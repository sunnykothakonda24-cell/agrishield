import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Droplets,
  Layers,
  Loader2,
  MapPin,
  Pencil,
  Ruler,
  ShieldCheck,
  Sprout,
  UserRound,
} from 'lucide-react';

const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const WATER_LABELS = {
  Borewell: { title: 'Borewell', category: 'Groundwater', description: 'Groundwater from a borewell' },
  Well: { title: 'Open Well', category: 'Groundwater', description: 'Water drawn from an open well' },
  Canal: { title: 'Canal', category: 'Surface water', description: 'Water supplied through an irrigation canal' },
  River: { title: 'River', category: 'Surface water', description: 'Water taken from a nearby river' },
  Rainwater: { title: 'Farm Pond', category: 'Rainwater / storage', description: 'Water collected and stored on the farm' },
  Tank: { title: 'Storage Tank', category: 'Storage', description: 'Water stored in a farm tank' }
};

const SOIL_LABELS = {
  black: 'Black soil',
  red: 'Red soil',
  sandy: 'Sandy soil',
  clay: 'Clay soil',
  loamy: 'Loamy soil',
  brown: 'Brown soil',
  alluvial: 'Alluvial soil'
};

function safeText(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    return text && text !== '[object Object]' ? text : '';
  }
  if (!value || typeof value !== 'object') return '';
  return safeText(value.name ?? value.label ?? value.title ?? value.type ?? value.source);
}

function titleCase(value) {
  return safeText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function coordinateLabel(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Farm location not provided';
  const latDirection = latitude < 0 ? 'S' : 'N';
  const lonDirection = longitude < 0 ? 'W' : 'E';
  return `${Math.abs(latitude).toFixed(6)}° ${latDirection}, ${Math.abs(longitude).toFixed(6)}° ${lonDirection}`;
}

function maskedMobile(mobile) {
  const digits = safeText(mobile).replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : 'Phone number not provided';
}

function getBoundaryPoints(boundary) {
  return (Array.isArray(boundary?.points) ? boundary.points : [])
    .map((point) => {
      if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
      return [
        Number(point?.latitude ?? point?.lat),
        Number(point?.longitude ?? point?.lng)
      ];
    })
    .filter(([latitude, longitude]) =>
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    );
}

function formatArea(boundary) {
  const acres = Number(boundary?.areaAcres ?? boundary?.area?.acres);
  if (Number.isFinite(acres) && acres > 0) return `${acres.toLocaleString(undefined, { maximumFractionDigits: 2 })} acres`;
  const squareMeters = Number(boundary?.areaSqMeters ?? boundary?.area?.squareMeters);
  if (Number.isFinite(squareMeters) && squareMeters > 0) {
    return `${squareMeters.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²`;
  }
  return '';
}

function formatPerimeter(boundary) {
  const meters = Number(boundary?.perimeterMeters);
  if (!Number.isFinite(meters) || meters <= 0) return '';
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`
    : `${meters.toLocaleString(undefined, { maximumFractionDigits: 0 })} m`;
}

function ReviewSection({ icon: Icon, title, editStep, onEditStep, children, className = '' }) {
  return (
    <section className={`review-summary-card ${className}`}>
      <div className="review-summary-heading">
        <div className="review-summary-icon"><Icon size={19} aria-hidden="true" /></div>
        <h3>{title}</h3>
        <button
          type="button"
          className="review-edit-button"
          onClick={() => onEditStep(editStep)}
          aria-label={`Edit ${title.toLowerCase()}`}
        >
          <Pencil size={15} aria-hidden="true" />
          <span>Edit</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="review-summary-content">{children}</div>
    </section>
  );
}

export default function ReviewFarm({
  farmerName,
  mobile,
  location,
  boundaryData,
  farmData,
  waterData,
  onEditStep,
  onSaveAndContinue,
  saving = false
}) {
  const miniMapRef = useRef(null);
  const miniMapInstanceRef = useRef(null);
  const boundaryLayerRef = useRef(null);
  const saveLockRef = useRef(false);
  const [mapError, setMapError] = useState(false);

  const centerLat = Number(location?.latitude ?? location?.lat);
  const centerLng = Number(location?.longitude ?? location?.lng);
  const hasLocation = Number.isFinite(centerLat) && centerLat >= -90 && centerLat <= 90 &&
    Number.isFinite(centerLng) && centerLng >= -180 && centerLng <= 180;
  const points = getBoundaryPoints(boundaryData);
  const pointsKey = points.map(([latitude, longitude]) => `${latitude},${longitude}`).join(';');
  const area = formatArea(boundaryData);
  const perimeter = formatPerimeter(boundaryData);
  const cropName = titleCase(farmData?.crop);
  const cropVariety = titleCase(farmData?.variety);
  const cropStage = titleCase(farmData?.stage);
  const rawSoil = safeText(farmData?.soilType);
  const soilName = rawSoil ? SOIL_LABELS[rawSoil.toLowerCase()] || `${titleCase(rawSoil)} soil` : '';

  const rawWater = typeof waterData === 'string'
    ? safeText(waterData)
    : safeText(waterData?.source ?? waterData?.otherSource);
  const knownWater = WATER_LABELS[rawWater];
  const waterTitle = knownWater?.title || rawWater;
  const waterDescription = knownWater?.description || (rawWater ? 'Your selected water source' : "You can add this later from Farm Settings.");
  const waterCategory = knownWater?.category || (rawWater ? 'Custom source' : '');

  useEffect(() => {
    if (!miniMapRef.current || !hasLocation || miniMapInstanceRef.current) return undefined;

    const map = L.map(miniMapRef.current, {
      center: [centerLat, centerLng],
      zoom: 16,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      attributionControl: false
    });
    const tiles = L.tileLayer(SATELLITE_TILES, { maxZoom: 19 });
    tiles.on('tileerror', () => setMapError(true));
    tiles.on('load', () => setMapError(false));
    tiles.addTo(map);
    L.circleMarker([centerLat, centerLng], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#16845b',
      fillOpacity: 1
    }).addTo(map);
    boundaryLayerRef.current = L.layerGroup().addTo(map);
    miniMapInstanceRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      miniMapInstanceRef.current = null;
      boundaryLayerRef.current = null;
    };
  }, [centerLat, centerLng, hasLocation]);

  useEffect(() => {
    const map = miniMapInstanceRef.current;
    const boundaryLayer = boundaryLayerRef.current;
    if (!map || !boundaryLayer) return;
    boundaryLayer.clearLayers();
    const boundaryCoordinates = pointsKey
      ? pointsKey.split(';').map((point) => point.split(',').map(Number))
      : [];

    if (boundaryCoordinates.length >= 3) {
      const polygon = L.polygon(boundaryCoordinates, {
        color: '#ffffff',
        weight: 5,
        opacity: 0.9,
        fillColor: '#16845b',
        fillOpacity: 0.25
      }).addTo(boundaryLayer);
      L.polygon(boundaryCoordinates, {
        color: '#16845b',
        weight: 2,
        opacity: 1,
        fillOpacity: 0
      }).addTo(boundaryLayer);
      map.fitBounds(polygon.getBounds(), { padding: [24, 24], maxZoom: 18 });
    } else {
      map.setView([centerLat, centerLng], 16);
    }
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [centerLat, centerLng, pointsKey]);

  const handleCreateFarm = async () => {
    if (saving || saveLockRef.current) return;
    saveLockRef.current = true;
    try {
      await onSaveAndContinue();
    } finally {
      saveLockRef.current = false;
    }
  };

  const completedItems = [
    ['Farmer details', Boolean(safeText(farmerName))],
    ['Farm location', hasLocation],
    ['Farm boundary', points.length >= 3],
    ['Crop details', Boolean(cropName)],
    ['Water source', Boolean(rawWater)]
  ];

  return (
    <section className="flow-card premium-card farm-step-card review-step-card animate-fadeIn" aria-labelledby="review-step-title">
      <div className="farm-step-heading">
        <div className="farm-step-heading-copy">
          <span className="farm-step-count">Step 7 of 7</span>
          <h2 className="step-title" id="review-step-title">Review Your Farm</h2>
          <p className="farm-step-lead">Everything looks good?</p>
          <p className="step-subtitle">Review your farm details before creating your farm.</p>
        </div>
        <span className="farm-step-complete-badge"><CheckCircle2 size={16} /> 7 of 7</span>
      </div>

      <div className="farm-progress-heading">
        <span>Farm setup</span>
        <span>Step 7 of 7</span>
      </div>
      <div className="farm-progress-segments" role="img" aria-label="Farm setup, step 7 of 7">
        {Array.from({ length: 7 }, (_, index) => <span key={index} className="complete" />)}
      </div>

      <div className="review-summary-grid">
        <ReviewSection icon={UserRound} title="Farmer" editStep="name" onEditStep={onEditStep} className="review-farmer-card">
          <strong className="review-primary-value">{safeText(farmerName) || 'Name not provided'}</strong>
          <span className="review-secondary-value">{maskedMobile(mobile)}</span>
        </ReviewSection>

        <section className="review-summary-card review-location-card" aria-labelledby="review-location-title">
          <div className="review-summary-heading">
            <div className="review-summary-icon"><MapPin size={19} aria-hidden="true" /></div>
            <h3 id="review-location-title">Farm Location</h3>
            <button
              type="button"
              className="review-edit-button"
              onClick={() => onEditStep('location')}
              aria-label="Edit farm location and boundary"
            >
              <Pencil size={15} aria-hidden="true" /><span>Edit</span><ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
          {hasLocation ? (
            <>
              <div className={`review-map-preview ${mapError ? 'has-map-error' : ''}`}>
                <div ref={miniMapRef} className="mini-map-viewport" aria-label="Satellite preview of the saved farm boundary" />
                {mapError && (
                  <div className="review-map-fallback" role="status">
                    <MapPin size={20} aria-hidden="true" />
                    <span>Satellite imagery is unavailable. Your saved location and boundary are unchanged.</span>
                  </div>
                )}
                <span className="mini-satellite-tag">Esri Satellite</span>
              </div>
              <div className="review-location-details">
                <div>
                  <strong>Farm location</strong>
                  <span className="review-coordinate-value">{coordinateLabel(centerLat, centerLng)}</span>
                </div>
                <span className={`review-boundary-status ${points.length >= 3 ? 'saved' : ''}`}>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  {points.length >= 3 ? 'Farm boundary saved' : 'Boundary not provided'}
                </span>
              </div>
            </>
          ) : (
            <div className="review-map-fallback review-map-missing" role="status">
              <MapPin size={22} aria-hidden="true" />
              <span>Farm location not provided</span>
            </div>
          )}
        </section>

        <ReviewSection icon={Ruler} title="Farm Size" editStep="boundary" onEditStep={onEditStep}>
          {area ? <strong className="review-primary-value">{area}</strong> : <span className="review-secondary-value">Area not available</span>}
          <span className="review-secondary-value">{points.length} boundary {points.length === 1 ? 'point' : 'points'}</span>
          {perimeter && (
            <div className="review-measurement-row">
              <span>Perimeter</span><strong>{perimeter}</strong>
            </div>
          )}
        </ReviewSection>

        <ReviewSection icon={Sprout} title="Crop" editStep="crop" onEditStep={onEditStep}>
          <strong className="review-primary-value">{cropName || 'Not provided'}</strong>
          {cropVariety && <span className="review-secondary-value">Variety: {cropVariety}</span>}
          {cropStage && <span className="review-secondary-value">Growth stage: {cropStage}</span>}
        </ReviewSection>

        <ReviewSection icon={Layers} title="Soil" editStep="soil" onEditStep={onEditStep}>
          <strong className="review-primary-value">{soilName || 'Not provided'}</strong>
        </ReviewSection>

        <ReviewSection icon={Droplets} title="Water Source" editStep="water" onEditStep={onEditStep}>
          <strong className="review-primary-value">{waterTitle || 'Not specified'}</strong>
          {waterCategory && <span className="review-category-value">{waterCategory}</span>}
          <span className="review-secondary-value">{waterDescription}</span>
        </ReviewSection>
      </div>

      <section className="review-completion-summary" aria-label="Farm setup summary">
        <div className="review-completion-heading">
          <CheckCircle2 size={18} aria-hidden="true" />
          <strong>Farm setup review</strong>
        </div>
        <div className="review-completion-items">
          {completedItems.map(([label, completed]) => (
            <span className={completed ? 'completed' : 'not-provided'} key={label}>
              <Check size={14} aria-hidden="true" />{label}
            </span>
          ))}
        </div>
      </section>

      <div className="review-submit-area">
        <button
          type="button"
          className="btn-primary-action large save-btn review-create-button"
          onClick={() => void handleCreateFarm()}
          disabled={saving}
        >
          {saving ? (
            <><Loader2 size={19} className="spin" aria-hidden="true" /><span>Creating your farm...</span></>
          ) : (
            <><ShieldCheck size={19} aria-hidden="true" /><span>Create My Farm</span><ArrowRight size={18} aria-hidden="true" /></>
          )}
        </button>
        <p>You can update these details later from Farm Settings.</p>
      </div>
      <button
        type="button"
        className="review-back-link"
        onClick={() => onEditStep('water')}
        disabled={saving}
      >
        <ArrowLeft size={17} aria-hidden="true" /> Back to water source
      </button>
    </section>
  );
}
