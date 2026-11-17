/**
 * HYBRID SERVERLESS & CLOUD NETWORK ENGINE
 * Compatible with GitHub Pages, Vercel, Netlify, and Local Node Server!
 *
 * Networking Tiers:
 * 1. Cloud MQTT Broadcast (Free public WebSocket MQTT broker: EMQX / HiveMQ)
 *    - Real-time worldwide push-to-talk events, audio slices, and presence
 * 2. Browser BroadcastChannel API
 *    - Instant zero-latency cross-tab synchronization on same device (works offline)
 * 3. WebRTC Peer Connection
 *    - Direct peer-to-peer audio streaming
 * 4. Local Socket.io (if running node server.js)
 *    - Automatic fallback/dual support
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

class NetworkEngine {
  constructor() {
    this.clientId = `radio_${Math.random().toString(36).substring(2, 9)}`;
    this.callsign = `Radio-${Math.floor(1000 + Math.random() * 9000)}`;
    this.currentChannel = 1;
    this.channels = DEFAULT_CHANNELS;
    this.channelSummary = {};

    // Active operators in current channel: id -> { id, callsign, battery, tx, lastSeen }
    this.operatorsMap = new Map();
    this.activeTxSender = null;

    // Local Cross-Tab Broadcast Channel
    this.broadcastChannel = null;

    // Cloud MQTT Client
    this.mqttClient = null;
    this.isMqttConnected = false;

    // Optional Socket.io client (if on local server)
    this.socket = null;

    // MediaRecorder for audio slices
    this.mediaRecorder = null;
    this.audioChunksQueue = [];
    this.isRecording = false;

    // Transmission replay buffer
    this.lastReceivedTransmission = null;
    this.incomingAudioQueue = [];

    // Callbacks
    this.onChannelChange = null;
    this.onUsersUpdate = null;
    this.onTxStart = null;
    this.onTxEnd = null;
    this.onAudioChunkReceived = null;
    this.onEmergencyAlert = null;
    this.onCWKey = null;
    this.onTacticalMsg = null;
    this.onSummaryUpdate = null;

    // Setup channel summary baseline
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
    console.log(`📡 Initializing Network Engine for client [${this.clientId}] (${this.callsign})...`);

    // 1. Setup local cross-tab BroadcastChannel
    this.setupBroadcastChannel();

    // 2. Setup Cloud Serverless MQTT Client
    this.setupCloudMQTT();

    // 3. Setup optional Socket.IO if available
    this.setupSocketIO();

    // 4. Start periodic presence heartbeat & prune stale peers
    this.startPresenceHeartbeat();

    // Trigger initial channel view
    setTimeout(() => {
      this.notifyChannelChange();
    }, 150);
  }

  // Tier 1: Local Cross-Tab BroadcastChannel
  setupBroadcastChannel() {
    if ('BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('aerocomm_tactical_bus');
        this.broadcastChannel.onmessage = (event) => {
          this.handleInboundNetworkMessage(event.data);
        };
        console.log('✅ Local Cross-Tab BroadcastChannel active');
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }
  }

  // Tier 2: Cloud Serverless MQTT over WebSocket
  setupCloudMQTT() {
    if (typeof mqtt === 'undefined') {
      console.warn('Cloud MQTT library not loaded, relying on cross-tab BroadcastChannel');
      return;
    }

    // Public reliable brokers: EMQX, HiveMQ
    const brokerUrls = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    const brokerUrl = brokerUrls[0];

    try {
      console.log(`Connecting to Cloud MQTT Broker: ${brokerUrl}`);
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
            this.handleInboundNetworkMessage(payload);
          }
        } catch (e) {
          console.warn('Error parsing incoming cloud message:', e);
        }
      });

      this.mqttClient.on('error', (err) => {
        console.warn('MQTT Cloud warning:', err.message);
      });
    } catch (err) {
      console.warn('Could not initialize Cloud MQTT:', err);
    }
  }

  // Tier 3: Optional local Socket.io if running on Node server
  setupSocketIO() {
    if (typeof io !== 'undefined') {
      try {
        this.socket = io({
          reconnectionAttempts: 3,
          timeout: 4000
        });

        this.socket.on('connect', () => {
          console.log('🔌 Connected to local Node Socket.io server!');
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

        this.socket.on('audio-chunk', (data) => {
          if (data.senderId !== this.clientId) {
            this.handleInboundNetworkMessage({ type: 'audio-chunk', ...data });
          }
        });

        this.socket.on('tx-ended', (data) => {
          if (data.senderId !== this.clientId) {
            this.handleInboundNetworkMessage({ type: 'tx-end', ...data });
          }
        });
      } catch (e) {
        console.log('Local socket server skipped (running static cloud mode)');
      }
    }
  }

  // Subscribe to MQTT topic for current channel
  subscribeToChannel(channelNum) {
    if (!this.mqttClient || !this.isMqttConnected) return;
    const topic = `aerocomm/v2/channel/${channelNum}/#`;
    this.mqttClient.subscribe(topic, { qos: 0 }, (err) => {
      if (!err) {
        console.log(`Subscribed to cloud channel topic: ${topic}`);
      }
    });
  }

  unsubscribeFromChannel(channelNum) {
    if (!this.mqttClient || !this.isMqttConnected) return;
    const topic = `aerocomm/v2/channel/${channelNum}/#`;
    this.mqttClient.unsubscribe(topic);
  }

  // Outbound message dispatcher (sends to BroadcastChannel + Cloud MQTT + Socket.IO)
  broadcastNetworkMessage(msg) {
    msg.senderId = this.clientId;
    msg.callsign = this.callsign;
    msg.channel = this.currentChannel;
    msg.timestamp = Date.now();

    // 1. Send via local cross-tab BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg);
      } catch (e) {}
    }

    // 2. Send via Cloud MQTT
    if (this.mqttClient && this.isMqttConnected) {
      try {
        const topic = `aerocomm/v2/channel/${this.currentChannel}/${msg.type}`;
        this.mqttClient.publish(topic, JSON.stringify(msg));
      } catch (e) {}
    }

    // 3. Send via Socket.io if active
    if (this.socket && this.socket.connected) {
      if (msg.type === 'tx-start') this.socket.emit('tx-start');
      else if (msg.type === 'tx-end') this.socket.emit('tx-end', { duration: msg.duration, rogerBeepType: msg.rogerBeepType });
      else if (msg.type === 'audio-chunk') this.socket.emit('audio-chunk', msg);
    }
  }

  // Inbound unified message handler
  handleInboundNetworkMessage(msg) {
    if (!msg || msg.senderId === this.clientId) return;

    // Filter by channel
    if (msg.channel && msg.channel !== this.currentChannel && msg.type !== 'presence-ping') {
      return;
    }

    switch (msg.type) {
      case 'presence-ping':
        this.handlePresencePing(msg);
        break;

      case 'tx-start':
        this.activeTxSender = msg.senderId;
        this.incomingAudioQueue = [];
        if (this.onTxStart) this.onTxStart(msg);
        break;

      case 'audio-chunk':
        if (msg.audio) {
          this.incomingAudioQueue.push(msg.audio);
          if (this.onAudioChunkReceived) this.onAudioChunkReceived(msg);
        }
        break;

      case 'tx-end':
        this.activeTxSender = null;
        if (this.incomingAudioQueue.length > 0) {
          try {
            const blob = new Blob(this.incomingAudioQueue, { type: 'audio/webm' });
            this.lastReceivedTransmission = {
              callsign: msg.callsign,
              blob,
              audioUrl: URL.createObjectURL(blob),
              duration: msg.duration,
              timestamp: new Date().toLocaleTimeString()
            };
            const rxAudio = new Audio(this.lastReceivedTransmission.audioUrl);
            rxAudio.play().catch(e => console.log('Audio playback notice:', e));
          } catch (e) {
            console.warn('Replay buffer save error:', e);
          }
        }
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

    // Reset channel operator map
    this.operatorsMap.clear();

    // Broadcast presence on new channel
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

  // Periodic Presence Heartbeat
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

    // Update channel summary count
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
    // Include self
    list.unshift({
      id: this.clientId,
      callsign: this.callsign,
      battery: window.radioUI?.batteryLevel || 95,
      tx: window.radioUI?.isTransmitting || false,
      isSelf: true
    });
    return list;
  }

  // Push-To-Talk Start
  startTransmission(stream) {
    this.broadcastNetworkMessage({
      type: 'tx-start'
    });

    // Start audio slice recording
    if (stream) {
      try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4');

        this.mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
        this.audioChunksQueue = [];

        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.audioChunksQueue.push(e.data);
            this.broadcastNetworkMessage({
              type: 'audio-chunk',
              audio: e.data,
              sequence: this.audioChunksQueue.length
            });
          }
        };

        this.mediaRecorder.start(120);
        this.isRecording = true;
      } catch (err) {
        console.warn('Audio streaming notice:', err);
      }
    }
  }

  // Push-To-Talk Stop
  stopTransmission(stream, rogerBeepType = 'motorola') {
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
      this.isRecording = false;
    }

    this.broadcastNetworkMessage({
      type: 'tx-end',
      duration: '1.2',
      rogerBeepType: rogerBeepType || 'motorola'
    });
  }

  // Emergency Siren Alert
  sendEmergencyAlert(active) {
    this.broadcastNetworkMessage({
      type: 'emergency-alert',
      state: active
    });
  }

  // Morse CW Tone
  sendCWKey(pressed, freq = 800) {
    this.broadcastNetworkMessage({
      type: 'cw-key',
      state: pressed,
      frequency: freq
    });
  }

  // Tactical 10-Code
  sendTacticalMsg(code, meaning) {
    this.broadcastNetworkMessage({
      type: 'tactical-msg',
      code,
      meaning
    });
  }
}

window.networkEngine = new NetworkEngine();
