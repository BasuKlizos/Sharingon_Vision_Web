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

function buildFailedPrecheckResult(error, status = 'request_failed') {
  return {
    ok: false,
    phase: 'failed',
    status,
    message: error.message || 'Lighting precheck failed. Please try again.'
  };
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
  statsUpdateIntervalRef,
  setIsPreviewReady,
  setPrecheckResult,
  setDetections,
  setChannelStatus,
  setIsCalling,
  setStatus
}) {
  webrtc.stop();

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
                    Camera preview, then capture frames, then call `/precheck/lighting`, then start WebRTC.
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
