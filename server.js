const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Determine local network IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

// Server info endpoint
app.get('/api/info', async (req, res) => {
  try {
    const httpUrl = `http://${localIP}:${HTTP_PORT}`;
    const httpsUrl = `https://${localIP}:${HTTPS_PORT}`;
    const qrCodeHttp = await QRCode.toDataURL(httpUrl);
    const qrCodeHttps = await QRCode.toDataURL(httpsUrl);

    res.json({
      localIP,
      httpPort: HTTP_PORT,
      httpsPort: HTTPS_PORT,
      httpUrl,
      httpsUrl,
      qrCodeHttp,
      qrCodeHttps
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Setup HTTP server
const httpServer = http.createServer(app);

// Setup HTTPS server if certs exist
let httpsServer = null;
try {
  const keyPath = path.join(__dirname, 'certs', 'key.pem');
  const certPath = path.join(__dirname, 'certs', 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    httpsServer = https.createServer(options, app);
  }
} catch (e) {
  console.warn('HTTPS setup skipped:', e.message);
}

// Socket.io attached to HTTP and HTTPS
const io = new Server();
io.attach(httpServer);
if (httpsServer) {
  io.attach(httpsServer);
}

// Channel frequencies definition (Standard FRS/GMRS UHF Frequencies)
const CHANNELS = {
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

// State: active peers and active transmissions
const peers = new Map(); // socketId -> { id, callsign, channel, battery, tx: boolean }
const activeTransmissions = new Map(); // channel -> socketId (who is currently keying the mic)
const channelLogs = new Map(); // channel -> array of recent transmission logs

function getChannelUserList(channelNum) {
  const users = [];
  for (const [id, user] of peers.entries()) {
    if (user.channel === channelNum) {
      users.push({
        id,
        callsign: user.callsign,
        battery: user.battery || 95,
        tx: user.tx || false
      });
    }
  }
  return users;
}

function getChannelSummary() {
  const summary = {};
  for (let ch = 1; ch <= 16; ch++) {
    summary[ch] = {
      ...CHANNELS[ch],
      count: 0,
      activeTx: activeTransmissions.get(ch) || null
    };
  }
  for (const [_, user] of peers.entries()) {
    if (user.channel && summary[user.channel]) {
      summary[user.channel].count++;
    }
  }
  return summary;
}

io.on('connection', (socket) => {
  // Initial registration
  peers.set(socket.id, {
    id: socket.id,
    callsign: `Radio-${socket.id.substring(0, 4).toUpperCase()}`,
    channel: 1,
    battery: 100,
    tx: false
  });

  // Send channel configs and summary
  socket.emit('channels-init', {
    channels: CHANNELS,
    summary: getChannelSummary()
  });

  // Join a channel
  socket.on('join-channel', ({ channel, callsign }) => {
    const user = peers.get(socket.id);
    if (!user) return;

    const oldChannel = user.channel;
    if (oldChannel) {
      socket.leave(`channel-${oldChannel}`);
      // Notify old channel
      io.to(`channel-${oldChannel}`).emit('channel-users-updated', {
        channel: oldChannel,
        users: getChannelUserList(oldChannel)
      });
    }

    user.channel = parseInt(channel, 10) || 1;
    if (callsign) user.callsign = callsign;

    socket.join(`channel-${user.channel}`);

    // Inform user of peer list
    socket.emit('joined-channel', {
      channel: user.channel,
      channelInfo: CHANNELS[user.channel],
      users: getChannelUserList(user.channel),
      activeTx: activeTransmissions.get(user.channel) || null,
      recentLogs: channelLogs.get(user.channel) || []
    });

    // Inform others in channel
    socket.to(`channel-${user.channel}`).emit('user-joined', {
      user: { id: socket.id, callsign: user.callsign, battery: user.battery },
      users: getChannelUserList(user.channel)
    });

    // Broadcast updated summary to all
    io.emit('channels-summary-updated', getChannelSummary());
  });

  // Update Callsign or Battery
  socket.on('update-profile', ({ callsign, battery }) => {
    const user = peers.get(socket.id);
    if (!user) return;
    if (callsign) user.callsign = callsign;
    if (typeof battery === 'number') user.battery = battery;

    if (user.channel) {
      io.to(`channel-${user.channel}`).emit('channel-users-updated', {
        channel: user.channel,
        users: getChannelUserList(user.channel)
      });
    }
  });

  // PTT - Transmission Started
  socket.on('tx-start', () => {
    const user = peers.get(socket.id);
    if (!user || !user.channel) return;

    const channel = user.channel;
    const currentTx = activeTransmissions.get(channel);

    // If channel is already busy by someone else, inform about collision/heterodyne
    const isCollision = currentTx && currentTx !== socket.id;

    user.tx = true;
    user.txStartTime = Date.now();
    activeTransmissions.set(channel, socket.id);

    // Broadcast to everyone else in this channel
    socket.to(`channel-${channel}`).emit('tx-started', {
      senderId: socket.id,
      callsign: user.callsign,
      channel,
      isCollision,
      timestamp: user.txStartTime
    });

    // Also acknowledge to sender
    socket.emit('tx-ack', {
      success: true,
      isCollision,
      channel
    });

    io.emit('channels-summary-updated', getChannelSummary());
  });

  // PTT - Audio Chunk Streaming (Low latency WebSocket broadcast fallback)
  socket.on('audio-chunk', (data) => {
    const user = peers.get(socket.id);
    if (!user || !user.channel || !user.tx) return;

    // Relay audio chunk to all other peers in the same channel
    socket.to(`channel-${user.channel}`).emit('audio-chunk', {
      senderId: socket.id,
      callsign: user.callsign,
      channel: user.channel,
      audio: data.audio, // ArrayBuffer or base64
      sequence: data.sequence
    });
  });

  // PTT - Transmission Ended
  socket.on('tx-end', ({ duration, rogerBeepType }) => {
    const user = peers.get(socket.id);
    if (!user || !user.channel) return;

    const channel = user.channel;
    user.tx = false;

    if (activeTransmissions.get(channel) === socket.id) {
      activeTransmissions.delete(channel);
    }

    const txDuration = duration || (user.txStartTime ? ((Date.now() - user.txStartTime) / 1000).toFixed(1) : '1.0');

    const logEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      senderId: socket.id,
      callsign: user.callsign,
      channel,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      duration: txDuration,
      type: 'VOICE'
    };

    if (!channelLogs.has(channel)) {
      channelLogs.set(channel, []);
    }
    const logs = channelLogs.get(channel);
    logs.unshift(logEntry);
    if (logs.length > 50) logs.pop();

    // Broadcast to channel
    socket.to(`channel-${channel}`).emit('tx-ended', {
      senderId: socket.id,
      callsign: user.callsign,
      channel,
      duration: txDuration,
      rogerBeepType: rogerBeepType || 'motorola',
      log: logEntry
    });

    socket.emit('tx-ended-ack', {
      channel,
      log: logEntry
    });

    io.emit('channels-summary-updated', getChannelSummary());
  });

  // Emergency Siren / Alarm
  socket.on('emergency-alert', ({ state }) => {
    const user = peers.get(socket.id);
    if (!user || !user.channel) return;

    socket.to(`channel-${user.channel}`).emit('emergency-alert', {
      senderId: socket.id,
      callsign: user.callsign,
      channel: user.channel,
      state // true = active, false = stopped
    });
  });

  // Morse Code / CW Tone Keying
  socket.on('cw-key', ({ state, frequency }) => {
    const user = peers.get(socket.id);
    if (!user || !user.channel) return;

    socket.to(`channel-${user.channel}`).emit('cw-key', {
      senderId: socket.id,
      callsign: user.callsign,
      channel: user.channel,
      state, // true = down, false = up
      frequency: frequency || 800
    });
  });

  // Tactical 10-Code / Quick Log
  socket.on('tactical-msg', ({ code, meaning }) => {
    const user = peers.get(socket.id);
    if (!user || !user.channel) return;

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      senderId: socket.id,
      callsign: user.callsign,
      channel: user.channel,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      code,
      meaning,
      type: '10-CODE'
    };

    if (!channelLogs.has(user.channel)) {
      channelLogs.set(user.channel, []);
    }
    const logs = channelLogs.get(user.channel);
    logs.unshift(entry);
    if (logs.length > 50) logs.pop();

    io.to(`channel-${user.channel}`).emit('tactical-msg-received', entry);
  });

  // WebRTC Mesh Signaling
  socket.on('webrtc-offer', ({ targetId, offer }) => {
    io.to(targetId).emit('webrtc-offer', {
      senderId: socket.id,
      offer
    });
  });

  socket.on('webrtc-answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc-answer', {
      senderId: socket.id,
      answer
    });
  });

  socket.on('webrtc-ice-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc-ice-candidate', {
      senderId: socket.id,
      candidate
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = peers.get(socket.id);
    if (user && user.channel) {
      if (activeTransmissions.get(user.channel) === socket.id) {
        activeTransmissions.delete(user.channel);
        socket.to(`channel-${user.channel}`).emit('tx-ended', {
          senderId: socket.id,
          callsign: user.callsign,
          channel: user.channel,
          abrupt: true
        });
      }

      socket.to(`channel-${user.channel}`).emit('user-left', {
        userId: socket.id,
        callsign: user.callsign
      });

      peers.delete(socket.id);

      io.to(`channel-${user.channel}`).emit('channel-users-updated', {
        channel: user.channel,
        users: getChannelUserList(user.channel)
      });

      io.emit('channels-summary-updated', getChannelSummary());
    } else {
      peers.delete(socket.id);
    }
  });
});

// Start listening
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`🎙️  WALKIE-TALKIE SERVER RUNNING`);
  console.log(`> Local:   http://localhost:${HTTP_PORT}`);
  console.log(`> Network: http://${localIP}:${HTTP_PORT}`);
  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`> HTTPS:   https://${localIP}:${HTTPS_PORT} (For mobile mic access)`);
      console.log(`==================================================\n`);
    });
  } else {
    console.log(`==================================================\n`);
  }
});
