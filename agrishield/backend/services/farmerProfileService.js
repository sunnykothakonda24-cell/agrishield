const firestoreRepository = require('./firestoreRepository');

async function getFarmerProfile(farmerId) {
  if (typeof farmerId !== 'string' || !farmerId) return null;

  const [user, farm] = await Promise.all([
    firestoreRepository.getFarmer(farmerId),
    firestoreRepository.getFarmForUser(farmerId)
  ]);
  if (!user && !farm) return null;

  const farmLocation = farm?.farmLocation || null;
  const location = farmLocation
    ? { lat: farmLocation.latitude, lng: farmLocation.longitude }
    : null;
  const points = (farm?.farmBoundary || []).map((point) =>
    Array.isArray(point) ? [point[0], point[1]] : [point.lat, point.lng]
  );
  const cropDetails = farm?.cropDetails || null;
  const soilDetails = farm?.soilDetails || null;
  const waterSource = farm?.waterSource || null;
  const area = farm?.area || {};

  return {
    userId: farmerId,
    farmerName: user?.name || '',
    verifiedMobile: user?.mobile || '',
    mobileVerified: user?.mobileVerified === true,
    farm: {
      _id: farm?._id || `farm-${farmerId}`,
      location,
      farmLocation: location
        ? {
          latitude: location.lat,
          longitude: location.lng,
          displayName: farmLocation.displayName || null,
          village: farmLocation.village || null,
          district: farmLocation.district || null,
          state: farmLocation.state || null,
          country: farmLocation.country || null
        }
        : null,
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
      crop: cropDetails?.name || farm?.crop || null,
      variety: cropDetails?.variety || null,
      soilType: soilDetails?.type || null,
      cropDetails,
      soilDetails,
      waterSource
    }
  };
}

module.exports = { getFarmerProfile };
