import React, { useEffect, useRef, useState } from 'react';
import './App.css';
import { WebRTCService } from './services/webrtcService';
import { FaceCanvas } from './components/mediapipe/FaceCanvas';
import { DetectionCanvas } from './components/DetectionCanvas';
import { FaceAnalysisPanel } from './components/mediapipe/FaceAnalysisPanel';
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

function buildPrecheckResult(response) {
  return {
    ...response,
    phase: response.ok ? 'passed' : 'failed'
  };
}

function buildPreviewMonitorResult(response) {
  return {
    ...response,
    phase: 'monitoring'
  };
}

function getLightingStatusMessage(status) {
  if (status === 'ok') {
    return 'Lighting looks good. You can start WebRTC.';
  }
  if (status === 'too_dark') {
    return 'Lighting is too dark. Increase front lighting before starting WebRTC.';
  }
  if (status === 'too_bright') {
    return 'Lighting is too bright. Reduce glare or strong backlight before starting WebRTC.';
  }
  return 'Lighting precheck completed.';
}

function buildFailedPrecheckResult(error, status = 'request_failed') {
  return {
    ok: false,
    phase: 'failed',
    status,
    message: error.message || 'Lighting precheck failed. Please try again.'
  };
}

function round(value, digits) {
  return Number(value.toFixed(digits));
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

function hasSuccessfulPrecheck(precheckResult) {
  return Boolean(precheckResult?.ok && precheckResult.status === 'ok');
}

function setPreviewReadyState(setIsPreviewReady, setStatus) {
  setIsPreviewReady(true);
  setStatus('Preview Ready');
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

async function ensureCameraPreviewFlow({
  localStreamRef,
  localVideoRef,
  setIsPreparingPreview,
  setPrecheckResult,
  setIsPreviewReady,
  setStatus
}) {
  if (localStreamRef.current) {
    if (localVideoRef.current && localVideoRef.current.srcObject !== localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    await waitForVideoReady(localVideoRef.current);
    setPreviewReadyState(setIsPreviewReady, setStatus);
    return localStreamRef.current;
  }

  setIsPreparingPreview(true);
  setStatus('Opening camera...');
  setPrecheckResult(null);

  try {
    const stream = await requestCameraStream();
    localStreamRef.current = stream;
    await attachPreviewStream(localVideoRef, stream);
    setPreviewReadyState(setIsPreviewReady, setStatus);
    return stream;
  } catch (error) {
    setStatus('Camera Error');
    throw error;
  } finally {
    setIsPreparingPreview(false);
  }
}

function buildRunningPrecheckState() {
  return {
    phase: 'running',
    status: 'checking',
    message: `Capturing ${PRECHECK_FRAME_COUNT} frames for lighting precheck...`
  };
}

async function runLightingPrecheckFlow({
  ensureCameraPreview,
  localVideoRef,
  captureCanvasRef,
  setIsRunningPrecheck,
  setPrecheckResult,
  setStatus
}) {
  const stream = await ensureCameraPreview();
  const video = localVideoRef.current;

  if (!stream || !video) {
    throw new Error('Camera preview is not available for lighting precheck.');
  }

  await waitForVideoReady(video);
  setIsRunningPrecheck(true);
  setStatus('Checking lighting...');
  setPrecheckResult(buildRunningPrecheckState());

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
}

async function runLightingPreviewSampleFlow({
  localVideoRef,
  captureCanvasRef,
  setPrecheckResult,
  setStatus
}) {
  const video = localVideoRef.current;

  if (!video) {
    return;
  }

  await waitForVideoReady(video);

  if (!captureCanvasRef.current) {
    captureCanvasRef.current = document.createElement('canvas');
  }

  const result = analyzePreviewLighting(video, captureCanvasRef.current);

  setPrecheckResult((current) => {
    if (current?.phase === 'running') {
      return current;
    }
    return result;
  });
  setStatus(result.ok ? 'Preview Ready' : 'Adjust Lighting');
}

function stopPreviewMonitorFlow({
  previewMonitorIntervalRef,
  previewMonitorInFlightRef
}) {
  if (previewMonitorIntervalRef.current) {
    clearInterval(previewMonitorIntervalRef.current);
    previewMonitorIntervalRef.current = null;
  }

  previewMonitorInFlightRef.current = false;
}

function startPreviewMonitorFlow({
  localVideoRef,
  captureCanvasRef,
  previewMonitorIntervalRef,
  previewMonitorInFlightRef,
  setPrecheckResult,
  setStatus
}) {
  const runSample = async () => {
    if (previewMonitorInFlightRef.current) {
      return;
    }

    previewMonitorInFlightRef.current = true;

    try {
      await runLightingPreviewSampleFlow({
        localVideoRef,
        captureCanvasRef,
        setPrecheckResult,
        setStatus
      });
    } catch (error) {
      setPrecheckResult((current) => {
        if (current?.phase === 'running') {
          return current;
        }
        return buildFailedPrecheckResult(error);
      });
      setStatus('Lighting Check Failed');
    } finally {
      previewMonitorInFlightRef.current = false;
    }
  };

  if (previewMonitorIntervalRef.current) {
    return;
  }

  void runSample();
  previewMonitorIntervalRef.current = globalThis.setInterval(runSample, PREVIEW_ANALYSIS_INTERVAL_MS);
}

function updateChannelStatusFlow(webrtcService, channelStatus, setChannelStatus) {
  const manager = webrtcService.getDetectionManager();
  const isOpen = manager?.isChannelOpen() || false;
  const currentStatus = isOpen ? 'open' : 'closed';

  if (currentStatus !== channelStatus) {
    setChannelStatus(currentStatus);
  }
}

function handleConnectionStateChange(state, setStatus) {
  if (state === 'connected' || state === 'completed') {
    setStatus('Live');
  }
  if (state === 'failed') {
    setStatus('Connection Failed');
  }
}

async function startWebRtcSessionFlow({
  stream,
  handleDetectionsReceived,
  updateStats,
  statsUpdateIntervalRef,
  setIsCalling,
  setStatus,
  setPrecheckResult,
  stopSession
}) {
  try {
    setIsCalling(true);
    setStatus('Connecting...');

    await Promise.resolve(webrtc.createSession(
      stream,
      null,
      (state) => handleConnectionStateChange(state, setStatus),
      handleDetectionsReceived
    ));

    statsUpdateIntervalRef.current = setInterval(updateStats, 500);
  } catch (error) {
    setPrecheckResult(buildFailedPrecheckResult(error, 'session_failed'));
    stopSession({ keepPreview: true, nextStatus: 'Preview Ready' });
  }
}

function stopSessionFlow({
  keepPreview = false,
  nextStatus = 'Disconnected',
  localStreamRef,
  localVideoRef,
  previewMonitorIntervalRef,
  previewMonitorInFlightRef,
  statsUpdateIntervalRef,
  setIsPreviewReady,
  setPrecheckResult,
  setDetections,
  setChannelStatus,
  setIsCalling,
  setStatus
}) {
  webrtc.stop();
  stopPreviewMonitorFlow({
    previewMonitorIntervalRef,
    previewMonitorInFlightRef
  });

  if (statsUpdateIntervalRef.current) {
    clearInterval(statsUpdateIntervalRef.current);
    statsUpdateIntervalRef.current = null;
  }

  if (!keepPreview && localStreamRef.current) {
    localStreamRef.current.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setIsPreviewReady(false);
    setPrecheckResult(null);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }

  setDetections({
    yolo: null,
    face: null
  });
  setChannelStatus('closed');
  setIsCalling(false);
  setStatus(nextStatus);
}

function App() {
  const [status, setStatus] = useState('Disconnected');
  const [isCalling, setIsCalling] = useState(false);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [isPreparingPreview, setIsPreparingPreview] = useState(false);
  const [isRunningPrecheck, setIsRunningPrecheck] = useState(false);
  const [detections, setDetections] = useState({
    yolo: null,
    face: null
  });
  const [channelStatus, setChannelStatus] = useState('closed');
  const [precheckResult, setPrecheckResult] = useState(null);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const statsUpdateIntervalRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const previewMonitorIntervalRef = useRef(null);
  const previewMonitorInFlightRef = useRef(false);

  const handleDetectionsReceived = (message) => {
    if (message.type === 'detection_frame') {
      setDetections({
        yolo: message,
        face: message.face
      });
    }
    console.log('message', message);
  };

  const ensureCameraPreview = () => ensureCameraPreviewFlow({
    localStreamRef,
    localVideoRef,
    setIsPreparingPreview,
    setPrecheckResult,
    setIsPreviewReady,
    setStatus
  });

  const runLightingPrecheck = () => runLightingPrecheckFlow({
    ensureCameraPreview,
    localVideoRef,
    captureCanvasRef,
    setIsRunningPrecheck,
    setPrecheckResult,
    setStatus
  });

  const updateStats = () => updateChannelStatusFlow(webrtc, channelStatus, setChannelStatus);

  const stopSession = (options = {}) => stopSessionFlow({
    ...options,
    localStreamRef,
    localVideoRef,
    previewMonitorIntervalRef,
    previewMonitorInFlightRef,
    statsUpdateIntervalRef,
    setIsPreviewReady,
    setPrecheckResult,
    setDetections,
    setChannelStatus,
    setIsCalling,
    setStatus
  });

  const startWebRtcSession = (stream) => startWebRtcSessionFlow({
    stream,
    handleDetectionsReceived,
    updateStats,
    statsUpdateIntervalRef,
    setIsCalling,
    setStatus,
    setPrecheckResult,
    stopSession
  });

  const handleStartPreview = async () => {
    try {
      await ensureCameraPreview();
      await runLightingPrecheck();
    } catch (error) {
      setPrecheckResult(buildFailedPrecheckResult(error));
      setStatus('Lighting Check Failed');
    }
  };

  const handleStartInterview = async () => {
    try {
      const stream = await ensureCameraPreview();
      const result = hasSuccessfulPrecheck(precheckResult)
        ? precheckResult
        : await runLightingPrecheck();

      if (!result?.ok || result.status !== 'ok') {
        return;
      }

      await startWebRtcSession(stream);
    } catch (error) {
      setPrecheckResult(buildFailedPrecheckResult(error));
      setStatus('Lighting Check Failed');
    }
  };

  useEffect(() => {
    if (isPreviewReady && !isCalling && !isRunningPrecheck) {
      startPreviewMonitorFlow({
        localVideoRef,
        captureCanvasRef,
        previewMonitorIntervalRef,
        previewMonitorInFlightRef,
        setPrecheckResult,
        setStatus
      });
      return () => {
        stopPreviewMonitorFlow({
          previewMonitorIntervalRef,
          previewMonitorInFlightRef
        });
      };
    }

    stopPreviewMonitorFlow({
      previewMonitorIntervalRef,
      previewMonitorInFlightRef
    });
  }, [isPreviewReady, isCalling, isRunningPrecheck]);

  useEffect(() => {
    return () => {
      stopSession({ keepPreview: false });
    };
  }, []);

  const isBusy = isPreparingPreview || isRunningPrecheck;
  const showPrecheckCard = isPreviewReady && !isCalling;

  return (
    <div className="app-wrapper">
      <div className="bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>

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
              data={{
                ...detections.face,
                crop_offset: detections.yolo?.crop_offset || detections.face?.crop_offset
              }}
            />

            {detections.yolo && (
              <FaceAnalysisPanel
                faceData={{
                  ...detections.face,
                  crop_offset: detections.yolo?.crop_offset || detections.face?.crop_offset
                }}
              />
            )}
          </div>
        </main>

        <footer className="controls">
          {isCalling ? (
            <button className="btn btn-danger" onClick={() => stopSession()}>
              End Session
            </button>
          ) : (
            <>
              <div className="precheck-panel">
                <div className="precheck-panel-row">
                  <span className={`precheck-pill ${precheckResult?.status || (isPreviewReady ? 'preview_ready' : 'idle')}`}>
                    {isPreviewReady ? 'Preview Ready' : 'Preview Off'}
                  </span>
                  <span className="precheck-help">
                    Preview monitoring runs separately on a timer. Start interview still does one final `/precheck/lighting` gate before WebRTC.
                  </span>
                </div>
                {precheckResult?.message && (
                  <div className="precheck-message">{precheckResult.message}</div>
                )}
              </div>

              {!isPreviewReady ? (
                <button
                  className="btn btn-primary"
                  onClick={handleStartPreview}
                  disabled={isBusy}
                >
                  {isPreparingPreview ? 'Opening camera...' : 'Start Preview Check'}
                </button>
              ) : (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={() => stopSession()}
                    disabled={isBusy}
                  >
                    Stop Preview
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleStartInterview}
                    disabled={isBusy}
                  >
                    {isRunningPrecheck ? 'Checking lighting...' : 'Start Interview'}
                  </button>
                </>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;
