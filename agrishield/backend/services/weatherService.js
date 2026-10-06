const openMeteoService = require('./openMeteoService');
const { resolveFarmTimeZone } = require('./farmTimezoneService');

function coordinatesFromLocation(location) {
  const latitude = Number(location?.latitude ?? location?.lat);
  const longitude = Number(location?.longitude ?? location?.lng);
  if (!location || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

function isSpatialRainQuestion(question = '') {
  return /(?:where(?:'s| is)? the rain|rain.*(?:near|around|where|east|west|north|south)|nearby rain|rain.*direction|వర్షం ఎక్కడ|ఎక్కడ.*వర్షం|వర్షం.*ఎక్కడ|పొలం.*(?:దగ్గర|చుట్టూ).*వర్షం|వర్షం.*(?:దగ్గర|చుట్టూ)|barish.*kahan|बारिश कहाँ|कहाँ.*बारिश|मेरे खेत.*बारिश.*कहाँ|(?:खेत|बारिश).*(?:पास|आसपास))/i.test(question);
}

function isHistoricalWeatherQuestion(question = '') {
  return /(?:last month|previous month|historical|during.*crop|was.*hotter|rainfall.*last|पिछले महीने|पिछला महीना|గత నెల)/i.test(question);
}

function noLocationResult() {
  return {
    available: false,
    status: 'location_unavailable',
    provider: 'Open-Meteo',
    source: 'open-meteo',
    data: null,
    current: null,
    hourly: [],
    daily: [],
    sources: []
  };
}

async function getCurrentWeather(location, { forecastDays = 7, includeNearbyRain = false, timeZone } = {}) {
  const coordinates = coordinatesFromLocation(location);
  if (!coordinates) return noLocationResult();

  const timezone = resolveFarmTimeZone({
    ...location,
    ...coordinates,
    timezone: location.timezone || location.timeZone || timeZone
  });
  const weather = await openMeteoService.getForecast(
    coordinates.latitude,
    coordinates.longitude,
    forecastDays,
    timezone
  );
  if (!includeNearbyRain) return weather;
  return {
    ...weather,
    rainAnalysis: await openMeteoService.getNearbyRainAnalysis(
      coordinates.latitude,
      coordinates.longitude
    )
  };
}

async function getWeatherContext(location, { question = '', forecastDays = 7 } = {}) {
  if (!coordinatesFromLocation(location)) {
    return {
      available: false,
      status: 'location_unavailable',
      provider: 'Open-Meteo',
      data: null,
      currentWeather: null,
      hourlyForecast: [],
      historicalWeather: null,
      sources: []
    };
  }
  if (isHistoricalWeatherQuestion(question)) {
    return {
      available: false,
      status: 'historical_unavailable',
      provider: 'Open-Meteo',
      data: null,
      currentWeather: null,
      hourlyForecast: [],
      historicalWeather: null,
      message: 'Historical weather is not available from the configured forecast source.',
      sources: []
    };
  }

  const weather = await getCurrentWeather(location, {
    forecastDays,
    includeNearbyRain: isSpatialRainQuestion(question)
  });
  return {
    ...weather,
    currentWeather: weather.current,
    hourlyForecast: weather.hourly,
    nearbyRain: weather.rainAnalysis || null
  };
}

function getSourceStatus() {
  return {
    openMeteo: {
      provider: 'Open-Meteo',
      configured: true,
      status: 'primary_forecast'
    }
  };
}

module.exports = {
  getCurrentWeather,
  getWeatherContext,
  getSourceStatus,
  isSpatialRainQuestion,
  isHistoricalWeatherQuestion
};
