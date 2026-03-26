/**
 * DetectionDataManager
 * Handles receiving and parsing YOLO detection data from backend
 * via WebRTC data channel
 */

export class DetectionDataManager {
    constructor(onDetectionsReceived) {
        this.dataChannel = null;
        this.onDetectionsReceived = onDetectionsReceived;
        this.frameBuffer = [];
        this.isOpen = false;
    }

    /**
     * Initialize detection data channel
     * @param {RTCPeerConnection} peerConnection - WebRTC peer connection
     */
    setupDataChannel(peerConnection) {
        // Listen for incoming data channels
        peerConnection.ondatachannel = (event) => {
            if (event.channel.label === 'detections') {
                this.attachDataChannel(event.channel);
            } else {
                console.warn('Data channel label mismatch:', event.channel.label);
            }
        };
    }

    /**
     * Attach event listeners to data channel
     * @param {RTCDataChannel} channel - The data channel
     */
    attachDataChannel(channel) {
        this.dataChannel = channel;

        this.dataChannel.onopen = () => {
            this.isOpen = true;
        };

        this.dataChannel.onclose = () => {
            this.isOpen = false;
        };

        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleDetectionFrame(data);
            } catch (error) {
                console.error('Failed to parse detection message:', error);
            }
        };
    }

    /**
     * Process incoming detection frame
     * @param {Object} data - Parsed detection frame from backend
     */
    handleDetectionFrame(data) {
        // Validate frame structure
        if (!data.frame_id || !Array.isArray(data.detections)) {
            return;
        }

        // Parse detections
        const detections = data.detections.map(det => ({
            class_id: det.class_id,
            class_name: det.class_name,
            confidence: det.confidence,
            bbox: {
                x1: det.bounding_box.x1,
                y1: det.bounding_box.y1,
                x2: det.bounding_box.x2,
                y2: det.bounding_box.y2
            }
        }));

        const detectionFrame = {
            frame_id: data.frame_id,
            timestamp: data.timestamp,
            detection_count: data.detection_count || detections.length,
            detections: detections
        };



        // Add to buffer with timestamp
        this.frameBuffer.push({
            ...detectionFrame,
            received_at: Date.now()
        });

        // Keep only last 30 frames in buffer
        if (this.frameBuffer.length > 30) {
            this.frameBuffer.shift();
        }

        // Invoke callback
        if (this.onDetectionsReceived) {
            this.onDetectionsReceived(detectionFrame);
        }
    }

    /**
     * Get latest detections
     * @returns {Object|null} Latest detection frame
     */
    getLatestDetections() {
        return this.frameBuffer.length > 0 
            ? this.frameBuffer[this.frameBuffer.length - 1] 
            : null;
    }

    /**
     * Get detection statistics
     * @returns {Object} Statistics about received detections
     */
    getStats() {
        if (this.frameBuffer.length === 0) {
            return {
                frames_received: 0,
                total_detections: 0,
                classes: {}
            };
        }

        const allDetections = this.frameBuffer.flatMap(f => f.detections);
        const classes = {};

        allDetections.forEach(det => {
            if (!classes[det.class_name]) {
                classes[det.class_name] = {
                    count: 0,
                    avg_confidence: 0,
                    confidences: []
                };
            }
            classes[det.class_name].count++;
            classes[det.class_name].confidences.push(det.confidence);
        });

        // Calculate averages
        Object.keys(classes).forEach(className => {
            const confidences = classes[className].confidences;
            classes[className].avg_confidence = 
                confidences.reduce((a, b) => a + b, 0) / confidences.length;
            delete classes[className].confidences;
        });

        return {
            frames_received: this.frameBuffer.length,
            total_detections: allDetections.length,
            classes: classes
        };
    }

    /**
     * Clear frame buffer
     */
    clearBuffer() {
        this.frameBuffer = [];
    }

    /**
     * Check if data channel is open
     * @returns {boolean}
     */
    isChannelOpen() {
        return this.isOpen && this.dataChannel?.readyState === 'open';
    }
}
