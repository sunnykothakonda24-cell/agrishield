const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const RAIN_ANALYSIS_CONFIG = Object.freeze({
  radiusKm: 10,
  forecastDays: 2,
  analysisHours: 6,
  significantPrecipitationMm: 0.2,
  likelyProbabilityPercent: 40,
  possibleProbabilityPercent: 30,
  directionalDifferencePercent: 15,
  widespreadWetSamples: 6,
  rainNowMm: 0.1,
  rainyWeatherCodes: Object.freeze([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
});
const cache = new Map();

function normalizeCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new TypeError('Valid latitude and longitude are required for weather data.');
  }
  return { latitude: lat, longitude: lon };
}

function readNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeRequestedTimezone(timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) return 'auto';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'auto';
  }
}

function parseProviderTime(value, utcOffsetSeconds = 0) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return new Date(value);
  return new Date(Date.parse(`${value}Z`) - utcOffsetSeconds * 1000);
}

function readHourly(payload, startTime, utcOffsetSeconds) {
  const times = payload.hourly?.time || [];
  const firstIndex = Math.max(0, times.findIndex((time) => {
    const date = parseProviderTime(time, utcOffsetSeconds);
    return Number.isFinite(date.getTime()) && date.getTime() >= startTime;
  }));
  return times.slice(firstIndex).map((time, index) => {
    const sourceIndex = firstIndex + index;
    return {
      time: parseProviderTime(time, utcOffsetSeconds).toISOString(),
      temperature: readNumber(payload.hourly?.temperature_2m?.[sourceIndex]),
      apparentTemperature: readNumber(payload.hourly?.apparent_temperature?.[sourceIndex]),
      humidity: readNumber(payload.hourly?.relative_humidity_2m?.[sourceIndex]),
      precipitation: readNumber(payload.hourly?.precipitation?.[sourceIndex]),
      precipitationProbability: readNumber(payload.hourly?.precipitation_probability?.[sourceIndex]),
      rain: readNumber(payload.hourly?.rain?.[sourceIndex]),
      showers: readNumber(payload.hourly?.showers?.[sourceIndex]),
      cloudCover: readNumber(payload.hourly?.cloud_cover?.[sourceIndex]),
      cloudCoverLow: readNumber(payload.hourly?.cloud_cover_low?.[sourceIndex]),
      cloudCoverMid: readNumber(payload.hourly?.cloud_cover_mid?.[sourceIndex]),
      cloudCoverHigh: readNumber(payload.hourly?.cloud_cover_high?.[sourceIndex]),
      windSpeed: readNumber(payload.hourly?.wind_speed_10m?.[sourceIndex]),
      windDirection: readNumber(payload.hourly?.wind_direction_10m?.[sourceIndex]),
      windGusts: readNumber(payload.hourly?.wind_gusts_10m?.[sourceIndex]),
      weatherCode: readNumber(payload.hourly?.weather_code?.[sourceIndex]),
      et0: readNumber(payload.hourly?.et0_fao_evapotranspiration?.[sourceIndex]),
      vapourPressureDeficit: readNumber(payload.hourly?.vapour_pressure_deficit?.[sourceIndex]),
      solarRadiation: readNumber(payload.hourly?.shortwave_radiation?.[sourceIndex])
    };
  });
}

function normalizeResponse(payload, requestedLocation, retrievedAt = new Date()) {
  if (!payload?.current?.time) {
    throw new Error('Open-Meteo returned no current weather data.');
  }

  const utcOffsetSeconds = Number(payload.utc_offset_seconds) || 0;
  const currentTime = parseProviderTime(payload.current.time, utcOffsetSeconds);
  if (!Number.isFinite(currentTime.getTime())) {
    throw new Error('Open-Meteo returned an invalid current weather timestamp.');
  }
  const currentHourIndex = (payload.hourly?.time || []).indexOf(payload.current.time);
  const current = {
    time: currentTime.toISOString(),
    temperature: readNumber(payload.current.temperature_2m),
    apparentTemperature: readNumber(payload.current.apparent_temperature),
    humidity: readNumber(payload.current.relative_humidity_2m),
    precipitation: readNumber(payload.current.precipitation),
    rain: readNumber(payload.current.rain),
    showers: readNumber(payload.current.showers),
    cloudCover: readNumber(payload.current.cloud_cover),
    cloudCoverLow: readNumber(payload.current.cloud_cover_low),
    cloudCoverMid: readNumber(payload.current.cloud_cover_mid),
    cloudCoverHigh: readNumber(payload.current.cloud_cover_high),
    precipitationProbability: currentHourIndex < 0
      ? null
      : readNumber(payload.hourly?.precipitation_probability?.[currentHourIndex]),
    windSpeed: readNumber(payload.current.wind_speed_10m),
    windDirection: readNumber(payload.current.wind_direction_10m),
    windGusts: readNumber(payload.current.wind_gusts_10m),
    weatherCode: readNumber(payload.current.weather_code),
    et0: readNumber(payload.current.et0_fao_evapotranspiration),
    vapourPressureDeficit: readNumber(payload.current.vapour_pressure_deficit),
    solarRadiation: currentHourIndex < 0
      ? null
      : readNumber(payload.hourly?.shortwave_radiation?.[currentHourIndex]),
    isDay: payload.current.is_day === 0 || payload.current.is_day === 1
      ? payload.current.is_day === 1
      : null
  };
  const hourly = readHourly(payload, currentTime.getTime(), utcOffsetSeconds);
  const daily = (payload.daily?.time || []).map((date, index) => ({
    date,
    sunrise: payload.daily?.sunrise?.[index]
      ? parseProviderTime(payload.daily.sunrise[index], utcOffsetSeconds).toISOString()
      : null,
    sunset: payload.daily?.sunset?.[index]
      ? parseProviderTime(payload.daily.sunset[index], utcOffsetSeconds).toISOString()
      : null,
    daylightDurationSeconds: readNumber(payload.daily?.daylight_duration?.[index]),
    moonrise: payload.daily?.moonrise?.[index]
      ? parseProviderTime(payload.daily.moonrise[index], utcOffsetSeconds).toISOString()
      : null,
    moonset: payload.daily?.moonset?.[index]
      ? parseProviderTime(payload.daily.moonset[index], utcOffsetSeconds).toISOString()
      : null,
    moonPhase: readNumber(payload.daily?.moon_phase?.[index]),
    temperatureMax: readNumber(payload.daily?.temperature_2m_max?.[index]),
    temperatureMin: readNumber(payload.daily?.temperature_2m_min?.[index]),
    precipitationProbabilityMax: readNumber(payload.daily?.precipitation_probability_max?.[index]),
    precipitationSum: readNumber(payload.daily?.precipitation_sum?.[index]),
    weatherCode: readNumber(payload.daily?.weather_code?.[index]),
    windSpeedMax: readNumber(payload.daily?.wind_speed_10m_max?.[index]),
    et0: readNumber(payload.daily?.et0_fao_evapotranspiration?.[index])
  }));
  const latitude = readNumber(payload.latitude) ?? requestedLocation.latitude;
  const longitude = readNumber(payload.longitude) ?? requestedLocation.longitude;
  const source = {
    title: 'Open-Meteo forecast',
    url: 'https://open-meteo.com/',
    publisher: 'Open-Meteo',
    retrievedAt: retrievedAt.toISOString()
  };

  return {
    available: true,
    status: 'current',
    provider: 'Open-Meteo',
    source: 'open-meteo',
    latitude,
    longitude,
    timezone: payload.timezone || requestedLocation.timezone || null,
    utcOffsetSeconds,
    retrievedAt: retrievedAt.toISOString(),
    timestamp: current.time,
    current,
    hourly,
    daily,
    data: {
      temperatureC: current.temperature,
      apparentTemperatureC: current.apparentTemperature,
      humidityPercent: current.humidity,
      precipitationMm: current.precipitation,
      rainMm: current.rain,
      showersMm: current.showers,
      precipitationProbabilityPercent: current.precipitationProbability,
      windSpeedKmh: current.windSpeed,
      windDirectionDegrees: current.windDirection,
      windGustsKmh: current.windGusts,
      weatherCode: current.weatherCode,
      cloudCoverPercent: current.cloudCover,
      cloudCoverLowPercent: current.cloudCoverLow,
      cloudCoverMidPercent: current.cloudCoverMid,
      cloudCoverHighPercent: current.cloudCoverHigh,
      forecast: {
        time: daily.map((day) => day.date),
        temperature_2m_max: daily.map((day) => day.temperatureMax),
        temperature_2m_min: daily.map((day) => day.temperatureMin),
        precipitation_probability_max: daily.map((day) => day.precipitationProbabilityMax),
        precipitation_sum: daily.map((day) => day.precipitationSum),
        weather_code: daily.map((day) => day.weatherCode),
        wind_speed_10m_max: daily.map((day) => day.windSpeedMax)
      }
    },
    sources: [source]
  };
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchForecast(locations, forecastDays = 7, timezone) {
  if (!Array.isArray(locations) || !locations.length) {
    throw new TypeError('At least one location is required for a weather forecast.');
  }
  const days = Math.max(1, Math.min(Math.floor(Number(forecastDays) || 7), 7));
  const requestedTimezone = normalizeRequestedTimezone(timezone);
  const normalized = locations.map(({ latitude, longitude }) => normalizeCoordinates(latitude, longitude));
  const cacheKey = `${days}:${requestedTimezone}:${normalized.map(({ latitude, longitude }) =>
    `${latitude},${longitude}`
  ).join(';')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('latitude', normalized.map((point) => point.latitude).join(','));
  url.searchParams.set('longitude', normalized.map((point) => point.longitude).join(','));
  url.searchParams.set('current', [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'rain',
    'showers', 'weather_code', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid',
    'cloud_cover_high', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'is_day'
  ].join(','));
  url.searchParams.set('hourly', [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation',
    'precipitation_probability', 'rain', 'showers', 'weather_code',
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'shortwave_radiation'
  ].join(','));
  url.searchParams.set('daily', [
    'temperature_2m_max', 'temperature_2m_min',
    'precipitation_probability_max', 'precipitation_sum', 'weather_code',
    'wind_speed_10m_max', 'et0_fao_evapotranspiration',
    'sunrise', 'sunset', 'daylight_duration', 'moonrise', 'moonset', 'moon_phase'
  ].join(','));
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('timezone', requestedTimezone);

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new Error(`Open-Meteo returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const entries = Array.isArray(payload) ? payload : [payload];
  if (entries.length !== normalized.length) {
    throw new Error('Open-Meteo returned an unexpected number of location forecasts.');
  }
  const retrievedAt = new Date();
  const result = entries.map((entry, index) => normalizeResponse({
    ...entry,
    timezone: entry.timezone || (requestedTimezone === 'auto' ? null : requestedTimezone)
  }, normalized[index], retrievedAt));
  cacheSet(cacheKey, result);
  return result;
}

async function getForecast(latitude, longitude, forecastDays = 7, timezone) {
  const [weather] = await fetchForecast([{ latitude, longitude }], forecastDays, timezone);
  return weather;
}

function getNearbyLocations(latitude, longitude, radiusKm = 10) {
  const center = normalizeCoordinates(latitude, longitude);
  const radius = Math.max(1, Math.min(Number(radiusKm) || 10, 50));
  const latitudeOffset = radius / 111.32;
  const longitudeOffset = radius / (111.32 * Math.max(0.1, Math.cos(center.latitude * Math.PI / 180)));
  return [
    { id: 'center', label: 'Farm', latitude: center.latitude, longitude: center.longitude, direction: 'center' },
    { id: 'northwest', label: 'North-west sample', latitude: center.latitude + latitudeOffset, longitude: center.longitude - longitudeOffset, direction: 'northwest' },
    { id: 'north', label: 'North sample', latitude: center.latitude + latitudeOffset, longitude: center.longitude, direction: 'north' },
    { id: 'northeast', label: 'North-east sample', latitude: center.latitude + latitudeOffset, longitude: center.longitude + longitudeOffset, direction: 'northeast' },
    { id: 'west', label: 'West sample', latitude: center.latitude, longitude: center.longitude - longitudeOffset, direction: 'west' },
    { id: 'east', label: 'East sample', latitude: center.latitude, longitude: center.longitude + longitudeOffset, direction: 'east' },
    { id: 'southwest', label: 'South-west sample', latitude: center.latitude - latitudeOffset, longitude: center.longitude - longitudeOffset, direction: 'southwest' },
    { id: 'south', label: 'South sample', latitude: center.latitude - latitudeOffset, longitude: center.longitude, direction: 'south' },
    { id: 'southeast', label: 'South-east sample', latitude: center.latitude - latitudeOffset, longitude: center.longitude + longitudeOffset, direction: 'southeast' }
  ];
}

function summarizeNextHours(weather, hours = RAIN_ANALYSIS_CONFIG.analysisHours) {
  const forecasts = weather.hourly.slice(0, hours);
  const maxProbability = forecasts.reduce((max, hour) =>
    hour.precipitationProbability === null ? max : Math.max(max, hour.precipitationProbability), 0);
  const totalPrecipitation = forecasts.reduce((sum, hour) =>
    sum + (hour.precipitation || 0) + (hour.showers || 0), 0);
  const rainNow = Math.max(weather.current.rain || 0, weather.current.precipitation || 0, weather.current.showers || 0) >
    RAIN_ANALYSIS_CONFIG.rainNowMm;
  const rainyCode = forecasts.some((hour) => RAIN_ANALYSIS_CONFIG.rainyWeatherCodes.includes(hour.weatherCode));
  const status = rainNow ||
    (totalPrecipitation >= RAIN_ANALYSIS_CONFIG.significantPrecipitationMm &&
      maxProbability >= RAIN_ANALYSIS_CONFIG.likelyProbabilityPercent) || rainyCode
    ? 'rain'
    : maxProbability >= RAIN_ANALYSIS_CONFIG.possibleProbabilityPercent || totalPrecipitation > 0
      ? 'possible'
      : 'no-rain';
  return {
    status,
    rainNow,
    probability: forecasts.some((hour) => hour.precipitationProbability !== null) ? maxProbability : null,
    precipitationMm: Number(totalPrecipitation.toFixed(1)),
    rainMm: Number(forecasts.reduce((sum, hour) => sum + (hour.rain || 0), 0).toFixed(1)),
    showersMm: Number(forecasts.reduce((sum, hour) => sum + (hour.showers || 0), 0).toFixed(1)),
    cloudCover: weather.current.cloudCover,
    windDirection: weather.current.windDirection,
    forecastStart: forecasts[0]?.time || null,
    forecastEnd: forecasts.at(-1)?.time || null,
    hourly: weather.hourly.slice(0, 48).map((hour) => ({
      ...hour,
      status: RAIN_ANALYSIS_CONFIG.rainyWeatherCodes.includes(hour.weatherCode) ||
        (hour.precipitationProbability >= RAIN_ANALYSIS_CONFIG.likelyProbabilityPercent &&
          (hour.precipitation || 0) + (hour.showers || 0) >= RAIN_ANALYSIS_CONFIG.significantPrecipitationMm)
        ? 'rain'
        : hour.precipitationProbability >= RAIN_ANALYSIS_CONFIG.possibleProbabilityPercent ||
          (hour.precipitation || 0) + (hour.showers || 0) > 0
          ? 'possible'
          : 'no-rain'
    }))
  };
}

function classifyRainDirection(cells) {
  const surroundings = cells.filter((cell) => cell.id !== 'center');
  const wet = surroundings.filter((cell) => cell.weather.status !== 'no-rain');
  if (!wet.length) return { classification: 'NO_SIGNIFICANT_RAIN', direction: null };

  const scored = wet.map((cell) => ({
    direction: cell.direction,
    score: (cell.weather.probability ?? 0) * 0.65 +
      Math.min(cell.weather.precipitationMm * 20, 100) * 0.35
  })).sort((first, second) => second.score - first.score);
  const difference = (scored[0]?.score || 0) - (scored[1]?.score || 0);
  if (scored.length === 1 || difference >= RAIN_ANALYSIS_CONFIG.directionalDifferencePercent) {
    return { classification: 'RAIN_DIRECTIONAL', direction: scored[0].direction };
  }
  if (wet.length >= RAIN_ANALYSIS_CONFIG.widespreadWetSamples) {
    return { classification: 'RAIN_WIDESPREAD', direction: null };
  }
  return { classification: 'RAIN_INCONCLUSIVE', direction: null };
}

async function getNearbyRainAnalysis(
  latitude,
  longitude,
  { radiusKm = RAIN_ANALYSIS_CONFIG.radiusKm, forecastDays = RAIN_ANALYSIS_CONFIG.forecastDays } = {}
) {
  const locations = getNearbyLocations(latitude, longitude, radiusKm);
  const forecasts = await fetchForecast(locations, forecastDays);
  const cells = locations.map((location, index) => ({
    ...location,
    weather: summarizeNextHours(forecasts[index]),
    source: forecasts[index].source,
    retrievedAt: forecasts[index].retrievedAt
  }));
  const farm = cells[0];
  const directionalAssessment = classifyRainDirection(cells);
  const rainyDirections = cells.slice(1)
    .filter((cell) => cell.weather.status === 'rain' || cell.weather.status === 'possible')
    .map((cell) => cell.direction);
  return {
    source: 'Open-Meteo',
    label: 'Forecast rain around your farm',
    isRadar: false,
    radiusKm: Math.max(1, Math.min(Number(radiusKm) || 10, 50)),
    ...directionalAssessment,
    farmStatus: farm.weather,
    sampledAt: farm.retrievedAt,
    forecastStart: farm.weather.forecastStart,
    forecastEnd: farm.weather.forecastEnd,
    rainyDirections,
    classificationConfig: {
      analysisHours: RAIN_ANALYSIS_CONFIG.analysisHours,
      significantPrecipitationMm: RAIN_ANALYSIS_CONFIG.significantPrecipitationMm,
      likelyProbabilityPercent: RAIN_ANALYSIS_CONFIG.likelyProbabilityPercent,
      possibleProbabilityPercent: RAIN_ANALYSIS_CONFIG.possibleProbabilityPercent,
      directionalDifferencePercent: RAIN_ANALYSIS_CONFIG.directionalDifferencePercent
    },
    cells
  };
}

module.exports = {
  fetchForecast,
  getForecast,
  getNearbyLocations,
  getNearbyRainAnalysis,
  summarizeNextHours
};
