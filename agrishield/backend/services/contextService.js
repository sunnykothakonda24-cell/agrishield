const firestoreRepository = require('./firestoreRepository');
const weatherService = require('./weatherService');
const { buildCropSchedule } = require('./cropScheduleService');
const { getFarmEnvironmentState } = require('./farmTwinService');
const { AgriShieldError, ERROR_CODES } = require('../utils/errors');

const SCHEDULE_INTENTS = new Set([
  'SCHEDULE',
  'IRRIGATION_ADVISOR',
  'IMAGE_ANALYSIS',
  'PEST_DISEASE'
]);
const SCHEDULE_QUESTION = /(?:schedule|today|upcoming|activity|when|due|next|crop age|how old|stage|planting date|planted|fertili[sz]er|आज|आज का|आज क्या|कब|अगला|फसल की उम्र|बोने की तारीख|వయస్సు|నాటిన|ఈరోజు|ఈ రోజు|ఎప్పుడు|తదుపరి|షెడ్యూల్|దశ)/i;
const WEATHER_QUESTION = /(?:weather|forecast|rain|rainfall|temperature|wind|spray|irrigat|water|paani|pani|neeru|बारिश|मौसम|वर्षा|तापमान|पानी|सिंचाई|వాతావరణం|వర్షం|వాన|ఉష్ణోగ్రత|గాలి|స్ప్రే|నీరు)/i;
const FERTILIZER_QUESTION = /(?:fertili[sz]er|nutrient|manure|compost|urea|dap|n.?p.?k|ખાતર|ఎరువు|పోషక|खाद|उर्वरक)/i;
const COMPLETED_QUESTION = /(?:completed|done|already applied|చేశాను|పూర్తి|చేసిన|किया|हो चुका)/i;

function optionalText(value, limit = 240) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, limit)
    : undefined;
}

function optionalNumber(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number)
    ? number
    : undefined;
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) =>
    field !== undefined && field !== null && field !== ''
  ));
}

function locationSummary(location = {}) {
  const locality = [
    location.displayName || location.placeName,
    location.village,
    location.district,
    location.state,
    location.country
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  return locality.length ? locality.join(', ').slice(0, 240) : undefined;
}

function formatFarmFacts(farm, intent, question) {
  const area = farm.area || {};
  const cropDetails = farm.cropDetails || {};
  const soilDetails = farm.soilDetails || {};
  const points = farm.farmBoundary || farm.boundary?.points || [];
  const farmDetailQuestion = intent === 'FARM_DETAILS';
  const summaryQuestion = intent === 'FARM_SUMMARY';
  const asksArea = /(?:area|acre|size|perimeter|dimension|ఎకర|విస్తీర్ణం|आकार|क्षेत्र|एकड़)/i.test(question);
  const asksCrop = /(?:crop|plant|age|old|stage|variety|పంట|వయస్సు|నాటిన|దశ|फसल|उम्र|बोने)/i.test(question);
  const asksSoil = /(?:soil|మట్టి|నేల|मिट्टी|मृदा)/i.test(question);
  const asksWater = /(?:water source|irrigat| నీరు|నీటి వనరు|पानी|सिंचाई)/i.test(question);
  const asksLocation = /(?:location|where is my farm|వద్ద|ఎక్కడ|स्थान|कहाँ)/i.test(question);
  const asksFarmName = /(?:farm name|name of my farm|పొలం పేరు|खेत का नाम)/i.test(question);
  const alertReasonQuestion = intent === 'ALERTS' &&
    /(?:why|reason|because|ఎందుకు|కారణం|क्यों|कारण)/i.test(question);
  const cropContextIntents = new Set([
    'CROP_ADVISOR',
    'CROP_RECOMMENDATION',
    'IRRIGATION_ADVISOR',
    'PEST_DISEASE',
    'IMAGE_ANALYSIS',
    'SCHEDULE',
    'SOIL',
    'MARKET',
    'FARM_TWIN',
    'FARM_STATUS',
    'FARM_DETAILS',
    'FARM_SUMMARY',
    ...(alertReasonQuestion ? ['ALERTS'] : [])
  ]);
  const cropContext = (cropContextIntents.has(intent) && !farmDetailQuestion) ||
    summaryQuestion ||
    (farmDetailQuestion && asksCrop) ||
    (intent === 'WEATHER' && /(?:spray|irrigat|crop|पानी|सिंचाई|వరి|పంట|నీరు)/i.test(question));
  const includeArea = ['CROP_RECOMMENDATION', 'IRRIGATION_ADVISOR', 'FARM_TWIN', 'FARM_STATUS'].includes(intent) ||
    summaryQuestion || (farmDetailQuestion && asksArea);
  const includeSoil = intent === 'SOIL' ||
    (cropContext && intent !== 'MARKET' && !farmDetailQuestion) ||
    summaryQuestion || (farmDetailQuestion && asksSoil);
  const includeWaterSource = ['IRRIGATION_ADVISOR', 'PEST_DISEASE', 'IMAGE_ANALYSIS', 'FARM_TWIN', 'FARM_STATUS'].includes(intent) ||
    summaryQuestion || (farmDetailQuestion && asksWater);
  const includeLocation = (intent !== 'ALERTS' || alertReasonQuestion) &&
    (intent === 'WEATHER' || intent === 'FARM_TWIN' || intent === 'FARM_STATUS' || summaryQuestion ||
      intent === 'CROP_RECOMMENDATION' || intent === 'SOIL' || (cropContext && !farmDetailQuestion) ||
      (farmDetailQuestion && asksLocation) || alertReasonQuestion);
  const asksDimensions = /(?:perimeter|dimension|length|width|వెడల్పు|పొడవు|परिमाप|लंबाई|चौड़ाई)/i.test(question);
  const includeGeometry = ['FARM_TWIN', 'FARM_STATUS'].includes(intent) ||
    summaryQuestion || (farmDetailQuestion && asksDimensions);
  const dimensions = definedEntries({
    lengthMeters: optionalNumber(area.lengthMeters ?? farm.length),
    widthMeters: optionalNumber(area.widthMeters ?? farm.width)
  });
  return definedEntries({
    ...(!farmDetailQuestion || summaryQuestion || asksFarmName
      ? { name: optionalText(farm.farmName || farm.name || farm.displayName, 120) }
      : {}),
    ...(includeLocation ? { location: locationSummary(farm.farmLocation || farm.location || {}) } : {}),
    ...(includeArea ? {
      areaAcres: optionalNumber(area.acres ?? farm.areaAcres),
      areaHectares: optionalNumber(area.hectares)
    } : {}),
    ...(includeGeometry ? {
      perimeterMeters: optionalNumber(area.perimeterMeters ?? farm.perimeter),
      dimensions: Object.keys(dimensions).length ? dimensions : undefined,
      boundaryPointCount: Array.isArray(points) && points.length ? points.length : undefined
    } : {}),
    ...(cropContext ? {
      crop: optionalText(cropDetails.name || farm.crop, 100),
      cropVariety: optionalText(cropDetails.variety || farm.variety, 100),
      cropStage: optionalText(cropDetails.stage || farm.stage, 100),
      plantingDate: optionalText(cropDetails.plantingDate || farm.plantingDate, 40)
    } : {}),
    ...(includeSoil ? { soil: optionalText(soilDetails.type || farm.soilType || farm.soil, 100) } : {}),
    ...(includeWaterSource ? { waterSource: optionalText(farm.waterSource || farm.water?.source, 100) } : {})
  });
}

function formatActivity(activity) {
  return definedEntries({
    name: optionalText(activity.name, 120),
    type: optionalText(activity.type, 80),
    stage: optionalText(activity.stage, 80),
    scheduledDate: optionalText(activity.scheduledDate, 20),
    status: optionalText(activity.status, 40)
  });
}

function selectActivities(activities, question, todayDate) {
  const today = activities.filter((activity) => activity.scheduledDate === todayDate);
  const upcoming = activities.filter((activity) => activity.status === 'UPCOMING');
  const relevant = FERTILIZER_QUESTION.test(question)
    ? (activity) => FERTILIZER_QUESTION.test(`${activity.name || ''} ${activity.type || ''}`)
    : () => true;

  return {
    today: today.filter(relevant).slice(0, 5).map(formatActivity),
    upcoming: upcoming.filter(relevant).slice(0, 5).map(formatActivity),
    ...(COMPLETED_QUESTION.test(question) ? {
      completed: activities
        .filter((activity) => ['COMPLETED', 'SKIPPED'].includes(activity.status) && relevant(activity))
        .slice(-3)
        .map(formatActivity)
    } : {})
  };
}

function formatWeather(weather) {
  if (!weather?.available) {
    return { available: false, status: weather?.status || 'unavailable', provider: 'Open-Meteo' };
  }
  const current = weather.current || weather.currentWeather;
  const daily = Array.isArray(weather.daily) ? weather.daily.slice(0, 5).map((day) =>
    definedEntries({
      date: day.date,
      temperatureMax: day.temperatureMax,
      temperatureMin: day.temperatureMin,
      precipitationProbabilityMax: day.precipitationProbabilityMax,
      precipitationSum: day.precipitationSum,
      windSpeedMax: day.windSpeedMax,
      weatherCode: day.weatherCode
    })
  ) : [];
  const hourly = daily.length || !Array.isArray(weather.hourly)
    ? []
    : weather.hourly.slice(0, 8).map((hour) => definedEntries({
      time: hour.time,
      temperature: hour.temperature,
      precipitation: hour.precipitation,
      precipitationProbability: hour.precipitationProbability,
      rain: hour.rain,
      windSpeed: hour.windSpeed,
      windDirection: hour.windDirection,
      weatherCode: hour.weatherCode
    }));
  return {
    available: true,
    provider: weather.provider || weather.source || 'Open-Meteo',
    retrievedAt: weather.retrievedAt || weather.timestamp || undefined,
    current: current ? definedEntries({
      time: current.time,
      temperature: current.temperature,
      apparentTemperature: current.apparentTemperature,
      humidity: current.humidity,
      precipitation: current.precipitation,
      rain: current.rain,
      precipitationProbability: current.precipitationProbability,
      windSpeed: current.windSpeed,
      windDirection: current.windDirection,
      weatherCode: current.weatherCode
    }) : undefined,
    relevantForecast: daily.length ? daily : hourly,
    nearbyRain: weather.rainAnalysis || weather.nearbyRain || undefined,
    sources: (weather.sources || []).slice(0, 3).map((source) => definedEntries({
      title: optionalText(source.title, 120),
      url: optionalText(source.url, 240),
      publisher: optionalText(source.publisher, 100),
      retrievedAt: optionalText(source.retrievedAt, 40)
    }))
  };
}

function formatAlerts(records) {
  return records.slice(0, 5).map((record) => definedEntries({
    type: optionalText(record.type, 80),
    title: optionalText(record.title, 160),
    message: optionalText(record.message, 320),
    severity: optionalText(record.severity, 40),
    read: typeof record.read === 'boolean' ? record.read : undefined,
    createdAt: record.createdAt?.toDate?.().toISOString?.() ||
      (typeof record.createdAt === 'string' ? record.createdAt.slice(0, 40) : undefined)
  }));
}

function formatConversationClaims(conversationContext = {}) {
  return definedEntries({
    farmerReportedCrop: optionalText(conversationContext.crop, 100),
    farmerReportedCropStage: optionalText(conversationContext.cropStage, 100),
    farmerReportedCropAgeDays: optionalNumber(conversationContext.farmerReportedCropAgeDays),
    farmerReportedPlantingDate: optionalText(conversationContext.farmerReportedPlantingDate, 40),
    farmerReportedSoil: optionalText(conversationContext.soilType, 100),
    farmerReportedLocation: optionalText(conversationContext.location, 160),
    farmerReportedWaterSource: optionalText(conversationContext.farmerReportedWaterSource, 100),
    activeIssue: optionalText(conversationContext.activeIssue, 240),
    symptoms: Array.isArray(conversationContext.symptoms)
      ? conversationContext.symptoms.slice(-3).map((value) => optionalText(value, 120)).filter(Boolean)
      : undefined
  });
}

function needsWeather(intent, question) {
  return intent === 'WEATHER' ||
    (intent === 'ALERTS' && /(?:why|reason|because|ఎందుకు|కారణం|क्यों|कारण)/i.test(question)) ||
    (intent === 'SCHEDULE' && /(?:today|today.?s|आज|आज का|आज क्या|ఈరోజు|ఈ రోజు)/i.test(question)) ||
    (['IRRIGATION_ADVISOR', 'CROP_ADVISOR', 'FARM_STATUS', 'FARM_TWIN'].includes(intent) &&
      WEATHER_QUESTION.test(question));
}

function needsSchedule(intent, question) {
  return SCHEDULE_INTENTS.has(intent) ||
    intent === 'FARM_SUMMARY' ||
    (['CROP_ADVISOR', 'FARM_STATUS', 'FARM_DETAILS', 'FARM_SUMMARY'].includes(intent) &&
      SCHEDULE_QUESTION.test(question));
}

async function buildAIContext({
  uid,
  farmId,
  question = '',
  intent = 'GENERAL_CONVERSATION',
  language = 'en',
  conversationContext = {},
  now = new Date()
}, dependencies = {}) {
  if (typeof uid !== 'string' || !uid || typeof farmId !== 'string' || !farmId) {
    throw new AgriShieldError(ERROR_CODES.FARM_ACCESS_DENIED, 'An authenticated farmer and active farm are required.', 403);
  }

  const repository = dependencies.repository || firestoreRepository;
  const weather = dependencies.weatherService || weatherService;
  const farmTwin = dependencies.farmTwinService || { getFarmEnvironmentState };
  if (intent === 'GENERAL_CONVERSATION') {
    return {
      context: {
        user: definedEntries({ preferredLanguage: optionalText(language, 20) }),
        farm: {},
        schedule: undefined,
        weather: undefined,
        alerts: undefined,
        farmTwin: undefined,
        conversation: formatConversationClaims(conversationContext),
        sourceStatus: {}
      },
      farm: {},
      weatherData: null
    };
  }
  const farm = await repository.getOwnedFarm(uid, farmId);
  if (!farm || String(farm._id || farm.farmId) !== farmId) {
    throw new AgriShieldError(ERROR_CODES.FARM_ACCESS_DENIED, 'The active farm is not owned by the authenticated farmer.', 403);
  }

  const crop = farm.cropDetails?.name || farm.crop || null;
  const location = farm.farmLocation || farm.location || null;
  const packet = {
    user: definedEntries({
      preferredLanguage: optionalText(language, 20)
    }),
    farm: formatFarmFacts(farm, intent, question),
    schedule: undefined,
    weather: undefined,
    alerts: undefined,
    farmTwin: undefined,
    conversation: formatConversationClaims(conversationContext),
    sourceStatus: {}
  };
  let weatherData = null;

  if (needsSchedule(intent, question) && crop) {
    try {
      const [protocol, activityStatuses] = await Promise.all([
        repository.getCropProtocol(crop, farm.cropDetails?.variety || farm.variety || null),
        repository.getFarmActivityStatuses(uid, farmId)
      ]);
      const schedule = buildCropSchedule({
        farm,
        protocol,
        activityStatuses,
        timeZone: farm.timeZone || farm.timezone || 'UTC',
        now
      });
      const includeActivities = intent === 'SCHEDULE' ||
        /(?:schedule|today|upcoming|activity|when|due|next|fertili[sz]er|आज|ఈరోజు|ఈ రోజు|ఎప్పుడు|తదుపరి)/i.test(question);
      packet.schedule = {
        configured: schedule.configured,
        ...(schedule.today ? { today: schedule.today } : {}),
        ...(schedule.cropAgeDays !== null ? { cropAgeDays: schedule.cropAgeDays } : {}),
        ...(schedule.currentStage ? { currentStage: schedule.currentStage } : {}),
        ...(schedule.reason ? { status: schedule.reason } : {}),
        ...(includeActivities ? selectActivities(schedule.activities || [], question, schedule.today) : {})
      };
      packet.sourceStatus.schedule = schedule.configured ? 'available' : schedule.reason || 'unavailable';
      if (schedule.currentStage && !packet.farm.cropStage) {
        packet.farm.cropStage = schedule.currentStage;
      }
    } catch (error) {
      console.warn('[AgriShield AI Context] Crop schedule unavailable:', error.code || error.name || 'schedule_error');
      packet.schedule = { available: false, status: 'unavailable' };
      packet.sourceStatus.schedule = 'unavailable';
    }
  } else if (needsSchedule(intent, question)) {
    packet.schedule = { available: false, status: 'crop_unavailable' };
    packet.sourceStatus.schedule = 'crop_unavailable';
  }

  if (needsWeather(intent, question)) {
    try {
      weatherData = await weather.getWeatherContext(location, {
        question,
        forecastDays: 5
      });
      packet.weather = formatWeather(weatherData);
    } catch (error) {
      console.warn('[AgriShield AI Context] Weather unavailable:', error.code || error.name || 'weather_error');
      packet.weather = { available: false, status: 'unavailable', provider: 'Open-Meteo' };
    }
    packet.sourceStatus.weather = packet.weather.status || (packet.weather.available ? 'available' : 'unavailable');
  }

  if (intent === 'ALERTS') {
    try {
      packet.alerts = formatAlerts(await repository.getUserNotifications(uid, farmId, 20));
      packet.sourceStatus.alerts = 'available';
    } catch (error) {
      console.warn('[AgriShield AI Context] Farm alerts unavailable:', error.code || error.name || 'alerts_error');
      packet.alerts = { available: false, status: 'unavailable' };
      packet.sourceStatus.alerts = 'unavailable';
    }
  }

  if (intent === 'FARM_TWIN' || intent === 'FARM_STATUS') {
    const twin = farmTwin.getFarmEnvironmentState(farm, {
      weatherData: weatherData?.available ? weatherData : null
    });
    packet.farmTwin = definedEntries({
      environmentState: twin.environmentState,
      status: twin.statusText,
      crop: twin.crop,
      waterSource: twin.waterSource,
      areaAcres: optionalNumber(twin.areaAcres),
      areaSqMeters: optionalNumber(twin.areaSqMeters),
      perimeterMeters: optionalNumber(twin.perimeterMeters)
    });
  }

  return { context: packet, farm, weatherData };
}

function getContextDiagnostics(context) {
  const categories = {
    user: Object.keys(context.user || {}).length > 0,
    farm: Object.keys(context.farm || {}).length > 1,
    crop: Boolean(context.farm?.crop),
    cropStage: Boolean(context.farm?.cropStage || context.schedule?.currentStage),
    soil: Boolean(context.farm?.soil),
    waterSource: Boolean(context.farm?.waterSource),
    schedule: Boolean(context.schedule),
    weather: Boolean(context.weather?.available),
    alerts: Array.isArray(context.alerts) ? context.alerts.length > 0 : Boolean(context.alerts),
    farmTwin: Boolean(context.farmTwin),
    conversation: Object.keys(context.conversation || {}).length > 0
  };
  return Object.fromEntries(Object.entries(categories).map(([key, supplied]) =>
    [key, supplied ? 'supplied' : 'unavailable']
  ));
}

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
    conversation: formatConversationClaims(conversationContext),
    conversationSummary: conversationContext.summary || ''
  };
  for (const section of Object.keys(context)) {
    const value = context[section];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      context[section] = Object.fromEntries(Object.entries(value).filter(([, field]) =>
        field !== null && field !== undefined && field !== ''
      ));
    }
  }
  return context;
}

module.exports = { buildAIContext, buildFarmContext, getContextDiagnostics };
