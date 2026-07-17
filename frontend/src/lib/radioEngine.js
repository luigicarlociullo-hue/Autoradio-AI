// Radio Engine — orchestrates browser TTS (Web Speech API) + procedural
// ambient music (Web Audio API) so the prototype actually plays sound
// without any paid TTS / music API.

class RadioEngine {
  constructor() {
    this.synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    this.audioCtx = null;
    this.currentMusicNodes = null;
    this.onSegmentEnd = null;
    this.onProgress = null;
    this.currentUtterance = null;
    this.isPaused = false;
    this.currentKind = null;
  }

  ensureAudioCtx() {
    if (!this.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.audioCtx = new AC();
    }
    if (this.audioCtx?.state === "suspended") this.audioCtx.resume();
    // Ensure a shared analyser + output bus
    if (this.audioCtx && !this.outputBus) {
      // Output chain: source → outputBus (master gain 2.4) → compressor → analyser → destination
      // Web Audio permette gain > 1.0 (a differenza di HTMLAudio.volume che è capped a 1.0),
      // così il volume finale è realmente più alto anche a max volume dispositivo.
      this.outputBus = this.audioCtx.createGain();
      this.outputBus.gain.value = 2.4;
      // Compressor per evitare clipping quando il gain sale
      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 8;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      this.outputBus.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  getAnalyser() {
    return this.analyser || null;
  }

  getFakeAmplitude() {
    // Used by visualizer when speaking via Web Speech (no analyser access)
    if (!this.synth) return 0;
    return this.synth.speaking ? 0.55 + Math.random() * 0.4 : 0;
  }

  pickVoice(voiceKey) {
    if (!this.synth) return null;
    const voices = this.synth.getVoices();
    if (!voices?.length) return null;
    const italian = voices.filter(v => v.lang?.toLowerCase().startsWith("it"));
    const pool = italian.length ? italian : voices;
    const map = {
      "female-1": pool.find(v => /female|donna|elsa|alice|federica/i.test(v.name)) || pool[0],
      "female-2": pool.find(v => /female|carla|chiara|luisa/i.test(v.name)) || pool[Math.min(1, pool.length-1)],
      "male-1":   pool.find(v => /male|uomo|luca|marco|paolo|alessio/i.test(v.name)) || pool[Math.min(2, pool.length-1)],
      "male-2":   pool.find(v => /male|giorgio|roberto/i.test(v.name)) || pool[Math.min(3, pool.length-1)],
    };
    return map[voiceKey] || pool[0];
  }

  speak(text, voiceKey, { rate = 1.02, pitch = 1.0 } = {}) {
    return new Promise((resolve) => {
      if (!this.synth || !text) return resolve();
      // safari trick: cancel prior queue
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT";
      const v = this.pickVoice(voiceKey);
      if (v) u.voice = v;
      u.rate = rate;
      u.pitch = pitch;
      u.onend = () => { this.currentUtterance = null; resolve(); };
      u.onerror = () => { this.currentUtterance = null; resolve(); };
      this.currentUtterance = u;
      this.synth.speak(u);
    });
  }

  stopSpeech() {
    if (this.synth) this.synth.cancel();
    this.currentUtterance = null;
  }

  // Procedural ambient music generator (algorithmic AI-invented music)
  startMusic({ genre = "electronic", durationSec = 30, seed = 0, bedGain = 0.16 } = {}) {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return () => {};
    const dest = this.outputBus || ctx.destination;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(dest);
    master.gain.linearRampToValueAtTime(bedGain, ctx.currentTime + 1.2);

    // Scale selection based on mood
    const scales = {
      "synthwave":   [220.00, 261.63, 311.13, 349.23, 415.30, 466.16],
      "jazz-hop":    [174.61, 196.00, 220.00, 233.08, 293.66, 349.23],
      "ambient":     [130.81, 164.81, 196.00, 246.94, 329.63, 392.00],
      "darkwave":    [110.00, 138.59, 164.81, 196.00, 233.08, 293.66],
      "electronic":  [196.00, 233.08, 293.66, 349.23, 392.00, 466.16],
      "default":     [174.61, 220.00, 261.63, 329.63, 392.00, 493.88],
    };
    const key = Object.keys(scales).find(k => genre?.toLowerCase().includes(k)) || "default";
    const notes = scales[key];

    // Pad layer (two detuned oscillators + lowpass)
    const pad = ctx.createGain(); pad.gain.value = 0.5; pad.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 4;
    pad.connect(lp); lp.connect(master);

    const oscA = ctx.createOscillator(); oscA.type = "sawtooth";
    const oscB = ctx.createOscillator(); oscB.type = "triangle";
    oscA.detune.value = -7; oscB.detune.value = 7;
    oscA.connect(pad); oscB.connect(pad);
    oscA.frequency.value = notes[0] / 2;
    oscB.frequency.value = notes[2] / 2;
    oscA.start(); oscB.start();

    // Arpeggio layer
    const arp = ctx.createGain(); arp.gain.value = 0.0; arp.connect(master);
    const arpOsc = ctx.createOscillator(); arpOsc.type = "square";
    arpOsc.connect(arp); arpOsc.start();

    let arpIndex = seed || 0;
    const tempoMs = 320;
    const arpInterval = setInterval(() => {
      const f = notes[arpIndex % notes.length];
      arpOsc.frequency.setValueAtTime(f, ctx.currentTime);
      arp.gain.cancelScheduledValues(ctx.currentTime);
      arp.gain.setValueAtTime(0.06, ctx.currentTime);
      arp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      arpIndex++;
    }, tempoMs);

    // Kick drum
    const kickInterval = setInterval(() => {
      const now = ctx.currentTime;
      const kick = ctx.createOscillator();
      const kg = ctx.createGain();
      kick.frequency.setValueAtTime(140, now);
      kick.frequency.exponentialRampToValueAtTime(45, now + 0.18);
      kg.gain.setValueAtTime(0.35, now);
      kg.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      kick.connect(kg); kg.connect(master);
      kick.start(now); kick.stop(now + 0.24);
    }, tempoMs * 2);

    // Chord progression (change pad root every 8 beats)
    let chordIdx = 0;
    const chordInterval = setInterval(() => {
      chordIdx = (chordIdx + 1) % 4;
      const roots = [notes[0], notes[2], notes[3], notes[1]];
      const now = ctx.currentTime;
      oscA.frequency.exponentialRampToValueAtTime(roots[chordIdx] / 2, now + 0.4);
      oscB.frequency.exponentialRampToValueAtTime(roots[(chordIdx + 2) % roots.length] / 2, now + 0.4);
    }, tempoMs * 8);

    const cleanup = () => {
      clearInterval(arpInterval);
      clearInterval(kickInterval);
      clearInterval(chordInterval);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.linearRampToValueAtTime(0, now + 0.8);
      setTimeout(() => {
        try { oscA.stop(); oscB.stop(); arpOsc.stop(); } catch(e){}
        try { master.disconnect(); } catch(e){}
      }, 1000);
    };
    this.currentMusicNodes = { cleanup };
    return cleanup;
  }

  stopMusic() {
    if (this.currentMusicNodes?.cleanup) this.currentMusicNodes.cleanup();
    this.currentMusicNodes = null;
  }

  async playAudioUrl(url) {
    return new Promise((resolve) => {
      if (!url) return resolve();
      try {
        const ctx = this.ensureAudioCtx();
        // Riusa l'elemento pre-caricato se presente in cache (buffering anticipato)
        // → nessun ritardo di rete quando il segmento diventa "corrente".
        let a = this._takePreloaded(url);
        if (!a) {
          a = new Audio(url);
          a.crossOrigin = "anonymous";
          a.preload = "auto";
        }
        // Explicit full element volume — the GainNode chain controls dynamics.
        a.volume = 1.0;
        this.currentAudio = a;
        // Route: source -> voiceGain(1.0) -> outputBus -> analyser -> destination
        if (!a._srcNode) {
          try {
            const src = ctx.createMediaElementSource(a);
            const voiceGain = ctx.createGain();
            voiceGain.gain.value = 1.0;
            src.connect(voiceGain);
            voiceGain.connect(this.outputBus);
            a._srcNode = src;
            a._voiceGain = voiceGain;
          } catch (e) {
            // Alcuni browser tirano un errore se createMediaElementSource è già stato
            // chiamato su questo elemento (es. dal preload). Fallback: usa volume nativo.
          }
        } else if (a._voiceGain) {
          // L'elemento è già collegato al grafo Web Audio dal preload — ripristina il gain.
          try { a._voiceGain.gain.value = 1.0; } catch (e) {}
        }
        a.onended = () => { this.currentAudio = null; resolve(); };
        a.onerror = () => { this.currentAudio = null; resolve(); };
        a.play().catch(() => { this.currentAudio = null; resolve(); });
      } catch (e) {
        resolve();
      }
    });
  }

  /**
   * Preload di un audio: crea l'elemento HTMLAudio (preload="auto") già collegato
   * al grafo Web Audio così quando arriva il momento di suonarlo non c'è latenza
   * di rete né di createMediaElementSource. Cache-limit: 4 elementi.
   */
  preloadUrl(url) {
    if (!url) return null;
    if (!this._preloadCache) this._preloadCache = new Map();
    if (this._preloadCache.has(url)) return this._preloadCache.get(url);
    try {
      const ctx = this.ensureAudioCtx();
      const a = new Audio(url);
      a.crossOrigin = "anonymous";
      a.preload = "auto";
      a.volume = 1.0;
      // Kick off the network fetch immediately
      try { a.load(); } catch (e) {}
      // Pre-collega al grafo Web Audio (createMediaElementSource va fatto UNA volta)
      try {
        const src = ctx.createMediaElementSource(a);
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0.0;   // muted finché non lo consumiamo
        src.connect(voiceGain);
        voiceGain.connect(this.outputBus);
        a._srcNode = src;
        a._voiceGain = voiceGain;
      } catch (e) { /* già connesso o non supportato */ }
      this._preloadCache.set(url, a);
      // Cache LRU: max 4
      if (this._preloadCache.size > 4) {
        const firstKey = this._preloadCache.keys().next().value;
        const old = this._preloadCache.get(firstKey);
        try { old.pause(); old.src = ""; } catch (e) {}
        try { old._srcNode && old._srcNode.disconnect(); } catch (e) {}
        try { old._voiceGain && old._voiceGain.disconnect(); } catch (e) {}
        this._preloadCache.delete(firstKey);
      }
      return a;
    } catch (e) {
      return null;
    }
  }

  _takePreloaded(url) {
    if (!url || !this._preloadCache) return null;
    const a = this._preloadCache.get(url);
    if (a) {
      this._preloadCache.delete(url);
      return a;
    }
    return null;
  }

  /**
   * Preload di un intero segmento: warma la rete su music_audio_url, speech_audio_url,
   * outro_speech_url e background_loop. Chiamare mentre il segmento PRECEDENTE è ancora
   * in riproduzione — così quando tocca a lui, la latenza è ~0.
   */
  preloadSegment(seg) {
    if (!seg) return;
    if (seg.music_audio_url) this.preloadUrl(seg.music_audio_url);
    if (seg.speech_audio_url) this.preloadUrl(seg.speech_audio_url);
    if (seg.outro_speech_url) this.preloadUrl(seg.outro_speech_url);
    // background_loop è usato in loop → non serve pre-cachare (viene creato con audio.loop=true)
  }

  stopAudio() {
    if (this.currentAudio) {
      try { this.currentAudio.pause(); this.currentAudio.src = ""; } catch (e) {}
      this.currentAudio = null;
    }
  }

  async playSegment(segment) {
    // Cleanup difensivo di ogni residuo del segmento precedente — nessuna sovrapposizione
    try { this.stopAudio(); } catch (e) {}
    try { this.stopSpeech(); } catch (e) {}
    if (Array.isArray(this._activeBedStoppers)) {
      for (const fn of this._activeBedStoppers) { try { fn(); } catch (e) {} }
    }
    this._activeBedStoppers = [];

    this.currentKind = segment.kind;
    // Music segment with real audio + optional pre-rendered intro/outro speech
    if (segment.kind === "music" && segment.music_audio_url) {
      return this._playMusicWithVoice(segment);
    }
    // News segment: sting inglese "News from the future" + bed continuo procedurale
    if (segment.kind === "news") {
      return this._playNewsSegment(segment);
    }
    // Ad spot: jingle assurdo + loop procedurale AD-only (mai canzoni)
    if (segment.kind === "ad_spot") {
      return this._playAdSpot(segment);
    }
    // Rubriche parlate (joke, weather, history, interview, motivation, horoscope, talk, jingle, ...)
    if (segment.speech_audio_url) {
      return this._playSpeechWithBed(segment);
    }
    // Fallback: browser Web Speech + procedural synth
    if (segment.kind === "music") {
      const dur = Math.min(segment.duration_sec || 40, 45);
      const stop = this.startMusic({
        genre: segment.track_meta?.genre || "electronic",
        durationSec: dur,
        seed: (segment.id || "").charCodeAt(0) || 0,
      });
      if (segment.script) await this.speak(segment.script, segment.voice_key, { rate: 1.08 });
      await new Promise(res => setTimeout(res, Math.max(4000, dur * 500)));
      stop();
    } else {
      const stopBed = this.startMusic(this._bedConfigFor(segment.kind));
      this._activeBedStoppers.push(stopBed);
      await this.speak(segment.script || segment.title || "", segment.voice_key, { rate: 1.06 });
      stopBed();
    }
  }

  /**
   * NEWS: sting inglese vocale "News from the future" (Web Speech en-US) + campana
   * discendente, poi bed strumentale procedurale continuo (news-desk style) sotto
   * tutta la lettura. Cleanup garantito.
   */
  async _playNewsSegment(segment) {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    // 1) Sting: campana + voce "News from the future"
    await this._newsSting();
    // 2) Bed procedurale in loop continuo (arpeggio minimale + hi-hat + pad)
    const stopBed = this._startProceduralAdBed("news");
    this._activeBedStoppers.push(stopBed);
    try {
      if (segment.speech_audio_url) {
        await this.playAudioUrl(segment.speech_audio_url);
      } else if (segment.script) {
        await this.speak(segment.script, segment.voice_key, { rate: 1.02 });
      }
    } finally {
      stopBed();
    }
  }

  async _newsSting() {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    const dest = this.outputBus || ctx.destination;
    const t0 = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 0.85;
    bus.connect(dest);
    const bell = (freq, dur, delay, gain = 0.4) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t0 + delay);
      g.gain.setValueAtTime(0.001, t0 + delay);
      g.gain.exponentialRampToValueAtTime(gain, t0 + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + dur);
      osc.connect(g); g.connect(bus);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + dur + 0.1);
    };
    // 3-note bell: E5 → B4 → E5
    bell(659, 0.4, 0, 0.45);
    bell(494, 0.55, 0.25, 0.4);
    bell(659, 0.75, 0.5, 0.35);
    // Voce in inglese "News from the future" (Web Speech, en-US)
    setTimeout(() => {
      try {
        if (window.speechSynthesis) {
          const u = new SpeechSynthesisUtterance("News from the future");
          u.lang = "en-US";
          u.rate = 0.95;
          u.pitch = 0.9;
          u.volume = 1.0;
          const voices = window.speechSynthesis.getVoices();
          const en = voices.find(v => v.lang && v.lang.toLowerCase().startsWith("en"));
          if (en) u.voice = en;
          window.speechSynthesis.speak(u);
        }
      } catch (e) {}
    }, 700);
    // Wait: 1.3s bells + 1.5s voice
    await new Promise(res => setTimeout(res, 2800));
    try { bus.disconnect(); } catch (e) {}
  }

  /**
   * Loop procedurale AD-BED dedicato — mai canzoni Suno, sempre generato dal browser.
   * Cambia pattern per ogni chiamata (rotazione 4 varianti). Ritorna una funzione stop().
   */
  _startProceduralAdBed(variantKey = "default") {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return () => {};
    const dest = this.outputBus || ctx.destination;
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(dest);
    // Fade-in
    master.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.6);

    // Rotazione varianti — ogni ad usa la successiva
    this._adBedIdx = ((this._adBedIdx || 0) + 1) % 4;
    const variant = variantKey === "news" ? "news" : ["retro", "cosmic", "playful", "noir"][this._adBedIdx];

    // Pattern params
    const patterns = {
      retro:   { bpm: 108, scale: [0, 4, 7, 12], baseHz: 130, kickEvery: 4, hatEvery: 2, padOn: true },
      cosmic:  { bpm: 96,  scale: [0, 3, 7, 10], baseHz: 110, kickEvery: 8, hatEvery: 4, padOn: true },
      playful: { bpm: 124, scale: [0, 4, 7, 9],  baseHz: 165, kickEvery: 4, hatEvery: 1, padOn: false },
      noir:    { bpm: 88,  scale: [0, 3, 5, 8],  baseHz: 98,  kickEvery: 4, hatEvery: 2, padOn: true },
      news:    { bpm: 110, scale: [0, 5, 7, 12], baseHz: 146, kickEvery: 4, hatEvery: 2, padOn: true },
    };
    const p = patterns[variant] || patterns.retro;
    const stepDur = 60 / p.bpm / 2; // 8th note

    let step = 0;
    let stopped = false;
    const nodes = [];

    const scheduleStep = () => {
      if (stopped) return;
      const now = ctx.currentTime;
      const beat = step % p.scale.length;
      const semi = p.scale[beat];
      const freq = p.baseHz * Math.pow(2, semi / 12);
      // Arpeggio
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.001, now);
      g.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + stepDur * 0.9);
      osc.connect(g); g.connect(master);
      osc.start(now); osc.stop(now + stepDur * 0.95);
      nodes.push(osc, g);
      // Kick
      if (step % p.kickEvery === 0) {
        const k = ctx.createOscillator(); const kg = ctx.createGain();
        k.type = "sine"; k.frequency.setValueAtTime(120, now);
        k.frequency.exponentialRampToValueAtTime(45, now + 0.15);
        kg.gain.setValueAtTime(0.001, now);
        kg.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
        kg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        k.connect(kg); kg.connect(master);
        k.start(now); k.stop(now + 0.22);
        nodes.push(k, kg);
      }
      // Hi-hat (noise burst)
      if (step % p.hatEvery === 0) {
        const bufSize = Math.floor(ctx.sampleRate * 0.05);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
        const hg = ctx.createGain(); hg.gain.value = 0.12;
        src.connect(hp); hp.connect(hg); hg.connect(master);
        src.start(now);
        nodes.push(src, hp, hg);
      }
      step++;
      this._adBedTimer = setTimeout(scheduleStep, stepDur * 1000);
    };
    // Pad opzionale (sub-drone)
    if (p.padOn) {
      const pad = ctx.createOscillator(); const pg = ctx.createGain();
      pad.type = "sawtooth"; pad.frequency.value = p.baseHz / 2;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400;
      pg.gain.value = 0.06;
      pad.connect(lp); lp.connect(pg); pg.connect(master);
      pad.start();
      nodes.push(pad, lp, pg);
    }
    scheduleStep();

    return () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(this._adBedTimer);
      const now = ctx.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.0, now + 0.35);
      } catch (e) {}
      setTimeout(() => {
        for (const n of nodes) { try { n.stop && n.stop(); } catch (e) {}; try { n.disconnect && n.disconnect(); } catch (e) {} }
        try { master.disconnect(); } catch (e) {}
      }, 400);
    };
  }

  /**
   * Procedural sonic stinger played between two segments when the kind changes.
   * Uses Web Audio API only — zero external files, zero Suno credits, ~2 seconds.
   *
   * Palette by target kind:
   *  - news       → short bell/chime (two-note descending mallet)
   *  - joke       → playful pitch-glide "boing"
   *  - history    → vinyl-scratch-like noise burst
   *  - music      → EDM riser + kick "beat drop"
   *  - default    → clean electronic swoosh + blip
   */
  async playStinger(fromKind, toKind) {
    if (!toKind || fromKind === toKind) return;
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    const dest = this.outputBus || ctx.destination;
    const t0 = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(dest);

    const kind = String(toKind || "").toLowerCase();
    const isTalkTarget = ["news","joke","history","interview","weather","horoscope","motivation","talk","answer"].includes(kind);
    const isMusicTarget = kind === "music";

    // Helpers
    const beep = (freqStart, freqEnd, dur, type = "sine", gain = 0.35, delay = 0) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t0 + delay);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + delay + dur);
      g.gain.setValueAtTime(0.001, t0 + delay);
      g.gain.exponentialRampToValueAtTime(gain, t0 + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + dur + 0.05);
    };
    const noiseBurst = (dur, gain = 0.4, delay = 0, filterHz = 4000) => {
      const bufferSize = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = filterHz;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t0 + delay);
    };

    let totalDur = 1.6;
    if (kind === "news") {
      // Two-note bell chime
      beep(1760, 1760, 0.35, "triangle", 0.4, 0);
      beep(1320, 1320, 0.55, "triangle", 0.35, 0.18);
      beep(880, 880, 0.7, "sine", 0.15, 0.35);
      totalDur = 1.2;
    } else if (kind === "joke") {
      // Playful upward "boing"
      beep(220, 880, 0.28, "square", 0.28, 0);
      beep(880, 220, 0.28, "square", 0.28, 0.24);
      beep(660, 660, 0.15, "sine", 0.3, 0.5);
      totalDur = 0.8;
    } else if (kind === "history" || kind === "interview") {
      // Vinyl-scratch-ish noise burst + low thud
      noiseBurst(0.35, 0.45, 0, 2200);
      noiseBurst(0.25, 0.35, 0.15, 3800);
      beep(80, 60, 0.5, "sine", 0.35, 0.1);
      totalDur = 1.1;
    } else if (isMusicTarget) {
      // Riser + beat drop
      beep(200, 3000, 0.9, "sawtooth", 0.28, 0);
      noiseBurst(0.6, 0.25, 0.3, 6000);
      // Kick
      beep(150, 40, 0.35, "sine", 0.55, 0.95);
      beep(80, 30, 0.3, "sine", 0.5, 1.05);
      totalDur = 1.8;
    } else if (isTalkTarget) {
      // Clean electronic swoosh + blip
      noiseBurst(0.55, 0.3, 0, 2500);
      beep(440, 1320, 0.2, "sine", 0.35, 0.4);
      totalDur = 1.0;
    } else {
      // Default transition blip
      beep(660, 990, 0.18, "sine", 0.4, 0);
      totalDur = 0.4;
    }

    // Cleanup — disconnect master shortly after the last sound
    setTimeout(() => { try { master.disconnect(); } catch (e) {} }, (totalDur + 0.5) * 1000);
    return new Promise(res => setTimeout(res, totalDur * 1000));
  }

  // Pick a mood-appropriate bed for each spoken segment kind.
  _bedConfigFor(kind) {
    const map = {
      news:       { genre: "darkwave",   bedGain: 0.11 },
      history:    { genre: "ambient",    bedGain: 0.10 },
      interview:  { genre: "jazz-hop",   bedGain: 0.12 },
      motivation: { genre: "synthwave",  bedGain: 0.14 },
      joke:       { genre: "synthwave",  bedGain: 0.13 },
      weather:    { genre: "ambient",    bedGain: 0.10 },
      horoscope:  { genre: "ambient",    bedGain: 0.11 },
      talk:       { genre: "electronic", bedGain: 0.13 },
      answer:     { genre: "jazz-hop",   bedGain: 0.12 },
      intro:      { genre: "electronic", bedGain: 0.13 },
      outro:      { genre: "electronic", bedGain: 0.13 },
    };
    return { durationSec: 60, ...(map[kind] || map.talk) };
  }

  async _playSpeechWithBed(segment) {
    // Rubriche parlate → sempre bed procedurale dedicato per kind (mai canzoni Suno).
    // Ogni chiamata sceglie una variante distinta → identità sonora riconoscibile.
    const stopBed = this._startProceduralAdBed(segment.kind);
    this._activeBedStoppers.push(stopBed);
    try {
      await this.playAudioUrl(segment.speech_audio_url);
    } finally {
      stopBed();
    }
  }

  /**
   * Ad spot surreale: [jingle apertura assurdo 1.35s] → [voce + procedural bed AD] → [jingle chiusura 1s].
   * Il bed AD è PROCEDURALE (non canzoni Suno) e ruota su 4 varianti distinte.
   */
  async _playAdSpot(segment) {
    await this._adJingle("open");
    const stopBed = this._startProceduralAdBed("ad");
    this._activeBedStoppers.push(stopBed);
    try {
      if (segment.speech_audio_url) {
        await this.playAudioUrl(segment.speech_audio_url);
      } else if (segment.script) {
        await this.speak(segment.script, segment.voice_key, { rate: 1.03 });
      }
    } finally {
      stopBed();
    }
    await this._adJingle("close");
  }

  /**
   * Procedural ad-break jingle: a two-note punchy fanfare with a subtle chord pad.
   * `variant`:
   *   "open"  → ascending fanfare (A5→D6 with sparkle noise burst) — energetic, invites attention.
   *   "close" → descending pinger (E6→A5) with a short bass thump — conclusive.
   */
  async _adJingle(variant = "open") {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    const dest = this.outputBus || ctx.destination;
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(dest);

    const tone = (freqStart, freqEnd, dur, type = "square", gain = 0.4, delay = 0) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t0 + delay);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + delay + dur);
      g.gain.setValueAtTime(0.001, t0 + delay);
      g.gain.exponentialRampToValueAtTime(gain, t0 + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + dur + 0.05);
    };
    const chord = (freqs, dur, gain = 0.18, delay = 0) => {
      freqs.forEach(f => tone(f, f, dur, "sawtooth", gain, delay));
    };
    const sparkle = (delay = 0) => {
      const bufSize = Math.floor(ctx.sampleRate * 0.35);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.value = 0.3;
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t0 + delay);
    };

    let total = 1.2;
    if (variant === "open") {
      // Assurdo/cartoon: doppio slide-whistle su + kazoo-like triangolo + chord marching
      chord([220, 277.2, 329.6, 415.3], 1.3, 0.14, 0);   // A minor 7 chord pad
      tone(180, 900, 0.35, "sawtooth", 0.4, 0);          // slide whistle 1
      tone(900, 220, 0.30, "sawtooth", 0.35, 0.35);      // slide down
      tone(660, 1100, 0.30, "square", 0.4, 0.68);        // cartoon boing
      tone(1100, 660, 0.30, "square", 0.4, 0.98);
      sparkle(0.02);
      sparkle(0.6);
      total = 1.6;
    } else {
      // Chiusura punchy: due colpi + bass thump + risatina synth
      chord([329.6, 415.3, 493.9], 0.9, 0.14, 0);
      tone(1318, 987, 0.22, "triangle", 0.38, 0);
      tone(987, 659,  0.22, "triangle", 0.35, 0.22);
      tone(659, 330,  0.35, "sawtooth", 0.32, 0.44);      // silly descent
      tone(90,  40,   0.35, "sine", 0.55, 0.5);           // bass thump
      total = 1.1;
    }

    setTimeout(() => { try { master.disconnect(); } catch (e) {} }, (total + 0.4) * 1000);
    return new Promise(res => setTimeout(res, total * 1000));
  }

  /**
   * Start a looped audio bed at the given target volume via Web Audio GainNode.
   * Returns a `stop()` function that fades out over 0.5s and cleans up.
   */
  _startAudioBed(url, targetVolume = 0.25) {
    const ctx = this.ensureAudioCtx();
    if (!ctx || !url) return () => {};
    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 1.0;
    let gainNode = null;
    let srcNode = null;
    try {
      srcNode = ctx.createMediaElementSource(audio);
      gainNode = ctx.createGain();
      gainNode.gain.value = 0.0;
      srcNode.connect(gainNode);
      gainNode.connect(this.outputBus);
      // Fade in to target over 0.4s
      const now = ctx.currentTime;
      gainNode.gain.linearRampToValueAtTime(targetVolume, now + 0.4);
    } catch (e) {
      // Fallback: use element volume
      audio.volume = targetVolume;
    }
    audio.play().catch(() => {});
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        if (gainNode) {
          const now = ctx.currentTime;
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.setValueAtTime(gainNode.gain.value, now);
          gainNode.gain.linearRampToValueAtTime(0.0, now + 0.5);
        }
        setTimeout(() => {
          try { audio.pause(); audio.src = ""; } catch (e) {}
          try { srcNode && srcNode.disconnect(); } catch (e) {}
          try { gainNode && gainNode.disconnect(); } catch (e) {}
        }, 550);
      } catch (e) {}
    };
  }

  async _playMusicWithVoice(segment) {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return this.playAudioUrl(segment.music_audio_url);

    return new Promise((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      try {
        // Riusa l'elemento pre-caricato (se già in cache) — nessuna latenza di rete
        // né di setup Web Audio.
        let audio = this._takePreloaded(segment.music_audio_url);
        let preloadedSrc = null;
        let preloadedGain = null;
        if (audio) {
          preloadedSrc = audio._srcNode || null;
          preloadedGain = audio._voiceGain || null;
        } else {
          // IMPORTANT: crossOrigin must be set BEFORE assigning src so the browser
          // sends the CORS preflight/tainted-origin check correctly.
          audio = document.createElement("audio");
          audio.crossOrigin = "anonymous";
          audio.preload = "auto";
          audio.src = segment.music_audio_url;
        }
        this.currentAudio = audio;
        // Route through analyser bus + a per-track gain so we can duck
        let src = preloadedSrc;
        if (!src) {
          try { src = ctx.createMediaElementSource(audio); } catch (e) {
            console.warn("createMediaElementSource failed, playing without analyser:", e);
            src = null;
          }
        } else {
          // Il src esiste già (dal preload) — scolleghiamo il voiceGain preloaded per
          // ricollegarlo attraverso il musicGain con ducking.
          try { preloadedGain && preloadedGain.disconnect(); } catch (e) {}
        }
        const musicGain = ctx.createGain();
        musicGain.gain.value = 0.0;
        if (src) {
          src.connect(musicGain);
          musicGain.connect(this.outputBus);
        }

        const rampTo = (target, seconds = 0.9) => {
          if (src) {
            const now = ctx.currentTime;
            musicGain.gain.cancelScheduledValues(now);
            musicGain.gain.setValueAtTime(musicGain.gain.value, now);
            musicGain.gain.linearRampToValueAtTime(target, now + seconds);
          } else {
            // No Web Audio routing → use native element volume as fallback
            const startVol = audio.volume;
            const steps = 20;
            const stepMs = (seconds * 1000) / steps;
            let i = 0;
            const iv = setInterval(() => {
              i++;
              audio.volume = Math.max(0, Math.min(1, startVol + (target - startVol) * (i / steps)));
              if (i >= steps) clearInterval(iv);
            }, stepMs);
          }
        };
        // Keep the underlying HTMLMediaElement volume at max — ducking is done via GainNode.
        // If we don't have a Web Audio source (createMediaElementSource failed), we start
        // muted and use audio.volume as the fallback ducking control.
        audio.volume = src ? 1.0 : 0;

        const INTRO_DUCK = 0.55;   // music under voice during intro
        const FULL = 1.0;          // music at full while nobody speaks
        const OUTRO_DUCK = 0.60;   // music under voice during outro

        audio.onended = () => { rampTo(0.0, 0.6); setTimeout(done, 700); };
        audio.onerror = () => done();

        audio.oncanplay = async () => {
          audio.play().catch(() => done());
        };

        // Start intro DJ over music fade-in
        const startPipeline = async () => {
          try {
            // fade in music to duck level
            rampTo(INTRO_DUCK, 0.6);
            // Play intro speech, but cap the whole DJ intro to MAX_INTRO_MS so
            // the speaker "wraps up" right around when the vocals typically
            // kick in. If the LLM script is too long, we cut it and ramp the
            // music to full — exactly like a real radio DJ.
            const MAX_INTRO_MS = 14000; // ~14s: dance tracks usually start vocals ≈15–18s
            const speechPromise = segment.speech_audio_url
              ? this.playAudioUrl(segment.speech_audio_url)
              : (segment.script
                  ? this.speak(segment.script, segment.voice_key, { rate: 1.08 })
                  : Promise.resolve());
            let timedOut = false;
            const timeoutPromise = new Promise((r) => setTimeout(() => { timedOut = true; r("timeout"); }, MAX_INTRO_MS));
            await Promise.race([speechPromise, timeoutPromise]);
            if (timedOut) {
              // Cut the DJ off cleanly — vocals are about to start.
              try { this.stopAudio(); } catch (e) {}
              try { this.stopSpeech(); } catch (e) {}
            }
            // Ramp up music to full
            rampTo(FULL, 1.2);
            // Wait until near-end
            const waitOutro = () => new Promise((r) => {
              const iv = setInterval(() => {
                if (!audio || audio.paused || audio.ended) { clearInterval(iv); r(); return; }
                const remaining = (audio.duration || 60) - (audio.currentTime || 0);
                if (remaining <= 8 || (this.stopRequested)) { clearInterval(iv); r(); }
              }, 250);
            });
            await waitOutro();
            // Duck for outro and speak
            rampTo(OUTRO_DUCK, 0.8);
            if (segment.outro_speech_url) {
              await this.playAudioUrl(segment.outro_speech_url);
            } else if (segment.outro_script) {
              await this.speak(segment.outro_script, segment.voice_key, { rate: 1.1 });
            }
            // Small buffer then let audio ended fire
            rampTo(0.0, 0.6);
            setTimeout(() => { try { audio.pause(); } catch(e){} done(); }, 700);
          } catch (e) { done(); }
        };
        startPipeline();
      } catch (e) {
        done();
      }
    });
  }

  stopAll() {
    this.stopSpeech();
    this.stopMusic();
    this.stopAudio();
    // Nuke any lingering bed stoppers (Ad spots, speech beds, ecc.) — evita overlap
    if (Array.isArray(this._activeBedStoppers)) {
      for (const fn of this._activeBedStoppers) { try { fn(); } catch (e) {} }
      this._activeBedStoppers = [];
    }
    this.currentKind = null;
  }
}

const engine = new RadioEngine();
export default engine;
