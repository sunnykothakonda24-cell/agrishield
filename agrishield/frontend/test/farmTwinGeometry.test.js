import assert from 'node:assert/strict';
import test from 'node:test';
import * as SunCalc from 'suncalc';
import {
  createDeterministicCropLayout,
  createDeterministicOduLayout,
  createOduCropLayouts,
  calculateFarmCameraDistance,
  calculateArcProgress,
  calculateFarmAreaAcres,
  calculateVisualArcOffset,
  createLocalFarmGeometry,
  buildFarmWeatherSummary,
  getFarmLocalTime,
  isFarmWeatherFresh,
  isRainReported,
  millisecondsUntilNextMinute,
  normalizeFarmBoundary,
  pointInFarmPolygon,
  sunDirectionFromAzimuth,
  windDirectionToVector
} from '../src/components/farmTwinGeometry.js';

const rectangle = [
  [17.3, 78.4],
  [17.3, 78.401],
  [17.301, 78.401],
  [17.301, 78.4]
];

test('converts saved geographic points to stable local east/north meter coordinates', () => {
  const geometry = createLocalFarmGeometry(rectangle);
  assert.ok(geometry);
  assert.ok(geometry.points[1].x > geometry.points[0].x);
  assert.ok(geometry.points[2].z < geometry.points[1].z);
  assert.ok(Math.abs(geometry.width * 5 - 106) < 2);
  assert.ok(Math.abs(geometry.depth * 5 - 111) < 2);
});

test('rejects missing, invalid, and degenerate boundaries rather than drawing a demo plot', () => {
  assert.deepEqual(normalizeFarmBoundary([]), []);
  assert.deepEqual(normalizeFarmBoundary([[17, 78], [91, 78], [17, 79]]), []);
  assert.equal(createLocalFarmGeometry([[17, 78], [17.1, 78.1], [17.2, 78.2]]), null);
});

test('uses the farm-local hour and current Open-Meteo conditions for weather summaries', () => {
  const localTime = getFarmLocalTime(new Date('2026-10-05T05:30:00.000Z'), 'Asia/Kolkata');
  assert.deepEqual(localTime, { hour: 11, minute: 0, hourMinute: '11:00' });
  assert.match(buildFarmWeatherSummary({
    currentWeather: { weatherCode: 0, temperature: 30, humidity: 65, precipitation: 0 },
    farmLocalTime: localTime,
    isDay: true
  }).summary, /Clear and sunny this morning/);
  assert.match(buildFarmWeatherSummary({
    currentWeather: { weatherCode: 0, temperature: 29 },
    farmLocalTime: { hour: 23, minute: 10 },
    isDay: false
  }).summary, /Clear night skies/);
  assert.match(buildFarmWeatherSummary({
    currentWeather: { weatherCode: 3 },
    farmLocalTime: { hour: 15 },
    isDay: true
  }).summary, /Cloudy conditions/);
  const rain = buildFarmWeatherSummary({
    currentWeather: { weatherCode: 61, precipitation: 1.2 },
    farmLocalTime: { hour: 15 },
    isDay: true
  });
  assert.match(rain.summary, /Rain is currently affecting/);
  assert.doesNotMatch(rain.summary, /sunny/i);
  assert.equal(rain.detail, '1.2 mm precipitation');
});

test('clips deterministic crop rows to the actual polygon interior', () => {
  const geometry = createLocalFarmGeometry(rectangle);
  const first = createDeterministicCropLayout(geometry.points, 'Rice');
  const second = createDeterministicCropLayout(geometry.points, 'Rice');
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.ok(first.every((point) => pointInFarmPolygon(point, geometry.points)));
  const plantBounds = {
    minX: Math.min(...first.map(({ x }) => x)),
    maxX: Math.max(...first.map(({ x }) => x)),
    minZ: Math.min(...first.map(({ z }) => z)),
    maxZ: Math.max(...first.map(({ z }) => z))
  };
  assert.ok(plantBounds.maxX - plantBounds.minX > geometry.width * 0.7);
  assert.ok(plantBounds.maxZ - plantBounds.minZ > geometry.depth * 0.7);
  const cappedLayout = createDeterministicCropLayout(geometry.points, 'Rice', { maxPlants: 20 });
  assert.ok(cappedLayout.length > 0 && cappedLayout.length <= 20);
  assert.ok(Math.max(...cappedLayout.map(({ x }) => x)) -
    Math.min(...cappedLayout.map(({ x }) => x)) > geometry.width * 0.5);

  const irregular = createLocalFarmGeometry([
    [17.3, 78.4],
    [17.3, 78.402],
    [17.3005, 78.401],
    [17.302, 78.402],
    [17.302, 78.4]
  ]);
  const irregularLayout = createDeterministicCropLayout(irregular.points, 'Maize');
  assert.ok(irregularLayout.every((point) => pointInFarmPolygon(point, irregular.points)));
  assert.ok(first.length <= 1200);
});

test('plans ODU counts from farm acreage and partitions the saved polygon', () => {
  const geometry = createLocalFarmGeometry(rectangle);
  assert.ok(geometry);
  assert.ok(Math.abs(calculateFarmAreaAcres(geometry) - 2.9) < 0.1);
  for (const [acres, expectedCount] of [[1, 3], [2, 6], [4, 12], [4.35, 13]]) {
    const odus = createDeterministicOduLayout(geometry.points, acres);
    assert.equal(odus.length, expectedCount);
    assert.ok(Math.abs(
      odus.reduce((sum, odu) => sum + odu.areaUnitsSquared, 0) - geometry.areaUnitsSquared
    ) < geometry.areaUnitsSquared * 1e-7);
    assert.deepEqual(odus, createDeterministicOduLayout(geometry.points, acres));
  }

  const irregular = createLocalFarmGeometry([
    [17.3, 78.4],
    [17.3, 78.402],
    [17.3005, 78.401],
    [17.302, 78.402],
    [17.302, 78.4]
  ]);
  const irregularOdus = createDeterministicOduLayout(irregular.points, 4.35);
  assert.equal(irregularOdus.length, 13);
  assert.ok(Math.abs(
    irregularOdus.reduce((sum, odu) => sum + odu.areaUnitsSquared, 0) - irregular.areaUnitsSquared
  ) < irregular.areaUnitsSquared * 1e-7);

  const longFarm = createLocalFarmGeometry([
    [17.3, 78.4],
    [17.3, 78.406],
    [17.3002, 78.406],
    [17.3002, 78.4]
  ]);
  const longOdus = createDeterministicOduLayout(longFarm.points, 2);
  assert.equal(longOdus.length, 6);
  assert.ok(longOdus.every((odu) => odu.fragments.length > 0));
});

test('keeps crop layouts deterministic, ODU-local, and within the instance budget', () => {
  const geometry = createLocalFarmGeometry(rectangle);
  const odus = createDeterministicOduLayout(geometry.points, 4.35);
  const first = createOduCropLayouts(odus, 'Rice', { maxPlants: 800, boundaryMarginMeters: 0.6 });
  const second = createOduCropLayouts(odus, 'Rice', { maxPlants: 800, boundaryMarginMeters: 0.6 });
  assert.deepEqual(first, second);
  const cropPoints = first.flatMap((odu) => odu.cropLayout);
  assert.ok(cropPoints.length > 0 && cropPoints.length <= 800);
  assert.ok(cropPoints.every((plant) => pointInFarmPolygon(plant, geometry.points)));
  assert.ok(first.every((odu) => odu.cropLayout.every((plant) =>
    odu.fragments.some((fragment) => pointInFarmPolygon(plant, fragment.points))
  )));
  assert.ok(cropPoints.every(({ scale }) => scale >= 0.94 && scale <= 1.06));
  assert.ok(cropPoints.every(({ horizontalScale }) => horizontalScale >= 1 && horizontalScale <= 4));
});

test('maps daytime onto a smooth left-to-right solar arc', () => {
  const time = (hour, minute = 0) => new Date(Date.UTC(2026, 9, 2, hour, minute));
  const sunrise = time(6, 30);
  const sunset = time(18);
  const progress = (hour, minute = 0) => calculateArcProgress(time(hour, minute), sunrise, sunset);
  assert.ok(progress(6, 30) < 0.01);
  assert.ok(progress(8) < progress(10));
  assert.ok(Math.abs(progress(12, 15) - 0.5) < 0.01);
  assert.ok(progress(14) < progress(16));
  assert.ok(progress(17, 30) > 0.95);
  assert.equal(progress(6), 0);
  assert.equal(progress(19), 1);
  assert.equal(calculateArcProgress(time(0), time(0), time(0)), null);
  const left = calculateVisualArcOffset(progress(6, 30), 40, 0.1, 0.28);
  const morning = calculateVisualArcOffset(progress(8), 40, 0.1, 0.28);
  const noon = calculateVisualArcOffset(progress(12, 15), 40, 0.1, 0.28);
  const afternoon = calculateVisualArcOffset(progress(14), 40, 0.1, 0.28);
  const evening = calculateVisualArcOffset(progress(16), 40, 0.1, 0.28);
  const sunsetPoint = calculateVisualArcOffset(progress(17, 30), 40, 0.1, 0.28);
  assert.ok(left.x < morning.x && morning.x < noon.x);
  assert.ok(noon.x < afternoon.x && afternoon.x < evening.x && evening.x < sunsetPoint.x);
  assert.ok(noon.y > left.y && noon.y > sunsetPoint.y);
  assert.equal(noon.x, 0);
});

test('schedules Farm Twin clock refreshes on real minute boundaries', () => {
  assert.equal(millisecondsUntilNextMinute(0), 60_000);
  assert.equal(millisecondsUntilNextMinute(1), 59_999);
  assert.equal(millisecondsUntilNextMinute(59_999), 1);
  assert.equal(millisecondsUntilNextMinute(Number.NaN), 60_000);
});

test('fits camera distance to real farm bounds without changing its aspect ratio', () => {
  const small = createLocalFarmGeometry([
    [17.3, 78.4],
    [17.3, 78.4001],
    [17.3001, 78.4001],
    [17.3001, 78.4]
  ]);
  const long = createLocalFarmGeometry([
    [17.3, 78.4],
    [17.3, 78.402],
    [17.3001, 78.402],
    [17.3001, 78.4]
  ]);
  const smallDistance = calculateFarmCameraDistance(small.width, small.depth, 40, 1.6);
  const longDistance = calculateFarmCameraDistance(long.width, long.depth, 40, 1.6);
  const closeDistance = calculateFarmCameraDistance(long.width, long.depth, 40, 1.6, 0.95);
  assert.ok(longDistance > smallDistance);
  assert.ok(closeDistance < longDistance);
  assert.ok(long.width / long.depth > 10);
  assert.equal(calculateFarmCameraDistance(0, 10, 40, 1.6), null);
});

test('maps astronomical azimuth to geographic east, south, west and north correctly', () => {
  assert.ok(sunDirectionFromAzimuth(90, 20).x > 0);
  assert.ok(sunDirectionFromAzimuth(180, 20).z > 0);
  assert.ok(sunDirectionFromAzimuth(270, 20).x < 0);
  assert.ok(sunDirectionFromAzimuth(0, 20).z < 0);
});

test('reverses meteorological wind-from direction into expected cloud drift', () => {
  const northeastWind = windDirectionToVector(45);
  assert.ok(northeastWind.x < 0);
  assert.ok(northeastWind.z > 0);
});

test('only accepts fresh weather and reported precipitation for weather visuals', () => {
  const now = new Date('2026-10-02T08:00:00Z');
  const weather = {
    available: true,
    retrievedAt: '2026-10-02T07:55:00Z',
    current: { precipitation: 0, rain: 0, showers: 0, weatherCode: 1 }
  };
  assert.equal(isFarmWeatherFresh(weather, now), true);
  assert.equal(isFarmWeatherFresh({ ...weather, retrievedAt: '2026-10-02T07:00:00Z' }, now), false);
  assert.equal(isFarmWeatherFresh({ ...weather, available: false }, now), false);
  assert.equal(isRainReported(weather.current), false);
  assert.equal(isRainReported({ weatherCode: 61, precipitation: 0 }), true);
  assert.equal(isRainReported({ precipitation: 0.3 }), true);
  assert.equal(isRainReported(null), false);
});

test('SunCalc positions progress from eastern morning through southern noon to western evening', () => {
  const location = { latitude: 17.3, longitude: 78.4 };
  const azimuth = (instant) => {
    const position = SunCalc.getPosition(instant, location.latitude, location.longitude);
    return position.azimuth;
  };
  const morning = azimuth(new Date('2026-03-20T02:00:00Z'));
  const noon = azimuth(new Date('2026-03-20T06:30:00Z'));
  const evening = azimuth(new Date('2026-03-20T12:00:00Z'));
  assert.ok(morning > 45 && morning < 135, `morning azimuth was ${morning}`);
  assert.ok(noon > 135 && noon < 225, `solar-noon azimuth was ${noon}`);
  assert.ok(evening > 225 && evening < 315, `evening azimuth was ${evening}`);
});

test('SunCalc provides below-horizon, sunrise, daytime and after-sunset altitude', () => {
  const location = { latitude: 17.3, longitude: 78.4 };
  const altitude = (instant) => SunCalc.getPosition(
    new Date(instant),
    location.latitude,
    location.longitude
  ).altitude;
  assert.ok(altitude('2026-03-19T23:30:00Z') < 0);
  assert.ok(Math.abs(altitude('2026-03-20T00:30:00Z')) < 12);
  assert.ok(altitude('2026-03-20T06:30:00Z') > 45);
  assert.ok(altitude('2026-03-20T13:00:00Z') < 0);
});

test('SunCalc moon position changes visibility with altitude and phase over time', () => {
  const location = { latitude: 17.3, longitude: 78.4 };
  const instants = Array.from({ length: 72 }, (_, index) =>
    new Date(Date.UTC(2026, 2, 20, index * 2))
  );
  const altitudes = instants.map((instant) =>
    SunCalc.getMoonPosition(instant, location.latitude, location.longitude).altitude
  );
  const phases = instants.map((instant) => SunCalc.getMoonIllumination(instant).fraction);
  assert.ok(altitudes.some((value) => value > 0));
  assert.ok(altitudes.some((value) => value < 0));
  assert.ok(Math.max(...phases) - Math.min(...phases) > 0);

  const sunset = new Date('2026-03-20T12:30:00Z');
  const sunrise = new Date('2026-03-21T00:30:00Z');
  const nightProgress = (instant) => calculateArcProgress(instant, sunset, sunrise);
  const nightStart = calculateVisualArcOffset(nightProgress(new Date('2026-03-20T13:00:00Z')), 40, 0.1, 0.23);
  const moonMidnight = calculateVisualArcOffset(nightProgress(new Date('2026-03-20T18:30:00Z')), 40, 0.1, 0.23);
  const nightEnd = calculateVisualArcOffset(nightProgress(new Date('2026-03-21T00:00:00Z')), 40, 0.1, 0.23);
  assert.ok(nightStart.x < moonMidnight.x && moonMidnight.x < nightEnd.x);
  assert.ok(moonMidnight.y > nightStart.y && moonMidnight.y > nightEnd.y);
});
