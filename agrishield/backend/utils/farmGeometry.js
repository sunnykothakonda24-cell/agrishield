const EARTH_RADIUS_METERS = 6371008.8;
const DEGREES_TO_RADIANS = Math.PI / 180;

function normalizeFarmBoundary(boundary) {
  if (!Array.isArray(boundary)) {
    throw new Error('Farm boundary must be an array of coordinate points.');
  }

  const points = boundary.map((point) => {
    const lat = Array.isArray(point) ? Number(point[0]) : Number(point?.lat ?? point?.latitude);
    const lng = Array.isArray(point) ? Number(point[1]) : Number(point?.lng ?? point?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Farm boundary contains invalid coordinates.');
    }
    return { lat, lng };
  });

  if (points.length > 1 && points[0].lat === points[points.length - 1].lat &&
      points[0].lng === points[points.length - 1].lng) {
    points.pop();
  }

  const uniquePoints = new Set();
  for (const point of points) {
    const key = `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
    if (uniquePoints.has(key)) {
      throw new Error('Farm boundary must not contain duplicate points.');
    }
    uniquePoints.add(key);
  }

  if (points.length < 3 || uniquePoints.size < 3) {
    throw new Error('Farm boundary must contain at least 3 distinct points.');
  }

  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        throw new Error('Farm boundary lines must not cross.');
      }
    }
  }

  let signedArea = 0;
  let perimeterMeters = 0;
  const latitudes = points.map((point) => point.lat);
  const longitudes = points.map((point) => point.lng);

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const latitude = point.lat * DEGREES_TO_RADIANS;
    const nextLatitude = next.lat * DEGREES_TO_RADIANS;
    const longitudeDelta = shortestLongitudeDelta(point.lng, next.lng) * DEGREES_TO_RADIANS;
    signedArea += longitudeDelta * (2 + Math.sin(latitude) + Math.sin(nextLatitude));

    const latitudeDelta = nextLatitude - latitude;
    const halfLatitude = Math.sin(latitudeDelta / 2);
    const halfLongitude = Math.sin(longitudeDelta / 2);
    const haversine = halfLatitude ** 2 +
      Math.cos(latitude) * Math.cos(nextLatitude) * halfLongitude ** 2;
    perimeterMeters += 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
  });

  const areaSqMeters = Math.abs(signedArea) * EARTH_RADIUS_METERS ** 2 / 2;
  if (!Number.isFinite(areaSqMeters) || areaSqMeters < 1 ||
      !Number.isFinite(perimeterMeters) || perimeterMeters <= 0) {
    throw new Error('Farm boundary does not enclose a valid area.');
  }

  const middleLatitude = ((Math.min(...latitudes) + Math.max(...latitudes)) / 2) * DEGREES_TO_RADIANS;
  const lengthMeters = (Math.max(...latitudes) - Math.min(...latitudes)) *
    DEGREES_TO_RADIANS * EARTH_RADIUS_METERS;
  const widthMeters = (Math.max(...longitudes) - Math.min(...longitudes)) *
    DEGREES_TO_RADIANS * EARTH_RADIUS_METERS * Math.cos(middleLatitude);

  return {
    points,
    areaSqMeters,
    perimeterMeters,
    lengthMeters,
    widthMeters
  };
}

function shortestLongitudeDelta(first, second) {
  let delta = second - first;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (first, second, third) =>
    (second.lng - first.lng) * (third.lat - first.lat) -
    (second.lat - first.lat) * (third.lng - first.lng);
  const onSegment = (first, second, point) =>
    point.lng >= Math.min(first.lng, second.lng) &&
    point.lng <= Math.max(first.lng, second.lng) &&
    point.lat >= Math.min(first.lat, second.lat) &&
    point.lat <= Math.max(first.lat, second.lat);

  const firstOrientation = orientation(a, b, c);
  const secondOrientation = orientation(a, b, d);
  const thirdOrientation = orientation(c, d, a);
  const fourthOrientation = orientation(c, d, b);

  if (firstOrientation === 0 && onSegment(a, b, c)) return true;
  if (secondOrientation === 0 && onSegment(a, b, d)) return true;
  if (thirdOrientation === 0 && onSegment(c, d, a)) return true;
  if (fourthOrientation === 0 && onSegment(c, d, b)) return true;
  return (firstOrientation > 0) !== (secondOrientation > 0) &&
    (thirdOrientation > 0) !== (fourthOrientation > 0);
}

module.exports = { normalizeFarmBoundary };
