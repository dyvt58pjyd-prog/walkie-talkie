/**
 * RADIO UI CONTROLLER
 * Realistic Tactile Handheld Radio Physics & LCD Visuals
 */

class RadioUI {
  constructor() {
    this.powerOn = true;
    this.isTransmitting = false;
    this.isReceiving = false;
    this.isPttLocked = false;
    this.isScanning = false;
    this.scanInterval = null;
    this.isVoxActive = false;
    this.voxThreshold = 35; // Audio level threshold
    this.voxTimer = null;
    this.currentBacklight = 'amber'; // amber, emerald, cyan, red, mono
    this.batteryLevel = 94; // %
    this.signalStrength = 0; // 0 to 9

    // DOM Elements cache
    this.dom = {};
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.setupVisualizer();
    this.updateLCD();
    this.simulateBatteryDrain();
    this.setupVOXDetection();
  }

  cacheElements() {
    this.dom = {
      radioBody: document.getElementById('radioBody'),
      lcdScreen: document.getElementById('lcdScreen'),
      lcdFreq: document.getElementById('lcdFreq'),
      lcdChannel: document.getElementById('lcdChannel'),
      lcdSubtone: document.getElementById('lcdSubtone'),
      lcdSmeter: document.getElementById('lcdSmeter'),
      lcdSql: document.getElementById('lcdSql'),
      lcdStatus: document.getElementById('lcdStatus'),
      lcdBattery: document.getElementById('lcdBattery'),
      lcdCanvas: document.getElementById('lcdCanvas'),
      lcdVisualizerMode: document.getElementById('lcdVisualizerMode'),

      // LEDs
      ledTx: document.getElementById('ledTx'),
      ledRx: document.getElementById('ledRx'),
      ledPwr: document.getElementById('ledPwr'),

      // Knobs
      volKnob: document.getElementById('volKnob'),
      chanKnob: document.getElementById('chanKnob'),
      squelchKnob: document.getElementById('squelchKnob'),

      // Buttons
      btnPtt: document.getElementById('btnPtt'),
      btnPttLock: document.getElementById('btnPttLock'),
      btnMoni: document.getElementById('btnMoni'),
      btnScan: document.getElementById('btnScan'),
      btnAlarm: document.getElementById('btnAlarm'),
      btnVox: document.getElementById('btnVox'),
      btnReplay: document.getElementById('btnReplay'),
      btnCw: document.getElementById('btnCw'),
      btnTestVoice: document.getElementById('btnTestVoice'),

      // Drawers & Overlays
      drawerChannels: document.getElementById('drawerChannels'),
      drawerSettings: document.getElementById('drawerSettings'),
      drawerTenCodes: document.getElementById('drawerTenCodes'),
      drawerLogs: document.getElementById('drawerLogs'),
      modalQr: document.getElementById('modalQr'),

      // Lists & Counters
      channelGrid: document.getElementById('channelGrid'),
      operatorList: document.getElementById('operatorList'),
      txLogList: document.getElementById('txLogList'),
      channelSummaryBar: document.getElementById('channelSummaryBar')
    };
  }

  bindEvents() {
    // Spacebar PTT shortcut
    let spacePressed = false;
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space' && !spacePressed) {
        e.preventDefault();
        spacePressed = true;
        this.startPTT();
      }

      // Quick key for CW tone: 'M' or 'K'
      if (e.code === 'KeyM' && !e.repeat) {
        this.triggerCWKey(true);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space' && spacePressed) {
        e.preventDefault();
        spacePressed = false;
        if (!this.isPttLocked) {
          this.stopPTT();
        }
      }

      if (e.code === 'KeyM') {
        this.triggerCWKey(false);
      }
    });

    // PTT Button Mouse & Touch events
    const ptt = this.dom.btnPtt;
    if (ptt) {
      const handlePttDown = (e) => {
        e.preventDefault();
        if (this.isPttLocked) {
          this.isPttLocked = false;
          this.dom.btnPttLock.classList.remove('active');
          this.stopPTT();
        } else {
          this.startPTT();
        }
      };

      const handlePttUp = (e) => {
        e.preventDefault();
        if (!this.isPttLocked) {
          this.stopPTT();
        }
      };

      ptt.addEventListener('mousedown', handlePttDown);
      window.addEventListener('mouseup', handlePttUp);

      ptt.addEventListener('touchstart', handlePttDown, { passive: false });
      window.addEventListener('touchend', handlePttUp, { passive: false });
    }

    // PTT Lock toggle
    if (this.dom.btnPttLock) {
      this.dom.btnPttLock.addEventListener('click', () => {
        this.isPttLocked = !this.isPttLocked;
        this.dom.btnPttLock.classList.toggle('active', this.isPttLocked);
        if (this.isPttLocked) {
          this.startPTT();
        } else {
          this.stopPTT();
        }
      });
    }

    // MONI (Monitor Squelch) Button
    if (this.dom.btnMoni) {
      const startMoni = (e) => {
        e.preventDefault();
        window.audioEngine?.setStaticNoise(true, 0.18);
        this.dom.btnMoni.classList.add('active');
      };
      const stopMoni = (e) => {
        e.preventDefault();
        window.audioEngine?.setStaticNoise(false);
        this.dom.btnMoni.classList.remove('active');
      };
      this.dom.btnMoni.addEventListener('mousedown', startMoni);
      window.addEventListener('mouseup', stopMoni);
      this.dom.btnMoni.addEventListener('touchstart', startMoni, { passive: false });
      window.addEventListener('touchend', stopMoni, { passive: false });
    }

    // SCAN Button
    if (this.dom.btnScan) {
      this.dom.btnScan.addEventListener('click', () => {
        this.toggleChannelScan();
      });
    }

    // ALARM Button (Emergency siren)
    if (this.dom.btnAlarm) {
      this.dom.btnAlarm.addEventListener('click', () => {
        this.toggleEmergencyAlarm();
      });
    }

    // VOX Button
    if (this.dom.btnVox) {
      this.dom.btnVox.addEventListener('click', () => {
        this.isVoxActive = !this.isVoxActive;
        this.dom.btnVox.classList.toggle('active', this.isVoxActive);
        this.updateLCD();
      });
    }

    // REPLAY Button
    if (this.dom.btnReplay) {
      this.dom.btnReplay.addEventListener('click', () => {
        this.replayLastTransmission();
      });
    }

    // CW Key Button (Morse code key)
    if (this.dom.btnCw) {
      const handleCwDown = (e) => {
        e.preventDefault();
        this.triggerCWKey(true);
      };
      const handleCwUp = (e) => {
        e.preventDefault();
        this.triggerCWKey(false);
      };
      this.dom.btnCw.addEventListener('mousedown', handleCwDown);
      window.addEventListener('mouseup', handleCwUp);
      this.dom.btnCw.addEventListener('touchstart', handleCwDown, { passive: false });
      window.addEventListener('touchend', handleCwUp, { passive: false });
    }

    // TEST VOICE Button
    if (this.dom.btnTestVoice) {
      this.dom.btnTestVoice.addEventListener('click', () => {
        this.runTestVoiceTransmission();
      });
    }

    // Volume & Channel Knobs
    this.setupRotaryKnob(this.dom.volKnob, 0, 100, 85, (val) => {
      if (val === 0) {
        this.setPower(false);
      } else {
        if (!this.powerOn) this.setPower(true);
        window.audioEngine?.setVolume(val / 100);
      }
    });

    this.setupRotaryKnob(this.dom.chanKnob, 1, 16, 1, (channel) => {
      const ch = Math.round(channel);
      if (ch !== window.networkEngine?.currentChannel) {
        window.audioEngine?.playMicClick(true);
        window.networkEngine?.joinChannel(ch);
      }
    });

    this.setupRotaryKnob(this.dom.squelchKnob, 0, 9, 3, (val) => {
      const sql = Math.round(val);
      if (window.audioEngine) {
        window.audioEngine.settings.squelchLevel = sql;
      }
      this.updateLCD();
    });

    // Backlight Switcher
    const backlightBtn = document.getElementById('btnBacklight');
    if (backlightBtn) {
      backlightBtn.addEventListener('click', () => {
        this.cycleBacklightColor();
      });
    }
  }

  // Interactive Rotary Knob Helper with drag & mousewheel physics
  setupRotaryKnob(element, min, max, initialVal, onChange) {
    if (!element) return;
    let currentVal = initialVal;
    let startY = 0;
    let isDragging = false;

    const updateKnobRotation = (val) => {
      const percent = (val - min) / (max - min);
      const angle = -135 + percent * 270; // -135 deg to +135 deg
      element.style.transform = `rotate(${angle}deg)`;
    };

    updateKnobRotation(initialVal);

    element.addEventListener('mousedown', (e) => {
      isDragging = true;
      startY = e.clientY;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      startY = e.clientY;
      const step = (max - min) / 80;
      currentVal = Math.max(min, Math.min(max, currentVal + deltaY * step));
      updateKnobRotation(currentVal);
      if (onChange) onChange(currentVal);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Mouse wheel support
    element.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = (max - min) / 25;
      const dir = e.deltaY < 0 ? 1 : -1;
      currentVal = Math.max(min, Math.min(max, currentVal + dir * step));
      updateKnobRotation(currentVal);
      if (onChange) onChange(currentVal);
    });
  }

  setPower(on) {
    this.powerOn = on;
    if (this.dom.ledPwr) {
      this.dom.ledPwr.classList.toggle('active', on);
    }
    if (this.dom.radioBody) {
      this.dom.radioBody.classList.toggle('powered-off', !on);
    }
    if (this.dom.lcdScreen) {
      this.dom.lcdScreen.classList.toggle('powered-off', !on);
    }
    if (on) {
      window.audioEngine?.playSquelchBurst(true);
    } else {
      window.audioEngine?.setStaticNoise(false);
      this.stopPTT();
    }
  }

  // Push-To-Talk Start
  async startPTT() {
    if (!this.powerOn || this.isTransmitting) return;
    this.isTransmitting = true;

    // Init audio engine on user interaction
    await window.audioEngine?.init();

    // Check if mic stream is ready
    let stream = null;
    try {
      stream = await window.audioEngine?.setupMicrophone();
    } catch (e) {
      console.warn('Microphone not available, using simulated RF carrier:', e);
    }

    // Play hardware tactile mic switch click & key-up burst
    window.audioEngine?.playMicClick(true);
    window.audioEngine?.playSquelchBurst(true);

    // Light up Red TX LED & active PTT styling
    if (this.dom.ledTx) this.dom.ledTx.classList.add('active');
    if (this.dom.btnPtt) this.dom.btnPtt.classList.add('pressed');

    // Inform Network Engine
    window.networkEngine?.startTransmission(stream);

    this.updateLCD();
  }

  // Push-To-Talk Stop
  stopPTT() {
    if (!this.isTransmitting) return;
    this.isTransmitting = false;

    // Turn off TX LED & unpress button
    if (this.dom.ledTx) this.dom.ledTx.classList.remove('active');
    if (this.dom.btnPtt) this.dom.btnPtt.classList.remove('pressed');

    // Play hardware release click & Roger Beep sound
    window.audioEngine?.playMicClick(false);
    window.audioEngine?.playRogerBeep();

    // Inform Network Engine
    const stream = window.audioEngine?.micStream;
    window.networkEngine?.stopTransmission(stream, window.audioEngine?.settings.rogerBeep);

    this.updateLCD();
  }

  // Incoming Transmission Started by another peer
  onIncomingTransmissionStart(data) {
    this.isReceiving = true;
    if (this.dom.ledRx) this.dom.ledRx.classList.add('active');

    // Squelch burst on receiving carrier
    window.audioEngine?.playSquelchBurst(true);

    // If collision (2 people transmitting at same time)
    if (data.isCollision) {
      window.audioEngine?.setHeterodyneCollision(true);
    }

    this.signalStrength = 9;
    this.updateLCD(data.callsign);
  }

  // Incoming Transmission Ended by peer
  onIncomingTransmissionEnd(data) {
    this.isReceiving = false;
    if (this.dom.ledRx) this.dom.ledRx.classList.remove('active');

    // Turn off heterodyne collision sound
    window.audioEngine?.setHeterodyneCollision(false);

    // Play Roger Beep + Squelch tail of incoming transmission
    window.audioEngine?.playRogerBeep(data.rogerBeepType || 'motorola');

    this.signalStrength = 0;
    this.updateLCD();
  }

  // Emergency Siren
  toggleEmergencyAlarm() {
    const isNowActive = !this.isAlarmActive;
    this.isAlarmActive = isNowActive;
    this.dom.btnAlarm?.classList.toggle('active', isNowActive);

    window.audioEngine?.toggleEmergencyAlarm(isNowActive);
    window.networkEngine?.sendEmergencyAlert(isNowActive);

    if (isNowActive) {
      // Auto-switch to Emergency Channel 9 if not already there
      if (window.networkEngine?.currentChannel !== 9) {
        window.networkEngine?.joinChannel(9);
      }
    }
  }

  // CW Morse Key
  triggerCWKey(pressed) {
    if (!this.powerOn) return;
    window.audioEngine?.setCWKey(pressed, 800);
    window.networkEngine?.sendCWKey(pressed, 800);
    if (this.dom.btnCw) {
      this.dom.btnCw.classList.toggle('pressed', pressed);
    }
    if (this.dom.ledTx) {
      this.dom.ledTx.classList.toggle('active', pressed);
    }
  }

  // Automated Channel Scanning
  toggleChannelScan() {
    this.isScanning = !this.isScanning;
    this.dom.btnScan?.classList.toggle('active', this.isScanning);

    if (!this.isScanning) {
      if (this.scanInterval) clearInterval(this.scanInterval);
      this.scanInterval = null;
      this.updateLCD();
      return;
    }

    // Step through channels every 700ms
    let scanChannel = window.networkEngine?.currentChannel || 1;
    this.scanInterval = setInterval(() => {
      scanChannel = (scanChannel % 16) + 1;

      // Check if this channel has active transmission or users
      const summary = window.networkEngine?.channelSummary?.[scanChannel];
      const hasActivity = summary && (summary.activeTx || summary.count > 0);

      window.networkEngine?.joinChannel(scanChannel);
      window.audioEngine?.playMicClick(true);

      if (hasActivity && summary.activeTx) {
        // Found active broadcast! Pause scan
        console.log(`📡 Scanner caught activity on CH ${scanChannel}!`);
        this.toggleChannelScan();
      }
    }, 700);

    this.updateLCD();
  }

  // VOX (Voice-Activated Transmission) detection loop
  setupVOXDetection() {
    const checkVoiceLevel = () => {
      if (this.isVoxActive && this.powerOn && window.audioEngine?.analyser) {
        const data = new Uint8Array(window.audioEngine.analyser.frequencyBinCount);
        window.audioEngine.analyser.getByteFrequencyData(data);

        // Calculate average speech frequency energy (300Hz - 2500Hz)
        let sum = 0;
        const count = Math.min(data.length, 30);
        for (let i = 2; i < count; i++) {
          sum += data[i];
        }
        const avg = sum / (count - 2);

        if (avg > this.voxThreshold) {
          if (!this.isTransmitting) {
            this.startPTT();
          }
          if (this.voxTimer) clearTimeout(this.voxTimer);
          // Hold transmission for 600ms of silence
          this.voxTimer = setTimeout(() => {
            if (this.isTransmitting && this.isVoxActive) {
              this.stopPTT();
            }
          }, 600);
        }
      }
      requestAnimationFrame(checkVoiceLevel);
    };
    requestAnimationFrame(checkVoiceLevel);
  }

  // Replay Last Received Transmission
  replayLastTransmission() {
    const last = window.networkEngine?.lastReceivedTransmission;
    if (!last || !last.audioUrl) {
      // Play a quick alert if nothing recorded yet
      window.audioEngine?.playRogerBeep('twotone');
      alert('No transmission recorded yet. Wait for someone to talk on the channel!');
      return;
    }

    // Play with radio burst and sound
    window.audioEngine?.playMicClick(true);
    window.audioEngine?.playSquelchBurst(true);

    const audio = new Audio(last.audioUrl);
    audio.play();

    audio.onended = () => {
      window.audioEngine?.playRogerBeep('motorola');
    };
  }

  // Built-in Tactical Voice Test
  runTestVoiceTransmission() {
    const testPhrases = [
      "Bravo Six, checking in on primary frequency, all stations copy, over.",
      "Command this is Recon Charlie, perimeter secure, ten-four.",
      "Radio check on channel one, audio loud and clear, out.",
      "Mayday, tactical alert on channel nine, requesting backup, over!"
    ];
    const phrase = testPhrases[Math.floor(Math.random() * testPhrases.length)];

    this.startPTT();
    window.audioEngine?.speakTacticalTransmission(phrase,
      () => {},
      () => {
        this.stopPTT();
      }
    );
  }

  // Cycle LCD Backlight Color (Amber, Emerald Green, Cyan, Red, Monochrome)
  cycleBacklightColor() {
    const colors = ['amber', 'emerald', 'cyan', 'red', 'mono'];
    const currentIdx = colors.indexOf(this.currentBacklight);
    this.currentBacklight = colors[(currentIdx + 1) % colors.length];

    if (this.dom.lcdScreen) {
      colors.forEach(c => this.dom.lcdScreen.classList.remove(`theme-${c}`));
      this.dom.lcdScreen.classList.add(`theme-${this.currentBacklight}`);
    }
  }

  // Update dynamic LCD display
  updateLCD(incomingCallsign = null) {
    if (!this.powerOn) return;

    const chNum = window.networkEngine?.currentChannel || 1;
    const chInfo = window.networkEngine?.channels?.[chNum] || { freq: '462.5625', ctcss: '67.0 Hz' };

    if (this.dom.lcdChannel) {
      this.dom.lcdChannel.textContent = `CH ${chNum < 10 ? '0' + chNum : chNum}`;
    }

    if (this.dom.chanKnob) {
      const percent = (chNum - 1) / 15;
      const angle = -135 + percent * 270;
      this.dom.chanKnob.style.transform = `rotate(${angle}deg)`;
    }

    if (this.dom.lcdSql) {
      const sqlVal = window.audioEngine?.settings?.squelchLevel ?? 3;
      this.dom.lcdSql.textContent = `SQL: ${sqlVal === 0 ? 'OPEN' : sqlVal}`;
    }

    if (this.dom.lcdFreq) {
      this.dom.lcdFreq.textContent = `${chInfo.freq} MHz`;
    }

    if (this.dom.lcdSubtone) {
      this.dom.lcdSubtone.textContent = `DCS ${chInfo.ctcss}`;
    }

    if (this.dom.lcdStatus) {
      let statusText = 'FM NARROW';
      if (this.isTransmitting) statusText = 'TX ACTIVE';
      else if (this.isReceiving) statusText = `RX: ${incomingCallsign || 'OPERATOR'}`;
      else if (this.isScanning) statusText = 'SCANNING...';
      else if (this.isVoxActive) statusText = 'VOX ON';

      this.dom.lcdStatus.textContent = statusText;
    }

    // Dynamic S-Meter (Signal Strength)
    if (this.dom.lcdSmeter) {
      const bars = this.isTransmitting ? 9 : (this.isReceiving ? 8 : (this.signalStrength || 1));
      let smeterStr = 'S: ';
      for (let i = 1; i <= 9; i++) {
        smeterStr += i <= bars ? '▮' : '▯';
      }
      this.dom.lcdSmeter.textContent = smeterStr;
    }

    // Battery level
    if (this.dom.lcdBattery) {
      const bars = Math.ceil(this.batteryLevel / 20);
      let batStr = `7.4V [${'■'.repeat(bars)}${'□'.repeat(5 - bars)}]`;
      this.dom.lcdBattery.textContent = batStr;
    }
  }

  // Subtle realistic battery fluctuation
  simulateBatteryDrain() {
    setInterval(() => {
      if (this.powerOn && this.batteryLevel > 5) {
        if (this.isTransmitting) {
          this.batteryLevel -= 0.15; // Higher drain during TX
        } else {
          this.batteryLevel -= 0.01;
        }
        this.updateLCD();
      }
    }, 15000);
  }

  // Real-time Audio Spectrum & Oscilloscope visualizer on LCD Screen
  setupVisualizer() {
    const canvas = this.dom.lcdCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const render = () => {
      requestAnimationFrame(render);
      if (!this.powerOn) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // LCD Pixel grid background
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 4) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      if (window.audioEngine && window.audioEngine.analyser && (this.isTransmitting || this.isReceiving || window.audioEngine.isMonitorActive)) {
        const bufferLength = window.audioEngine.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        window.audioEngine.analyser.getByteFrequencyData(dataArray);

        // Draw segmented LCD matrix bars
        const numBars = 16;
        const barWidth = Math.floor(width / numBars) - 2;

        for (let i = 0; i < numBars; i++) {
          const val = dataArray[i * 2] || 0;
          const barHeight = Math.floor((val / 255) * height);
          const x = i * (barWidth + 2);

          // Draw segmented blocks
          const segmentSize = 3;
          const numSegments = Math.floor(barHeight / (segmentSize + 1));

          for (let s = 0; s < numSegments; s++) {
            const y = height - (s + 1) * (segmentSize + 1);
            ctx.fillStyle = 'rgba(20, 25, 20, 0.85)';
            ctx.fillRect(x, y, barWidth, segmentSize);
          }
        }
      } else {
        // Idle heartbeat blip
        const time = Date.now() / 800;
        const x = (Math.sin(time) * 0.5 + 0.5) * (width - 10);
        ctx.fillStyle = 'rgba(20, 25, 20, 0.4)';
        ctx.fillRect(x, height - 4, 8, 2);
      }
    };
    render();
  }
}

window.radioUI = new RadioUI();
