import { webrtcApi } from '../api/webrtcApi';

export class WebRTCService {
    constructor() {
        this.pc = null;
    }

    async createSession(localStream, onTrack, onConnectionStateChange) {
        const config = {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        };

        this.pc = new RTCPeerConnection(config);

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

        try {
            const answer = await webrtcApi.sendOffer(
                this.pc.localDescription.sdp,
                this.pc.localDescription.type
            );

            await this.pc.setRemoteDescription(new RTCSessionDescription({
                sdp: answer.sdp,
                type: answer.type
            }));

            return answer.session_id;
        } catch (err) {
            this.stop();
            throw err;
        }
    }

    stop() {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
    }
}
