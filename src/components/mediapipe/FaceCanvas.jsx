import React, { useRef, useEffect } from "react";

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

    // Handle both face_analysis and detection_frame data structures
    const faceData = data.data || data.face;
    const cropOffset = data.crop_offset;
    
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
        if (!face.nose_px) return;
        
        const [x, y] = face.nose_px;
        // Apply crop offset to coordinates
        const x_original = x + offsetX;
        const y_original = y + offsetY;
        
        const drawX = x_original * scaleX;
        const drawY = y_original * scaleY;

        // 1. Draw Gaze Vector if eye_direction is available
        const eye_dir = face.eye_direction || 0;
        const head_yaw = face.head_yaw || 0;
        
        // Draw Head Direction Vector (White/Blue)
        ctx.beginPath();
        ctx.moveTo(drawX, drawY);
        const headX = drawX + Math.sin(head_yaw) * 60;
        const headY = drawY - Math.cos(head_yaw) * 20; // Slight tilt
        ctx.lineTo(headX, headY);
        ctx.strokeStyle = "#40a9ff";
        ctx.lineWidth = 4;
        ctx.stroke();

        // Draw Eye Gaze Vector (Red/Orange)
        ctx.beginPath();
        ctx.moveTo(drawX, drawY);
        const gazeX = drawX + Math.sin(eye_dir) * 100;
        const gazeY = drawY - Math.cos(eye_dir) * 30;
        ctx.lineTo(gazeX, gazeY);
        ctx.strokeStyle = face.eye_head_mismatch ? "#ff4d4f" : "#52c41a";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]); // Dashed for gaze
        ctx.stroke();
        ctx.setLineDash([]); // Reset

        // 2. Draw Face Center Point
        ctx.beginPath();
        ctx.arc(drawX, drawY, 8, 0, 2 * Math.PI);
        ctx.fillStyle = face.looking_away ? "#ff4d4d" : "#00ff00";
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow for text

        // 3. Label
        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px Inter, sans-serif";
        ctx.fillText(`Face ${i + 1} ${face.eye_head_mismatch ? '⚠️ Mismatch' : ''}`, drawX + 12, drawY + 4);
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