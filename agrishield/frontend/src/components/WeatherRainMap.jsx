import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const normalizeLocation = (location) => {
  const latitude = Number(location?.latitude ?? location?.lat);
  const longitude = Number(location?.longitude ?? location?.lng);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }
  return [latitude, longitude];
};

const normalizeBoundary = (points = []) => points.map((point) => {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  return [
    Number(point?.latitude ?? point?.lat),
    Number(point?.longitude ?? point?.lng)
  ];
}).filter(([latitude, longitude]) =>
  Number.isFinite(latitude) && Number.isFinite(longitude) &&
  latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
);

const sampleColor = (status) => ({
  rain: '#dc2626',
  possible: '#f59e0b',
  'no-rain': '#16a34a'
}[status] || '#64748b');

function bindTextPopup(layer, lines) {
  const content = document.createElement('div');
  lines.forEach((line) => {
    const row = document.createElement('div');
    row.textContent = line;
    content.appendChild(row);
  });
  layer.bindPopup(content);
}

function valueAtTime(sample, selectedTime) {
  const hours = sample?.weather?.hourly || [];
  return hours.find((hour) => hour.time === selectedTime) || sample?.weather || {};
}

function valueColor(layer, value, status) {
  if (layer === 'clouds') {
    if (!Number.isFinite(value)) return '#64748b';
    return value >= 75 ? '#334155' : value >= 45 ? '#64748b' : '#38bdf8';
  }
  if (layer === 'precipitation') {
    if (!Number.isFinite(value)) return '#64748b';
    return value >= 1 ? '#2563eb' : value > 0 ? '#38bdf8' : '#94a3b8';
  }
  return sampleColor(status);
}

export default function WeatherRainMap({
  farmLocation,
  boundaryPoints = [],
  rainAnalysis,
  activeLayer,
  selectedTime,
  radarFrame,
  onRadarTileError
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const dataLayersRef = useRef(null);
  const radarLayerRef = useRef(null);
  const farmMarkerRef = useRef(null);
  const normalizedLocation = normalizeLocation(farmLocation);
  const normalizedBoundary = normalizeBoundary(boundaryPoints);

  useEffect(() => {
    if (!containerRef.current || !normalizedLocation || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: normalizedLocation,
      zoom: 14,
      zoomControl: true,
      scrollWheelZoom: true
    });
    L.tileLayer(SATELLITE_TILES, {
      maxZoom: 19,
      attribution: 'Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }).addTo(map);
    dataLayersRef.current = L.layerGroup().addTo(map);
    farmMarkerRef.current = L.circleMarker(normalizedLocation, {
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#16845b',
      fillOpacity: 1
    }).addTo(map);
    bindTextPopup(farmMarkerRef.current, ['Saved farm location']);
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
      dataLayersRef.current = null;
      radarLayerRef.current = null;
      farmMarkerRef.current = null;
    };
  }, [normalizedLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !normalizedLocation || !farmMarkerRef.current) return;
    farmMarkerRef.current.setLatLng(normalizedLocation);

    if (normalizedBoundary.length >= 3) {
      const bounds = L.latLngBounds(normalizedBoundary);
      bounds.extend(normalizedLocation);
      map.fitBounds(bounds.pad(0.18), { maxZoom: 17 });
    } else {
      map.setView(normalizedLocation, 14);
    }
  }, [normalizedLocation, normalizedBoundary]);

  useEffect(() => {
    const map = mapRef.current;
    const group = dataLayersRef.current;
    if (!map || !group || !normalizedLocation) return;
    group.clearLayers();

    if (normalizedBoundary.length >= 3) {
      L.polygon(normalizedBoundary, {
        color: '#f8fafc',
        weight: 3,
        opacity: 1,
        fillColor: '#16845b',
        fillOpacity: 0.13
      }).addTo(group);
    }

    const cells = rainAnalysis?.cells || [];
    cells.forEach((cell) => {
      if (cell.id === 'center') return;
      const latitude = Number(cell.latitude);
      const longitude = Number(cell.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const reading = valueAtTime(cell, selectedTime);
      const status = reading.status || cell.weather?.status;
      const precipitation = Number(reading.precipitationMm ?? reading.precipitation);
      const probability = Number(reading.precipitationProbability ?? reading.probability);
      const cloudCover = Number(reading.cloudCover);
      const windDirection = Number(reading.windDirection);
      const chosenValue = activeLayer === 'clouds'
        ? cloudCover
        : activeLayer === 'precipitation'
          ? precipitation
          : probability;
      const marker = L.circleMarker([latitude, longitude], {
        radius: activeLayer === 'precipitation'
          ? Math.max(7, Math.min(18, 7 + (Number.isFinite(precipitation) ? precipitation * 2 : 0)))
          : 9,
        color: '#ffffff',
        weight: 2,
        fillColor: valueColor(activeLayer, chosenValue, status),
        fillOpacity: activeLayer === 'clouds'
          ? Math.max(0.24, Math.min(0.72, Number.isFinite(cloudCover) ? cloudCover / 120 : 0.35))
          : 0.72
      }).addTo(group);
      bindTextPopup(marker, [
        cell.label || 'Nearby sample',
        status === 'rain' ? 'Rain likely' : status === 'possible' ? 'Rain possible' : 'No significant rain',
        `Rain probability: ${Number.isFinite(probability) ? `${Math.round(probability)}%` : 'not available'}`,
        `Precipitation: ${Number.isFinite(precipitation) ? `${precipitation.toFixed(1)} mm` : 'not available'}`,
        `Cloud cover: ${Number.isFinite(cloudCover) ? `${Math.round(cloudCover)}%` : 'not available'}`,
        `Wind direction: ${Number.isFinite(windDirection) ? `${Math.round(windDirection)}°` : 'not available'}`
      ]);

      if (activeLayer === 'wind' && Number.isFinite(windDirection)) {
        const windMarker = L.marker([latitude, longitude], {
          icon: L.divIcon({
            className: 'weather-wind-icon',
            html: `<span style="transform:rotate(${(windDirection + 180) % 360}deg)">➤</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          }),
          interactive: false
        }).addTo(group);
        windMarker.setZIndexOffset(500);
      }
    });
  }, [activeLayer, normalizedLocation, normalizedBoundary, rainAnalysis, selectedTime]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (radarLayerRef.current) {
      map.removeLayer(radarLayerRef.current);
      radarLayerRef.current = null;
    }
    if (activeLayer !== 'radar' || !radarFrame?.available || !radarFrame.tileUrlTemplate) return;

    const layer = L.tileLayer(radarFrame.tileUrlTemplate, {
      opacity: 0.68,
      maxZoom: 12,
      attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">Weather radar: RainViewer</a>'
    });
    layer.on('tileerror', () => onRadarTileError?.());
    layer.addTo(map);
    radarLayerRef.current = layer;
    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      if (radarLayerRef.current === layer) radarLayerRef.current = null;
    };
  }, [activeLayer, radarFrame, onRadarTileError]);

  const resetToFarm = () => {
    const map = mapRef.current;
    if (!map || !normalizedLocation) return;
    if (normalizedBoundary.length >= 3) {
      map.fitBounds(L.latLngBounds([...normalizedBoundary, normalizedLocation]).pad(0.18), { maxZoom: 17 });
    } else {
      map.setView(normalizedLocation, 14);
    }
  };

  if (!normalizedLocation) return null;

  return (
    <div className="weather-map-shell">
      <div className="weather-leaflet-map" ref={containerRef} aria-label="Interactive weather map centered on the saved farm" />
      <button type="button" className="weather-map-reset" onClick={resetToFarm} aria-label="Reset map to saved farm" title="Reset map to farm">
        Reset to farm
      </button>
    </div>
  );
}
