const ALLOWED_PRODUCT_CATEGORIES = new Set(['seed', 'fertilizer']);
const SAVED_ACTIVITY_STATUSES = new Set(['COMPLETED', 'NOT_YET', 'SKIPPED']);

function cropKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function localDateInTimeZone(date, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
  } catch {
    throw new Error('A valid IANA time zone is required.');
  }
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function validateProtocol(protocol) {
  if (!protocol || protocol.enabled !== true) return false;
  if (!Array.isArray(protocol.stages) || !Array.isArray(protocol.activities)) {
    throw new Error('The configured crop protocol must define stages and activities arrays.');
  }
  for (const stage of protocol.stages) {
    if (!stage || typeof stage.name !== 'string' || !stage.name.trim() ||
        !Number.isInteger(stage.startDay) || stage.startDay < 0 ||
        !Number.isInteger(stage.endDay) || stage.endDay < stage.startDay) {
      throw new Error('The configured crop protocol contains an invalid growth stage.');
    }
  }
  const sortedStages = [...protocol.stages].sort((left, right) => left.startDay - right.startDay);
  for (let index = 1; index < sortedStages.length; index++) {
    if (sortedStages[index].startDay <= sortedStages[index - 1].endDay) {
      throw new Error('Configured crop protocol growth stages must not overlap.');
    }
  }
  const ids = new Set();
  for (const activity of protocol.activities) {
    if (!activity || typeof activity.id !== 'string' || !activity.id.trim() ||
        typeof activity.name !== 'string' || !activity.name.trim() ||
        !Number.isInteger(activity.dayAfterStart) || activity.dayAfterStart < 0 ||
        (activity.productCategory && !ALLOWED_PRODUCT_CATEGORIES.has(activity.productCategory))) {
      throw new Error('The configured crop protocol contains an invalid activity.');
    }
    if (ids.has(activity.id)) throw new Error('Crop protocol activity IDs must be unique.');
    ids.add(activity.id);
  }
  return true;
}

function buildCropSchedule({ farm, protocol, activityStatuses = [], timeZone = 'UTC', now = new Date() }) {
  const cropName = farm?.cropDetails?.name || farm?.crop || null;
  if (!cropName) {
    return { configured: false, reason: 'no_crop', crop: null, cropAgeDays: null, currentStage: null, activities: [] };
  }

  if (!validateProtocol(protocol)) {
    return { configured: false, reason: 'no_protocol', crop: cropName, cropAgeDays: null, currentStage: null, activities: [] };
  }

  const variety = farm?.cropDetails?.variety || null;
  if (protocol.variety && String(protocol.variety).toLocaleLowerCase() !== String(variety || '').toLocaleLowerCase()) {
    return { configured: false, reason: 'protocol_variety_mismatch', crop: cropName, cropAgeDays: null, currentStage: null, activities: [] };
  }

  const plantingDate = parseDateOnly(farm?.cropDetails?.plantingDate || farm?.plantingDate);
  if (!plantingDate) {
    return {
      configured: true,
      reason: 'planting_date_missing',
      crop: cropName,
      variety,
      cropAgeDays: null,
      currentStage: null,
      activities: []
    };
  }

  const today = localDateInTimeZone(now, timeZone);
  const todayDate = parseDateOnly(today);
  const cropAgeDays = Math.floor((todayDate.getTime() - plantingDate.getTime()) / 86400000);
  if (cropAgeDays < 0) {
    return {
      configured: true,
      reason: 'planting_date_in_future',
      crop: cropName,
      variety,
      cropAgeDays: null,
      currentStage: null,
      today,
      timeZone,
      activities: []
    };
  }
  const currentStage = protocol.stages.find((stage) =>
    cropAgeDays >= stage.startDay && cropAgeDays <= stage.endDay
  )?.name || null;
  const statuses = new Map(activityStatuses.map((entry) => [
    `${entry.activityId}:${entry.scheduledDate}`,
    entry.status
  ]));
  const activities = protocol.activities.map((activity) => {
    const scheduledDate = addDays(plantingDate, activity.dayAfterStart);
    const savedStatus = statuses.get(`${activity.id}:${scheduledDate}`);
    if (savedStatus && !SAVED_ACTIVITY_STATUSES.has(savedStatus)) {
      throw new Error('A saved crop activity has an invalid status.');
    }
    return {
      id: activity.id,
      name: activity.name,
      type: activity.type || null,
      productCategory: activity.productCategory || null,
      productQuery: activity.productQuery || null,
      dayAfterStart: activity.dayAfterStart,
      stage: activity.stage || null,
      scheduledDate,
      status: savedStatus || (scheduledDate <= today ? 'DUE' : 'UPCOMING'),
      completedAt: activityStatuses.find((entry) =>
        entry.activityId === activity.id && entry.scheduledDate === scheduledDate
      )?.completedAt || null
    };
  }).filter((activity) => {
    const ageFromToday = Math.floor((parseDateOnly(activity.scheduledDate).getTime() - todayDate.getTime()) / 86400000);
    return ageFromToday >= -30 || statuses.has(`${activity.id}:${activity.scheduledDate}`);
  }).sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate));

  return {
    configured: true,
    reason: cropAgeDays < 0 ? 'planting_date_in_future' : null,
    crop: cropName,
    variety,
    cropAgeDays,
    currentStage,
    today,
    timeZone,
    activities
  };
}

module.exports = {
  buildCropSchedule,
  cropKey,
  localDateInTimeZone,
  parseDateOnly,
  SAVED_ACTIVITY_STATUSES
};
