import { webrtcApi } from '../api/webrtcApi';
import { DetectionDataManager } from './detectionDataManager';

export class WebRTCService {
    constructor() {
        this.pc = null;
        this.detectionManager = null;
        this.onDetectionsReceived = null;
    }

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
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        };

        this.pc = new RTCPeerConnection(config);
        this.onDetectionsReceived = onDetectionsReceived;

        // Initialize detection data manager
        this.detectionManager = new DetectionDataManager(onDetectionsReceived);
        
        // CRITICAL: Create data channel FIRST (before creating offer)
        // This ensures the offer SDP includes the datachannel information
        const detectionChannel = this.pc.createDataChannel('detections', {
            ordered: true,
            maxPacketLifeTime: 1000
        });
        
        // Attach handlers to the channel we just created
        this.detectionManager.attachDataChannel(detectionChannel);
        
        // Also setup the ondatachannel listener for incoming channels (backup)
        this.detectionManager.setupDataChannel(this.pc);

        this.pc.oniceconnectionstatechange = () => {
            if (onConnectionStateChange) {
                onConnectionStateChange(this.pc.iceConnectionState);
            }
        };

        this.pc.onconnectionstatechange = () => {
            // Connection state changed
        };

        this.pc.onsignalingstatechange = () => {
            // Signaling state changed
        };

        // NOTE: Do NOT set pc.ondatachannel here - DetectionDataManager already handles it!
        // Setting it here would overwrite the Detection Channel handler

        this.pc.ontrack = (event) => {
            if (onTrack && event.streams[0]) {
                onTrack(event.streams[0]);
            }
        };

        this.pc.onerror = (error) => {
            console.error('WebRTC Error:', error);
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
            console.error('Failed to establish session:', err);
            this.stop();
            throw err;
        }
    }

    /**
     * Get detection manager instance
     * @returns {DetectionDataManager}
     */
    getDetectionManager() {
        return this.detectionManager;
    }

    /**
     * Get latest detections
     * @returns {Object|null}
     */
    getLatestDetections() {
        return this.detectionManager?.getLatestDetections() || null;
    }

    /**
     * Get detection statistics
     * @returns {Object}
     */
    getDetectionStats() {
        return this.detectionManager?.getStats() || {};
    }

    stop() {
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        this.detectionManager = null;
    }
}
