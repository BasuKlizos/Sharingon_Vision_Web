import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
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

        // Calculate the actual rendered video rectangle inside the canvas.
        // This must match CSS `object-fit: contain` to keep boxes aligned.
        const videoWidth = cropOffset?.original_width || video.videoWidth;
        const videoHeight = cropOffset?.original_height || video.videoHeight;

        if (videoWidth > 0 && videoHeight > 0 && canvasDisplayWidth > 0 && canvasDisplayHeight > 0) {
            const renderedVideoRect = getRenderedVideoRect(
                videoWidth,
                videoHeight,
                canvasDisplayWidth,
                canvasDisplayHeight
            );
            const scaleX = renderedVideoRect.width / videoWidth;
            const scaleY = renderedVideoRect.height / videoHeight;

            // Apply Basic NMS: Filter out overlapping boxes of the same area
            const filteredDetections = filterOverlappingDetections(detections);

            filteredDetections.forEach((detection) => {
                drawBoundingBox(
                    ctx,
                    detection,
                    scaleX,
                    scaleY,
                    renderedVideoRect.left,
                    renderedVideoRect.top,
                    canvas.width,
                    canvas.height
                );
            });
        }

        drawFrameInfo(ctx, detectionFrame, canvas.width, canvas.height);
    }, [detectionFrame, videoRef]); // Re-run when the detection payload changes

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

function getRenderedVideoRect(videoWidth, videoHeight, containerWidth, containerHeight) {
    const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;

    return {
        left: (containerWidth - renderedWidth) / 2,
        top: (containerHeight - renderedHeight) / 2,
        width: renderedWidth,
        height: renderedHeight
    };
}

// Fixes: validate proper YOLO detection data structure
DetectionCanvas.propTypes = {
    videoRef: PropTypes.shape({
        current: PropTypes.instanceOf(Element)
    }).isRequired,
    detectionFrame: PropTypes.shape({
        frame_id: PropTypes.number,
        type: PropTypes.string,
        crop_offset: PropTypes.shape({
            x_offset: PropTypes.number,
            y_offset: PropTypes.number,
            original_width: PropTypes.number,
            original_height: PropTypes.number,
        }),
        yolo: PropTypes.shape({
            detections: PropTypes.arrayOf(
                PropTypes.shape({
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
function drawBoundingBox(
    ctx,
    detection,
    scaleX,
    scaleY,
    renderX = 0,
    renderY = 0,
    canvasWidth = 0,
    canvasHeight = 0
) {
    const { bbox, class_name, confidence } = detection;

    if (!bbox) return;

    // Get coordinates from bbox structure: x1, y1, x2, y2
    let { x1, y1, x2, y2 } = bbox;

    // Backend already applies crop_offset to YOLO coords (if any), so bbox is in original frame coordinates.
    // Avoid applying crop offset again in frontend to prevent duplicate translation.
    const x1_original = x1;
    const y1_original = y1;
    const x2_original = x2;
    const y2_original = y2;

    // Scale coordinates to the size of the rendered video on canvas
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
    const labelX = Math.max(0, Math.min(scaledX1, canvasWidth - textWidth - 10));
    const labelY = scaledY1 - 20 >= 0 ? scaledY1 - 20 : Math.min(canvasHeight - 20, scaledY1 + 2);

    // Draw label background
    ctx.fillStyle = color;
    ctx.fillRect(labelX, labelY, textWidth + 10, 20);
    ctx.fillStyle = '#000';
    ctx.fillText(label, labelX + 5, labelY + 15);
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
