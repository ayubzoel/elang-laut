// Synthesised sound for Elang Laut: no audio files, everything is built with
// the Web Audio API after the first click. Engine drone follows the throttle,
// wind follows speed, and events get their own small cues.

export function createAudio() {
  let ctx = null;
  let engineOsc1 = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let windGain = null;
  let muted = false;
  let lowFuelBeepAt = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    } catch (e) {
      return false;
    }
    // Engine: two detuned saws through a lowpass, like a prop at work.
    engineOsc1 = ctx.createOscillator();
    engineOsc1.type = 'sawtooth';
    engineOsc1.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 82;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc1.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engineOsc1.start();
    engineOsc2.start();
    // Wind: looped noise through a bandpass.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    noise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);
    noise.start();
    return true;
  }

  function tone(freq, dur, type, vol, when) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (when || 0);
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol || 0.22, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    setMuted(m) {
      muted = m;
      if (engineGain) engineGain.gain.value = m ? 0 : engineGain.gain.value;
    },
    isMuted() {
      return muted;
    },
    update(throttle, speedNorm, fuel, now) {
      if (!ctx || muted) return;
      const base = 42 + throttle * 38 + speedNorm * 22;
      engineOsc1.frequency.setTargetAtTime(base, ctx.currentTime, 0.08);
      engineOsc2.frequency.setTargetAtTime(base * 1.5, ctx.currentTime, 0.08);
      engineFilter.frequency.setTargetAtTime(320 + throttle * 700, ctx.currentTime, 0.1);
      engineGain.gain.setTargetAtTime(0.05 + throttle * 0.075, ctx.currentTime, 0.1);
      windGain.gain.setTargetAtTime(speedNorm * speedNorm * 0.12, ctx.currentTime, 0.15);
      // Low-fuel beep, once a second while it lasts.
      if (fuel > 0 && fuel < 20 && now - lowFuelBeepAt > 1000) {
        lowFuelBeepAt = now;
        tone(880, 0.12, 'square', 0.08);
      }
    },
    ring() {
      tone(660, 0.18, 'sine', 0.25);
      tone(990, 0.3, 'sine', 0.22, 0.09);
    },
    takeoff() {
      tone(523, 0.2, 'triangle', 0.2);
      tone(784, 0.3, 'triangle', 0.18, 0.1);
    },
    thud() {
      if (!ctx || muted) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    },
    crash() {
      if (!ctx || muted) return;
      const len = ctx.sampleRate * 0.7;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      src.connect(g);
      g.connect(ctx.destination);
      src.start();
      tone(70, 0.6, 'sawtooth', 0.3);
    },
    click() {
      tone(1200, 0.05, 'square', 0.06);
    },
  };
}
