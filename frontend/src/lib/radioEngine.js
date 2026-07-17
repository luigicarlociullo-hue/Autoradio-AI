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
      this.outputBus = this.audioCtx.createGain();
      this.outputBus.gain.value = 1.0;
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      this.outputBus.connect(this.analyser);
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
        const a = new Audio(url);
        a.crossOrigin = "anonymous";
        a.preload = "auto";
        // Explicit full element volume — the GainNode chain controls dynamics.
        a.volume = 1.0;
        this.currentAudio = a;
        // Route: source -> voiceGain(1.0) -> outputBus(1.0) -> analyser -> destination
        try {
          const src = ctx.createMediaElementSource(a);
          const voiceGain = ctx.createGain();
          voiceGain.gain.value = 1.0;
          src.connect(voiceGain);
          voiceGain.connect(this.outputBus);
          a._srcNode = src;
          a._voiceGain = voiceGain;
        } catch (e) {
          // Some browsers throw if the element already has a source. Fall back
          // to native output — element volume already at 1.0.
        }
        a.onended = () => { this.currentAudio = null; resolve(); };
        a.onerror = () => { this.currentAudio = null; resolve(); };
        a.play().catch(() => { this.currentAudio = null; resolve(); });
      } catch (e) {
        resolve();
      }
    });
  }

  stopAudio() {
    if (this.currentAudio) {
      try { this.currentAudio.pause(); this.currentAudio.src = ""; } catch (e) {}
      this.currentAudio = null;
    }
  }

  async playSegment(segment) {
    this.currentKind = segment.kind;
    // Music segment with real audio + optional pre-rendered intro/outro speech
    if (segment.kind === "music" && segment.music_audio_url) {
      return this._playMusicWithVoice(segment);
    }
    // Surreal ad spot — always wrapped with open/close jingle
    if (segment.kind === "ad_spot") {
      return this._playAdSpot(segment);
    }
    // Pure speech segment — ALWAYS play a subtle instrumental bed under the DJ voice
    // (no "dry" spoken-only content, like a real radio station).
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
      // Even for Web Speech fallback, drop a low bed under the voice.
      const stopBed = this.startMusic(this._bedConfigFor(segment.kind));
      await this.speak(segment.script || segment.title || "", segment.voice_key, { rate: 1.06 });
      stopBed();
    }
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
    // Prefer a real instrumental bed (looped Suno track at low volume) over the
    // procedural synth. Falls back to the synth bed if no track is provided.
    let stopBed;
    if (segment.background_loop) {
      stopBed = this._startAudioBed(segment.background_loop, 0.25);
    } else {
      stopBed = this.startMusic(this._bedConfigFor(segment.kind));
    }
    try {
      await this.playAudioUrl(segment.speech_audio_url);
    } finally {
      stopBed();
    }
  }

  /**
   * Play a surreal ad spot with the R-A.I. sonic identity:
   *  [Ad-open jingle 1.4s] → [Voice + low bed] → [Ad-close jingle 1.0s]
   * Jingles are procedural (Web Audio API), zero external files, zero Suno credits.
   */
  async _playAdSpot(segment) {
    await this._adJingle("open");
    let stopBed;
    if (segment.background_loop) {
      stopBed = this._startAudioBed(segment.background_loop, 0.15);
    } else {
      stopBed = this.startMusic({ genre: "synthwave", bedGain: 0.13, durationSec: 45 });
    }
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
      // Ascending fanfare with sparkle: A4 → D5 → A5, chord pad, sparkle
      chord([220, 277.2, 329.6], 1.2, 0.16, 0);   // A minor pad
      tone(440, 587.3, 0.28, "square", 0.42, 0);  // A5 → D6
      tone(587.3, 880,  0.28, "square", 0.42, 0.28);
      tone(880, 1174,   0.4,  "triangle", 0.35, 0.56);
      sparkle(0.02);
      total = 1.35;
    } else {
      // Descending pinger with bass thump
      chord([329.6, 415.3, 493.9], 0.9, 0.14, 0);
      tone(1318, 987, 0.22, "triangle", 0.38, 0);
      tone(987, 659,  0.22, "triangle", 0.35, 0.22);
      tone(90,  40,   0.35, "sine", 0.55, 0.4);  // bass thump
      total = 1.0;
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
        // IMPORTANT: crossOrigin must be set BEFORE assigning src so the browser
        // sends the CORS preflight/tainted-origin check correctly.
        const audio = document.createElement("audio");
        audio.crossOrigin = "anonymous";
        audio.preload = "auto";
        audio.src = segment.music_audio_url;
        this.currentAudio = audio;
        // Route through analyser bus + a per-track gain so we can duck
        let src;
        try { src = ctx.createMediaElementSource(audio); } catch (e) {
          // If MediaElementSource fails (cross-origin taint), fall back to
          // playing the audio through the default output without analyser routing.
          console.warn("createMediaElementSource failed, playing without analyser:", e);
          src = null;
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
    this.currentKind = null;
  }
}

const engine = new RadioEngine();
export default engine;
