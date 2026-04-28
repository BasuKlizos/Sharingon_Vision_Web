import { useCallback, useEffect, useRef, useState } from 'react';
import webgazer from 'webgazer/dist/webgazer.commonjs2.js';
import './App.css';
import { WebRTCService } from './services/webrtcService';
import { FaceCanvas } from './components/mediapipe/FaceCanvas';
import { DetectionCanvas } from './components/DetectionCanvas';
import { FaceAnalysisPanel } from './components/mediapipe/FaceAnalysisPanel';
import { CalibrationOverlay } from './components/CalibrationOverlay';
import { webrtcApi } from './api/webrtcApi';

const webrtc = new WebRTCService();

const PRECHECK_FRAME_COUNT = 3;
const PRECHECK_CAPTURE_DELAY_MS = 180;
const PREVIEW_ANALYSIS_INTERVAL_MS = 400;
const PRECHECK_MIN_BRIGHTNESS = 70;
const PRECHECK_MAX_BRIGHTNESS = 190;
const PRECHECK_MAX_DARK_RATIO = 0.35;
const PRECHECK_MAX_BRIGHT_RATIO = 0.25;
const PRECHECK_DARK_PIXEL_THRESHOLD = 45;
const PRECHECK_BRIGHT_PIXEL_THRESHOLD = 225;
const CALIBRATION_CLICKS_PER_TARGET = 5;
const CALIBRATION_SAMPLE_TARGET = 8;
const CURRENT_VIEW_SEND_THROTTLE_MS = 120;
const GAZE_FAR_AWAY_MARGIN_RATIO = 0.45;

function wait(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function isVideoReady(video) {
  return Boolean(
    video &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0
  );
}

function createVideoReadyHandlers(video, resolve, reject) {
  const cleanup = () => {
    video.removeEventListener('loadeddata', handleLoadedData);
    video.removeEventListener('error', handleError);
  };

  const handleLoadedData = () => {
    cleanup();
    resolve();
  };

  const handleError = () => {
    cleanup();
    reject(new Error('Unable to read frames from the camera preview.'));
  };

  return { handleLoadedData, handleError };
}

function waitForVideoReady(video) {
  if (isVideoReady(video)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (!video) {
      reject(new Error('Camera preview is not available.'));
      return;
    }

    const { handleLoadedData, handleError } = createVideoReadyHandlers(video, resolve, reject);
    video.addEventListener('loadeddata', handleLoadedData, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

function captureFrame(video, canvas) {
  const width = video.videoWidth;
  const height = video.videoHeight;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', 0.78);
}

async function capturePrecheckFrames(video, canvas, frameCount) {
  const frames = [];

  for (let index = 0; index < frameCount; index += 1) {
    frames.push(captureFrame(video, canvas));
    if (index < frameCount - 1) {
      await wait(PRECHECK_CAPTURE_DELAY_MS);
    }
  }

  return frames;
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function getOverflowDistance(value, min, max) {
  if (value < min) {
    return min - value;
  }
  if (value > max) {
    return value - max;
  }
  return 0;
}

function buildGazeAssessment(point, boundaries) {
  if (!point || !boundaries) {
    return null;
  }

  const width = Math.max(boundaries.maxX - boundaries.minX, 1);
  const height = Math.max(boundaries.maxY - boundaries.minY, 1);
  const referenceSize = Math.max(width, height, 1);
  const overflowX = getOverflowDistance(point.x, boundaries.minX, boundaries.maxX);
  const overflowY = getOverflowDistance(point.y, boundaries.minY, boundaries.maxY);
  const overflowRatio = Math.max(overflowX, overflowY) / referenceSize;

  if (overflowX === 0 && overflowY === 0) {
    return {
      status: 'good',
      driftPercent: 0,
      drift: { x: 0, y: 0 },
      message: 'User is looking at the screen'
    };
  }

  const isFarAway = overflowRatio >= GAZE_FAR_AWAY_MARGIN_RATIO;

  return {
    status: isFarAway ? 'far_away' : 'looking_away',
    driftPercent: round(overflowRatio * 100, 2),
    drift: {
      x: round(overflowX, 2),
      y: round(overflowY, 2)
    },
    message: isFarAway
      ? 'Detected looking far away from the screen'
      : 'User is looking away from the screen'
  };
}

function buildAttentionAssessment(gazeAssessment, faceData) {
  const primaryFace = faceData?.faces?.[0] || null;

  if (gazeAssessment && gazeAssessment.status !== 'good') {
    return gazeAssessment;
  }

  const fallbackState = primaryFace?.attention_state || 'good';
  const fallbackScore = primaryFace?.attention_score || 0;
  const fallbackReasons = primaryFace?.attention_reasons || [];

  if (fallbackState === 'far_away') {
    return {
      status: 'far_away',
      driftPercent: round(fallbackScore * 10, 2),
      drift: { x: 0, y: 0 },
      message: 'User appears to be looking far away from the screen'
    };
  }

  if (fallbackState === 'looking_away') {
    return {
      status: 'looking_away',
      driftPercent: round(Math.max(15, fallbackScore * 10), 2),
      drift: { x: 0, y: 0 },
      message: fallbackReasons.length > 0
        ? `User appears to be looking away from the screen (${fallbackReasons.join(', ')})`
        : 'User appears to be looking away from the screen'
    };
  }

  return gazeAssessment;
}

function buildDisplayAlerts(alerts, attentionAssessment) {
  const baseAlerts = (alerts || []).filter((alert) => (
    alert !== 'LOOKING_AWAY_FROM_SCREEN'
    && alert !== 'LOOKING_FAR_AWAY_FROM_SCREEN'
  ));

  if (!attentionAssessment || attentionAssessment.status === 'good') {
    return baseAlerts;
  }

  return [
    ...baseAlerts,
    attentionAssessment.status === 'far_away'
      ? 'LOOKING_FAR_AWAY_FROM_SCREEN'
      : 'LOOKING_AWAY_FROM_SCREEN'
  ];
}

function getLightingStatusMessage(status) {
  if (status === 'ok') {
    return 'Lighting looks good. You can start the session.';
  }
  if (status === 'too_dark') {
    return 'Lighting is too dark. Increase front lighting before starting.';
  }
  if (status === 'too_bright') {
    return 'Lighting is too bright. Reduce glare or strong backlight before starting.';
  }
  return 'Lighting precheck completed.';
}

function buildPreviewMonitorResult(response) {
  return {
    ...response,
    phase: 'monitoring'
  };
}

function buildPrecheckResult(response) {
  return {
    ...response,
    phase: response.ok ? 'passed' : 'failed'
  };
}

function buildRunningPrecheckState() {
  return {
    phase: 'running',
    status: 'checking',
    message: `Capturing ${PRECHECK_FRAME_COUNT} frames for lighting precheck...`
  };
}

function buildFailedPrecheckResult(error, status = 'request_failed') {
  return {
    ok: false,
    phase: 'failed',
    status,
    message: error.message || 'Lighting precheck failed. Please try again.'
  };
}

function analyzePreviewLighting(video, canvas) {
  const width = video.videoWidth;
  const height = video.videoHeight;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const pixelCount = data.length / 4;

  if (!pixelCount) {
    throw new Error('Camera preview is not available for lighting analysis.');
  }

  let brightnessSum = 0;
  let darkPixels = 0;
  let brightPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const grayscale = (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2]);
    brightnessSum += grayscale;

    if (grayscale <= PRECHECK_DARK_PIXEL_THRESHOLD) {
      darkPixels += 1;
    }
    if (grayscale >= PRECHECK_BRIGHT_PIXEL_THRESHOLD) {
      brightPixels += 1;
    }
  }

  const brightnessMean = brightnessSum / pixelCount;
  const darkPixelRatio = darkPixels / pixelCount;
  const brightPixelRatio = brightPixels / pixelCount;

  let status = 'ok';
  if (brightnessMean < PRECHECK_MIN_BRIGHTNESS || darkPixelRatio > PRECHECK_MAX_DARK_RATIO) {
    status = 'too_dark';
  } else if (brightnessMean > PRECHECK_MAX_BRIGHTNESS || brightPixelRatio > PRECHECK_MAX_BRIGHT_RATIO) {
    status = 'too_bright';
  }

  return buildPreviewMonitorResult({
    ok: status === 'ok',
    status,
    message: getLightingStatusMessage(status),
    checked_frames: 1,
    valid_frames: 1,
    summary: {
      brightness_mean: round(brightnessMean, 2),
      dark_pixel_ratio: round(darkPixelRatio, 4),
      bright_pixel_ratio: round(brightPixelRatio, 4),
      min_brightness: PRECHECK_MIN_BRIGHTNESS,
      max_brightness: PRECHECK_MAX_BRIGHTNESS,
      max_dark_ratio: PRECHECK_MAX_DARK_RATIO,
      max_bright_ratio: PRECHECK_MAX_BRIGHT_RATIO
    },
    frames: [
      {
        index: 0,
        valid: true,
        status,
        message: getLightingStatusMessage(status),
        brightness_mean: round(brightnessMean, 2),
        dark_pixel_ratio: round(darkPixelRatio, 4),
        bright_pixel_ratio: round(brightPixelRatio, 4)
      }
    ]
  });
}

async function attachPreviewStream(videoRef, stream) {
  if (videoRef.current) {
    videoRef.current.srcObject = stream;
    await videoRef.current.play().catch(() => undefined);
  }

  await waitForVideoReady(videoRef.current);
}

async function requestCameraStream() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 8, max: 12 }
    },
    audio: false
  });

  const track = stream.getVideoTracks()[0];
  await track.applyConstraints({});
  return stream;
}

function App() {
  const [status, setStatus] = useState('Preparing camera...');
  const [isCalling, setIsCalling] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [detections, setDetections] = useState({
    yolo: null,
    face: null
  });
  const [channelStatus, setChannelStatus] = useState('closed');
  const [cameraReady, setCameraReady] = useState(false);
  const [precheckResult, setPrecheckResult] = useState(null);
  const [isRunningPrecheck, setIsRunningPrecheck] = useState(false);
  const [boundaries, setBoundaries] = useState(null);
  const [calibrationStep, setCalibrationStep] = useState(0);
  const [calibrationClicks, setCalibrationClicks] = useState([0, 0, 0, 0]);
  const [isCollectingCalibrationSamples, setIsCollectingCalibrationSamples] = useState(false);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const [calibrationError, setCalibrationError] = useState('');
  const [currentGazePoint, setCurrentGazePoint] = useState(null);
  const [currentUserView, setCurrentUserView] = useState(null);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const statsUpdateIntervalRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const previewMonitorIntervalRef = useRef(null);
  const previewMonitorInFlightRef = useRef(false);
  const latestGazePointRef = useRef(null);
  const lastCurrentViewSentAtRef = useRef(0);
  const lastCurrentViewSignatureRef = useRef('');
  const calibrationSamplesRef = useRef([]);
  const calibrationTargetPointsRef = useRef([]);
  const isMountedRef = useRef(false);
  const webgazerReadyRef = useRef(false);
  const calibrationFinalizedRef = useRef(false);

  const isDev = import.meta.env.DEV;

  const stopPreviewMonitor = useCallback(() => {
    if (previewMonitorIntervalRef.current) {
      clearInterval(previewMonitorIntervalRef.current);
      previewMonitorIntervalRef.current = null;
    }

    previewMonitorInFlightRef.current = false;
  }, []);

  const updateStats = useCallback(() => {
    const manager = webrtc.getDetectionManager();
    const isOpen = manager?.isChannelOpen() || false;
    const currentStatus = isOpen ? 'open' : 'closed';

    setChannelStatus((prevStatus) => (
      prevStatus === currentStatus ? prevStatus : currentStatus
    ));
  }, []);

  const handleDetectionsReceived = useCallback((message) => {
    if (message.type === 'detection_frame') {
      setDetections({
        yolo: message,
        face: message.face
      });
      const nextCurrentView = message.face?.current_view || null;
      setCurrentUserView(nextCurrentView);
      if (nextCurrentView) {
        const signature = [
          Math.round(nextCurrentView.minX),
          Math.round(nextCurrentView.maxX),
          Math.round(nextCurrentView.minY),
          Math.round(nextCurrentView.maxY)
        ].join(':');
        const now = Date.now();
        const timeSinceLastSend = now - lastCurrentViewSentAtRef.current;
        const shouldSendImmediately = (
          signature !== lastCurrentViewSignatureRef.current
          || timeSinceLastSend >= CURRENT_VIEW_SEND_THROTTLE_MS
        );

        if (shouldSendImmediately) {
          const sent = webrtc.sendCurrentView(nextCurrentView);
          if (sent) {
            lastCurrentViewSentAtRef.current = now;
            lastCurrentViewSignatureRef.current = signature;
          }
        }
      }
    }
  }, []);

  const collectPredictionSample = useCallback((data) => {
    if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
      return;
    }

    const point = {
      x: data.x,
      y: data.y,
      timestamp: Date.now()
    };

    latestGazePointRef.current = point;
    setCurrentGazePoint(point);

    if (!calibrationFinalizedRef.current) {
      calibrationSamplesRef.current.push(point);
    }
  }, []);

  const cleanupWebGazer = useCallback(() => {
    if (!webgazerReadyRef.current) {
      return;
    }

    try {
      if (webgazer?.clearGazeListener) {
        webgazer.clearGazeListener();
      } else if (webgazer?.setGazeListener) {
        webgazer.setGazeListener(null);
      }

      if (webgazer?.pause) {
        webgazer.pause();
      }

      if (webgazer?.end) {
        webgazer.end();
      }
    } catch {
      // Ignore teardown cleanup failures from third-party DOM state.
    } finally {
      webgazerReadyRef.current = false;
    }
  }, []);

  const initializeWebGazer = useCallback(async () => {
    if (webgazerReadyRef.current) {
      return;
    }

    if (!webgazer) {
      throw new Error('WebGazer did not become available.');
    }

    webgazer
      .setRegression('ridge')
      .showVideoPreview(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .showPredictionPoints(false)
      .saveDataAcrossSessions(false)
      .setGazeListener((data) => {
        collectPredictionSample(data);
      });

    await webgazer.begin();
    webgazerReadyRef.current = true;
  }, [collectPredictionSample]);

  const resetCalibration = useCallback(() => {
    calibrationFinalizedRef.current = false;
    calibrationSamplesRef.current = [];
    calibrationTargetPointsRef.current = [];
    setCalibrationClicks([0, 0, 0, 0]);
    setCalibrationStep(0);
    setCalibrationComplete(false);
    setBoundaries(null);
    setCalibrationError('');
    setIsCollectingCalibrationSamples(false);
  }, []);

  const finalizeCalibration = useCallback(() => {
    const validSamples = calibrationSamplesRef.current.filter((point) => (
      Number.isFinite(point.x) && Number.isFinite(point.y)
    ));

    const fallbackTargetPoints = calibrationTargetPointsRef.current.filter((point) => (
      Number.isFinite(point.x) && Number.isFinite(point.y)
    ));

    const sourcePoints = validSamples.length >= CALIBRATION_SAMPLE_TARGET
      ? validSamples
      : fallbackTargetPoints;

    if (sourcePoints.length < 4) {
      resetCalibration();
      setCalibrationError('Calibration could not collect enough gaze data. Please try again.');
      setStatus('Calibrating gaze...');
      return;
    }

    calibrationFinalizedRef.current = true;

    const nextBoundaries = {
      minX: Math.min(...sourcePoints.map((point) => point.x)),
      maxX: Math.max(...sourcePoints.map((point) => point.x)),
      minY: Math.min(...sourcePoints.map((point) => point.y)),
      maxY: Math.max(...sourcePoints.map((point) => point.y))
    };

    setBoundaries(nextBoundaries);
    setCalibrationComplete(true);
    setIsCollectingCalibrationSamples(false);
    setCalibrationError(validSamples.length >= CALIBRATION_SAMPLE_TARGET
      ? ''
      : 'WebGazer predictions were sparse, so the safe zone was built from your calibration clicks.'
    );
    setStatus('Ready to start');
  }, [resetCalibration]);

  const handleCalibrationClick = useCallback(() => {
    if (isCollectingCalibrationSamples) {
      return;
    }

    const targetIndex = calibrationStep;
    if (targetIndex > 3) {
      return;
    }

    const dotElement = document.querySelector('.calibration-dot');
    if (dotElement) {
      const rect = dotElement.getBoundingClientRect();
      const x = rect.left + (rect.width / 2);
      const y = rect.top + (rect.height / 2);
      calibrationTargetPointsRef.current.push({ x, y, timestamp: Date.now() });

      if (webgazer?.recordScreenPosition) {
        webgazer.recordScreenPosition(x, y, 'click');
      } else if (webgazer?.recordScreenPositionAsync) {
        webgazer.recordScreenPositionAsync(x, y, 'click');
      }
    }

    setCalibrationClicks((prevClicks) => {
      const nextClicks = [...prevClicks];
      nextClicks[targetIndex] += 1;

      if (nextClicks[targetIndex] >= CALIBRATION_CLICKS_PER_TARGET) {
        if (targetIndex === 3) {
          setIsCollectingCalibrationSamples(true);
          setStatus('Calibrating gaze...');
        } else {
          setCalibrationStep(targetIndex + 1);
        }
      }

      return nextClicks;
    });
  }, [calibrationStep, isCollectingCalibrationSamples]);

  const runLightingPrecheck = useCallback(async () => {
    const video = localVideoRef.current;

    if (!localStreamRef.current || !video) {
      throw new Error('Camera preview is not available for lighting precheck.');
    }

    await waitForVideoReady(video);
    setIsRunningPrecheck(true);
    setPrecheckResult(buildRunningPrecheckState());
    setStatus('Checking lighting...');

    try {
      if (!captureCanvasRef.current) {
        captureCanvasRef.current = document.createElement('canvas');
      }

      const frames = await capturePrecheckFrames(
        video,
        captureCanvasRef.current,
        PRECHECK_FRAME_COUNT
      );
      const response = await webrtcApi.runLightingPrecheck(frames);
      if (typeof response.ok !== 'boolean' || typeof response.status !== 'string') {
        throw new Error('Lighting precheck response is missing required ok/status fields.');
      }
      const result = buildPrecheckResult(response);
      setPrecheckResult(result);
      setStatus(response.ok ? 'Lighting Approved' : 'Lighting Check Failed');
      return result;
    } catch (error) {
      const failedResult = buildFailedPrecheckResult(error);
      setPrecheckResult(failedResult);
      setStatus('Lighting Check Failed');
      return failedResult;
    } finally {
      setIsRunningPrecheck(false);
    }
  }, []);

  const initializeCameraAndCalibration = useCallback(async () => {
    if (localStreamRef.current || isMountedRef.current) {
      return;
    }

    isMountedRef.current = true;

    try {
      setStatus('Preparing camera...');
      const stream = await requestCameraStream();

      localStreamRef.current = stream;
      await attachPreviewStream(localVideoRef, stream);
      setCameraReady(true);

      await initializeWebGazer();

      if (!isMountedRef.current) {
        return;
      }

      setStatus('Calibrating gaze...');
    } catch (error) {
      const hasCameraStream = Boolean(localStreamRef.current);

      setStatus(hasCameraStream ? 'Calibration unavailable' : 'Camera unavailable');
      setCameraReady(hasCameraStream);
      setCalibrationError(
        error?.message || (
          hasCameraStream
            ? 'Gaze calibration could not be initialized.'
            : 'Camera preview could not be initialized.'
        )
      );
      isMountedRef.current = false;
    }
  }, [initializeWebGazer]);

  const stopSession = useCallback((options = {}) => {
    const { keepPreview = true, nextStatus } = options;

    webrtc.stop();

    if (statsUpdateIntervalRef.current) {
      clearInterval(statsUpdateIntervalRef.current);
      statsUpdateIntervalRef.current = null;
    }

    if (!keepPreview) {
      stopPreviewMonitor();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      setCameraReady(false);
    }

    setDetections({
      yolo: null,
      face: null
    });
    setChannelStatus('closed');
    setIsCalling(false);
    setSessionId(null);
    lastCurrentViewSentAtRef.current = 0;
    lastCurrentViewSignatureRef.current = '';
    setCurrentUserView(null);
    setStatus(nextStatus ?? (keepPreview ? 'Ready to start' : 'Disconnected'));
  }, [stopPreviewMonitor]);

  const startSession = useCallback(async () => {
    if (!localStreamRef.current) {
      setCalibrationError('Camera is not ready yet.');
      return;
    }

    if (!calibrationComplete || !boundaries) {
      setCalibrationError('Finish calibration before starting the session.');
      return;
    }

    setCalibrationError('');

    const lightingResult = await runLightingPrecheck();
    if (!lightingResult?.ok || lightingResult.status !== 'ok') {
      return;
    }

    try {
      setStatus('Connecting...');
      setIsCalling(true);

      const nextSessionId = await Promise.resolve(webrtc.createSession(
        localStreamRef.current,
        null,
        (state) => {
          if (state === 'connected' || state === 'completed') {
            setStatus('Live');
          }
          if (state === 'failed') {
            setStatus('Connection Failed');
          }
        },
        handleDetectionsReceived
      ));

      setSessionId(nextSessionId);
      await webrtcApi.saveCalibration(nextSessionId, boundaries);
      statsUpdateIntervalRef.current = globalThis.setInterval(updateStats, 500);
    } catch (error) {
      setPrecheckResult(buildFailedPrecheckResult(error, 'session_failed'));
      stopSession({ keepPreview: true, nextStatus: 'Ready to start' });
    }
  }, [
    boundaries,
    calibrationComplete,
    handleDetectionsReceived,
    runLightingPrecheck,
    stopSession,
    updateStats
  ]);

  useEffect(() => {
    void initializeCameraAndCalibration();

    return () => {
      isMountedRef.current = false;
      stopSession({ keepPreview: false, nextStatus: 'Disconnected' });
      cleanupWebGazer();
    };
  }, [cleanupWebGazer, initializeCameraAndCalibration, stopSession]);

  useEffect(() => {
    if (!cameraReady || !calibrationComplete || isCalling || isRunningPrecheck) {
      stopPreviewMonitor();
      return undefined;
    }

    const runSample = async () => {
      if (previewMonitorInFlightRef.current) {
        return;
      }

      previewMonitorInFlightRef.current = true;

      try {
        const video = localVideoRef.current;
        if (!video) {
          return;
        }

        await waitForVideoReady(video);

        if (!captureCanvasRef.current) {
          captureCanvasRef.current = document.createElement('canvas');
        }

        const result = analyzePreviewLighting(video, captureCanvasRef.current);
        setPrecheckResult((current) => (
          current?.phase === 'running' ? current : result
        ));
      } catch (error) {
        setPrecheckResult((current) => (
          current?.phase === 'running' ? current : buildFailedPrecheckResult(error)
        ));
      } finally {
        previewMonitorInFlightRef.current = false;
      }
    };

    void runSample();
    previewMonitorIntervalRef.current = globalThis.setInterval(runSample, PREVIEW_ANALYSIS_INTERVAL_MS);

    return () => {
      stopPreviewMonitor();
    };
  }, [calibrationComplete, cameraReady, isCalling, isRunningPrecheck, stopPreviewMonitor]);

  useEffect(() => {
    if (!isCollectingCalibrationSamples) {
      return undefined;
    }

    const intervalId = globalThis.setInterval(() => {
      const validSamples = calibrationSamplesRef.current.filter((point) => (
        Number.isFinite(point.x) && Number.isFinite(point.y)
      ));

      if (validSamples.length >= CALIBRATION_SAMPLE_TARGET) {
        clearInterval(intervalId);
        finalizeCalibration();
      }
    }, 150);

    const timeoutId = globalThis.setTimeout(() => {
      clearInterval(intervalId);
      finalizeCalibration();
    }, 3500);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [finalizeCalibration, isCollectingCalibrationSamples]);

  const clicksForCurrentTarget = calibrationClicks[calibrationStep] || 0;
  const gazeAssessment = buildGazeAssessment(currentGazePoint, boundaries);
  const attentionAssessment = buildAttentionAssessment(gazeAssessment, detections.face);
  const faceOverlayData = detections.face
    ? {
        ...detections.face,
        crop_offset: detections.yolo?.crop_offset || detections.face?.crop_offset,
        gaze_assessment: attentionAssessment,
        alerts: buildDisplayAlerts(detections.face.alerts, attentionAssessment)
      }
    : null;
  const showPrecheckCard = cameraReady && calibrationComplete && !isCalling;
  const isBusy = isRunningPrecheck;

  return (
    <div className="app-wrapper">
      <div className="bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>

      <CalibrationOverlay
        visible={cameraReady && !calibrationComplete}
        activeTargetIndex={Math.min(calibrationStep, 3)}
        clicksForCurrentTarget={clicksForCurrentTarget}
        clicksPerTarget={CALIBRATION_CLICKS_PER_TARGET}
        isCollectingSamples={isCollectingCalibrationSamples}
        onTargetClick={handleCalibrationClick}
      />

      <div className="glass-container">
        <header className="header">
          <div className="logo">
            <h1>Vision<span>Web</span></h1>
          </div>
          <div className="header-info">
            <div className={`status ${status === 'Live' ? 'live' : ''}`}>
              <div className="indicator"></div>
              <span>{status}</span>
            </div>
            {cameraReady && (
              <div className={`status ${calibrationComplete ? 'live' : ''}`}>
                <div className="indicator"></div>
                <span>{calibrationComplete ? 'Calibration Ready' : 'Calibrating'}</span>
              </div>
            )}
            {isCalling && (
              <div className={`detection-channel-status ${channelStatus}`}>
                <div className="indicator"></div>
                <span>Detection: {channelStatus}</span>
              </div>
            )}
          </div>
        </header>

        <main className="main">
          <div className="video-card single-video">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
            />

            {showPrecheckCard && (
              <div className="precheck-overlay">
                <div className={`precheck-pill ${precheckResult?.status || 'preview_ready'}`}>
                  {isRunningPrecheck
                    ? 'CHECKING'
                    : (precheckResult?.status || 'preview_ready').replace('_', ' ')}
                </div>
                <div className="precheck-copy">
                  <div className="precheck-title">
                    {precheckResult?.message || 'Camera preview is ready for lighting precheck.'}
                  </div>
                  <div className="precheck-subtitle">
                    {precheckResult?.summary
                      ? `Brightness ${precheckResult.summary.brightness_mean?.toFixed(1) ?? 'n/a'} | Valid frames ${precheckResult.valid_frames ?? 0}/${precheckResult.checked_frames ?? PRECHECK_FRAME_COUNT}`
                      : 'Keep the preview visible while the lighting precheck runs.'}
                  </div>
                </div>
              </div>
            )}

            <DetectionCanvas
              videoRef={localVideoRef}
              detectionFrame={detections.yolo}
            />

            <FaceCanvas
              videoRef={localVideoRef}
              data={faceOverlayData}
            />

            {detections.yolo && (
              <FaceAnalysisPanel faceData={faceOverlayData} />
            )}

            {isDev && currentGazePoint && (
              <div
                className="gaze-point-debug"
                style={{
                  left: `${currentGazePoint.x}px`,
                  top: `${currentGazePoint.y}px`
                }}
              />
            )}
          </div>
        </main>

        <footer className="controls">
          <div className="session-meta">
            <span>{sessionId ? `Session: ${sessionId}` : 'Session not started'}</span>
            {boundaries && (
              <span>
                Safe Zone: {Math.round(boundaries.minX)}, {Math.round(boundaries.minY)} to {Math.round(boundaries.maxX)}, {Math.round(boundaries.maxY)}
              </span>
            )}
            {currentUserView && (
              <span>
                Current View: {Math.round(currentUserView.minX)}, {Math.round(currentUserView.minY)} to {Math.round(currentUserView.maxX)}, {Math.round(currentUserView.maxY)}
              </span>
            )}
            {precheckResult?.message && (
              <span>{precheckResult.message}</span>
            )}
            {calibrationError && <span className="error-text">{calibrationError}</span>}
          </div>

          {isCalling ? (
            <button className="btn btn-danger" onClick={() => stopSession()}>
              End Session
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={startSession}
              disabled={!cameraReady || !calibrationComplete || isBusy}
            >
              {isRunningPrecheck ? 'Checking lighting...' : 'Start Session'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;
