const weatherService = require('./weatherService');

const pendingRefreshes = new Map();
const MAX_PENDING_FARMS = 50;
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (pendingRefreshes.size > 0) {
      const [farmId, refresh] = pendingRefreshes.entries().next().value;
      pendingRefreshes.delete(farmId);
      try {
        await weatherService.getCurrentWeather(refresh.location);
      } catch (error) {
        console.warn(`[AgriShield Farm Refresh] Weather refresh failed for farm ${farmId}:`, error.message);
      }
    }
  } finally {
    processing = false;
    if (pendingRefreshes.size > 0) {
      setImmediate(() => processQueue().catch((error) => {
        console.error('[AgriShield Farm Refresh] Queue worker failed:', error.message);
      }));
    }
  }
}

function queueFarmDataRefresh({ farmId, location }) {
  if (!farmId || !location) return false;
  if (pendingRefreshes.size >= MAX_PENDING_FARMS && !pendingRefreshes.has(farmId)) {
    const oldestFarmId = pendingRefreshes.keys().next().value;
    pendingRefreshes.delete(oldestFarmId);
    console.warn('[AgriShield Farm Refresh] Queue limit reached; replaced the oldest pending farm refresh.');
  }
  pendingRefreshes.set(String(farmId), { location });
  setImmediate(() => processQueue().catch((error) => {
    console.error('[AgriShield Farm Refresh] Queue worker failed:', error.message);
  }));
  return true;
}

module.exports = { queueFarmDataRefresh };
