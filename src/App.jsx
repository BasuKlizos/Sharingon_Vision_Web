import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { WebRTCService } from './services/webrtcService';
import { DetectionCanvas, DetectionStats } from './components/DetectionCanvas';

const webrtc = new WebRTCService();

function App() {
  const [status, setStatus] = useState('Disconnected');
  const [isCalling, setIsCalling] = useState(false);
  const [detectionFrame, setDetectionFrame] = useState(null);
  const [detectionStats, setDetectionStats] = useState(null);
  const [channelStatus, setChannelStatus] = useState('closed');
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const statsUpdateIntervalRef = useRef(null);

  const handleDetectionsReceived = (frame) => {
    setDetectionFrame(frame);
  };

  const updateStats = () => {
    const stats = webrtc.getDetectionStats();
    setDetectionStats(stats);
    const manager = webrtc.getDetectionManager();
    setChannelStatus(manager?.isChannelOpen() ? 'open' : 'closed');
  };

  const startSession = async () => {
    try {
      setStatus('Accessing camera...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        // audio: true
        audio: false
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      
      setIsCalling(true);
      setStatus('Connecting...');

      await webrtc.createSession(
        stream,
        (remoteStream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        },
        (state) => {
          if (state === 'connected' || state === 'completed') {
            setStatus('Live');
          }
          if (state === 'failed') {
            setStatus('Connection Failed');
          }
        },
        handleDetectionsReceived
      );

      // Start stats update interval
      if (statsUpdateIntervalRef.current) {
        clearInterval(statsUpdateIntervalRef.current);
      }
      statsUpdateIntervalRef.current = setInterval(updateStats, 500);

    } catch (err) {
      console.error('Failed to start session:', err);
      alert('Error: ' + err.message);
      stopSession();
    }
  };

  const stopSession = () => {
    webrtc.stop();
    
    if (statsUpdateIntervalRef.current) {
      clearInterval(statsUpdateIntervalRef.current);
      statsUpdateIntervalRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    
    setDetectionFrame(null);
    setDetectionStats(null);
    setChannelStatus('closed');
    setIsCalling(false);
    setStatus('Disconnected');
  };

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

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
          <div className="video-grid">
            <div className="video-card main-card">
              <video ref={localVideoRef} autoPlay playsInline muted></video>
              <div className="label">Local Feed + AI Detections</div>
              {detectionFrame && (
                <DetectionCanvas 
                  videoRef={localVideoRef} 
                  detectionFrame={detectionFrame}
                />
              )}
            </div>
            {/* Keeping a hidden remote ref so webrtcService doesn't break if it expects one */}
            <video ref={remoteVideoRef} style={{ display: 'none' }} autoPlay playsInline></video>
          </div>

          {isCalling && (
            <div className="detection-panel">
              <DetectionStats 
                detectionFrame={detectionFrame} 
                stats={detectionStats}
              />
            </div>
          )}
        </main>

        <footer className="controls">
          {!isCalling ? (
            <button className="btn btn-primary" onClick={startSession}>
              Start Session
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stopSession}>
              End Session
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;
