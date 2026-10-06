import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as SunCalc from 'suncalc';
import {
  Moon,
  RotateCcw,
  Sun
} from 'lucide-react';
import { useAppPreferences } from '../services/useAppPreferences';
import { useFarmTwinClock } from '../services/useFarmTwinClock';
import { translate } from '../i18n';
import {
  calculateArcProgress,
  createDeterministicOduLayout,
  createOduCropLayouts,
  calculateFarmAreaAcres,
  calculateVisualArcOffset,
  calculateFarmCameraDistance,
  createLocalFarmGeometry,
  getFarmTimeZone,
  FARM_CAMERA_POLAR_DEGREES,
  FARM_CAMERA_YAW_DEGREES,
  findInteriorFarmPoint,
  isFarmWeatherFresh,
  isRainReported,
  normalizeFarmBoundary,
  sunDirectionFromAzimuth,
  windDirectionToVector
} from './farmTwinGeometry';

const STALE_WEATHER_AFTER_MS = 30 * 60 * 1000;
const SUN_RADIUS_FACTOR = 0.06;
const MOON_RADIUS_FACTOR = 0.052;
const CROP_MODEL_SCALE = 0.55;
const ODU_PATH_WIDTH_METERS = 1.2;
const EMPTY_BOUNDARY = [];

function cropHeightScale(cropName) {
  const name = String(cropName || '').toLowerCase();
  if (name.includes('rice') || name.includes('paddy')) return 0.22;
  if (name.includes('maize') || name.includes('corn')) return 0.58;
  if (name.includes('tomato')) return 0.45;
  if (name.includes('cotton') || name.includes('chilli') || name.includes('chili')) return 0.42;
  return 0.36;
}

function getFarmLocation(farm) {
  const location = farm?.location || farm?.farmLocation;
  const latitude = Number(location?.latitude ?? location?.lat);
  const longitude = Number(location?.longitude ?? location?.lng);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function placeCameraAtFarmView(camera, distance, target) {
  const yaw = FARM_CAMERA_YAW_DEGREES * Math.PI / 180;
  const polar = FARM_CAMERA_POLAR_DEGREES * Math.PI / 180;
  camera.position.set(
    target.x + distance * Math.sin(polar) * Math.sin(yaw),
    target.y + distance * Math.cos(polar),
    target.z + distance * Math.sin(polar) * Math.cos(yaw)
  );
  camera.lookAt(target);
}

function makeCropPrototype(cropName) {
  const name = String(cropName || '').toLowerCase();
  const group = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x467c3f, roughness: 0.82 });
  const lightGreen = new THREE.MeshStandardMaterial({ color: 0x91c75d, roughness: 0.78 });

  if (name.includes('tomato')) {
    const foliage = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 1), green);
    foliage.position.y = 0.42;
    group.add(foliage);
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xc64a36, roughness: 0.48 }));
    [[0.18, 0.33, 0.15], [-0.2, 0.3, -0.12], [0.08, 0.48, -0.2]].forEach(([x, y, z]) => {
      const berry = fruit.clone();
      berry.position.set(x, y, z);
      group.add(berry);
    });
  } else if (name.includes('cotton')) {
    const foliage = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 1), green);
    foliage.position.y = 0.4;
    group.add(foliage);
    const boll = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf1eee3, roughness: 0.9 }));
    [[0.18, 0.42, 0.12], [-0.16, 0.38, -0.14], [0.03, 0.56, -0.16]].forEach(([x, y, z]) => {
      const cotton = boll.clone();
      cotton.position.set(x, y, z);
      group.add(cotton);
    });
  } else if (name.includes('rice') || name.includes('paddy')) {
    [-0.12, 0, 0.12].forEach((offset) => {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.82, 4), lightGreen);
      blade.position.set(offset, 0.4, offset * 0.6);
      group.add(blade);
    });
  } else if (name.includes('maize') || name.includes('corn')) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.05, 6), green);
    stalk.position.y = 0.52;
    group.add(stalk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.5, 4), lightGreen);
    leaves.position.set(0.12, 0.68, 0);
    leaves.rotation.z = Math.PI / 2;
    group.add(leaves);
  } else if (name.includes('chilli') || name.includes('chili')) {
    const foliage = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 1), green);
    foliage.position.y = 0.36;
    group.add(foliage);
    const fruit = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 5), new THREE.MeshStandardMaterial({ color: 0xb94332, roughness: 0.7 }));
    fruit.rotation.z = Math.PI;
    fruit.position.set(0.12, 0.22, 0.1);
    group.add(fruit);
  } else {
    const plant = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.72, 5), green);
    plant.position.y = 0.36;
    group.add(plant);
  }
  return group;
}

function addInstancedCrops(parent, parts, layout, centerX, centerZ, cropName, oduId) {
  if (!layout.length || !parts.length) return;
  const baseScale = new THREE.Vector3(CROP_MODEL_SCALE, CROP_MODEL_SCALE, CROP_MODEL_SCALE);
  const rootPosition = new THREE.Vector3();
  const rootRotation = new THREE.Quaternion();
  const rotationAxis = new THREE.Vector3(0, 1, 0);
  const rootMatrix = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, layout.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.oduId = oduId;
    const localMatrix = part.matrixWorld;
    layout.forEach((point, index) => {
      rootPosition.set(point.x - centerX, 0.035, point.z - centerZ);
      rootRotation.setFromAxisAngle(rotationAxis, point.rotation);
      const variation = point.scale || 1;
      baseScale.set(
        CROP_MODEL_SCALE * variation * (point.horizontalScale || 1),
        cropHeightScale(cropName) * variation,
        CROP_MODEL_SCALE * variation * (point.horizontalScale || 1)
      );
      rootMatrix.compose(rootPosition, rootRotation, baseScale);
      instanceMatrix.multiplyMatrices(rootMatrix, localMatrix);
      mesh.setMatrixAt(index, instanceMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
  }
  rootPosition.set(0, 0, 0);
  rootRotation.identity();
  rootMatrix.identity();
  instanceMatrix.identity();
}

function createCloudLayer(scene, geometry, centerX, centerZ, layerIndex, maxPuffs = 10) {
  const group = new THREE.Group();
  const cloudGeometry = new THREE.SphereGeometry(1, 10, 8);
  const material = new THREE.MeshStandardMaterial({
    color: 0xf2f5f4,
    transparent: true,
    opacity: 0.32,
    roughness: 1,
    depthWrite: false
  });
  const puffsPerFormation = 4;
  const formationCount = maxPuffs;
  const mesh = new THREE.InstancedMesh(cloudGeometry, material, formationCount * puffsPerFormation);
  mesh.count = 0;
  mesh.renderOrder = 2;
  const maxSpan = Math.max(geometry.width, geometry.depth, 1);
  const minX = geometry.bounds.minX - centerX;
  const maxX = geometry.bounds.maxX - centerX;
  const minZ = geometry.bounds.minZ - centerZ;
  const maxZ = geometry.bounds.maxZ - centerZ;
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  for (let formation = 0; formation < formationCount; formation++) {
    const fractionX = ((formation * 0.61803398875 + layerIndex * 0.21) % 1);
    const fractionZ = ((formation * 0.41421356237 + layerIndex * 0.37) % 1);
    const center = new THREE.Vector3(
      minX + (maxX - minX) * fractionX,
      maxSpan * (0.09 + layerIndex * 0.05 + ((formation % 3) * 0.01)),
      minZ + (maxZ - minZ) * fractionZ
    );
    for (let lobe = 0; lobe < puffsPerFormation; lobe++) {
      const angle = (lobe / puffsPerFormation) * Math.PI * 2 + formation * 0.41;
      const spread = maxSpan * (lobe === 0 ? 0 : 0.018 + (lobe % 2) * 0.009);
      position.set(
        center.x + Math.cos(angle) * spread,
        center.y + (lobe % 2) * maxSpan * 0.008,
        center.z + Math.sin(angle) * spread
      );
      scale.set(
        maxSpan * (0.05 + ((formation + lobe) % 3) * 0.012),
        maxSpan * (0.02 + ((formation + 2 * lobe) % 2) * 0.008),
        maxSpan * (0.04 + ((2 * formation + lobe) % 3) * 0.012)
      );
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(formation * puffsPerFormation + lobe, matrix);
      mesh.setColorAt(formation * puffsPerFormation + lobe,
        new THREE.Color().setHSL(0.5, 0.08, 0.88 - layerIndex * 0.025 - lobe * 0.008));
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  scene.add(group);
  return {
    group,
    mesh,
    layerIndex,
    formationCount,
    puffsPerFormation,
    halfWidth: maxSpan * 0.08
  };
}

function createGlowTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(64, 64, 16, 64, 64, 63);
  gradient.addColorStop(0, `${color}f0`);
  gradient.addColorStop(0.22, `${color}aa`);
  gradient.addColorStop(0.55, `${color}34`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCelestialSprite(texture, opacity = 1) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 20;
  return sprite;
}

function createOduSurface(parent, odu, centerX, centerZ, material) {
  const group = new THREE.Group();
  group.userData.oduId = odu.id;
  const borders = [];
  for (const fragment of odu.fragments) {
    const shape = new THREE.Shape();
    fragment.points.forEach((point, index) => {
      const x = point.x - centerX;
      const z = point.z - centerZ;
      if (index === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    });
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
    const surface = new THREE.Mesh(geometry, material);
    surface.position.y = 0.018;
    surface.userData.oduId = odu.id;
    group.add(surface);

    const borderMaterial = new THREE.LineBasicMaterial({
      color: 0x5e513b,
      transparent: true,
      opacity: 0.72
    });
    const boundary = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(fragment.points.map((point) =>
        new THREE.Vector3(point.x - centerX, 0.042, point.z - centerZ)
      )),
      borderMaterial
    );
    boundary.userData.oduId = odu.id;
    group.add(boundary);
    borders.push(borderMaterial);
  }
  parent.add(group);
  return borders;
}

function createRainSystem(scene, geometry, centerX, centerZ, mobile) {
  const count = mobile ? 140 : 360;
  const maxSpan = Math.max(geometry.width, geometry.depth, 1);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const offset = index * 3;
    positions[offset] = geometry.bounds.minX + ((index * 0.754877666) % 1) * geometry.width - centerX;
    positions[offset + 1] = ((index * 0.569840296) % 1) * Math.max(5, maxSpan * 0.55) + 1;
    positions[offset + 2] = geometry.bounds.minZ + ((index * 0.438579021) % 1) * geometry.depth - centerZ;
  }
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x9ec9e8,
    size: Math.max(0.025, maxSpan * 0.0014),
    transparent: true,
    opacity: 0.62
  });
  const particles = new THREE.Points(buffer, material);
  particles.visible = false;
  scene.add(particles);
  return { particles, count, width: Math.max(geometry.width, 1), depth: Math.max(geometry.depth, 1), height: Math.max(5, maxSpan * 0.55) };
}

function createWaterFeature(farmGroup, waterSource, point) {
  if (!waterSource || !point) return null;
  const group = new THREE.Group();
  const x = point.x;
  const z = point.z;
  const metal = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.72, metalness: 0.24 });
  const water = new THREE.MeshStandardMaterial({ color: 0x38849a, roughness: 0.35, metalness: 0.18 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6f5a3d, roughness: 0.9 });

  if (waterSource === 'Borewell') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 12), metal);
    base.position.set(x, 0.07, z);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.46, 10), water);
    pump.position.set(x, 0.34, z);
    group.add(base, pump);
  } else if (waterSource === 'Well') {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.38, 0.34, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x827d70, roughness: 0.92, side: THREE.DoubleSide })
    );
    ring.position.set(x, 0.18, z);
    const surface = new THREE.Mesh(new THREE.CircleGeometry(0.27, 14), water);
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(x, 0.16, z);
    group.add(ring, surface);
  } else if (waterSource === 'Rainwater') {
    const pond = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.66, 0.1, 18), water);
    pond.position.set(x, 0.05, z);
    const berm = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.09, 6, 18), wood);
    berm.rotation.x = Math.PI / 2;
    berm.position.set(x, 0.06, z);
    group.add(pond, berm);
  } else if (waterSource === 'Canal' || waterSource === 'River') {
    const channel = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.08, 1.7),
      water
    );
    channel.position.set(x, 0.04, z);
    group.add(channel);
  }
  farmGroup.add(group);
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return group;
}

function drawMoonPhase(canvas, phase) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const size = canvas.width;
  const radius = size * 0.45;
  const center = size / 2;
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#121c2b';
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = '#dce5e6';
  context.beginPath();
  const waxing = phase < 0.5;
  context.moveTo(center, center - radius);
  context.arc(center, center, radius, waxing ? -Math.PI / 2 : -Math.PI / 2, waxing ? Math.PI / 2 : -3 * Math.PI / 2, waxing);
  const terminatorControl = radius * Math.cos(phase * Math.PI * 2);
  context.quadraticCurveTo(center + terminatorControl, center, center, center - radius);
  context.fill();
  context.restore();
  const shading = context.createRadialGradient(center - radius * 0.3, center - radius * 0.3, 0, center, center, radius);
  shading.addColorStop(0, 'rgba(255,255,255,0.06)');
  shading.addColorStop(1, 'rgba(10,18,28,0.28)');
  context.fillStyle = shading;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();
}

function formatFarmTime(date, timeZone, language) {
  return new Intl.DateTimeFormat(language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short'
  }).format(date);
}

function normalizeSunAzimuth(azimuthDegrees) {
  return ((azimuthDegrees % 360) + 360) % 360;
}

function getDayPhase(sunAltitude, sunAzimuth, now, farmLocation, translateText) {
  const altitudeDegrees = sunAltitude;
  if (altitudeDegrees < -6) return translateText('farmTwin.night');
  if (altitudeDegrees < 0) {
    const times = SunCalc.getTimes(now, farmLocation.latitude, farmLocation.longitude);
    return now < times.sunrise
      ? translateText('farmTwin.dawn')
      : translateText('farmTwin.dusk');
  }
  if (sunAzimuth >= 165 && sunAzimuth <= 195 && altitudeDegrees > 35) {
    return translateText('farmTwin.midday');
  }
  return sunAzimuth < 180
    ? translateText('farmTwin.morning')
    : translateText('farmTwin.afternoon');
}

function disposeScene(scene) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  scene.clear();
}

export default function Farm3DModel({
  boundaryData,
  environmentState = 'NORMAL',
  farmInfo = {},
  weatherData = null,
  farmTimeZone = null,
  height = 420
}) {
  const { language } = useAppPreferences();
  const t = (key) => translate(language, key);
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animationFrameRef = useRef(null);
  const sceneElementsRef = useRef({});
  const dragStateRef = useRef(null);
  const pointerStartRef = useRef(null);
  const cameraTargetRef = useRef(new THREE.Vector3());
  const fitDistanceRef = useRef(20);
  const reducedMotionRef = useRef(false);
  const now = useFarmTwinClock();
  const [selectedOduId, setSelectedOduId] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );

  const sourceBoundary = boundaryData?.points?.length
    ? boundaryData.points
    : farmInfo?.farmBoundary || EMPTY_BOUNDARY;
  const boundaryPoints = useMemo(() => normalizeFarmBoundary(sourceBoundary), [sourceBoundary]);
  const farmGeometry = useMemo(() => createLocalFarmGeometry(boundaryPoints), [boundaryPoints]);
  const geometrySignature = useMemo(() => JSON.stringify(farmGeometry?.points || []), [farmGeometry]);
  const cropName = farmInfo?.crop || farmInfo?.cropDetails?.name || null;
  const waterSource = farmInfo?.waterSource || farmInfo?.water?.source || farmInfo?.water?.otherSource || null;
  const savedAreaAcres = Number(
    boundaryData?.areaAcres ??
    boundaryData?.area?.acres ??
    farmInfo?.boundary?.areaAcres ??
    farmInfo?.area?.acres
  );
  const farmAreaAcres = Number.isFinite(savedAreaAcres) && savedAreaAcres > 0
    ? savedAreaAcres
    : calculateFarmAreaAcres(farmGeometry);
  const farmLocation = useMemo(() => getFarmLocation(farmInfo), [
    farmInfo
  ]);
  const centerX = farmGeometry ? (farmGeometry.bounds.minX + farmGeometry.bounds.maxX) / 2 : 0;
  const centerZ = farmGeometry ? (farmGeometry.bounds.minZ + farmGeometry.bounds.maxZ) / 2 : 0;
  const oduLayout = useMemo(() => farmGeometry
    ? createDeterministicOduLayout(farmGeometry.points, farmAreaAcres)
    : [], [farmGeometry, farmAreaAcres]);
  const oduCropLayouts = useMemo(() => createOduCropLayouts(oduLayout, cropName, {
    maxPlants: isMobile ? 1600 : 8000,
    boundaryMarginMeters: ODU_PATH_WIDTH_METERS / 2
  }), [oduLayout, cropName, isMobile]);
  const cropLayout = useMemo(() => oduCropLayouts.flatMap((odu) => odu.cropLayout), [oduCropLayouts]);

  const weatherAvailable = isFarmWeatherFresh(weatherData, now, STALE_WEATHER_AFTER_MS);
  const timezone = getFarmTimeZone({
    ...farmInfo,
    timezone: farmInfo.timezone || farmTimeZone
  }, weatherData);

  const solarTimes = useMemo(() => farmLocation
    ? SunCalc.getTimes(now, farmLocation.latitude, farmLocation.longitude)
    : null, [now, farmLocation]);
  const sunPosition = useMemo(() => farmLocation
    ? SunCalc.getPosition(now, farmLocation.latitude, farmLocation.longitude)
    : null, [now, farmLocation]);
  const solarArcProgress = solarTimes
    ? calculateArcProgress(now, solarTimes.sunrise, solarTimes.sunset)
    : null;
  const solarAltitude = sunPosition?.altitude ?? null;
  const sunAzimuth = sunPosition ? normalizeSunAzimuth(sunPosition.azimuth) : null;
  const moonPosition = useMemo(() => farmLocation
    ? SunCalc.getMoonPosition(now, farmLocation.latitude, farmLocation.longitude)
    : null, [now, farmLocation]);
  const nightStart = solarTimes && (now >= solarTimes.sunset
    ? solarTimes.sunset
    : new Date(solarTimes.sunset.getTime() - 24 * 60 * 60 * 1000));
  const nightEnd = solarTimes && (now < solarTimes.sunrise
    ? solarTimes.sunrise
    : new Date(solarTimes.sunrise.getTime() + 24 * 60 * 60 * 1000));
  const lunarArcProgress = nightStart && nightEnd
    ? calculateArcProgress(now, nightStart, nightEnd)
    : null;
  const moonIllumination = useMemo(() => SunCalc.getMoonIllumination(now), [now]);
  const moonPhaseRef = useRef(moonIllumination.phase);
  useEffect(() => {
    moonPhaseRef.current = moonIllumination.phase;
  }, [moonIllumination.phase]);

  useEffect(() => {
    const elements = sceneElementsRef.current;
    const weather = weatherAvailable ? weatherData?.current : null;
    elements.cloudDirection = weather ? windDirectionToVector(weather.windDirection) : null;
    elements.cloudSpeed = Number.isFinite(weather?.windSpeed) ? weather.windSpeed : 0;
  }, [weatherAvailable, weatherData]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = query.matches;
      setReducedMotion(query.matches);
    };
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return undefined;

    const mobile = isMobile || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
    const width = Math.max(container.clientWidth, 1);
    const currentHeight = height || 420;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x142238);
    const camera = new THREE.PerspectiveCamera(40, width / currentHeight, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({
      antialias: !mobile,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, currentHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D view of the saved farm boundary');
    renderer.domElement.setAttribute('role', 'img');
    container.replaceChildren(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xdce8eb, 0x564d3e, 0.58);
    scene.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xfff1c2, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024);
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);
    scene.add(sunLight.target);
    const moonLight = new THREE.DirectionalLight(0xd5e2f4, 0);
    scene.add(moonLight);
    scene.add(moonLight.target);

    const elements = {
      ambient,
      sunLight,
      moonLight,
      sunMesh: null,
      moonMesh: null,
      moonTexture: null,
      moonCanvas: null,
      sunGlow: null,
      moonGlow: null,
      soilMaterial: null,
      rain: null,
      clouds: [],
      farmGroup: null,
      oduSurfaces: [],
      mobile
    };

    if (farmGeometry) {
      const maxSpan = Math.max(farmGeometry.width, farmGeometry.depth, 1);
      const shape = new THREE.Shape();
      const centeredPoints = farmGeometry.points.map(({ x, z }) => ({
        x: x - centerX,
        z: z - centerZ
      }));
      centeredPoints.forEach((point, index) => {
        if (index === 0) shape.moveTo(point.x, point.z);
        else shape.lineTo(point.x, point.z);
      });
      shape.closePath();

      const farmGroup = new THREE.Group();
      elements.farmGroup = farmGroup;
      const terrainGeometry = new THREE.ShapeGeometry(shape);
      terrainGeometry.rotateX(Math.PI / 2);
      const soilMaterial = new THREE.MeshStandardMaterial({
        color: 0x806b4f,
        roughness: 0.88,
        metalness: 0,
        side: THREE.DoubleSide
      });
      elements.soilMaterial = soilMaterial;
      const terrain = new THREE.Mesh(terrainGeometry, soilMaterial);
      terrain.receiveShadow = true;
      farmGroup.add(terrain);

      const outlinePoints = centeredPoints.map(({ x, z }) => new THREE.Vector3(x, 0.025, z));
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
      const outline = new THREE.LineLoop(
        outlineGeometry,
        new THREE.LineBasicMaterial({ color: 0x72ba8e, transparent: true, opacity: 0.9 })
      );
      farmGroup.add(outline);

      const markerGeometry = new THREE.SphereGeometry(Math.max(0.035, maxSpan * 0.003), 10, 8);
      const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xe3c681, roughness: 0.55 });
      centeredPoints.forEach(({ x, z }) => {
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.set(x, 0.055, z);
        marker.castShadow = true;
        farmGroup.add(marker);
      });

      const cropPrototype = cropName ? makeCropPrototype(cropName) : null;
      cropPrototype?.updateMatrixWorld(true);
      const cropParts = [];
      cropPrototype?.traverse((child) => {
        if (child.isMesh) cropParts.push(child);
      });
      const waterAnchor = waterSource
        ? (cropLayout[Math.floor(cropLayout.length / 2)] || findInteriorFarmPoint(farmGeometry.points))
        : null;
      for (const odu of oduCropLayouts) {
        const color = new THREE.Color().setHSL(0.105, 0.2, 0.42 + (odu.id % 3) * 0.018);
        const material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.96,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        const borders = createOduSurface(farmGroup, odu, centerX, centerZ, material);
        elements.oduSurfaces.push({
          id: odu.id,
          material,
          baseColor: color.clone(),
          baseOpacity: material.opacity,
          borders
        });
        const oduGroup = new THREE.Group();
        oduGroup.userData.oduId = odu.id;
        farmGroup.add(oduGroup);
        const cropPositions = waterAnchor
          ? odu.cropLayout.filter(({ x, z }) => Math.hypot(x - waterAnchor.x, z - waterAnchor.z) > 1.2)
          : odu.cropLayout;
        addInstancedCrops(oduGroup, cropParts, cropPositions, centerX, centerZ, cropName, odu.id);
      }
      cropPrototype?.clear();

      if (waterAnchor) {
        createWaterFeature(farmGroup, waterSource, {
          x: waterAnchor.x - centerX,
          z: waterAnchor.z - centerZ
        });
      }
      scene.add(farmGroup);

      const aspect = width / currentHeight;
      const fitDistance = calculateFarmCameraDistance(
        farmGeometry.width,
        farmGeometry.depth,
        camera.fov,
        aspect,
        1
      ) || 1;
      fitDistanceRef.current = Math.max(fitDistance, 1);
      cameraTargetRef.current.set(0, 0, 0);
      placeCameraAtFarmView(camera, fitDistance, cameraTargetRef.current);
      camera.userData.fitDistance = camera.position.distanceTo(cameraTargetRef.current);
      camera.far = Math.max(100, camera.userData.fitDistance * 12);
      camera.updateProjectionMatrix();

      sunLight.shadow.camera.left = -farmGeometry.width * 0.65;
      sunLight.shadow.camera.right = farmGeometry.width * 0.65;
      sunLight.shadow.camera.top = farmGeometry.depth * 0.65;
      sunLight.shadow.camera.bottom = -farmGeometry.depth * 0.65;
      sunLight.shadow.camera.far = Math.max(30, fitDistance * 3);
      sunLight.shadow.camera.updateProjectionMatrix();

      const sunTexture = createGlowTexture('#fff0b0');
      const sunGlowTexture = createGlowTexture('#ffd36a');
      const sunMesh = createCelestialSprite(sunTexture);
      const sunGlow = createCelestialSprite(sunGlowTexture, 0.7);
      elements.sunMesh = sunMesh;
      elements.sunGlow = sunGlow;
      scene.add(sunGlow);
      scene.add(sunMesh);
      const moonCanvas = document.createElement('canvas');
      moonCanvas.width = 128;
      moonCanvas.height = 128;
      drawMoonPhase(moonCanvas, moonPhaseRef.current);
      const moonTexture = new THREE.CanvasTexture(moonCanvas);
      moonTexture.colorSpace = THREE.SRGBColorSpace;
      const moonMesh = createCelestialSprite(moonTexture);
      const moonGlowTexture = createGlowTexture('#a9c4e8');
      const moonGlow = createCelestialSprite(moonGlowTexture, 0.58);
      elements.moonCanvas = moonCanvas;
      elements.moonTexture = moonTexture;
      elements.moonMesh = moonMesh;
      elements.moonGlow = moonGlow;
      scene.add(moonGlow);
      scene.add(moonMesh);

      const cloudLayers = [0, 1, 2].map((layer) =>
        createCloudLayer(scene, farmGeometry, centerX, centerZ, layer, mobile ? 3 : 5)
      );
      elements.clouds = cloudLayers;
      elements.rain = createRainSystem(scene, farmGeometry, centerX, centerZ, mobile);
    }

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    sceneElementsRef.current = elements;

    let previousFrameTime = 0;
    let cloudDrift = { x: 0, z: 0 };
    const animate = (timestamp) => {
      animationFrameRef.current = requestAnimationFrame(animate);
      const delta = previousFrameTime ? Math.min((timestamp - previousFrameTime) / 1000, 0.05) : 0;
      previousFrameTime = timestamp;
      const direction = elements.cloudDirection;
      if (direction && elements.cloudSpeed > 0 && !reducedMotionRef.current) {
        const speed = Math.min(0.018, elements.cloudSpeed * 0.0007);
        cloudDrift.x += direction.x * speed * delta;
        cloudDrift.z += direction.z * speed * delta;
        const wrapX = farmGeometry?.width || 1;
        const wrapZ = farmGeometry?.depth || 1;
        for (let index = 0; index < elements.clouds.length; index++) {
          const { group, halfWidth } = elements.clouds[index];
          group.position.x = cloudDrift.x;
          group.position.z = cloudDrift.z;
          if (Math.abs(group.position.x) > wrapX + halfWidth) cloudDrift.x = -Math.sign(group.position.x) * halfWidth;
          if (Math.abs(group.position.z) > wrapZ + halfWidth) cloudDrift.z = -Math.sign(group.position.z) * halfWidth;
        }
      }
      if (elements.rain?.particles.visible && !reducedMotionRef.current) {
        const positionAttribute = elements.rain.particles.geometry.attributes.position;
        const positions = positionAttribute.array;
        for (let index = 1; index < positions.length; index += 3) {
          positions[index] -= 8 * delta;
          if (positions[index] < 0) positions[index] = elements.rain.height;
        }
        positionAttribute.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };
    animationFrameRef.current = requestAnimationFrame(animate);

    const observer = new ResizeObserver(() => {
      const nextWidth = Math.max(container.clientWidth, 1);
      camera.aspect = nextWidth / currentHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, currentHeight);
      if (farmGeometry) {
        const aspect = nextWidth / currentHeight;
        const distance = calculateFarmCameraDistance(
          farmGeometry.width,
          farmGeometry.depth,
          camera.fov,
          aspect,
          1
        ) || fitDistanceRef.current;
        fitDistanceRef.current = Math.max(distance, 1);
        if (!camera.userData.hasUserMoved) {
          placeCameraAtFarmView(camera, distance, cameraTargetRef.current);
        }
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      disposeScene(scene);
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      sceneElementsRef.current = {};
    };
  }, [
    geometrySignature,
    farmGeometry,
    centerX,
    centerZ,
    cropLayout,
    cropName,
    waterSource,
    height,
    isMobile,
    oduCropLayouts
  ]);

  useEffect(() => {
    const {
      ambient,
      sunLight,
      moonLight,
      sunMesh,
      sunGlow,
      moonMesh,
      moonGlow,
      moonCanvas,
      moonTexture,
      soilMaterial,
      clouds,
      rain
    } = sceneElementsRef.current;
    const scene = sceneRef.current;
    if (!scene || !ambient || !sunLight || !moonLight) return;

    const current = weatherAvailable ? weatherData.current : null;
    const cloudCover = Number.isFinite(current?.cloudCover)
      ? Math.max(0, Math.min(100, current.cloudCover))
      : null;
    const cloudAttenuation = cloudCover === null ? 0 : cloudCover / 100;
    const altitudeDegrees = sunPosition?.altitude ?? -90;
    const dayStrength = altitudeDegrees <= -6
      ? 0
      : altitudeDegrees >= 8
        ? 1
        : Math.max(0.04, (altitudeDegrees + 6) / 14);
    const solarRadiation = Number.isFinite(current?.solarRadiation)
      ? Math.max(0.72, Math.min(1.08, 0.72 + current.solarRadiation / 2400))
      : 1;
    const sunIntensity = dayStrength * (1 - cloudAttenuation * 0.66) * solarRadiation;
    ambient.intensity = altitudeDegrees < -6
      ? 0.55
      : Math.max(0.28, Math.min(0.82, 0.32 + dayStrength * 0.46 - cloudAttenuation * 0.12));
    ambient.color.set(altitudeDegrees < -6 ? 0xa3b7d3 : 0xe5ecea);
    sunLight.intensity = sunIntensity * 1.45;
    sunLight.visible = Boolean(farmLocation && altitudeDegrees > -6);

    const sceneDayColor = new THREE.Color(0x9bb9c4);
    const sceneTwilightColor = new THREE.Color(0x786a77);
    const sceneNightColor = new THREE.Color(0x10192a);
    const sky = altitudeDegrees <= -6
      ? sceneNightColor
      : sceneTwilightColor.clone().lerp(sceneDayColor, Math.max(0, Math.min(1, (altitudeDegrees + 6) / 14)));
    if (cloudCover !== null) sky.lerp(new THREE.Color(0x697984), cloudAttenuation * 0.36);
    scene.background.copy(sky);

    if (farmLocation && sunPosition && sunMesh) {
      const azimuthDegrees = normalizeSunAzimuth(sunPosition.azimuth);
      const scale = Math.max(farmGeometry?.width || 1, farmGeometry?.depth || 1, 1);
      const distance = scale * 2.2;
      const direction = sunDirectionFromAzimuth(azimuthDegrees, altitudeDegrees, distance);
      sunLight.position.set(direction.x, direction.y, direction.z);
      sunLight.target.position.set(0, 0, 0);
      sunLight.target.updateMatrixWorld();
      sunMesh.visible = altitudeDegrees > 0 && solarArcProgress !== null;
      if (sunMesh.visible) {
        const camera = cameraRef.current;
        camera?.updateMatrixWorld();
        const right = camera
          ? new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
          : new THREE.Vector3(1, 0, 0);
        const up = camera
          ? new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize()
          : new THREE.Vector3(0, 1, 0);
        const arc = calculateVisualArcOffset(solarArcProgress, scale, 0.1, 0.28);
        sunMesh.position.set(0, 0.1, 0).addScaledVector(right, arc.x).addScaledVector(up, arc.y);
        sunMesh.scale.setScalar(scale * SUN_RADIUS_FACTOR);
        if (sunGlow) {
          sunGlow.position.copy(sunMesh.position);
          sunGlow.scale.setScalar(scale * 0.22);
          sunGlow.visible = true;
        }
      } else if (sunGlow) {
        sunGlow.visible = false;
      }
    } else if (sunMesh) {
      sunMesh.visible = false;
      if (sunGlow) sunGlow.visible = false;
      sunLight.intensity = 0;
    }

    const moonAltitudeDegrees = moonPosition?.altitude ?? -90;
    const moonVisible = Boolean(
      farmLocation && sunPosition?.altitude <= -0.5 &&
      moonPosition && moonAltitudeDegrees > 0 && moonMesh
    );
    moonLight.intensity = moonVisible ? Math.max(0.045, moonIllumination.fraction * 0.2) : 0;
    moonLight.visible = moonVisible;
    if (moonVisible) {
      const moonAzimuth = normalizeSunAzimuth(moonPosition.azimuth);
      const scale = Math.max(farmGeometry?.width || 1, farmGeometry?.depth || 1, 1);
      const direction = sunDirectionFromAzimuth(moonAzimuth, moonAltitudeDegrees, scale * 1.9);
      moonLight.position.set(direction.x, direction.y, direction.z);
      moonLight.target.position.set(0, 0, 0);
      moonLight.target.updateMatrixWorld();
      const camera = cameraRef.current;
      camera?.updateMatrixWorld();
      const right = camera
        ? new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
        : new THREE.Vector3(1, 0, 0);
      const up = camera
        ? new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize()
        : new THREE.Vector3(0, 1, 0);
      const progress = lunarArcProgress ?? 0.5;
      const arc = calculateVisualArcOffset(progress, scale, 0.1, 0.23);
      moonMesh.position.set(0, 0.1, 0).addScaledVector(right, arc.x).addScaledVector(up, arc.y);
      moonMesh.scale.setScalar(scale * MOON_RADIUS_FACTOR);
      moonMesh.visible = true;
      if (moonGlow) {
        moonGlow.position.copy(moonMesh.position);
        moonGlow.scale.setScalar(scale * 0.19);
        moonGlow.visible = true;
      }
      if (moonCanvas && moonTexture) {
        drawMoonPhase(moonCanvas, moonPhaseRef.current);
        moonTexture.needsUpdate = true;
      }
    } else if (moonMesh) {
      moonMesh.visible = false;
      if (moonGlow) moonGlow.visible = false;
    }

    if (soilMaterial) {
      const precipitation = current
        ? Math.max(Number(current.precipitation) || 0, Number(current.rain) || 0, Number(current.showers) || 0)
        : 0;
      soilMaterial.color.set(weatherAvailable && environmentState === 'HIGH_HEAT' ? 0x766044 : 0x806b4f);
      soilMaterial.roughness = precipitation > 0.1 || isRainReported(current)
        ? 0.62
        : 0.88;
    }

    clouds.forEach(({ mesh, formationCount, puffsPerFormation, layerIndex }) => {
      const layerCloudCover = current
        ? [current.cloudCoverLow, current.cloudCoverMid, current.cloudCoverHigh][layerIndex]
        : null;
      const hasLayerCoverage = Number.isFinite(layerCloudCover);
      const fallbackTotal = layerIndex === 1 ? current?.cloudCover : null;
      const cover = hasLayerCoverage ? layerCloudCover : fallbackTotal;
      const density = Number.isFinite(cover) ? Math.max(0, Math.min(100, cover)) / 100 : 0;
      const visibleFormations = Math.ceil(density * formationCount);
      mesh.count = visibleFormations * puffsPerFormation;
      mesh.visible = weatherAvailable && mesh.count > 0;
      mesh.material.color.set(isRainReported(current)
        ? 0x77828a
        : altitudeDegrees < -6
          ? 0x75849a
          : 0xffffff);
      mesh.material.opacity = isRainReported(current)
        ? 0.5
        : 0.34 + density * 0.2;
    });
    if (rain) {
      const precipitation = current
        ? Math.max(Number(current.precipitation) || 0, Number(current.rain) || 0, Number(current.showers) || 0)
        : 0;
      rain.particles.visible = Boolean(current && (precipitation > 0.1 || isRainReported(current)));
    }
  }, [
    weatherAvailable,
    weatherData,
    environmentState,
    farmLocation,
    farmGeometry,
    sunPosition,
    moonPosition,
    moonIllumination,
    solarArcProgress,
    lunarArcProgress
  ]);

  useEffect(() => {
    sceneElementsRef.current.oduSurfaces.forEach((surface) => {
      const selected = surface.id === selectedOduId;
      surface.material.color.copy(selected
        ? surface.baseColor.clone().lerp(new THREE.Color(0xffffff), 0.38)
        : surface.baseColor);
      surface.material.opacity = selected ? 0.48 : surface.baseOpacity;
      surface.material.needsUpdate = true;
      surface.borders.forEach((material) => {
        material.color.set(selected ? 0xb89a5c : 0x5e513b);
        material.opacity = selected ? 0.95 : 0.72;
        material.needsUpdate = true;
      });
    });
  }, [selectedOduId]);

  const selectOduAt = (clientX, clientY) => {
    const canvas = mountRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!canvas || !camera || !scene) return;
    const bounds = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(scene.children, true)
      .find((intersection) => Number.isInteger(intersection.object.userData.oduId));
    setSelectedOduId(hit ? hit.object.userData.oduId : null);
  };

  const updateOrbitCamera = (deltaX, deltaY) => {
    const camera = cameraRef.current;
    if (!camera) return;
    const target = cameraTargetRef.current;
    const offset = camera.position.clone().sub(target);
    const radius = offset.length();
    let yaw = Math.atan2(offset.x, offset.z);
    let polar = Math.acos(Math.max(-1, Math.min(1, offset.y / radius)));
    yaw -= deltaX * 0.006;
    polar = Math.max(0.24, Math.min(1.42, polar + deltaY * 0.006));
    camera.position.set(
      target.x + radius * Math.sin(polar) * Math.sin(yaw),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.cos(yaw)
    );
    camera.lookAt(target);
    camera.userData.hasUserMoved = true;
  };

  const panCamera = (deltaX, deltaY) => {
    const camera = cameraRef.current;
    const canvas = mountRef.current;
    if (!camera || !canvas) return;
    const unitsPerPixel = camera.position.distanceTo(cameraTargetRef.current) / Math.max(canvas.clientHeight, 1);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const shiftX = right.multiplyScalar(-deltaX * unitsPerPixel);
    const shiftY = up.multiplyScalar(deltaY * unitsPerPixel);
    shiftX.y = 0;
    shiftY.y = 0;
    camera.position.add(shiftX).add(shiftY);
    cameraTargetRef.current.add(shiftX).add(shiftY);
    camera.lookAt(cameraTargetRef.current);
    camera.userData.hasUserMoved = true;
  };

  const handleMouseDown = (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    dragStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pan: event.button === 2 || event.shiftKey
    };
    pointerStartRef.current = dragStateRef.current;
    if (cameraRef.current) cameraRef.current.userData.hasUserMoved = true;
  };

  const handleMouseMove = (event) => {
    const previous = dragStateRef.current;
    if (!previous) return;
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    if (previous.pan) panCamera(deltaX, deltaY);
    else updateOrbitCamera(deltaX, deltaY);
    dragStateRef.current = { ...previous, x: event.clientX, y: event.clientY };
  };

  const handleCanvasMouseUp = (event) => {
    const start = pointerStartRef.current;
    if (start && !start.pan && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < 5) {
      selectOduAt(event.clientX, event.clientY);
    }
    pointerStartRef.current = null;
  };

  const handleResetCamera = () => {
    const camera = cameraRef.current;
    if (!camera) return;
    cameraTargetRef.current.set(0, 0, 0);
    const distance = fitDistanceRef.current;
    placeCameraAtFarmView(camera, distance, cameraTargetRef.current);
    camera.userData.hasUserMoved = false;
    setSelectedOduId(null);
  };

  useEffect(() => {
    const canvas = mountRef.current;
    if (!canvas) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      const camera = cameraRef.current;
      if (!camera) return;
      const target = cameraTargetRef.current;
      const offset = camera.position.clone().sub(target);
      const distance = offset.length() * (event.deltaY > 0 ? 1.08 : 0.92);
      offset.setLength(Math.max(fitDistanceRef.current * 0.28, Math.min(fitDistanceRef.current * 4, distance)));
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
      camera.userData.hasUserMoved = true;
    };
    const stopDragging = () => {
      window.setTimeout(() => {
        dragStateRef.current = null;
        pointerStartRef.current = null;
      }, 0);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('pointerup', stopDragging);
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      window.removeEventListener('pointerup', stopDragging);
    };
  }, []);

  const phaseLabel = farmLocation && sunPosition
    ? getDayPhase(sunPosition.altitude, sunAzimuth, now, farmLocation, t)
    : t('farmTwin.locationUnavailable');
  const farmClock = formatFarmTime(now, timezone, language);
  const currentEnvironmentState = weatherAvailable ? environmentState : 'NORMAL';
  const selectedOdu = oduLayout.find((odu) => odu.id === selectedOduId) || null;

  return (
    <div className={`farm-3d-model-wrapper state-${String(currentEnvironmentState).toLowerCase()}`}>
      <div
        ref={mountRef}
        className="farm-3d-canvas"
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { dragStateRef.current = null; }}
        onTouchStart={(event) => {
          if (event.touches.length === 1) {
            dragStateRef.current = {
              x: event.touches[0].clientX,
              y: event.touches[0].clientY,
              startX: event.touches[0].clientX,
              startY: event.touches[0].clientY,
              pan: false
            };
            pointerStartRef.current = dragStateRef.current;
          }
        }}
        onTouchMove={(event) => {
          if (!dragStateRef.current || event.touches.length !== 1) return;
          const touch = event.touches[0];
          const deltaX = touch.clientX - dragStateRef.current.x;
          const deltaY = touch.clientY - dragStateRef.current.y;
          updateOrbitCamera(deltaX, deltaY);
          dragStateRef.current = { ...dragStateRef.current, x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          const previous = pointerStartRef.current;
          const touch = event.changedTouches[0];
          if (previous && touch &&
              Math.hypot(touch.clientX - previous.startX, touch.clientY - previous.startY) < 8) {
            selectOduAt(touch.clientX, touch.clientY);
          }
          dragStateRef.current = null;
          pointerStartRef.current = null;
        }}
        onMouseUp={handleCanvasMouseUp}
        style={{ height }}
      />

      <div className="farm-3d-hud-overlay">
        <div className="farm-twin-status-row">
          <div className="farm-twin-time-phase" aria-live="polite">
            {sunPosition && solarAltitude >= 0 ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            <span>{phaseLabel}</span>
            <time dateTime={now.toISOString()}>{farmClock}</time>
          </div>
          <button
            type="button"
            className="hud-action-btn"
            onClick={handleResetCamera}
            title={t('dashboard.resetView')}
            aria-label={t('dashboard.resetView')}
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span>{t('dashboard.resetView')}</span>
          </button>
        </div>
        {selectedOdu && (
          <div className="farm-twin-selected-odu" aria-live="polite">
            <strong>{t('farmTwin.odu')} {selectedOdu.id}</strong>
            <span>{t('farmTwin.area')}: {selectedOdu.areaAcres.toFixed(2)} acres</span>
          </div>
        )}
      </div>
      {reducedMotion && <span className="farm-twin-sr-only">{t('farmTwin.reducedMotion')}</span>}
      {!farmGeometry && <span className="farm-twin-boundary-alert" role="status">{t('farmTwin.geometryUnavailable')}</span>}
    </div>
  );
}
