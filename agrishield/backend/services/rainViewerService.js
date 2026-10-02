const RAINVIEWER_METADATA_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_TILE_HOST = 'https://tilecache.rainviewer.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cacheEntry = null;

async function getRecentRadarFrame() {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) return cacheEntry.value;

  const response = await fetch(RAINVIEWER_METADATA_URL, {
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`RainViewer returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const frames = Array.isArray(payload?.radar?.past) ? payload.radar.past : [];
  const frame = [...frames]
    .filter((item) => Number.isSafeInteger(item?.time) && item.time > 0 &&
      typeof item.path === 'string' && /^\/v2\/radar\/[a-zA-Z0-9]+$/.test(item.path))
    .sort((first, second) => second.time - first.time)[0];
  if (!frame) {
    const unavailable = {
      available: false,
      provider: 'RainViewer',
      status: 'unavailable',
      message: 'Radar data is unavailable for this area right now.',
      retrievedAt: new Date().toISOString()
    };
    cacheEntry = { value: unavailable, expiresAt: Date.now() + CACHE_TTL_MS };
    return unavailable;
  }

  const retrievedAt = new Date().toISOString();
  const result = {
    available: true,
    provider: 'RainViewer',
    status: 'recent_observation',
    timestamp: new Date(frame.time * 1000).toISOString(),
    retrievedAt,
    tileUrlTemplate: `${RAINVIEWER_TILE_HOST}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
    attribution: 'Weather radar: RainViewer',
    historicalFrameCount: frames.length,
    forecastFramesAvailable: false
  };
  cacheEntry = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

module.exports = { getRecentRadarFrame };
