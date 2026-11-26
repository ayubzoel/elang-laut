// Elang Laut — Archipelago Flight. Bootstrap, game loop and camera.
// One sortie: take off from runway 09, thread five glowing rings over the
// islands, come home and land. Title → flying → landed/crashed → results.

import * as THREE from 'three';
import { createFlightState, updateFlight, distanceTo, MAX_SPEED, STALL_SPEED } from './flight.js';
import { createTerrain, groundHeightAt, RINGS } from './terrain.js';
import { createAircraft } from './aircraft.js';
import { createHud } from './hud.js';
import { createMission, updateMission, applyTouchdown, missionPhaseLabel } from './missions.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d6);
scene.fog = new THREE.Fog(0xa8c8dd, 900, 5200);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 12000);
camera.position.set(-260, 12, 24);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3d6b3a, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
sun.position.set(600, 900, 300);
scene.add(sun);

const terrain = createTerrain(scene);
const aircraft = createAircraft();
scene.add(aircraft.group);
const hud = createHud();
const audio = createAudio();
const input = createInput(canvas);
let mission = createMission(terrain);

const flight = createFlightState();
let mode = 'title'; // title | flying | paused | done
let cameraMode = 'chase'; // chase | cockpit
let propAngle = 0;
let camOffset = { yaw: 0, pitch: 0 };
let fpsFrames = 0;
let fpsTime = 0;
let fps = 60;
let paused = false;

const titleScreen = document.getElementById('title-screen');
const resultsScreen = document.getElementById('results-screen');
const pauseScreen = document.getElementById('pause-screen');
const flyButton = document.getElementById('fly-button');
const againButton = document.getElementById('again-button');
const resumeButton = document.getElementById('resume-button');

function placeOnRunway() {
  flight.position.set(-240, 2 + 1.25, 0);
  flight.quaternion.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ'));
  flight.speed = 0;
  flight.throttle = 0;
  flight.pitch = 0;
  flight.roll = 0;
  flight.heading = 90;
  flight.onGround = true;
  flight.airborne = false;
  flight.gearDown = true;
  aircraft.setGearDown(true);
}

function startFlight() {
  audio.unlock();
  audio.click();
  placeOnRunway();
  mission = createMission(terrain);
  terrain.rings.forEach((r) => {
    r.passed = false;
    r.mesh.material = new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.92 });
    r.beam.material.opacity = 0.1;
    r.mesh.scale.setScalar(1);
  });
  terrain.highlightRing(0);
  mode = 'flying';
  paused = false;
  titleScreen.classList.add('hidden');
  resultsScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hud.showMessage('TAKE-OFF: TAHAN W UNTUK THROTTLE, TARIK ↓ SAAT 60 KT', 4200);
  hud.setPhase(missionPhaseLabel(mission));
}

function showResults() {
  mode = 'done';
  const r = mission.result;
  document.getElementById('result-title').textContent =
    r.outcome === 'landed' ? 'MISI SELESAI — SELAMAT MENDARAT' : 'PESAWAT JATUH';
  document.getElementById('result-score').textContent = String(r.score);
  document.getElementById('result-detail').textContent =
    r.outcome === 'landed'
      ? `Ring ${r.rings}/5 · bonus pendaratan ${r.landingBonus} · bonus waktu ${r.timeBonus} · bahan bakar tersisa ${r.fuelLeft}% · kerusakan ${r.damage}%`
      : r.detail === 'fuel'
        ? `Bahan bakar habis di udara. Ring ${r.rings}/5 · skor ${r.score}`
        : r.detail === 'belly'
          ? `Mendarat tanpa roda — perut pesawat menghantam aspal. Ring ${r.rings}/5`
          : `Pendaratan terlalu keras. Ring ${r.rings}/5 · kerusakan ${r.damage}%`;
  resultsScreen.classList.remove('hidden');
}

flyButton.addEventListener('click', startFlight);
againButton.addEventListener('click', startFlight);
resumeButton.addEventListener('click', () => {
  paused = false;
  pauseScreen.classList.add('hidden');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Camera: chase view trails the plane; cockpit view sits in the canopy.
const _chasePos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _camTarget = new THREE.Vector3(-260, 12, 24);
const _lookTarget = new THREE.Vector3();

function updateCamera(dt) {
  if (cameraMode === 'cockpit') {
    _fwd.set(0, 0, -1).applyQuaternion(flight.quaternion);
    // Sit just above the canopy so the nose and the glass dome read at the
    // bottom of the frame while the sky and runway stay in view.
    camera.position.copy(flight.position).addScaledVector(_fwd, 1.9);
    camera.position.y += 1.35;
    _lookAt.copy(flight.position).addScaledVector(_fwd, 120);
    camera.position.lerp(camera.position, 1);
    camera.lookAt(_lookAt);
    return;
  }
  _fwd.set(0, 0, -1).applyQuaternion(flight.quaternion);
  _chasePos.copy(flight.position).addScaledVector(_fwd, -11.5);
  _chasePos.y += 3.4;
  // Mouse drag lets the pilot glance around; it settles back behind the plane.
  const drag = input.consumeDrag();
  camOffset.yaw = THREE.MathUtils.clamp(camOffset.yaw - drag.dx * 0.002, -0.5, 0.5);
  camOffset.pitch = THREE.MathUtils.clamp(camOffset.pitch + drag.dy * 0.0012, -0.25, 0.3);
  camOffset.yaw *= Math.exp(-dt * 1.2);
  camOffset.pitch *= Math.exp(-dt * 1.2);
  const side = new THREE.Vector3().crossVectors(_fwd, new THREE.Vector3(0, 1, 0)).normalize();
  _chasePos.addScaledVector(side, camOffset.yaw * 8);
  _chasePos.y += camOffset.pitch * 6;
  const k = 1 - Math.exp(-dt * 4.5);
  _camTarget.lerp(_chasePos, k);
  camera.position.copy(_camTarget);
  _lookAt.copy(flight.position).addScaledVector(_fwd, 34);
  _lookAt.y += 1.2;
  _lookTarget.lerp(_lookAt, 1 - Math.exp(-dt * 6));
  camera.lookAt(_lookTarget);
}

function handleFlightEvents(events) {
  for (const ev of events) {
    if (ev === 'takeoff') {
      audio.takeoff();
      hud.showMessage('LEPAS LANDAS — MENUJU RING 1: PULAU TIMUR', 3200);
    } else if (ev === 'landing' || ev === 'landing-hard') {
      audio.thud();
    } else if (ev === 'crash-belly' || ev === 'crash-hard') {
      audio.crash();
    }
    const missionEvents = applyTouchdown(mission, flight, ev);
    for (const mev of missionEvents) {
      if (mev === 'landed') {
        audio.takeoff();
        showResults();
      } else if (mev === 'crash-belly' || mev === 'crash-hard') {
        audio.crash();
        showResults();
      } else if (mev === 'landing-hard') {
        hud.showMessage('PENDARATAN KERAS — KERUSAKAN +30%', 3000);
      }
    }
  }
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  // rawDt is real time (for the FPS meter); dt is clamped so the simulation
  // never takes a giant step after a slow frame.
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = now;

  fpsFrames++;
  fpsTime += rawDt;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
    hud.setFps(fps);
  }

  // One-shot keys work in every mode.
  if (input.wasPressed('KeyM')) audio.setMuted(!audio.isMuted());
  if (input.wasPressed('KeyC') && mode === 'flying') {
    cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
    hud.showMessage(cameraMode === 'cockpit' ? 'KAMERA KOKPIT' : 'KAMERA CHASE', 1200);
  }
  if (input.wasPressed('KeyR') && (mode === 'flying' || mode === 'done')) startFlight();
  if (input.wasPressed('KeyP') && mode === 'flying') {
    paused = !paused;
    pauseScreen.classList.toggle('hidden', !paused);
  }
  if (input.wasPressed('KeyG') && mode === 'flying') {
    flight.gearDown = !flight.gearDown;
    aircraft.setGearDown(flight.gearDown);
    hud.showMessage(flight.gearDown ? 'RODA TURUN' : 'RODA NAIK', 1400);
  }

  if (mode === 'title') {
    // Slow cinematic orbit around the parked plane.
    const t = now * 0.00008;
    camera.position.set(
      flight.position.x - 26 * Math.cos(t * 6),
      8 + Math.sin(t * 3) * 2,
      flight.position.z + 26 * Math.sin(t * 6),
    );
    camera.lookAt(flight.position.x, flight.position.y + 1, flight.position.z);
    terrain.update(dt);
    renderer.render(scene, camera);
    return;
  }

  if (mode === 'flying' && !paused) {
    const axes = input.axes();
    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      flight.throttle = THREE.MathUtils.clamp(flight.throttle - wheel * 0.0004, 0, 1);
    }
    const events = updateFlight(flight, axes, dt, groundHeightAt);
    handleFlightEvents(events);

    const missionEvents = updateMission(mission, flight, terrain, dt);
    for (const mev of missionEvents) {
      if (mev === 'ring') {
        audio.ring();
        hud.showMessage(
          mission.nextRingIndex >= mission.ringStates.length
            ? 'SEMUA RING LEWAT — KEMBALI KE RUNWAY 09'
            : `RING ${mission.ringsPassed}/${mission.ringsTotal} LEWAT — LANJUT KE ${RINGS[mission.nextRingIndex].name}`,
          3200,
        );
      } else if (mev === 'crash-fuel') {
        audio.crash();
        showResults();
      }
    }
    hud.setPhase(missionPhaseLabel(mission));

    // Propeller spins with the engine; the shadow blob fades with altitude.
    propAngle += dt * (4 + flight.throttle * 46 + flight.speed * 0.35);
    aircraft.setPropellerSpin(propAngle);
    const groundBelow = groundHeightAt(flight.position.x, flight.position.z);
    aircraft.setShadowHeight(flight.position.y - groundBelow);
    audio.update(flight.throttle, flight.speed / MAX_SPEED, mission.fuel, now);

    aircraft.group.position.copy(flight.position);
    aircraft.group.quaternion.copy(flight.quaternion);
    aircraft.setPropellerBlur(cameraMode === 'cockpit');
    updateCamera(dt);
    terrain.update(dt);
    hud.update(flight, mission, dt);
  } else if (mode === 'done') {
    terrain.update(dt);
    hud.update(flight, mission, dt);
  }

  renderer.render(scene, camera);
}

// Debug hooks for play-testing and screenshots (not part of the game UI).
window.__ELANG_LAUT__ = {
  getState() {
    return {
      mode,
      cameraMode,
      speedKnots: Math.round(flight.speed * 1.944),
      altitudeFeet: Math.round(flight.position.y * 3.281),
      heading: Math.round(flight.heading),
      fuel: Math.round(mission.fuel),
      rings: mission.ringsPassed,
      phase: mission.phase,
      position: flight.position.toArray().map((v) => Math.round(v)),
    };
  },
  startFlight,
  setCameraMode(m) {
    cameraMode = m;
  },
  setPose(x, y, z, headingDeg, pitchDeg, rollDeg, speed) {
    flight.position.set(x, y, z);
    flight.quaternion.setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(pitchDeg || 0),
        THREE.MathUtils.degToRad(-(headingDeg || 90)),
        THREE.MathUtils.degToRad(rollDeg || 0),
        'YXZ',
      ),
    );
    flight.speed = speed || 55;
    flight.throttle = 0.7;
    flight.onGround = false;
    flight.airborne = true;
    _camTarget.copy(flight.position).add(new THREE.Vector3(-11, 3, 11));
    _lookTarget.copy(flight.position);
  },
  skipToRing(i) {
    mission.nextRingIndex = i;
    mission.ringsPassed = i;
    if (i >= mission.ringStates.length) {
      mission.phase = 'return';
      mission.nextRing = null;
    } else {
      mission.phase = 'rings';
      terrain.highlightRing(i);
    }
  },
  setFuel(v) {
    mission.fuel = v;
  },
};

placeOnRunway();
aircraft.group.position.copy(flight.position);
aircraft.group.quaternion.copy(flight.quaternion);
requestAnimationFrame(loop);
