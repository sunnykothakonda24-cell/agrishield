const timezoneLookup = require('tz-lookup');

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function resolveFarmTimeZone(location = {}) {
  const savedTimeZone = location.timezone || location.timeZone;
  if (isValidTimeZone(savedTimeZone)) return savedTimeZone;

  const latitude = Number(location.latitude ?? location.lat);
  const longitude = Number(location.longitude ?? location.lng);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }

  return timezoneLookup(latitude, longitude);
}

module.exports = { resolveFarmTimeZone };
