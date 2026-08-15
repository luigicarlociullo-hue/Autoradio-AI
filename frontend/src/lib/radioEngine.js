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
      // Output chain: source → mix bus (music/voice/bed) → outputBus (master) → compressor → analyser → destination
      // Web Audio permette gain > 1.0 (a differenza di HTMLAudio.volume che è capped a 1.0),
      // così il volume finale è realmente più alto anche a max volume dispositivo.
      this.outputBus = this.audioCtx.createGain();
      this.outputBus.gain.value = 2.4;
      // === REGIA AUDIO: 3 bus di mix tra source e master ===
      // I loro gain sono aggiornati in tempo reale dal poller `_startMixPoller()`
      // leggendo /api/station/mix — così l'admin può alzare/abbassare i canali
      // direttamente dal Dashboard senza reload.
      this.musicBus = this.audioCtx.createGain(); this.musicBus.gain.value = 1.0;
      this.voiceBus = this.audioCtx.createGain(); this.voiceBus.gain.value = 1.0;
      this.bedBus   = this.audioCtx.createGain(); this.bedBus.gain.value   = 1.0;
      this.musicBus.connect(this.outputBus);
      this.voiceBus.connect(this.outputBus);
      this.bedBus.connect(this.outputBus);
      // Compressor per evitare clipping quando il gain sale
      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 8;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;
      this.analyser = this.audioCtx.createAnalyser();
      // v12.15 · CAPITOLATO: 1024 bande di frequenza per mapping chirurgico
      // bassi 20-150Hz, medi 400-2500Hz, alti 5000-15000Hz sui componenti del logo.
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.70;
      this.outputBus.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      // Avvia il poller del mixer una sola volta
      this._startMixPoller();
    }
    return this.audioCtx;
  }

  /** Poll dei valori del mixer ogni 2s per applicarli ai bus in tempo reale. */
  _startMixPoller() {
    if (this._mixPollerStarted) return;
    this._mixPollerStarted = true;
    // Default: crossfade 1000ms; se il backend risponde con altro, sovrascrive.
    this._crossfadeMs = 1000;
    this._activeBedUrl = null;
    const base = (typeof process !== "undefined" && process.env && process.env.REACT_APP_BACKEND_URL) || "";
    const url = `${base}/api/station/mix`;
    const pull = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return;
        const m = await r.json();
        const ctx = this.audioCtx;
        if (!ctx) return;
        // Convert 0-100 → 0.0-1.0 con rampa lieve per evitare click
        const now = ctx.currentTime;
        const set = (node, val) => {
          if (!node) return;
          const target = Math.max(0, Math.min(1, (val ?? 100) / 100));
          try {
            node.gain.cancelScheduledValues(now);
            node.gain.linearRampToValueAtTime(target, now + 0.1);
          } catch (e) {}
        };
        set(this.musicBus, m.music_vol);
        set(this.voiceBus, m.voice_vol);
        set(this.bedBus, m.bed_vol);
        // Master: manteniamo il boost 2.4 ma lo scaliamo con master_vol.
        const master = Math.max(0, Math.min(1, (m.master_vol ?? 100) / 100)) * 2.4;
        try {
          this.outputBus.gain.cancelScheduledValues(now);
          this.outputBus.gain.linearRampToValueAtTime(master, now + 0.1);
        } catch (e) {}
        if (typeof m.crossfade_ms === "number") this._crossfadeMs = m.crossfade_ms;
        this._activeBedUrl = m.active_bed_url || null;
      } catch (e) {}
    };
    pull();
    this._mixPollerInterval = setInterval(pull, 2000);
  }

  getAnalyser() {
    return this.analyser || null;
  }

  /**
   * setNightMixing(enabled) — Club Night crossfade ritmico.
   * Quando ci troviamo nella fascia 22-04, alziamo il crossfade a ~2500ms
   * e usiamo un fade "equal-power" per ottenere passaggi fluidi in stile
   * DJ mix (nessun stacco netto, nessun silenzio breve). Se disabilitato
   * torna ai valori diurni normali.
   */
  setNightMixing(enabled) {
    if (this._nightMixing === !!enabled) return;
    this._nightMixing = !!enabled;
    if (enabled) {
      this._savedCrossfadeMs = this._crossfadeMs;
      this._crossfadeMs = Math.max(2500, this._crossfadeMs || 1000);
    } else if (typeof this._savedCrossfadeMs === "number") {
      this._crossfadeMs = this._savedCrossfadeMs;
    }
  }

  /**
   * analyzeBpmAndReport(url, trackId) — Beat detection client-side.
   * Scarica il file audio, calcola il BPM via web-audio-beat-detector,
   * lo invia al backend (`PATCH /api/admin/tracks/{id}/bpm`) e ritorna
   * il BPM rilevato. Non blocca il playback (chiamata fire-and-forget).
   * Se il rilevamento fallisce ritorna null.
   */
  async analyzeBpmAndReport(url, trackId, apiBase) {
    if (!url || !trackId || !apiBase) return null;
    try {
      if (this._bpmCache && this._bpmCache.has(trackId)) return this._bpmCache.get(trackId);
      this._bpmCache = this._bpmCache || new Map();
      const { analyze } = await import("web-audio-beat-detector");
      const ctx = this.audioCtx || new (window.OfflineAudioContext || window.AudioContext)(2, 44100 * 30, 44100);
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const bpm = await analyze(decoded);
      const rounded = Math.round(bpm);
      this._bpmCache.set(trackId, rounded);
      // Report al backend
      try {
        await fetch(`${apiBase}/api/admin/tracks/${trackId}/bpm`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bpm: rounded, source: "client" }),
        });
      } catch (e) { /* silent */ }
      return rounded;
    } catch (e) {
      return null;
    }
  }

  getFakeAmplitude() {
    // Used by visualizer when speaking via Web Speech (no analyser access)
    if (!this.synth) return 0;
    return this.synth.speaking ? 0.55 + Math.random() * 0.4 : 0;
  }

  /**
   * SAFETY PAD: pad procedurale sottilissimo (drone armonico) SEMPRE attivo
   * mentre il player è on. Copre qualsiasi micro-gap tra segmenti eliminando
   * ogni possibile silenzio percepibile. Volume 0.04 (quasi impercettibile).
   * Zero costo Suno, zero API.
   */
  startSafetyPad() {
    if (this._safetyPad || this._safetyPadStarting) return;
    this._safetyPadStarting = true;
    const ctx = this.ensureAudioCtx();
    if (!ctx) { this._safetyPadStarting = false; return; }
    try {
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      // Fade-in molto lento (2s) per essere invisibile
      master.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 2.0);
      master.connect(this.bedBus || ctx.destination);

      // Drone armonico: 3 oscillatori a bassa frequenza in accordo Fm7 lontano
      const freqs = [55, 82.5, 123.5]; // A1, E2, B2 — armonia rilassata
      const oscs = [];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? "sine" : "triangle";
        osc.frequency.value = f;
        // LFO leggerissimo sulla frequenza per non essere statico
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.08 + i * 0.03;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.6 + i * 0.4;
        lfo.connect(lfoGain).connect(osc.frequency);
        const g = ctx.createGain();
        g.gain.value = 0.25;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 800;
        osc.connect(g).connect(lp).connect(master);
        osc.start();
        lfo.start();
        oscs.push(osc, lfo);
      });

      this._safetyPad = {
        master,
        oscs,
        stop: () => {
          try {
            master.gain.cancelScheduledValues(ctx.currentTime);
            master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
            master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
            setTimeout(() => {
              oscs.forEach(o => { try { o.stop(); } catch (e) {} });
              try { master.disconnect(); } catch (e) {}
            }, 1600);
          } catch (e) {}
        },
      };
    } catch (e) {
      console.warn("safetyPad start failed:", e);
    } finally {
      this._safetyPadStarting = false;
    }
  }

  stopSafetyPad() {
    if (this._safetyPad) {
      try { this._safetyPad.stop(); } catch (e) {}
      this._safetyPad = null;
    }
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

  /**
   * FERMA la traccia musicale corrente con un fade-out breve (200ms) per
   * evitare click, poi disconnette tutti i nodi Web Audio. Serve prima di
   * suonare un JINGLE che deve restare "pulito" senza sovrapposizioni.
   *
   * Copre TRE casi:
   *  1) brano in fase attiva (playback normale)    → fade rapido su `_currentMusicGain`
   *  2) brano in fase fade-out finale (step 6)     → cancella e forza a zero
   *  3) segmento parlato (currentAudio impostato)  → stop netto
   *
   * Idempotente: chiamabile senza rischio anche se non c'è nulla in riproduzione.
   */
  hardStopMusic() {
    const ctx = this.audioCtx;
    const now = ctx ? ctx.currentTime : 0;
    const FADE_MS = 200;

    // Caso 1: brano musicale attivo (gain node ancora vivo)
    if (this._currentMusicGain) {
      const g = this._currentMusicGain;
      const src = this._currentMusicSrcNode;
      const audio = this._currentMusicAudio;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0.0001, now + FADE_MS / 1000);
      } catch (e) {}
      setTimeout(() => {
        try { audio && audio.pause(); } catch (e) {}
        try { if (audio) audio.src = ""; } catch (e) {}
        try { src && src.disconnect(); } catch (e) {}
        try { g && g.disconnect(); } catch (e) {}
      }, FADE_MS + 30);
      this._currentMusicGain = null;
      this._currentMusicSrcNode = null;
      this._currentMusicAudio = null;
      this.stopRequested = true; // segnala al loop di _playMusicWithVoice di uscire
    }

    // Caso 2: fade-out finale già in corso → tronca subito
    const p = this._pendingMusicFadeOut;
    if (p) {
      p.canceled = true;
      try {
        if (p.musicGain && ctx) {
          p.musicGain.gain.cancelScheduledValues(now);
          p.musicGain.gain.setValueAtTime(0.0, now);
        }
      } catch (e) {}
      try { if (p.audio) { p.audio.pause(); p.audio.src = ""; } } catch (e) {}
      try { p.srcNode && p.srcNode.disconnect(); } catch (e) {}
      try { p.musicGain && p.musicGain.disconnect(); } catch (e) {}
      this._pendingMusicFadeOut = null;
    }

    // Caso 3: eventuale voce/audio corrente (es. outro DJ) — stop netto
    try { this.stopAudio(); } catch (e) {}
    try { this.stopSpeech(); } catch (e) {}
  }

  async playAudioUrl(url, onStart) {
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
            voiceGain.connect(this.voiceBus || ctx.destination);
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
        a.onerror = () => { console.warn("playAudioUrl error/404:", url); this.currentAudio = null; resolve(); };
        a.onplaying = () => { if (typeof onStart === "function") { try { onStart(); } catch (e) {} } };
        a.play().catch((err) => { console.warn("play() rejected:", err); this.currentAudio = null; resolve(); });
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
        voiceGain.connect(this.voiceBus || ctx.destination);
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
    // NOTA: NON pre-cachiamo music_audio_url perché `_playMusicWithVoice`
    // crea il proprio Audio element + createMediaElementSource — usare la
    // cache preload causava errori "already used" e brani che non partivano.
    if (seg.speech_audio_url) this.preloadUrl(seg.speech_audio_url);
    if (seg.outro_speech_url) this.preloadUrl(seg.outro_speech_url);
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
    // "A.I. Vs Umani" community block: intro jingle → DJ line → community track → outro jingle
    if (segment.kind === "community" && segment.music_audio_url) {
      return this._playCommunityBlock(segment);
    }
    // Jingle brandizzato schedulato dal backend (cadenza jingle_every_n_songs):
    // deve suonare per intero, SENZA il crossfade/ducking DJ di _playMusicWithVoice
    // (che tronca gli ultimi ~8s per fare spazio all'outro del DJ).
    if (segment.kind === "jingle" && segment.music_audio_url) {
      // Ferma subito qualunque coda di crossfade del brano precedente:
      // senza questo, l'ultimo ~1s di musica in dissolvenza si sovrappone
      // all'inizio del jingle (bug "jingle overlaps song").
      try { this.hardStopMusic(); } catch (e) {}
      return this.playJingle(segment.music_audio_url);
    }
    // Music segment con audio reale
    if (segment.kind === "music" && segment.music_audio_url) {
      return this._playMusicWithVoice(segment);
    }
    // Tutti i segmenti PARLATI (talk, joke, weather, history, interview, motivation,
    // news, ad_spot, time_signal, horoscope, ...): SOLO VOCE, zero sottofondo.
    return this._playVoiceOnly(segment);
  }

  /**
   * Blocco "A.I. Vs Umani" — sequenza fissa:
   *   A) Jingle di apertura (se admin l'ha caricato)
   *   B) Presentazione DJ (SpeechSynthesis client-side, zero costo)
   *   C) BRANO della community (con fade-in a full volume)
   *   D) Jingle finale CTA "Sei un artista? Inviaci il tuo brano..."
   * Ogni step aspetta la fine del precedente (nessun overlap richiesto dall'utente).
   */
  async _playCommunityBlock(segment) {
    // A) INTRO JINGLE
    if (segment.pre_jingle_url) {
      try { this.hardStopMusic(); } catch (e) {}
      try {
        const url = segment.pre_jingle_url.startsWith("/api/")
          ? this._absoluteAudioUrl(segment.pre_jingle_url)
          : segment.pre_jingle_url;
        await this.playJingle(url);
      } catch (e) { console.warn("[community] intro jingle failed:", e); }
    }
    // B) DJ presentation via speech (client-side, free)
    if (segment.speech_audio_url) {
      try { await this.playAudioUrl(segment.speech_audio_url); } catch (e) {}
    } else if (segment.script) {
      try { await this.speak(segment.script, segment.voice_key || "nova", { rate: 1.02 }); } catch (e) {}
    }
    // C) COMMUNITY TRACK — usa la pipeline musicale piena (buffer gate, fade-in,
    //    fade-out finale) MA senza intro/outro DJ (già fatto sopra).
    const musicSeg = {
      music_audio_url: segment.music_audio_url,
      track_meta: segment.track_meta || {},
      // niente speech_audio_url / script / outro → _playMusicWithVoice
      // salta lo step DJ e va dritto al brano.
    };
    await this._playMusicWithVoice(musicSeg);
    // D) OUTRO JINGLE (CTA)
    if (segment.post_jingle_url) {
      try { this.hardStopMusic(); } catch (e) {}
      try {
        const url = segment.post_jingle_url.startsWith("/api/")
          ? this._absoluteAudioUrl(segment.post_jingle_url)
          : segment.post_jingle_url;
        await this.playJingle(url);
      } catch (e) { console.warn("[community] outro jingle failed:", e); }
    }
  }

  /** Restituisce l'URL assoluto per un audio path relativo. */
  _absoluteAudioUrl(path) {
    if (!path || !path.startsWith("/api/")) return path;
    const base = (typeof process !== "undefined" && process.env && process.env.REACT_APP_BACKEND_URL) || "";
    return base ? `${base}${path}` : path;
  }

  /**
   * Riproduzione voce NUDA (nessun bed, nessun loop musicale, nessun jingle).
   * Usa il file TTS `speech_audio_url` se disponibile, altrimenti Web Speech.
   * Skip pulito se tutto fallisce → il palinsesto continua senza silenzi lunghi.
   */
  async _playVoiceOnly(segment) {
    // Pre-warma subito l'audio del prossimo segmento: i segmenti parlati
    // (talk, time_signal, jingle successivo, ecc.) sono spesso brevi, quindi
    // non c'è un "quasi alla fine" da aspettare — meglio partire da subito
    // per evitare silenzi quando questo segmento termina.
    try { this._preWarmHook && this._preWarmHook(); } catch (e) {}
    if (segment.speech_audio_url) {
      const ctx = this.ensureAudioCtx();
      return new Promise((resolve) => {
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        const audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.preload = "auto";
        audio.volume = 1.0;
        this.currentAudio = audio;

        // Safety timeout DINAMICO: proporzionale alla durata attesa del segmento
        // + 20s di buffer. Min 60s, max 180s. Cosí non tagliamo mai l'ultima frase
        // dei parlati lunghi (talk/interview/news possono durare 40-50s).
        const expectedSec = Math.max(20, segment.duration_sec || 40);
        const safetyMs = Math.min(180000, Math.max(60000, (expectedSec + 20) * 1000));
        const safety = setTimeout(() => {
          console.warn(`Voice safety timeout (${safetyMs}ms) — skipping:`, segment.speech_audio_url);
          try { audio.pause(); } catch (e) {}
          done();
        }, safetyMs);

        let srcNode = null;
        try {
          if (ctx) {
            srcNode = ctx.createMediaElementSource(audio);
            srcNode.connect(this.voiceBus || ctx.destination);
          }
        } catch (e) {}

        audio.addEventListener("ended", () => {
          clearTimeout(safety);
          // Piccolo delay di 400ms DOPO che l'audio finisce, così l'ultima
          // sillaba/coda del file non viene tagliata dal decoder buffer.
          setTimeout(() => {
            try { srcNode && srcNode.disconnect(); } catch (e) {}
            done();
          }, 400);
        }, { once: true });
        audio.addEventListener("error", () => {
          clearTimeout(safety);
          console.error("Voice load error:", segment.speech_audio_url);
          try { srcNode && srcNode.disconnect(); } catch (e) {}
          done();
        }, { once: true });
        audio.addEventListener("canplaythrough", () => {
          audio.play().catch((err) => {
            console.error("Voice play() failed:", err);
            clearTimeout(safety);
            done();
          });
        }, { once: true });

        audio.src = segment.speech_audio_url;
        try { audio.load(); } catch (e) {}
      });
    }
    // Fallback: Web Speech del browser (solo se non abbiamo TTS pronto)
    if (segment.script) {
      try {
        await this.speak(segment.script, segment.voice_key, { rate: 1.05 });
      } catch (e) { console.error("speak() failed:", e); }
    }
    // Se nemmeno lo script c'è, riso subito — il loop passerà oltre
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

    let totalDur = 0.4;
    if (kind === "news") {
      // Two-note bell chime (compresso)
      beep(1760, 1760, 0.14, "triangle", 0.5, 0);
      beep(1320, 1320, 0.22, "triangle", 0.42, 0.08);
      totalDur = 0.35;
    } else if (kind === "joke") {
      // Playful upward "boing"
      beep(440, 1320, 0.14, "square", 0.35, 0);
      beep(1320, 660, 0.12, "square", 0.3, 0.12);
      totalDur = 0.3;
    } else if (kind === "history" || kind === "interview") {
      // Vinyl-scratch noise + low thud
      noiseBurst(0.15, 0.45, 0, 2500);
      beep(90, 60, 0.22, "sine", 0.4, 0.05);
      totalDur = 0.35;
    } else if (isMusicTarget) {
      // Riser breve + kick
      beep(300, 3000, 0.28, "sawtooth", 0.32, 0);
      beep(120, 40, 0.18, "sine", 0.55, 0.25);
      totalDur = 0.4;
    } else if (isTalkTarget) {
      // Swoosh breve + blip
      noiseBurst(0.18, 0.32, 0, 2500);
      beep(660, 1320, 0.1, "sine", 0.35, 0.12);
      totalDur = 0.3;
    } else {
      // Default transition blip
      beep(660, 990, 0.14, "sine", 0.4, 0);
      totalDur = 0.2;
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

  /**
   * Riproduce una traccia Suno in LOOP a volume ridotto come "bed musicale"
   * sotto la voce del DJ. Ritorna una funzione stop() che ferma il loop con
   * fade-out. Zero costi Suno (usa tracce già scaricate localmente).
   */
  _playLoopedBed(url, volume = 0.22) {
    if (!url) return () => {};
    const ctx = this.ensureAudioCtx();
    if (!ctx) return () => {};
    let stopped = false;
    let audio = null;
    let gainNode = null;
    try {
      audio = new Audio(url);
      audio.crossOrigin = "anonymous";
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 1.0;
      // Fai partire da un offset casuale così ogni rubrica ha un flavor diverso
      audio.addEventListener("loadedmetadata", () => {
        try {
          if (audio.duration && audio.duration > 30) {
            audio.currentTime = Math.random() * (audio.duration - 20);
          }
        } catch (e) {}
      });
      const src = ctx.createMediaElementSource(audio);
      gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.01, volume), ctx.currentTime + 0.8);
      src.connect(gainNode);
      gainNode.connect(this.voiceBus || ctx.destination);
      audio.play().catch(() => {});
    } catch (e) {
      // createMediaElementSource già usato o errore CORS — silent fallback
    }
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        if (gainNode) {
          gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
        }
      } catch (e) {}
      setTimeout(() => {
        try { if (audio) { audio.pause(); audio.src = ""; } } catch (e) {}
      }, 600);
    };
  }

  async _playSpeechWithBed(segment) {
    // Rubriche parlate → bed. Priorità:
    //   1) segment.background_loop esplicito
    //   2) `_activeBedUrl` impostato dall'admin dal pannello Regia Audio
    //   3) fallback procedurale (Web Audio sintesi)
    let stopBed;
    const adminBedUrl = this._activeBedUrl || null;
    const bedUrl = segment.background_loop || adminBedUrl;
    if (bedUrl) {
      // Assoluto se path relativo
      const absUrl = bedUrl.startsWith("/api/") ? this._absoluteAudioUrl(bedUrl) : bedUrl;
      stopBed = this._playLoopedBed(absUrl, 0.22);
    } else {
      stopBed = this._startProceduralAdBed(segment.kind);
    }
    this._activeBedStoppers.push(stopBed);
    try {
      if (segment.speech_audio_url) {
        await this.playAudioUrl(segment.speech_audio_url);
      } else if (segment.script) {
        // Nessun TTS pronto → fallback su Web Speech del browser così NON c'è mai silenzio.
        await this.speak(segment.script, segment.voice_key, { rate: 1.05 });
      } else {
        // Nemmeno script → lascia scorrere il bed 12s poi passa oltre
        await new Promise(res => setTimeout(res, 12000));
      }
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
      gainNode.connect(this.voiceBus || ctx.destination);
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

  /**
   * Riproduce un jingle R-A.I. corto (Suno-generated) come stinger tra
   * segmenti. Volume pieno, no ducking, no intro DJ. Fade-out morbido negli
   * ultimi 1.2s per evitare chiusure brutte.
   */
  async playJingle(url) {
    if (!url) return;
    // Pre-warma subito l'audio del prossimo segmento: i jingle sono spesso
    // brevi, quindi non c'è tempo di aspettare un "quasi alla fine" come
    // per la musica — meglio partire subito appena questo inizia.
    try { this._preWarmHook && this._preWarmHook(); } catch (e) {}
    return new Promise((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      const ctx = this.ensureAudioCtx();
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      audio.volume = 1.0;

      // Safety cap MOLTO generoso: max 5 minuti (300s). I jingle full-length
      // possono arrivare a 3+ minuti — non li tagliamo mai per timeout arbitrario.
      // Se il file è davvero corrotto, l'evento `error` scatta comunque.
      const capTimer = setTimeout(() => { try { audio.pause(); } catch (e) {}; done(); }, 300000);
      // Load timeout: se canplaythrough non arriva in 10s, skip
      const loadTimer = setTimeout(() => { console.warn("Jingle load timeout"); done(); }, 10000);

      let srcNode = null, gainNode = null;
      try {
        if (ctx) {
          srcNode = ctx.createMediaElementSource(audio);
          gainNode = ctx.createGain();
          // Fade-in di ~200ms: rampa dolce che evita click all'attacco ma
          // resta abbastanza corta da non sembrare "sfumata". Il caller ha
          // già invocato hardStopMusic() per liberare l'aria dal brano
          // precedente, quindi il jingle sale su silenzio.
          gainNode.gain.value = 0.001;
          gainNode.gain.exponentialRampToValueAtTime(1.0, ctx.currentTime + 0.20);
          srcNode.connect(gainNode);
          gainNode.connect(this.voiceBus || ctx.destination);
        }
      } catch (e) {}

      // NESSUN FADE-OUT: il jingle deve suonare per intero fino alla coda
      // naturale (richiesta esplicita dell'utente 2026-02). Nessun
      // `outroWatcher`, nessun decrescendo negli ultimi secondi — il file
      // termina esattamente quando termina la sorgente audio.

      audio.addEventListener("ended", () => {
        clearTimeout(capTimer);
        // Small buffer post-ended per non troncare la coda del decoder
        setTimeout(() => {
          try { srcNode && srcNode.disconnect(); } catch (e) {}
          try { gainNode && gainNode.disconnect(); } catch (e) {}
          done();
        }, 250);
      }, { once: true });
      audio.addEventListener("error", () => {
        clearTimeout(capTimer);
        done();
      }, { once: true });
      audio.addEventListener("canplaythrough", () => {
        clearTimeout(loadTimer);
        audio.play().catch(() => { clearTimeout(capTimer); done(); });
      }, { once: true });

      audio.src = url;
      try { audio.load(); } catch (e) {}
    });
  }

  /**
   * Registra una callback che verra' invocata 5 secondi prima della fine
   * del segmento musicale corrente. Serve al loop per pre-caricare il
   * prossimo audio element (fetch + decode) cosi' quando parte c'e' zero delay.
   */
  setPreWarmHook(fn) {
    this._preWarmHook = fn;
  }

  /**
   * Prewarm generico di un URL audio: scarica il file via `fetch()` e lo
   * converte in un Blob URL locale. Quando poi verrà riprodotto in
   * `_playMusicWithVoice`, useremo direttamente il blob URL come src → il
   * browser NON fa un secondo download HTTP (era il "double download"
   * segnalato dall'utente). Il blob resta in memoria e viene revocato
   * dopo l'uso oppure dopo un TTL di 6 minuti (safety GC).
   */
  prewarmAudio(url) {
    if (!url) return;
    if (!this._prewarmedBlobs) this._prewarmedBlobs = new Map(); // url → blobUrl
    if (this._prewarmedBlobs.has(url)) return;
    // Segna come "in corso" per evitare doppie fetch parallele
    this._prewarmedBlobs.set(url, null);
    fetch(url, { credentials: "omit", cache: "force-cache" })
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (!blob) {
          this._prewarmedBlobs.delete(url);
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        this._prewarmedBlobs.set(url, blobUrl);
        // Safety GC: revoca il blob dopo 6 minuti se non usato
        setTimeout(() => {
          if (this._prewarmedBlobs?.get(url) === blobUrl) {
            try { URL.revokeObjectURL(blobUrl); } catch (e) {}
            this._prewarmedBlobs.delete(url);
          }
        }, 6 * 60 * 1000);
      })
      .catch(() => { this._prewarmedBlobs.delete(url); });
  }

  /**
   * Se l'URL è stato prewarmato con successo restituisce il blob URL locale
   * (nessun download HTTP), altrimenti restituisce l'URL originale.
   * Marca il blob URL come "consumato" — verrà revocato quando l'audio è
   * terminato (chiamare `_releasePrewarm(originalUrl)`).
   */
  _consumePrewarm(url) {
    const blobUrl = this._prewarmedBlobs?.get(url);
    return blobUrl || url;
  }

  _releasePrewarm(url) {
    const blobUrl = this._prewarmedBlobs?.get(url);
    if (blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch (e) {}
      this._prewarmedBlobs.delete(url);
    }
  }

  /**
   * Fade il gain di un GainNode Web Audio in modo lineare (millisecondi).
   */
  _fadeGain(nodeOrEl, from, to, durationMs = 800) {
    if (!nodeOrEl) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        if (nodeOrEl.gain && typeof nodeOrEl.gain.value === "number") {
          const ctx = this.ensureAudioCtx();
          const now = ctx ? ctx.currentTime : 0;
          nodeOrEl.gain.cancelScheduledValues(now);
          nodeOrEl.gain.setValueAtTime(Math.max(0.0001, from), now);
          nodeOrEl.gain.linearRampToValueAtTime(Math.max(0.0001, to), now + durationMs / 1000);
        } else if (nodeOrEl.volume !== undefined) {
          const steps = 24;
          const dt = Math.max(20, durationMs / steps);
          let i = 0;
          const iv = setInterval(() => {
            i++;
            const t = i / steps;
            nodeOrEl.volume = Math.max(0, Math.min(1, from + (to - from) * t));
            if (i >= steps) { clearInterval(iv); resolve(); }
          }, dt);
          return;
        }
      } catch (e) {}
      setTimeout(resolve, durationMs);
    });
  }

  async _playMusicWithVoice(segment) {
    // Riscrittura ROBUSTA: attende almeno 5s di buffer reale prima di
    // suonare (nessun glitch iniziale), safety timeout di 20s in caso di
    // problemi di rete, skip pulito su errore. Ducking gestito via Web
    // Audio GainNode per il visualizer.
    return new Promise(async (resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      const ctx = this.ensureAudioCtx();
      const url = segment.music_audio_url;
      if (!url) { done(); return; }

      // ZERO DOUBLE DOWNLOAD: se il brano è stato prewarmato via `fetch()`,
      // il blob è già in memoria del browser — usiamo il blob URL locale
      // come src, così il tag <audio> NON fa un secondo request HTTP.
      // Se non c'è prewarm (o è ancora in corso), usiamo l'URL originale.
      const playbackSrc = this._consumePrewarm(url);
      const usedBlob = playbackSrc !== url;

      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      audio.volume = 1.0;
      this.currentAudio = audio;

      // Safety timeout: se non riusciamo a partire in 20s, skip il brano.
      const safetyTimer = setTimeout(() => {
        console.warn("Music safety timeout — skipping:", url);
        try { audio.pause(); audio.src = ""; } catch (e) {}
        if (usedBlob) this._releasePrewarm(url);
        done();
      }, 20000);

      // Grafo Web Audio: audio → musicGain → outputBus (analyser + master)
      let musicGain = null;
      let srcNode = null;
      try {
        if (ctx) {
          srcNode = ctx.createMediaElementSource(audio);
          musicGain = ctx.createGain();
          musicGain.gain.value = 0.0001;
          srcNode.connect(musicGain);
          musicGain.connect(this.musicBus || ctx.destination);
        }
      } catch (e) {
        console.warn("Music WebAudio graph setup failed, using element volume:", e);
      }

      // Espone i nodi correnti così `hardStopMusic()` può interromperli
      // anche durante la fase di playback attivo (non solo nel fade-out finale).
      this._currentMusicAudio = audio;
      this._currentMusicSrcNode = srcNode;
      this._currentMusicGain = musicGain;
      this.stopRequested = false;

      audio.addEventListener("error", () => {
        clearTimeout(safetyTimer);
        if (bufferGateTimer) clearInterval(bufferGateTimer);
        console.error("Music load error:", url);
        try { srcNode && srcNode.disconnect(); } catch (e) {}
        try { musicGain && musicGain.disconnect(); } catch (e) {}
        if (this._currentMusicAudio === audio) {
          this._currentMusicAudio = null;
          this._currentMusicSrcNode = null;
          this._currentMusicGain = null;
        }
        if (usedBlob) this._releasePrewarm(url);
        done();
      }, { once: true });

      // === BUFFER GATE: attendo almeno 5s di audio bufferizzato reale prima
      // di partire con `audio.play()`. Elimina i glitch iniziali (audio che
      // parte e stoppa dopo 200ms per rifornirsi). Se il brano è più corto
      // di 5s (raro) oppure il buffer riempie tutto il file, partiamo comunque.
      const MIN_BUFFER_S = 5;
      let started = false;
      let bufferGateTimer = null;
      const tryStart = async () => {
        if (started) return;
        // === FIX A+D · zero silenzio ===
        // Se il src è un blob:// URL (pre-scaricato via fetch().blob()) i
        // dati sono GIÀ tutti in RAM: possiamo partire non appena il decoder
        // ha inizializzato (HAVE_CURRENT_DATA ≥ 2). Il buffer gate 5s
        // servirebbe solo a proteggerci da network jitter, ma qui non c'è
        // network. → ready istantaneo.
        let ready = false;
        if (usedBlob && audio.readyState >= 2 /* HAVE_CURRENT_DATA */) {
          ready = true;
        } else {
          try {
            if (audio.buffered && audio.buffered.length > 0) {
              const bufEnd = audio.buffered.end(0);
              const bufStart = audio.buffered.start(0);
              const dur = isFinite(audio.duration) ? audio.duration : Infinity;
              const targetS = Math.min(MIN_BUFFER_S, Math.max(1, dur * 0.5));
              if (bufStart <= 0.1 && (bufEnd - bufStart) >= targetS) ready = true;
              if (isFinite(dur) && (bufEnd - bufStart) >= dur - 0.5) ready = true;
            }
          } catch (e) {}
          if (!ready && audio.readyState >= 4 /* HAVE_ENOUGH_DATA */) ready = true;
        }
        if (!ready) return;
        started = true;
        if (bufferGateTimer) { clearInterval(bufferGateTimer); bufferGateTimer = null; }
        clearTimeout(safetyTimer);
        try {
          await audio.play();

          const INTRO_DUCK = 0.18;   // musica sotto la voce -> parole chiare
          const FULL = 1.0;
          const OUTRO_DUCK = 0.20;
          const CROSSFADE_MS = (typeof this._crossfadeMs === "number") ? this._crossfadeMs : 1000;  // regia audio: 0-5000ms

          const setVol = async (target, ms) => {
            if (musicGain) return this._fadeGain(musicGain, musicGain.gain.value, target, ms);
            return this._fadeGain(audio, audio.volume, target, ms);
          };

          // 1) Fade-in music a duck level (1s crossfade con eventuale audio precedente)
          await setVol(INTRO_DUCK, CROSSFADE_MS);

          // 2) Intro DJ (max 14s), MA se il file voce non parte entro 3s -> skip
          //    e musica dritta a full volume (task explicit request: fluidità).
          if (segment.speech_audio_url || segment.script) {
            const MAX_INTRO_MS = 14000;
            const LOAD_TIMEOUT_MS = 3000;  // 3s per iniziare a suonare, altrimenti skip
            let djStarted = false;
            const speechPromise = segment.speech_audio_url
              ? this.playAudioUrl(segment.speech_audio_url, () => { djStarted = true; })
              : this.speak(segment.script, segment.voice_key, { rate: 1.08 });
            // Se dopo 3s la voce non e' partita, cancella subito e vai col brano
            const loadCheckPromise = new Promise((r) => {
              setTimeout(() => {
                if (!djStarted) {
                  console.warn("DJ voice failed/slow (>3s) — skipping to full-volume music");
                  try { this.stopAudio(); } catch (e) {}
                  try { this.stopSpeech(); } catch (e) {}
                  r("load-timeout");
                }
              }, LOAD_TIMEOUT_MS);
            });
            const globalTimeout = new Promise((r) =>
              setTimeout(() => { try { this.stopSpeech(); } catch (e) {} r(); }, MAX_INTRO_MS)
            );
            await Promise.race([speechPromise, loadCheckPromise, globalTimeout]);
            // Se load-timeout scattato, salta subito a full volume
            if (!djStarted) {
              await setVol(FULL, 200);
              // continua alla fase 4 (attesa fine brano)
            }
          }

          // 3) DJ finito -> crossfade 1s musica a full volume
          await setVol(FULL, CROSSFADE_MS);

          // 4) Attendi fine brano meno 8s (outro window) + pre-warm next 5s prima
          let nextPreWarmed = false;
          await new Promise((r) => {
            const iv = setInterval(() => {
              if (!audio || audio.paused || audio.ended || this.stopRequested) {
                clearInterval(iv); r(); return;
              }
              const dur = (audio.duration || 60);
              const remaining = dur - (audio.currentTime || 0);
              // === FIX A · zero silenzio ===
              // Pre-warm ANTICIPATO: appena il brano supera il 40% del tempo
              // (o 20s dalla partenza) chiamiamo il hook, che a sua volta:
              //   1) fetch del prossimo segmento in parallelo (endpoint API)
              //   2) prewarm blob:// del prossimo audio (RAM ready)
              // Così quando il brano corrente termina il crossfade, il B è
              // GIÀ completamente in memoria e parte in <20ms.
              if (!nextPreWarmed && this._preWarmHook &&
                  ((audio.currentTime || 0) >= Math.min(20, dur * 0.4))) {
                nextPreWarmed = true;
                try { this._preWarmHook(); } catch (e) {}
              }
              if (remaining <= 8) { clearInterval(iv); r(); }
            }, 200);
          });

          // 5) Crossfade 1s musica -> duck, poi outro DJ
          //    SALTA se il brano è stato hard-stopped (es. per far posto a un jingle):
          //    non ha senso lanciare l'outro DJ senza musica sotto.
          if ((segment.outro_speech_url || segment.outro_script) && !this.stopRequested) {
            await setVol(OUTRO_DUCK, CROSSFADE_MS);
            if (segment.outro_speech_url) {
              await this.playAudioUrl(segment.outro_speech_url);
            } else {
              await this.speak(segment.outro_script, segment.voice_key, { rate: 1.1 });
            }
          }

          // Se hard-stopped, salta anche lo step 6 (il brano è già stato pausato/disconnesso)
          if (this.stopRequested) {
            this.stopRequested = false;
            done();
            return;
          }

          // 6) === FIX C · Crossfade OVERLAP ===
          //    Il brano corrente esce con un fade-out di CROSSFADE_MS.
          //    `done()` viene chiamato SUBITO (non-awaited): il loop può già
          //    lanciare il prossimo segmento, che entrerà sovrapposto per
          //    ~1s coprendo la coda del vecchio (che sfuma). Zero silenzio.
          if (this.currentAudio === audio) this.currentAudio = null;
          if (this._currentMusicAudio === audio) {
            this._currentMusicAudio = null;
            this._currentMusicSrcNode = null;
            this._currentMusicGain = null;
          }
          const pending = { audio, srcNode, musicGain, canceled: false };
          this._pendingMusicFadeOut = pending;
          setVol(0.001, CROSSFADE_MS).then(() => {
            if (pending.canceled) return;
            try { audio.pause(); } catch (e) {}
            try { srcNode && srcNode.disconnect(); } catch (e) {}
            try { musicGain && musicGain.disconnect(); } catch (e) {}
            if (this._pendingMusicFadeOut === pending) this._pendingMusicFadeOut = null;
            if (usedBlob) this._releasePrewarm(url);
          });
          done();
        } catch (playErr) {
          console.error("Music playback error:", playErr);
          try { srcNode && srcNode.disconnect(); } catch (e) {}
          try { musicGain && musicGain.disconnect(); } catch (e) {}
          if (this._currentMusicAudio === audio) {
            this._currentMusicAudio = null;
            this._currentMusicSrcNode = null;
            this._currentMusicGain = null;
          }
          if (usedBlob) this._releasePrewarm(url);
          done();
        }
      };  // end of tryStart

      // Ogni volta che il browser scarica nuovi byte controlla se abbiamo
      // superato il threshold di 5s per partire.
      audio.addEventListener("progress", tryStart);
      audio.addEventListener("canplay", tryStart);
      audio.addEventListener("canplaythrough", tryStart);
      audio.addEventListener("loadeddata", tryStart);
      // Fallback polling ogni 250ms — su alcuni browser gli eventi
      // buffered/progress non arrivano finché il player non è visibile.
      bufferGateTimer = setInterval(tryStart, 250);

      // Kick off the load. Se `usedBlob` è true, il src è un blob:// locale
      // (nessun secondo download HTTP grazie al prewarm via fetch()).
      audio.src = playbackSrc;
      try { audio.load(); } catch (e) {}
    });
  }

  stopAll() {
    // Pausa ISTANTANEA (ordine utente 2026-08-12):
    // hardStopMusic() ferma bruscamente il brano musicale in playback attivo
    // (agendo su `_currentMusicGain`, `_currentMusicAudio`) + eventuale fade-out
    // pendente + voce/speech. stopSpeech/stopAudio sono ridondanti ma le
    // teniamo per belt-and-braces.
    try { this.hardStopMusic(); } catch (e) {}
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

  // ============================================================
  //  MEDIA SESSION API — lockscreen/Bluetooth headset controls
  // ------------------------------------------------------------
  //  Fa apparire titolo brano, artista e artwork sulla lockscreen di
  //  Android/iOS, sulle notifiche del sistema e sui comandi del volante
  //  auto / cuffie Bluetooth. NON gestisce il playback in background
  //  (Web Audio API in background è comunque fragile) ma gestisce PLAY,
  //  PAUSE e NEXTTRACK quando l'utente li aziona da lockscreen o cuffie.
  // ============================================================
  /** Registra gli handler globali una sola volta. `handlers` = {play, pause, next} */
  setupMediaSession(handlers = {}) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    this._mediaHandlers = handlers;
    try {
      navigator.mediaSession.setActionHandler("play", () => {
        try { this._mediaHandlers.play && this._mediaHandlers.play(); } catch (e) {}
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        try { this._mediaHandlers.pause && this._mediaHandlers.pause(); } catch (e) {}
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        try { this._mediaHandlers.next && this._mediaHandlers.next(); } catch (e) {}
      });
      // "previoustrack" non lo mappiamo: la radio è live, non c'è indietro
      navigator.mediaSession.setActionHandler("previoustrack", null);
      // Seek non applicabile a stream live
      navigator.mediaSession.setActionHandler("seekto", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
    } catch (e) {
      console.warn("Media Session setup failed:", e);
    }
  }

  /** Aggiorna metadata visualizzati su lockscreen / Bluetooth headset. */
  updateMediaMetadata({ title, artist, artwork } = {}) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      const artUrl = artwork || "/rai-icon-512.png";
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: title || "R-A.I.",
        artist: artist || "Web Radio AI",
        album: "R-A.I. · La radio governata dalle AI",
        artwork: [
          { src: "/rai-icon-192.png", sizes: "192x192", type: "image/png" },
          { src: artUrl, sizes: "512x512", type: "image/png" },
        ],
      });
    } catch (e) {
      // silent
    }
  }

  /** "playing" | "paused" | "none" */
  setMediaPlaybackState(state) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try { navigator.mediaSession.playbackState = state; } catch (e) {}
  }
}

const engine = new RadioEngine();
export default engine;
