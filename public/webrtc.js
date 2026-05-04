// State Client
const peerConnections = new Map(); // Key: remoteName | Value: RTCPeerConnection
let callStartTime = null;

function getIceServers() {
  let config;
  if (window.TURN_CONFIG && window.TURN_CONFIG.iceServers) {
    config = { iceServers: window.TURN_CONFIG.iceServers };
  } else {
    const host = window.location.hostname;
    const turnUser = (window.TURN_CONFIG && window.TURN_CONFIG.username) || 'user';
    const turnCred = (window.TURN_CONFIG && window.TURN_CONFIG.credential) || 'password';
    const tcpPort  = (window.TURN_CONFIG && window.TURN_CONFIG.tcpPort)  || 3478;
    const udpPort  = (window.TURN_CONFIG && window.TURN_CONFIG.udpPort)  || 3478;
    const tlsPort  = (window.TURN_CONFIG && window.TURN_CONFIG.tlsPort)  || 5349;

    config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: `turn:${host}:${udpPort}?transport=udp`, username: turnUser, credential: turnCred },
        { urls: `turn:${host}:${tcpPort}?transport=tcp`, username: turnUser, credential: turnCred },
        { urls: `turns:${host}:${tlsPort}?transport=tcp`, username: turnUser, credential: turnCred }
      ]
    };
  }

  config.iceCandidatePoolSize = 10;
  return config;
}

// Biến lưu local stream, roomId và tên local
let localStream = null;
let currentRoomId = null;
let currentUserName = null;

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
  }
}

// Logic Mesh (Gọi nhóm)
async function startGroupCall(roomMembers) {
  if (!currentUserName || !currentRoomId) return;
  if (!roomMembers || roomMembers.length <= 1) return;

  callStartTime = new Date();
  const membersToCall = roomMembers.filter(name => name !== currentUserName);

  for (const remoteName of membersToCall) {
    await createPeerConnection(remoteName);
  }
}

async function createPeerConnection(remoteName) {
  const existingPc = peerConnections.get(remoteName);
  if (existingPc) {
    if (existingPc.isCallee && remoteName < currentUserName) return;
    clearTimeout(existingPc.fallbackTimer);
    existingPc.close();
    peerConnections.delete(remoteName);
  }

  const iceConfig = getIceServers();
  const pc = new RTCPeerConnection(iceConfig);
  pc.isCaller = true;
  peerConnections.set(remoteName, pc);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // Handlers
  pc.onicecandidate = (event) => {
    if (event.candidate && peerConnections.get(remoteName) === pc) {
      sendCandidate(remoteName, event.candidate);
    }
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (stream) {
      uiAddRemoteVideo(remoteName, stream);
    }
  };

  pc.oniceconnectionstatechange = () => {
    handleIceStateChange(pc, remoteName);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      logStats(pc, remoteName);
    } else if (pc.connectionState === 'failed') {
      clearTimeout(pc.fallbackTimer);
      pc.close();
      peerConnections.delete(remoteName);
    }
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
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
      uiSetStatus(remoteName, 'connecting');
    }
  }, 20000);

  pc.fallbackTimer = fallbackTimer;
}

function handleIceStateChange(pc, remoteName) {
  if (['connected', 'completed'].includes(pc.iceConnectionState)) {
    clearTimeout(pc.fallbackTimer);
    uiSetStatus(remoteName, 'connected', true);
  } else if (pc.iceConnectionState === 'failed') {
    clearTimeout(pc.fallbackTimer);
    uiSetStatus(remoteName, 'failed');
    try {
      if (typeof pc.restartIce === 'function') {
        pc.restartIce();
      }
    } catch (e) {
      console.error(`[${remoteName}] ICE restart error:`, e);
    }
  }
}

// Handle incoming offer
async function handleOffer(data) {
  const { sender, offer } = data;

  const existingPc = peerConnections.get(sender);
  if (existingPc) {
    if (existingPc.isCaller && currentUserName < sender) return;
    clearTimeout(existingPc.fallbackTimer);
    existingPc.close();
  }

  const pc = new RTCPeerConnection(getIceServers());
  pc.isCallee = true;
  peerConnections.set(sender, pc);

  if (!callStartTime) callStartTime = new Date();

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendCandidate(sender, event.candidate);
    }
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (stream) uiAddRemoteVideo(sender, stream);
  };

  pc.oniceconnectionstatechange = () => {
    handleIceStateChange(pc, sender);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      logStats(pc, sender);
    } else if (pc.connectionState === 'failed') {
      clearTimeout(pc.fallbackTimer);
      pc.close();
      peerConnections.delete(sender);
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

  const fallbackTimer = setTimeout(() => {
    if (!['connected', 'completed'].includes(pc.iceConnectionState)) {
      uiSetStatus(sender, 'connecting');
    }
  }, 20000);

  pc.fallbackTimer = fallbackTimer;
}

// Handle incoming answer
async function handleAnswer(data) {
  const { sender, answer } = data;
  const pc = peerConnections.get(sender);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

// Handle incoming candidate
async function handleCandidate(data) {
  const { sender, candidate } = data;
  const pc = peerConnections.get(sender);
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      if (e.name === 'InvalidStateError' || String(e).includes('Unknown ufrag')) {
        // Bỏ qua candidate cũ khi PC đã được thay thế
      } else {
        console.error('Lỗi addIceCandidate từ', sender, e);
      }
    }
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
        candidateType: local?.candidateType,
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
