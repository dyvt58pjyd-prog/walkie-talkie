/**
 * WALKIE-TALKIE MAIN APPLICATION CONTROLLER
 * Connects Audio Engine, Network Engine, and Radio UI
 */

const CALLSIGN_PREFIXES = ['Viper', 'Ghost', 'Bravo', 'Echo', 'Falcon', 'Apex', 'Shadow', 'Titan', 'Recon', 'Raptor', 'Hawk', 'Nomad'];
const CALLSIGN_SUFFIXES = ['Actual', 'Leader', '1', '2', '6', '7', '9', 'Zero', 'Squad', 'Lead', 'Point'];

function generateTacticalCallsign() {
  const p = CALLSIGN_PREFIXES[Math.floor(Math.random() * CALLSIGN_PREFIXES.length)];
  const s = CALLSIGN_SUFFIXES[Math.floor(Math.random() * CALLSIGN_SUFFIXES.length)];
  return `${p}-${s}`;
}

const TEN_CODES = [
  { code: '10-1', meaning: 'Receiving poorly / Weak signal' },
  { code: '10-2', meaning: 'Receiving loud and clear' },
  { code: '10-4', meaning: 'Message acknowledged / Roger' },
  { code: '10-7', meaning: 'Out of service / Signing off' },
  { code: '10-8', meaning: 'In service / On patrol' },
  { code: '10-9', meaning: 'Repeat last transmission' },
  { code: '10-20', meaning: 'Advise your current location' },
  { code: '10-33', meaning: 'EMERGENCY / Distress traffic' },
  { code: '10-36', meaning: 'Correct time check' },
  { code: '10-77', meaning: 'Estimated time of arrival (ETA)' },
  { code: '10-100', meaning: 'Temporary stop / Stand by' }
];

const NATO_ALPHABET = [
  { l: 'A', w: 'Alpha' }, { l: 'B', w: 'Bravo' }, { l: 'C', w: 'Charlie' }, { l: 'D', w: 'Delta' },
  { l: 'E', w: 'Echo' }, { l: 'F', w: 'Foxtrot' }, { l: 'G', w: 'Golf' }, { l: 'H', w: 'Hotel' },
  { l: 'I', w: 'India' }, { l: 'J', w: 'Juliet' }, { l: 'K', w: 'Kilo' }, { l: 'L', w: 'Lima' },
  { l: 'M', w: 'Mike' }, { l: 'N', w: 'November' }, { l: 'O', w: 'Oscar' }, { l: 'P', w: 'Papa' },
  { l: 'Q', w: 'Quebec' }, { l: 'R', w: 'Romeo' }, { l: 'S', w: 'Sierra' }, { l: 'T', w: 'Tango' },
  { l: 'U', w: 'Uniform' }, { l: 'V', w: 'Victor' }, { l: 'W', w: 'Whiskey' }, { l: 'X', w: 'X-ray' },
  { l: 'Y', w: 'Yankee' }, { l: 'Z', w: 'Zulu' }
];

document.addEventListener('DOMContentLoaded', async () => {
  console.log('📻 Initializing Advanced Tactical Walkie-Talkie App...');

  // 1. Initialize UI and Hardware listeners
  window.radioUI.init();

  // 2. Set default tactical callsign
  const defaultCallsign = generateTacticalCallsign();
  window.networkEngine.callsign = defaultCallsign;

  const callsignInput = document.getElementById('inputCallsign');
  if (callsignInput) {
    callsignInput.value = defaultCallsign;
    callsignInput.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (val) {
        window.networkEngine.updateProfile(val);
      }
    });
  }

  const btnRandomCallsign = document.getElementById('btnRandomCallsign');
  if (btnRandomCallsign) {
    btnRandomCallsign.addEventListener('click', () => {
      const newCall = generateTacticalCallsign();
      if (callsignInput) callsignInput.value = newCall;
      window.networkEngine.updateProfile(newCall);
      window.audioEngine?.playMicClick(true);
    });
  }

  // 3. Connect Network Callbacks
  window.networkEngine.onChannelChange = (data) => {
    window.radioUI.updateLCD();
    renderChannelGrid(window.networkEngine.channels, window.networkEngine.channelSummary);
    renderOperators(data.users);
    if (data.logs) renderLogs(data.logs);
  };

  window.networkEngine.onUsersUpdate = (users) => {
    renderOperators(users);
  };

  window.networkEngine.onSummaryUpdate = (summary) => {
    renderChannelGrid(window.networkEngine.channels, summary);
  };

  window.networkEngine.onTxStart = (data) => {
    window.radioUI.onIncomingTransmissionStart(data);
    appendLiveLog({
      callsign: data.callsign,
      type: 'TX STARTED',
      timestamp: new Date().toLocaleTimeString(),
      active: true
    });
  };

  window.networkEngine.onTxEnd = (data) => {
    window.radioUI.onIncomingTransmissionEnd(data);
    if (data.log) {
      appendCompletedLog(data.log);
    }
  };

  window.networkEngine.onAudioChunkReceived = (data) => {
    // If incoming audio chunk is array buffer, decode and play through radio DSP
    if (data.audio) {
      window.audioEngine?.playIncomingAudioBuffer(data.audio);
    }
  };

  window.networkEngine.onEmergencyAlert = (data) => {
    window.audioEngine?.toggleEmergencyAlarm(data.state);
    if (data.state) {
      alert(`🚨 EMERGENCY 10-33 DISTRESS SIGNAL RECEIVED FROM [${data.callsign}] ON CHANNEL ${data.channel}!`);
    }
  };

  window.networkEngine.onCWKey = (data) => {
    window.audioEngine?.setCWKey(data.state, data.frequency || 800);
    if (window.radioUI?.dom?.ledRx) {
      window.radioUI.dom.ledRx.classList.toggle('active', data.state);
    }
  };

  window.networkEngine.onTacticalMsg = (data) => {
    appendCompletedLog(data);
    // Voice read 10-code through radio filter
    window.audioEngine?.playMicClick(true);
    window.audioEngine?.playSquelchBurst(true);
    window.audioEngine?.speakTacticalTransmission(`${data.callsign}, ${data.code}, ${data.meaning}`);
  };

  // 4. Initialize Network Engine
  window.networkEngine.init();

  // 5. Populate Tactical 10-Codes List
  const tenCodeContainer = document.getElementById('tenCodeList');
  if (tenCodeContainer) {
    tenCodeContainer.innerHTML = '';
    TEN_CODES.forEach(item => {
      const card = document.createElement('div');
      card.className = 'tactical-chip';
      card.innerHTML = `<strong>${item.code}</strong> <span>${item.meaning}</span>`;
      card.addEventListener('click', () => {
        window.audioEngine?.playMicClick(true);
        window.networkEngine.sendTacticalMsg(item.code, item.meaning);
      });
      tenCodeContainer.appendChild(card);
    });
  }

  // 6. Populate NATO Phonetic Alphabet
  const natoContainer = document.getElementById('natoList');
  if (natoContainer) {
    natoContainer.innerHTML = '';
    NATO_ALPHABET.forEach(item => {
      const span = document.createElement('span');
      span.className = 'nato-badge';
      span.innerHTML = `<b>${item.l}</b>:${item.w}`;
      natoContainer.appendChild(span);
    });
  }

  // 7. Rig Settings Event Listeners
  const selectRogerBeep = document.getElementById('selectRogerBeep');
  if (selectRogerBeep) {
    selectRogerBeep.addEventListener('change', (e) => {
      window.audioEngine.settings.rogerBeep = e.target.value;
      window.audioEngine?.playRogerBeep(e.target.value);
    });
  }

  const selectFilterMode = document.getElementById('selectFilterMode');
  if (selectFilterMode) {
    selectFilterMode.addEventListener('change', (e) => {
      window.audioEngine.settings.filterMode = e.target.value;
      window.audioEngine?.playMicClick(true);
    });
  }

  const sliderDistortion = document.getElementById('sliderDistortion');
  if (sliderDistortion) {
    sliderDistortion.addEventListener('input', (e) => {
      window.audioEngine.settings.distortion = parseInt(e.target.value, 10);
    });
  }

  const sliderVoxSensitivity = document.getElementById('sliderVoxSensitivity');
  if (sliderVoxSensitivity) {
    sliderVoxSensitivity.addEventListener('input', (e) => {
      window.radioUI.voxThreshold = 60 - parseInt(e.target.value, 10);
    });
  }

  // 8. Mobile QR Code & LAN Network Info Modal
  const btnOpenQr = document.getElementById('btnOpenQr');
  const modalQr = document.getElementById('modalQr');
  const btnCloseQr = document.getElementById('btnCloseQr');

  if (btnOpenQr && modalQr) {
    btnOpenQr.addEventListener('click', async () => {
      modalQr.classList.remove('hidden');
      try {
        const res = await fetch('/api/info');
        const info = await res.json();

        const qrImg = document.getElementById('qrImage');
        const qrLink = document.getElementById('qrLink');
        const qrIpText = document.getElementById('qrIpText');

        // Prefer HTTPS URL so phones allow microphone access
        const targetUrl = info.httpsUrl || info.httpUrl;
        if (qrImg) qrImg.src = info.qrCodeHttps || info.qrCodeHttp;
        if (qrLink) {
          qrLink.href = targetUrl;
          qrLink.textContent = targetUrl;
        }
        if (qrIpText) {
          qrIpText.innerHTML = `Open this link on your phone (same Wi-Fi) to use it as a secondary walkie-talkie!`;
        }
      } catch (err) {
        console.warn('Failed to load network info for QR code:', err);
      }
    });
  }

  if (btnCloseQr && modalQr) {
    btnCloseQr.addEventListener('click', () => {
      modalQr.classList.add('hidden');
    });
  }

  // 9. Quick Tab Drawer Navigation
  setupDrawerTabs();
});

// Render the 16 Channels Grid in the sidebar
function renderChannelGrid(channels, summary) {
  const container = document.getElementById('channelGrid');
  if (!container || !channels) return;

  const currentCh = window.networkEngine?.currentChannel || 1;
  container.innerHTML = '';

  for (let ch = 1; ch <= 16; ch++) {
    const chData = channels[ch] || { freq: '462.5625', label: `CH ${ch}` };
    const chSummary = summary?.[ch] || { count: 0, activeTx: null };
    const isActive = ch === currentCh;
    const isBusy = !!chSummary.activeTx;

    const card = document.createElement('div');
    card.className = `channel-card ${isActive ? 'active' : ''} ${isBusy ? 'busy' : ''} ${ch === 9 ? 'emergency' : ''}`;
    card.innerHTML = `
      <div class="channel-card-header">
        <span class="channel-num">CH ${ch < 10 ? '0' + ch : ch}</span>
        <span class="channel-badge ${chSummary.count > 0 ? 'online' : ''}">${chSummary.count} <i class="icon-user">👤</i></span>
      </div>
      <div class="channel-freq">${chData.freq} MHz</div>
      <div class="channel-name">${chData.label}</div>
      ${isBusy ? '<div class="channel-tx-status">🔴 TRANSMITTING</div>' : ''}
    `;

    card.addEventListener('click', () => {
      if (ch !== currentCh) {
        window.audioEngine?.playMicClick(true);
        window.networkEngine?.joinChannel(ch);
      }
    });

    container.appendChild(card);
  }
}

// Render Operators in Current Channel
function renderOperators(users) {
  const container = document.getElementById('operatorList');
  if (!container) return;

  container.innerHTML = '';
  if (!users || users.length === 0) {
    container.innerHTML = '<div class="empty-state">No other operators on this frequency. Share the link or scan QR code to connect another device!</div>';
    return;
  }

  users.forEach(user => {
    const isMe = user.id === window.networkEngine?.socket?.id;
    const item = document.createElement('div');
    item.className = `operator-item ${user.tx ? 'tx-active' : ''} ${isMe ? 'is-self' : ''}`;
    item.innerHTML = `
      <div class="operator-avatar">${user.tx ? '🔴' : '🟢'}</div>
      <div class="operator-info">
        <div class="operator-callsign">${user.callsign} ${isMe ? '<small>(YOU)</small>' : ''}</div>
        <div class="operator-meta">Signal S9+ • Bat: ${user.battery || 95}%</div>
      </div>
      ${user.tx ? '<span class="operator-tag">TRANSMITTING</span>' : ''}
    `;
    container.appendChild(item);
  });
}

// Render Mission Logs
function renderLogs(logs) {
  const container = document.getElementById('txLogList');
  if (!container) return;
  container.innerHTML = '';
  logs.forEach(log => appendCompletedLog(log, false));
}

function appendCompletedLog(log, prepend = true) {
  const container = document.getElementById('txLogList');
  if (!container) return;

  const row = document.createElement('div');
  row.className = `log-entry ${log.type === '10-CODE' ? 'code-log' : ''}`;
  row.innerHTML = `
    <span class="log-time">${log.timestamp}</span>
    <span class="log-sender">${log.callsign}</span>
    <span class="log-detail">${log.type === '10-CODE' ? `[${log.code}] ${log.meaning}` : `Voice TX (${log.duration}s)`}</span>
  `;

  if (prepend && container.firstChild) {
    container.insertBefore(row, container.firstChild);
  } else {
    container.appendChild(row);
  }
}

function appendLiveLog(data) {
  const container = document.getElementById('txLogList');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'log-entry live';
  row.id = 'live-tx-row';
  row.innerHTML = `
    <span class="log-time">${data.timestamp}</span>
    <span class="log-sender">${data.callsign}</span>
    <span class="log-detail">🎙️ KEYED MIC...</span>
  `;
  container.insertBefore(row, container.firstChild);
}

// Drawer Tabs Setup
function setupDrawerTabs() {
  const tabs = document.querySelectorAll('.sidebar-tab');
  const panels = document.querySelectorAll('.sidebar-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-target');

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');

      window.audioEngine?.playMicClick(true);
    });
  });
}
