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
    <div className="face-analysis-panel glass-morphism">
      <div className="panel-header">
        <h3>Live Analysis</h3>
        <div className="badge-group">
          <div className={`badge ${!hasFace ? '' : (looking_away || eye_head_mismatch ? 'warning' : 'success')}`}>
            {!hasFace ? 'Searching for Face...' : (looking_away ? 'Looking Away' : eye_head_mismatch ? 'Attention Mismatch' : 'Attentive')}
          </div>
          {isMultiplePersons && (
            <div className="badge warning">
              {personCount} Faces Detected
            </div>
          )}
        </div>
      </div>

      <div className="metrics-grid">
        {/* Detection Card */}
        <div className="metric-card centered highlight-card">
          <span className="metric-label">Detections</span>
          <div className="detection-counts">
             <div className="count-item">
               <span className="count-value">{personCount}</span>
               <span className="count-label">Detected</span>
             </div>
             <div className="count-divider"></div>
             <div className="count-item">
               <span className="count-value">{faceCount}</span>
               <span className="count-label">Analyzed</span>
             </div>
          </div>
        </div>

        <div className="metric-card centered">
          <span className="metric-label">Head Yaw</span>
          <div className="progress-container">
            <div
              className="progress-bar"
              style={{
                width: `${hasFace ? Math.min(Math.abs(head_yaw || 0) * 200, 100) : 0}%`,
                backgroundColor: Math.abs(head_yaw || 0) > 0.3 ? 'var(--danger)' : 'var(--primary)'
              }}
            ></div>
          </div>
          <span className="value">
            {hasFace ? `${getYawStatus(head_yaw)} (${(head_yaw || 0).toFixed(2)})` : '---'}
          </span>
        </div>

        <div className="metric-card centered">
          <span className="metric-label">Attention</span>
          <div className="status-indicator">
            <div className="indicator" style={{ backgroundColor: getStatusColor(eye_head_mismatch) }}></div>
            <span className="value">{!hasFace ? '---' : (eye_head_mismatch ? 'Mismatched' : 'Aligned')}</span>
          </div>
        </div>

        <div className="metric-card centered">
          <span className="metric-label">Movement</span>
          <span className="value">{!hasFace ? '---' : (head_turning ? 'Turning' : 'Stable')}</span>
          <span className="sub-value">{hasFace ? `${(head_velocity || 0).toFixed(3)} V` : ''}</span>
        </div>
      </div>

      <div className="panel-footer">
        <div className="counter-item">
          <span className="metric-label">Centered</span>
          <span className="value">{center_counter || 0}s</span>
        </div>
      </div>
    </div>
  );
}

FaceAnalysisPanel.propTypes = {
  faceData: PropTypes.object
};
