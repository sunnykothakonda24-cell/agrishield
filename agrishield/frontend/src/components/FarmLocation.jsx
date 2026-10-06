import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';
import { searchLocations } from '../services/api';
import { 
  MapPin, 
  ArrowRight, 
  ArrowLeft, 
  Loader2, 
  Search,
  X,
  AlertCircle,
  Navigation,
  RotateCcw,
  Trash2
} from 'lucide-react';

const normalizePoints = (boundaryPoints = []) => boundaryPoints.map((point) => {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  return [Number(point.lat ?? point.latitude), Number(point.lng ?? point.longitude)];
}).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

const pointKey = (point) => {
  const lat = Number(point?.[0] ?? point?.lat ?? point?.latitude);
  const lng = Number(point?.[1] ?? point?.lng ?? point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
};

const hasCoordinates = (value) => value?.lat !== null && value?.lat !== undefined &&
  value?.lng !== null && value?.lng !== undefined &&
  value.lat !== '' && value.lng !== '' &&
  Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng)) &&
  Number(value.lat) >= -90 && Number(value.lat) <= 90 &&
  Number(value.lng) >= -180 && Number(value.lng) <= 180;

const samePoints = (first, second) => first.length === second.length &&
  first.every(([lat, lng], index) => lat === second[index][0] && lng === second[index][1]);

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lng2 - lng1);
  const latitude1 = toRadians(lat1);
  const latitude2 = toRadians(lat2);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, a)));
};

const calculateGeometry = (points) => {
  if (points.length < 3) return { valid: false, areaSqMeters: 0, perimeterMeters: 0, lengthMeters: 0, widthMeters: 0 };

  try {
    const ring = points.map(([lat, lng]) => [lng, lat]);
    ring.push([...ring[0]]);
    const polygon = turf.polygon([ring]);
    if (!turf.booleanValid(polygon) || turf.kinks(polygon).features.length > 0) {
      return { valid: false, areaSqMeters: 0, perimeterMeters: 0, lengthMeters: 0, widthMeters: 0 };
    }

    const areaSqMeters = turf.area(polygon);
    const perimeterMeters = turf.length(turf.lineString(ring), { units: 'meters' });
    if (!Number.isFinite(areaSqMeters) || areaSqMeters <= 0 || !Number.isFinite(perimeterMeters)) {
      return { valid: false, areaSqMeters: 0, perimeterMeters: 0, lengthMeters: 0, widthMeters: 0 };
    }

    const latitudes = points.map(([lat]) => lat);
    const longitudes = points.map(([, lng]) => lng);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    const centerLat = (minLat + maxLat) / 2;
    const lengthMeters = haversineMeters(minLat, centerLat, maxLat, centerLat);
    const widthMeters = haversineMeters(centerLat, minLng, centerLat, maxLng);

    return { valid: true, areaSqMeters, perimeterMeters, lengthMeters, widthMeters };
  } catch {
    return { valid: false, areaSqMeters: 0, perimeterMeters: 0, lengthMeters: 0, widthMeters: 0 };
  }
};

export default function FarmLocation({ 
  location, 
  setLocation,
  boundaryData,
  setBoundaryData,
  onNext, 
  onBack,
  saving = false
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonLayerRef = useRef(null);
  const markersGroupRef = useRef(null);
  const markerRef = useRef(null);
  const pointsRef = useRef([]);
  const locationRef = useRef(location);
  const mapClickHandlerRef = useRef(null);
  const isDraggingPointRef = useRef(false);
  const searchControllerRef = useRef(null);
  const searchSequenceRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState(location?.displayName || '');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchTimeoutRef = useRef(null);

  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [points, setPoints] = useState(() => normalizePoints(boundaryData?.points));
  pointsRef.current = points;
  locationRef.current = location;
  const geometry = calculateGeometry(points);
  const confirmedLocation = hasCoordinates(location);

  const satelliteTileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  const updateBoundaryPoints = (updatedPoints) => {
    const sanitizedPoints = normalizePoints(updatedPoints);
    pointsRef.current = sanitizedPoints;
    setPoints(sanitizedPoints);
    const updatedGeometry = calculateGeometry(sanitizedPoints);
    setBoundaryData({
      points: sanitizedPoints,
      areaAcres: updatedGeometry.valid ? (updatedGeometry.areaSqMeters / 4046.8564224).toFixed(2) : null,
      areaSqMeters: updatedGeometry.valid ? Math.round(updatedGeometry.areaSqMeters) : 0,
      perimeterMeters: updatedGeometry.valid ? Math.round(updatedGeometry.perimeterMeters) : 0,
      lengthMeters: updatedGeometry.valid ? Math.round(updatedGeometry.lengthMeters) : 0,
      widthMeters: updatedGeometry.valid ? Math.round(updatedGeometry.widthMeters) : 0
    });
  };

  const renderBoundaryLayers = (currentPoints) => {
    const map = mapInstanceRef.current;
    if (!map || !markersGroupRef.current) return;

    if (polygonLayerRef.current) map.removeLayer(polygonLayerRef.current);
    polygonLayerRef.current = null;

    if (currentPoints.length >= 3) {
      polygonLayerRef.current = L.polygon(currentPoints, {
        color: '#facc15',
        weight: 3,
        opacity: 1,
        fillColor: '#22c55e',
        fillOpacity: 0.18,
        lineJoin: 'round'
      }).addTo(map);
    } else if (currentPoints.length === 2) {
      polygonLayerRef.current = L.polyline(currentPoints, {
        color: '#facc15',
        weight: 3,
        opacity: 1,
        dashArray: '6, 6'
      }).addTo(map);
    }

    if (isDraggingPointRef.current) return;
    markersGroupRef.current.clearLayers();
    currentPoints.forEach((point, index) => {
      const vertexIcon = L.divIcon({
        className: 'vertex-pin-node',
        html: `<div class="vertex-dot"><span class="vertex-num">${index + 1}</span></div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });
      const marker = L.marker(point, { icon: vertexIcon, draggable: true, autoPan: true });
      marker.on('dragstart', () => { isDraggingPointRef.current = true; });
      marker.on('drag', (event) => {
        const position = event.target.getLatLng();
        const updated = [...pointsRef.current];
        updated[index] = [Number(position.lat.toFixed(6)), Number(position.lng.toFixed(6))];
        updateBoundaryPoints(updated);
      });
      marker.on('dragend', (event) => {
        const position = event.target.getLatLng();
        const updated = [...pointsRef.current];
        updated[index] = [Number(position.lat.toFixed(6)), Number(position.lng.toFixed(6))];
        isDraggingPointRef.current = false;
        updateBoundaryPoints(updated);
        renderBoundaryLayers(updated);
      });
      markersGroupRef.current.addLayer(marker);
    });

    if (currentPoints.length > 0) {
      const bounds = L.latLngBounds(currentPoints);
      if (!map.getBounds().contains(bounds)) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
  };

  const handleMapClick = (event) => {
    const nextPoint = [Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))];
    if (!Number.isFinite(nextPoint[0]) || !Number.isFinite(nextPoint[1])) return;
    const existingKeys = new Set(pointsRef.current.map((point) => pointKey(point)));
    const nextKey = pointKey(nextPoint);
    if (!nextKey || existingKeys.has(nextKey)) return;
    updateBoundaryPoints([...pointsRef.current, nextPoint]);
  };
  mapClickHandlerRef.current = handleMapClick;

  useEffect(() => {
    if (!mapContainerRef.current || !hasCoordinates(location) || mapInstanceRef.current) return undefined;

    const map = L.map(mapContainerRef.current, {
      center: [Number(location.lat), Number(location.lng)],
      zoom: 16,
      zoomControl: true
    });
    const mapContainer = mapContainerRef.current;
    const invalidateMapSize = () => map.invalidateSize({ pan: false, debounceMoveend: true });
    const initialResizeFrame = window.requestAnimationFrame(invalidateMapSize);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(invalidateMapSize);
    resizeObserver?.observe(mapContainer);
    L.tileLayer(satelliteTileUrl, {
      attribution: '&copy; Esri, Maxar, Earthstar Geographics | AgriShield',
      maxZoom: 19
    }).addTo(map);
    markersGroupRef.current = L.featureGroup().addTo(map);

    const locationIcon = L.divIcon({
      className: 'agri-map-pin',
      html: '<div class="pin-pulse"></div><div class="pin-marker"><svg width="34" height="34" viewBox="0 0 24 24" fill="#10b981" stroke="#ffffff" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.8" fill="#ffffff"/></svg></div>',
      iconSize: [40, 40],
      iconAnchor: [20, 36]
    });
    const locationMarker = L.marker([location.lat, location.lng], { icon: locationIcon, draggable: true });
    locationMarker.addTo(map);
    locationMarker.on('dragend', () => {
      const position = locationMarker.getLatLng();
      const currentLocation = locationRef.current;
      if (pointsRef.current.length > 0 &&
          !window.confirm('Moving the selected location will discard the current farm boundary. Continue?')) {
        locationMarker.setLatLng([currentLocation.lat, currentLocation.lng]);
        return;
      }
      if (pointsRef.current.length > 0) updateBoundaryPoints([]);
      setLocation({
        lat: Number(position.lat.toFixed(6)),
        lng: Number(position.lng.toFixed(6)),
        source: 'manual',
        displayName: null
      });
      setGeoError('');
    });
    map.on('click', (event) => mapClickHandlerRef.current?.(event));
    markerRef.current = locationMarker;
    mapInstanceRef.current = map;
    renderBoundaryLayers(pointsRef.current);

    return () => {
      window.cancelAnimationFrame(initialResizeFrame);
      resizeObserver?.disconnect();
      map.remove();
      if (mapInstanceRef.current === map) mapInstanceRef.current = null;
      markersGroupRef.current = null;
      polygonLayerRef.current = null;
      markerRef.current = null;
    };
  }, [location?.lat, location?.lng]);

  useEffect(() => {
    const restoredPoints = normalizePoints(boundaryData?.points);
    if (!samePoints(restoredPoints, pointsRef.current)) {
      updateBoundaryPoints(restoredPoints);
    }
  }, [boundaryData?.points]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !hasCoordinates(location)) return;
    const nextLatLng = [Number(location.lat), Number(location.lng)];
    if (markerRef.current) markerRef.current.setLatLng(nextLatLng);
    const wasSearchOrGpsSelection = location.source === 'search' || location.source === 'gps';
    if (pointsRef.current.length === 0) {
      map.flyTo(nextLatLng, wasSearchOrGpsSelection ? 16 : map.getZoom(), { duration: 1.2 });
    }
  }, [location?.lat, location?.lng, location?.source]);

  useEffect(() => {
    renderBoundaryLayers(points);
  }, [points]);

  useEffect(() => () => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchControllerRef.current?.abort();
  }, []);

  const applyLocation = (lat, lng, source, displayName) => {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lng) || lng < -180 || lng > 180) {
      setGeoError('The selected location did not include valid coordinates.');
      return false;
    }
    const currentPoints = pointsRef.current;
    const changed = hasCoordinates(location) &&
      (Number(location.lat) !== lat || Number(location.lng) !== lng);
    if (changed && currentPoints.length > 0 &&
      !window.confirm('Changing the farm location will discard the current boundary. Continue?')) {
      return false;
    }
    if (changed && currentPoints.length > 0) updateBoundaryPoints([]);
    setLocation({ lat, lng, source, displayName: displayName || null });
    setGeoError('');
    setSearchQuery(displayName || '');
    return true;
  };

  const handleSearchChange = (event) => {
    const query = event.target.value;
    setSearchQuery(query);
    setSearchError('');
    setSearchResults([]);
    setShowResults(false);
    searchSequenceRef.current += 1;
    searchControllerRef.current?.abort();
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (query.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      setIsSearching(false);
      return;
    }

    const sequence = searchSequenceRef.current;
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchControllerRef.current = controller;
      try {
        const results = await searchLocations(query.trim(), { signal: controller.signal });
        if (sequence !== searchSequenceRef.current) return;
        setSearchResults(results);
        setSearchError(results.length === 0 ? 'No matching locations found.' : '');
        setShowResults(true);
      } catch (error) {
        if (error.name !== 'AbortError' && sequence === searchSequenceRef.current) {
          setSearchResults([]);
          setSearchError(error.message || 'Location search failed. Please try again.');
          setShowResults(true);
        }
      } finally {
        if (sequence === searchSequenceRef.current) setIsSearching(false);
      }
    }, 650);
  };

  const handleSelectSearchResult = (item) => {
    const lat = Number(Number(item.latitude).toFixed(6));
    const lng = Number(Number(item.longitude).toFixed(6));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setSearchError('The selected location did not include valid coordinates.');
      return;
    }
    if (applyLocation(lat, lng, 'search', item.displayName)) setShowResults(false);
  };

  const handleUseMyGPS = () => {
    setGeoLoading(true);
    setGeoError('');
    if (!navigator.geolocation) {
      setGeoError('This browser does not support location access. Search for your farm location instead.');
      setGeoLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition((position) => {
      const lat = Number(position.coords.latitude.toFixed(6));
      const lng = Number(position.coords.longitude.toFixed(6));
      applyLocation(lat, lng, 'gps');
      setGeoLoading(false);
    }, (error) => {
      const messages = {
        1: 'Location permission was denied. Allow location access or search for your farm manually.',
        2: 'Your location is unavailable right now. Try again or search for your farm manually.',
        3: 'Location lookup timed out. Try again or search for your farm manually.'
      };
      setGeoError(messages[error.code] || 'Unable to access your location. Search for your farm manually.');
      setGeoLoading(false);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  };

  const handleConfirmAndNext = () => {
    if (!confirmedLocation) {
      setGeoError('Search for a farm location or use GPS first.');
      return;
    }
    if (points.length < 3) {
      setGeoError('Add at least 3 points to mark your farm boundary.');
      return;
    }
    if (!geometry.valid) {
      setGeoError('The boundary must enclose a valid area. Drag the points to correct any overlaps.');
      return;
    }
    setGeoError('');
    onNext();
  };

  const handleClear = () => updateBoundaryPoints([]);
  const handleUndo = () => {
    if (pointsRef.current.length === 0) return;
    updateBoundaryPoints(pointsRef.current.slice(0, -1));
  };
  const acres = geometry.valid ? (geometry.areaSqMeters / 4046.8564224).toFixed(2) : null;
  const areaSqMeters = geometry.valid ? Math.round(geometry.areaSqMeters) : null;
  const perimeterMeters = geometry.valid ? Math.round(geometry.perimeterMeters) : null;

  return (
    <div className="flow-card premium-card animate-fadeIn">
      <div className="card-header-badge">
        <MapPin size={18} className="badge-icon" />
        <span>Step 2 — Satellite Farm Location</span>
      </div>

      <div className="location-heading-box">
        <h2 className="step-title">Step 2 — Satellite Farm Location</h2>
        <p className="step-subtitle">
          Select the exact location and mark the boundary of your farm.
        </p>
      </div>

      <div className="satellite-map-outer-shell">
        
        <div className="map-floating-search-bar">
          <div className="search-input-wrapper">
            <Search size={18} className="search-icon" color="#64748b" />
            <input 
              type="text"
              className="map-search-input"
              placeholder="Search farm location. Enter village, locality, address or place..."
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => { if (searchResults.length > 0) setShowResults(true); }}
              aria-label="Search farm location"
            />
            {isSearching && <Loader2 size={16} className="search-spinner spin" color="#10b981" />}
            {searchQuery && !isSearching && (
              <button 
                type="button" 
                className="btn-clear-search"
                aria-label="Clear location search"
                onClick={() => {
                  searchSequenceRef.current += 1;
                  searchControllerRef.current?.abort();
                  setSearchQuery('');
                  setSearchResults([]);
                  setSearchError('');
                  setShowResults(false);
                  setIsSearching(false);
                }}
              >
                <X size={15} color="#94a3b8" />
              </button>
            )}
          </div>

          {showResults && (searchResults.length > 0 || searchError) && (
            <div className="search-results-dropdown" role="listbox" aria-label="Location search results">
              {searchError && <div className="search-result-message" role="status">{searchError}</div>}
              {searchResults.map((item) => (
                <button 
                  type="button"
                  key={`${item.latitude}-${item.longitude}`}
                  className="search-result-item"
                  role="option"
                  aria-selected="false"
                  onClick={() => handleSelectSearchResult(item)}
                >
                  <MapPin size={16} className="result-pin" color="#10b981" />
                  <div className="result-text-col">
                    <div className="result-title">{item.displayName}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={mapContainerRef} className="farm-map-viewport" aria-label="Satellite map for marking the farm boundary">
          {!confirmedLocation && (
            <div className="map-location-prompt">
              Search for the farm or use GPS to load satellite imagery.
            </div>
          )}
        </div>
        
        <button
          type="button"
          className="map-floating-gps"
          onClick={handleUseMyGPS}
          disabled={geoLoading}
        >
          {geoLoading ? <Loader2 size={16} className="spin" /> : <Navigation size={16} />}
          <span>{geoLoading ? 'Locating…' : 'Use My Location'}</span>
        </button>

        <div className="boundary-map-toolbar">
          <span className="boundary-point-count">{points.length} boundary points</span>
          <div className="boundary-tool-actions">
            <button 
              type="button" 
              className="toolbar-btn undo-btn" 
              onClick={handleUndo} 
              disabled={points.length === 0}
              aria-label="Undo latest boundary point"
            >
              <RotateCcw size={15} />
              <span>Undo Point</span>
            </button>
            <button 
              type="button" 
              className="toolbar-btn clear-btn" 
              onClick={handleClear} 
              disabled={points.length === 0}
              aria-label="Clear farm boundary"
            >
              <Trash2 size={15} />
              <span>Clear Boundary</span>
            </button>
          </div>
        </div>
      </div>

      {geoError && <div className="location-feedback" role="alert"><AlertCircle size={16} /><span>{geoError}</span></div>}
      {confirmedLocation && points.length < 3 && (
        <div className="boundary-validation-hint" role="status">Add at least 3 points to mark your farm boundary.</div>
      )}
      {confirmedLocation && points.length >= 3 && !geometry.valid && (
        <div className="location-feedback" role="alert">
          <AlertCircle size={16} />
          <span>The boundary must enclose a valid area. Drag the points to correct any overlaps.</span>
        </div>
      )}

      <div className="location-selected-card">
        <div className="coords-readout-box">
          <div className="coord-col">
            <span className="coord-label">Selected Location</span>
            <span className="coord-value font-mono">
              {confirmedLocation ? `${Number(location.lat).toFixed(6)}, ${Number(location.lng).toFixed(6)}` : 'Not selected'}
            </span>
          </div>
          <div className="coord-col">
            <span className="coord-label">Farm Area</span>
            <span className="coord-value font-mono">
              {geometry.valid ? `${acres} acres (${areaSqMeters.toLocaleString()} m²)` : 'Area unavailable'}
            </span>
          </div>
          <div className="coord-col">
            <span className="coord-label">Perimeter</span>
            <span className="coord-value font-mono">
              {geometry.valid ? `${perimeterMeters.toLocaleString()} m` : 'Unavailable'}
            </span>
          </div>
        </div>
      </div>

      <div className="step-actions split location-step-actions">
        <button type="button" className="btn-secondary-action" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>

        <button 
          type="button" 
          className="btn-primary-action" 
          onClick={handleConfirmAndNext}
          disabled={!confirmedLocation || points.length < 3 || !geometry.valid || saving}
        >
          <span>{saving ? 'Saving Farm…' : 'Confirm Farm Boundary'}</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
