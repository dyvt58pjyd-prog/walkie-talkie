/**
 * RADIO UI CONTROLLER
 * Realistic Tactile Handheld Radio Physics & LCD Visuals
 * - Robust continuous PTT holding with Pointer Events (no dropoffs on drag/touch)
 * - Live mic volume analysis & real-time LCD visualizer during TX
 * - Instant S-meter responsiveness
 * - Seamless VOX hands-free mode
 */

class RadioUI {
  constructor() {
    this.powerOn = true;
    this.isTransmitting = false;
    this.isReceiving = false;
    this.isPttHeld = false;
    this.isPttLocked = false;
    this.isScanning = false;
    this.scanInterval = null;
    this.isVoxActive = false;
    this.voxThreshold = 35;
    this.voxTimer = null;
    this.currentBacklight = 'amber';
    this.batteryLevel = 94;
    this.signalStrength = 0;

    this.dom = {};
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.setupVisualizer();
    this.updateLCD();
    this.simulateBatteryDrain();
    this.setupVOXDetection();
    this.setupPrewarmMic();
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

      // Lists & Containers
      channelGrid: document.getElementById('channelGrid'),
      operatorList: document.getElementById('operatorList'),
      txLogList: document.getElementById('txLogList')
    };
  }

  // Pre-initialize microphone on first click anywhere so PTT is instantaneous
  setupPrewarmMic() {
    const prewarm = async () => {
      window.removeEventListener('pointerdown', prewarm);
      window.removeEventListener('keydown', prewarm);
      try {
        await window.audioEngine?.init();
        await window.audioEngine?.setupMicrophone();
      } catch (e) {
        // Will prompt when user presses PTT
      }
    };
    window.addEventListener('pointerdown', prewarm, { once: true });
    window.addEventListener('keydown', prewarm, { once: true });
  }

  bindEvents() {
    // 1. Spacebar PTT Shortcut (Continuous hold until keyup)
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space' && !e.repeat && !this.isPttHeld) {
        e.preventDefault();
        this.isPttHeld = true;
        this.startPTT();
      }

      if (e.code === 'KeyM' && !e.repeat) {
        this.triggerCWKey(true);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space' && this.isPttHeld) {
        e.preventDefault();
        this.isPttHeld = false;
        if (!this.isPttLocked) {
          this.stopPTT();
        }
      }

      if (e.code === 'KeyM') {
        this.triggerCWKey(false);
      }
    });

    // Window blur safety: release PTT if window loses focus
    window.addEventListener('blur', () => {
      if (this.isPttHeld && !this.isPttLocked) {
        this.isPttHeld = false;
        this.stopPTT();
      }
    });

    // 2. Heavy-Duty PTT Button: Pointer Events with PointerCapture
    // Ensures voice continues even if pointer/mouse moves outside the button!
    const ptt = this.dom.btnPtt;
    if (ptt) {
      ptt.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          ptt.setPointerCapture(e.pointerId);
        } catch (err) {}

        if (this.isPttLocked) {
          // If locked, clicking again unlocks and ends TX
          this.isPttLocked = false;
          this.dom.btnPttLock?.classList.remove('active');
          this.isPttHeld = false;
          this.stopPTT();
          return;
        }

        this.isPttHeld = true;
        this.startPTT();
      });

      ptt.addEventListener('pointerup', (e) => {
        e.preventDefault();
        try {
          ptt.releasePointerCapture(e.pointerId);
        } catch (err) {}

        this.isPttHeld = false;
        if (!this.isPttLocked) {
          this.stopPTT();
        }
      });

      ptt.addEventListener('pointercancel', (e) => {
        e.preventDefault();
        this.isPttHeld = false;
        if (!this.isPttLocked) {
          this.stopPTT();
        }
      });

      // Prevent mobile long-press context menu
      ptt.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // 3. Hands-Free PTT Lock Button
    if (this.dom.btnPttLock) {
      this.dom.btnPttLock.addEventListener('click', () => {
        this.isPttLocked = !this.isPttLocked;
        this.dom.btnPttLock.classList.toggle('active', this.isPttLocked);
        if (this.isPttLocked) {
          this.startPTT();
        } else {
          this.isPttHeld = false;
          this.stopPTT();
        }
      });
    }

    // 4. MONI (Monitor Squelch) Button
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
      this.dom.btnMoni.addEventListener('pointerdown', startMoni);
      window.addEventListener('pointerup', stopMoni);
    }

    // 5. SCAN Button
    if (this.dom.btnScan) {
      this.dom.btnScan.addEventListener('click', () => {
        this.toggleChannelScan();
      });
    }

    // 6. ALARM Button
    if (this.dom.btnAlarm) {
      this.dom.btnAlarm.addEventListener('click', () => {
        this.toggleEmergencyAlarm();
      });
    }

    // 7. VOX Button
    if (this.dom.btnVox) {
      this.dom.btnVox.addEventListener('click', () => {
        this.isVoxActive = !this.isVoxActive;
        this.dom.btnVox.classList.toggle('active', this.isVoxActive);
        this.updateLCD();
      });
    }

    // 8. REPLAY Button
    if (this.dom.btnReplay) {
      this.dom.btnReplay.addEventListener('click', () => {
        this.replayLastTransmission();
      });
    }

    // 9. CW Key Button (Morse Code)
    if (this.dom.btnCw) {
      this.dom.btnCw.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.triggerCWKey(true);
      });
      window.addEventListener('pointerup', () => {
        if (this.dom.btnCw?.classList.contains('pressed')) {
          this.triggerCWKey(false);
        }
      });
    }

    // 10. TEST VOICE Button
    if (this.dom.btnTestVoice) {
      this.dom.btnTestVoice.addEventListener('click', () => {
        this.runTestVoiceTransmission();
      });
    }

    // 11. Rotary Knobs
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

    // 12. LCD Backlight switcher
    const backlightBtn = document.getElementById('btnBacklight');
    if (backlightBtn) {
      backlightBtn.addEventListener('click', () => {
        this.cycleBacklightColor();
      });
    }
  }

  // Rotary Knob Drag & Wheel Helper
  setupRotaryKnob(element, min, max, initialVal, onChange) {
    if (!element) return;
    let currentVal = initialVal;
    let startY = 0;
    let isDragging = false;

    const updateKnobRotation = (val) => {
      const percent = (val - min) / (max - min);
      const angle = -135 + percent * 270;
      element.style.transform = `rotate(${angle}deg)`;
    };

    updateKnobRotation(initialVal);

    element.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startY = e.clientY;
      element.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    window.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      startY = e.clientY;
      const step = (max - min) / 75;
      currentVal = Math.max(min, Math.min(max, currentVal + deltaY * step));
      updateKnobRotation(currentVal);
      if (onChange) onChange(currentVal);
    });

    window.addEventListener('pointerup', () => {
      isDragging = false;
    });

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
    if (this.dom.ledPwr) this.dom.ledPwr.classList.toggle('active', on);
    if (this.dom.radioBody) this.dom.radioBody.classList.toggle('powered-off', !on);
    if (this.dom.lcdScreen) this.dom.lcdScreen.classList.toggle('powered-off', !on);

    if (on) {
      window.audioEngine?.playSquelchBurst(true);
    } else {
      window.audioEngine?.setStaticNoise(false);
      this.stopPTT();
    }
  }

  // Push-To-Talk Start (Continuous live audio)
  async startPTT() {
    if (!this.powerOn || this.isTransmitting) return;

    // Instant tactile feedback
    window.audioEngine?.playMicClick(true);
    if (this.dom.ledTx) this.dom.ledTx.classList.add('active');
    if (this.dom.btnPtt) this.dom.btnPtt.classList.add('pressed');
    this.isTransmitting = true;

    try {
      await window.audioEngine?.init();
      await window.audioEngine?.setupMicrophone();
    } catch (e) {
      console.warn('Microphone not available:', e.message);
    }

    // Safety check: if user released button while mic was preparing, cancel
    if (!this.isPttHeld && !this.isPttLocked) {
      this.stopPTT();
      return;
    }

    window.audioEngine?.playSquelchBurst(true);

    // Start continuous live PCM streaming
    window.networkEngine?.startTransmission();

    this.updateLCD();
  }

  // Push-To-Talk Stop
  stopPTT() {
    if (!this.isTransmitting) return;
    this.isTransmitting = false;

    if (this.dom.ledTx) this.dom.ledTx.classList.remove('active');
    if (this.dom.btnPtt) this.dom.btnPtt.classList.remove('pressed');

    window.audioEngine?.playMicClick(false);
    window.audioEngine?.playRogerBeep();

    window.networkEngine?.stopTransmission(window.audioEngine?.settings.rogerBeep);

    this.updateLCD();
  }

  // Incoming Transmission Started by another peer
  onIncomingTransmissionStart(data) {
    this.isReceiving = true;
    if (this.dom.ledRx) this.dom.ledRx.classList.add('active');

    window.audioEngine?.playSquelchBurst(true);

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

    window.audioEngine?.setHeterodyneCollision(false);
    window.audioEngine?.playRogerBeep(data.rogerBeepType || 'motorola');

    this.signalStrength = 0;
    this.updateLCD();
  }

  toggleEmergencyAlarm() {
    const isNowActive = !this.isAlarmActive;
    this.isAlarmActive = isNowActive;
    this.dom.btnAlarm?.classList.toggle('active', isNowActive);

    window.audioEngine?.toggleEmergencyAlarm(isNowActive);
    window.networkEngine?.sendEmergencyAlert(isNowActive);

    if (isNowActive && window.networkEngine?.currentChannel !== 9) {
      window.networkEngine?.joinChannel(9);
    }
  }

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

  toggleChannelScan() {
    this.isScanning = !this.isScanning;
    this.dom.btnScan?.classList.toggle('active', this.isScanning);

    if (!this.isScanning) {
      if (this.scanInterval) clearInterval(this.scanInterval);
      this.scanInterval = null;
      this.updateLCD();
      return;
    }

    let scanChannel = window.networkEngine?.currentChannel || 1;
    this.scanInterval = setInterval(() => {
      scanChannel = (scanChannel % 16) + 1;
      const summary = window.networkEngine?.channelSummary?.[scanChannel];
      const hasActivity = summary && (summary.activeTx || summary.count > 0);

      window.networkEngine?.joinChannel(scanChannel);
      window.audioEngine?.playMicClick(true);

      if (hasActivity && summary.activeTx) {
        this.toggleChannelScan();
      }
    }, 700);

    this.updateLCD();
  }

  setupVOXDetection() {
    const checkVoiceLevel = () => {
      if (this.isVoxActive && this.powerOn && window.audioEngine?.micAnalyser) {
        const data = new Uint8Array(window.audioEngine.micAnalyser.frequencyBinCount);
        window.audioEngine.micAnalyser.getByteFrequencyData(data);

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
          this.voxTimer = setTimeout(() => {
            if (this.isTransmitting && this.isVoxActive && !this.isPttHeld) {
              this.stopPTT();
            }
          }, 650);
        }
      }
      requestAnimationFrame(checkVoiceLevel);
    };
    requestAnimationFrame(checkVoiceLevel);
  }

  replayLastTransmission() {
    const ok = window.audioEngine?.replayLastTransmission();
    if (!ok) {
      alert('No transmission recorded yet on this frequency.');
    }
  }

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

  cycleBacklightColor() {
    const colors = ['amber', 'emerald', 'cyan', 'red', 'mono'];
    const currentIdx = colors.indexOf(this.currentBacklight);
    this.currentBacklight = colors[(currentIdx + 1) % colors.length];

    if (this.dom.lcdScreen) {
      colors.forEach(c => this.dom.lcdScreen.classList.remove(`theme-${c}`));
      this.dom.lcdScreen.classList.add(`theme-${this.currentBacklight}`);
    }
  }

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

    // Dynamic S-Meter
    if (this.dom.lcdSmeter) {
      let bars = 1;
      if (this.isTransmitting) {
        const micVal = window.audioEngine?.currentMicLevel || 0;
        bars = Math.min(9, Math.max(3, Math.round(micVal * 25)));
      } else if (this.isReceiving) {
        bars = 8;
      }
      let smeterStr = 'S: ';
      for (let i = 1; i <= 9; i++) {
        smeterStr += i <= bars ? '▮' : '▯';
      }
      this.dom.lcdSmeter.textContent = smeterStr;
    }

    if (this.dom.lcdBattery) {
      const bars = Math.ceil(this.batteryLevel / 20);
      let batStr = `7.4V [${'■'.repeat(bars)}${'□'.repeat(5 - bars)}]`;
      this.dom.lcdBattery.textContent = batStr;
    }
  }

  simulateBatteryDrain() {
    setInterval(() => {
      if (this.powerOn && this.batteryLevel > 5) {
        if (this.isTransmitting) {
          this.batteryLevel -= 0.15;
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

      // Check for audio activity (TX or RX or Monitor mode)
      const isActive = this.isTransmitting || this.isReceiving || window.audioEngine?.isMonitorActive;

      if (isActive && window.audioEngine) {
        const dataArray = new Uint8Array(32);
        window.audioEngine.getFrequencyData(dataArray);

        const numBars = 16;
        const barWidth = Math.floor(width / numBars) - 2;

        for (let i = 0; i < numBars; i++) {
          const val = dataArray[i * 2] || (this.isTransmitting ? Math.random() * 80 * window.audioEngine.currentMicLevel : 0);
          const barHeight = Math.floor((val / 255) * height);
          const x = i * (barWidth + 2);

          const segmentSize = 3;
          const numSegments = Math.floor(barHeight / (segmentSize + 1));

          for (let s = 0; s < numSegments; s++) {
            const y = height - (s + 1) * (segmentSize + 1);
            ctx.fillStyle = 'rgba(20, 25, 20, 0.85)';
            ctx.fillRect(x, y, barWidth, segmentSize);
          }
        }

        // Update S-Meter while transmitting to reflect live speech energy
        if (this.isTransmitting && this.dom.lcdSmeter) {
          const micEnergy = window.audioEngine.currentMicLevel || 0;
          const bars = Math.min(9, Math.max(2, Math.round(micEnergy * 30)));
          let smeterStr = 'S: ';
          for (let i = 1; i <= 9; i++) {
            smeterStr += i <= bars ? '▮' : '▯';
          }
          this.dom.lcdSmeter.textContent = smeterStr;
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
