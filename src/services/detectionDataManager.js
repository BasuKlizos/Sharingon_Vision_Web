/**
 * Universal DetectionDataManager
 * Handles both Mediapipe (Face) and YOLO detection data
 */
export class DetectionDataManager {
    dataChannel = null;
    onDetectionsReceived = null;
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

        this.dataChannel.onerror = () => {
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
            } catch {
                console.warn('Unable to parse detection data channel message.');
            }
        };
    }

    normalizeDetections(detections) {
        if (!Array.isArray(detections) || detections.length === 0) {
            return [];
        }

        const alreadyNormalized = detections.every((detection) => (
            detection
            && typeof detection === 'object'
            && detection.bbox
            && typeof detection.bbox === 'object'
        ));

        if (alreadyNormalized) {
            return detections;
        }

        return detections.map((det) => {
            const coords = det.bbox || det.bounding_box || det;

            return {
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
    }

    handleUnifiedFrame(data) {
        const { frame_id, yolo, face, crop_offset } = data;
        const processedDetections = this.normalizeDetections(yolo?.detections);

        const frame = {
            frame_id,
            crop_offset: crop_offset || null,
            yolo: {
                detections: processedDetections
            },
            face: face || { alerts: [], faces: [], face_count: 0, current_view: null },
            type: "detection_frame"
        };

        if (this.onDetectionsReceived) {
            this.onDetectionsReceived(frame);
        }
    }

    sendCurrentView(currentView) {
        if (!this.isChannelOpen() || !currentView) {
            return false;
        }

        try {
            this.dataChannel.send(JSON.stringify({
                type: 'current_view',
                currentView
            }));
            return true;
        } catch (error) {
            console.error('[Detection] Failed to send current view via WebRTC data channel', error);
            return false;
        }
    }
}
