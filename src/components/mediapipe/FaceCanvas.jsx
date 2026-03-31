import React, { useRef, useEffect } from "react";

export function FaceCanvas({ videoRef, data }) {
  const canvasRef = useRef(null);

  const draw = () => {
    const canvas = canvasRef.current;
    const video = videoRef?.current;

    if (!canvas || !video || video.videoWidth === 0) return;

    const ctx = canvas.getContext("2d");
    
    // Match canvas display size to video display size
    const rect = video.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!data || data.type !== "face_analysis") return;

    const faceData = data.data;
    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;

    // Draw Face Markers
    if (faceData.faces) {
      faceData.faces.forEach((face, i) => {
        if (!face.nose_px) return;
        
        const [x, y] = face.nose_px;
        const drawX = x * scaleX;
        const drawY = y * scaleY;

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
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 20
      }}
    />
  );
}