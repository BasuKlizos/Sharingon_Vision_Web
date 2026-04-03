import React from 'react';
import PropTypes from 'prop-types';

export function FaceAnalysisPanel({ faceData }) {
  if (!faceData) return null;

  // Extract the first face's metrics if available
  const hasFace = faceData.faces && faceData.faces.length > 0;
  const face = hasFace ? faceData.faces[0] : (faceData.nose_px ? faceData : null);
  const {
    head_yaw = 0,
    head_velocity = 0,
    head_turning = false,
    eye_head_mismatch = false,
    center_counter = 0,
    looking_away = false
  } = face || {};

  // New detection counts from backend
  const personCount = faceData.person_count || 0;
  const faceCount = faceData.face_count || (hasFace ? faceData.faces.length : 0);
  const isMultiplePersons = personCount > 1;

  const getStatusColor = (isBad) => {
    if (!hasFace && faceCount === 0) return '#64748b'; // Gray for no-face state
    return isBad ? '#ef4444' : '#10b981';
  };

  const getYawStatus = (yaw) => {
    if (!hasFace && faceCount === 0) return 'No Face Detected';
    const absYaw = Math.abs(yaw || 0);
    if (absYaw > 0.4) return 'Looking Far Away';
    if (absYaw > 0.2) return 'Slightly Turned';
    return 'Centered';
  };

  return (
    <div className="face-analysis-panel">
      <div className="simple-stats">
        <div className="stat-line">People: <span className="stat-value">{personCount}</span></div>
        <div className="stat-line">Faces: <span className="stat-value">{faceCount}</span></div>
        <div className="stat-line">Yaw: <span className="stat-value">{hasFace ? (head_yaw || 0).toFixed(2) : '---'}</span></div>
        <div className="stat-line">Movement: <span className="stat-value">{hasFace ? (head_turning ? 'Turning' : 'Stable') : '---'}</span></div>
        <div className="stat-line">Velocity: <span className="stat-value">{hasFace ? (head_velocity || 0).toFixed(3) : '---'}</span></div>
        <div className="stat-line">Attention: <span className="stat-value">{eye_head_mismatch ? 'Mismatch' : 'Aligned'}</span></div>
        <div className="stat-line">Centered: <span className="stat-value">{center_counter || 0}s</span></div>
        <div className="stat-line">Status: <span className="stat-value">{!hasFace ? 'No Face' : (looking_away ? 'Away' : 'Attentive')}</span></div>
      </div>
    </div>
  );
}

FaceAnalysisPanel.propTypes = {
  faceData: PropTypes.object
};
