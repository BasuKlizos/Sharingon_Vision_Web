import React from 'react';
import PropTypes from 'prop-types';

const CALIBRATION_TARGETS = [
  { id: 'top-left', label: 'Top-Left', xPercent: 10, yPercent: 12 },
  { id: 'top-right', label: 'Top-Right', xPercent: 90, yPercent: 12 },
  { id: 'bottom-left', label: 'Bottom-Left', xPercent: 10, yPercent: 88 },
  { id: 'bottom-right', label: 'Bottom-Right', xPercent: 90, yPercent: 88 }
];

export function CalibrationOverlay({
  visible,
  activeTargetIndex,
  clicksForCurrentTarget,
  clicksPerTarget,
  isCollectingSamples,
  onTargetClick
}) {
  if (!visible) {
    return null;
  }

  const activeTarget = CALIBRATION_TARGETS[activeTargetIndex] || null;
  const totalClicks = CALIBRATION_TARGETS.length * clicksPerTarget;
  const completedClicks = activeTargetIndex * clicksPerTarget + clicksForCurrentTarget;

  return (
    <div className="calibration-overlay">
      <div className="calibration-panel">
        <div className="calibration-badge">Calibration</div>
        <h2>Train the gaze model</h2>
        <p>
          Follow the moving dot and click it {clicksPerTarget} times per corner.
        </p>
        <div className="calibration-progress">
          <span>{completedClicks} / {totalClicks} clicks</span>
          {activeTarget && (
            <span>
              {activeTarget.label}: {clicksForCurrentTarget} / {clicksPerTarget}
            </span>
          )}
        </div>
        {isCollectingSamples && (
          <p className="calibration-hint">
            Hold your gaze inside the screen for a moment while we lock the safe zone.
          </p>
        )}
      </div>

      {activeTarget && !isCollectingSamples && (
        <button
          type="button"
          className="calibration-dot"
          style={{
            left: `${activeTarget.xPercent}%`,
            top: `${activeTarget.yPercent}%`
          }}
          onClick={onTargetClick}
          aria-label={`Calibrate ${activeTarget.label}`}
        >
          <span>{clicksPerTarget - clicksForCurrentTarget}</span>
        </button>
      )}
    </div>
  );
}

CalibrationOverlay.propTypes = {
  visible: PropTypes.bool.isRequired,
  activeTargetIndex: PropTypes.number.isRequired,
  clicksForCurrentTarget: PropTypes.number.isRequired,
  clicksPerTarget: PropTypes.number.isRequired,
  isCollectingSamples: PropTypes.bool,
  onTargetClick: PropTypes.func.isRequired
};

export { CALIBRATION_TARGETS };
