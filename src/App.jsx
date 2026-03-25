import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { WebRTCService } from './services/webrtcService';

const webrtc = new WebRTCService();

function App() {
  const [status, setStatus] = useState('Disconnected');
  const [isCalling, setIsCalling] = useState(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const startSession = async () => {
    try {
      setStatus('Using simulated stream...');

      // 1. Create a fake canvas-based stream
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');

      // Draw something so you know it's working
      ctx.fillStyle = 'blue';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = 'white';
      ctx.fillText('Fake Camera Stream', 50, 50);

      // 2. Capture the stream from the canvas at 30fps
      const stream = canvas.captureStream(30);

      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      setIsCalling(true);
      setStatus('Connecting to backend...');

      // Now WebRTC can use this "fake" stream exactly like a real one
      await webrtc.createSession(
        stream,
        (remoteStream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        },
        (state) => {
          console.log('ICE State:', state);
          if (state === 'connected') setStatus('Live');
          if (state === 'failed' || state === 'closed') stopSession();
        }
      );
    } catch (err) {
      console.error('Failed to start session:', err);
      alert('Error: ' + err.message);
      stopSession();
    }
  };

  const stopSession = () => {
    webrtc.stop();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

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
          <div className={`status ${status === 'Live' ? 'live' : ''}`}>
            <div className="indicator"></div>
            <span>{status}</span>
          </div>
        </header>

        <main className="main">
          <div className="video-grid">
            <div className="video-card remote-card">
              <video ref={remoteVideoRef} autoPlay playsInline muted></video>
              <div className="label">🌐 Remote</div>
            </div>
            <div className="video-card local-card">
              <video ref={localVideoRef} autoPlay playsInline muted></video>
              <div className="label">👤 You</div>
            </div>
          </div>
        </main>

        <footer className="controls">
          {!isCalling ? (
            <button className="btn btn-primary" onClick={startSession}>
              <span>▶</span> Start Session
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stopSession}>
              <span>⏹</span> End Session
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;
