const FARM_STATES = {
  NORMAL: 'NORMAL',
  RAIN: 'RAIN',
  SUNNY: 'SUNNY',
  HIGH_HEAT: 'HIGH_HEAT',
  HIGH_HUMIDITY: 'HIGH_HUMIDITY'
};
const HIGH_HEAT_THRESHOLD_C = 38;

function getFarmEnvironmentState(farm = {}, options = {}) {
  const weather = options.weatherData?.available ? options.weatherData : null;
  const data = weather?.data || {};
  const temperature = Number(data.temperatureC);
  const humidity = Number(data.humidityPercent);
  const rain = [data.precipitationMm, data.rainMm, data.showersMm]
    .some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  const currentWeather = weather?.status === 'current';
  const conditions = [];

  if (currentWeather && rain) conditions.push(FARM_STATES.RAIN);
  if (currentWeather && Number.isFinite(temperature) && temperature >= HIGH_HEAT_THRESHOLD_C) {
    conditions.push(FARM_STATES.HIGH_HEAT);
  }
  if (currentWeather && Number.isFinite(humidity) && humidity >= 85) {
    conditions.push(FARM_STATES.HIGH_HUMIDITY);
  }
  if (currentWeather && !rain && Number.isFinite(Number(data.weatherCode)) && Number(data.weatherCode) <= 1) {
    conditions.push(FARM_STATES.SUNNY);
  }

  const environmentState = conditions[0] || FARM_STATES.NORMAL;
  const secondaryStates = conditions.slice(1);
  const hasFarmGeometry = (Array.isArray(farm.farmBoundary) && farm.farmBoundary.length >= 3) ||
    (Array.isArray(farm.boundary?.points) && farm.boundary.points.length >= 3) ||
    Number(farm.area?.sqMeters || farm.boundary?.areaSqMeters) > 0;
  const statusText = !weather
    ? 'Current weather data is unavailable. The Farm Twin shows farm geometry only.'
    : environmentState === FARM_STATES.RAIN
      ? `Current weather data from ${weather.provider || weather.source || 'the configured weather provider'} reports precipitation.`
      : environmentState === FARM_STATES.HIGH_HEAT
        ? `Current weather data from ${weather.provider || weather.source || 'the configured weather provider'} reports high air temperature.`
        : environmentState === FARM_STATES.HIGH_HUMIDITY
          ? `Current weather data from ${weather.provider || weather.source || 'the configured weather provider'} reports high air humidity.`
          : environmentState === FARM_STATES.SUNNY
            ? `Current weather data from ${weather.provider || weather.source || 'the configured weather provider'} reports clear conditions.`
            : 'No unusual conditions were identified in the available current weather data.';

  return {
    farmId: farm._id || farm.id || null,
    farmLocation: farm.farmLocation ? {
      latitude: farm.farmLocation.latitude,
      longitude: farm.farmLocation.longitude
    } : null,
    environmentState,
    secondaryStates,
    weather,
    statusText,
    visual: {
      model: environmentState.toLowerCase(),
      background: environmentState.toLowerCase(),
      weatherEffect: environmentState === FARM_STATES.RAIN ? 'rain' : 'none',
      lighting: {
        intensity: environmentState === FARM_STATES.SUNNY || environmentState === FARM_STATES.HIGH_HEAT ? 1.6 : 1.0,
        sunColor: environmentState === FARM_STATES.HIGH_HEAT ? '#ffaa44' : (environmentState === FARM_STATES.SUNNY ? '#fef08a' : '#ffffff'),
        skyColor: environmentState === FARM_STATES.RAIN || environmentState === FARM_STATES.HIGH_HUMIDITY ? '#64748b' : '#38bdf8',
        ambient: 0.6
      },
      soilAppearance: weather ? 'neutral' : 'unknown',
      atmosphere: {
        fog: environmentState === FARM_STATES.RAIN || environmentState === FARM_STATES.HIGH_HUMIDITY,
        haze: environmentState === FARM_STATES.HIGH_HEAT,
        particles: environmentState === FARM_STATES.RAIN ? 'raindrops' : 'none'
      }
    },
    waterSource: farm.waterSource || null,
    crop: farm.cropDetails?.name || null,
    cropVariety: farm.cropDetails?.variety || null,
    soil: farm.soilDetails?.type || null,
    areaAcres: farm.area?.acres || null,
    areaSqMeters: farm.area?.sqMeters || null,
    perimeterMeters: farm.area?.perimeterMeters || null,
    dimensions: {
      lengthMeters: farm.area?.lengthMeters || null,
      widthMeters: farm.area?.widthMeters || null
    },
    boundary: farm.farmBoundary || [],
    dataStatus: weather ? 'weather_data' : hasFarmGeometry ? 'geometry_only' : 'unavailable',
    dataSource: weather?.provider || weather?.source || null,
    retrievedAt: weather?.retrievedAt || weather?.timestamp || null
  };
}

module.exports = { FARM_STATES, getFarmEnvironmentState };
