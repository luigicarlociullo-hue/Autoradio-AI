/**
 * Line-In Mixer — Modalita' manuale R-A.I.
 * ------------------------------------------------------------------
 * Cattura audio da una scheda audio esterna dell'utente (es. Focusrite,
 * seconda scheda del PC) via `getUserMedia({ audio })`. Routa il flusso
 * attraverso Web Audio API con:
 *   - GainNode per volume (0-1.5x)
 *   - AnalyserNode per il VU meter
 *   - Compressore soft per evitare clip
 *
 * Tutto client-side: zero costi Suno, zero backend, qualita' massima
 * (nessuna ricodifica intermedia).
 */

class LineInMixer {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.gainNode = null;
    this.analyser = null;
    this.compressor = null;
    this.active = false;
    this._deviceId = null;
  }

  async listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      // Permesso richiesto per vedere i label (altrimenti sono anonimi)
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter(d => d.kind === "audioinput").map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Ingresso audio (${d.deviceId.slice(0, 6)}...)`,
      }));
    } catch (e) {
      console.warn("listDevices error", e);
      return [];
    }
  }

  async start(deviceId, outputContext) {
    if (this.active) await this.stop();
    // Usa lo stesso AudioContext della radio per non aprire canali paralleli
    this.ctx = outputContext || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive", sampleRate: 48000 });
    if (this.ctx.state === "suspended") { try { await this.ctx.resume(); } catch (e) {} }

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,   // NO echo cancellation → qualita' pura
        noiseSuppression: false,   // NO noise suppression
        autoGainControl: false,    // NO auto gain
        sampleRate: 48000,
        channelCount: 2,
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 1.0;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.15;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;

    this.source.connect(this.gainNode);
    this.gainNode.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this._deviceId = deviceId || null;
    this.active = true;
  }

  setGain(v) {
    if (!this.gainNode) return;
    const target = Math.max(0, Math.min(1.5, v));
    try {
      this.gainNode.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.1);
    } catch (e) {
      this.gainNode.gain.value = target;
    }
  }

  getLevel() {
    if (!this.analyser) return 0;
    const arr = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(arr);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = (arr[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / arr.length);
  }

  async stop() {
    this.active = false;
    try { this.source && this.source.disconnect(); } catch (e) {}
    try { this.gainNode && this.gainNode.disconnect(); } catch (e) {}
    try { this.compressor && this.compressor.disconnect(); } catch (e) {}
    try { this.analyser && this.analyser.disconnect(); } catch (e) {}
    if (this.stream) {
      this.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    }
    this.stream = null;
    this.source = null;
    this.gainNode = null;
    this.compressor = null;
    this.analyser = null;
  }
}

export const lineInMixer = new LineInMixer();
