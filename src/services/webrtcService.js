import { webrtcApi } from '../api/webrtcApi';
import { DetectionDataManager } from './detectionDataManager';

export class WebRTCService {
        pc = null;
        detectionManager = null;

        /**
         * Create WebRTC session with detection support
         * @param {MediaStream} localStream - Local media stream
         * @param {Function} onTrack - Callback when remote track received
         * @param {Function} onConnectionStateChange - Callback for connection state changes
         * @param {Function} onDetectionsReceived - Callback when detections arrive
         * @returns {string} Session ID from backend
         */
        async createSession(
            localStream,
            onTrack,
            onConnectionStateChange,
            onDetectionsReceived
        ) {
            const config = {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, {
                    urls: "free.expressturn.com:3478",
                    username: "000000002090845040",
                    credential: "5NTdASVWw8AreIFCZHrGBweFDTA="
                }]
            };

            this.pc = new RTCPeerConnection(config);

            // 🔥 INIT detection manager
            this.detectionManager = new DetectionDataManager(onDetectionsReceived);

            // 🔥 IMPORTANT: create DataChannel HERE (correct place)
            const detectionChannel = this.pc.createDataChannel("detections");
            console.log("detectionChannel", detectionChannel);
            this.detectionManager.attachDataChannel(detectionChannel);
            this.detectionManager.setupDataChannel(this.pc);

            this.pc.oniceconnectionstatechange = () => {
                if (onConnectionStateChange) {
                    onConnectionStateChange(this.pc.iceConnectionState);
                }
            };

            this.pc.ontrack = (event) => {
                console.log("event", event);
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

//     /**
//      * Get detection manager instance
//      * @returns {DetectionDataManager}
//      */
//     getDetectionManager() {
//         return this.detectionManager;
//     }

//     /**
//      * Get latest detections
//      * @returns {Object|null}
//      */
//     getLatestDetections() {
//         return this.detectionManager?.getLatestDetections() || null;
//     }

//     /**
//      * Get detection statistics
//      * @returns {Object}
//      */
//     getDetectionStats() {
//         return this.detectionManager?.getStats() || {};
//     }

//     stop() {
//         if (this.pc) {
//             this.pc.close();
//             this.pc = null;
//         }
//         this.detectionManager = null;
//     }
// }
