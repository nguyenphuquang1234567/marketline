const ROOM_SIZE = 343;
const TAU = Math.PI * 2;
const MAX_VOICES = 36;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PROFILES = {
  asphalt: { band: 960, grit: 2200, body: 76, decay: 0.09 },
  concrete: { band: 1150, grit: 2800, body: 86, decay: 0.081 },
  wood: { band: 720, grit: 1720, body: 120, decay: 0.085, ring: [292, 477, 836] },
  metal: { band: 1900, grit: 4700, body: 140, decay: 0.11, ring: [890, 1580, 2720] },
  glass: { band: 2500, grit: 6300, body: 164, decay: 0.076, ring: [1840, 2670, 3910] },
  brick: { band: 970, grit: 2400, body: 97, decay: 0.109 },
  dirt: { band: 630, grit: 1380, body: 72, decay: 0.11 },
  sand: { band: 625, grit: 1540, body: 70, decay: 0.099 },
  rubble: { band: 1100, grit: 3000, body: 79, decay: 0.12, ring: [560, 1260] },
  fabric: { band: 540, grit: 1120, body: 69, decay: 0.064 },
  tile: { band: 1650, grit: 3860, body: 103, decay: 0.079, ring: [1170, 2230] },
};

function noiseSeed(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function noiseBuffers(context, random) {
  const buffers = {};
  const seconds = 2;
  const length = Math.ceil(seconds * context.sampleRate);
  const white = context.createBuffer(1, length, context.sampleRate);
  const pink = context.createBuffer(1, length, context.sampleRate);
  const brown = context.createBuffer(1, length, context.sampleRate);
  const a = white.getChannelData(0);
  const b = pink.getChannelData(0);
  const c = brown.getChannelData(0);
  let p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0, p6 = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const sample = random() * 2 - 1;
    a[i] = sample;
    p0 = 0.99886 * p0 + sample * 0.0555179;
    p1 = 0.99332 * p1 + sample * 0.0750759;
    p2 = 0.969 * p2 + sample * 0.153852;
    p3 = 0.8665 * p3 + sample * 0.3104856;
    p4 = 0.55 * p4 + sample * 0.5329522;
    p5 = -0.7616 * p5 - sample * 0.016898;
    b[i] = (p0 + p1 + p2 + p3 + p4 + p5 + p6 + sample * 0.5362) * 0.115;
    p6 = sample * 0.115926;
    last = (last + 0.023 * sample) / 1.023;
    c[i] = last * 2.9;
  }
  buffers.white = white;
  buffers.pink = pink;
  buffers.brown = brown;
  return buffers;
}

function loopBuffer(context, source) {
  const samples = source.getChannelData(0);
  const crossfade = Math.round(context.sampleRate * 0.045);
  const length = samples.length - crossfade;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const wave = buffer.getChannelData(0);
  wave.set(samples.subarray(0, length));
  for (let i = 0; i < crossfade; i++) {
    const blend = i / crossfade;
    wave[i] = samples[i] * blend + samples[length + i] * (1 - blend);
  }
  return buffer;
}

function response(context, random, outside) {
  const sampleRate = context.sampleRate;
  const length = Math.ceil(sampleRate * (outside ? 1.22 : 0.76));
  const buffer = context.createBuffer(2, length, sampleRate);
  const taps = outside ? [[0.039, 0.32], [0.082, 0.21], [0.153, 0.11]]
    : [[0.013, 0.56], [0.021, 0.36], [0.035, 0.25], [0.055, 0.17]];
  for (let channel = 0; channel < 2; channel++) {
    const wave = buffer.getChannelData(channel);
    let low = 0;
    for (let i = Math.round(sampleRate * 0.015); i < length; i++) {
      const value = random() * 2 - 1;
      low = low * 0.78 + value * 0.22;
      const t = i / sampleRate;
      wave[i] = (value * 0.31 + low * 0.6) * Math.exp(-t * (outside ? 5.2 : 7.8))
        * Math.min(1, t / 0.08) * (outside ? 0.022 : 0.039);
    }
    for (const [delay, level] of taps) {
      const frame = Math.round(sampleRate * (delay + channel * (0.001 + random() * 0.004)));
      for (let n = 0; n < 22; n++) {
        wave[frame + n] += (random() * 2 - 1) * level * (1 - n / 22);
      }
    }
  }
  return buffer;
}

function setEnvelope(param, t, level, attack, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export class SynthAudio {
  constructor(seed = 2324) {
    this.random = noiseSeed(seed ^ 0xb22ab341);
    this.context = null;
    this.active = new Set();
    this.ambience = [];
    this.position = { x: 0, y: 0, z: 0 };
    this.masterVolume = 0.74;
    this.nextHeart = 0;
    this.nextAir = 0;
    this.nextStreetSound = 8;
    this.streetSource = { x: 0, y: 0, z: 0 };
    this.profileOpen = 1;
    this.filterHealth = 100;
    this.suspended = false;
  }

  get voices() {
    return this.active.size;
  }

  async unlock() {
    if (!this.context) {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      this.context = new Audio({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.context.state !== 'running') await this.context.resume().catch(() => {});
  }

  build() {
    const c = this.context;
    this.noises = noiseBuffers(c, this.random);
    this.master = c.createGain();
    this.master.gain.value = this.masterVolume;
    this.lowHealth = c.createBiquadFilter();
    this.lowHealth.type = 'lowpass';
    this.lowHealth.frequency.value = 22000;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 9;
    this.limiter.ratio.value = 11;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.13;
    const softClip = c.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = i / (curve.length - 1) * 2 - 1;
      curve[i] = Math.tanh(x * 1.04);
    }
    softClip.curve = curve;
    softClip.oversample = '2x';
    this.limiter.connect(softClip).connect(this.master).connect(c.destination);
    this.lowHealth.connect(this.limiter);
    this.buses = {};
    for (const [name, level] of Object.entries({
      weapon: 0.96, impact: 0.68, foot: 0.73, character: 0.57, environment: 0.57, ui: 0.51, reverb: 0.49,
    })) {
      const bus = c.createGain();
      bus.gain.value = level;
      const isWeapon = name === 'weapon';
      const eq = c.createBiquadFilter();
      eq.type = name === 'environment' ? 'lowpass' : 'highpass';
      eq.frequency.value = name === 'environment' ? 3300 : isWeapon ? 43 : 62;
      const compression = c.createDynamicsCompressor();
      compression.threshold.value = isWeapon ? -14 : -19;
      compression.ratio.value = isWeapon ? 3 : 2;
      compression.knee.value = 14;
      compression.attack.value = 0.002;
      compression.release.value = 0.16;
      bus.connect(eq).connect(compression).connect(name === 'ui' ? this.limiter : this.lowHealth);
      this.buses[name] = bus;
    }
    this.reverbIn = c.createGain();
    this.reverbs = [];
    for (const outside of [false, true]) {
      const convolution = c.createConvolver();
      convolution.buffer = response(c, this.random, outside);
      const lowpass = c.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = outside ? 3750 : 5650;
      const level = c.createGain();
      level.gain.value = outside ? 0.68 : 0.08;
      this.reverbIn.connect(convolution).connect(lowpass).connect(level).connect(this.buses.reverb);
      this.reverbs.push(level);
    }

    this.ambient(c);
  }

  ambient(c) {
    const wind = c.createBufferSource();
    wind.buffer = loopBuffer(c, this.noises.pink);
    wind.loop = true;
    const soften = c.createBiquadFilter();
    soften.type = 'bandpass';
    soften.frequency.value = 490;
    soften.Q.value = 0.49;
    const windLevel = c.createGain();
    windLevel.gain.value = 0.086;
    this.windGain = windLevel;
    wind.connect(soften).connect(windLevel).connect(this.buses.environment);
    const wave = c.createOscillator();
    wave.frequency.value = 0.19;
    const gust = c.createGain();
    gust.gain.value = 0.048;
    wave.connect(gust).connect(windLevel.gain);
    const sweep = c.createGain();
    sweep.gain.value = 166;
    wave.connect(sweep).connect(soften.frequency);
    const city = c.createBufferSource();
    city.buffer = loopBuffer(c, this.noises.brown);
    city.loop = true;
    city.playbackRate.value = 0.72;
    const rumble = c.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 116;
    const cityLevel = c.createGain();
    cityLevel.gain.value = 0.065;
    city.connect(rumble).connect(cityLevel).connect(this.buses.environment);
    wind.start(c.currentTime, 0.42);
    wave.start();
    city.start(c.currentTime, 0.88);
    this.ambience.push(wind, wave, city);
  }

  volume(value) {
    this.masterVolume = clamp(Number(value) || 0, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.masterVolume, this.context.currentTime, 0.035);
  }

  setSpace(openness) {
    this.profileOpen = clamp(openness, 0, 1);
    if (!this.reverbs) return;
    const t = this.context.currentTime;
    this.reverbs[0].gain.setTargetAtTime(0.72 - this.profileOpen * 0.64, t, 0.3);
    this.reverbs[1].gain.setTargetAtTime(0.10 + this.profileOpen * 0.58, t, 0.3);
    this.windGain.gain.setTargetAtTime(0.038 + this.profileOpen * 0.048, t, 0.6);
  }

  pause(value) {
    this.suspended = value;
    if (!this.context) return;
    this.buses.environment.gain.setTargetAtTime(value ? 0.18 : 0.57, this.context.currentTime, 0.1);
  }

  listener(position, forward, up, health = 100) {
    this.position.x = position.x;
    this.position.y = position.y;
    this.position.z = position.z;
    if (!this.context) return;
    const { listener, currentTime: t } = this.context;
    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up?.x ?? 0;
      listener.upY.value = up?.y ?? 1;
      listener.upZ.value = up?.z ?? 0;
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up?.x ?? 0, up?.y ?? 1, up?.z ?? 0);
    }
    if (Math.abs(health - this.filterHealth) >= 2) {
      const focus = clamp((health - 7) / 52, 0, 1);
      const cutoff = health <= 0 ? 920 : 1650 * Math.pow(13, focus);
      this.lowHealth.frequency.setTargetAtTime(cutoff, t, health < this.filterHealth ? 0.075 : 0.26);
      this.filterHealth = health;
    }
    if (!this.suspended && this.profileOpen > 0.40 && t > this.nextStreetSound) {
      this.streetSound();
      this.nextStreetSound = t + 9 + this.random() * 11;
    }
    if (health > 0 && health < 32 && !this.suspended) {
      const strength = (32 - health) / 32;
      if (t > this.nextHeart) {
        const beat = this.start('character');
        if (beat) {
          this.tone(beat, 46, 35, 0.11 + strength * 0.12, 0.007, 0.12);
          this.tone(beat, 54, 42, 0.08 + strength * 0.055, 0.006, 0.092, 0.122);
        }
        this.nextHeart = t + 0.91 - strength * 0.35;
      }
      if (t > this.nextAir) {
        const breath = this.start('character');
        if (breath) {
          this.noise(breath, 'pink', 710, 0.51, 0.1 + strength * 0.1, 0.095, 0.46);
          this.noise(breath, 'pink', 980, 0.52, 0.07 + strength * 0.08, 0.2, 0.61, 0.58);
        }
        this.nextAir = t + 2.25 - strength * 0.61;
      }
    }
  }

  start(bus, position, occluded = false, reverb = 0.14, priority = false) {
    const c = this.context;
    if (!c || c.state !== 'running' || this.masterVolume === 0) return null;
    const distance = position ? Math.hypot(
      position.x - this.position.x, position.y - this.position.y, position.z - this.position.z,
    ) : 0;
    if (distance > 150) return null;
    if (this.active.size >= MAX_VOICES) {
      if (distance > 40 && !priority) return null;
      for (const oldest of this.active) {
        if (oldest.priority && !priority) continue;
        this.stopVoice(oldest, true);
        break;
      }
      if (this.active.size >= MAX_VOICES) return null;
    }
    const voice = {
      t: c.currentTime + 0.003 + Math.min(0.46, distance / ROOM_SIZE),
      distance,
      nodes: [],
      sources: [],
      live: 0,
      priority,
    };
    const input = c.createGain();
    voice.input = input;
    voice.nodes.push(input);
    if (position) {
      const panner = c.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = bus === 'weapon' ? 10 : bus === 'foot' ? 2.0 : 4.0;
      panner.rolloffFactor = 1.03;
      panner.maxDistance = 155;
      if (panner.positionX) {
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
      } else {
        panner.setPosition(position.x, position.y, position.z);
      }
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = (occluded ? 1480 : 15800) / (1 + distance * (occluded ? 0.018 : 0.037));
      filter.Q.value = 0.54;
      input.gain.value = occluded ? 0.47 : 1;
      input.connect(filter).connect(panner).connect(this.buses[bus]);
      voice.nodes.push(filter, panner);
    } else {
      input.connect(this.buses[bus]);
    }

    if (reverb > 0) {
      const send = c.createGain();
      send.gain.value = (reverb + Math.min(0.1, distance * 0.002)) * (occluded ? 0.83 : 1) / (1 + distance * 0.041);
      input.connect(send).connect(this.reverbIn);
      voice.nodes.push(send);
    }
    this.active.add(voice);
    return voice;
  }

  source(voice, source, t, end, offset) {
    voice.sources.push(source);
    voice.nodes.push(source);
    voice.live++;
    source.onended = () => {
      if (--voice.live === 0) this.stopVoice(voice);
    };
    if (offset === undefined) source.start(t);
    else source.start(t, offset);
    source.stop(end);
  }

  stopVoice(voice, truncate = false) {
    if (!this.active.delete(voice)) return;
    for (const source of voice.sources) {
      source.onended = null;
      if (truncate) {
        try { source.stop(); } catch {}
      }
    }
    for (const node of voice.nodes) node.disconnect();
  }

  noise(voice, type, frequency, q, gain, attack, decay, offset = 0, filterType = 'bandpass', rate = 1) {
    const c = this.context;
    const t = voice.t + offset;
    const source = c.createBufferSource();
    source.buffer = this.noises[type];
    source.playbackRate.value = rate;
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = clamp(frequency, 24, c.sampleRate * 0.44);
    filter.Q.value = q;
    const envelope = c.createGain();
    setEnvelope(envelope.gain, t, gain, attack, decay);
    source.connect(filter).connect(envelope).connect(voice.input);
    voice.nodes.push(filter, envelope);
    this.source(voice, source, t, t + attack + decay + 0.012, this.random() * 0.8);
  }

  tone(voice, frequency, endFrequency, gain, attack, decay, offset = 0, type = 'sine') {
    const c = this.context;
    const t = voice.t + offset;
    const source = c.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(frequency, t);
    source.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), t + attack + decay);
    const envelope = c.createGain();
    setEnvelope(envelope.gain, t, gain, attack, decay);
    source.connect(envelope).connect(voice.input);
    voice.nodes.push(envelope);
    this.source(voice, source, t, t + attack + decay + 0.012);
  }

  streetSound() {
    const bird = this.random() > 0.55;
    const angle = this.random() * TAU;
    const distance = bird ? 20 + this.random() * 20 : 7 + this.random() * 10;
    this.streetSource.x = this.position.x + Math.cos(angle) * distance;
    this.streetSource.y = this.position.y + (bird ? 6 : 2.4);
    this.streetSource.z = this.position.z + Math.sin(angle) * distance;
    const voice = this.start('environment', this.streetSource, false, 0.19);
    if (!voice) return;
    if (bird) {
      const base = 1840 + this.random() * 570;
      const wait = 0.14 + this.random() * 0.09;
      this.tone(voice, base * 0.88, base * 1.10, 0.12, 0.017, 0.081);
      this.tone(voice, base * 1.15, base * 0.97, 0.087, 0.016, 0.095, wait);
    } else {
      this.noise(voice, 'pink', 530, 0.51, 0.20, 0.06, 0.18);
      this.noise(voice, 'pink', 1160, 0.91, 0.17, 0.008, 0.067, 0.094);
      this.noise(voice, 'pink', 520, 0.59, 0.16, 0.035, 0.128, 0.193);
    }
  }

  gun(position, occluded = false) {
    const voice = this.start('weapon', position, occluded, position ? 0.24 : 0.12, !position);
    if (!voice) return;
    const r = 0.88 + this.random() * 0.26;
    const near = 1 - clamp(voice.distance / 38, 0, 0.9);
    const mechanical = 0.3 + near * 0.7;
    this.noise(voice, 'white', 4770 * r, 0.62, 0.49 * near, 0.00045, 0.028, 0, 'highpass', r);
    this.noise(voice, 'white', 1600 * r, 0.53, 0.78, 0.0008, 0.075 + (1 - near) * 0.043);
    this.noise(voice, 'pink', 520 * r, 0.62, 0.64, 0.0017, 0.137 + (1 - near) * 0.055);
    this.tone(voice, 109 * r, 44 * r, 0.40, 0.0016, 0.14, 0.001);
    this.noise(voice, 'pink', 2700 * r, 0.62, 0.31 * near, 0.003, 0.19, 0.018, 'lowpass');
    if (near > 0.32) {
      this.noise(voice, 'white', 3070 * r, 0.91, 0.18 * mechanical, 0.0004, 0.022, 0.044 + this.random() * 0.005);
      this.tone(voice, 331 * r, 246 * r, 0.074 * mechanical, 0.0011, 0.026, 0.048, 'triangle');
    }
  }

  impact(material, position, occluded = false) {
    const p = PROFILES[material] || PROFILES.concrete;
    const voice = this.start('impact', position, occluded, 0.115);
    if (!voice) return;
    const variation = 0.81 + this.random() * 0.36;
    this.noise(voice, 'white', p.grit * variation, 0.8, 0.29, 0.0005, p.decay * 0.7);
    this.noise(voice, 'pink', p.band * variation, 0.64, 0.32, 0.0012, p.decay * 1.2, 0.001);
    if (p.ring) p.ring.forEach((frequency, i) => {
      this.tone(voice, frequency * variation, frequency * variation * 0.985,
        0.14 / (i + 1), 0.0007, 0.17 / (i * 0.6 + 1), i * 0.0015);
    });
    if (material === 'concrete' || material === 'brick' || material === 'rubble') {
      for (let i = 0; i < 2; i++) {
        this.noise(voice, 'white', p.grit * (0.7 + this.random() * 0.3), 1.7,
          0.10, 0.0013, 0.016, 0.021 + this.random() * 0.055);
      }
    }
  }

  footstep(material, position, intensity = 1, occluded = false) {
    const p = PROFILES[material] || PROFILES.asphalt;
    const voice = this.start('foot', position, occluded, position ? 0.09 : 0.045);
    if (!voice) return;
    const variation = 0.86 + this.random() * 0.29;
    const level = clamp(intensity, 0.18, 1.7) * (position ? 0.86 : 1);
    this.noise(voice, 'pink', p.band * variation, 0.57, 0.33 * level, 0.007, p.decay);
    this.noise(voice, 'white', p.grit * variation, 0.78, 0.13 * level, 0.009, p.decay * 0.72, 0.019);
    this.tone(voice, p.body * variation, p.body * 0.68, 0.17 * level, 0.005, 0.071);
    if (p.ring) this.tone(voice, p.ring[0] * variation, p.ring[0] * 0.96,
      0.066 * level, 0.0018, p.decay * 1.4, 0.0022);
    if (!position && intensity > 0.8) {
      this.noise(voice, 'pink', 1320 * variation, 1.05, 0.069, 0.021, 0.083, 0.05);
    }
  }

  casing(material, position, velocity = 1) {
    const voice = this.start('impact', position, false, 0.08);
    if (!voice) return;
    const level = clamp(Math.abs(velocity) / 5, 0.12, 1);
    const pitch = 0.89 + this.random() * 0.35;
    const muted = ['fabric', 'dirt', 'sand'].includes(material) ? 0.28 : 1;
    this.tone(voice, 2430 * pitch, 2290 * pitch, 0.14 * level * muted, 0.0006, 0.074);
    this.tone(voice, 3880 * pitch, 3610 * pitch, 0.077 * level * muted, 0.0007, 0.043);
    this.noise(voice, 'white', 2570, 0.85, 0.064 * level, 0.0012, 0.024);
  }

  mechanical(kind) {
    const voice = this.start('weapon', undefined, false, 0.024, true);
    if (!voice) return;
    const r = 0.86 + this.random() * 0.24;
    if (kind === 'empty' || kind === 'release') {
      this.noise(voice, 'white', 2760 * r, 0.77, 0.19, 0.00055, 0.034);
      this.tone(voice, 330 * r, 229 * r, 0.115, 0.0009, 0.026, 0, 'triangle');
    } else if (kind === 'bolt' || kind === 'charge') {
      this.noise(voice, 'white', 2240 * r, 0.73, 0.23, 0.009, 0.08);
      this.noise(voice, 'pink', 1430 * r, 0.92, 0.4, 0.0008, 0.057, 0.092);
      this.tone(voice, 243 * r, 140 * r, 0.16, 0.0006, 0.075, 0.094, 'triangle');
    } else if (kind === 'mag' || kind === 'reload') {
      this.noise(voice, 'pink', 970 * r, 0.71, 0.24, 0.016, 0.09);
      this.noise(voice, 'white', 2670 * r, 0.84, 0.29, 0.0007, 0.06, 0.068);
      this.tone(voice, 202 * r, 133 * r, 0.22, 0.0014, 0.078, 0.064);
    } else if (kind === 'throw' || kind === 'mantle' || kind === 'inspect') {
      this.noise(voice, 'pink', 1410 * r, 0.53, 0.24, 0.018, 0.16);
      this.noise(voice, 'white', 2740 * r, 1.2, 0.11, 0.0009, 0.047, 0.105);
    } else {
      this.noise(voice, 'pink', 1180 * r, 0.67, 0.17, 0.006, 0.10);
      this.noise(voice, 'white', 2620 * r, 0.82, 0.09, 0.001, 0.052, 0.025);
    }
  }

  blast(position, occluded = false, tactical = false) {
    const voice = this.start('weapon', position, occluded, 0.37, true);
    if (!voice) return;
    const r = 0.86 + this.random() * 0.24;
    const punch = tactical ? 0.47 : 1;
    this.noise(voice, 'white', 2750 * r, 0.59, 0.96 * punch, 0.0015, 0.12);
    this.noise(voice, 'pink', 583 * r, 0.51, 0.87 * punch, 0.003, 0.32);
    this.noise(voice, 'brown', 127 * r, 0.73, 0.75 * punch, 0.004, 0.59, 0.006, 'lowpass');
    this.tone(voice, 79 * r, 26 * r, 0.56 * punch, 0.004, 0.30, 0.003);
    if (tactical) this.noise(voice, 'pink', 2080, 0.77, 0.34, 0.045, 0.7, 0.08);
  }

  whiz(position) {
    const voice = this.start('impact', position, false, 0.07);
    if (!voice) return;
    const pitch = 0.83 + this.random() * 0.29;
    this.noise(voice, 'white', 2650 * pitch, 1.6, 0.29, 0.004, 0.082);
    this.tone(voice, 1830 * pitch, 414 * pitch, 0.12, 0.004, 0.097, 0.001, 'triangle');
  }

  cue(kind) {
    const voice = this.start('ui', undefined, false, 0, true);
    if (!voice) return;
    switch (kind) {
      case 'head':
      case 'headshot':
        this.tone(voice, 1200, 760, 0.29, 0.0018, 0.078, 0, 'triangle');
        this.tone(voice, 1770, 1160, 0.16, 0.0011, 0.091, 0.013);
        break;
      case 'kill':
      case 'elimination':
      case 'score':
        this.tone(voice, 478, 448, 0.29, 0.008, 0.13, 0, 'triangle');
        this.tone(voice, 714, 690, 0.18, 0.007, 0.20, 0.062);
        break;
      case 'start':
      case 'end':
        this.tone(voice, 178, 168, 0.30, 0.025, 0.45, 0, 'triangle');
        this.tone(voice, 266, 261, 0.20, 0.026, 0.48, 0.105);
        this.tone(voice, kind === 'end' ? 321 : 389, kind === 'end' ? 314 : 380,
          0.13, 0.028, 0.61, 0.23);
        break;
      case 'damage':
        this.tone(voice, 80, 42, 0.20, 0.004, 0.16);
        this.noise(voice, 'pink', 620, 0.58, 0.1, 0.006, 0.15);
        break;
      case 'hit':
        this.noise(voice, 'white', 2670, 2, 0.18, 0.0004, 0.035);
        this.tone(voice, 802, 594, 0.15, 0.0008, 0.045, 0, 'triangle');
        break;
      default:
        this.tone(voice, kind === 'hover' ? 520 : 740, 472, 0.13, 0.001, 0.044);
    }
  }

  dispose() {
    for (const voice of this.active) this.stopVoice(voice, true);
    for (const node of this.ambience) {
      node.stop();
      node.disconnect();
    }
    this.ambience.length = 0;
    const c = this.context;
    this.context = null;
    return c?.close();
  }
}
