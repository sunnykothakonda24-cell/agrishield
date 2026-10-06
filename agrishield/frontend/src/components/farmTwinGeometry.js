import { featureCollection, polygon } from '@turf/helpers';
import bboxPolygon from '@turf/bbox-polygon';
import { intersect } from '@turf/intersect';

export const METERS_PER_UNIT = 5;
export const ODUS_PER_ACRE = 3;
export const FARM_CAMERA_YAW_DEGREES = 45;
export const FARM_CAMERA_POLAR_DEGREES = 50;
const SQUARE_METERS_PER_ACRE = 4046.8564224;

const CROP_SPACING_METERS = [
  { match: /rice|paddy/, row: 0.3, plant: 0.25 },
  { match: /tomato/, row: 0.75, plant: 0.6 },
  { match: /cotton/, row: 0.9, plant: 0.45 },
  { match: /maize|corn/, row: 0.75, plant: 0.3 },
  { match: /chilli|chili/, row: 0.6, plant: 0.45 }
];
const AREA_EPSILON = 1e-6;

function wrapLongitudeDelta(longitude, reference) {
  return ((longitude - reference + 540) % 360) - 180;
}

export function normalizeFarmBoundary(points) {
  if (!Array.isArray(points)) return [];

  const normalized = [];
  for (const point of points) {
    const latitude = Number(Array.isArray(point) ? point[0] : point?.latitude ?? point?.lat);
    const longitude = Number(Array.isArray(point) ? point[1] : point?.longitude ?? point?.lng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return [];
    }
    if (!normalized.some(([lat, lon]) => lat === latitude && lon === longitude)) {
      normalized.push([latitude, longitude]);
    }
  }

  if (normalized.length > 3 &&
      normalized[0][0] === normalized[normalized.length - 1][0] &&
      normalized[0][1] === normalized[normalized.length - 1][1]) {
    normalized.pop();
  }
  return normalized.length >= 3 ? normalized : [];
}

export function createLocalFarmGeometry(boundaryPoints, metersPerUnit = METERS_PER_UNIT) {
  const points = normalizeFarmBoundary(boundaryPoints);
  if (points.length < 3 || !Number.isFinite(metersPerUnit) || metersPerUnit <= 0) return null;

  const referenceLatitude = points.reduce((sum, [latitude]) => sum + latitude, 0) / points.length;
  const firstLongitude = points[0][1];
  const longitudes = points.map(([, longitude]) =>
    firstLongitude + wrapLongitudeDelta(longitude, firstLongitude)
  );
  const referenceLongitude = longitudes.reduce((sum, longitude) => sum + longitude, 0) / points.length;
  const longitudeMeters = 111320 * Math.cos(referenceLatitude * Math.PI / 180);
  const localPoints = points.map(([latitude, longitude]) => ({
    x: (wrapLongitudeDelta(longitude, referenceLongitude) * longitudeMeters) / metersPerUnit,
    z: -((latitude - referenceLatitude) * 110540) / metersPerUnit
  }));
  const edgeCount = localPoints.length;
  for (let first = 0; first < edgeCount; first++) {
    const firstNext = (first + 1) % edgeCount;
    for (let second = first + 1; second < edgeCount; second++) {
      const secondNext = (second + 1) % edgeCount;
      if (first === second || firstNext === second || secondNext === first) continue;
      const a = localPoints[first];
      const b = localPoints[firstNext];
      const c = localPoints[second];
      const d = localPoints[secondNext];
      const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
      const firstSide = cross(a, b, c);
      const secondSide = cross(a, b, d);
      const thirdSide = cross(c, d, a);
      const fourthSide = cross(c, d, b);
      if (((firstSide > AREA_EPSILON && secondSide < -AREA_EPSILON) ||
          (firstSide < -AREA_EPSILON && secondSide > AREA_EPSILON)) &&
          ((thirdSide > AREA_EPSILON && fourthSide < -AREA_EPSILON) ||
          (thirdSide < -AREA_EPSILON && fourthSide > AREA_EPSILON))) {
        return null;
      }
    }
  }

  const areaTwice = localPoints.reduce((sum, point, index) => {
    const next = localPoints[(index + 1) % localPoints.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0);
  if (Math.abs(areaTwice) < AREA_EPSILON) return null;

  const xs = localPoints.map(({ x }) => x);
  const zs = localPoints.map(({ z }) => z);
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs)
  };
  return {
    points: localPoints,
    bounds,
    width: bounds.maxX - bounds.minX,
    depth: bounds.maxZ - bounds.minZ,
    areaUnitsSquared: Math.abs(areaTwice) / 2,
    metersPerUnit
  };
}

export function pointInFarmPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = (a.z > point.z) !== (b.z > point.z) &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function findInteriorFarmPoint(points, margin = 0) {
  if (points.length < 3) return null;
  const minX = Math.min(...points.map(({ x }) => x));
  const maxX = Math.max(...points.map(({ x }) => x));
  const minZ = Math.min(...points.map(({ z }) => z));
  const maxZ = Math.max(...points.map(({ z }) => z));
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const isSuitable = (candidate) => pointInFarmPolygon(candidate, points) &&
    points.every((start, index) =>
      distanceToSegment(candidate, start, points[(index + 1) % points.length]) >= margin);
  if (isSuitable(center)) return center;

  for (let row = 1; row <= 32; row++) {
    for (let column = 1; column <= 32; column++) {
      const candidate = {
        x: minX + ((maxX - minX) * column) / 33,
        z: minZ + ((maxZ - minZ) * row) / 33
      };
      if (isSuitable(candidate)) return candidate;
    }
  }
  return null;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.z - (start.z + projection * dz));
}

function dominantAxisAngle(points) {
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centerZ = points.reduce((sum, point) => sum + point.z, 0) / points.length;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const point of points) {
    const x = point.x - centerX;
    const z = point.z - centerZ;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }
  if (Math.abs(xx - zz) + Math.abs(xz) < 1e-9) {
    const longest = points.reduce((best, point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.hypot(next.x - point.x, next.z - point.z) >
        Math.hypot(best.end.x - best.start.x, best.end.z - best.start.z)
        ? { start: point, end: next }
        : best;
    }, { start: points[0], end: points[1] });
    return Math.atan2(longest.end.z - longest.start.z, longest.end.x - longest.start.x);
  }
  return 0.5 * Math.atan2(2 * xz, xx - zz);
}

export function createDeterministicCropLayout(points, cropName, {
  metersPerUnit = METERS_PER_UNIT,
  maxPlants = 1200,
  boundaryMarginMeters = null
} = {}) {
  if (!cropName || points.length < 3 || maxPlants < 1) return [];
  const crop = String(cropName).toLowerCase();
  const spacing = CROP_SPACING_METERS.find(({ match }) => match.test(crop)) ||
    { row: 1.2, plant: 0.6 };
  const rowSpacing = spacing.row / metersPerUnit;
  const plantSpacing = spacing.plant / metersPerUnit;
  const angle = dominantAxisAngle(points);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const projected = points.map(({ x, z }) => ({
    u: x * cos + z * sin,
    v: -x * sin + z * cos
  }));
  const minU = Math.min(...projected.map(({ u }) => u));
  const maxU = Math.max(...projected.map(({ u }) => u));
  const minV = Math.min(...projected.map(({ v }) => v));
  const maxV = Math.max(...projected.map(({ v }) => v));
  const columnCount = Math.ceil((maxU - minU) / plantSpacing);
  const rowCount = Math.ceil((maxV - minV) / rowSpacing);
  let stride = Math.max(1, Math.ceil(Math.sqrt((columnCount * rowCount) / maxPlants)));
  while (Math.ceil(columnCount / stride) * Math.ceil(rowCount / stride) > maxPlants) {
    stride++;
  }
  const plants = [];
  const boundaryMargin = Math.max(
    Math.min(plantSpacing, rowSpacing) * 0.3,
    Number.isFinite(boundaryMarginMeters) ? boundaryMarginMeters / metersPerUnit : 0
  );
  let rowIndex = 0;

  for (let v = minV + rowSpacing / 2; v < maxV; v += rowSpacing, rowIndex++) {
    if (rowIndex % stride !== 0) continue;
    let columnIndex = 0;
    for (let u = minU + plantSpacing / 2; u < maxU; u += plantSpacing, columnIndex++) {
      if (columnIndex % stride !== 0) continue;
      const point = { x: u * cos - v * sin, z: u * sin + v * cos };
      if (!pointInFarmPolygon(point, points)) continue;
      const nearestEdge = points.reduce((nearest, start, index) =>
        Math.min(nearest, distanceToSegment(point, start, points[(index + 1) % points.length])),
      Infinity);
      if (nearestEdge < boundaryMargin) continue;
      const variation = (Math.sin(rowIndex * 12.9898 + columnIndex * 78.233) + 1) / 2;
      plants.push({
        ...point,
        rotation: angle,
        scale: 0.94 + variation * 0.12,
        horizontalScale: Math.min(4, Math.max(1, stride * 0.45))
      });
    }
  }
  return plants;
}

export function calculateFarmAreaAcres(geometry) {
  if (!geometry || !Number.isFinite(geometry.areaUnitsSquared) ||
      !Number.isFinite(geometry.metersPerUnit) || geometry.metersPerUnit <= 0) return null;
  return geometry.areaUnitsSquared * geometry.metersPerUnit ** 2 / SQUARE_METERS_PER_ACRE;
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0)) / 2;
}

function closeRing(points) {
  const coordinates = points.map(({ x, z }) => [x, z]);
  coordinates.push(coordinates[0]);
  return coordinates;
}

function getIntersectedFragments(sourceFragments, bounds) {
  const features = sourceFragments.map(({ points }) => polygon([closeRing(points)]));
  const rectangle = bboxPolygon([bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ]);
  return features.flatMap((feature) => {
    const clipped = intersect(featureCollection([feature, rectangle]));
    if (!clipped) return [];
    const polygons = clipped.geometry.type === 'Polygon'
      ? [clipped.geometry.coordinates]
      : clipped.geometry.coordinates;
    return polygons.flatMap((rings) => {
      const points = rings[0].slice(0, -1).map(([x, z]) => ({ x, z }));
      const areaUnitsSquared = polygonArea(points);
      return areaUnitsSquared > AREA_EPSILON ? [{ points, areaUnitsSquared }] : [];
    });
  });
}

export function createDeterministicOduLayout(points, areaAcres, {
  metersPerUnit = METERS_PER_UNIT,
  odusPerAcre = ODUS_PER_ACRE
} = {}) {
  if (points.length < 3 || !Number.isFinite(metersPerUnit) || metersPerUnit <= 0 ||
      !Number.isFinite(odusPerAcre) || odusPerAcre <= 0) return [];

  const farmAreaUnitsSquared = polygonArea(points);
  if (farmAreaUnitsSquared <= AREA_EPSILON) return [];
  const computedAcres = farmAreaUnitsSquared * metersPerUnit ** 2 / SQUARE_METERS_PER_ACRE;
  const planningAcres = Number.isFinite(areaAcres) && areaAcres > 0 ? areaAcres : computedAcres;
  const targetCount = Math.max(1, Math.round(planningAcres * odusPerAcre));
  const angle = dominantAxisAngle(points);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toProjected = ({ x, z }) => ({
    x: x * cos + z * sin,
    z: -x * sin + z * cos
  });
  const toLocal = ({ x, z }) => ({
    x: x * cos - z * sin,
    z: x * sin + z * cos
  });
  const projected = points.map(toProjected);
  const initialArea = polygonArea(projected);
  const cells = [{
    fragments: [{ points: projected, areaUnitsSquared: initialArea }],
    areaUnitsSquared: initialArea
  }];

  while (cells.length < targetCount) {
    let splitIndex = -1;
    let bestSplit = null;
    const splitOrder = cells.map((cell, index) => index)
      .sort((first, second) => cells[second].areaUnitsSquared - cells[first].areaUnitsSquared);
    for (const index of splitOrder) {
      const fragments = cells[index].fragments;
      const allPoints = fragments.flatMap(({ points: fragment }) => fragment);
      const bounds = {
        minX: Math.min(...allPoints.map(({ x }) => x)),
        maxX: Math.max(...allPoints.map(({ x }) => x)),
        minZ: Math.min(...allPoints.map(({ z }) => z)),
        maxZ: Math.max(...allPoints.map(({ z }) => z))
      };
      const preferredAxis = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ ? 'x' : 'z';
      let candidate = null;
      for (const axis of [preferredAxis, preferredAxis === 'x' ? 'z' : 'x']) {
        const min = axis === 'x' ? bounds.minX : bounds.minZ;
        const max = axis === 'x' ? bounds.maxX : bounds.maxZ;
        for (const fraction of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
          const cut = min + (max - min) * fraction;
          const firstBounds = axis === 'x'
            ? { ...bounds, maxX: cut }
            : { ...bounds, maxZ: cut };
          const secondBounds = axis === 'x'
            ? { ...bounds, minX: cut }
            : { ...bounds, minZ: cut };
          const first = getIntersectedFragments(fragments, firstBounds);
          const second = getIntersectedFragments(fragments, secondBounds);
          if (!first.length || !second.length) continue;
          const firstArea = first.reduce((sum, fragment) => sum + fragment.areaUnitsSquared, 0);
          const secondArea = second.reduce((sum, fragment) => sum + fragment.areaUnitsSquared, 0);
          const balance = Math.abs(firstArea - secondArea);
          if (!candidate || balance < candidate.balance) {
            candidate = {
              first: { fragments: first, areaUnitsSquared: firstArea },
              second: { fragments: second, areaUnitsSquared: secondArea },
              balance
            };
          }
          if (balance < AREA_EPSILON) break;
        }
        if (candidate && candidate.balance < AREA_EPSILON) break;
      }
      if (candidate) {
        splitIndex = index;
        bestSplit = candidate;
        break;
      }
    }
    if (!bestSplit) break;
    cells.splice(splitIndex, 1, bestSplit.first, bestSplit.second);
  }

  return cells.map((cell, index) => {
    const fragments = cell.fragments.map((fragment) => ({
      ...fragment,
      points: fragment.points.map(toLocal)
    }));
    const fragmentPoints = fragments.flatMap(({ points: fragment }) => fragment);
    return {
      id: index + 1,
      angle,
      fragments,
      areaUnitsSquared: cell.areaUnitsSquared,
      areaAcres: cell.areaUnitsSquared * metersPerUnit ** 2 / SQUARE_METERS_PER_ACRE,
      bounds: {
        minX: Math.min(...fragmentPoints.map(({ x }) => x)),
        maxX: Math.max(...fragmentPoints.map(({ x }) => x)),
        minZ: Math.min(...fragmentPoints.map(({ z }) => z)),
        maxZ: Math.max(...fragmentPoints.map(({ z }) => z))
      }
    };
  });
}

export function createOduCropLayouts(odus, cropName, {
  metersPerUnit = METERS_PER_UNIT,
  maxPlants = 1200,
  boundaryMarginMeters = 0
} = {}) {
  if (!cropName || !odus.length || maxPlants < 1) {
    return odus.map((odu) => ({ ...odu, cropLayout: [] }));
  }
  const totalArea = odus.reduce((sum, odu) => sum + odu.areaUnitsSquared, 0);
  let remainingPlantBudget = maxPlants;
  return odus.map((odu, oduIndex) => {
    const oduBudget = oduIndex === odus.length - 1
      ? remainingPlantBudget
      : Math.max(1, Math.floor(maxPlants * odu.areaUnitsSquared / totalArea));
    remainingPlantBudget = Math.max(0, remainingPlantBudget - oduBudget);
    let remainingFragmentBudget = oduBudget;
    const cropLayout = odu.fragments.flatMap((fragment, fragmentIndex) => {
      const fragmentBudget = fragmentIndex === odu.fragments.length - 1
        ? remainingFragmentBudget
        : Math.max(1, Math.floor(oduBudget * fragment.areaUnitsSquared / odu.areaUnitsSquared));
      remainingFragmentBudget = Math.max(0, remainingFragmentBudget - fragmentBudget);
      return createDeterministicCropLayout(fragment.points, cropName, {
        metersPerUnit,
        maxPlants: fragmentBudget,
        boundaryMarginMeters
      });
    });
    return { ...odu, cropLayout };
  });
}

export function calculateArcProgress(now, start, end) {
  if (!(now instanceof Date) || !(start instanceof Date) || !(end instanceof Date) ||
      !Number.isFinite(now.getTime()) || !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) || end <= start) return null;
  return Math.max(0, Math.min(1, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
}

export function calculateVisualArcOffset(progress, span, heightBase, heightRange, horizontalRange = 1.25) {
  if (![progress, span, heightBase, heightRange, horizontalRange].every(Number.isFinite) ||
      progress < 0 || progress > 1 || span <= 0 || heightBase < 0 || heightRange < 0 ||
      horizontalRange <= 0) return null;
  return {
    x: (progress - 0.5) * span * horizontalRange,
    y: (heightBase + Math.sin(progress * Math.PI) * heightRange) * span
  };
}

export function sunDirectionFromAzimuth(azimuthDegrees, altitudeDegrees, radius = 1) {
  const azimuth = azimuthDegrees * Math.PI / 180;
  const altitude = altitudeDegrees * Math.PI / 180;
  const horizontal = Math.cos(altitude) * radius;
  return {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(altitude) * radius,
    z: -Math.cos(azimuth) * horizontal
  };
}

export function windDirectionToVector(directionDegrees) {
  if (!Number.isFinite(directionDegrees)) return null;
  const toward = (directionDegrees + 180) * Math.PI / 180;
  return {
    x: Math.sin(toward),
    z: -Math.cos(toward)
  };
}

export function calculateFarmCameraDistance(width, depth, fovDegrees, aspect, padding = 1.5) {
  if (![width, depth, fovDegrees, aspect, padding].every(Number.isFinite) ||
      width <= 0 || depth <= 0 || fovDegrees <= 0 || fovDegrees >= 180 || aspect <= 0 || padding <= 0) {
    return null;
  }
  const halfFovTangent = Math.tan((fovDegrees * Math.PI / 180) / 2);
  const cameraYaw = FARM_CAMERA_YAW_DEGREES * Math.PI / 180;
  const cameraPolar = FARM_CAMERA_POLAR_DEGREES * Math.PI / 180;
  const halfHorizontalExtent = (
    Math.abs(Math.cos(cameraYaw)) * width +
    Math.abs(Math.sin(cameraYaw)) * depth
  ) / 2;
  const halfVerticalExtent = (
    Math.abs(Math.cos(cameraPolar) * Math.sin(cameraYaw)) * width +
    Math.abs(Math.cos(cameraPolar) * Math.cos(cameraYaw)) * depth
  ) / 2;
  return Math.max(
    halfVerticalExtent / halfFovTangent,
    halfHorizontalExtent / (halfFovTangent * aspect)
  ) * padding;
}

export function isFarmWeatherFresh(weather, now = new Date(), maxAgeMs = 30 * 60 * 1000) {
  if (!weather?.available || !weather.current) return false;
  const retrievedAt = weather.retrievedAt || weather.timestamp;
  if (!retrievedAt) return false;
  const age = now.getTime() - new Date(retrievedAt).getTime();
  return Number.isFinite(age) && age >= -60_000 && age <= maxAgeMs;
}

export function isRainReported(currentWeather) {
  return Boolean(currentWeather && (
    (Number.isFinite(currentWeather.precipitation) && currentWeather.precipitation > 0.1) ||
    (Number.isFinite(currentWeather.rain) && currentWeather.rain > 0.1) ||
    (Number.isFinite(currentWeather.showers) && currentWeather.showers > 0.1) ||
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(Number(currentWeather.weatherCode))
  ));
}

export function getFarmNow() {
  if (import.meta.env?.DEV && globalThis.__AGRISHIELD_FARM_TWIN_NOW__) {
    const injected = new Date(globalThis.__AGRISHIELD_FARM_TWIN_NOW__);
    if (Number.isFinite(injected.getTime())) return injected;
  }
  return new Date();
}

export function getFarmTimeZone(farm = {}, weather = null) {
  const location = farm.farmLocation || farm.location || {};
  const candidates = [
    farm.timezone,
    farm.timeZone,
    location.timezone,
    location.timeZone,
    weather?.timezone
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      new Intl.DateTimeFormat('en', { timeZone: candidate }).format();
      return candidate;
    } catch {
      continue;
    }
  }
  return String(location.country || '').trim().toLowerCase() === 'india'
    ? 'Asia/Kolkata'
    : 'UTC';
}

export function getFarmLocalTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timeZone || 'UTC'
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return {
    hour,
    minute,
    hourMinute: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  };
}

function weatherConditionKey(currentWeather) {
  const code = currentWeather?.weatherCode === null || currentWeather?.weatherCode === undefined ||
    currentWeather?.weatherCode === ''
    ? NaN
    : Number(currentWeather.weatherCode);
  const codeMap = new Map([
    [0, 'clear'], [1, 'mostlyClear'], [2, 'partlyCloudy'], [3, 'cloudy'],
    [45, 'fog'], [48, 'fog'],
    [51, 'lightDrizzle'], [53, 'drizzle'], [55, 'drizzle'], [56, 'freezingDrizzle'], [57, 'freezingDrizzle'],
    [61, 'lightRain'], [63, 'rain'], [65, 'heavyRain'], [66, 'freezingRain'], [67, 'freezingRain'],
    [71, 'lightSnow'], [73, 'snow'], [75, 'heavySnow'], [77, 'snow'],
    [80, 'lightRain'], [81, 'rain'], [82, 'heavyRain'], [85, 'lightSnow'], [86, 'heavySnow'],
    [95, 'thunderstorm'], [96, 'thunderstorm'], [99, 'thunderstorm']
  ]);
  const mapped = codeMap.get(code);
  if (mapped) return mapped;
  const precipitationValue = currentWeather?.precipitation ?? currentWeather?.rain ?? currentWeather?.showers;
  const precipitation = precipitationValue === null || precipitationValue === undefined
    ? NaN
    : Number(precipitationValue);
  if (Number.isFinite(precipitation) && precipitation > 0.1) {
    return precipitation >= 7.5 ? 'heavyRain' : precipitation >= 2.5 ? 'rain' : 'lightRain';
  }
  const cloudCover = currentWeather?.cloudCover === null || currentWeather?.cloudCover === undefined
    ? NaN
    : Number(currentWeather.cloudCover);
  if (Number.isFinite(cloudCover)) {
    return cloudCover >= 80 ? 'cloudy' : cloudCover >= 20 ? 'partlyCloudy' : 'clear';
  }
  return null;
}

export function buildFarmWeatherSummary({
  currentWeather,
  farmLocalTime,
  isDay,
  sunPhase,
  language = 'en'
}) {
  if (!currentWeather) return null;
  const locale = ['hi', 'te'].includes(language) ? language : 'en';
  const hour = Number(farmLocalTime?.hour);
  const night = isDay === false || (isDay === undefined && sunPhase === 'night') ||
    (isDay === undefined && sunPhase === undefined && Number.isFinite(hour) && (hour < 5 || hour >= 19));
  const period = night
    ? 'night'
    : !Number.isFinite(hour) ? 'day'
      : hour < 12 ? 'morning' : hour < 14 ? 'midday' : hour < 18 ? 'afternoon' : 'evening';
  const condition = weatherConditionKey(currentWeather);
  const translations = {
    en: {
      title: 'Current Farm Weather',
      clearDay: `Clear and sunny this ${period}.`,
      clearNight: 'Clear night skies at your farm.',
      mostlyClearDay: `Mostly clear this ${period} at your farm.`,
      mostlyClearNight: 'Mostly clear skies tonight at your farm.',
      partlyCloudy: `Partly cloudy conditions at your farm this ${period}.`,
      partlyCloudyNight: 'Partly cloudy skies over your farm tonight.',
      cloudy: `Cloudy conditions at your farm this ${period}.`,
      cloudyNight: 'Cloudy skies over your farm tonight.',
      rain: 'Rain is currently affecting your farm.',
      drizzle: 'Drizzle is currently reported at your farm.',
      freezingDrizzle: 'Freezing drizzle is currently reported at your farm.',
      heavyRain: 'Heavy rain is currently reported at your farm.',
      freezingRain: 'Freezing rain is currently reported at your farm.',
      lightSnow: `Light snow is reported at your farm this ${period}.`,
      snow: `Snow is reported at your farm this ${period}.`,
      heavySnow: `Heavy snow is reported at your farm this ${period}.`,
      fog: `Fog or mist is reported at your farm this ${period}.`,
      thunderstorm: 'Thunderstorm conditions are currently reported at your farm.',
      unknown: 'Current weather conditions are available for your farm.',
      unavailable: 'Current weather data is unavailable for your farm.',
      humidity: 'humidity',
      precipitation: 'precipitation',
      wind: 'wind'
    },
    hi: {
      title: 'खेत का वर्तमान मौसम',
      clearDay: `आज ${period === 'morning' ? 'सुबह' : period === 'midday' ? 'दोपहर' : period === 'afternoon' ? 'दोपहर' : 'शाम'} साफ़ और धूप है।`,
      clearNight: 'आपके खेत में रात का आसमान साफ़ है।',
      mostlyClearDay: 'आपके खेत में आसमान अधिकतर साफ़ है।',
      mostlyClearNight: 'आपके खेत में रात का आसमान अधिकतर साफ़ है।',
      partlyCloudy: 'आपके खेत में आंशिक बादल हैं।',
      partlyCloudyNight: 'आपके खेत के ऊपर रात में आंशिक बादल हैं।',
      cloudy: 'आपके खेत में बादल छाए हैं।',
      cloudyNight: 'आपके खेत के ऊपर रात में बादल छाए हैं।',
      rain: 'आपके खेत में अभी बारिश हो रही है।',
      drizzle: 'आपके खेत में अभी बूंदाबांदी दर्ज की गई है।',
      freezingDrizzle: 'आपके खेत में अभी जमने वाली बूंदाबांदी दर्ज की गई है।',
      heavyRain: 'आपके खेत में अभी तेज़ बारिश दर्ज की गई है।',
      freezingRain: 'आपके खेत में अभी जमने वाली बारिश दर्ज की गई है।',
      lightSnow: 'आपके खेत में हल्की बर्फ़बारी दर्ज की गई है।',
      snow: 'आपके खेत में बर्फ़बारी दर्ज की गई है।',
      heavySnow: 'आपके खेत में भारी बर्फ़बारी दर्ज की गई है।',
      fog: 'आपके खेत में कोहरा या धुंध दर्ज की गई है।',
      thunderstorm: 'आपके खेत में अभी गरज-चमक की स्थिति दर्ज की गई है।',
      unknown: 'आपके खेत का वर्तमान मौसम उपलब्ध है।',
      unavailable: 'आपके खेत का वर्तमान मौसम उपलब्ध नहीं है।',
      humidity: 'नमी',
      precipitation: 'वर्षा',
      wind: 'हवा'
    },
    te: {
      title: 'ప్రస్తుత పొలం వాతావరణం',
      clearDay: `ఈ ${period === 'morning' ? 'ఉదయం' : period === 'midday' ? 'మధ్యాహ్నం' : period === 'afternoon' ? 'మధ్యాహ్నం' : 'సాయంత్రం'} ఆకాశం నిర్మలంగా, ఎండగా ఉంది.`,
      clearNight: 'మీ పొలం వద్ద రాత్రి ఆకాశం నిర్మలంగా ఉంది.',
      mostlyClearDay: 'మీ పొలం వద్ద ఆకాశం ఎక్కువగా నిర్మలంగా ఉంది.',
      mostlyClearNight: 'మీ పొలం వద్ద రాత్రి ఆకాశం ఎక్కువగా నిర్మలంగా ఉంది.',
      partlyCloudy: 'మీ పొలం వద్ద పాక్షికంగా మేఘావృతంగా ఉంది.',
      partlyCloudyNight: 'మీ పొలం వద్ద రాత్రి పాక్షికంగా మేఘావృతంగా ఉంది.',
      cloudy: 'మీ పొలం వద్ద మేఘావృతంగా ఉంది.',
      cloudyNight: 'మీ పొలం వద్ద రాత్రి మేఘావృతంగా ఉంది.',
      rain: 'మీ పొలం వద్ద ప్రస్తుతం వర్షం పడుతోంది.',
      drizzle: 'మీ పొలం వద్ద ప్రస్తుతం చిరుజల్లులు నమోదయ్యాయి.',
      freezingDrizzle: 'మీ పొలం వద్ద ప్రస్తుతం గడ్డకట్టే చిరుజల్లులు నమోదయ్యాయి.',
      heavyRain: 'మీ పొలం వద్ద ప్రస్తుతం భారీ వర్షం నమోదైంది.',
      freezingRain: 'మీ పొలం వద్ద ప్రస్తుతం గడ్డకట్టే వర్షం నమోదైంది.',
      lightSnow: 'మీ పొలం వద్ద తేలికపాటి మంచు కురుస్తోంది.',
      snow: 'మీ పొలం వద్ద మంచు కురుస్తోంది.',
      heavySnow: 'మీ పొలం వద్ద భారీగా మంచు కురుస్తోంది.',
      fog: 'మీ పొలం వద్ద పొగమంచు నమోదైంది.',
      thunderstorm: 'మీ పొలం వద్ద ప్రస్తుతం ఉరుములు, మెరుపులతో కూడిన వాతావరణం నమోదైంది.',
      unknown: 'మీ పొలం ప్రస్తుత వాతావరణ సమాచారం అందుబాటులో ఉంది.',
      unavailable: 'మీ పొలం ప్రస్తుత వాతావరణ సమాచారం అందుబాటులో లేదు.',
      humidity: 'తేమ',
      precipitation: 'వర్షపాతం',
      wind: 'గాలి'
    }
  }[locale];

  const summaryKey = condition === 'clear'
    ? night ? 'clearNight' : 'clearDay'
    : condition === 'mostlyClear'
      ? night ? 'mostlyClearNight' : 'mostlyClearDay'
      : condition === 'partlyCloudy' ? night ? 'partlyCloudyNight' : 'partlyCloudy'
        : condition === 'cloudy' ? night ? 'cloudyNight' : 'cloudy'
          : ['lightRain', 'rain'].includes(condition) ? 'rain'
            : condition === 'drizzle' ? 'drizzle'
              : condition === 'lightDrizzle' ? 'drizzle'
                : condition === 'freezingDrizzle' ? 'freezingDrizzle'
                  : condition === 'heavyRain' ? 'heavyRain'
                    : condition === 'freezingRain' ? 'freezingRain'
                      : condition === 'lightSnow' ? 'lightSnow'
                        : condition === 'snow' ? 'snow'
                          : condition === 'heavySnow' ? 'heavySnow'
                            : condition === 'fog' ? 'fog'
                              : condition === 'thunderstorm' ? 'thunderstorm'
                                : 'unknown';
  const summary = translations[summaryKey] || translations.unknown;
  const details = [];
  const readMeasurement = (value) => value === null || value === undefined || value === ''
    ? NaN
    : Number(value);
  const temperature = readMeasurement(currentWeather.temperature);
  const humidity = readMeasurement(currentWeather.humidity);
  const precipitation = readMeasurement(currentWeather.precipitation);
  const windSpeed = readMeasurement(currentWeather.windSpeed);
  if (Number.isFinite(temperature)) details.push(`${Math.round(temperature)}°C`);
  if (Number.isFinite(humidity)) details.push(`${Math.round(humidity)}% ${translations.humidity}`);
  if (Number.isFinite(precipitation)) details.push(`${precipitation.toFixed(1)} mm ${translations.precipitation}`);
  if (Number.isFinite(windSpeed)) details.push(`${Math.round(windSpeed)} km/h ${translations.wind}`);
  return {
    title: translations.title,
    summary,
    detail: details.length ? details.join(' · ') : null
  };
}

export function millisecondsUntilNextMinute(timestamp = Date.now()) {
  if (!Number.isFinite(timestamp)) return 60_000;
  return (Math.floor(timestamp / 60_000) + 1) * 60_000 - timestamp;
}
