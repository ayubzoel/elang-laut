// Flight instruments for Elang Laut: a DOM heads-up display with a drawn
// artificial horizon, a scrolling heading tape, live engine gauges and a
// top-down minimap. Every number is smoothed before it is shown, the way a
// real instrument needle settles — the pattern is standard avionics, the
// implementation here is written for this game.

import { groundHeightAt } from './terrain.js';
import { FUEL_MAX } from './missions.js';

function lerpAngle(current, target, factor) {
  let diff = target - current;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  return current + diff * factor;
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function headingName(deg) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function createHud() {
  const el = (id) => document.getElementById(id);
  const refs = {
    speed: el('hud-speed'),
    speedUnit: el('hud-speed-unit'),
    altitude: el('hud-alt'),
    vspeed: el('hud-vsi'),
    headingDigital: el('hud-hdg'),
    headingTape: el('hud-tape'),
    throttleFill: el('hud-thr-fill'),
    throttleText: el('hud-thr-text'),
    fuelFill: el('hud-fuel-fill'),
    fuelText: el('hud-fuel-text'),
    damageFill: el('hud-dmg-fill'),
    rings: el('hud-rings'),
    ringDist: el('hud-ring-dist'),
    timer: el('hud-time'),
    score: el('hud-score'),
    message: el('hud-message'),
    warning: el('hud-warning'),
    horizon: el('hud-horizon'),
    minimap: el('hud-minimap'),
    fps: el('hud-fps'),
    phase: el('hud-phase'),
  };
  const hctx = refs.horizon.getContext('2d');
  const mctx = refs.minimap.getContext('2d');

  // Pre-render the minimap landmass once: sample the height function.
  const mapSize = 180;
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = mapSize;
  mapCanvas.height = mapSize;
  {
    const c = mapCanvas.getContext('2d');
    c.fillStyle = '#0d2f45';
    c.fillRect(0, 0, mapSize, mapSize);
    const step = 4200 / mapSize;
    for (let py = 0; py < mapSize; py++) {
      for (let px = 0; px < mapSize; px++) {
        const h = groundHeightAt((px - mapSize / 2) * step, (py - mapSize / 2) * step);
        if (h > 2) {
          c.fillStyle = h > 60 ? '#8a7f63' : '#4a7a3f';
          c.fillRect(px, py, 1, 1);
        }
      }
    }
    // Runway line.
    c.strokeStyle = '#e8e2d2';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(mapSize / 2 - 12, mapSize / 2);
    c.lineTo(mapSize / 2 + 12, mapSize / 2);
    c.stroke();
  }

  // Heading tape ticks: -360..720 so it can slide either way.
  const tapeInner = refs.headingTape;
  for (let d = -360; d <= 720; d += 5) {
    const tick = document.createElement('div');
    tick.className = 'tape-tick' + (d % 30 === 0 ? ' major' : '');
    tick.style.left = `${(d + 360) * 3}px`;
    tapeInner.appendChild(tick);
    if (d % 30 === 0) {
      const label = document.createElement('div');
      label.className = 'tape-label';
      label.style.left = `${(d + 360) * 3}px`;
      const norm = ((d % 360) + 360) % 360;
      label.textContent = norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : String(norm).padStart(3, '0');
      tapeInner.appendChild(label);
    }
  }

  const smooth = { speed: 0, alt: 0, heading: 90, pitch: 0, roll: 0, throttle: 0, vsi: 0 };
  let messageTimer = null;
  let lastFps = 0;

  function drawHorizon(pitch, roll) {
    const w = refs.horizon.width;
    const h = refs.horizon.height;
    const cx = w / 2;
    const cy = h / 2;
    hctx.clearRect(0, 0, w, h);
    hctx.save();
    // Clip to a round instrument face.
    hctx.beginPath();
    hctx.arc(cx, cy, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
    hctx.clip();
    // The world turns with the plane: rotate by roll, shift by pitch.
    hctx.translate(cx, cy);
    hctx.rotate((-roll * Math.PI) / 180);
    hctx.translate(0, pitch * 2.4);
    hctx.fillStyle = '#3f7fb8';
    hctx.fillRect(-w, -h * 2, w * 2, h * 2);
    hctx.fillStyle = '#6b4a2f';
    hctx.fillRect(-w, 0, w * 2, h * 2);
    hctx.strokeStyle = 'rgba(255,255,255,0.9)';
    hctx.lineWidth = 2;
    hctx.beginPath();
    hctx.moveTo(-w, 0);
    hctx.lineTo(w, 0);
    hctx.stroke();
    // Pitch ladder every 10 degrees.
    hctx.fillStyle = '#ffffff';
    hctx.font = 'bold 11px sans-serif';
    hctx.textAlign = 'center';
    for (let p = -60; p <= 60; p += 10) {
      if (p === 0) continue;
      const y = -p * 2.4;
      const len = p % 30 === 0 ? 46 : 26;
      hctx.beginPath();
      hctx.moveTo(cx - len, y);
      hctx.lineTo(cx + len, y);
      hctx.stroke();
      if (p % 30 === 0) hctx.fillText(String(Math.abs(p)), cx - len - 12, y + 4);
    }
    hctx.restore();
    // Fixed wings: the aircraft symbol never moves.
    hctx.strokeStyle = '#ffb347';
    hctx.lineWidth = 3;
    hctx.beginPath();
    hctx.moveTo(cx - 42, cy);
    hctx.lineTo(cx - 12, cy);
    hctx.moveTo(cx + 12, cy);
    hctx.lineTo(cx + 42, cy);
    hctx.moveTo(cx, cy - 8);
    hctx.lineTo(cx, cy + 2);
    hctx.stroke();
    hctx.strokeStyle = 'rgba(255,255,255,0.65)';
    hctx.lineWidth = 2;
    hctx.beginPath();
    hctx.arc(cx, cy, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
    hctx.stroke();
  }

  function drawMinimap(flight, rings, nextRing) {
    const w = refs.minimap.width;
    const h = refs.minimap.height;
    mctx.clearRect(0, 0, w, h);
    mctx.drawImage(mapCanvas, 0, 0);
    const toMap = (x, z) => [(x / 4200 + 0.5) * w, (z / 4200 + 0.5) * h];
    // Rings: green when passed, amber for the next one, dim for later ones.
    rings.forEach((ring, i) => {
      const [rx, ry] = toMap(ring.def.x, ring.def.z);
      mctx.beginPath();
      mctx.arc(rx, ry, i === nextRing ? 7 : 5, 0, Math.PI * 2);
      mctx.strokeStyle = ring.passed ? '#35d05a' : i === nextRing ? '#ffb020' : 'rgba(255,140,26,0.55)';
      mctx.lineWidth = i === nextRing ? 3 : 2;
      mctx.stroke();
    });
    // Plane triangle, rotated by heading.
    const [px, py] = toMap(flight.position.x, flight.position.z);
    mctx.save();
    mctx.translate(px, py);
    mctx.rotate((flight.heading * Math.PI) / 180);
    mctx.fillStyle = '#ffffff';
    mctx.beginPath();
    mctx.moveTo(0, -9);
    mctx.lineTo(6, 7);
    mctx.lineTo(0, 3);
    mctx.lineTo(-6, 7);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
  }

  return {
    showMessage(text, ms) {
      refs.message.textContent = text;
      refs.message.classList.add('show');
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = setTimeout(() => refs.message.classList.remove('show'), ms || 2600);
    },
    setWarning(text) {
      if (text) {
        refs.warning.textContent = text;
        refs.warning.classList.add('show');
      } else {
        refs.warning.classList.remove('show');
      }
    },
    setPhase(text) {
      refs.phase.textContent = text;
    },
    setFps(fps) {
      lastFps = fps;
      refs.fps.textContent = `${Math.round(fps)} FPS`;
    },
    update(flight, mission, dt) {
      const k = 1 - Math.exp(-dt * 6);
      smooth.speed += (flight.speed * 1.944 - smooth.speed) * k;
      smooth.alt += (flight.position.y * 3.281 - smooth.alt) * k;
      smooth.vsi += (flight.verticalSpeed * 196.85 - smooth.vsi) * k;
      smooth.heading = lerpAngle(smooth.heading, flight.heading, k);
      smooth.pitch += (flight.pitch - smooth.pitch) * k;
      smooth.roll += (flight.roll - smooth.roll) * k;
      smooth.throttle += (flight.throttle - smooth.throttle) * k;

      refs.speed.textContent = pad(Math.max(0, Math.round(smooth.speed)), 3);
      refs.altitude.textContent = pad(Math.max(0, Math.round(smooth.alt)), 5);
      refs.vspeed.textContent = `${smooth.vsi >= 0 ? '+' : ''}${Math.round(smooth.vsi)}`;
      const hdg = Math.round(((smooth.heading % 360) + 360) % 360);
      refs.headingDigital.textContent = `${pad(hdg, 3)}° ${headingName(hdg)}`;
      refs.headingTape.style.transform = `translateX(${160 - (smooth.heading + 360) * 3}px)`;

      refs.throttleFill.style.width = `${Math.round(smooth.throttle * 100)}%`;
      refs.throttleText.textContent = `${Math.round(smooth.throttle * 100)}%`;
      const fuelPct = Math.max(0, (mission.fuel / FUEL_MAX) * 100);
      refs.fuelFill.style.width = `${fuelPct}%`;
      refs.fuelText.textContent = `${Math.max(0, Math.round(fuelPct))}%`;
      refs.fuelFill.classList.toggle('low', mission.fuel < 20);
      refs.damageFill.style.width = `${mission.damage}%`;
      refs.rings.textContent = `RING ${mission.ringsPassed} / ${mission.ringsTotal}`;
      const next = mission.nextRing;
      refs.ringDist.textContent = next
        ? `${next.def.name} · ${Math.round(next.distance)} m`
        : 'KEMBALI KE RUNWAY';
      const elapsed = Math.max(0, mission.elapsed);
      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
      refs.timer.textContent = `${mm}:${ss}`;
      refs.score.textContent = String(mission.score).padStart(5, '0');

      // Warnings, most urgent first.
      if (mission.phase === 'crashed') this.setWarning('');
      else if (mission.fuel <= 0) this.setWarning('FUEL HABIS');
      else if (flight.speed < 26 && !flight.onGround) this.setWarning('STALL — TURUNKAN HIDUNG, TAMBAH THROTTLE');
      else if (mission.fuel < 20) this.setWarning('LOW FUEL');
      else if (flight.position.y - groundHeightAt(flight.position.x, flight.position.z) < 35
        && flight.verticalSpeed < -4) this.setWarning('PULL UP');
      else if (!flight.gearDown && flight.onGround === false
        && flight.position.y - groundHeightAt(flight.position.x, flight.position.z) < 60) this.setWarning('GEAR UP — TEKAN G UNTUK LANDING');
      else this.setWarning('');

      drawHorizon(smooth.pitch, smooth.roll);
      drawMinimap(flight, mission.ringStates, mission.nextRingIndex);
    },
  };
}
