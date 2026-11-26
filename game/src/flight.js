// Flight model for Elang Laut: an arcade prop-plane model with real trade-offs.
// Throttle sets a target speed the engine chases; controls lose authority when
// slow; banking turns the plane; below stall speed the wing stops flying and
// the nose drops. Ground handling, take-off rotation and landings are part of
// the same state machine so a landing reads as a landing, not a teleport.

import * as THREE from 'three';

export const STALL_SPEED = 26; // m/s — below this the wing barely flies
export const ROTATE_SPEED = 32; // m/s — fast enough to lift off the runway
export const MAX_SPEED = 82; // m/s at full throttle
export const GEAR_HEIGHT = 1.25; // metres from fuselage centre to wheels

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);
const _forward = new THREE.Vector3();

export function createFlightState() {
  return {
    position: new THREE.Vector3(-240, 2 + GEAR_HEIGHT, 0),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ')),
    speed: 0,
    throttle: 0,
    pitch: 0,
    roll: 0,
    heading: 90,
    verticalSpeed: 0,
    onGround: true,
    gearDown: true,
    airborne: false,
    sinkRate: 0,
  };
}

// input: { pitch: -1..1 (up positive), roll: -1..1, yaw: -1..1,
//          throttleUp, throttleDown, brake }
// groundHeightAt(x, z): metres. Returns events: [] of strings.
export function updateFlight(state, input, dt, groundHeightAt) {
  const events = [];

  // Throttle: W/S move it, it stays where you leave it.
  if (input.throttleUp) state.throttle = Math.min(1, state.throttle + dt * 0.55);
  if (input.throttleDown) state.throttle = Math.max(0, state.throttle - dt * 0.55);
  if (input.brake) state.throttle = Math.max(0, state.throttle - dt * 1.2);

  // Engine chases the throttle's target speed; drag fights it.
  const targetSpeed = state.throttle * MAX_SPEED;
  const accel = targetSpeed > state.speed ? 7.5 : 4.5;
  if (state.speed < targetSpeed) {
    state.speed = Math.min(targetSpeed, state.speed + accel * dt);
  } else {
    state.speed = Math.max(targetSpeed, state.speed - accel * dt);
  }

  // Controls bite only with airflow over the surfaces.
  const authority = Math.min(1, state.speed / STALL_SPEED);
  const pitchRate = 0.85 * authority;
  const rollRate = 1.7 * authority;
  const yawRate = 0.35 * authority;

  // Yaw: three.js positive Y rotation turns north toward west, so the rudder
  // is applied with the opposite sign to make D turn the nose right.
  // On the ground the plane stays level until rotation speed: no pitching
  // the nose into the runway while taxiing, no banking on the wheels.
  const groundPitch = state.onGround && state.speed <= ROTATE_SPEED ? 0 : input.pitch;
  const groundRoll = state.onGround ? 0 : input.roll;

  _qYaw.setFromAxisAngle(_axisY, -input.yaw * yawRate * dt);
  _qPitch.setFromAxisAngle(_axisX, groundPitch * pitchRate * dt);
  _qRoll.setFromAxisAngle(_axisZ, -groundRoll * rollRate * dt);
  state.quaternion.multiply(_qYaw);
  state.quaternion.multiply(_qPitch);
  state.quaternion.multiply(_qRoll);
  state.quaternion.normalize();

  _euler.setFromQuaternion(state.quaternion, 'YXZ');
  state.pitch = THREE.MathUtils.radToDeg(_euler.x);
  // Aviation heading: 0 = north (-z), 90 = east (+x), clockwise from above.
  state.heading = (360 - THREE.MathUtils.radToDeg(_euler.y)) % 360;
  state.roll = THREE.MathUtils.radToDeg(_euler.z);

  // A banked wing pulls the nose around: coordinated turns.
  const bankTurn = Math.sin(THREE.MathUtils.degToRad(state.roll)) * 0.55 * authority;
  _qYaw.setFromAxisAngle(_axisY, bankTurn * dt);
  state.quaternion.multiply(_qYaw);
  state.quaternion.normalize();
  _euler.setFromQuaternion(state.quaternion, 'YXZ');
  state.heading = (360 - THREE.MathUtils.radToDeg(_euler.y)) % 360;

  // Move along the nose.
  _forward.set(0, 0, -1).applyQuaternion(state.quaternion);
  const prevY = state.position.y;
  state.position.addScaledVector(_forward, state.speed * dt);

  // Below stall speed the wing gives up: the nose drops and we sink.
  if (!state.onGround && state.speed < STALL_SPEED) {
    const shortfall = (STALL_SPEED - state.speed) / STALL_SPEED;
    state.sinkRate = shortfall * 9;
    state.position.y -= state.sinkRate * dt;
    _qPitch.setFromAxisAngle(_axisX, -shortfall * 0.35 * dt);
    state.quaternion.multiply(_qPitch);
    state.quaternion.normalize();
  } else {
    state.sinkRate = 0;
  }

  state.verticalSpeed = (state.position.y - prevY) / Math.max(dt, 0.0001);

  // Ground contact.
  const ground = groundHeightAt(state.position.x, state.position.z) + GEAR_HEIGHT;
  if (state.position.y <= ground) {
    if (!state.onGround) {
      // We just touched down: judge the landing by vertical speed and gear.
      const vs = -state.verticalSpeed;
      state.position.y = ground;
      state.onGround = true;
      if (!state.gearDown) {
        events.push('crash-belly');
      } else if (vs > 9) {
        events.push('crash-hard');
      } else if (vs > 4.5) {
        events.push('landing-hard');
      } else {
        events.push('landing');
      }
      // Kill the sink and level the wings on the ground.
      _euler.setFromQuaternion(state.quaternion, 'YXZ');
      _euler.x = 0;
      _euler.z = 0;
      state.quaternion.setFromEuler(_euler);
      state.pitch = 0;
      state.roll = 0;
    } else {
      state.position.y = ground;
    }
  } else if (state.onGround) {
    // Fast enough and pulling up: rotate and leave the ground.
    if (state.speed > ROTATE_SPEED && input.pitch > 0.25) {
      state.onGround = false;
      state.airborne = true;
      events.push('takeoff');
    }
  }

  return events;
}

// Distance from the plane to a point, for ring checks and navigation.
export function distanceTo(state, x, y, z) {
  const dx = state.position.x - x;
  const dy = state.position.y - y;
  const dz = state.position.z - z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Bearing (degrees, 0 = north) from the plane to a point, for the HUD needle.
export function bearingTo(state, x, z) {
  const dx = x - state.position.x;
  const dz = z - state.position.z;
  let deg = THREE.MathUtils.radToDeg(Math.atan2(dx, -dz));
  if (deg < 0) deg += 360;
  return deg;
}
