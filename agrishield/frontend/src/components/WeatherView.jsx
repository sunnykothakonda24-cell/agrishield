import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudRain,
  Cloud,
  Droplets,
  Info,
  LocateFixed,
  Map,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  RefreshCw,
  Thermometer,
  Wind
} from 'lucide-react';
import { getFarmWeather, getRecentRadarFrame } from '../services/api';
import { useAppPreferences } from '../services/useAppPreferences';
import { translate } from '../i18n';
import WeatherRainMap from './WeatherRainMap';

function displayValue(value, suffix = '') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return 'Not available';
  }
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function getValue(record, aliases, index) {
  for (const alias of aliases) {
    const value = record?.[alias];
    if (Array.isArray(value) && index !== undefined) {
      if (value[index] !== null && value[index] !== undefined) return value[index];
    } else if (value !== null && value !== undefined && !Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeSeries(series, fields) {
  if (!series) return [];
  if (Array.isArray(series)) {
    return series.map((item) => ({
      time: item?.time ?? item?.timestamp ?? item?.date ?? item?.hour,
      temperature: getValue(item, fields.temperature),
      apparentTemperature: getValue(item, fields.apparentTemperature),
      humidity: getValue(item, fields.humidity),
      precipitation: getValue(item, fields.precipitation),
      rainChance: getValue(item, fields.rainChance),
      wind: getValue(item, fields.wind),
      windDirection: getValue(item, fields.windDirection),
      cloudCover: getValue(item, fields.cloudCover),
      high: getValue(item, fields.high),
      low: getValue(item, fields.low),
      condition: getValue(item, fields.condition)
    }));
  }

  const times = series.time ?? series.times ?? series.timestamp ?? series.date ?? [];
  if (!Array.isArray(times)) return [];
  return times.map((time, index) => ({
    time,
    temperature: getValue(series, fields.temperature, index),
    apparentTemperature: getValue(series, fields.apparentTemperature, index),
    humidity: getValue(series, fields.humidity, index),
    precipitation: getValue(series, fields.precipitation, index),
    rainChance: getValue(series, fields.rainChance, index),
    wind: getValue(series, fields.wind, index),
    windDirection: getValue(series, fields.windDirection, index),
    cloudCover: getValue(series, fields.cloudCover, index),
    high: getValue(series, fields.high, index),
    low: getValue(series, fields.low, index),
    condition: getValue(series, fields.condition, index)
  }));
}

const CURRENT_FIELDS = {
  temperature: ['temperatureC', 'temperature_2m', 'temperature', 'tempC'],
  apparentTemperature: ['apparentTemperatureC', 'apparentTemperature', 'apparent_temperature'],
  humidity: ['humidityPercent', 'relative_humidity_2m', 'humidity'],
  precipitation: ['precipitationMm', 'precipitationSum', 'precipitation', 'precipitation_mm', 'precipitation_sum', 'rainMm', 'rain', 'showersMm', 'showers'],
  rainChance: ['precipitationProbability', 'precipitationProbabilityMax', 'precipitation_probability', 'precipitation_probability_max', 'rainChancePercent'],
  wind: ['windSpeedKmh', 'windSpeedMax', 'wind_speed_10m', 'wind_speed_10m_max', 'windSpeed', 'windKmh'],
  windDirection: ['windDirection', 'windDirectionDegrees', 'wind_direction_10m'],
  cloudCover: ['cloudCover', 'cloudCoverPercent', 'cloud_cover'],
  high: ['temperature_2m_max', 'temperatureMaxC', 'temperatureMax'],
  low: ['temperature_2m_min', 'temperatureMinC', 'temperatureMin'],
  condition: ['condition', 'description', 'weatherDescription']
};

function formatTime(value, options) {
  if (value === null || value === undefined || value === '') return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(undefined, options);
}

function sampleRain(sample) {
  const direct = getValue(sample, [
    'precipitationMm',
    'precipitation_mm',
    'precipitation_sum',
    'precipitationSumMm',
    'rainfallMm',
    'rainfall',
    'rainMm',
    'rain_mm',
    'forecastRainMm',
    'forecastRain',
    'rain'
  ]);
  if (direct !== undefined) return direct;

  const weather = sample?.weather;
  const weatherRain = getValue(weather, ['precipitationMm', 'precipitation', 'rainMm', 'rain']);
  if (weatherRain !== undefined && weatherRain !== null) return weatherRain;
  const forecast = sample?.forecast ?? sample?.hourly ?? sample?.daily;
  const nested = getValue(forecast, [
    'precipitation_sum', 'precipitationSum', 'precipitationMm',
    'precipitation', 'rain', 'rainMm'
  ], 0);
  return nested;
}

function getRainSamples(rainAnalysis) {
  if (Array.isArray(rainAnalysis)) return rainAnalysis;
  if (!rainAnalysis || typeof rainAnalysis !== 'object') return [];
  const collections = [
    rainAnalysis.samples,
    rainAnalysis.nearbySamples,
    rainAnalysis.nearbyForecastSamples,
    rainAnalysis.points,
    rainAnalysis.locations,
    rainAnalysis.nearby,
    rainAnalysis.results
  ];
  return collections.find(Array.isArray) ?? [];
}

function sourceLabel(source) {
  if (typeof source === 'string') return source;
  return source?.publisher ?? source?.provider ?? source?.name ?? source?.source;
}

function formatSourceStatus(status) {
  if (typeof status === 'string') return status;
  if (!status || typeof status !== 'object') return '';
  if (typeof status.status === 'string') return status.status;
  if (typeof status.message === 'string') return status.message;
  return Object.entries(status)
    .map(([provider, value]) => {
      if (typeof value === 'string' || typeof value === 'number') return `${provider}: ${value}`;
      if (!value || typeof value !== 'object') return null;
      const detail = value.message || value.status || (value.configured ? 'configured' : 'not configured');
      return `${value.provider || provider}: ${detail}`;
    })
    .filter(Boolean)
    .join(' · ');
}

function sampleRainChance(sample) {
  return getValue(sample?.weather, ['probability', 'precipitationProbability', 'rainChancePercent']);
}

function sampleRainLabel(sample) {
  const status = sample?.weather?.status;
  if (status === 'rain') return 'Rain likely';
  if (status === 'possible') return 'Rain possible';
  if (status === 'no-rain') return 'No rain expected';
  return 'Forecast sample';
}

function normalizeFarmLocation(profile) {
  const location = profile?.farm?.location || profile?.farm?.farmLocation;
  const latitude = Number(location?.latitude ?? location?.lat);
  const longitude = Number(location?.longitude ?? location?.lng);
  if (!location || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function compassDirection(degrees) {
  if (!Number.isFinite(Number(degrees))) return null;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((Number(degrees) % 360) / 45) % names.length];
}

function forecastSummary(analysis) {
  switch (analysis?.classification) {
    case 'RAIN_DIRECTIONAL':
      return `Forecast rain is more likely ${analysis.direction} of your farm.`;
    case 'RAIN_WIDESPREAD':
      return 'Forecast rain appears fairly widespread around your farm.';
    case 'NO_SIGNIFICANT_RAIN':
      return 'No significant rain is indicated around your farm in the sampled forecast.';
    case 'RAIN_INCONCLUSIVE':
      return 'A clear rain direction cannot be determined from the available forecast samples.';
    default:
      return 'Nearby rain analysis is not available.';
  }
}

export default function WeatherView({ onAskWeatherToAI, onOpenFarmSetup, profile }) {
  const { language } = useAppPreferences();
  const t = (key, values) => translate(language, key, values);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeLayer, setActiveLayer] = useState('forecast-rain');
  const [selectedHourIndex, setSelectedHourIndex] = useState(0);
  const [playingTimeline, setPlayingTimeline] = useState(false);
  const [radarFrame, setRadarFrame] = useState(null);
  const [radarError, setRadarError] = useState('');
  const weatherRequestRef = useRef(false);
  const farmLocation = normalizeFarmLocation(profile);

  const loadWeather = useCallback(async () => {
    if (weatherRequestRef.current) return;
    weatherRequestRef.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await getFarmWeather();
      setWeather(result);
      if (!result?.available) {
        setError(result?.status === 'location_unavailable'
          ? 'Farm location is not configured yet.'
          : "We couldn't retrieve the latest weather data. Please try again.");
      }
    } catch (loadError) {
      console.warn('[WeatherView] Farm weather request failed:', loadError.message);
      setWeather(null);
      setError("We couldn't retrieve the latest weather data. Please try again.");
    } finally {
      weatherRequestRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeather();
  }, [loadWeather]);

  const loadRadar = async () => {
    setRadarError('');
    try {
      const result = await getRecentRadarFrame();
      setRadarFrame(result);
      if (!result?.available) {
        setRadarError(result?.message || 'Radar data is unavailable for this area right now.');
      }
    } catch (radarLoadError) {
      setRadarFrame({ available: false });
      setRadarError(radarLoadError.message || 'Radar data is unavailable for this area right now.');
    }
  };
  const handleRadarTileError = useCallback(() => {
    setRadarError('Radar tiles could not be loaded for the current map view. Forecast layers remain available.');
  }, []);

  const data = weather?.data ?? weather;
  const current = weather?.available ? (data?.current ?? data?.currentWeather ?? weather?.current ?? data) : null;
  const forecast = data?.forecast ?? weather?.forecast ?? {};
  const hourly = normalizeSeries(data?.hourly ?? forecast?.hourly ?? weather?.hourly, CURRENT_FIELDS);
  const daily = normalizeSeries(data?.daily ?? forecast?.daily ?? weather?.daily ?? (
    Array.isArray(forecast?.time) ? forecast : null
  ), CURRENT_FIELDS);
  const timelineHours = hourly.slice(0, 24);
  useEffect(() => {
    if (!playingTimeline) return undefined;
    const timer = window.setInterval(() => {
      setSelectedHourIndex((index) => (timelineHours.length ? (index + 1) % timelineHours.length : 0));
    }, 1400);
    return () => window.clearInterval(timer);
  }, [playingTimeline, timelineHours.length]);
  const rainAnalysis = weather?.rainAnalysis ?? data?.rainAnalysis;
  const nearbySamples = getRainSamples(rainAnalysis).length
    ? getRainSamples(rainAnalysis)
    : data?.nearbySamples
    ?? data?.nearbyForecastSamples
    ?? data?.nearbyForecast?.samples
    ?? (Array.isArray(data?.nearbyForecast) ? data.nearbyForecast : undefined)
    ?? data?.nearby?.samples
    ?? data?.rainSamples
    ?? forecast?.nearbySamples
    ?? weather?.nearbySamples
    ?? weather?.nearbyForecast?.samples
    ?? [];
  const validSamples = Array.isArray(nearbySamples)
    ? nearbySamples.filter((sample) => sampleRain(sample) !== null
      && sampleRain(sample) !== undefined
      && sampleRain(sample) !== ''
      && Number.isFinite(Number(sampleRain(sample))))
    : [];
  const maxSampleRain = Math.max(0, ...validSamples.map((sample) => Number(sampleRain(sample))));
  const sources = Array.isArray(weather?.sources)
    ? weather.sources.map(sourceLabel).filter(Boolean)
    : [];
  const sourceStatusLabel = formatSourceStatus(weather?.sourceStatus);
  const selectedHour = timelineHours[Math.min(selectedHourIndex, Math.max(0, timelineHours.length - 1))] || null;
  const displayedWeather = selectedHour || current || {};
  const boundaryValue = profile?.farm?.boundary?.points
    || profile?.farm?.farmBoundary
    || profile?.farm?.boundary
    || [];
  const boundaryPoints = Array.isArray(boundaryValue) ? boundaryValue : [];
  const windDegrees = displayedWeather.windDirection ?? current?.windDirection;
  const windFrom = windDegrees === null || windDegrees === undefined
    ? null
    : compassDirection(Number(windDegrees));
  const windToward = windFrom
    ? compassDirection((Number(windDegrees) + 180) % 360)
    : null;
  const unavailableMessage = weather?.status === 'location_unavailable'
    ? 'Add a saved farm location to view location-based weather.'
    : weather?.status === 'not_configured'
      ? 'Weather information is not configured.'
      : 'Weather information is temporarily unavailable.';

  return (
    <div className="weather-view-container animate-fadeIn">
      <header className="weather-header-box">
        <div className="weather-title-row">
          <span className="weather-heading-icon"><CloudRain size={23} aria-hidden="true" /></span>
          <div>
            <h3>{t('weather.title')}</h3>
            <p>Forecasts for your saved farm location, from the configured weather provider.</p>
          </div>
          {!loading && (
            <button type="button" className="weather-refresh-button" onClick={() => void loadWeather()} aria-label="Refresh weather">
              <RefreshCw size={17} aria-hidden="true" /> Refresh
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <p className="weather-empty-state" role="status">Loading weather for your farm...</p>
      ) : error ? (
        <div className="weather-empty-state error" role="alert">
          <p>{error}</p>
          <button type="button" className="weather-refresh-button" onClick={() => void loadWeather()} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" /> {loading ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      ) : current ? (
        <>
          <p className="weather-data-timestamp">
            Weather data: {weather.provider || 'Open-Meteo'} · Updated {formatTime(weather.retrievedAt || weather.timestamp)}
          </p>
          <div className="weather-source-status" aria-label="Weather forecast source information">
            <span>Data type: location-based forecast, not live radar.</span>
            {(weather.provider || sources.length > 0) && (
              <span>Forecast source: {weather.provider || sources.join(', ')}</span>
            )}
            {sourceStatusLabel && (
              <span>Forecast provider status: {sourceStatusLabel}</span>
            )}
          </div>

          {farmLocation && (
            <section className="weather-rain-map-card" aria-labelledby="weather-rain-map-title">
              <div className="weather-section-heading weather-map-heading">
                <div>
                  <span className="weather-section-eyebrow">Saved farm location</span>
                  <h4 id="weather-rain-map-title">Weather near your farm</h4>
                  <p className="weather-coordinates">
                    {farmLocation.latitude.toFixed(6)}, {farmLocation.longitude.toFixed(6)}
                  </p>
                </div>
                {timelineHours.length > 0 && (
                  <div className="weather-layer-selector" role="group" aria-label="Weather map layer">
                    <button
                      type="button"
                      className={activeLayer === 'forecast-rain' ? 'active' : ''}
                      onClick={() => setActiveLayer('forecast-rain')}
                      aria-pressed={activeLayer === 'forecast-rain'}
                      title="Show forecast rain"
                    >
                      <CloudRain size={16} aria-hidden="true" /><span>Forecast rain</span>
                    </button>
                    <button
                      type="button"
                      className={activeLayer === 'precipitation' ? 'active' : ''}
                      onClick={() => setActiveLayer('precipitation')}
                      aria-pressed={activeLayer === 'precipitation'}
                      title="Show forecast precipitation"
                    >
                      <Droplets size={16} aria-hidden="true" /><span>Precipitation</span>
                    </button>
                    <button
                      type="button"
                      className={activeLayer === 'clouds' ? 'active' : ''}
                      onClick={() => setActiveLayer('clouds')}
                      aria-pressed={activeLayer === 'clouds'}
                      title="Show forecast cloud cover"
                    >
                      <Cloud size={16} aria-hidden="true" /><span>Cloud cover</span>
                    </button>
                    <button
                      type="button"
                      className={activeLayer === 'wind' ? 'active' : ''}
                      onClick={() => setActiveLayer('wind')}
                      aria-pressed={activeLayer === 'wind'}
                      title="Show forecast wind direction"
                    >
                      <Wind size={16} aria-hidden="true" /><span>Wind</span>
                    </button>
                    {!radarFrame?.available && !radarError && (
                      <button
                        type="button"
                        className={activeLayer === 'radar' ? 'active' : ''}
                        onClick={() => {
                          setActiveLayer('radar');
                          void loadRadar();
                        }}
                        aria-pressed={activeLayer === 'radar'}
                        title="Load recent radar observation"
                      >
                        <Map size={16} aria-hidden="true" /><span>Recent radar</span>
                      </button>
                    )}
                    {radarFrame?.available && (
                      <button
                        type="button"
                        className={activeLayer === 'radar' ? 'active' : ''}
                        onClick={() => setActiveLayer('radar')}
                        aria-pressed={activeLayer === 'radar'}
                        title="Show recent RainViewer radar observation"
                      >
                        <Map size={16} aria-hidden="true" /><span>Recent radar</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <WeatherRainMap
                farmLocation={farmLocation}
                boundaryPoints={boundaryPoints}
                rainAnalysis={rainAnalysis}
                activeLayer={activeLayer}
                selectedTime={selectedHour?.time}
                radarFrame={radarFrame}
                onRadarTileError={handleRadarTileError}
              />

              {radarError && activeLayer === 'radar' && (
                <div className="weather-radar-unavailable" role="status">
                  <Info size={16} aria-hidden="true" />
                  <span>{radarError} Open-Meteo forecast layers are still available.</span>
                  <button type="button" onClick={() => void loadRadar()}>Retry radar</button>
                </div>
              )}
              {activeLayer === 'radar' && radarFrame?.available && (
                <p className="weather-radar-attribution">
                  Recent radar · RainViewer · Frame time {formatTime(radarFrame.timestamp)}. No future radar nowcast is used.
                </p>
              )}

              {timelineHours.length > 0 && (
                <div className="weather-timeline">
                  <div className="weather-timeline-heading">
                    <div>
                      <span className="weather-section-eyebrow">Forecast timeline</span>
                      <strong>{formatTime(selectedHour?.time, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</strong>
                    </div>
                    <div className="weather-timeline-controls">
                      <button
                        type="button"
                        onClick={() => setSelectedHourIndex((index) => Math.max(0, index - 1))}
                        disabled={selectedHourIndex === 0}
                        aria-label="Previous forecast hour"
                        title="Previous hour"
                      ><SkipBack size={17} /></button>
                      <button
                        type="button"
                        onClick={() => setPlayingTimeline((playing) => !playing)}
                        aria-label={playingTimeline ? 'Pause forecast timeline' : 'Play forecast timeline'}
                        title={playingTimeline ? 'Pause' : 'Play'}
                      >{playingTimeline ? <Pause size={17} /> : <Play size={17} />}</button>
                      <button
                        type="button"
                        onClick={() => setSelectedHourIndex((index) => Math.min(timelineHours.length - 1, index + 1))}
                        disabled={selectedHourIndex >= timelineHours.length - 1}
                        aria-label="Next forecast hour"
                        title="Next hour"
                      ><SkipForward size={17} /></button>
                    </div>
                  </div>
                  <input
                    className="weather-timeline-slider"
                    type="range"
                    min="0"
                    max={timelineHours.length - 1}
                    value={Math.min(selectedHourIndex, timelineHours.length - 1)}
                    onChange={(event) => {
                      setPlayingTimeline(false);
                      setSelectedHourIndex(Number(event.target.value));
                    }}
                    aria-label="Select an hourly forecast"
                  />
                  <div className="weather-selected-conditions">
                    <span>Rain chance <strong>{displayValue(selectedHour?.rainChance, '%')}</strong></span>
                    <span>Precipitation <strong>{displayValue(selectedHour?.precipitation, ' mm')}</strong></span>
                    <span>Cloud cover <strong>{displayValue(selectedHour?.cloudCover, '%')}</strong></span>
                    <span>Wind <strong>{displayValue(selectedHour?.wind, ' km/h')}</strong></span>
                    <span>Wind direction <strong>{windFrom && windToward ? `${windFrom} → ${windToward}` : 'Not available'}</strong></span>
                  </div>
                </div>
              )}

              <div className="weather-farmer-summary">
                <CloudRain size={19} aria-hidden="true" />
                <div>
                  <strong>Forecast rain around your farm</strong>
                  <p>{forecastSummary(rainAnalysis)}</p>
                  <small>Rain locations are sampled point forecasts, not observed rainfall boundaries.</small>
                </div>
              </div>

              {windFrom && windToward && (
                <div className="weather-wind-summary">
                  <Wind size={18} aria-hidden="true" />
                  <p>
                    Expected atmospheric flow based on forecast wind: <strong>{windFrom} → {windToward}</strong>
                    {displayedWeather.wind !== undefined && displayedWeather.wind !== null
                      ? ` at ${displayValue(displayedWeather.wind, ' km/h')}`
                      : ''}.
                    This is not observed cloud tracking.
                  </p>
                </div>
              )}
            </section>
          )}

          <section className="weather-current-panel" aria-labelledby="weather-current-title">
            <div className="weather-section-heading">
              <div>
                <span className="weather-section-eyebrow">Farm conditions</span>
                <h4 id="weather-current-title">Current weather</h4>
              </div>
              {getValue(current, CURRENT_FIELDS.condition) && (
                <span className="weather-condition-pill">{getValue(current, CURRENT_FIELDS.condition)}</span>
              )}
            </div>
            <div className="weather-guidance-grid">
              <article className="weather-card">
                <Thermometer size={20} aria-hidden="true" />
                <h5>Temperature</h5>
                <p>{displayValue(getValue(current, CURRENT_FIELDS.temperature), ' °C')}</p>
              </article>
              <article className="weather-card">
                <Thermometer size={20} aria-hidden="true" />
                <h5>Feels like</h5>
                <p>{displayValue(getValue(current, CURRENT_FIELDS.apparentTemperature), ' °C')}</p>
              </article>
              <article className="weather-card">
                <Droplets size={20} aria-hidden="true" />
                <h5>Humidity</h5>
                <p>{displayValue(getValue(current, CURRENT_FIELDS.humidity), '%')}</p>
              </article>
              <article className="weather-card">
                <CloudRain size={20} aria-hidden="true" />
                <h5>Rain</h5>
                <p>{displayValue(getValue(current, ['rainMm', 'rain']), ' mm')}</p>
              </article>
              <article className="weather-card">
                <Droplets size={20} aria-hidden="true" />
                <h5>Precipitation</h5>
                <p>{displayValue(getValue(current, CURRENT_FIELDS.precipitation), ' mm')}</p>
              </article>
              <article className="weather-card">
                <Cloud size={20} aria-hidden="true" />
                <h5>Cloud cover</h5>
                <p>{displayValue(getValue(current, CURRENT_FIELDS.cloudCover), '%')}</p>
              </article>
              <article className="weather-card">
                <Wind size={20} aria-hidden="true" />
                <h5>Wind speed</h5>
                <p>{displayValue(getValue(current, CURRENT_FIELDS.wind), ' km/h')}</p>
              </article>
              <article className="weather-card">
                <Wind size={20} aria-hidden="true" />
                <h5>Wind direction</h5>
                <p>{windFrom || 'Not available'}</p>
              </article>
            </div>
          </section>

          {hourly.length > 0 && (
            <section className="weather-forecast-section" aria-labelledby="weather-hourly-title">
              <div className="weather-section-heading">
                <div>
                  <span className="weather-section-eyebrow">Near-term outlook</span>
                  <h4 id="weather-hourly-title">Hourly forecast</h4>
                </div>
                <p>Forecast values from {weather.provider || 'the weather provider'}</p>
              </div>
              <div className="weather-hourly-list">
                {hourly.slice(0, 12).map((hour, index) => (
                  <article className="weather-hourly-card" key={`${hour.time}-${index}`}>
                    <strong>{formatTime(hour.time, { hour: 'numeric', minute: '2-digit' })}</strong>
                    <span className="weather-hourly-temperature">{displayValue(hour.temperature, '°')}</span>
                    <span><CloudRain size={14} aria-hidden="true" /> {displayValue(hour.precipitation, ' mm')}</span>
                    <span>Rain chance {displayValue(hour.rainChance, '%')}</span>
                    <span>Humidity {displayValue(hour.humidity, '%')}</span>
                    <span><Wind size={14} aria-hidden="true" /> {displayValue(hour.wind, ' km/h')}</span>
                  </article>
                ))}
              </div>
            </section>
          )}

          {daily.length > 0 && (
            <section className="weather-forecast-section" aria-labelledby="weather-daily-title">
              <div className="weather-section-heading">
                <div>
                  <span className="weather-section-eyebrow">Week ahead</span>
                  <h4 id="weather-daily-title">Daily forecast</h4>
                </div>
              </div>
              <div className="weather-forecast-list">
                {daily.slice(0, 7).map((day, index) => (
                  <article className="weather-forecast-row" key={`${day.time}-${index}`}>
                    <strong>{index === 0 ? 'Today' : formatTime(day.time, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                    <span>Temperature: {day.high !== undefined || day.low !== undefined
                      ? `${displayValue(day.high, ' °C')} / ${displayValue(day.low, ' °C')}`
                      : displayValue(day.temperature, ' °C')}</span>
                    <span>Rain chance: {displayValue(day.rainChance, '%')}</span>
                    <span>Expected rain: {displayValue(day.precipitation, ' mm')}</span>
                    <span>Max wind: {displayValue(day.wind, ' km/h')}</span>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="weather-forecast-section" aria-labelledby="weather-samples-title">
            <div className="weather-section-heading">
              <div>
                <span className="weather-section-eyebrow">Spatial forecast context</span>
                <h4 id="weather-samples-title">Nearby sampled forecast rain</h4>
              </div>
            </div>
            {validSamples.length > 0 ? (
              <>
                <p className="weather-samples-note">
                  Forecast rainfall reported for nearby sample points. This is not live radar, radar imagery, or a live rain map.
                </p>
                <div className="weather-sample-grid">
                  {validSamples.map((sample, index) => {
                    const rain = Number(sampleRain(sample));
                    const width = maxSampleRain > 0 ? (rain / maxSampleRain) * 100 : 0;
                    const rainChance = sampleRainChance(sample);
                    const sampleNameValue = sample.name ?? sample.label ?? sample.locationName ?? sample.location;
                    const sampleName = typeof sampleNameValue === 'string' && sampleNameValue.trim()
                      ? sampleNameValue
                      : `Sample ${index + 1}`;
                    return (
                      <article className="weather-sample-card" key={`${sampleName}-${index}`}>
                        <div className="weather-sample-heading">
                          <strong>{sampleName}</strong>
                          {(sample.distanceKm ?? sample.distance_km) !== undefined
                            && <span>{displayValue(sample.distanceKm ?? sample.distance_km, ' km away')}</span>}
                        </div>
                        <div className="weather-sample-bar" role="img" aria-label={`${sampleName}: ${displayValue(rain, ' millimeters')} forecast rain`}>
                          <span style={{ width: `${width}%` }} />
                        </div>
                        <p>{sampleRainLabel(sample)} · {displayValue(rain, ' mm')} forecast rain</p>
                        {rainChance !== undefined && rainChance !== null && (
                          <p>Rain probability: {displayValue(rainChance, '%')}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="weather-samples-note">Nearby sampled rain forecasts are not included in the available weather response.</p>
            )}
          </section>

          {Array.isArray(weather.sources) && weather.sources.map((source, index) => (
            source?.url && (
              <a key={`${sourceLabel(source) || 'weather-source'}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="weather-source-link">
                Forecast source: {sourceLabel(source) || weather.provider || 'Weather provider'} (not live radar)
              </a>
            )
          ))}
        </>
      ) : (
        <div className="weather-phase1-notice">
          <Info size={18} aria-hidden="true" />
          <div>
            <p>{farmLocation ? unavailableMessage : 'Farm location is not configured yet.'}</p>
            {!farmLocation && (
              <button type="button" className="help-secondary-button" onClick={onOpenFarmSetup}>
                <LocateFixed size={15} aria-hidden="true" /> Set up farm location
              </button>
            )}
          </div>
        </div>
      )}

      <div className="weather-action-card">
        <div>
          <h4>Need guidance about your farm conditions?</h4>
          <p>Ask the AI assistant. It will use weather data only when it is available.</p>
        </div>
        <button type="button" className="btn-ask-weather-ai" onClick={() => onAskWeatherToAI?.()}>
          Ask AI about Weather
        </button>
      </div>
    </div>
  );
}
