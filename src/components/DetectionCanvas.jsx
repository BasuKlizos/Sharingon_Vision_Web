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

        // Debug: Log actual detection structure and crop offset
        if (detections.length > 0) {
            console.log('[DetectionCanvas] FULL detection frame:', JSON.stringify(detectionFrame, null, 2));
            console.log('[DetectionCanvas] First detection structure:', JSON.stringify(detections[0], null, 2));
            if (cropOffset) {
                console.log('[DetectionCanvas] ✅ Crop offset found:', JSON.stringify(cropOffset, null, 2));
            } else {
                console.warn('[DetectionCanvas] ⚠️ NO CROP OFFSET FOUND - backend not sending crop_offset data');
            }
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

        // Calculate scale factors based on original video dimensions
        // If crop_offset exists, use original_width/height; otherwise use videoWidth/videoHeight
        const videoWidth = cropOffset?.original_width || video.videoWidth;
        const videoHeight = cropOffset?.original_height || video.videoHeight;
        
        if (videoWidth > 0 && videoHeight > 0) {
            const scaleX = canvasDisplayWidth / videoWidth;
            const scaleY = canvasDisplayHeight / videoHeight;

            // Debug logging for coordinate verification
            console.log(`[DetectionCanvas] Video original: ${videoWidth}x${videoHeight}, Canvas display: ${canvasDisplayWidth}x${canvasDisplayHeight}, Scale: ${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);
            if (cropOffset) {
                console.log(`[DetectionCanvas] Crop offset applied: x_offset=${cropOffset.x_offset}, y_offset=${cropOffset.y_offset}`);
            }

            detections.forEach((detection) => {
                drawBoundingBox(ctx, detection, cropOffset, scaleX, scaleY);
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
function drawBoundingBox(ctx, detection, cropOffset, scaleX, scaleY) {
    const { bbox, class_name, confidence } = detection;
    
    if (!bbox) {
        console.warn('[DetectionCanvas] Missing bbox in detection:', detection);
        return;
    }

    // Get coordinates from bbox structure: x1, y1, x2, y2
    const { x1, y1, x2, y2 } = bbox;

    if (typeof x1 !== 'number' || typeof y1 !== 'number' || typeof x2 !== 'number' || typeof y2 !== 'number') {
        console.warn('[DetectionCanvas] Invalid bounding box coordinates:', bbox);
        return;
    }

    // DEBUG: Log raw detection coordinates
    console.log(`[BoxDebug] ${class_name}: Raw bbox from detection = (${x1}, ${y1}, ${x2}, ${y2})`);

    // Apply crop offset to get coordinates in original video frame
    // The backend detections are relative to the cropped frame, so we add the offset
    const offsetX = cropOffset?.x_offset || 0;
    const offsetY = cropOffset?.y_offset || 0;
    
    console.log(`[BoxDebug] ${class_name}: Crop offset = x_offset:${offsetX}, y_offset:${offsetY}`);
    
    const x1_original = x1 + offsetX;
    const y1_original = y1 + offsetY;
    const x2_original = x2 + offsetX;
    const y2_original = y2 + offsetY;

    console.log(`[BoxDebug] ${class_name}: After offset = (${x1_original}, ${y1_original}, ${x2_original}, ${y2_original})`);

    // Scale coordinates from video dimensions to canvas dimensions
    const scaledX1 = x1_original * scaleX;
    const scaledY1 = y1_original * scaleY;
    const scaledX2 = x2_original * scaleX;
    const scaledY2 = y2_original * scaleY;

    console.log(`[BoxDebug] ${class_name}: After scaling (${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) = (${scaledX1.toFixed(0)}, ${scaledY1.toFixed(0)}, ${scaledX2.toFixed(0)}, ${scaledY2.toFixed(0)})`);

    const width = scaledX2 - scaledX1;
    const height = scaledY2 - scaledY1;

    if (width < 0 || height < 0) {
        console.warn('[DetectionCanvas] Invalid box dimensions:', { width, height, bbox });
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