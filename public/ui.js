let ws = null;
let currentUser = "";
let currentRoom = "";
let roomMembersList = [];
let callActive = false;

const joinScreen = document.getElementById("join-screen");
const callScreen = document.getElementById("call-screen");

document.getElementById("join-btn").addEventListener("click", async () => {
  currentUser = document.getElementById("username").value.trim();
  currentRoom = document.getElementById("roomcode").value.trim();
  if (!currentUser || !currentRoom) return alert("Vui lòng nhập đầy đủ!");

  const hasMedia = await initLocalMedia();
  if (!hasMedia) return;

  WebRTC.setLocalStream(localStream);
  WebRTC.setLocalName(currentUser);
  WebRTC.setRoomId(currentRoom);

  document.getElementById("current-room").textContent = currentRoom;
  joinScreen.classList.remove("active");
  callScreen.classList.add("active");

  initWebSocket();
});

// ===== WEBSOCKET =====
function initWebSocket() {
  let wsUrl = window.SIGNALING_URL;
  if (!wsUrl) {
    wsUrl = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host;
  }
  ws = new WebSocket(wsUrl);
  WebRTC.setSignalingSocket(ws);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "register", name: currentUser }));
    ws.send(JSON.stringify({ type: "joinRoom", roomId: currentRoom, name: currentUser }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'roomMembers':
        roomMembersList = data.members;
        updateMemberTiles();
        break;
      case 'memberLeft':
        WebRTC.closePeer(data.name);
        removeMemberTile(data.name);
        roomMembersList = roomMembersList.filter(name => name !== data.name);
        document.getElementById("members-count").textContent = roomMembersList.length;
        break;
      case 'offer':
        WebRTC.handleOffer(data);
        break;
      case 'answer':
        WebRTC.handleAnswer(data);
        break;
      case 'candidate':
        WebRTC.handleCandidate(data);
        break;
      case 'endCall':
        WebRTC.closePeer(data.sender);
        detachStream(data.sender);
        break;
    }
  };
}

// ===== CALL STATUS =====
function setCallStatus(text) {
  const el = document.getElementById("call-status");
  if (el) {
    el.textContent = text;
    el.className = "call-status";
    if (text !== "Đang chờ...") el.classList.add("status-active");
  }
}

// ===== MEMBER TILES =====
function updateMemberTiles() {
  const grid = document.getElementById("video-grid");
  const remoteNames = roomMembersList.filter(name => name !== currentUser);

  grid.querySelectorAll(".video-wrapper.remote").forEach(w => {
    const memberName = w.id.replace("wrapper-", "");
    if (!remoteNames.includes(memberName)) {
      w.remove();
    }
  });

  remoteNames.forEach(name => {
    if (!document.getElementById(`wrapper-${name}`)) {
      createMemberTile(name);
    }
  });

  document.getElementById("members-count").textContent = roomMembersList.length;
}

function createMemberTile(remoteName) {
  const wrapper = document.createElement("div");
  wrapper.className = "video-wrapper remote pending";
  wrapper.id = `wrapper-${remoteName}`;

  const placeholder = document.createElement("div");
  placeholder.className = "video-placeholder";
  placeholder.innerHTML = `<span class="ph-avatar">👤</span><span class="ph-name">${remoteName}</span>`;

  const statusBadge = document.createElement("span");
  statusBadge.className = "status-badge";
  statusBadge.id = `status-${remoteName}`;
  statusBadge.textContent = "Sẵn sàng";

  wrapper.appendChild(placeholder);
  wrapper.appendChild(statusBadge);
  document.getElementById("video-grid").appendChild(wrapper);
}

function uiAddRemoteVideo(remoteName, stream) {
  if (!stream || !stream.active) return;

  let wrapper = document.getElementById(`wrapper-${remoteName}`);
  if (!wrapper) {
    if (!roomMembersList.includes(remoteName)) return;
    wrapper = document.createElement("div");
    wrapper.className = "video-wrapper remote";
    wrapper.id = `wrapper-${remoteName}`;
    document.getElementById("video-grid").appendChild(wrapper);
  }

  const placeholder = wrapper.querySelector(".video-placeholder");
  if (placeholder) placeholder.remove();

  let video = wrapper.querySelector("video");
  if (!video) {
    video = document.createElement("video");
    video.id = `video-${remoteName}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    wrapper.appendChild(video);
  }
  video.srcObject = stream;
  video.play().catch(() => {});
  wrapper.classList.remove("pending");

  if (!wrapper.querySelector(".name-badge")) {
    const nameBadge = document.createElement("span");
    nameBadge.className = "name-badge";
    nameBadge.textContent = remoteName;
    wrapper.appendChild(nameBadge);
  }

  let badge = wrapper.querySelector(".status-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "status-badge";
    badge.id = `status-${remoteName}`;
    wrapper.appendChild(badge);
  }
  badge.textContent = "Đã kết nối";
  badge.className = "status-badge status-connected";
}

function detachStream(remoteName) {
  const wrapper = document.getElementById(`wrapper-${remoteName}`);
  if (!wrapper) return;

  const video = wrapper.querySelector("video");
  if (video) {
    video.srcObject = null;
    video.remove();
  }

  const nameBadge = wrapper.querySelector(".name-badge");
  if (nameBadge) nameBadge.remove();

  if (!wrapper.querySelector(".video-placeholder")) {
    const placeholder = document.createElement("div");
    placeholder.className = "video-placeholder";
    placeholder.innerHTML = `<span class="ph-avatar">👤</span><span class="ph-name">${remoteName}</span>`;
    wrapper.insertBefore(placeholder, wrapper.firstChild);
  }
  wrapper.classList.add("pending");
  uiSetStatus(remoteName, "Sẵn sàng");
}

function removeMemberTile(remoteName) {
  const wrapper = document.getElementById(`wrapper-${remoteName}`);
  if (wrapper) wrapper.remove();
}

// ===== STATUS BADGE =====
function uiSetStatus(remoteName, status, isSuccess = false) {
  const badge = document.getElementById(`status-${remoteName}`);
  if (badge) {
    badge.textContent = status;
    badge.className = "status-badge";
    if (isSuccess) badge.classList.add("status-connected");
    if (status === "failed") badge.classList.add("status-failed");
  }
}

// ===== TOGGLE MIC/CAM =====
document.getElementById("toggle-audio-btn").addEventListener("click", function() {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    this.innerHTML = track.enabled ? "🎙️ Mic" : "🔇 Mic";
  }
});

document.getElementById("toggle-video-btn").addEventListener("click", function() {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    this.innerHTML = track.enabled ? "📷 Cam" : "📸 Cam";
    const overlay = document.querySelector(".local .cam-off-overlay");
    if (overlay) overlay.style.display = track.enabled ? "none" : "flex";
  }
});

// ===== LEAVE ROOM =====
document.getElementById("leave-btn").addEventListener("click", () => {
  if (ws) ws.close();
  WebRTC.resetState();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  callActive = false;

  const grid = document.getElementById("video-grid");
  grid.querySelectorAll(".video-wrapper.remote").forEach(w => w.remove());

  callScreen.classList.remove("active");
  joinScreen.classList.add("active");
});

// ===== START CALL =====
document.getElementById("start-call-btn").addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("Chưa kết nối signaling server. Vui lòng vào phòng lại.");
    return;
  }
  if (roomMembersList.length <= 1) {
    alert("Chưa có người khác trong phòng để gọi.");
    return;
  }

  callActive = true;
  setCallStatus("Đang gọi...");

  roomMembersList.forEach(name => {
    if (name !== currentUser) {
      uiSetStatus(name, "Đang kết nối...");
    }
  });

  WebRTC.startGroupCall(roomMembersList);
});

// ===== HANGUP =====
document.getElementById("hangup-btn").addEventListener("click", () => {
  if (!callActive) return;
  callActive = false;
  setCallStatus("Đang chờ...");

  roomMembersList.forEach(name => {
    if (name !== currentUser) {
      detachStream(name);
    }
  });

  WebRTC.resetState();
  if (ws) {
    ws.send(JSON.stringify({ type: "endCall", roomId: currentRoom, sender: currentUser }));
  }
});
