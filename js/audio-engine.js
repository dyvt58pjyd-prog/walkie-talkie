/**
 * ADVANCED WALKIE-TALKIE WEB AUDIO ENGINE
 * - Authentic 300Hz-3400Hz telecommunications bandpass filtration
 * - Analog RF harmonic saturation & wave-shaper
 * - Real-time continuous 16-bit PCM streaming (Ultra-low latency, zero-gap)
 * - Jitter-buffered continuous audio queue playback
 * - Hardware mic switch clicks & realistic Roger Beeps
 * - Continuous atmospheric squelch hiss (Monitor mode)
 * - Dual analysers for TX (local mic) and RX (incoming radio)
 * - Transmission recorder & instant replay
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;

    // Master output & visualizer nodes
    this.masterGain = null;
    this.analyser = null;
    this.speakerFilter = null;

    // Mic processing nodes
    this.micStream = null;
    this.micSource = null;
    this.processedRadioOutput = null;
    this.micProcessor = null;
    this.micAnalyser = null;
    this.currentMicLevel = 0;
    this.isTransmitting = false;

    // Continuous streaming playback queue
    this.nextPacketTime = 0;
    this.currentRxPCMChunks = [];
    this.lastReplayBuffer = null;

    // Squelch & static noise generator
    this.noiseNode = null;
    this.noiseGain = null;
    this.isMonitorActive = false;

    // Morse CW tone
    this.cwOsc = null;
    this.cwGain = null;

    // Emergency alarm
    this.alarmOsc = null;
    this.alarmGain = null;
    this.alarmInterval = null;
    this.isAlarmActive = false;

    // Heterodyne collision tone
    this.heterodyneOsc = null;
    this.heterodyneGain = null;

    // Settings
    this.settings = {
      volume: 0.85,
      squelchLevel: 3,
      filterMode: 'tactical', // tactical, vintage, lofi
      distortion: 15,
      rogerBeep: 'motorola',
      micGain: 1.3
    };
  }

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

    // Master Analyser (for RX incoming audio)
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.smoothingTimeConstant = 0.7;
    this.masterGain.connect(this.analyser);

    // Radio speaker bandpass filter
    this.speakerFilter = this.ctx.createBiquadFilter();
    this.speakerFilter.type = 'bandpass';
    this.speakerFilter.frequency.setValueAtTime(1750, this.ctx.currentTime);
    this.speakerFilter.Q.setValueAtTime(1.1, this.ctx.currentTime);
    this.speakerFilter.connect(this.masterGain);

    // Atmospheric static noise generator
    this.setupStaticNoiseGenerator();

    this.isInitialized = true;
    console.log('📻 Audio Engine ready');
  }

  setVolume(val) {
    this.settings.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.05);
    }
  }

  // Pre-initialize microphone so first PTT press is instantaneous
  async setupMicrophone() {
    await this.init();

    if (this.micStream && this.micStream.active) {
      return this.micStream;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true
        },
        video: false
      });

      this.micSource = this.ctx.createMediaStreamSource(this.micStream);

      // Local mic analyser for LCD visualizer during TX
      this.micAnalyser = this.ctx.createAnalyser();
      this.micAnalyser.fftSize = 64;
      this.micAnalyser.smoothingTimeConstant = 0.6;

      // Pass through radio DSP chain
      this.processedRadioOutput = this.createRadioDSPChain(this.micSource);
      this.processedRadioOutput.connect(this.micAnalyser);

      return this.micStream;
    } catch (err) {
      console.warn('Microphone access notice:', err.message);
      throw err;
    }
  }

  // Continuous Live Audio Capture via ScriptProcessor (16-bit PCM streaming)
  startContinuousAudioCapture(onAudioPacket) {
    if (!this.ctx || !this.micStream) return;

    this.stopContinuousAudioCapture();
    this.isTransmitting = true;

    // Buffer size 2048 gives ~46ms of audio per packet at 44.1kHz
    const bufferSize = 2048;
    this.micProcessor = this.ctx.createScriptProcessor(bufferSize, 1, 1);

    // Dummy mute node to keep processor ticking without local loopback echo
    const muteNode = this.ctx.createGain();
    muteNode.gain.value = 0;

    const sourceNode = this.processedRadioOutput || this.micSource;
    sourceNode.connect(this.micProcessor);
    this.micProcessor.connect(muteNode);
    muteNode.connect(this.ctx.destination);

    this.micProcessor.onaudioprocess = (e) => {
      if (!this.isTransmitting) return;

      const input = e.inputBuffer.getChannelData(0);

      // Convert Float32Array to 16-bit PCM Int16Array
      const pcm = new Int16Array(input.length);
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        sum += Math.abs(s);
      }

      this.currentMicLevel = sum / input.length;

      if (onAudioPacket) {
        onAudioPacket(pcm.buffer);
      }
    };
  }

  stopContinuousAudioCapture() {
    this.isTransmitting = false;
    this.currentMicLevel = 0;
    if (this.micProcessor) {
      this.micProcessor.onaudioprocess = null;
      try {
        this.micProcessor.disconnect();
      } catch (e) {}
      this.micProcessor = null;
    }
  }

  // Play Live Audio PCM Packet with seamless queue scheduling
  playIncomingPCMPacket(arrayBuffer) {
    if (!this.ctx || !arrayBuffer) return;

    // Keep packet for instant replay
    this.currentRxPCMChunks.push(arrayBuffer);

    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = this.ctx.createBuffer(1, float32.length, this.ctx.sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;

    source.connect(this.speakerFilter);

    const now = this.ctx.currentTime;
    if (this.nextPacketTime < now) {
      this.nextPacketTime = now + 0.025; // 25ms initial jitter buffer
    }

    source.start(this.nextPacketTime);
    this.nextPacketTime += audioBuffer.duration;
  }

  resetIncomingAudioStream() {
    this.currentRxPCMChunks = [];
    if (this.ctx) {
      this.nextPacketTime = this.ctx.currentTime;
    }
  }

  finalizeIncomingAudioStream() {
    if (this.currentRxPCMChunks.length > 0 && this.ctx) {
      // Assemble full AudioBuffer for Instant Replay
      try {
        let totalSamples = 0;
        this.currentRxPCMChunks.forEach(chunk => {
          totalSamples += chunk.byteLength / 2;
        });

        const fullBuffer = this.ctx.createBuffer(1, totalSamples, this.ctx.sampleRate);
        const channelData = fullBuffer.getChannelData(0);

        let offset = 0;
        this.currentRxPCMChunks.forEach(chunk => {
          const int16 = new Int16Array(chunk);
          for (let i = 0; i < int16.length; i++) {
            channelData[offset++] = int16[i] / 32768.0;
          }
        });

        this.lastReplayBuffer = fullBuffer;
      } catch (err) {
        console.warn('Error assembling replay audio buffer:', err);
      }
    }
  }

  // Replay Last Received Transmission
  replayLastTransmission() {
    if (!this.lastReplayBuffer || !this.ctx) {
      this.playRogerBeep('twotone');
      return false;
    }

    this.playMicClick(true);
    this.playSquelchBurst(true);

    const source = this.ctx.createBufferSource();
    source.buffer = this.lastReplayBuffer;
    source.connect(this.speakerFilter);

    source.onended = () => {
      this.playRogerBeep('motorola');
    };

    source.start(this.ctx.currentTime + 0.05);
    return true;
  }

  // Radio DSP Filter Chain
  createRadioDSPChain(inputNode) {
    if (!this.ctx) return inputNode;

    const highpass = this.ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(320, this.ctx.currentTime);
    highpass.Q.setValueAtTime(0.8, this.ctx.currentTime);

    const presence = this.ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.setValueAtTime(2200, this.ctx.currentTime);
    presence.gain.setValueAtTime(5.0, this.ctx.currentTime);
    presence.Q.setValueAtTime(1.2, this.ctx.currentTime);

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    let lpFreq = 3400;
    if (this.settings.filterMode === 'vintage') lpFreq = 2800;
    if (this.settings.filterMode === 'lofi') lpFreq = 2200;
    lowpass.frequency.setValueAtTime(lpFreq, this.ctx.currentTime);
    lowpass.Q.setValueAtTime(1.4, this.ctx.currentTime);

    const waveshaper = this.ctx.createWaveShaper();
    waveshaper.curve = this.makeDistortionCurve(this.settings.distortion);
    waveshaper.oversample = '2x';

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
    compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

    const levelGain = this.ctx.createGain();
    levelGain.gain.setValueAtTime(this.settings.micGain, this.ctx.currentTime);

    inputNode.connect(highpass);
    highpass.connect(presence);
    presence.connect(lowpass);
    lowpass.connect(waveshaper);
    waveshaper.connect(compressor);
    compressor.connect(levelGain);

    return levelGain;
  }

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

  setupStaticNoiseGenerator() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2 + white * 0.5362) * 0.11;
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;

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

  setStaticNoise(active, level = 0.15) {
    if (!this.noiseGain || !this.ctx) return;
    const target = active ? level : 0;
    this.noiseGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.noiseGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
    this.isMonitorActive = active;
  }

  playSquelchBurst(isKeyUp = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const duration = isKeyUp ? 0.05 : 0.14;

    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;

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

  playRogerBeep(type = null) {
    if (!this.ctx) return;
    const beepType = type || this.settings.rogerBeep;
    if (beepType === 'off') return;

    const now = this.ctx.currentTime;

    switch (beepType) {
      case 'motorola': {
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

        setTimeout(() => this.playSquelchBurst(false), 90);
        break;
      }

      case 'quindar': {
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
        [697, 1209].forEach(f => {
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

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
    filter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    this.alarmOsc.connect(filter);
    filter.connect(this.alarmGain);
    this.alarmGain.connect(this.masterGain);

    this.alarmOsc.start();

    let high = true;
    this.alarmInterval = setInterval(() => {
      if (!this.alarmOsc || !this.ctx) return;
      const targetFreq = high ? 770 : 960;
      high = !high;
      this.alarmOsc.frequency.setValueAtTime(targetFreq, this.ctx.currentTime);
    }, 250);
  }

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
      this.cwGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.cwGain.gain.linearRampToValueAtTime(0.28, this.ctx.currentTime + 0.005);
    } else {
      if (this.cwGain) {
        this.cwGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.cwGain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.005);
      }
    }
  }

  setHeterodyneCollision(active) {
    if (!this.ctx) return;

    if (active) {
      if (!this.heterodyneOsc) {
        this.heterodyneOsc = this.ctx.createOscillator();
        this.heterodyneGain = this.ctx.createGain();
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

  // Visualizer frequency data getter (switches between mic during TX, and master during RX)
  getFrequencyData(array) {
    if (this.isTransmitting && this.micAnalyser) {
      this.micAnalyser.getByteFrequencyData(array);
    } else if (this.analyser) {
      this.analyser.getByteFrequencyData(array);
    }
  }

  speakTacticalTransmission(text, onStart, onEnd) {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;

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

window.audioEngine = new AudioEngine();
