// Sortie logic for Elang Laut: one flight, four phases — take off, thread five
// rings over the islands, come home, and land. Fuel burns the whole time and
// hard landings cost damage, so the sortie is a series of small decisions:
// how much throttle, how tight a turn, how gentle the touchdown.

import { distanceTo, bearingTo } from './flight.js';

const RING_RADIUS = 18;

export const FUEL_MAX = 120;

export function createMission(terrain) {
  const mission = {
    phase: 'takeoff', // takeoff | rings | return | landed | crashed
    ringsPassed: 0,
    ringsTotal: terrain.rings.length,
    nextRingIndex: 0,
    ringStates: terrain.rings,
    fuel: FUEL_MAX,
    damage: 0,
    score: 0,
    elapsed: 0,
    events: [],
    nextRing: null,
    result: null,
  };
  terrain.highlightRing(0);
  updateNextRing(mission);
  return mission;
}

function updateNextRing(mission) {
  const idx = mission.nextRingIndex;
  mission.nextRing =
    idx < mission.ringStates.length
      ? { def: mission.ringStates[idx].def, distance: 0 }
      : null;
}

function finish(mission, outcome, detail) {
  mission.phase = outcome;
  const timeBonus = outcome === 'landed' ? Math.max(0, Math.round((240 - mission.elapsed) * 2)) : 0;
  const landingBonus = detail === 'smooth' ? 200 : detail === 'firm' ? 100 : 0;
  mission.score += timeBonus + landingBonus;
  mission.result = {
    outcome,
    detail,
    rings: mission.ringsPassed,
    score: mission.score,
    timeBonus,
    landingBonus,
    fuelLeft: Math.max(0, Math.round(mission.fuel)),
    damage: Math.round(mission.damage),
    time: mission.elapsed,
  };
}

// flight: flight state. dt: seconds. Returns event strings for the main loop.
export function updateMission(mission, flight, terrain, dt) {
  const events = [];
  if (mission.phase === 'landed' || mission.phase === 'crashed') return events;
  mission.elapsed += dt;

  // Fuel: the engine drinks more the harder you push it.
  mission.fuel -= (0.3 + flight.throttle * 0.45) * dt;
  if (mission.fuel <= 0) {
    mission.fuel = 0;
    if (!flight.onGround) {
      mission.damage = 100;
      finish(mission, 'crashed', 'fuel');
      events.push('crash-fuel');
      return events;
    }
  }

  // Phase: leaving the runway starts the ring hunt.
  if (mission.phase === 'takeoff' && flight.airborne) {
    mission.phase = 'rings';
    events.push('phase-rings');
  }

  // Ring checks: fly through the glowing hoop, centre within its radius.
  if (mission.phase === 'rings' && mission.nextRingIndex < mission.ringStates.length) {
    const ring = mission.ringStates[mission.nextRingIndex];
    const d = distanceTo(flight, ring.def.x, ring.def.y, ring.def.z);
    mission.nextRing.distance = d;
    if (d < RING_RADIUS) {
      terrain.setRingPassed(mission.nextRingIndex);
      mission.ringsPassed++;
      mission.score += 100;
      mission.nextRingIndex++;
      events.push('ring');
      if (mission.nextRingIndex >= mission.ringStates.length) {
        mission.phase = 'return';
        mission.nextRing = null;
        events.push('phase-return');
      } else {
        terrain.highlightRing(mission.nextRingIndex);
        updateNextRing(mission);
      }
    }
  } else if (mission.phase === 'return') {
    mission.nextRing = null;
  }

  // Bearing home is always available for the HUD needle.
  mission.homeBearing = bearingTo(flight, 0, 0);
  mission.homeDistance = distanceTo(flight, 2, 0, 0);

  return events;
}

// Called by the main loop with the flight touchdown events.
export function applyTouchdown(mission, flight, kind) {
  if (mission.phase === 'landed' || mission.phase === 'crashed') return [];
  const events = [];
  if (kind === 'crash-belly') {
    mission.damage = 100;
    finish(mission, 'crashed', 'belly');
    events.push('crash-belly');
  } else if (kind === 'crash-hard') {
    mission.damage = 100;
    finish(mission, 'crashed', 'hard');
    events.push('crash-hard');
  } else if (kind === 'landing-hard') {
    mission.damage = Math.min(100, mission.damage + 30);
    if (mission.damage >= 100) {
      finish(mission, 'crashed', 'damage');
      events.push('crash-hard');
    } else {
      events.push('landing-hard');
      if (mission.phase === 'return') {
        finish(mission, 'landed', 'firm');
        events.push('landed');
      }
    }
  } else if (kind === 'landing') {
    events.push('landing');
    if (mission.phase === 'return') {
      finish(mission, 'landed', 'smooth');
      events.push('landed');
    }
  }
  return events;
}

export function missionPhaseLabel(mission) {
  switch (mission.phase) {
    case 'takeoff': return 'TAKE-OFF — THROTTLE PENUH, TARIK SAAT 60 KT';
    case 'rings': return `LEWATI RING ${mission.ringsPassed + 1} / ${mission.ringsTotal}`;
    case 'return': return 'SEMUA RING LEWAT — KEMBALI KE RUNWAY 09';
    case 'landed': return 'MISI SELESAI — SELAMAT MENDARAT';
    case 'crashed': return 'PESAWAT JATUH';
    default: return '';
  }
}
