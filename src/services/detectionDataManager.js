/**
 * Universal DetectionDataManager
 * Handles both Mediapipe (Face) and YOLO detection data
 */
export class DetectionDataManager {
    constructor(onDetectionsReceived) {
        this.dataChannel = null;
        this.onDetectionsReceived = onDetectionsReceived;
        this.frameBuffer = [];
        this.isOpen = false;
    }

    /**
     * Checks if the WebRTC data channel is currently open
     */
    isChannelOpen() {
        return this.isOpen && this.dataChannel?.readyState === 'open';
    }

    /**
     * Initialize detection data channel
     */
    setupDataChannel(peerConnection) {
        peerConnection.ondatachannel = (event) => {
            console.log("DataManager: Remote channel detected:", event.channel.label);
            // Accept 'detections' or generic labels to stay flexible
            this.attachDataChannel(event.channel);
        };
    }

    /**
     * Attach event listeners to data channel
     */
    attachDataChannel(channel) {
        this.dataChannel = channel;

        this.dataChannel.onopen = () => {
            console.log("DataManager: Data channel opened");
            this.isOpen = true;
        };

        this.dataChannel.onclose = () => {
            console.log("DataManager: Data channel closed");
            this.isOpen = false;
            this.dataChannel = null;
        };

        this.dataChannel.onerror = (error) => {
            console.error("DataManager: Data channel error:", error);
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // ROUTING LOGIC:
                // If it has 'detections' array, it's YOLO.
                // If it's 'face_analysis' or similar, it's Mediapipe.
                if (data.detections && Array.isArray(data.detections)) {
                    this.handleYOLOFrame(data);
                } else {
                    this.handleGenericFrame(data);
                }
            } catch (error) {
                console.error("DataManager: Failed to parse message:", error);
            }
        };
    }

    /**
     * Logic for Mediapipe / Generic data
     */
    handleGenericFrame(data) {
        if (this.onDetectionsReceived) {
            this.onDetectionsReceived(data);
        }
    }

    /**
     * Logic for YOLO data (includes mapping and buffering)
     */
    handleYOLOFrame(data) {
        if (!data.frame_id) return;

        const detections = data.detections.map(det => ({
            class_id: det.class_id,
            class_name: det.class_name,
            confidence: det.confidence,
            bbox: {
                x1: det.bounding_box?.x1 || det.bbox?.x1,
                y1: det.bounding_box?.y1 || det.bbox?.y1,
                x2: det.bounding_box?.x2 || det.bbox?.x2,
                y2: det.bounding_box?.y2 || det.bbox?.y2
            }
        }));

        const detectionFrame = {
            frame_id: data.frame_id,
            timestamp: data.timestamp,
            detection_count: data.detection_count || detections.length,
            detections: detections,
            type: "yolo" // Explicitly mark as yolo
        };

        // Update buffer for stats calculation
        this.frameBuffer.push({
            ...detectionFrame,
            received_at: Date.now()
        });

        if (this.frameBuffer.length > 30) {
            this.frameBuffer.shift();
        }

        if (this.onDetectionsReceived) {
            this.onDetectionsReceived(detectionFrame);
        }
    }

    /**
     * Statistics helper for the UI
     */
    getStats() {
        if (this.frameBuffer.length === 0) {
            return { frames_received: 0, total_detections: 0, classes: {} };
        }

        const allDetections = this.frameBuffer.flatMap(f => f.detections);
        const classes = {};

        allDetections.forEach(det => {
            if (!classes[det.class_name]) {
                classes[det.class_name] = { count: 0, avg_confidence: 0, confs: [] };
            }
            classes[det.class_name].count++;
            classes[det.class_name].confs.push(det.confidence);
        });

        Object.keys(classes).forEach(name => {
            const c = classes[name];
            c.avg_confidence = c.confs.reduce((a, b) => a + b, 0) / c.confs.length;
            delete c.confs;
        });

        return {
            frames_received: this.frameBuffer.length,
            total_detections: allDetections.length,
            classes: classes
        };
    }

    getLatestDetections() {
        return this.frameBuffer.length > 0 ? this.frameBuffer[this.frameBuffer.length - 1] : null;
    }

    clearBuffer() {
        this.frameBuffer = [];
    }
}