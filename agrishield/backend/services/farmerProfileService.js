const firestoreRepository = require('./firestoreRepository');
const { resolveFarmTimeZone } = require('./farmTimezoneService');

function formatFarm(farm) {
  if (!farm) return null;
  const farmLocation = farm.farmLocation || farm.location || null;
  const timezone = farmLocation
    ? resolveFarmTimeZone({
        ...farmLocation,
        latitude: farmLocation.latitude ?? farmLocation.lat,
        longitude: farmLocation.longitude ?? farmLocation.lng
      })
    : null;
  const location = farmLocation
    ? {
        lat: farmLocation.latitude ?? farmLocation.lat,
        lng: farmLocation.longitude ?? farmLocation.lng,
        timezone,
        displayName: farmLocation.displayName || null
      }
    : null;
  const points = (farm.farmBoundary || []).map((point) =>
    Array.isArray(point)
      ? [point[0], point[1]]
      : [point.lat ?? point.latitude, point.lng ?? point.longitude]
  );
  const cropDetails = farm.cropDetails || null;
  const soilDetails = farm.soilDetails || null;
  const waterSource = farm.waterSource || null;
  const area = farm.area || {};

  return {
    _id: farm._id,
    timezone,
    name: farm.name || farm.farmName || farm.displayName || 'My Farm',
    farmName: farm.farmName || farm.name || farm.displayName || 'My Farm',
    location,
    farmLocation: farmLocation ? {
      latitude: farmLocation.latitude ?? farmLocation.lat,
      longitude: farmLocation.longitude ?? farmLocation.lng,
      timezone,
      displayName: farmLocation.displayName || null,
      village: farmLocation.village || null,
      district: farmLocation.district || null,
      state: farmLocation.state || null,
      country: farmLocation.country || null
    } : null,
    boundary: {
      points,
      areaAcres: area.acres || null,
      areaSqMeters: area.sqMeters || 0,
      perimeterMeters: area.perimeterMeters || 0,
      lengthMeters: area.lengthMeters || 0,
      widthMeters: area.widthMeters || 0
    },
    farmBoundary: points.map(([lat, lng]) => ({ lat, lng })),
    area,
    crop: cropDetails?.name || farm.crop || null,
    variety: cropDetails?.variety || null,
    stage: cropDetails?.stage || null,
    plantingDate: cropDetails?.plantingDate || null,
    harvestDate: cropDetails?.harvestDate || null,
    soilType: soilDetails?.type || null,
    cropDetails,
    soilDetails,
    waterSource,
    water: waterSource ? { source: waterSource, otherSource: waterSource } : null
  };
}

function formatFarmSummary(farm) {
  return {
    farmId: farm._id,
    name: farm.name || farm.displayName || 'My Farm',
    areaAcres: farm.area?.acres || null,
    locationSummary: farm.location?.displayName || farm.farmLocation?.displayName || null
  };
}

async function getFarmerProfile(farmerId, requestedFarmId = null) {
  if (typeof farmerId !== 'string' || !farmerId) return null;

  const user = await firestoreRepository.getFarmer(farmerId);
  if (!user) return null;

  let farms = [];
  let activeFarm = null;
  let appDataAvailable = firestoreRepository.isConfigured();
  if (appDataAvailable) {
    try {
      farms = await firestoreRepository.getFarmerFarms(farmerId);
      activeFarm = await firestoreRepository.getFarmForUser(farmerId, requestedFarmId);
    } catch (error) {
      appDataAvailable = false;
      if (requestedFarmId) throw error;
      console.warn('[AgriShield Profile] Application farm data is unavailable:', error.code || error.name || 'farm_data_error');
    }
  }

  return {
    userId: farmerId,
    farmerName: user.name || '',
    verifiedMobile: user.mobile || '',
    mobileVerified: user.mobileVerified === true,
    farms: farms.map(formatFarmSummary),
    activeFarmId: activeFarm?._id || null,
    applicationDataAvailable: appDataAvailable,
    farm: formatFarm(activeFarm)
  };
}

module.exports = { getFarmerProfile, formatFarm, formatFarmSummary };
