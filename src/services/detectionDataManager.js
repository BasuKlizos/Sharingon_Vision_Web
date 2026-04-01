/**
 * Universal DetectionDataManager
 * Handles both Mediapipe (Face) and YOLO detection data
 */
export class DetectionDataManager {
    dataChannel = null;
    onDetectionsReceived = null;
    frameBuffer = [];
    isOpen = false;

    constructor(onDetectionsReceived) {
        this.onDetectionsReceived = onDetectionsReceived;
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
            this.isOpen = true;
        };

        this.dataChannel.onclose = () => {
            this.isOpen = false;
            this.dataChannel = null;
        };

        this.dataChannel.onerror = (error) => {
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // ROUTING LOGIC:
                if (!data.type) {
                    return;
                }
                if (data.type === "detection_frame") {
                    this.handleUnifiedFrame(data);
                }
            } catch (error) {
            }
        };
    }

    handleUnifiedFrame(data) {
        // 1. Extract core frame data
        const { frame_id, timestamp, yolo, face, crop_offset } = data;

        // 2. Map YOLO detections safely
        const processedDetections = (yolo?.detections || []).map(det => {
            // Fallback logic: find where the coordinates live
            // In your JSON, they are in det.bbox
            const coords = det.bbox || det.bounding_box || det;

            return {
                class_id: det.class_id,
                class_name: det.class_name,
                confidence: det.confidence,
                bbox: {
                    x1: coords.x1 ?? 0,
                    y1: coords.y1 ?? 0,
                    x2: coords.x2 ?? 0,
                    y2: coords.y2 ?? 0
                }
            };
        });

        const frame = {
            frame_id,
            timestamp,
            crop_offset: crop_offset || null, // Preserve cropping metadata
            yolo: {
                detection_count: yolo?.detection_count || 0,
                detections: processedDetections
            },
            face: face || { alerts: [], faces: [], face_count: 0 },
            type: "detection_frame",
            received_at: Date.now()
        };

        // 3. Buffer Management (FIFO)
        this.frameBuffer.push(frame);
        if (this.frameBuffer.length > 30) {
            this.frameBuffer.shift();
        }

        // 4. Callback
        if (this.onDetectionsReceived) {
            this.onDetectionsReceived(frame);
        }
    }

    /**
     * Statistics helper for the UI
     */
    getStats() {
        if (this.frameBuffer.length === 0) {
            return { frames_received: 0, total_detections: 0, classes: {} };
        }

        const allDetections = this.frameBuffer.flatMap(f => f.yolo?.detections || []);
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
        return this.frameBuffer.at(-1) ?? null;
    }

    clearBuffer() {
        this.frameBuffer = [];
    }
}