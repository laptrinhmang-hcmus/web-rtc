# WebRTC Group Call – Kiến trúc & Tài liệu Kỹ thuật

---

## 1. Công nghệ sử dụng & Kiến trúc tổng thể

### Signaling Server (Backend)
- **Node.js** với các thư viện:
  - `express` – phục vụ file tĩnh từ thư mục `public`
  - `https` – tạo server bảo mật với chứng chỉ tự ký
  - `ws` – tạo WebSocket server chạy cùng HTTPS server

### WebRTC Client (Frontend)
- **HTML / CSS / JavaScript** thuần
- Sử dụng trực tiếp API `getUserMedia` và `RTCPeerConnection` của trình duyệt
- Không dùng framework để dễ kiểm soát DOM và luồng media
- Đăng nhập bằng nickname (không lưu tài khoản/mật khẩu)

### TURN Server (Infrastructure)
- Sử dụng **coturn** triển khai qua Docker
- Hỗ trợ STUN và TURN qua UDP, TCP (port 3478) và TLS (port 5349)

### Cách các thành phần kết nối

| Kết nối | Mô tả |
|---|---|
| Client ↔ Signaling Server | Qua `wss://<IP>:3000` – trao đổi metadata và SDP / ICE Candidates |
| Client ↔ STUN/TURN Server | Qua port `3478` (UDP/TCP) và `5349` (TLS) – lấy public IP hoặc chuyển tiếp (relay) khi NAT/Firewall chặn P2P |
| Client ↔ Client | Sau khi signaling và ICE hoàn tất, các client kết nối trực tiếp theo mô hình **Mesh** qua WebRTC (RTP/RTCP) |

---

## 2. Giao thức Signaling

### Client gửi lên Server

```json
// Đăng ký tên (gửi ngay khi mở WebSocket, trước khi vào phòng)
{ "type": "register", "name": "A" }

// Tạo hoặc tham gia phòng (server gộp chung logic Create/Join)
{ "type": "joinRoom", "roomId": "group1", "name": "A" }

// Quá trình thương lượng WebRTC
{ "type": "offer",     "roomId": "group1", "sender": "A", "target": "B", "offer": { "sdp": "...", "type": "offer" } }
{ "type": "answer",    "roomId": "group1", "sender": "B", "target": "A", "answer": { "sdp": "...", "type": "answer" } }
{ "type": "candidate", "roomId": "group1", "sender": "A", "target": "B", "candidate": { "candidate": "...", "sdpMid": "0" } }

// Kết thúc cuộc gọi (giữ nguyên trong phòng, chỉ đóng kết nối media)
{ "type": "endCall", "roomId": "group1", "sender": "A" }

// Rời phòng hoàn toàn
{ "type": "leaveRoom", "roomId": "group1", "sender": "A" }
```

### Server broadcast xuống Client

```json
// Cập nhật danh sách thành viên (gửi cho tất cả khi có người ra/vào)
{ "type": "roomMembers", "roomId": "group1", "members": ["A", "B", "C"] }

// Thông báo có người rời phòng để các client khác đóng PeerConnection tương ứng
{ "type": "memberLeft", "roomId": "group1", "name": "B" }
```

### Tóm tắt toàn bộ message types

| Message | Chiều | Mô tả |
|---|---|---|
| `register` | Client → Server | Đăng ký nickname ngay khi kết nối |
| `joinRoom` | Client → Server | Tạo hoặc vào phòng |
| `offer` | Client → Server → Client | SDP offer trong quá trình thương lượng |
| `answer` | Client → Server → Client | SDP answer phản hồi offer |
| `candidate` | Client → Server → Client | ICE candidate trao đổi hai chiều |
| `endCall` | Client → Server → Client | Kết thúc cuộc gọi, giữ lại phòng |
| `leaveRoom` | Client → Server | Rời phòng hoàn toàn |
| `roomMembers` | Server → Client | Danh sách thành viên hiện tại trong phòng |
| `memberLeft` | Server → Client | Thông báo có người rời để đóng PC tương ứng |

---

## 3. Phân công nhiệm vụ

### Người 1 – Backend & Signaling Server (`server/server.js`)

**Trách nhiệm:** Làm trung gian trao đổi thông tin. Server không xử lý dữ liệu Audio/Video.

**Quản lý State:**
```js
const clients = new Map(); // Key: ws object | Value: { name }
const rooms   = new Map(); // Key: roomId    | Value: Map<name, ws>
```

**Xử lý Logic từng message:**

- **`register`** – Lưu `name` vào `clients` map tương ứng với `ws` hiện tại.
- **`joinRoom`** – Thêm client vào `rooms.get(roomId)`. Gửi `roomMembers` cho toàn bộ thành viên trong phòng.
- **`offer` / `answer` / `candidate`** – Tìm đúng `ws` của `target` trong phòng và `.send()` gói tin JSON tương ứng.
- **`endCall`** – Chuyển tiếp tới toàn bộ thành viên còn lại trong phòng (trừ sender) để họ đóng PC phía mình.
- **`leaveRoom`** – Xóa client khỏi phòng, gửi `memberLeft` cho các thành viên còn lại, cập nhật `roomMembers`.
- **`ws.on('close')`** – Xử lý tương tự `leaveRoom`: tự động xóa client, gửi `memberLeft`.

---

### Người 2 – WebRTC Core & Mesh Logic (`public/webrtc.js`)

**Trách nhiệm:** Quản lý kết nối ngang hàng, xử lý luồng media, logging thống kê.

**State Client:**
```js
const peerConnections = new Map(); // Key: remoteName | Value: RTCPeerConnection
let callStartTime = null;
```

**Cấu hình ICE Servers** (dùng thống nhất toàn dự án):
```js
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:<IP_SERVER>:3478?transport=udp',  username: 'user', credential: 'password' },
    { urls: 'turn:<IP_SERVER>:3478?transport=tcp',  username: 'user', credential: 'password' },
    { urls: 'turns:<IP_SERVER>:5349?transport=tcp', username: 'user', credential: 'password' }
  ]
};
```

**Logic Mesh (Gọi nhóm):**

Khi nhấn "Start Group Call", duyệt qua danh sách `roomMembers` (trừ bản thân). Với mỗi thành viên:
1. Tạo `new RTCPeerConnection(ICE_SERVERS)`, lưu vào Map.
2. `addTrack` (local video/audio) vào connection.
3. Gắn các handler: `onicecandidate`, `ontrack`, `oniceconnectionstatechange`, `onconnectionstatechange`.
4. `createOffer` → `setLocalDescription` → gửi `offer` qua signaling server.

**Xử lý ICE Fallback (tối đa 12 giây):**
```js
// Đặt timeout ngay sau khi tạo RTCPeerConnection
const fallbackTimer = setTimeout(() => {
  if (!['connected', 'completed'].includes(pc.iceConnectionState)) {
    console.warn(`[${remoteName}] P2P failed, trying TURN...`);
    ui.setStatus(remoteName, 'connecting'); // cập nhật UI
  }
}, 12000);

pc.oniceconnectionstatechange = () => {
  if (['connected', 'completed'].includes(pc.iceConnectionState)) {
    clearTimeout(fallbackTimer);
  }
};
```

**Logging thống kê (báo cáo):**
```js
// Gọi sau khi kết nối thành công
async function logStats(pc, remoteName) {
  const stats = await pc.getStats();
  stats.forEach(report => {
    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
      const local = stats.get(report.localCandidateId);
      console.log(`[Stats] ${remoteName}:`, {
        candidateType: local?.candidateType, // host | srflx | relay
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        startTime: callStartTime,
        now: new Date().toISOString()
      });
    }
  });
}
```

**Dọn dẹp kết nối (Teardown):**

Khi nhận `memberLeft`, `endCall`, hoặc nhấn Hangup:
```js
function closePeer(remoteName) {
  const pc = peerConnections.get(remoteName);
  if (pc) {
    pc.close();
    peerConnections.delete(remoteName);
  }
  document.getElementById(`video-${remoteName}`)?.remove();
}
```
Reset toàn bộ state để sẵn sàng gọi lại, không để lại kết nối cũ.

---

### Người 3 – Frontend UI & TURN Setup (`public/index.html`, `public/ui.js`, Docker)

**Trách nhiệm:** Giao diện người dùng và hạ tầng TURN server.

**UI Flow:**

- **Màn hình 1 – Lobby:** Form nhập Nickname + Room ID + nút `Create/Join Room`.
- **Màn hình 2 – Call Dashboard:**
  - Thanh trạng thái hiển thị đầy đủ 5 trạng thái: `new` → `connecting` → `connected` → `disconnected` → `failed`
  - Mỗi peer có badge trạng thái riêng bên cạnh video
  - Nút **Start Group Call** và **Hangup**

- **Grid Video:** Tự động điều chỉnh bố cục theo số người trong phòng:
  ```css
  #video-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 8px;
  }
  ```
  Mỗi thẻ video có `id="video-{remoteName}"` để dễ xóa khi peer rời.

- **Hiển thị thống kê (tùy chọn):** Một panel nhỏ góc màn hình log lại `candidateType`, `connectionState`, thời gian bắt đầu cuộc gọi.

**Hạ tầng TURN (coturn qua Docker):**

```bash
# Bật TLS: bỏ --no-dtls --no-tls, thêm cert nếu có
docker run -d --network=host --name coturn instrumentisto/coturn \
  turnserver -a -o -v -n \
  --no-dtls --no-tls \
  -u user:password \
  -r myrealm \
  --min-port 49152 --max-port 65535
```

> Nếu muốn hỗ trợ `turns` (TLS port 5349), thêm `--cert` và `--pkey` vào lệnh trên và bỏ `--no-tls`.

---

## 4. Flow hoạt động chi tiết

### Giai đoạn 1 – Khởi động & Tham gia phòng

1. A mở trình duyệt, cấp quyền Camera/Mic. `getUserMedia` kích hoạt, hiển thị video lên `<video id="localVideo">`.
2. A nhập nickname và Room ID, nhấn **Create/Join Room**.
3. Client mở kết nối `wss://` tới Server, gửi `{ type: "register", name: "A" }`, sau đó gửi `{ type: "joinRoom" }`.
4. B thực hiện tương tự. Server gửi `{ type: "roomMembers", members: ["A", "B"] }` cho cả hai để cập nhật giao diện.

### Giai đoạn 2 – Thiết lập Mesh Call

1. A nhấn **Start Group Call**.
2. Client A duyệt `roomMembers`, tạo một `RTCPeerConnection` riêng cho từng thành viên (ở đây là B).
3. A gửi `{ type: "offer", target: "B" }` → Server chuyển tiếp cho B.
4. B nhận offer, tạo `RTCPeerConnection` cho A, gọi `setRemoteDescription` → `createAnswer` → gửi `{ type: "answer", target: "A" }`.
5. Hai bên trao đổi `{ type: "candidate" }` liên tục để thiết lập đường truyền ICE.
6. Nếu sau 12 giây ICE chưa `connected`: hiển thị cảnh báo, tiếp tục thương lượng qua TURN relay.

### Giai đoạn 3 – Truyền thông & Logging

1. ICE hoàn tất (P2P hoặc relay). Sự kiện `ontrack` kích hoạt, stream gắn vào thẻ `<video>` mới trên DOM.
2. Badge trạng thái của B chuyển sang `connected`.
3. `logStats()` được gọi để ghi lại `candidateType`, `connectionState`, thời gian bắt đầu vào console (và panel UI nếu có).

### Giai đoạn 4 – Kết thúc & Dọn dẹp

**Trường hợp 1 – B nhấn Hangup (rời phòng):**
1. Client B gửi `{ type: "leaveRoom" }`. Server xóa B, gửi `{ type: "memberLeft", name: "B" }` cho A.
2. Client A gọi `closePeer("B")`: đóng PC, xóa thẻ video, cập nhật UI.

**Trường hợp 2 – A nhấn Hangup (kết thúc cuộc gọi, ở lại phòng):**
1. Client A gửi `{ type: "endCall" }`. Server chuyển tiếp cho toàn bộ thành viên còn lại.
2. Mỗi client nhận `endCall`: gọi `closePeer` cho A, giữ nguyên kết nối WebSocket và trạng thái phòng.
3. Tất cả sẵn sàng bắt đầu cuộc gọi mới mà không cần reconnect.

---

## 5. Cấu trúc thư mục dự án

```
project/
├── server/
│   └── server.js          # Người 1
├── public/
│   ├── index.html         # Người 3
│   ├── ui.js              # Người 3
│   └── webrtc.js          # Người 2
├── certs/
│   ├── cert.pem
│   └── key.pem
├── docker-compose.yml     # Người 3 (coturn)
└── report.md
```
