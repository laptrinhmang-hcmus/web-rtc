let ws = null;
let currentUser = "";
let currentRoom = "";
let roomMembersList = [];

const joinScreen = document.getElementById("join-screen");
const callScreen = document.getElementById("call-screen");

// Nút test giao diện khi không có server
document.getElementById("test-ui-btn").addEventListener("click", async () => {
  // 1. Xin quyền Camera/Mic
  const hasMedia = await initLocalMedia();
  if (!hasMedia) return;
  
  // 2. Cập nhật giao diện
  document.getElementById("current-room").textContent = "Phòng Test";
  joinScreen.classList.remove("active");
  callScreen.classList.add("active");
  
  // 3. Giả lập có người khác trong phòng (Test grid)
  uiAddRemoteVideo("Người dùng ảo A", null); 
  uiSetStatus("Người dùng ảo A", "connected", true);
  document.getElementById("members-count").textContent = "2";
});

// Nút vào phòng
document.getElementById("join-btn").addEventListener("click", async () => {
  currentUser = document.getElementById("username").value.trim();
  currentRoom = document.getElementById("roomcode").value.trim();
  if (!currentUser || !currentRoom) return alert("Vui lòng nhập đầy đủ!");

  // 1. Xin quyền Camera/Mic trước khi mở WebSocket
  const hasMedia = await initLocalMedia();
  if (!hasMedia) return; 

  // 2. Chuyển UI và mở WebSocket
  document.getElementById("current-room").textContent = currentRoom;
  joinScreen.classList.remove("active");
  callScreen.classList.add("active");

  initWebSocket();
});

function initWebSocket() {
  ws = new WebSocket("ws://localhost:3000"); 

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "register", name: currentUser }));
    ws.send(JSON.stringify({ type: "joinRoom", roomId: currentRoom, name: currentUser }));
  };

  ws.onmessage = (event) => {
    console.log("Nhận từ Server:", event.data);
  };
}

// Bật/Tắt mic
document.getElementById("toggle-audio-btn").addEventListener("click", (e) => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    e.target.innerHTML = track.enabled ? "🎙️ Tắt Mic" : "🎙️ Bật Mic";
  }
});

// Bật/Tắt cam
document.getElementById("toggle-video-btn").addEventListener("click", (e) => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    e.target.innerHTML = track.enabled ? "📷 Tắt Cam" : "📷 Bật Cam";
  }
});


// Nút rời phòng
document.getElementById("leave-btn").addEventListener("click", () => {
  if (ws) ws.close();
  closeAllPeers();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  
  document.getElementById("video-grid").innerHTML = `
    <div class="video-wrapper local">
      <video id="local-video" autoplay playsinline muted></video>
      <span class="name-badge">Bạn (Local)</span>
    </div>`;
    
  callScreen.classList.remove("active");
  joinScreen.classList.add("active");
});

// Thêm video remote vào màn hình
function uiAddRemoteVideo(remoteName, stream) {
  if (document.getElementById(`video-${remoteName}`)) return;

  const wrapper = document.createElement("div");
  wrapper.className = "video-wrapper remote";
  wrapper.id = `wrapper-${remoteName}`;

  const video = document.createElement("video");
  video.id = `video-${remoteName}`;
  video.autoplay = true;
  video.playsInline = true;
  
  if (stream) {
    video.srcObject = stream;
  } else {
    // Nếu là test mode (không có stream), để nền xám giả lập
    video.style.backgroundColor = "#444"; 
  }

  const nameBadge = document.createElement("span");
  nameBadge.className = "name-badge";
  nameBadge.textContent = remoteName;

  const statusBadge = document.createElement("span");
  statusBadge.className = "status-badge";
  statusBadge.id = `status-${remoteName}`;
  statusBadge.textContent = "connecting";

  wrapper.appendChild(video);
  wrapper.appendChild(nameBadge);
  wrapper.appendChild(statusBadge);
  document.getElementById("video-grid").appendChild(wrapper);
}

// Cập nhật trạng thái kết nối của remote
function uiSetStatus(remoteName, status, isSuccess = false) {
  const badge = document.getElementById(`status-${remoteName}`);
  if (badge) {
    badge.textContent = status;
    badge.className = "status-badge"; 
    if (isSuccess) badge.classList.add("status-connected");
  }
}