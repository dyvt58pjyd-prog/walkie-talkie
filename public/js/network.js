/**
 * HYBRID SERVERLESS & CLOUD NETWORK ENGINE
 * Compatible with GitHub Pages, Vercel, Netlify, and Local Node Server!
 *
 * Continuous Low-Latency PCM Audio Streaming Architecture:
 * 1. BroadcastChannel (Zero-latency binary ArrayBuffer streaming across tabs/windows)
 * 2. Cloud MQTT WebSocket Broker (Base64-encoded PCM packets across internet devices)
 * 3. Local Socket.io (if running via node server.js)
 */

const DEFAULT_CHANNELS = {
  1:  { freq: '462.5625', label: 'CH 01 - Patrol Alpha', ctcss: '67.0 Hz' },
  2:  { freq: '462.5875', label: 'CH 02 - Tactical Bravo', ctcss: '71.9 Hz' },
  3:  { freq: '462.6125', label: 'CH 03 - Recon Charlie', ctcss: '74.4 Hz' },
  4:  { freq: '462.6375', label: 'CH 04 - Command Center', ctcss: '77.0 Hz' },
  5:  { freq: '462.6625', label: 'CH 05 - Logistics Delta', ctcss: '79.7 Hz' },
  6:  { freq: '462.6875', label: 'CH 06 - Security Echo', ctcss: '82.5 Hz' },
  7:  { freq: '462.7125', label: 'CH 07 - Convoy Foxtrot', ctcss: '85.4 Hz' },
  8:  { freq: '467.5625', label: 'CH 08 - Perimeter Golf', ctcss: '88.5 Hz' },
  9:  { freq: '467.5875', label: 'CH 09 - EMERGENCY / DISTRESS', ctcss: 'OPEN' },
  10: { freq: '467.6125', label: 'CH 10 - Air Ops India', ctcss: '94.8 Hz' },
  11: { freq: '467.6375', label: 'CH 11 - Medical Juliet', ctcss: '97.4 Hz' },
  12: { freq: '467.6625', label: 'CH 12 - Search & Rescue', ctcss: '100.0 Hz' },
  13: { freq: '467.6875', label: 'CH 13 - Marine Harbor', ctcss: '103.5 Hz' },
  14: { freq: '467.7125', label: 'CH 14 - Operations Sierra', ctcss: '107.2 Hz' },
  15: { freq: '462.5500', label: 'CH 15 - Tactical High Pwr', ctcss: '110.9 Hz' },
  16: { freq: '462.5750', label: 'CH 16 - Repeater Uplink', ctcss: '114.8 Hz' }
};

// Fast binary buffer conversion
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

class NetworkEngine {
  constructor() {
    this.clientId = `radio_${Math.random().toString(36).substring(2, 9)}`;
    this.callsign = `Radio-${Math.floor(1000 + Math.random() * 9000)}`;
    this.currentChannel = 1;
    this.channels = DEFAULT_CHANNELS;
    this.channelSummary = {};

    this.operatorsMap = new Map();
    this.activeTxSender = null;
    this.txPacketSequence = 0;
    this.txStartTime = 0;

    // Local Cross-Tab Broadcast Channel
    this.broadcastChannel = null;

    // Cloud MQTT Client
    this.mqttClient = null;
    this.isMqttConnected = false;

    // Optional Socket.io
    this.socket = null;

    // Callbacks
    this.onChannelChange = null;
    this.onUsersUpdate = null;
    this.onTxStart = null;
    this.onTxEnd = null;
    this.onEmergencyAlert = null;
    this.onCWKey = null;
    this.onTacticalMsg = null;
    this.onSummaryUpdate = null;

    this.initChannelSummary();
  }

  initChannelSummary() {
    for (let ch = 1; ch <= 16; ch++) {
      this.channelSummary[ch] = {
        ...this.channels[ch],
        count: ch === 1 ? 1 : 0,
        activeTx: null
      };
    }
  }

  init() {
    console.log(`📡 Initializing Network Engine [${this.clientId}] (${this.callsign})...`);

    this.setupBroadcastChannel();
    this.setupCloudMQTT();
    this.setupSocketIO();
    this.startPresenceHeartbeat();

    setTimeout(() => {
      this.notifyChannelChange();
    }, 150);
  }

  setupBroadcastChannel() {
    if ('BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('aerocomm_tactical_bus');
        this.broadcastChannel.onmessage = (event) => {
          this.handleInboundNetworkMessage(event.data);
        };
        console.log('✅ BroadcastChannel active');
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }
  }

  setupCloudMQTT() {
    if (typeof mqtt === 'undefined') {
      console.warn('MQTT library not loaded');
      return;
    }

    const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';

    try {
      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId: `aerocomm_${this.clientId}`,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 3000
      });

      this.mqttClient.on('connect', () => {
        this.isMqttConnected = true;
        console.log('🌐 Connected to Cloud Serverless Network!');
        this.subscribeToChannel(this.currentChannel);
        this.broadcastPresence();
      });

      this.mqttClient.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (payload.senderId !== this.clientId) {
            // If message contains Base64 PCM, decode back to ArrayBuffer
            if (payload.pcmBase64) {
              payload.pcmBuffer = base64ToArrayBuffer(payload.pcmBase64);
            }
            this.handleInboundNetworkMessage(payload);
          }
        } catch (e) {
          console.warn('Error parsing incoming message:', e);
        }
      });

      this.mqttClient.on('error', (err) => {
        console.warn('MQTT warning:', err.message);
      });
    } catch (err) {
      console.warn('Cloud MQTT setup notice:', err);
    }
  }

  setupSocketIO() {
    if (typeof io !== 'undefined') {
      try {
        this.socket = io({ reconnectionAttempts: 2, timeout: 3000 });
        this.socket.on('connect', () => {
          this.socket.emit('join-channel', {
            channel: this.currentChannel,
            callsign: this.callsign
          });
        });

        this.socket.on('tx-started', (data) => {
          if (data.senderId !== this.clientId) {
            this.handleInboundNetworkMessage({ type: 'tx-start', ...data });
          }
        });

        this.socket.on('tx-ended', (data) => {
          if (data.senderId !== this.clientId) {
            this.handleInboundNetworkMessage({ type: 'tx-end', ...data });
          }
        });
      } catch (e) {}
    }
  }

  subscribeToChannel(channelNum) {
    if (!this.mqttClient || !this.isMqttConnected) return;
    const topic = `aerocomm/v3/channel/${channelNum}/#`;
    this.mqttClient.subscribe(topic, { qos: 0 });
  }

  unsubscribeFromChannel(channelNum) {
    if (!this.mqttClient || !this.isMqttConnected) return;
    const topic = `aerocomm/v3/channel/${channelNum}/#`;
    this.mqttClient.unsubscribe(topic);
  }

  broadcastNetworkMessage(msg) {
    msg.senderId = this.clientId;
    msg.callsign = this.callsign;
    msg.channel = this.currentChannel;
    msg.timestamp = Date.now();

    // 1. Local BroadcastChannel: Send directly with binary ArrayBuffer
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg);
      } catch (e) {}
    }

    // 2. Cloud MQTT: Encode ArrayBuffer to base64 for string JSON
    if (this.mqttClient && this.isMqttConnected) {
      try {
        const topic = `aerocomm/v3/channel/${this.currentChannel}/${msg.type}`;
        const mqttPayload = { ...msg };
        if (msg.pcmBuffer) {
          mqttPayload.pcmBase64 = arrayBufferToBase64(msg.pcmBuffer);
          delete mqttPayload.pcmBuffer; // Don't JSON.stringify raw buffer
        }
        this.mqttClient.publish(topic, JSON.stringify(mqttPayload));
      } catch (e) {}
    }

    // 3. Local socket if active
    if (this.socket && this.socket.connected) {
      if (msg.type === 'tx-start') this.socket.emit('tx-start');
      else if (msg.type === 'tx-end') this.socket.emit('tx-end', { duration: msg.duration, rogerBeepType: msg.rogerBeepType });
    }
  }

  // Handle Inbound Message
  handleInboundNetworkMessage(msg) {
    if (!msg || msg.senderId === this.clientId) return;

    if (msg.channel && msg.channel !== this.currentChannel && msg.type !== 'presence-ping') {
      return;
    }

    switch (msg.type) {
      case 'presence-ping':
        this.handlePresencePing(msg);
        break;

      case 'tx-start':
        this.activeTxSender = msg.senderId;
        window.audioEngine?.resetIncomingAudioStream();
        if (this.onTxStart) this.onTxStart(msg);
        break;

      case 'audio-pcm':
        // Feed continuous PCM audio buffer directly into audio engine
        const buffer = msg.pcmBuffer;
        if (buffer) {
          window.audioEngine?.playIncomingPCMPacket(buffer);
        }
        break;

      case 'tx-end':
        this.activeTxSender = null;
        window.audioEngine?.finalizeIncomingAudioStream();
        if (this.onTxEnd) this.onTxEnd(msg);
        break;

      case 'emergency-alert':
        if (this.onEmergencyAlert) this.onEmergencyAlert(msg);
        break;

      case 'cw-key':
        if (this.onCWKey) this.onCWKey(msg);
        break;

      case 'tactical-msg':
        if (this.onTacticalMsg) this.onTacticalMsg(msg);
        break;
    }
  }

  // Channel Switching
  joinChannel(channelNum, callsign) {
    const oldChannel = this.currentChannel;
    this.currentChannel = parseInt(channelNum, 10) || 1;
    if (callsign) this.callsign = callsign;

    if (oldChannel !== this.currentChannel) {
      this.unsubscribeFromChannel(oldChannel);
      this.subscribeToChannel(this.currentChannel);
    }

    this.operatorsMap.clear();
    this.broadcastPresence();
    this.notifyChannelChange();

    if (this.socket && this.socket.connected) {
      this.socket.emit('join-channel', {
        channel: this.currentChannel,
        callsign: this.callsign
      });
    }
  }

  notifyChannelChange() {
    if (this.onChannelChange) {
      this.onChannelChange({
        channel: this.currentChannel,
        info: this.channels[this.currentChannel],
        users: this.getUsersList(),
        activeTx: this.activeTxSender,
        logs: []
      });
    }
    if (this.onSummaryUpdate) {
      this.onSummaryUpdate(this.channelSummary);
    }
  }

  updateProfile(callsign, battery) {
    if (callsign) this.callsign = callsign;
    this.broadcastPresence();
  }

  startPresenceHeartbeat() {
    setInterval(() => {
      this.broadcastPresence();
      this.pruneStaleOperators();
    }, 4000);
  }

  broadcastPresence() {
    this.broadcastNetworkMessage({
      type: 'presence-ping',
      battery: window.radioUI?.batteryLevel || 95,
      tx: window.radioUI?.isTransmitting || false
    });
  }

  handlePresencePing(msg) {
    if (msg.channel === this.currentChannel) {
      this.operatorsMap.set(msg.senderId, {
        id: msg.senderId,
        callsign: msg.callsign,
        battery: msg.battery || 95,
        tx: msg.tx || false,
        lastSeen: Date.now()
      });
      if (this.onUsersUpdate) {
        this.onUsersUpdate(this.getUsersList());
      }
    }

    if (msg.channel && this.channelSummary[msg.channel]) {
      this.channelSummary[msg.channel].count = Math.max(1, (this.channelSummary[msg.channel].count || 0));
    }
  }

  pruneStaleOperators() {
    const now = Date.now();
    let updated = false;
    for (const [id, op] of this.operatorsMap.entries()) {
      if (now - op.lastSeen > 12000) {
        this.operatorsMap.delete(id);
        updated = true;
      }
    }
    if (updated && this.onUsersUpdate) {
      this.onUsersUpdate(this.getUsersList());
    }
  }

  getUsersList() {
    const list = Array.from(this.operatorsMap.values());
    list.unshift({
      id: this.clientId,
      callsign: this.callsign,
      battery: window.radioUI?.batteryLevel || 95,
      tx: window.radioUI?.isTransmitting || false,
      isSelf: true
    });
    return list;
  }

  // Continuous PTT Transmission Start
  startTransmission() {
    this.txStartTime = Date.now();
    this.txPacketSequence = 0;

    // Send TX START notification
    this.broadcastNetworkMessage({
      type: 'tx-start'
    });

    // Start continuous audio capture on audio engine
    window.audioEngine?.startContinuousAudioCapture((pcmArrayBuffer) => {
      this.txPacketSequence++;
      this.broadcastNetworkMessage({
        type: 'audio-pcm',
        seq: this.txPacketSequence,
        pcmBuffer: pcmArrayBuffer
      });
    });
  }

  // PTT Transmission Stop
  stopTransmission(rogerBeepType = 'motorola') {
    window.audioEngine?.stopContinuousAudioCapture();

    const duration = this.txStartTime ? ((Date.now() - this.txStartTime) / 1000).toFixed(1) : '1.0';

    this.broadcastNetworkMessage({
      type: 'tx-end',
      duration,
      rogerBeepType: rogerBeepType || 'motorola'
    });
  }

  sendEmergencyAlert(active) {
    this.broadcastNetworkMessage({
      type: 'emergency-alert',
      state: active
    });
  }

  sendCWKey(pressed, freq = 800) {
    this.broadcastNetworkMessage({
      type: 'cw-key',
      state: pressed,
      frequency: freq
    });
  }

  sendTacticalMsg(code, meaning) {
    this.broadcastNetworkMessage({
      type: 'tactical-msg',
      code,
      meaning
    });
  }
}

window.networkEngine = new NetworkEngine();
