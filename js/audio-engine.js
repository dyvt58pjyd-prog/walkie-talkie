/**
 * ADVANCED WALKIE-TALKIE WEB AUDIO ENGINE
 * Realistic RF Telecommunications DSP Pipeline:
 * - 300Hz - 3400Hz standard voice bandpass filtration
 * - Analog RF harmonic saturation & wave-shaping
 * - Dynamic range compression & AGC
 * - Squelch burst & key-up / key-down squelch tail synthesis
 * - Authentic Roger Beep profiles (Motorola, NASA Quindar, Tactical 2-Tone, Chime)
 * - Morse Code CW keyer (800Hz pure tone with envelope)
 * - Emergency dual-tone tactical distress siren
 * - Continuous atmospheric background squelch hiss (Monitor mode)
 * - Channel collision heterodyne interference tone
 * - Audio visualizer analyzer for LCD display
 * - Transmission recorder & instant replay
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;

    // Master nodes
    this.masterGain = null;
    this.analyser = null;

    // Mic processing nodes
    this.micStream = null;
    this.micSource = null;
    this.processedDestination = null;
    this.isTransmitting = false;

    // Static & background noise
    this.noiseNode = null;
    this.noiseGain = null;
    this.isMonitorActive = false;

    // CW Morse tone
    this.cwOsc = null;
    this.cwGain = null;

    // Emergency alarm
    this.alarmOsc = null;
    this.alarmGain = null;
    this.alarmInterval = null;
    this.isAlarmActive = false;

    // Heterodyne interference
    this.heterodyneOsc = null;
    this.heterodyneGain = null;

    // Settings
    this.settings = {
      volume: 0.85,
      squelchLevel: 3, // 0 (open) to 9 (tight)
      filterMode: 'tactical', // 'tactical', 'vintage', 'lofi'
      distortion: 15, // 0 to 50
      rogerBeep: 'motorola', // 'motorola', 'quindar', 'twotone', 'chime', 'cyber', 'off'
      micGain: 1.2
    };

    // Buffer for last transmission replay
    this.lastReceivedAudioChunks = [];
    this.lastReceivedBlob = null;
  }

  // Ensure AudioContext is ready after user gesture
  async init() {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();

    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.settings.volume, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // Analyser for LCD oscilloscope / frequency meter
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.8;
    this.masterGain.connect(this.analyser);

    // Setup background atmospheric static noise generator
    this.setupStaticNoiseGenerator();

    this.isInitialized = true;
    console.log('📻 Audio Engine Initialized successfully');
  }

  setVolume(val) {
    this.settings.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.05);
    }
  }

  // Setup continuous static noise buffer for squelch & monitor mode
  setupStaticNoiseGenerator() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    // Generate filtered pink/white noise with random atmospheric static
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      const pink = b0 + b1 + b2 + white * 0.5362;
      output[i] = pink * 0.11;
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;

    // Bandpass filter for static to sound like high-frequency RF hiss
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1800;
    noiseFilter.Q.value = 0.8;

    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.noiseNode.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);

    this.noiseNode.start();
  }

  // Set atmospheric noise level (e.g. MONI button opened)
  setStaticNoise(active, level = 0.15) {
    if (!this.noiseGain || !this.ctx) return;
    const target = active ? level : 0;
    this.noiseGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.noiseGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
    this.isMonitorActive = active;
  }

  // Squelch Burst (The classic sharp white noise burst when keying up or releasing)
  playSquelchBurst(isKeyUp = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const duration = isKeyUp ? 0.05 : 0.14; // Short click on key-up, tail crunch on key-down

    // Noise buffer
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;

    // Filter to give that metallic walkie-talkie squelch tail sound
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isKeyUp ? 2200 : 1600, now);
    filter.Q.setValueAtTime(1.5, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(now);
    source.stop(now + duration);
  }

  // Hardware mechanical switch click sound (when pressing or releasing PTT)
  playMicClick(isPress = true) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isPress ? 350 : 220, now);
    osc.frequency.exponentialRampToValueAtTime(isPress ? 80 : 60, now + 0.03);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.035);
  }

  // Authentic Roger Beeps
  playRogerBeep(type = null) {
    if (!this.ctx) return;
    const beepType = type || this.settings.rogerBeep;
    if (beepType === 'off') return;

    const now = this.ctx.currentTime;

    switch (beepType) {
      case 'motorola': {
        // Classic Motorola 850Hz single burst + short squelch
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(850, now);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.setValueAtTime(0.25, now + 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.12);

        // Add tail squelch
        setTimeout(() => this.playSquelchBurst(false), 90);
        break;
      }

      case 'quindar': {
        // NASA Apollo Quindar Tone: 2525Hz or 2475Hz, 250ms sine
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2525, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
        gain.gain.setValueAtTime(0.2, now + 0.22);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.26);
        break;
      }

      case 'twotone': {
        // Dual-tone tactical chime (1209Hz & 697Hz like standard DTMF / Tactical alert)
        const freqs = [697, 1209];
        freqs.forEach(f => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, now);

          gain.gain.setValueAtTime(0.12, now);
          gain.gain.setValueAtTime(0.12, now + 0.14);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.18);
        });
        setTimeout(() => this.playSquelchBurst(false), 140);
        break;
      }

      case 'chime': {
        // Upward frequency sweep chime (800Hz to 1400Hz)
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.12);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.16);
        break;
      }

      case 'cyber': {
        // Quick 3-tone arpeggio (1000Hz -> 1350Hz -> 1750Hz)
        [1000, 1350, 1750].forEach((freq, idx) => {
          const t = now + idx * 0.04;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0.08, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.038);

          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(t);
          osc.stop(t + 0.04);
        });
        break;
      }
    }
  }

  // Distortion curve generator for RF non-linear tube/transistor warmth
  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 20;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Creates the full authentic walkie-talkie audio DSP chain
  createRadioDSPChain(inputNode) {
    if (!this.ctx) return inputNode;

    // 1. High-Pass Filter: Cuts off sub-bass rumble (< 320 Hz)
    const highpass = this.ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(320, this.ctx.currentTime);
    highpass.Q.setValueAtTime(0.8, this.ctx.currentTime);

    // 2. Presence Peaking Filter: Boosts speech clarity (2.2 kHz)
    const presence = this.ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.setValueAtTime(2200, this.ctx.currentTime);
    presence.gain.setValueAtTime(5.0, this.ctx.currentTime);
    presence.Q.setValueAtTime(1.2, this.ctx.currentTime);

    // 3. Low-Pass Filter: Sharp RF bandwidth cutoff (> 3400 Hz)
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    let lpFreq = 3400;
    if (this.settings.filterMode === 'vintage') lpFreq = 2800;
    if (this.settings.filterMode === 'lofi') lpFreq = 2200;
    lowpass.frequency.setValueAtTime(lpFreq, this.ctx.currentTime);
    lowpass.Q.setValueAtTime(1.4, this.ctx.currentTime);

    // 4. WaveShaper Distortion (analog transmitter clipping)
    const waveshaper = this.ctx.createWaveShaper();
    waveshaper.curve = this.makeDistortionCurve(this.settings.distortion);
    waveshaper.oversample = '2x';

    // 5. Dynamic Range Compressor (AGC - Automatic Gain Control)
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
    compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

    // 6. Gain leveling
    const levelGain = this.ctx.createGain();
    levelGain.gain.setValueAtTime(this.settings.micGain, this.ctx.currentTime);

    // Connect chain:
    // input -> highpass -> presence -> lowpass -> waveshaper -> compressor -> levelGain
    inputNode.connect(highpass);
    highpass.connect(presence);
    presence.connect(lowpass);
    lowpass.connect(waveshaper);
    waveshaper.connect(compressor);
    compressor.connect(levelGain);

    return levelGain;
  }

  // Setup user microphone stream
  async setupMicrophone() {
    await this.init();

    if (this.micStream) {
      return this.micStream;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // We handle radio filtering ourselves
          autoGainControl: true
        },
        video: false
      });

      this.micSource = this.ctx.createMediaStreamSource(this.micStream);

      // Create processed stream destination for WebRTC
      this.processedDestination = this.ctx.createMediaStreamDestination();

      // Pass mic through radio DSP chain
      const processedOutput = this.createRadioDSPChain(this.micSource);

      // Connect to WebRTC processed stream destination
      processedOutput.connect(this.processedDestination);

      return this.micStream;
    } catch (err) {
      console.warn('Microphone permission or hardware access issue:', err);
      throw err;
    }
  }

  // Returns the processed audio stream to send via WebRTC
  getProcessedStream() {
    if (this.processedDestination) {
      return this.processedDestination.stream;
    }
    return this.micStream;
  }

  // Play incoming audio received from network
  playIncomingAudioBuffer(arrayBuffer) {
    if (!this.ctx || !arrayBuffer) return;

    this.ctx.decodeAudioData(arrayBuffer.slice(0), (decodedData) => {
      const source = this.ctx.createBufferSource();
      source.buffer = decodedData;

      // Pass through radio DSP filter for authentic speaker sound
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1700;
      filter.Q.value = 1.0;

      source.connect(filter);
      filter.connect(this.masterGain);

      source.start();
    }, (err) => {
      console.warn('Error decoding incoming radio audio:', err);
    });
  }

  // Emergency Siren (tactical two-tone 10-33 alert)
  toggleEmergencyAlarm(start) {
    if (!this.ctx) return;

    if (!start) {
      if (this.alarmInterval) {
        clearInterval(this.alarmInterval);
        this.alarmInterval = null;
      }
      if (this.alarmGain) {
        this.alarmGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
      if (this.alarmOsc) {
        this.alarmOsc.stop();
        this.alarmOsc = null;
      }
      this.isAlarmActive = false;
      return;
    }

    if (this.isAlarmActive) return;
    this.isAlarmActive = true;

    this.alarmOsc = this.ctx.createOscillator();
    this.alarmGain = this.ctx.createGain();

    this.alarmOsc.type = 'sawtooth';
    this.alarmOsc.frequency.setValueAtTime(960, this.ctx.currentTime);

    this.alarmGain.gain.setValueAtTime(0.25, this.ctx.currentTime);

    // Bandpass for harsh tactical horn sound
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
    filter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    this.alarmOsc.connect(filter);
    filter.connect(this.alarmGain);
    this.alarmGain.connect(this.masterGain);

    this.alarmOsc.start();

    // Alternate between 960Hz and 770Hz every 250ms
    let high = true;
    this.alarmInterval = setInterval(() => {
      if (!this.alarmOsc || !this.ctx) return;
      const targetFreq = high ? 770 : 960;
      high = !high;
      this.alarmOsc.frequency.setValueAtTime(targetFreq, this.ctx.currentTime);
    }, 250);
  }

  // CW Morse Keyer (800Hz clean sinusoidal keying)
  setCWKey(pressed, freq = 800) {
    if (!this.ctx) return;

    if (pressed) {
      if (!this.cwOsc) {
        this.cwOsc = this.ctx.createOscillator();
        this.cwGain = this.ctx.createGain();

        this.cwOsc.type = 'sine';
        this.cwOsc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        this.cwGain.gain.setValueAtTime(0, this.ctx.currentTime);

        this.cwOsc.connect(this.cwGain);
        this.cwGain.connect(this.masterGain);

        this.cwOsc.start();
      }
      // 5ms smooth attack ramp
      this.cwGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.cwGain.gain.linearRampToValueAtTime(0.28, this.ctx.currentTime + 0.005);
    } else {
      if (this.cwGain) {
        // 5ms smooth decay ramp
        this.cwGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.cwGain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.005);
      }
    }
  }

  // Heterodyne radio collision squeal (when 2 people key mic simultaneously)
  setHeterodyneCollision(active) {
    if (!this.ctx) return;

    if (active) {
      if (!this.heterodyneOsc) {
        this.heterodyneOsc = this.ctx.createOscillator();
        this.heterodyneGain = this.ctx.createGain();

        // 1850 Hz warbling heterodyne carrier squeal
        this.heterodyneOsc.type = 'sawtooth';
        this.heterodyneOsc.frequency.setValueAtTime(1850, this.ctx.currentTime);

        this.heterodyneGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

        this.heterodyneOsc.connect(this.heterodyneGain);
        this.heterodyneGain.connect(this.masterGain);
        this.heterodyneOsc.start();
      }
    } else {
      if (this.heterodyneGain && this.heterodyneOsc) {
        this.heterodyneGain.gain.setValueAtTime(0, this.ctx.currentTime);
        this.heterodyneOsc.stop();
        this.heterodyneOsc = null;
        this.heterodyneGain = null;
      }
    }
  }

  // Get visualizer byte frequency data for LCD screen
  getFrequencyData(array) {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(array);
    }
  }

  // Built-in tactical voice transmission synthesizer (for quick test broadcasts)
  speakTacticalTransmission(text, onStart, onEnd) {
    if (!('speechSynthesis' in window)) {
      console.warn('Speech synthesis not available');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;

    // Pick an English voice if available
    const voices = window.speechSynthesis.getVoices();
    const engVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Alex')));
    if (engVoice) utterance.voice = engVoice;

    utterance.onstart = () => {
      this.playMicClick(true);
      this.playSquelchBurst(true);
      if (onStart) onStart();
    };

    utterance.onend = () => {
      this.playMicClick(false);
      this.playRogerBeep();
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
  }
}

// Export singleton instance
window.audioEngine = new AudioEngine();
