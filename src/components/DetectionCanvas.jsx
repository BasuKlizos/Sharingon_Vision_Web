import React, { useRef, useEffect } from 'react';
import './DetectionCanvas.css';

/**
 * DetectionCanvas Component
 * Renders detection circles on a canvas overlay, correctly accounting
 * for the video element's object-fit: cover cropping.
 */
export function DetectionCanvas({ videoRef, detectionFrame }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const videoElement = videoRef?.current;

        if (!canvas || !videoElement || !detectionFrame?.detections) {
            return;
        }

        const ctx = canvas.getContext('2d');

        // ── Step 1: Size the canvas to the CONTAINER display dimensions ──────
        // object-fit on <canvas> has no effect, so we manage pixels manually.
        const containerW = videoElement.clientWidth;
        const containerH = videoElement.clientHeight;

        if (canvas.width !== containerW || canvas.height !== containerH) {
            canvas.width = containerW;
            canvas.height = containerH;
        }

        ctx.clearRect(0, 0, containerW, containerH);

        const videoW = videoElement.videoWidth;
        const videoH = videoElement.videoHeight;

        if (!videoW || !videoH) return;

        // ── Step 2: Reproduce object-fit: cover math ─────────────────────────
        // The browser picks the LARGER of the two ratios so the source fills
        // the container, then crops the axis that overflows.
        const scale = Math.max(containerW / videoW, containerH / videoH);

        // After scaling, the rendered video dimensions:
        const renderedW = videoW * scale;
        const renderedH = videoH * scale;

        // The crop offset (negative = the portion that is hidden):
        const offsetX = (containerW - renderedW) / 2;
        const offsetY = (containerH - renderedH) / 2;

        // ── Step 3: Draw each detection using transformed coordinates ────────
        detectionFrame.detections.forEach((detection, index) => {
            drawCenterCircle(ctx, detection, scale, offsetX, offsetY, index);
        });

        drawFrameInfo(ctx, detectionFrame, containerW, containerH);

    }, [detectionFrame, videoRef]);

    return (
        <canvas
            ref={canvasRef}
            className="detection-canvas"
        />
    );
}

/**
 * Draw a circle around the detected object with a label.
 * Coordinates come from the backend in video-source space;
 * we map them into container-display space using the cover transform.
 */
function drawCenterCircle(ctx, detection, scale, offsetX, offsetY, index) {
    const { bbox, class_name, confidence } = detection;

    // Map bounding box from video-source space → display space
    const x1 = bbox.x1 * scale + offsetX;
    const y1 = bbox.y1 * scale + offsetY;
    const x2 = bbox.x2 * scale + offsetX;
    const y2 = bbox.y2 * scale + offsetY;

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const radius = Math.max(x2 - x1, y2 - y1) / 2;

    const color = getColorForConfidence(confidence);

    // Stroke circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Subtle fill
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Label pill above the circle
    const label = `${class_name} ${(confidence * 100).toFixed(1)}%`;
    const fontSize = 13;
    ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
    const tw = ctx.measureText(label).width;
    const th = fontSize + 6;
    const lx = cx - tw / 2 - 5;
    const ly = cy - radius - 8;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(lx, ly - th, tw + 10, th, 4);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.fillText(label, lx + 5, ly - 5);
}

/**
 * Get color based on confidence score
 */
function getColorForConfidence(confidence) {
    if (confidence >= 0.85) return '#00ff00';
    if (confidence >= 0.70) return '#ffff00';
    if (confidence >= 0.50) return '#ff8800';
    return '#ff4444';
}

/**
 * Draw frame info overlay (bottom-left corner)
 */
function drawFrameInfo(ctx, detectionFrame, canvasWidth, canvasHeight) {
    const text = `Frame: ${detectionFrame.frame_id} | Objects: ${detectionFrame.detection_count}`;
    const fontSize = 13;
    ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
    const tw = ctx.measureText(text).width;
    const pad = 8;
    const bh = fontSize + pad * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(10, canvasHeight - bh - 10, tw + pad * 2, bh, 6);
    ctx.fill();

    ctx.fillStyle = '#00ff96';
    ctx.fillText(text, 10 + pad, canvasHeight - 10 - pad / 2);
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
