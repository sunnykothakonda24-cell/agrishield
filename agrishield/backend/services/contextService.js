function buildFarmContext({ profile = {}, farm = {}, weather = null, evidence = [], sourceStatus = {}, conversationContext = {} }) {
  const location = farm.farmLocation || farm.location || profile.location || null;
  const context = {
    farmer: {
      name: profile.farmerName || profile.name || conversationContext.farmerName || null
    },
    farm: {
      crop: farm.cropDetails?.name || farm.crop || profile.crop || conversationContext.crop || null,
      cropVariety: farm.cropDetails?.variety || farm.variety || null,
      cropStage: farm.cropDetails?.stage || farm.stage || null,
      plantingDate: farm.cropDetails?.plantingDate || farm.plantingDate || null,
      soil: farm.soilDetails?.type || farm.soilType || profile.soilType || null,
      waterSource: farm.waterSource || farm.water?.source || null,
      areaAcres: farm.area?.acres || farm.boundary?.areaAcres || null,
      boundaryPointCount: farm.farmBoundary?.length || farm.boundary?.points?.length || null,
      activeIssue: conversationContext.activeIssue || null
    },
    location: location ? {
      latitude: location.latitude ?? location.lat ?? null,
      longitude: location.longitude ?? location.lng ?? null,
      placeName: location.placeName || location.displayName || '',
      district: location.district || null,
      state: location.state || null
    } : null,
    weather: weather?.available ? weather : null,
    agricultureData: evidence,
    sourceStatus,
    conversationSummary: conversationContext.summary || ''
  };

  for (const section of Object.keys(context)) {
    const value = context[section];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      context[section] = Object.fromEntries(
        Object.entries(value).filter(([, field]) => field !== null && field !== undefined && field !== '')
      );
    }
  }
  return context;
}

module.exports = { buildFarmContext };
