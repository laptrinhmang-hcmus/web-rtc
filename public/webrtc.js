let localStream = null;
let peers = {};

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

function closeAllPeers() {
  for (let peer in peers) {
    if (peers[peer]) {
      peers[peer].close();
    }
  }
  peers = {};
}
