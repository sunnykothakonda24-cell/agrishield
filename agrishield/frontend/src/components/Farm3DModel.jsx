import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { 
  Rotate3d, 
  RotateCcw,
  Sun,
  CloudRain,
  Droplet,
  Layers,
  Sparkles,
  Compass
} from 'lucide-react';
import { useAppPreferences } from '../services/useAppPreferences';
import { translate } from '../i18n';

/**
 * Creates dynamic crop 3D mesh based on farmer's crop selection.
 * Supports Tomato, Cotton, Paddy/Rice, Maize/Corn, Chilli, or healthy generic rows.
 */
function createCropPlant(cropName) {
  const group = new THREE.Group();
  const cName = (cropName || '').toLowerCase();

  if (cName.includes('tomato')) {
    // Tomato bush with glossy red tomatoes
    const foliageGeom = new THREE.DodecahedronGeometry(0.36, 1);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.6 });
    const foliage = new THREE.Mesh(foliageGeom, foliageMat);
    foliage.position.y = 0.38;
    foliage.castShadow = true;
    group.add(foliage);

    const tomatoGeom = new THREE.SphereGeometry(0.08, 8, 8);
    const tomatoMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 });
    const fruitPositions = [
      [0.2, 0.36, 0.15],
      [-0.18, 0.3, 0.18],
      [0.08, 0.44, -0.2],
      [-0.14, 0.24, -0.16]
    ];
    fruitPositions.forEach(([tx, ty, tz]) => {
      const t = new THREE.Mesh(tomatoGeom, tomatoMat);
      t.position.set(tx, ty, tz);
      group.add(t);
    });
  } else if (cName.includes('cotton')) {
    // Cotton shrub with white bolls
    const foliageGeom = new THREE.DodecahedronGeometry(0.35, 1);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 });
    const foliage = new THREE.Mesh(foliageGeom, foliageMat);
    foliage.position.y = 0.35;
    foliage.castShadow = true;
    group.add(foliage);

    const bollGeom = new THREE.SphereGeometry(0.09, 8, 8);
    const bollMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9 });
    const bollPositions = [
      [0.18, 0.38, 0.1],
      [-0.15, 0.32, -0.15],
      [0.05, 0.45, -0.12]
    ];
    bollPositions.forEach(([bx, by, bz]) => {
      const b = new THREE.Mesh(bollGeom, bollMat);
      b.position.set(bx, by, bz);
      group.add(b);
    });
  } else if (cName.includes('paddy') || cName.includes('rice')) {
    // Clustered slender paddy tufts
    const tuftGroup = new THREE.Group();
    const bladeGeom = new THREE.ConeGeometry(0.24, 0.68, 4);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x84cc16, roughness: 0.5 });
    const blade = new THREE.Mesh(bladeGeom, bladeMat);
    blade.position.y = 0.34;
    tuftGroup.add(blade);
    group.add(tuftGroup);
  } else if (cName.includes('maize') || cName.includes('corn')) {
    // Maize stalk with golden tassel
    const stalkGeom = new THREE.CylinderGeometry(0.05, 0.07, 0.95, 6);
    const stalkMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.6 });
    const stalk = new THREE.Mesh(stalkGeom, stalkMat);
    stalk.position.y = 0.48;
    stalk.castShadow = true;
    group.add(stalk);

    const tasselGeom = new THREE.ConeGeometry(0.12, 0.25, 4);
    const tasselMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
    const tassel = new THREE.Mesh(tasselGeom, tasselMat);
    tassel.position.y = 0.98;
    group.add(tassel);
  } else if (cName.includes('chilli') || cName.includes('chili')) {
    // Chilli bush with small peppers
    const foliageGeom = new THREE.DodecahedronGeometry(0.32, 1);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.6 });
    const foliage = new THREE.Mesh(foliageGeom, foliageMat);
    foliage.position.y = 0.32;
    group.add(foliage);

    const pepperGeom = new THREE.ConeGeometry(0.04, 0.16, 4);
    const pepperMat = new THREE.MeshStandardMaterial({ color: 0xdc2626 });
    const p1 = new THREE.Mesh(pepperGeom, pepperMat);
    p1.rotation.z = Math.PI;
    p1.position.set(0.12, 0.22, 0.1);
    group.add(p1);
  } else {
    // Generic agricultural vegetation rows
    const plantGeom = new THREE.ConeGeometry(0.32, 0.75, 5);
    const plantMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.6 });
    const plant = new THREE.Mesh(plantGeom, plantMat);
    plant.position.y = 0.38;
    plant.castShadow = true;
    group.add(plant);
  }

  return group;
}

export default function Farm3DModel({ 
  boundaryData, 
  environmentState = 'NORMAL',
  farmInfo = {},
  height = 420
}) {
  const { language } = useAppPreferences();
  const t = (key) => translate(language, key);
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animFrameIdRef = useRef(null);

  // Dynamic references
  const sunMeshRef = useRef(null);
  const sunLightRef = useRef(null);
  const ambientLightRef = useRef(null);
  const groundMeshRef = useRef(null);
  const rainSystemRef = useRef(null);
  const heatRaysGroupRef = useRef(null);
  const waterFeatureRef = useRef(null);

  // Mouse / Touch interaction
  const isDraggingRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });

  // Boundary points normalization
  const points = (boundaryData?.points || []).map((pt) => {
    if (Array.isArray(pt)) return [Number(pt[0]), Number(pt[1])];
    return [Number(pt.lat), Number(pt.lng)];
  });

  const cropName = farmInfo?.crop || farmInfo?.cropDetails?.name || null;
  const soilType = farmInfo?.soilType || farmInfo?.soilDetails?.type || null;
  const waterSource = farmInfo?.waterSource || farmInfo?.water?.source || farmInfo?.water?.otherSource || null;

  // Calculate actual local time for sun position (Requirements 50, 51, 104)
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const isNightTime = currentHour < 6 || currentHour >= 18.5;

  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const width = container.clientWidth;
    const currentHeight = height || 420;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera: Elevated Isometric Perspective (Requirement 45)
    const camera = new THREE.PerspectiveCamera(40, width / currentHeight, 0.1, 1000);
    camera.position.set(19, 17, 21);
    camera.lookAt(0, 0.5, 0);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, currentHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Lighting System (Requirement 79)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const sunLight = new THREE.DirectionalLight(0xfef08a, 1.35);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -22;
    sunLight.shadow.camera.right = 22;
    sunLight.shadow.camera.top = 22;
    sunLight.shadow.camera.bottom = -22;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    // 5. 3D Sun Object (Requirements 49, 50, 104, 105)
    let sunX = 0;
    let sunY = 30;
    let sunZ = 10;
    let sunColorHex = 0xfef08a;

    if (currentHour >= 6 && currentHour < 10) {
      // Morning: East (low angle)
      sunX = -26 + (currentHour - 6) * 5;
      sunY = 16 + (currentHour - 6) * 4;
      sunZ = 14;
      sunColorHex = 0xfbbf24; // Warm morning amber
    } else if (currentHour >= 10 && currentHour < 16) {
      // Midday: High overhead
      sunX = -6 + (currentHour - 10) * 2;
      sunY = 32;
      sunZ = 8;
      sunColorHex = 0xfef08a; // Bright yellow
    } else if (currentHour >= 16 && currentHour < 18.5) {
      // Evening: West (low angle)
      sunX = 14 + (currentHour - 16) * 6;
      sunY = 22 - (currentHour - 16) * 5;
      sunZ = -8;
      sunColorHex = 0xf97316; // Golden orange
    } else {
      // Night: Sun hidden below horizon
      sunY = -40;
      sunColorHex = 0x38bdf8;
    }

    sunLight.position.set(sunX, sunY, sunZ);
    sunLight.color.setHex(sunColorHex);

    // Visible 3D Sun Sphere
    const sunGeom = new THREE.SphereGeometry(1.4, 24, 24);
    const sunMat = new THREE.MeshBasicMaterial({ color: sunColorHex });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    sunMesh.position.set(sunX, sunY, sunZ);

    // Sun Glow Halo
    const sunGlowGeom = new THREE.SphereGeometry(2.5, 16, 16);
    const sunGlowMat = new THREE.MeshBasicMaterial({
      color: sunColorHex,
      transparent: true,
      opacity: 0.35,
      side: THREE.BackSide
    });
    const sunGlow = new THREE.Mesh(sunGlowGeom, sunGlowMat);
    sunMesh.add(sunGlow);

    if (!isNightTime) {
      scene.add(sunMesh);
    }
    sunMeshRef.current = sunMesh;

    // 6. Build Farm Terrain from Verified Boundary (Requirements 41, 42)
    let farmShape = new THREE.Shape();
    let centerPt = { x: 0, z: 0 };
    let minCorner = { x: -6, z: -5 };

    if (points.length >= 3 && points.every((point) =>
      Number.isFinite(point[0]) && Number.isFinite(point[1]))) {
      const avgLat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
      const avgLng = points.reduce((sum, p) => sum + p[1], 0) / points.length;
      const scale = 14000;
      const longitudeScale = scale * Math.cos(avgLat * Math.PI / 180);

      let minX = Infinity;
      let minZ = Infinity;

      points.forEach((p, idx) => {
        const x = (p[1] - avgLng) * longitudeScale;
        const z = (p[0] - avgLat) * scale;
        if (x < minX) minX = x;
        if (z < minZ) minZ = z;

        if (idx === 0) farmShape.moveTo(x, z);
        else farmShape.lineTo(x, z);
      });
      farmShape.closePath();
      minCorner = { x: minX + 1.2, z: minZ + 1.2 };
    } else {
      farmShape.moveTo(-8, -6);
      farmShape.lineTo(8, -6);
      farmShape.lineTo(8, 6);
      farmShape.lineTo(-8, 6);
      farmShape.closePath();
      minCorner = { x: -6.5, z: -4.5 };
    }

    const extrudeSettings = {
      depth: 0.6,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.18,
      bevelThickness: 0.18
    };

    const terrainGeom = new THREE.ExtrudeGeometry(farmShape, extrudeSettings);
    terrainGeom.rotateX(Math.PI / 2); // Lay flat on X-Z ground plane

    // Neutral terrain avoids implying crop growth or soil health without evidence.
    const soilMat = new THREE.MeshStandardMaterial({
      color: 0x80613f,
      roughness: 0.75,
      metalness: 0.05
    });

    const groundMesh = new THREE.Mesh(terrainGeom, soilMat);
    groundMesh.receiveShadow = true;
    groundMesh.castShadow = true;
    scene.add(groundMesh);
    groundMeshRef.current = groundMesh;

    // Glowing boundary outline (Requirement 115)
    const lineEdges = new THREE.EdgesGeometry(terrainGeom);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2 });
    const outline = new THREE.LineSegments(lineEdges, lineMat);
    groundMesh.add(outline);

    // Render crop rows only when the farmer has supplied crop information.
    const cropGroup = new THREE.Group();
    if (cropName) {
      for (let r = -5.5; r <= 5.5; r += 1.8) {
        for (let c = -4.5; c <= 4.5; c += 1.6) {
          const plant = createCropPlant(cropName);
          plant.position.set(r, 0.62, c);
          cropGroup.add(plant);
        }
      }
    }
    groundMesh.add(cropGroup);

    // Water Infrastructure Based on Farmer Selection (Requirements 35 to 40, 82, 83)
    const waterGroup = new THREE.Group();
    const cornerX = minCorner.x;
    const cornerZ = minCorner.z;

    if (waterSource === 'Borewell') {
      // Borewell assembly with pump head at farm corner (Requirement 36)
      const basePlatform = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.0, 0.25, 12),
        new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 })
      );
      basePlatform.position.set(cornerX, 0.72, cornerZ);

      const pumpCylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.95, 12),
        new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.6, roughness: 0.3 })
      );
      pumpCylinder.position.set(cornerX, 1.3, cornerZ);

      // Delivery Riser Pipe with valve handwheel
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.65 })
      );
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(cornerX + 0.48, 1.38, cornerZ);

      const valveWheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.03, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.5 })
      );
      valveWheel.rotation.x = Math.PI / 2;
      valveWheel.position.set(cornerX + 0.35, 1.52, cornerZ);

      // Electrical starter box on stanchion
      const starterBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.4, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.4 })
      );
      starterBox.position.set(cornerX - 0.55, 1.25, cornerZ - 0.3);

      waterGroup.add(basePlatform, pumpCylinder, pipe, valveWheel, starterBox);
    } else if (waterSource === 'Well') {
      // Traditional rustic open well with pulley arch at corner (Requirement 37)
      const wellRing = new THREE.Mesh(
        new THREE.CylinderGeometry(1.15, 1.2, 0.75, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.9, side: THREE.DoubleSide })
      );
      wellRing.position.set(cornerX, 0.98, cornerZ);

      const wellWater = new THREE.Mesh(
        new THREE.CircleGeometry(1.0, 16),
        new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2 })
      );
      wellWater.rotation.x = -Math.PI / 2;
      wellWater.position.set(cornerX, 0.78, cornerZ);

      // Wooden Arch Frame
      const archPole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 6), new THREE.MeshStandardMaterial({ color: 0x5a4835 }));
      archPole1.position.set(cornerX - 0.95, 1.45, cornerZ);
      const archPole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 6), new THREE.MeshStandardMaterial({ color: 0x5a4835 }));
      archPole2.position.set(cornerX + 0.95, 1.45, cornerZ);
      const archBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.0, 6), new THREE.MeshStandardMaterial({ color: 0x5a4835 }));
      archBeam.rotation.z = Math.PI / 2;
      archBeam.position.set(cornerX, 2.05, cornerZ);

      const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 16), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
      pulley.position.set(cornerX, 1.95, cornerZ);

      waterGroup.add(wellRing, wellWater, archPole1, archPole2, archBeam, pulley);
    } else if (waterSource === 'Canal') {
      // Flowing water channel along farm edge with check sluice (Requirement 38)
      const canalGeom = new THREE.BoxGeometry(0.95, 0.22, 14);
      const canalMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.15, metalness: 0.25 });
      const canal = new THREE.Mesh(canalGeom, canalMat);
      canal.position.set(cornerX - 0.85, 0.62, 0);

      const sluiceGate = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.65, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 })
      );
      sluiceGate.position.set(cornerX - 0.85, 0.85, 2.5);

      waterGroup.add(canal, sluiceGate);
    } else if (waterSource === 'River') {
      // Natural water feature along farm boundary/edge (Requirement 39)
      const riverGeom = new THREE.BoxGeometry(1.4, 0.18, 15);
      const riverMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.12, metalness: 0.3 });
      const river = new THREE.Mesh(riverGeom, riverMat);
      river.position.set(cornerX - 1.1, 0.6, 0);

      // Natural river stones along bank
      for (let s = -5; s <= 5; s += 2.2) {
        const stone = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.18, 0),
          new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 })
        );
        stone.position.set(cornerX - 0.35, 0.68, s);
        waterGroup.add(stone);
      }

      waterGroup.add(river);
    } else if (waterSource === 'Rainwater') {
      // Rainwater harvesting farm pond with embankment berm (Requirement 40)
      const pondGeom = new THREE.CylinderGeometry(1.4, 1.8, 0.35, 16);
      const pondMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2 });
      const pond = new THREE.Mesh(pondGeom, pondMat);
      pond.position.set(cornerX, 0.75, cornerZ);

      const bermRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.6, 0.22, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x5a4835, roughness: 0.9 })
      );
      bermRing.rotation.x = Math.PI / 2;
      bermRing.position.set(cornerX, 0.68, cornerZ);

      waterGroup.add(pond, bermRing);
    }

    if (waterSource) {
      groundMesh.add(waterGroup);
      waterFeatureRef.current = waterGroup;
    }

    // 9. Rain Particle Stream (Requirements 59, 60)
    const rainCount = 1400;
    const rainGeo = new THREE.BufferGeometry();
    const rainPos = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount * 3; i += 3) {
      rainPos[i] = (Math.random() - 0.5) * 36;
      rainPos[i + 1] = Math.random() * 26;
      rainPos[i + 2] = (Math.random() - 0.5) * 36;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.16,
      transparent: true,
      opacity: 0.75
    });
    const rainSystem = new THREE.Points(rainGeo, rainMat);
    rainSystem.visible = false;
    scene.add(rainSystem);
    rainSystemRef.current = rainSystem;

    // 10. High Heat Light Rays Effect (Requirements 53, 54)
    const heatGroup = new THREE.Group();
    const rayGeom = new THREE.CylinderGeometry(0.12, 1.3, 30, 8, 1, true);
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide
    });
    for (let i = 0; i < 4; i++) {
      const ray = new THREE.Mesh(rayGeom, rayMat);
      ray.position.set(sunX + (i - 2) * 1.6, sunY - 14, sunZ + (i - 2) * 1.6);
      ray.rotation.x = 0.4;
      heatGroup.add(ray);
    }
    heatGroup.visible = false;
    scene.add(heatGroup);
    heatRaysGroupRef.current = heatGroup;

    // 11. Subtle Ambient Grid Floor
    const gridHelper = new THREE.GridHelper(36, 36, 0x334155, 0x1e293b);
    gridHelper.position.y = -0.65;
    scene.add(gridHelper);

    // 12. Animation Loop with Smooth Rotation and Pulse
    let clock = new THREE.Clock();
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Gentle auto-rotation when user is not manually interacting
      if (!isDraggingRef.current && groundMeshRef.current) {
        groundMeshRef.current.rotation.y += delta * 0.035;
      }

      // Heat rays shimmer
      if (heatRaysGroupRef.current && heatRaysGroupRef.current.visible) {
        heatRaysGroupRef.current.children.forEach((ray, idx) => {
          ray.material.opacity = 0.1 + Math.sin(elapsed * 2 + idx) * 0.04;
        });
      }

      // Rain animation
      if (rainSystemRef.current && rainSystemRef.current.visible) {
        const positions = rainSystemRef.current.geometry.attributes.position.array;
        for (let i = 1; i < rainCount * 3; i += 3) {
          positions[i] -= 26 * delta;
          if (positions[i] < 0) positions[i] = 26;
        }
        rainSystemRef.current.geometry.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const newWidth = container.clientWidth;
      camera.aspect = newWidth / currentHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, currentHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [points.length, cropName, waterSource, isNightTime]);

  // Apply Environmental Condition Transitions (Requirements 47 to 64, 103 to 110)
  useEffect(() => {
    if (!sceneRef.current || !ambientLightRef.current || !sunLightRef.current || !groundMeshRef.current) return;

    const scene = sceneRef.current;
    const ambient = ambientLightRef.current;
    const sunLight = sunLightRef.current;
    const ground = groundMeshRef.current;
    const rain = rainSystemRef.current;
    const sunMesh = sunMeshRef.current;
    const heatRays = heatRaysGroupRef.current;

    switch (environmentState) {
      case 'SUNNY':
        scene.background = new THREE.Color(0x0284c7);
        ambient.intensity = 0.75;
        ambient.color.setHex(0xffffff);
        sunLight.intensity = 1.6;
        sunLight.color.setHex(0xfef08a);
        ground.material.color.setHex(0x80613f);
        ground.material.roughness = 0.75;
        if (rain) rain.visible = false;
        if (sunMesh) sunMesh.visible = !isNightTime;
        if (heatRays) heatRays.visible = false;
        break;

      case 'HIGH_HEAT':
        // High heat: stronger sun + visible light rays/highlights (Requirements 53, 54)
        scene.background = new THREE.Color(0x381907);
        ambient.intensity = 0.95;
        ambient.color.setHex(0xffedd5);
        sunLight.intensity = 2.2;
        sunLight.color.setHex(0xf97316);
        ground.material.color.setHex(0x5a4835); // Warmer dry earth tone
        ground.material.roughness = 0.9;
        if (rain) rain.visible = false;
        if (sunMesh) sunMesh.visible = true;
        if (heatRays) heatRays.visible = true;
        break;

      case 'DRY_SOIL':
        // Dry soil: green crops + visible natural dry soil patches (Requirements 55, 56)
        scene.background = new THREE.Color(0x1e293b);
        ambient.intensity = 0.7;
        ambient.color.setHex(0xfef3c7);
        sunLight.intensity = 1.35;
        sunLight.color.setHex(0xfde047);
        ground.material.color.setHex(0x6e5233); // Natural earth-brown soil
        ground.material.roughness = 0.95;
        if (rain) rain.visible = false;
        if (sunMesh) sunMesh.visible = !isNightTime;
        if (heatRays) heatRays.visible = false;
        break;

      case 'RAIN':
        // Rainy environment: cloudy sky, rain particles, wet darker soil (Requirements 59, 60, 61, 62)
        scene.background = new THREE.Color(0x1e293b);
        ambient.intensity = 0.45;
        ambient.color.setHex(0x94a3b8);
        sunLight.intensity = 0.45;
        sunLight.color.setHex(0x64748b);
        ground.material.color.setHex(0x1a3320); // Darker moist wet earth
        ground.material.roughness = 0.22; // Shiny wet surface reflection
        if (rain) rain.visible = true;
        if (sunMesh) sunMesh.visible = false;
        if (heatRays) heatRays.visible = false;
        break;

      case 'LOW_LIGHT':
        // Low light: dim ambient light, farm clearly visible (Requirements 57, 58)
        scene.background = new THREE.Color(0x020617);
        ambient.intensity = 0.35;
        ambient.color.setHex(0x38bdf8);
        sunLight.intensity = 0.25;
        sunLight.color.setHex(0x60a5fa);
        ground.material.color.setHex(0x173822);
        ground.material.roughness = 0.8;
        if (rain) rain.visible = false;
        if (sunMesh) sunMesh.visible = false;
        if (heatRays) heatRays.visible = false;
        break;

      case 'HIGH_HUMIDITY':
        // High humidity: slight atmospheric haze, soft clouds (Requirement 63)
        scene.background = new THREE.Color(0x182234);
        ambient.intensity = 0.6;
        ambient.color.setHex(0xe2e8f0);
        sunLight.intensity = 0.9;
        sunLight.color.setHex(0xf1f5f9);
        ground.material.color.setHex(0x235227);
        ground.material.roughness = 0.5;
        if (rain) rain.visible = false;
        if (sunMesh) sunMesh.visible = !isNightTime;
        if (heatRays) heatRays.visible = false;
        break;

      case 'NORMAL':
      default:
        scene.background = new THREE.Color(0x0b1329);
        ambient.intensity = 0.65;
        ambient.color.setHex(0xffffff);
        sunLight.intensity = 1.35;
        sunLight.color.setHex(0xfef08a);
        ground.material.color.setHex(0x80613f);
        ground.material.roughness = 0.75;
        if (rain) rain.visible = false;
        if (sunMesh) sunMesh.visible = false;
        if (heatRays) heatRays.visible = false;
        break;
    }
  }, [environmentState, isNightTime]);

  // Mouse & Touch 3D Camera Controls
  const handleMouseDown = (e) => {
    isDraggingRef.current = true;
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current || !groundMeshRef.current) return;
    const deltaX = e.clientX - previousMousePositionRef.current.x;
    const deltaY = e.clientY - previousMousePositionRef.current.y;

    groundMeshRef.current.rotation.y += deltaX * 0.008;
    groundMeshRef.current.rotation.x = Math.max(-0.45, Math.min(0.45, groundMeshRef.current.rotation.x + deltaY * 0.008));

    previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    if (!cameraRef.current) return;
    const factor = e.deltaY > 0 ? 1.08 : 0.92;
    cameraRef.current.position.multiplyScalar(factor);
    cameraRef.current.position.clampLength(12, 60);
  };

  const handleResetCamera = () => {
    if (cameraRef.current && groundMeshRef.current) {
      cameraRef.current.position.set(19, 17, 21);
      cameraRef.current.lookAt(0, 0.5, 0);
      groundMeshRef.current.rotation.set(0, 0, 0);
    }
  };

  return (
    <div className={`farm-3d-model-wrapper state-${environmentState.toLowerCase()}`}>
      <div 
        ref={mountRef} 
        className="farm-3d-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            isDraggingRef.current = true;
            previousMousePositionRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }
        }}
        onTouchMove={(e) => {
          if (!isDraggingRef.current || !groundMeshRef.current || e.touches.length !== 1) return;
          const deltaX = e.touches[0].clientX - previousMousePositionRef.current.x;
          const deltaY = e.touches[0].clientY - previousMousePositionRef.current.y;
          groundMeshRef.current.rotation.y += deltaX * 0.01;
          previousMousePositionRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={() => { isDraggingRef.current = false; }}
      ></div>

      {/* Floating 3D HUD Overlay with Machine & Infrastructure Legend */}
      <div className="farm-3d-hud-overlay">
        <div className="hud-state-pill">
          <span className={`status-orb ${environmentState.toLowerCase()}`}></span>
          <span className="state-text font-mono">{environmentState}</span>
        </div>

        <div className="hud-elements-tags">
          <span className="hud-mini-tag">
            <Layers size={12} color="#10b981" /> {t('dashboard.savedGeometry')}
          </span>
          {waterSource && (
            <span className="hud-mini-tag">
              <Droplet size={12} color="#0284c7" /> {waterSource}
            </span>
          )}
        </div>

        <button 
          type="button" 
          className="hud-action-btn" 
          onClick={handleResetCamera}
          title={t('dashboard.resetView')}
        >
          <RotateCcw size={14} />
          <span>{t('dashboard.resetView')}</span>
        </button>
      </div>
    </div>
  );
}
