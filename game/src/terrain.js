// Archipelago world for Elang Laut: one seeded heightfield, a sea, and the
// landmarks that make the place recognisable — a coastal runway, a lighthouse,
// a fishing town, five glowing target rings. The same height function that
// shapes the mesh answers groundHeightAt(), so the plane can never disagree
// with what the player sees.

import * as THREE from 'three';
import { createFbm2, mulberry32, clamp, smoothstep, lerp } from './noise.js';

export const WORLD_SIZE = 4200;
export const SEA_LEVEL = 0;
export const RUNWAY = { x: 0, z: 0, length: 620, width: 34, headingDeg: 90 };

// Islands: x, z, radius, peak height. The main island holds the runway.
const ISLANDS = [
  { x: 0, z: 0, r: 1600, peak: 85 },
  { x: -800, z: -1200, r: 700, peak: 150 },
  { x: 1250, z: -550, r: 620, peak: 120 },
  { x: 350, z: 1350, r: 850, peak: 130 },
  { x: -1450, z: 450, r: 520, peak: 90 },
  { x: 1500, z: -1500, r: 480, peak: 100 },
];

export const RINGS = [
  { x: 950, y: 150, z: -450, name: 'PULAU TIMUR' },
  { x: 1150, y: 190, z: 350, name: 'TANJUNG SELATAN' },
  { x: 350, y: 130, z: 1150, name: 'PULAU SELATAN' },
  { x: -750, y: 200, z: 850, name: 'TELUK BARAT' },
  { x: -1050, y: 170, z: -650, name: 'PULAU UTARA' },
];

const fbm = createFbm2(20261126, 4);
const detail = createFbm2(77, 3);

function islandHeight(x, z) {
  let h = 0;
  for (const isl of ISLANDS) {
    const dx = x - isl.x;
    const dz = z - isl.z;
    const d = Math.sqrt(dx * dx + dz * dz) / isl.r;
    if (d >= 1) continue;
    const fall = (1 - d * d) * (1 - d * d);
    h += isl.peak * fall;
  }
  return h;
}

// The one height function: mesh, trees, town, lighthouse and flight all use it.
export function groundHeightAt(x, z) {
  const base = islandHeight(x, z);
  if (base <= 0.5) return 0;
  let h = base * (0.82 + 0.36 * fbm(x * 0.0016 + 11, z * 0.0016 - 7));
  h += 6 * detail(x * 0.006, z * 0.006) * smoothstep(2, 25, h);
  // Airfield plateau: a broad grass plain around the runway so the strip is
  // not a trench cut into the island dome — hills rise beyond ~650 m.
  const airD = Math.hypot(x - RUNWAY.x, z - RUNWAY.z);
  h = lerp(h, 4, smoothstep(650, 420, airD));
  // Flatten the runway strip so take-off and landing are on level asphalt.
  // The strip wins over the plateau: the runway sits 2 m, the plain 4 m.
  const along = Math.abs(x - RUNWAY.x);
  const across = Math.abs(z - RUNWAY.z);
  const strip = smoothstep(70, 25, across) * smoothstep(360, 300, along);
  h = lerp(h, 2, strip);
  // Flatten the town shelf south of the runway.
  const townD = Math.hypot(x - 190, z - 300);
  h = lerp(h, 4, smoothstep(260, 140, townD));
  return Math.max(0, h);
}

function heightColor(h, slope, out) {
  // Sand, grass, rock, high scrub — one tropical palette.
  if (h < 3.5) out.setRGB(0.85, 0.76, 0.48);
  else if (h < 55) {
    const v = 0.5 + 0.5 * detail(h * 0.4, h * 0.13);
    out.setRGB(0.32 + 0.1 * v, 0.52 + 0.12 * v, 0.26);
  } else if (h < 110) out.setRGB(0.48, 0.45, 0.38);
  else out.setRGB(0.55, 0.56, 0.46);
  if (slope > 0.55 && h > 10) out.setRGB(0.42, 0.4, 0.35);
  return out;
}

export function createTerrain(scene) {
  const group = new THREE.Group();
  const rand = mulberry32(4242);

  // --- Heightfield ---
  const segs = 150;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const half = WORLD_SIZE / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = groundHeightAt(x, z);
    pos.setY(i, h);
    const hx = groundHeightAt(x + 6, z) - groundHeightAt(x - 6, z);
    const hz = groundHeightAt(x, z + 6) - groundHeightAt(x, z - 6);
    const slope = Math.sqrt(hx * hx + hz * hz) / 12;
    heightColor(h, slope, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const land = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
  );
  group.add(land);

  // --- Sea ---
  const sea = new THREE.Mesh(
    new THREE.CircleGeometry(6500, 48),
    new THREE.MeshPhongMaterial({ color: 0x1d6f9e, transparent: true, opacity: 0.93, shininess: 120, specular: 0x99ccdd }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL;
  group.add(sea);

  // --- Runway ---
  const runway = new THREE.Group();
  const asphalt = new THREE.Mesh(
    new THREE.BoxGeometry(RUNWAY.length, 0.6, RUNWAY.width),
    new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.9 }),
  );
  asphalt.position.y = 2.0;
  runway.add(asphalt);
  // Centreline dashes.
  const dashGeo = new THREE.BoxGeometry(18, 0.15, 1.6);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f2e8 });
  for (let x = -280; x <= 280; x += 40) {
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(x, 2.35, 0);
    runway.add(dash);
  }
  // Threshold bars.
  const barGeo = new THREE.BoxGeometry(2.2, 0.15, 22);
  for (const sx of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const bar = new THREE.Mesh(barGeo, dashMat);
      bar.position.set(sx * 292, 2.35, k * 9);
      runway.add(bar);
    }
  }
  // Runway numbers "09" / "27" painted from a canvas texture.
  function numberTexture(text) {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f5f2e8';
    ctx.font = 'bold 92px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }
  const numGeo = new THREE.PlaneGeometry(26, 26);
  const num09 = new THREE.Mesh(numGeo, new THREE.MeshBasicMaterial({ map: numberTexture('09'), transparent: true }));
  num09.rotation.x = -Math.PI / 2;
  num09.rotation.z = Math.PI / 2;
  num09.position.set(-258, 2.38, 0);
  runway.add(num09);
  const num27 = new THREE.Mesh(numGeo, new THREE.MeshBasicMaterial({ map: numberTexture('27'), transparent: true }));
  num27.rotation.x = -Math.PI / 2;
  num27.rotation.z = -Math.PI / 2;
  num27.position.set(258, 2.38, 0);
  runway.add(num27);
  // Edge lights: small amber lamps along both edges.
  const lampGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const lampInst = new THREE.InstancedMesh(lampGeo, lampMat, 44);
  const m4 = new THREE.Matrix4();
  let li = 0;
  for (let x = -300; x <= 300; x += 30) {
    for (const zz of [-17.5, 17.5]) {
      m4.makeTranslation(x, 2.6, zz);
      lampInst.setMatrixAt(li++, m4);
    }
  }
  lampInst.count = li;
  runway.add(lampInst);
  group.add(runway);

  // --- Lighthouse on the northern point ---
  const lightBase = groundHeightAt(-720, -820);
  const lighthouse = new THREE.Group();
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 4.4, 26, 12),
    new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.8 }),
  );
  tower.position.y = 13;
  lighthouse.add(tower);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(3.55, 3.8, 5, 12),
    new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.8 }),
  );
  band.position.y = 16;
  lighthouse.add(band);
  const lampTop = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
  );
  lampTop.position.y = 27;
  lighthouse.add(lampTop);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(7, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(30, 27, 0);
  const beamPivot = new THREE.Group();
  beamPivot.add(beam);
  beamPivot.position.y = 0;
  lighthouse.add(beamPivot);
  lighthouse.position.set(-720, lightBase, -820);
  group.add(lighthouse);

  // --- Fishing town south of the runway ---
  const townCount = 46;
  const houseGeo = new THREE.BoxGeometry(1, 1, 1);
  const houseMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const houses = new THREE.InstancedMesh(houseGeo, houseMat, townCount);
  const palette = [0xe8dcc0, 0xd9a441, 0xc96f4a, 0x7fa8a0, 0xe8e2d2, 0xb5533c];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < townCount; i++) {
    const a = rand() * Math.PI * 2;
    const r = 40 + rand() * 190;
    const x = 190 + Math.cos(a) * r;
    const z = 300 + Math.sin(a) * r * 0.7;
    const w = 8 + rand() * 10;
    const h = 6 + rand() * 14;
    const d = 8 + rand() * 10;
    dummy.position.set(x, groundHeightAt(x, z) + h / 2, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.y = rand() * Math.PI;
    dummy.updateMatrix();
    houses.setMatrixAt(i, dummy.matrix);
    houses.setColorAt(i, col.setHex(palette[(rand() * palette.length) | 0]));
  }
  group.add(houses);

  // --- Palm trees on the grass ---
  const treeCount = 380;
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crownGeo = new THREE.ConeGeometry(3.2, 7, 7);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 1, flatShading: true });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
  let placed = 0;
  let guard = 0;
  while (placed < treeCount && guard++ < 6000) {
    const x = (rand() * 2 - 1) * 1900;
    const z = (rand() * 2 - 1) * 1900;
    const h = groundHeightAt(x, z);
    if (h < 4 || h > 55) continue;
    if (Math.abs(z) < 55 && Math.abs(x) < 360) continue; // keep the runway clear
    const s = 0.8 + rand() * 0.7;
    dummy.position.set(x, h + 2.5 * s, z);
    dummy.scale.setScalar(s);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.y = h + (2.5 + 3.2) * s;
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  trunks.count = placed;
  crowns.count = placed;
  group.add(trunks);
  group.add(crowns);

  // --- Clouds (flat white: clean against the sky in this flat-shaded world) ---
  const clouds = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0.82 });
  for (let i = 0; i < 16; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + ((rand() * 3) | 0);
    for (let p = 0; p < puffs; p++) {
      const r = 18 + rand() * 26;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
      puff.position.set((rand() - 0.5) * 70, (rand() - 0.5) * 10, (rand() - 0.5) * 36);
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    cloud.position.set((rand() * 2 - 1) * 1800, 260 + rand() * 160, (rand() * 2 - 1) * 1800);
    cloud.userData.speed = 2 + rand() * 3;
    clouds.push(cloud);
    group.add(cloud);
  }

  // --- Target rings ---
  const ringMeshes = [];
  const ringGeo = new THREE.TorusGeometry(18, 1.5, 12, 42);
  for (const ring of RINGS) {
    const mesh = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.92 }),
    );
    mesh.position.set(ring.x, ring.y, ring.z);
    mesh.userData.baseY = ring.y;
    group.add(mesh);
    const beamRing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 130, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    beamRing.position.set(ring.x, ring.y - 40, ring.z);
    group.add(beamRing);
    ringMeshes.push({ mesh, beam: beamRing, def: ring, passed: false });
  }

  scene.add(group);

  let time = 0;
  return {
    groundHeightAt,
    rings: ringMeshes,
    update(dt) {
      time += dt;
      for (const cloud of clouds) {
        cloud.position.x += cloud.userData.speed * dt;
        if (cloud.position.x > 2000) cloud.position.x = -2000;
      }
      beamPivot.rotation.y = time * 0.5;
      for (const r of ringMeshes) {
        if (!r.passed) {
          r.mesh.position.y = r.mesh.userData.baseY + Math.sin(time * 1.4 + r.def.x) * 2.5;
          r.mesh.rotation.y = time * 0.25;
        }
      }
    },
    setRingPassed(index) {
      const r = ringMeshes[index];
      if (!r) return;
      r.passed = true;
      r.mesh.material = new THREE.MeshBasicMaterial({ color: 0x35d05a, transparent: true, opacity: 0.55 });
      r.beam.material.opacity = 0.03;
    },
    highlightRing(index) {
      ringMeshes.forEach((r, i) => {
        if (r.passed) return;
        r.mesh.material.color.setHex(i === index ? 0xffb020 : 0xff8c1a);
        const s = i === index ? 1.12 : 1.0;
        r.mesh.scale.setScalar(s);
      });
    },
  };
}
