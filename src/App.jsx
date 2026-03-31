import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { WebRTCService } from './services/webrtcService';
import { FaceCanvas } from "./components/mediapipe/FaceCanvas";
import { DetectionCanvas } from './components/DetectionCanvas';

const webrtc = new WebRTCService();

function App() {
  const [status, setStatus] = useState('Disconnected');
  const [isCalling, setIsCalling] = useState(false);
  const [detections, setDetections] = useState({
    yolo: null,
    face: null
  });
  const [channelStatus, setChannelStatus] = useState('closed');
  
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const statsUpdateIntervalRef = useRef(null);

  const handleDetectionsReceived = (message) => {
    // console.log("App: Detection received:", message);

    if (message.type === "detection_frame") {
      // Correctly structure the detection data
      // message contains: { type, frame_id, timestamp, yolo: {...}, face: {...} }
      setDetections({
        yolo: message,  // Pass entire message which contains yolo and frame metadata
        face: message.face
      });
    }
  };

  const updateStats = () => {
    const manager = webrtc.getDetectionManager();
    const isOpen = manager?.isChannelOpen() || false;
    const currentStatus = isOpen ? 'open' : 'closed';
    
    if (currentStatus !== channelStatus) {
      console.log("App: Data channel status changed to:", currentStatus);
      setChannelStatus(currentStatus);
    }
  };

  const startSession = async () => {
    try {
      console.log("App: Requesting camera access");
      setStatus('Accessing camera...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          // frameRate: { ideal: 15, max: 20 }
          frameRate: { ideal: 8, max: 12 }
        },
        audio: false
      });
      const track = stream.getVideoTracks()[0];
      await track.applyConstraints({
        // frameRate: { ideal: 12, max: 15 }
        frameRate: { ideal: 6, max: 10 }
      });
      const settings = track.getSettings();

      console.log("🎥 Actual Camera Settings:", settings);
      
      console.log("App: Camera stream acquired");
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      setIsCalling(true);
      setStatus('Connecting...');

      // We use Promise.resolve to safely await even if createSession 
      // is not explicitly returning a promise.
      await Promise.resolve(webrtc.createSession(
        stream,
        null, 
        (state) => {
          console.log("App: Connection state update:", state);
          if (state === 'connected' || state === 'completed') {
            setStatus('Live');
          }
          if (state === 'failed') {
            setStatus('Connection Failed');
          }
        },
        handleDetectionsReceived
      ));

      console.log("App: Session initialization complete");
      statsUpdateIntervalRef.current = setInterval(updateStats, 500);

    } catch (err) {
      console.error('App: Session start error:', err);
      alert('Error: ' + err.message);
      stopSession();
    }
  };

  const stopSession = () => {
    console.log("App: Cleaning up session");
    webrtc.stop();
    
    if (statsUpdateIntervalRef.current) {
      clearInterval(statsUpdateIntervalRef.current);
      statsUpdateIntervalRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    
    setDetections({
      yolo: null,
      face: null
    });
    setChannelStatus('closed');
    setIsCalling(false);
    setStatus('Disconnected');
  };

  useEffect(() => {
    return () => {
      console.log("App: Component unmounting");
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
          <div className="video-card single-video">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
            />
            {/* YOLO BOUNDING BOX */}
            <DetectionCanvas
              videoRef={localVideoRef}
              detectionFrame={detections.yolo}
            />

            {/* MEDIAPIPE FACE */}
            <FaceCanvas
              videoRef={localVideoRef}
              data={detections.face}
            />
          </div>
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