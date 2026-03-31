import React, { useRef, useEffect } from 'react';
import PropTypes from 'prop-types'; // Import PropTypes
import './DetectionCanvas.css';

/**
 * DetectionCanvas Component
 */
export function DetectionCanvas({ videoRef, detectionFrame }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const detections = detectionFrame?.yolo?.detections;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!canvas || !video || !detections) {
            // Clear canvas if no detections to prevent "ghost" boxes
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            return;
        }

        const ctx = canvas.getContext('2d');
        const rect = video.getBoundingClientRect();
        
        // Match canvas internal resolution to the visual size on screen
        canvas.width = rect.width;
        canvas.height = rect.height;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Map YOLO coordinates to Canvas pixels
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            const scaleX = rect.width / video.videoWidth;
            const scaleY = rect.height / video.videoHeight;

            detections.forEach((detection, index) => {
                drawBoundingBox(ctx, detection, scaleX, scaleY, index);
            });
        }

        drawFrameInfo(ctx, detectionFrame, canvas.width, canvas.height);
    }, [detectionFrame, videoRef, videoRef.current?.videoWidth]); // Re-run when video is ready

    return (
        <canvas
            ref={canvasRef}
            className="detection-canvas"
        />
    );
}

// Fixes: 'videoRef.current.videoHeight' and 'detectionFrame.yolo.detections' validation
DetectionCanvas.propTypes = {
    videoRef: PropTypes.shape({
        current: PropTypes.instanceOf(Element)
    }).isRequired,
    detectionFrame: PropTypes.shape({
        frame_id: PropTypes.number,
        detection_count: PropTypes.number,
        timestamp: PropTypes.number,
        yolo: PropTypes.shape({
            detections: PropTypes.arrayOf(
                PropTypes.shape({
                    bbox: PropTypes.shape({
                        x1: PropTypes.number,
                        y1: PropTypes.number,
                        x2: PropTypes.number,
                        y2: PropTypes.number,
                    }),
                    class_name: PropTypes.string,
                    confidence: PropTypes.number,
                })
            )
        })
    })
};

/**
 * Draw bounding box with label
 */
function drawBoundingBox(ctx, detection, scaleX, scaleY) {
    const { bbox, class_name, confidence } = detection;
    if (!bbox) return;

    const x1 = bbox.x1 * scaleX;
    const y1 = bbox.y1 * scaleY;
    const x2 = bbox.x2 * scaleX;
    const y2 = bbox.y2 * scaleY;

    const width = x2 - x1;
    const height = y2 - y1;

    const color = getColorForConfidence(confidence);

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, width, height);

    const label = `${class_name} ${(confidence * 100).toFixed(0)}%`;
    ctx.font = `bold 14px Arial`;
    const textWidth = ctx.measureText(label).width;

    ctx.fillStyle = color;
    ctx.fillRect(x1, y1 - 20, textWidth + 10, 20);
    ctx.fillStyle = '#000';
    ctx.fillText(label, x1 + 5, y1 - 5);
}

function getColorForConfidence(conf) {
    if (conf >= 0.8) return '#00ff00';
    if (conf >= 0.5) return '#ffff00';
    return '#ff0000';
}

function drawFrameInfo(ctx, frame, w, h) {
    ctx.fillStyle = 'rgba(0, 255, 150, 0.7)';
    ctx.font = '12px monospace';
    ctx.fillText(`ID: ${frame.frame_id}`, 10, h - 10);
}

/**
 * DetectionStats Component
 */
export function DetectionStats({ detectionFrame, stats }) {
    if (!detectionFrame && !stats) {
        return (
            <div className="detection-stats no-data">
                <p>Waiting for detections...</p>
            </div>
        );
    }

    return (
        <div className="detection-stats">
            <div className="stats-header">
                <h3>Detection Stats</h3>
            </div>

            {detectionFrame && (
                <div className="current-frame">
                    <div className="stat-row">
                        <span className="label">Frame ID:</span>
                        <span className="value">{detectionFrame.frame_id}</span>
                    </div>
                    <div className="stat-row">
                        <span className="label">Objects Detected:</span>
                        <span className="value highlighted">
                            {detectionFrame.yolo?.detection_count || 0}
                        </span>
                    </div>
                    <div className="stat-row">
                        <span className="label">Timestamp:</span>
                        <span className="value">
                            {new Date(detectionFrame.timestamp * 1000).toLocaleTimeString()}
                        </span>
                    </div>
                </div>
            )}

            {/* ... rest of your mapping logic ... */}
        </div>
    );
}

DetectionCanvas.propTypes = {
    videoRef: PropTypes.object.isRequired,
    detectionFrame: PropTypes.object
};