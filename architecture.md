# WebRTC Group Call

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

### TURN Server (Infrastructure)
- Sử dụng **coturn** triển khai qua Docker
- Hỗ trợ cấu hình ICE server cho cả STUN và TURN (TCP / UDP / TLS)

### Cách các thành phần kết nối

| Kết nối | Mô tả |
|---|---|
| Client ↔ Signaling Server | Qua `wss://<IP>:3000` – trao đổi metadata và SDP / ICE Candidates |
| Client ↔ STUN/TURN Server | Qua port `3478` (UDP/TCP) và `5349` (TLS) – lấy public IP hoặc chuyển tiếp (relay) khi NAT/Firewall chặn kết nối P2P |
| Client ↔ Client | Sau khi signaling và ICE hoàn tất, các client kết nối trực tiếp với nhau theo mô hình **Mesh** qua WebRTC (RTP/RTCP) |

---

## 2. Giao thức Signaling

### Client gửi lên Server

```json
// Tham gia phòng (server gộp chung logic Create/Join)
{ "type": "joinRoom", "roomId": "group1", "name": "A" }

// Quá trình thương lượng WebRTC
{ "type": "offer",     "roomId": "group1", "sender": "A", "target": "B", "offer": {} }
{ "type": "answer",    "roomId": "group1", "sender": "B", "target": "A", "answer": {} }
{ "type": "candidate", "roomId": "group1", "sender": "A", "target": "B", "candidate": {} }

// Rời phòng
{ "type": "leaveRoom", "roomId": "group1", "sender": "A" }
```

### Server broadcast xuống Client

```json
// Cập nhật danh sách thành viên (gửi cho tất cả khi có người ra/vào)
{ "type": "roomMembers", "roomId": "group1", "members": ["A", "B", "C"] }

// Thông báo có người rời phòng để các client khác đóng PeerConnection tương ứng
{ "type": "memberLeft", "roomId": "group1", "name": "B" }
```

---

## 3. Phân công nhiệm vụ

### Người 1 – Backend & Signaling Server (`server/server.js`)

**Trách nhiệm:** Làm trung gian trao đổi thông tin. Server không xử lý dữ liệu Audio/Video.

**Quản lý State:**
```js
const rooms = new Map();
// Key: roomId | Value: Map({ name, ws })
```

**Xử lý Logic:**

- **`joinRoom`** – Thêm client vào `rooms.get(roomId)`, gửi `roomMembers` tới toàn bộ thành viên trong phòng.
- **`offer` / `answer` / `candidate`** – Tìm đúng `ws` của `target` trong phòng và `.send()` gói tin JSON tương ứng.
- **`ws.on('close')`** – Tự động xóa client khỏi map, gửi `memberLeft` cho các thành viên còn lại.

---

### Người 2 – WebRTC Core & Mesh Logic (`public/webrtc.js`)

**Trách nhiệm:** Quản lý kết nối ngang hàng và xử lý luồng media.

**State Client:**
```js
const peerConnections = new Map();
// Key: remoteName | Value: RTCPeerConnection
```

**Logic Mesh (Gọi nhóm):**

Khi nhấn "Start Group Call", duyệt qua danh sách `roomMembers` (trừ bản thân). Với mỗi thành viên:
1. Tạo `new RTCPeerConnection(iceServers)`, lưu vào Map.
2. `addTrack` (local video/audio) vào connection.
3. `createOffer` → `setLocalDescription` → gửi `offer` qua signaling server.

**Xử lý ICE & Fallback:**

Lắng nghe sự kiện `oniceconnectionstatechange`. Nếu sau 12 giây trạng thái vẫn chưa phải `connected` hoặc `completed`:
```js
console.warn("P2P failed, trying TURN...");
```
Gọi `pc.getStats()` để kiểm tra loại candidate đang dùng (`host`, `srflx`, `relay`).

**Dọn dẹp kết nối (Teardown):**

Khi nhận `memberLeft` hoặc nhấn Hangup: lặp qua `peerConnections`, gọi `.close()`, xóa khỏi Map và gỡ thẻ `<video>` tương ứng khỏi DOM. Reset state để sẵn sàng cho cuộc gọi tiếp theo.

---

### Người 3 – Frontend UI & TURN Setup (`public/index.html`, `public/ui.js`, Docker)

**Trách nhiệm:** Giao diện người dùng và hạ tầng mạng.

**UI Flow:**

- **Màn hình 1:** Form nhập Nickname + Room ID.
- **Màn hình 2:** Giao diện cuộc gọi với thanh trạng thái: `New` → `Connecting` → `Connected`.
- **Grid Video:** Tự động điều chỉnh bố cục theo số người trong phòng:
  ```css
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  ```

**Hạ tầng TURN:**

```bash
docker run -d --network=host --name coturn instrumentisto/coturn \
  turnserver -a -o -v -n --no-dtls --no-tls \
  -u user:password -r myrealm
```

**Khai báo `iceServers` trong code:**

```js
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:<IP_SERVER>:3478?transport=udp', username: 'user', credential: 'password' },
    { urls: 'turn:<IP_SERVER>:3478?transport=tcp', username: 'user', credential: 'password' }
  ]
};
```

---

## 4. Flow hoạt động

### Giai đoạn 1 – Khởi động & Tham gia phòng

1. **A** mở trình duyệt, cấp quyền Camera/Mic. `getUserMedia` được kích hoạt, hiển thị video lên `<video id="localVideo">`.
2. A nhập tên và Room ID. Client mở kết nối `wss://` tới Server, gửi `{ type: "joinRoom" }`.
3. **B** thực hiện tương tự. Server gửi `{ type: "roomMembers" }` cho cả A và B để cập nhật danh sách thành viên trên giao diện.

### Giai đoạn 2 – Thiết lập Mesh Call

1. A nhấn **Start Group Call**.
2. Client của A tạo một `RTCPeerConnection` riêng cho B.
3. A gửi `{ type: "offer", target: "B" }` lên Server → Server chuyển tiếp cho B.
4. Client của B nhận offer, tạo `RTCPeerConnection` cho A, gọi `setRemoteDescription`, sau đó `createAnswer` và gửi `{ type: "answer", target: "A" }` lại qua Server.
5. Hai bên liên tục trao đổi ICE Candidates qua `{ type: "candidate" }` để thiết lập đường truyền.

### Giai đoạn 3 – Truyền thông & Rời phòng

1. Kết nối được thiết lập thành công (P2P trực tiếp hoặc qua TURN relay). Sự kiện `ontrack` kích hoạt, stream được gắn vào thẻ `<video>` mới trên DOM.
2. Khi B nhấn **Hangup**, gửi `{ type: "leaveRoom" }`. Server xóa B khỏi phòng và gửi `{ type: "memberLeft", name: "B" }` cho A.
3. Client A gọi `peerConnections.get("B").close()` và xóa thẻ video của B khỏi giao diện.
