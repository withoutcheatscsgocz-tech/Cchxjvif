/*
 * Synthesised sound. No audio files: everything is oscillators and noise.
 * The low "flow" drone follows how fast game time is moving, so the building
 * goes silent the moment you lift your finger.
 */
(function (root) {
  'use strict';

  let ac = null;
  let master = null;
  let flowGain = null;
  let flowFilter = null;
  let noiseBuf = null;
  let enabled = true;

  function unlock() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return;
    }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
    } catch (e) {
      ac = null;
      return;
    }
    master = ac.createGain();
    master.gain.value = enabled ? 0.8 : 0;
    master.connect(ac.destination);

    flowFilter = ac.createBiquadFilter();
    flowFilter.type = 'lowpass';
    flowFilter.frequency.value = 300;
    flowFilter.Q.value = 7;
    flowGain = ac.createGain();
    flowGain.gain.value = 0;
    [55, 55.7, 82.4].forEach((f) => {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(flowFilter);
      o.start();
    });
    flowFilter.connect(flowGain);
    flowGain.connect(master);

    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  function tone(freq, dur, opt) {
    if (!ac || !enabled) return;
    const o = Object.assign({ type: 'square', vol: 0.08, slide: 0, delay: 0, attack: 0.004 }, opt);
    const t0 = ac.currentTime + o.delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol, t0 + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, freq, delay) {
    if (!ac || !enabled) return;
    const t0 = ac.currentTime + (delay || 0);
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  const Sfx = {
    unlock,
    /* Silence everything while the page is hidden; the next touch resumes it. */
    suspend() {
      if (ac && ac.state === 'running') ac.suspend().catch(() => {});
    },
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (ac) master.gain.setTargetAtTime(on ? 0.8 : 0, ac.currentTime, 0.02);
    },
    /* rate = game-seconds per real second, 0 when frozen */
    flow(rate) {
      if (!ac) return;
      const r = Math.min(1.6, rate);
      flowGain.gain.setTargetAtTime(Math.min(1, r) * 0.05, ac.currentTime, 0.05);
      flowFilter.frequency.setTargetAtTime(240 + r * 420, ac.currentTime, 0.08);
    },
    step(alt) {
      noise(0.035, 0.07, alt ? 2100 : 1500);
    },
    tick(alt) {
      tone(alt ? 1568 : 1175, 0.035, { vol: 0.022 });
    },
    grab() {
      tone(988, 0.09, { type: 'triangle', vol: 0.12 });
      tone(1319, 0.1, { type: 'triangle', vol: 0.12, delay: 0.06 });
      tone(1976, 0.2, { type: 'triangle', vol: 0.09, delay: 0.12 });
    },
    gem() {
      [1319, 1760, 2349, 2637].forEach((f, i) => tone(f, 0.18, { type: 'sine', vol: 0.09, delay: i * 0.05 }));
    },
    open() {
      tone(523, 0.16, { type: 'triangle', vol: 0.1 });
      tone(784, 0.3, { type: 'triangle', vol: 0.1, delay: 0.1 });
    },
    spotted() {
      tone(1400, 0.12, { vol: 0.05, slide: 1.35 });
    },
    busted() {
      tone(440, 0.55, { type: 'sawtooth', vol: 0.13, slide: 0.25 });
      tone(466, 0.55, { type: 'square', vol: 0.06, slide: 0.25 });
      noise(0.35, 0.18, 700);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, { type: 'triangle', vol: 0.08, delay: i * 0.07 }));
    },
    word() {
      noise(0.08, 0.12, 300);
      tone(110, 0.12, { type: 'sine', vol: 0.18, slide: 0.5 });
    },
  };

  root.Sfx = Sfx;
})(window);
