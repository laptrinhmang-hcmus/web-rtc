'use strict';

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

// Cấu hình
const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const CERT_DIR   = path.join(__dirname, '../certs');

// State toàn cục
/*
 * clients: Map< ws, { name: string } >
 *   – Lưu thông tin của từng WebSocket đang kết nối
 */
const clients = new Map();

/*
 * rooms: Map< roomId, Map< name, ws > >
 *   – Lưu danh sách thành viên của từng phòng
 */
const rooms = new Map();

// Khởi tạo Express
const app = express();
app.use(express.static(PUBLIC_DIR));

// Dynamic config từ environment (SIGNALING_URL, ...)
app.get('/env.js', (req, res) => {
  const signalingUrl = process.env.SIGNALING_URL || '';
  res.type('application/javascript');
  res.send(`window.SIGNALING_URL = ${signalingUrl ? JSON.stringify(signalingUrl) : 'undefined'};\n`);
});

let server;

const FORCE_HTTP = process.env.FORCE_HTTP === '1' || process.env.FORCE_HTTP === 'true';
const certPath = path.join(CERT_DIR, 'cert.pem');
const keyPath  = path.join(CERT_DIR, 'key.pem');

if (!FORCE_HTTP && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  // Có cert → dùng HTTPS + WSS
  server = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    app
  );
  console.log('[Server] Chế độ: HTTPS + WSS');
} else {
  // Chưa có cert → dùng HTTP + WS
  server = http.createServer(app);
  if (FORCE_HTTP) {
    console.log('[Server] Chế độ: HTTP (FORCE_HTTP=1) - đứng sau reverse proxy / ngrok');
  } else {
    console.log('[Server] Chế độ: HTTP + WS (chưa có cert)');
    console.log('[Server] Để tạo cert, chạy: scripts/gen-certs.bat (Windows) hoặc scripts/gen-certs.sh (Linux/Mac)');
  }
}

// Khởi tạo WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client mới kết nối từ ${ip}`);

  // Nhận message
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.warn('[WS] Nhận được message không hợp lệ (không phải JSON):', raw);
      return;
    }

    console.log(`[MSG] type=${data.type}`, data.sender || data.name || '');

    switch (data.type) {

      // Đăng ký nickname
      case 'register': {
        clients.set(ws, { name: data.name });
        console.log(`[register] "${data.name}" đã đăng ký`);
        break;
      }

      // Tham gia / tạo phòng
      case 'joinRoom': {
        const { roomId, name } = data;

        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Map());
          console.log(`[joinRoom] Phòng mới "${roomId}" được tạo`);
        }

        rooms.get(roomId).set(name, ws);
        console.log(`[joinRoom] "${name}" vào phòng "${roomId}" (${rooms.get(roomId).size} người)`);

        // Gửi danh sách thành viên cho tất cả trong phòng
        broadcastRoomMembers(roomId);
        break;
      }

      // Relay: offer → target
      case 'offer': {
        relay(data, data.roomId, data.target);
        break;
      }

      // Relay: answer → target
      case 'answer': {
        relay(data, data.roomId, data.target);
        break;
      }

      // Relay: ICE candidate → target
      case 'candidate': {
        relay(data, data.roomId, data.target);
        break;
      }

      // Kết thúc cuộc gọi (giữ nguyên phòng)
      case 'endCall': {
        const room = rooms.get(data.roomId);
        if (!room) break;

        console.log(`[endCall] "${data.sender}" kết thúc cuộc gọi trong phòng "${data.roomId}"`);

        // Gửi tới tất cả thành viên trừ sender
        broadcastToRoom(data.roomId, data, data.sender);
        break;
      }

      // Rời phòng hoàn toàn
      case 'leaveRoom': {
        handleLeaveRoom(ws, data.roomId, data.sender);
        break;
      }

      default:
        console.warn(`[WS] Loại message không xác định: "${data.type}"`);
    }
  });

  // Xử lý khi client ngắt kết nối
  ws.on('close', () => {
    const clientInfo = clients.get(ws);
    const name = clientInfo?.name;
    console.log(`[WS] Client ngắt kết nối: "${name || 'unknown'}"`);

    // Tìm tất cả phòng mà ws này đang ở và xử lý rời phòng
    rooms.forEach((members, roomId) => {
      if (members.has(name)) {
        handleLeaveRoom(ws, roomId, name);
      }
    });

    clients.delete(ws);
  });

  // Xử lý lỗi WebSocket
  ws.on('error', (err) => {
    console.error('[WS] Lỗi WebSocket:', err.message);
  });
});

// Hàm helper

// Relay một message tới đúng 1 target trong phòng.
function relay(data, roomId, targetName) {
  const room = rooms.get(roomId);
  if (!room) {
    console.warn(`[relay] Phòng "${roomId}" không tồn tại`);
    return;
  }

  const targetWs = room.get(targetName);
  if (!targetWs) {
    console.warn(`[relay] Target "${targetName}" không có trong phòng "${roomId}"`);
    return;
  }

  if (targetWs.readyState === targetWs.OPEN) {
    targetWs.send(JSON.stringify(data));
    console.log(`[relay] ${data.type} | ${data.sender} → ${targetName}`);
  }
}

// Broadcast một message tới tất cả thành viên trong phòng.
function broadcastToRoom(roomId, message, excludeName = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(message);
  room.forEach((memberWs, memberName) => {
    if (memberName === excludeName) return;
    if (memberWs.readyState === memberWs.OPEN) {
      memberWs.send(payload);
    }
  });
}

// Gửi roomMembers cho tất cả trong phòng.
function broadcastRoomMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  broadcastToRoom(roomId, {
    type:    'roomMembers',
    roomId:  roomId,
    members: [...room.keys()],
  });
}

/*
 * Xử lý logic rời phòng:
 * 1. Xóa thành viên khỏi Map phòng
 * 2. Gửi memberLeft cho các thành viên còn lại
 * 3. Cập nhật roomMembers cho phòng
 * 4. Xóa phòng nếu đã trống
 */
function handleLeaveRoom(ws, roomId, name) {
  const room = rooms.get(roomId);
  if (!room || !room.has(name)) return;

  room.delete(name);
  console.log(`[leaveRoom] "${name}" rời phòng "${roomId}" (còn ${room.size} người)`);

  // Thông báo memberLeft cho những người còn lại
  broadcastToRoom(roomId, {
    type:   'memberLeft',
    roomId: roomId,
    name:   name,
  });

  // Cập nhật lại danh sách thành viên
  if (room.size > 0) {
    broadcastRoomMembers(roomId);
  } else {
    // Phòng trống → dọn dẹp
    rooms.delete(roomId);
    console.log(`[leaveRoom] Phòng "${roomId}" đã trống, đã xóa`);
  }
}

// Khởi động server
const os = require('os');

function getLocalIPs() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips.length > 0 ? ips : ['localhost'];
}

server.listen(PORT, '0.0.0.0', () => {
  const protocol = server instanceof https.Server ? 'https' : 'http';
  const ips = getLocalIPs();
  console.log(`\n✅ Server đang chạy:`);
  console.log(`   Local:    ${protocol}://localhost:${PORT}`);
  ips.forEach(ip => {
    console.log(`   Network:  ${protocol}://${ip}:${PORT}`);
  });
  console.log('');
});
