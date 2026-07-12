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
    return this.audioCtx;
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
  startMusic({ genre = "electronic", durationSec = 30, seed = 0 } = {}) {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return () => {};

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 1.2);

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
        const a = new Audio(url);
        this.currentAudio = a;
        a.crossOrigin = "anonymous";
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
    // HD mode: play pre-rendered speech audio + music audio if present
    if (segment.speech_audio_url || segment.music_audio_url) {
      if (segment.speech_audio_url) {
        await this.playAudioUrl(segment.speech_audio_url);
      }
      if (segment.music_audio_url) {
        await this.playAudioUrl(segment.music_audio_url);
      }
      return;
    }
    // Fallback: browser Web Speech + procedural synth
    if (segment.kind === "music") {
      const dur = Math.min(segment.duration_sec || 40, 45);
      const stop = this.startMusic({
        genre: segment.track_meta?.genre || "electronic",
        durationSec: dur,
        seed: (segment.id || "").charCodeAt(0) || 0,
      });
      if (segment.script) {
        await this.speak(segment.script, segment.voice_key, { rate: 1.05 });
      }
      await new Promise(res => setTimeout(res, Math.max(4000, dur * 500)));
      stop();
    } else {
      await this.speak(segment.script || segment.title || "", segment.voice_key, { rate: 1.02 });
    }
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
