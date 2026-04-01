import React, { useRef, useEffect } from "react";
import PropTypes from 'prop-types';

export function FaceCanvas({ videoRef, data }) {
  const canvasRef = useRef(null);

  const draw = () => {
    const canvas = canvasRef.current;
    const video = videoRef?.current;

    if (!canvas || !video || video.videoWidth === 0) return;

    const ctx = canvas.getContext("2d");
    
    // Use offsetWidth/offsetHeight for accurate canvas sizing
    const displayWidth = video.offsetWidth;
    const displayHeight = video.offsetHeight;
    
    // Set canvas internal resolution to match display size
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!data) return;

    // Handle both face_analysis and detection_frame data structures.
    // App may pass only the `face` object, or full frame object with `face` nested.
    let faceData = null;
    if (data?.faces) {
      faceData = data;
    } else if (data?.data?.faces) {
      faceData = data.data;
    } else if (data?.face?.faces) {
      faceData = data.face;
    }

    const cropOffset = faceData?.crop_offset || null;

    if (!faceData) return;

    // Calculate scale factors
    // If crop_offset exists, use original dimensions; otherwise use video dimensions
    const videoWidth = cropOffset?.original_width || video.videoWidth;
    const videoHeight = cropOffset?.original_height || video.videoHeight;
    
    const scaleX = canvas.width / videoWidth;
    const scaleY = canvas.height / videoHeight;

    // Apply crop offset for coordinate transformation
    const offsetX = cropOffset?.x_offset || 0;
    const offsetY = cropOffset?.y_offset || 0;

    // Draw Face Markers
    if (faceData.faces) {
      faceData.faces.forEach((face, i) => {
        let coord = null;

        if (face.nose_px?.length === 2) coord = face.nose_px;
        else if (face.eye_px?.length === 2) coord = face.eye_px;
        else if (face.eye_norm?.length === 2) {
          // fallback: normalized coordinates if provided (0..1)
          coord = [face.eye_norm[0] * videoWidth, face.eye_norm[1] * videoHeight];
        }

        if (!coord) return;

        const [x, y] = coord;
        // Apply crop offset to coordinates
        const x_original = x + offsetX;
        const y_original = y + offsetY;
        
        const drawX = x_original * scaleX;
        const drawY = y_original * scaleY;

        ctx.beginPath();
        ctx.arc(drawX, drawY, 8, 0, 2 * Math.PI);
        ctx.fillStyle = face.looking_away ? "#ff4d4d" : "#00ff00";
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow for text

        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px Inter, sans-serif";
        ctx.fillText(`Face ${i + 1}`, drawX + 12, drawY + 4);
      });
    }

    // Draw Alerts
    if (faceData.alerts?.length) {
      ctx.fillStyle = "#ff4d4d";
      ctx.font = "bold 20px Inter, sans-serif";
      faceData.alerts.forEach((alertText, i) => {
        ctx.fillText(`⚠️ ${alertText}`, 20, 40 + i * 30);
      });
    }
  };

  useEffect(() => {
    draw();
    
    // Update on resize to keep alignment
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 20,
        display: "block"
      }}
    />
  );
}

FaceCanvas.propTypes = {
  videoRef: PropTypes.shape({
    current: PropTypes.shape({
      videoWidth: PropTypes.number,
      videoHeight: PropTypes.number,
      offsetWidth: PropTypes.number,
      offsetHeight: PropTypes.number
    })
  }).isRequired,
  data: PropTypes.shape({
    crop_offset: PropTypes.shape({
      x_offset: PropTypes.number,
      y_offset: PropTypes.number,
      original_width: PropTypes.number,
      original_height: PropTypes.number,
      cropped_width: PropTypes.number,
      cropped_height: PropTypes.number
    }),
    face: PropTypes.shape({
      alerts: PropTypes.arrayOf(PropTypes.string),
      face_count: PropTypes.number,
      faces: PropTypes.arrayOf(
        PropTypes.shape({
          looking_away: PropTypes.bool,
          eye_norm: PropTypes.arrayOf(PropTypes.number),
          eye_px: PropTypes.arrayOf(PropTypes.number),
          nose_px: PropTypes.arrayOf(PropTypes.number)
        })
      )
    }),
    data: PropTypes.shape({
      alerts: PropTypes.arrayOf(PropTypes.string),
      face_count: PropTypes.number,
      faces: PropTypes.arrayOf(
        PropTypes.shape({
          looking_away: PropTypes.bool,
          eye_norm: PropTypes.arrayOf(PropTypes.number),
          eye_px: PropTypes.arrayOf(PropTypes.number),
          nose_px: PropTypes.arrayOf(PropTypes.number)
        })
      )
    }),
    faces: PropTypes.arrayOf(
      PropTypes.shape({
        looking_away: PropTypes.bool,
        eye_norm: PropTypes.arrayOf(PropTypes.number),
        eye_px: PropTypes.arrayOf(PropTypes.number),
        nose_px: PropTypes.arrayOf(PropTypes.number)
      })
    )
  })
};