import { webrtcApi } from '../api/webrtcApi';
import { DetectionDataManager } from './detectionDataManager';

export class WebRTCService {
    pc = null;
    detectionManager = null;

    async createSession(
        localStream,
        onTrack,
        onConnectionStateChange,
        onDetectionsReceived
    ) {
        const config = {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                {
                urls: [
                    "turn:free.expressturn.com:3478?transport=udp",
                    "turn:free.expressturn.com:3478?transport=tcp"
                ],
                    "username": "000000002090847582",
                    "credential": "7PW3x2fWbtdwhg9oczei+TNW8Ts="
                }
            ]
            };
            this.pc = new RTCPeerConnection(config);

            this.detectionManager = new DetectionDataManager(onDetectionsReceived);

            const detectionChannel = this.pc.createDataChannel("detections");
            this.detectionManager.attachDataChannel(detectionChannel);
            this.detectionManager.setupDataChannel(this.pc);

            this.pc.oniceconnectionstatechange = () => {
                if (onConnectionStateChange) {
                    onConnectionStateChange(this.pc.iceConnectionState);
                }
            };

            this.pc.ontrack = (event) => {
                if (onTrack && event.streams[0]) {
                    onTrack(event.streams[0]);
                }
            };

            localStream.getTracks().forEach(track => {
                this.pc.addTrack(track, localStream);
            });

            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            const answer = await webrtcApi.sendOffer(
                this.pc.localDescription.sdp,
                this.pc.localDescription.type
            );

            await this.pc.setRemoteDescription(new RTCSessionDescription({
                sdp: answer.sdp,
                type: answer.type
            }));

            return answer.session_id;
    }

    getDetectionManager() {
        return this.detectionManager;
    }

    stop() {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        this.detectionManager = null;
    }
}
