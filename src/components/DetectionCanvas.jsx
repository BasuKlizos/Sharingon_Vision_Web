import React, { useRef, useEffect } from 'react';
import './DetectionCanvas.css';

/**
 * DetectionCanvas Component
 * Renders bounding boxes and detection info on a canvas overlay
 */
export function DetectionCanvas({ videoRef, detectionFrame, videoWidth = 1280, videoHeight = 720 }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!canvasRef.current || !detectionFrame || !detectionFrame.detections) {
            return;
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Set canvas size to match video
        if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
            canvas.width = videoWidth;
            canvas.height = videoHeight;
        }

        // Get scale factors (in case video is displayed at different size)
        const videoElement = videoRef?.current;
        let scaleX = 1;
        let scaleY = 1;

        if (videoElement && videoElement.videoWidth) {
            scaleX = videoElement.clientWidth / videoElement.videoWidth;
            scaleY = videoElement.clientHeight / videoElement.videoHeight;
        }

        // Draw each detection
        detectionFrame.detections.forEach((detection, index) => {
            drawCenterCircle(ctx, detection, scaleX, scaleY, index);
        });

        // Draw frame info
        drawFrameInfo(ctx, detectionFrame, canvas.width, canvas.height);
    }, [detectionFrame, videoRef, videoWidth, videoHeight]);

    return (
        <canvas
            ref={canvasRef}
            className="detection-canvas"
            width={videoWidth}
            height={videoHeight}
        />
    );
}

function drawCenterCircle(ctx, detection, scaleX, scaleY, index) {
    const { bbox, class_name, confidence } = detection;

    // Scale coordinates
    const x1 = bbox.x1 * scaleX;
    const y1 = bbox.y1 * scaleY;
    const x2 = bbox.x2 * scaleX;
    const y2 = bbox.y2 * scaleY;

    // Calculate center point and radius based on bounding box width/height
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    
    // Determine a reasonable radius (half the average of width and height, or max)
    const width = x2 - x1;
    const height = y2 - y1;
    const radius = Math.max(width, height) / 2;

    // Color based on confidence
    const color = getColorForConfidence(confidence);

    // Draw circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Optionally draw a subtle fill for the circle
    ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');
    // If it's a hex color, we can't do the simple replace easily without a hex-to-rgba converter,
    // so let's just use standard globalAlpha
    ctx.globalAlpha = 0.2;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Draw filled background for label above the circle
    const label = `${class_name} ${(confidence * 100).toFixed(1)}%`;
    const fontSize = 14;
    ctx.font = `bold ${fontSize}px Arial`;
    const textMetrics = ctx.measureText(label);
    const textHeight = fontSize + 4;

    const labelX = cx - textMetrics.width / 2 - 4;
    const labelY = cy - radius - 10;

    ctx.fillStyle = color;
    ctx.fillRect(labelX, labelY - textHeight, textMetrics.width + 8, textHeight);

    // Draw label text
    ctx.fillStyle = '#fff';
    ctx.fillText(label, labelX + 4, labelY - 4);
}

/**
 * Get color based on confidence score
 */
function getColorForConfidence(confidence) {
    if (confidence >= 0.85) {
        return '#00ff00'; // Green - high confidence
    } else if (confidence >= 0.70) {
        return '#ffff00'; // Yellow - medium confidence
    } else if (confidence >= 0.50) {
        return '#ff8800'; // Orange - lower confidence
    } else {
        return '#ff0000'; // Red - low confidence
    }
}

/**
 * Draw frame info (frame_id, timestamp, count)
 */
function drawFrameInfo(ctx, detectionFrame, canvasWidth, canvasHeight) {
    const fontSize = 16;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(0, 200, 100, 0.8)';

    const infoText = `Frame: ${detectionFrame.frame_id} | Objects: ${detectionFrame.detection_count}`;
    const metrics = ctx.measureText(infoText);

    // Draw background for info
    ctx.fillRect(
        10,
        canvasHeight - 35,
        metrics.width + 20,
        30
    );

    // Draw text
    ctx.fillStyle = '#fff';
    ctx.fillText(infoText, 20, canvasHeight - 12);
}

/**
 * DetectionStats Component
 * Display statistics about detections
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
                            {detectionFrame.detection_count}
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

            {stats && stats.classes && Object.keys(stats.classes).length > 0 && (
                <div className="class-stats">
                    <h4>Detection Summary</h4>
                    <div className="classes-list">
                        {Object.entries(stats.classes).map(([className, classStats]) => (
                            <div key={className} className="class-item">
                                <div className="class-name">{className}</div>
                                <div className="class-info">
                                    <span className="count">Count: {classStats.count}</span>
                                    <span className="confidence">
                                        Avg Conf: {(classStats.avg_confidence * 100).toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {stats && (
                <div className="session-stats">
                    <div className="stat-row">
                        <span className="label">Frames Received:</span>
                        <span className="value">{stats.frames_received}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
