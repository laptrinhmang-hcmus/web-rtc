// WebRTC Core & Mesh Logic

// State Client
const peerConnections = new Map(); // Key: remoteName | Value: RTCPeerConnection
let callStartTime = null;

function getIceServers() {
  const host = window.location.hostname;
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: `turn:${host}:3478?transport=udp`, username: 'user', credential: 'password' },
      { urls: `turn:${host}:3478?transport=tcp`, username: 'user', credential: 'password' },
      { urls: `turns:${host}:5349?transport=tcp`, username: 'user', credential: 'password' }
    ]
  };
}

// Biến lưu local stream, roomId và tên local
let localStream = null;
let currentRoomId = null;
let currentUserName = null;

// Function to set local stream
function setLocalStream(stream) {
  localStream = stream;
}

function setRoomId(roomId) {
  currentRoomId = roomId;
}

function setLocalName(name) {
  currentUserName = name;
}

// Init local media
async function initLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    const localVideo = document.getElementById("local-video");
    if (localVideo) {
      localVideo.srcObject = localStream;
    }
    return true;
  } catch (error) {
    console.error("Lỗi khi xin quyền camera/mic:", error);
    alert("Không thể truy cập Camera/Mic. Vui lòng cấp quyền để tiếp tục!");
    return false;
  }
}

// Signaling WebSocket instance
let signalingSocket = null;

function setSignalingSocket(ws) {
  signalingSocket = ws;
}

// Send message via WebSocket
function sendMessage(msg) {
  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    signalingSocket.send(JSON.stringify(msg));
  } else {
    console.warn('WebSocket signaling chưa sẵn sàng:', msg);
  }
}

// Logic Mesh (Gọi nhóm)
async function startGroupCall(roomMembers) {
  if (!currentUserName || !currentRoomId) {
    console.warn('startGroupCall aborted: missing currentUserName or currentRoomId', { currentUserName, currentRoomId });
    return;
  }

  if (!roomMembers || roomMembers.length <= 1) {
    console.warn('Không có peer để gọi. roomMembers:', roomMembers);
    return;
  }

  callStartTime = new Date();
  const membersToCall = roomMembers.filter(name => name !== currentUserName);
  console.log('Bắt đầu gọi nhóm', { currentUserName, currentRoomId, membersToCall });

  for (const remoteName of membersToCall) {
    await createPeerConnection(remoteName);
  }
}

async function createPeerConnection(remoteName) {
  const iceConfig = getIceServers();
  console.log('Tạo RTCPeerConnection cho', remoteName, iceConfig);
  const pc = new RTCPeerConnection(iceConfig);
  peerConnections.set(remoteName, pc);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Handlers
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendCandidate(remoteName, event.candidate);
    }
  };

  pc.ontrack = (event) => {
    uiAddRemoteVideo(remoteName, event.streams[0]);
  };

  pc.oniceconnectionstatechange = () => {
    handleIceStateChange(pc, remoteName);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      logStats(pc, remoteName);
    }
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log('Gửi offer tới', remoteName, { roomId: currentRoomId, sender: currentUserName });
  sendMessage({
    type: 'offer',
    roomId: currentRoomId,
    sender: currentUserName,
    target: remoteName,
    offer: offer
  });

  // ICE Fallback timer
  const fallbackTimer = setTimeout(() => {
    if (!['connected', 'completed'].includes(pc.iceConnectionState)) {
      console.warn(`[${remoteName}] P2P failed, trying TURN...`, pc.iceConnectionState, 'remoteName:', remoteName);
      uiSetStatus(remoteName, 'connecting');
    }
  }, 12000);

  pc.fallbackTimer = fallbackTimer;
}

function handleIceStateChange(pc, remoteName) {
  if (['connected', 'completed'].includes(pc.iceConnectionState)) {
    clearTimeout(pc.fallbackTimer);
    uiSetStatus(remoteName, 'connected', true);
  } else if (pc.iceConnectionState === 'failed') {
    uiSetStatus(remoteName, 'failed');
  }
}

// Handle incoming offer
async function handleOffer(data) {
  const { sender, offer } = data;
  const pc = new RTCPeerConnection(getIceServers());
  peerConnections.set(sender, pc);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Handlers (similar to createPeerConnection)
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendCandidate(sender, event.candidate);
    }
  };

  pc.ontrack = (event) => {
    uiAddRemoteVideo(sender, event.streams[0]);
  };

  pc.oniceconnectionstatechange = () => {
    handleIceStateChange(pc, sender);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      logStats(pc, sender);
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendMessage({
    type: 'answer',
    roomId: currentRoomId,
    sender: currentUserName,
    target: sender,
    answer: answer
  });

  // ICE Fallback timer
  const fallbackTimer = setTimeout(() => {
    if (!['connected', 'completed'].includes(pc.iceConnectionState)) {
      console.warn(`[${sender}] P2P failed, trying TURN...`);
      uiSetStatus(sender, 'connecting');
    }
  }, 12000);

  pc.fallbackTimer = fallbackTimer;
}

// Handle incoming answer
async function handleAnswer(data) {
  const { sender, answer } = data;
  console.log('Nhận answer từ', sender, data);
  const pc = peerConnections.get(sender);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } else {
    console.warn('Không tìm thấy PeerConnection cho answer từ', sender);
  }
}

// Handle incoming candidate
async function handleCandidate(data) {
  const { sender, candidate } = data;
  console.log('Nhận candidate từ', sender, candidate);
  const pc = peerConnections.get(sender);
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } else {
    console.warn('Không tìm thấy PeerConnection cho candidate từ', sender);
  }
}

function sendCandidate(remoteName, candidate) {
  sendMessage({
    type: 'candidate',
    roomId: currentRoomId,
    sender: currentUserName,
    target: remoteName,
    candidate: candidate
  });
}

// Logging thống kê
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

// Dọn dẹp kết nối
function closePeer(remoteName) {
  const pc = peerConnections.get(remoteName);
  if (pc) {
    pc.close();
    peerConnections.delete(remoteName);
    clearTimeout(pc.fallbackTimer);
  }
  const wrapper = document.getElementById(`wrapper-${remoteName}`);
  if (wrapper) {
    wrapper.remove();
  }
}

// Reset toàn bộ state
function resetState() {
  peerConnections.forEach((pc, name) => closePeer(name));
  callStartTime = null;
}

// Export functions
window.WebRTC = {
  setLocalStream,
  setRoomId,
  setLocalName,
  setSignalingSocket,
  startGroupCall,
  handleOffer,
  handleAnswer,
  handleCandidate,
  closePeer,
  resetState
};

window.initLocalMedia = initLocalMedia;
