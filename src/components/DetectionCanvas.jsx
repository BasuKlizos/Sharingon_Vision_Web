import React, { useRef, useEffect } from 'react';
import PropTypes from 'prop-types'; // Import PropTypes
import './DetectionCanvas.css';

/**
 * DetectionCanvas Component
 */
export function DetectionCanvas({ videoRef, detectionFrame }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        // Extract detections from the proper nested structure
        const detections = detectionFrame?.yolo?.detections;
        const cropOffset = detectionFrame?.crop_offset;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!canvas || !video || !detections || detections.length === 0) {
            // Clear canvas if no detections to prevent "ghost" boxes
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            return;
        }



        const ctx = canvas.getContext('2d');

        // Use offsetWidth/offsetHeight for accurate canvas sizing
        // This accounts for the actual displayed size in the DOM
        const canvasDisplayWidth = video.offsetWidth;
        const canvasDisplayHeight = video.offsetHeight;

        // Set canvas internal resolution to match display size
        // This is critical: canvas.width/height sets rendering resolution
        canvas.width = canvasDisplayWidth;
        canvas.height = canvasDisplayHeight;

        // Also set CSS to prevent scaling conflicts
        canvas.style.width = canvasDisplayWidth + 'px';
        canvas.style.height = canvasDisplayHeight + 'px';

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Calculate scale factors and offsets based on video vs canvas aspect ratio
        const videoWidth = cropOffset?.original_width || video.videoWidth;
        const videoHeight = cropOffset?.original_height || video.videoHeight;

        if (videoWidth > 0 && videoHeight > 0 && canvasDisplayWidth > 0 && canvasDisplayHeight > 0) {
            // Logic to calculate actual rendered video dimensions (handling 'contain')
            const videoRatio = videoWidth / videoHeight;
            const canvasRatio = canvasDisplayWidth / canvasDisplayHeight;

            let actualRenderWidth, actualRenderHeight;
            let offsetX_render = 0;
            let offsetY_render = 0;

            if (videoRatio > canvasRatio) {
                // Video is wider than canvas - pillarboxed (bars on top/bottom)
                actualRenderWidth = canvasDisplayWidth;
                actualRenderHeight = canvasDisplayWidth / videoRatio;
                offsetY_render = (canvasDisplayHeight - actualRenderHeight) / 2;
            } else {
                // Video is taller than canvas - letterboxed (bars on sides)
                actualRenderWidth = canvasDisplayHeight * videoRatio;
                actualRenderHeight = canvasDisplayHeight;
                offsetX_render = (canvasDisplayWidth - actualRenderWidth) / 2;
            }

            const scaleX = actualRenderWidth / videoWidth;
            const scaleY = actualRenderHeight / videoHeight;

            // Apply Basic NMS: Filter out overlapping boxes of the same area (dog vs person issue)
            const filteredDetections = filterOverlappingDetections(detections);

            filteredDetections.forEach((detection) => {
                drawBoundingBox(ctx, detection, cropOffset, scaleX, scaleY, offsetX_render, offsetY_render);
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

/**
 * Filter highly overlapping detections (simple NMS)
 */
function filterOverlappingDetections(detections) {
    if (detections.length <= 1) return detections;

    // Sort by confidence descending
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
    const kept = [];

    sorted.forEach(current => {
        let isDuplicate = false;
        for (const existing of kept) {
            const iou = calculateIOU(current.bbox, existing.bbox);
            if (iou > 0.7) { // 70% overlap threshold
                isDuplicate = true;
                break;
            }
        }
        if (!isDuplicate) kept.push(current);
    });

    return kept;
}

function calculateIOU(boxA, boxB) {
    const xA = Math.max(boxA.x1, boxB.x1);
    const yA = Math.max(boxA.y1, boxB.y1);
    const xB = Math.min(boxA.x2, boxB.x2);
    const yB = Math.min(boxA.y2, boxB.y2);

    const interArea = Math.max(0, xB - xA + 1) * Math.max(0, yB - yA + 1);
    const boxAArea = (boxA.x2 - boxA.x1 + 1) * (boxA.y2 - boxA.y1 + 1);
    const boxBArea = (boxB.x2 - boxB.x1 + 1) * (boxB.y2 - boxB.y1 + 1);

    return interArea / (boxAArea + boxBArea - interArea);
}

// Fixes: validate proper YOLO detection data structure
DetectionCanvas.propTypes = {
    videoRef: PropTypes.shape({
        current: PropTypes.instanceOf(Element)
    }).isRequired,
    detectionFrame: PropTypes.shape({
        frame_id: PropTypes.number,
        timestamp: PropTypes.number,
        type: PropTypes.string,
        crop_offset: PropTypes.shape({
            x_offset: PropTypes.number,
            y_offset: PropTypes.number,
            original_width: PropTypes.number,
            original_height: PropTypes.number,
            cropped_width: PropTypes.number,
            cropped_height: PropTypes.number,
        }),
        yolo: PropTypes.shape({
            detection_count: PropTypes.number,
            detections: PropTypes.arrayOf(
                PropTypes.shape({
                    class_id: PropTypes.number,
                    class_name: PropTypes.string,
                    confidence: PropTypes.number,
                    bbox: PropTypes.shape({
                        x1: PropTypes.number.isRequired,
                        y1: PropTypes.number.isRequired,
                        x2: PropTypes.number.isRequired,
                        y2: PropTypes.number.isRequired,
                    }).isRequired,
                })
            )
        })
    })
};

/**
 * Draw bounding box with label
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} detection - Detection object with bbox
 * @param {Object|null} cropOffset - Crop offset info or null if no cropping
 * @param {number} scaleX - Horizontal scale factor
 * @param {number} scaleY - Vertical scale factor
 */
function drawBoundingBox(ctx, detection, cropOffset, scaleX, scaleY, renderX = 0, renderY = 0) {
    const { bbox, class_name, confidence } = detection;

    if (!bbox) return;

    // Get coordinates from bbox structure: x1, y1, x2, y2
    let { x1, y1, x2, y2 } = bbox;

    // CORRECTED LOGIC: 
    // Coordinates from YOLO are in cropped image space (0 to cropped_width/height)
    // We need to:
    // 1. Map them back to original frame coordinates by adding crop offset
    // 2. Then scale to canvas display size

    const offsetX = cropOffset?.x_offset || 0;
    const offsetY = cropOffset?.y_offset || 0;

    // Transform from cropped space to original frame space
    const x1_original = x1 + offsetX;
    const y1_original = y1 + offsetY;
    const x2_original = x2 + offsetX;
    const y2_original = y2 + offsetY;

    // Scale coordinates to the size of the rendered video
    const scaledX1 = (x1_original * scaleX) + renderX;
    const scaledY1 = (y1_original * scaleY) + renderY;
    const scaledX2 = (x2_original * scaleX) + renderX;
    const scaledY2 = (y2_original * scaleY) + renderY;

    const width = scaledX2 - scaledX1;
    const height = scaledY2 - scaledY1;

    // Skip invalid boxes
    if (width <= 0 || height <= 0) {
        return;
    }

    const color = getColorForConfidence(confidence);

    // Draw rectangle border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(scaledX1, scaledY1, width, height);

    const label = `${class_name} ${(confidence * 100).toFixed(0)}%`;
    ctx.font = `bold 14px Arial`;
    const textWidth = ctx.measureText(label).width;

    // Draw label background
    ctx.fillStyle = color;
    ctx.fillRect(scaledX1, scaledY1 - 20, textWidth + 10, 20);
    ctx.fillStyle = '#000';
    ctx.fillText(label, scaledX1 + 5, scaledY1 - 5);
}

function getColorForConfidence(conf) {
    if (conf >= 0.8) return '#00ff00';
    if (conf >= 0.5) return '#ffff00';
    return '#ff0000';
}

function drawFrameInfo(ctx, frame, w, h) {
    // High-contrast overlay for accessibility
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(8, h - 24, 70, 18);
    ctx.fillStyle = '#ffffff';
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

DetectionStats.propTypes = {
    detectionFrame: PropTypes.shape({
        frame_id: PropTypes.number,
        timestamp: PropTypes.number,
        yolo: PropTypes.shape({
            detection_count: PropTypes.number
        })
    }),
    stats: PropTypes.object
};