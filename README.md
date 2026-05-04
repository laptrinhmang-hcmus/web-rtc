# WebRTC Group Call (Mesh)

Hệ thống gọi video nhóm sử dụng WebRTC với kiến trúc **Mesh topology**. Signaling server viết bằng Node.js (Express + WebSocket), client chạy trên trình duyệt.

## 1. Điều kiện

- **Node.js** 18+ (cho `--watch`)
- **OpenSSL** (để tạo chứng chỉ tự ký)
- **Docker & Docker Compose** (tùy chọn, để chạy TURN server)

## 2. Cài đặt

```bash
npm install
```

## 3. Cấu hình biến môi trường

Sao chép file `.env.example` thành `.env` và điều chỉnh:

| Biến | Mô tả |
|---|---|
| `PORT` | Port signaling server (mặc định 3000) |
| `FORCE_HTTP` | `1` = luôn chạy HTTP, `0` = tự động dùng HTTPS nếu có cert |
| `SIGNALING_URL` | URL WebSocket server (tùy chọn, client tự suy ra nếu không set) |
| `VPS_PUBLIC_IP` | IP public của VPS (bắt buộc khi chạy coturn qua Docker), server coturn nhóm em đã deploy sẵn và được gửi kèm thông tin trong **public/config.js** |

## 4. Tạo chứng chỉ HTTPS

Chứng chỉ cho phép chạy server HTTPS + WSS (cần thiết cho camera/mic). Các script tạo chứng chỉ nằm  trong **scripts/**

```bash
cd scripts
```

| Hệ điều hành | Script |
|---|---|
| Windows (CMD) | `gen-certs.bat` |
| Windows (PowerShell) | `powershell -ExecutionPolicy Bypass -File gen-certs.ps1` |
| Linux / macOS | `bash gen-certs.sh` |

Với các lỗi thiếu quyền ghi file có thể chạy bằng quyền admin, sudo,...
Sau khi chạy, file `certs/cert.pem` và `certs/key.pem` sẽ được tạo.

## 5. Chạy signaling server

### Local development (chỉ dùng khi chung mạng)

```bash
npm start          # Chạy trên port 3000
```

### Docker Compose (có thể chạy trên VPS để test trên Internet thực tế, hoặc dùng coturn đã deploy)

```bash
# Chỉ signaling server
docker compose up -d

# Signaling + TURN server (cần cấu hình turnserver.conf trước)
docker compose --profile turn up -d
```

## 6. Cấu hình TURN server

> **Lưu ý quan trọng:** `network_mode: host` trong Docker Compose **chỉ hoạt động trên Linux host**. Docker Desktop trên Windows/Mac không hỗ trợ.

### Bước 1: Thiết lập biến môi trường

Thêm IP public của VPS vào `.env`:

```bash
# Lấy IP public
curl -s ifconfig.me
# Ví dụ kết quả: 165.101.114.100

# Thêm vào .env
echo "VPS_PUBLIC_IP=165.101.114.100" >> .env
```

### Bước 2: Sửa `public/config.js`

Thay `<VPS_IP>` bằng IP public của VPS:

```js
const VPS_IP = '165.101.114.100';
```

### Bước 3: Chạy coturn

```bash
docker compose --profile turn up -d
```

Kiểm tra log:
```bash
docker compose --profile turn logs -f
```

Kiểm tra port đang listen:
```bash
ss -tlnp | grep -E '3478|5349'
ss -ulnp | grep -E '3478|5349'
```

## 7. Cách test

### Test 2 người (cùng LAN)

1. Chạy server trên máy A.
2. Mở `https://192.168.1.A:3000` trên máy A và máy B (cùng mạng WiFi/LAN).
3. Cả hai nhập cùng **Mã phòng**, tên khác nhau → nhấn **Vào phòng**.
4. Một người nhấn **📞 Gọi** → video của cả hai hiển thị.
5. Kiểm tra console (F12): `candidateType: host` → P2P thành công.

### Test gọi nhóm 3–4 người (cùng LAN)

1. Làm tương tự với 3–4 tab/thiết bị trong cùng phòng.
2. Một người nhấn **📞 Gọi** → mesh topology tự động kết nối mọi người với nhau.
3. Mỗi người thấy video local + video của các thành viên khác.

### Test khác mạng / 4G (TURN relay)

#### Cách 1. Dùng web đã deploy sẵn
- Toàn bộ web tại https://165.101.114.100:3000/
- Thông tin coturn nằm trong file **public/config.js**

#### Cách 2. Tự deploy

1. Signaling server phải public (VPS có IP public).
2. TURN server phải chạy trên cùng VPS.
3. Chạy lệnh **docker compose --profile turn up -d**
3. Mở URL trên laptop (WiFi) và điện thoại (4G, khác mạng).
4. Vào cùng phòng → nhấn **📞 Gọi**.
5. Kiểm tra console: `candidateType: relay` → TURN hoạt động.

## Cấu trúc thư mục

```
project/
├── server/
│   └── server.js          # Signaling server
├── public/
│   ├── index.html         # UI chính
│   ├── webrtc.js          # WebRTC core & mesh logic
│   ├── ui.js              # DOM & WebSocket handler
│   └── style.css          # Giao diện
├── scripts/
│   ├── gen-certs.bat      # Tạo cert (Windows CMD)
│   ├── gen-certs.ps1      # Tạo cert (Windows PowerShell)
│   └── gen-certs.sh       # Tạo cert (Linux/macOS)
├── certs/                 # Chứng chỉ
├── docker-compose.yml
├── turnserver.conf        # Cấu hình coturn
├── package.json
└── README.md
```
