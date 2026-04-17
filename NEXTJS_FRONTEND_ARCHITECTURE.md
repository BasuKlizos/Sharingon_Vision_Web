# Next.js Frontend Architecture & Integration Guide

## Executive Summary

This document provides comprehensive technical specifications for building a production-grade Next.js frontend that integrates with the Sharingan Vision backend. The backend is a FastAPI application providing WebRTC-based real-time object detection using YOLO models. This guide details the implementation patterns, data flow, component architecture, and integration points required for the Next.js frontend.

**Current State:** The existing frontend is a React + Vite test application. This Next.js implementation will be the production-ready version with enhanced features, better performance, and professional architecture.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Backend API Contract](#backend-api-contract)
3. [Core Session Lifecycle](#core-session-lifecycle)
4. [Component Architecture](#component-architecture)
5. [State Management](#state-management)
6. [Real-Time Data Handling](#real-time-data-handling)
7. [WebRTC Implementation](#webrtc-implementation)
8. [Performance Considerations](#performance-considerations)
9. [Error Handling & Recovery](#error-handling--recovery)
10. [Security Considerations](#security-considerations)

---

## Architecture Overview

### System Context

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER ENVIRONMENT                   │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │          Next.js Frontend Application               │  │
│  │                                                     │  │
│  │  ├── Page & Layout Components (Next.js App Router)│  │
│  │  ├── React Components (UI & Canvas Rendering)     │  │
│  │  ├── WebRTC Peer Connection (RTCPeerConnection)   │  │
│  │  ├── Data Channel Handlers (Detection Stream)     │  │
│  │  ├── State Management (React Context/Zustand)    │  │
│  │  ├── WebGazer Integration (Gaze Calibration)     │  │
│  │  ├── MediaStream API (Camera Access)             │  │
│  │  └── REST API Client (HTTP Requests)             │  │
│  └────────────────────────────────────────────────────┘  │
│                        ↓ ↓ ↓                              │
└─────────────────────────────────────────────────────────┘
        │
        │ HTTP/REST (Signaling, Precheck, Calibration)
        │ WebRTC (Video Tracks, Data Channel)
        │
        ↓
┌─────────────────────────────────────────────────────────┐
│              FastAPI Backend (Python)                    │
│                                                           │
│  ├── WebRTC Signaling Endpoints (/api/v1/webrtc/*)    │
│  ├── Precheck Service (/api/v1/precheck/*)            │
│  ├── YOLO Detection Engine                            │
│  ├── Data Channel Management (Detections Output)      │
│  ├── Gaze Analysis & Monitoring                       │
│  └── Redis/MongoDB Storage                            │
└─────────────────────────────────────────────────────────┘
```

### High-Level Data Flow

```
1. USER INITIALIZATION
   ├─ Request camera permission (MediaStream)
   ├─ Initialize gaze tracking library (WebGazer)
   └─ Setup UI state & context

2. CALIBRATION PHASE
   ├─ Display calibration interface
   ├─ Collect gaze samples (WebGazer)
   ├─ Compute calibration boundaries
   └─ Save to backend (/api/v1/precheck/calibration)

3. PRECHECK PHASE
   ├─ Capture lighting condition frames
   ├─ Send to backend (/api/v1/precheck/lighting)
   ├─ Receive validation result
   └─ Proceed or request repositioning

4. SESSION INITIATION
   ├─ Create RTCPeerConnection
   ├─ Create detection data channel
   ├─ Create SDP offer
   ├─ Send to backend (/api/v1/webrtc/offer)
   ├─ Receive SDP answer + session_id
   ├─ Set remote description
   └─ Establish peer connection

5. ACTIVE SESSION
   ├─ Receive video tracks → render in video element
   ├─ Listen on detection data channel
   ├─ Parse detection frames
   ├─ Render overlays (canvas)
   ├─ Update analytics panel
   ├─ Send current_view updates → backend
   └─ Monitor connection quality

6. SESSION TEARDOWN
   ├─ Close RTCPeerConnection
   ├─ Stop camera stream
   ├─ Cleanup event listeners
   └─ Reset UI state
```

---

## Backend API Contract

### 1. WebRTC Signaling

#### Endpoint: `POST /api/v1/webrtc/offer`

**Purpose:** Initiate WebRTC session with SDP offer

**Request Body:**
```json
{
  "sdp": "v=0\r\no=- ... (SDP offer string)",
  "type": "offer"
}
```

**Response (200 OK):**
```json
{
  "sdp": "v=0\r\no=- ... (SDP answer string)",
  "type": "answer",
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid SDP or missing fields
- `500 Internal Server Error`: Server processing error

**Notes:**
- The frontend MUST create the data channel BEFORE creating the offer
- This ensures the offer SDP includes the datachannel constraint
- The backend will answer with matching data channel capability
- Session ID is used for tracking the session and related data

---

### 2. Lighting Precheck

#### Endpoint: `POST /api/v1/precheck/lighting`

**Purpose:** Validate camera lighting conditions before session

**Request Body:**
```json
{
  "frames": [
    {
      "base64_data": "iVBORw0KGgoAAAANSUhEUgAA... (base64 encoded frame)",
      "timestamp": 1711427195.3842
    },
    {
      "base64_data": "iVBORw0KGgoAAAANSUhEUgAA... (base64 encoded frame)",
      "timestamp": 1711427195.4159
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "brightness_level": 0.65,
  "condition": "well_lit"
}
```

OR

```json
{
  "status": "too_dark",
  "brightness_level": 0.15,
  "condition": "poor_lighting",
  "recommendation": "Increase ambient light or adjust position"
}
```

**Possible Statuses:**
- `ok`: Lighting is acceptable
- `too_dark`: Insufficient light for quality detection
- `too_bright`: Overexposure causing glare
- `uneven`: Uneven lighting across frame

---

### 3. Calibration Save (Optional)

#### Endpoint: `POST /api/v1/monitoring/calibration`

**Purpose:** Persist user's gaze calibration boundaries

**Request Body:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "minX": 0.1,
  "maxX": 0.9,
  "minY": 0.05,
  "maxY": 0.95
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Calibration saved successfully"
}
```

---

## Core Session Lifecycle

### Phase 1: Application Initialization

**Responsibilities:**
- Detect browser capabilities (WebRTC, MediaStream, Canvas)
- Initialize state management system
- Setup global error boundaries
- Create service instances (API client, WebRTC manager)
- Initialize logging and monitoring

**Expected Outcomes:**
- All required browser APIs available
- Application ready for user interaction
- Services initialized and connected

---

### Phase 2: Camera Access & Permissions

**Responsibilities:**
- Request `getUserMedia` with specific constraints
- Handle permission denials gracefully
- Display camera preview in video element
- Establish camera permission state
- Detect and report device issues (no camera, etc.)

**User Constraints to Request:**
```javascript
{
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user"  // Front-facing camera
  },
  audio: false  // Don't request audio
}
```

**Error Scenarios:**
- User denies permission → Show message, offer retry
- No camera found → Show error with troubleshooting
- Permission already denied → Show browser-specific instructions

---

### Phase 3: Gaze Calibration (WebGazer)

**Responsibilities:**
- Initialize WebGazer library with camera stream
- Display calibration interface with visual targets
- Guide user through calibration process
- Collect gaze samples at known screen positions
- Compute calibration boundaries from collected data
- Validate calibration quality
- Store calibration data for session

**Calibration Process:**
1. **Setup:** Display 4 corner targets (top-left, top-right, bottom-left, bottom-right)
2. **Sampling:** User clicks each target multiple times (10-20 samples recommended)
3. **Collection:** WebGazer records screen coordinates and eye gaze estimates
4. **Computation:** Calculate min/max X and Y from collected samples
5. **Validation:** Ensure boundaries are reasonable (not inverted, not too small)
6. **Completion:** Mark as ready for next phase

**Data Structure:**
```javascript
const calibration = {
  minX: 0.15,     // Normalized 0-1
  maxX: 0.95,
  minY: 0.10,
  maxY: 0.90,
  samplesCollected: 45,
  calibrationTime: 2500  // milliseconds
};
```

**Quality Checks:**
- Ensure `minX < maxX` and `minY < maxY`
- Ensure range is at least 0.3 units (not too narrow)
- Ensure boundaries are within 0-1 range
- Warn if insufficient samples collected

---

### Phase 4: Lighting Precheck

**Responsibilities:**
- Capture multiple frames from current camera stream
- Convert frames to suitable image format (JPEG/PNG base64)
- Send to backend for lighting analysis
- Handle response and display feedback
- Allow user to reposition camera if needed
- Gate session start until precheck passes

**Implementation Details:**
- Capture 5-10 frames at ~200ms intervals
- Use canvas to extract frame data from video element
- Convert to base64 for HTTP transmission
- Display real-time feedback to user
- Show brightness level visualization
- Provide actionable recommendations for improvement

**Response Handling:**
- Status `ok` → Proceed to session initiation
- Status `too_dark` → Suggest increasing light, offer retry
- Status `too_bright` → Suggest reducing glare, offer retry
- Status `uneven` → Suggest repositioning, offer retry

---

### Phase 5: WebRTC Session Initialization

**Responsibilities:**
- Create `RTCPeerConnection` with STUN/TURN config
- Create data channel for detection frames
- Add local video track to connection
- Create SDP offer
- Send offer to backend
- Receive SDP answer
- Set remote description
- Establish connection
- Monitor connection state

**WebRTC Configuration:**
```javascript
const peerConnectionConfig = {
  iceServers: [
    // STUN servers for NAT traversal
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] },
    // TURN servers for relay (if needed)
    {
      urls: ['turn:your-turn-server.com:3478'],
      username: 'username',
      credential: 'password'
    }
  ]
};
```

**Data Channel Configuration:**
```javascript
const dataChannelConfig = {
  ordered: true,              // Messages in order
  maxPacketLifeTime: 1000,   // Discard if delayed >1s (best-effort)
};

// Create BEFORE offer creation
const detectionChannel = peerConnection.createDataChannel(
  'detections',
  dataChannelConfig
);
```

**Sequence:**
1. Initialize RTCPeerConnection
2. Create detection data channel
3. Add local video track
4. Create SDP offer (now includes data channel)
5. Set local description
6. Send offer to `/api/v1/webrtc/offer`
7. Receive answer + session_id
8. Set remote description
9. Wait for connection state changes
10. Listen for remote track (video from backend)

---

### Phase 6: Active Session

**Detection Data Channel Message Format:**

The backend sends detection frames as JSON strings. Structure:
```json
{
  "type": "detection_frame",
  "frame_id": 42,
  "timestamp": 1711427195.3842,
  "detection_count": 3,
  "detections": [
    {
      "class_id": 0,
      "class_name": "person",
      "confidence": 0.92,
      "bounding_box": {
        "x1": 100,
        "y1": 50,
        "x2": 300,
        "y2": 400
      }
    },
    {
      "class_id": 1,
      "class_name": "car",
      "confidence": 0.88,
      "bounding_box": {
        "x1": 50,
        "y1": 200,
        "x2": 350,
        "y2": 500
      }
    }
  ],
  "crop_offset": {
    "x_offset": 0,
    "y_offset": 0,
    "original_width": 1280,
    "original_height": 720,
    "cropped_width": 1280,
    "cropped_height": 720
  }
}
```

**Responsibilities During Active Session:**
- Monitor connection state
- Parse incoming detection frames
- Validate frame data
- Render bounding boxes on canvas overlay
- Update analytics/statistics panel
- Send current_view updates when gaze changes
- Handle disconnections gracefully
- Log performance metrics
- Rate-limit updates for performance

**Detection Rendering:**
- Overlay canvas on top of video element
- Scale bounding boxes to match rendered video dimensions
- Use color coding: Green (>0.8), Yellow (0.6-0.8), Orange (0.4-0.6), Red (<0.4)
- Include class name and confidence percentage
- Apply smoothing/filtering to reduce flicker (optional)
- Use NMS (Non-Maximum Suppression) to remove overlapping boxes

**Current View Updates:**
- Monitor WebGazer gaze position (normalized 0-1)
- Detect significant changes (threshold 0.1 units)
- When changed, send update over data channel:
```json
{
  "type": "current_view",
  "minX": 0.15,
  "maxX": 0.85,
  "minY": 0.10,
  "maxY": 0.90,
  "timestamp": 1711427195.3842
}
```
- Throttle updates to max 10-30 per second

**Analytics Panel Updates:**
- Display real-time detection counts
- Show current frame ID and timestamp
- Display frame processing lag
- Show connection quality metrics
- Update at reduced frequency (1-5 Hz) to avoid thrashing

---

### Phase 7: Session Teardown

**Responsibilities:**
- Gracefully close RTCPeerConnection
- Close data channels
- Stop camera stream
- Clear all timers and intervals
- Remove event listeners
- Cleanup WebGazer
- Reset UI state
- Display completion status

**Cleanup Sequence:**
1. Stop sending updates (throttle/disable)
2. Close data channel
3. Close RTCPeerConnection
4. Stop all media streams
5. Clear state
6. Notify user of completion
7. Offer option to restart

---

## Component Architecture

### Layout & Page Structure

**Page Hierarchy:**
```
App Root (App Layout - Next.js)
│
├── Session Container (Full-screen viewport)
│   │
│   ├── Camera Video Element
│   │   └─ Displays: Remote video track from backend
│   │   └─ Properties: width=100%, height=100%, object-fit=cover
│   │
│   ├── Overlay Layer (Absolute positioning)
│   │   ├── Detection Canvas
│   │   │   └─ Renders: Bounding boxes + labels
│   │   │   └─ Scaling: Matches video element dimensions
│   │   │
│   │   ├── Gaze Markers Canvas (Optional)
│   │   │   └─ Renders: User's gaze point, attention state
│   │   │   └─ Scaling: Normalized to video dimensions
│   │   │
│   │   └── Calibration Overlay (Conditional)
│   │       └─ Display: During calibration phase
│   │       └─ Targets: 4 corner points for gaze sampling
│   │
│   ├── Control Panel (Bottom or side)
│   │   ├── Status Display
│   │   │   └─ Connection state, frame count, FPS
│   │   │
│   │   ├── Action Buttons
│   │   │   ├─ Start Session
│   │   │   ├─ Stop Session
│   │   │   └─ Recalibrate
│   │   │
│   │   └── Settings/Indicators
│   │       ├─ Camera permission status
│   │       ├─ WebRTC connection quality
│   │       └─ Detection confidence threshold (optional)
│   │
│   └── Analytics/Monitoring Panel
│       ├── Detection Statistics
│       │   ├─ Total detections in frame
│       │   ├─ Detections by class
│       │   └─ Average confidence
│       │
│       ├── Performance Metrics
│       │   ├─ Frame rate (FPS)
│       │   ├─ Network latency
│       │   ├─ Processing time
│       │   └─ Data channel lag
│       │
│       └── Gaze Metrics (if available)
│           ├─ Gaze position (X, Y)
│           ├─ Gaze stability
│           └─ Attention state
```

### Component Responsibilities

#### 1. **Session Manager Component**
- Orchestrates entire session lifecycle
- Manages state flow between phases
- Handles errors and recovery
- Provides session context to children
- Coordinates permission requests
- Manages WebGazer initialization

#### 2. **Camera & Permissions Handler**
- Requests camera access
- Validates media stream
- Handles permission errors
- Provides fallback UI for denied permissions
- Monitors device readiness
- Detects camera disconnections

#### 3. **Calibration Interface**
- Displays calibration targets
- Tracks user clicks/interactions
- Collects gaze samples (via WebGazer)
- Shows progress feedback
- Validates calibration quality
- Triggers callback when complete

#### 4. **Precheck Display**
- Shows current lighting condition
- Displays brightness level visualization
- Shows status feedback
- Provides action buttons for retry
- Communicates issues and recommendations
- Gates progression to next phase

#### 5. **Video Display**
- Renders video element
- Applies proper CSS constraints
- Handles aspect ratio preservation
- Manages canvas overlay alignment
- Responsive to window resizing
- Maintains consistent coordinate system

#### 6. **Detection Canvas**
- Renders bounding boxes in real-time
- Scales coordinates to match video dimensions
- Applies color coding by confidence
- Displays class labels and confidence %
- Handles canvas resizing
- Manages layer ordering and z-index

#### 7. **Gaze Marker Canvas (Optional)**
- Renders user's gaze point
- Shows attention state indicators
- Displays head direction vectors
- Updates from WebGazer position
- Synchronized with detection updates
- Can be toggled on/off

#### 8. **Analytics/Stats Panel**
- Displays real-time metrics
- Updates at lower frequency (reduces jank)
- Shows detection statistics
- Displays performance metrics
- Can be positioned fixed or floating
- Collapsible for UI space efficiency

#### 9. **Connection Monitor**
- Displays connection state
- Shows ICE gathering progress
- Indicates data channel status
- Displays network quality indicators
- Updates on state changes
- Provides troubleshooting hints

#### 10. **Control Panel**
- Start/Stop session buttons
- Recalibrate option
- Settings toggle (confidence threshold, etc.)
- Status indicators
- Permission status display

---

## State Management

### Recommended Approach: React Context + Local Hooks

**State Structure:**
```
AppContext
├── sessionState
│   ├── phase: 'init' | 'camera' | 'calibration' | 'precheck' | 'session' | 'complete'
│   ├── sessionId: string | null
│   ├── startTime: timestamp
│   └── frameCount: number
│
├── cameraState
│   ├── hasPermission: boolean
│   ├── permissionDenied: boolean
│   ├── stream: MediaStream | null
│   ├── isReady: boolean
│   └── error: string | null
│
├── webrtcState
│   ├── peerConnection: RTCPeerConnection | null
│   ├── dataChannel: RTCDataChannel | null
│   ├── connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'
│   ├── iceConnectionState: 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed'
│   └── remoteTrack: MediaStreamTrack | null
│
├── calibrationState
│   ├── isCalibrated: boolean
│   ├── boundaries: { minX, maxX, minY, maxY }
│   ├── samplesCollected: number
│   └── quality: 'good' | 'fair' | 'poor'
│
├── precheckState
│   ├── status: 'pending' | 'checking' | 'passed' | 'failed'
│   ├── result: { status, brightness_level, condition }
│   └── error: string | null
│
├── detectionState
│   ├── latestFrame: { frame_id, detections, timestamp }
│   ├── frameBuffer: DetectionFrame[]
│   ├── detectionCount: number
│   ├── averageConfidence: number
│   └── lastUpdateTime: timestamp
│
├── performanceState
│   ├── fps: number
│   ├── frameProcessingTime: number
│   ├── networkLatency: number
│   ├── dataChannelLag: number
│   └── cpuUsage: number
│
├── gazeState
│   ├── currentPosition: { x, y }  // Normalized 0-1
│   ├── gazeArea: { minX, maxX, minY, maxY }
│   ├── isCalibrated: boolean
│   └── confidence: number
│
└── uiState
    ├── showAnalyticsPanel: boolean
    ├── showCalibrationOverlay: boolean
    ├── showPrecheckOverlay: boolean
    ├── errorMessage: string | null
    ├── warningMessage: string | null
    └── notificationQueue: Notification[]
```

### Action Creators / Event Handlers

```javascript
// Phase transitions
transitionToPhase(newPhase)
resetSession()

// Camera operations
requestCameraPermission()
onCameraReady()
onCameraError(error)

// Calibration operations
startCalibration()
onCalibrationSample(x, y, gazeX, gazeY)
completeCalibration(boundaries)

// Precheck operations
startPrecheck()
onPrecheckResult(result)
retryPrecheck()

// WebRTC operations
createPeerConnection()
sendOffer()
onAnswerReceived(sdp, sessionId)
onConnectionStateChange(state)
onDataChannelOpen()
onDataChannelClose()
onDataChannelError(error)

// Detection operations
onDetectionFrameReceived(frame)
parseDetectionFrame(rawData)
renderDetections(frame)

// Gaze operations
updateGazePosition(x, y, confidence)
onGazeCalibrationComplete(boundaries)

// Cleanup
cleanupSession()
closeConnection()
stopCamera()
```

---

## Real-Time Data Handling

### Detection Frame Processing Pipeline

```
Raw Data Channel Message
    ↓
JSON Parse
    ↓
Schema Validation
    ↓
Coordinate Transformation (crop offset adjustment)
    ↓
Frame Buffering (FIFO, max 30 frames)
    ↓
State Update
    ↓
Canvas Re-render (async)
    ↓
Analytics Update (throttled, 1-5 Hz)
    ↓
Display Update
```

### Message Parsing & Validation

```javascript
function parseDetectionMessage(rawData) {
  try {
    // 1. Parse JSON
    const parsed = JSON.parse(rawData);
    
    // 2. Validate required fields
    if (!parsed.type || parsed.type !== 'detection_frame') {
      throw new Error('Invalid message type');
    }
    if (typeof parsed.frame_id !== 'number') {
      throw new Error('Missing or invalid frame_id');
    }
    if (!Array.isArray(parsed.detections)) {
      throw new Error('Missing or invalid detections array');
    }
    
    // 3. Validate detections structure
    parsed.detections.forEach(det => {
      validateDetection(det);
    });
    
    // 4. Apply crop offset transformation
    if (parsed.crop_offset && (parsed.crop_offset.x_offset || parsed.crop_offset.y_offset)) {
      transformCoordinates(parsed.detections, parsed.crop_offset);
    }
    
    // 5. Return validated frame
    return {
      frameId: parsed.frame_id,
      timestamp: parsed.timestamp,
      detections: parsed.detections,
      cropOffset: parsed.crop_offset
    };
  } catch (error) {
    logger.error('Failed to parse detection frame', error);
    return null;
  }
}

function validateDetection(detection) {
  const required = ['class_id', 'class_name', 'confidence', 'bounding_box'];
  for (const field of required) {
    if (!(field in detection)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  if (detection.bounding_box.x2 < detection.bounding_box.x1) {
    throw new Error('Invalid bounding box coordinates');
  }
  
  if (detection.confidence < 0 || detection.confidence > 1) {
    throw new Error('Confidence must be between 0 and 1');
  }
}

function transformCoordinates(detections, cropOffset) {
  detections.forEach(det => {
    det.bounding_box.x1 += cropOffset.x_offset;
    det.bounding_box.y1 += cropOffset.y_offset;
    det.bounding_box.x2 += cropOffset.x_offset;
    det.bounding_box.y2 += cropOffset.y_offset;
  });
}
```

### Frame Buffering Strategy

**Purpose:** Smooth out jitter and enable frame skipping for performance

**Implementation:**
```javascript
class DetectionFrameBuffer {
  constructor(maxSize = 30) {
    this.buffer = [];
    this.maxSize = maxSize;
  }
  
  push(frame) {
    this.buffer.push(frame);
    // Keep only latest frames
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }
  
  getLatest() {
    return this.buffer[this.buffer.length - 1] || null;
  }
  
  getRecent(count = 5) {
    return this.buffer.slice(-count);
  }
  
  clear() {
    this.buffer = [];
  }
}
```

### Update Throttling

**Challenge:** High-frequency updates can cause performance issues
**Solution:** Throttle analytics and UI updates

```javascript
// Analytics panel: max 5 updates per second
const analyticsThrottle = createThrottle(200); // ms

// Canvas render: Update every frame, but batch DOM updates
const canvasThrottle = createThrottle(0); // No throttle, but use requestAnimationFrame

// Current view updates: max 10-30 per second
const currentViewThrottle = createThrottle(33); // ~30 fps
```

### Canvas Rendering Optimization

```javascript
function renderDetections(ctx, detections, videoWidth, videoHeight) {
  // Use requestAnimationFrame for smooth rendering
  requestAnimationFrame(() => {
    // Clear canvas
    ctx.clearRect(0, 0, videoWidth, videoHeight);
    
    // Apply NMS (Non-Maximum Suppression) to reduce clutter
    const filteredDetections = applyNMS(detections, 0.4); // IoU threshold
    
    // Render each detection
    filteredDetections.forEach(detection => {
      const box = detection.bounding_box;
      const confidence = detection.confidence;
      
      // Determine color based on confidence
      const color = getConfidenceColor(confidence);
      
      // Draw box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
      
      // Draw label background
      const label = `${detection.class_name} ${(confidence * 100).toFixed(1)}%`;
      const textMetrics = ctx.measureText(label);
      const textHeight = 20;
      
      ctx.fillStyle = color;
      ctx.fillRect(box.x1, box.y1 - textHeight, textMetrics.width + 4, textHeight);
      
      // Draw text
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px Arial';
      ctx.fillText(label, box.x1 + 2, box.y1 - 5);
    });
  });
}

function getConfidenceColor(confidence) {
  if (confidence > 0.8) return '#00ff00';  // Green
  if (confidence > 0.6) return '#ffff00';  // Yellow
  if (confidence > 0.4) return '#ff8800';  // Orange
  return '#ff0000';  // Red
}

function applyNMS(detections, iouThreshold) {
  // Non-Maximum Suppression to remove overlapping boxes
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const keep = [];
  
  for (let i = 0; i < sorted.length; i++) {
    let shouldKeep = true;
    
    for (const kept of keep) {
      const iou = calculateIoU(sorted[i].bounding_box, kept.bounding_box);
      if (iou > iouThreshold) {
        shouldKeep = false;
        break;
      }
    }
    
    if (shouldKeep) {
      keep.push(sorted[i]);
    }
  }
  
  return keep;
}

function calculateIoU(box1, box2) {
  const intersection = Math.max(0, Math.min(box1.x2, box2.x2) - Math.max(box1.x1, box2.x1)) *
                       Math.max(0, Math.min(box1.y2, box2.y2) - Math.max(box1.y1, box2.y1));
  
  const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
  const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
  const union = area1 + area2 - intersection;
  
  return intersection / union;
}
```

---

## WebRTC Implementation

### Peer Connection Lifecycle

```javascript
class WebRTCManager {
  constructor(config) {
    this.config = config;
    this.peerConnection = null;
    this.dataChannel = null;
    this.localStream = null;
  }
  
  async createSession() {
    try {
      // 1. Create peer connection
      this.peerConnection = new RTCPeerConnection(this.config.iceServers);
      
      // 2. Setup event handlers
      this.peerConnection.onconnectionstatechange = () => this.onConnectionStateChange();
      this.peerConnection.oniceconnectionstatechange = () => this.onIceStateChange();
      this.peerConnection.ontrack = (event) => this.onRemoteTrack(event);
      
      // 3. Create data channel BEFORE offer
      this.createDataChannel('detections');
      
      // 4. Add local stream tracks
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) {
          this.peerConnection.addTrack(track, this.localStream);
        }
      }
      
      // 5. Create offer
      const offer = await this.peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      });
      
      // 6. Set local description
      await this.peerConnection.setLocalDescription(offer);
      
      return offer;
    } catch (error) {
      logger.error('Failed to create session', error);
      throw error;
    }
  }
  
  createDataChannel(label) {
    const config = {
      ordered: true,
      maxPacketLifeTime: 1000
    };
    
    this.dataChannel = this.peerConnection.createDataChannel(label, config);
    this.setupDataChannelHandlers(this.dataChannel);
  }
  
  setupDataChannelHandlers(channel) {
    channel.onopen = () => {
      logger.info('Data channel opened');
      this.config.onChannelOpen?.();
    };
    
    channel.onclose = () => {
      logger.info('Data channel closed');
      this.config.onChannelClose?.();
    };
    
    channel.onerror = (error) => {
      logger.error('Data channel error', error);
      this.config.onChannelError?.(error);
    };
    
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.config.onMessage?.(data);
      } catch (error) {
        logger.error('Failed to parse data channel message', error);
      }
    };
  }
  
  async setRemoteDescription(sdpAnswer) {
    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription({
          type: 'answer',
          sdp: sdpAnswer
        })
      );
    } catch (error) {
      logger.error('Failed to set remote description', error);
      throw error;
    }
  }
  
  sendMessage(data) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    } else {
      logger.warn('Data channel not ready');
    }
  }
  
  async stop() {
    // Close data channel
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    
    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    
    // Stop local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
    }
  }
  
  onConnectionStateChange() {
    logger.info('Connection state:', this.peerConnection.connectionState);
    this.config.onConnectionStateChange?.(this.peerConnection.connectionState);
  }
  
  onIceStateChange() {
    logger.info('ICE state:', this.peerConnection.iceConnectionState);
    this.config.onIceStateChange?.(this.peerConnection.iceConnectionState);
  }
  
  onRemoteTrack(event) {
    logger.info('Remote track received:', event.track.kind);
    this.config.onRemoteTrack?.(event.streams[0]);
  }
}
```

### ICE Candidate Handling

**Note:** The current flow uses SDP offer/answer only without trickle ICE. If needed in future:

```javascript
// (Optional Enhancement) Trickle ICE Implementation
peerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    // Send ICE candidate to backend
    sendICECandidate(event.candidate);
  }
};

// Receive ICE candidates from backend
async function addICECandidate(candidate) {
  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (error) {
    logger.error('Failed to add ICE candidate', error);
  }
}
```

---

## Performance Considerations

### 1. Canvas Rendering Optimization

**Problem:** Rendering large canvases every frame at 60fps is CPU intensive

**Solutions:**
- Use `requestAnimationFrame` for smooth rendering
- Batch canvas operations
- Only re-render when detections change significantly
- Use WebWorkers for heavy processing (optional)
- Implement frame skipping when CPU bound

### 2. Memory Management

**Problem:** Storing all frames leads to memory leak

**Solutions:**
```javascript
// Limit frame buffer size
const maxBufferSize = 30;
if (frameBuffer.length > maxBufferSize) {
  frameBuffer.shift(); // Remove oldest
}

// Clear unused data periodically
setInterval(() => {
  // Clear very old frames
  frameBuffer = frameBuffer.filter(f => Date.now() - f.timestamp < 5000);
}, 10000);

// Cleanup on disconnect
onDisconnect(() => {
  frameBuffer = [];
  detectionData = null;
  canvasContext = null;
});
```

### 3. Network Bandwidth

**Consideration:** Detection frame rate and size

**Optimization:**
- Backend can skip frames if frontend lags (frame_id jumps)
- Accept frame loss - it's real-time data
- Use binary format if needed (but JSON is more flexible)
- Implement dynamic quality adjustment

### 4. CPU Usage Monitoring

```javascript
class PerformanceMonitor {
  constructor() {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 0;
    this.processingTimes = [];
  }
  
  recordFrame(processingTime) {
    this.frameCount++;
    this.processingTimes.push(processingTime);
    
    // Keep only last 100 measurements
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }
    
    // Update FPS every second
    const now = performance.now();
    if (now - this.lastTime > 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastTime = now;
    }
  }
  
  getAverageProcessingTime() {
    if (this.processingTimes.length === 0) return 0;
    const sum = this.processingTimes.reduce((a, b) => a + b, 0);
    return sum / this.processingTimes.length;
  }
  
  getFPS() {
    return this.fps;
  }
  
  shouldSkipFrame() {
    return this.getAverageProcessingTime() > 30; // >30ms per frame
  }
}
```

---

## Error Handling & Recovery

### Error Categories & Responses

#### 1. Camera/Media Errors

```javascript
async function handleCameraError(error) {
  switch (error.name) {
    case 'NotAllowedError':
      // User denied permission
      showError('Camera permission denied. Please enable it in browser settings.');
      break;
    
    case 'NotFoundError':
      // No camera device found
      showError('No camera found. Please check your device.');
      break;
    
    case 'NotReadableError':
      // Camera is in use by another application
      showError('Camera is in use by another application.');
      break;
    
    case 'OverconstrainedError':
      // Requested constraints cannot be satisfied
      retryWithLowerConstraints();
      break;
    
    default:
      showError('Camera error: ' + error.message);
  }
}
```

#### 2. WebRTC Connection Errors

```javascript
function handleConnectionStateChange(state) {
  switch (state) {
    case 'connected':
      logger.info('WebRTC connected');
      hideError();
      break;
    
    case 'disconnected':
      logger.warn('WebRTC disconnected, attempting reconnect...');
      showWarning('Connection lost. Reconnecting...');
      scheduleReconnect();
      break;
    
    case 'failed':
      logger.error('WebRTC connection failed');
      showError('Connection failed. Please restart session.');
      disableSessionControls();
      break;
    
    case 'closed':
      logger.info('WebRTC closed');
      resetUI();
      break;
  }
}
```

#### 3. API Request Errors

```javascript
async function handleAPIError(error, retryable = false) {
  if (error.status === 400) {
    // Bad request
    showError('Invalid data sent. Please restart.');
  } else if (error.status === 500) {
    // Server error
    showError('Server error. Please try again later.');
    if (retryable) scheduleRetry();
  } else if (error.status === 0) {
    // Network error
    showError('Network error. Check your connection.');
    if (retryable) scheduleRetry();
  }
}
```

#### 4. Data Channel Errors

```javascript
function handleDataChannelError(error) {
  logger.error('Data channel error', error);
  showWarning('Detection stream interrupted. Waiting for reconnection...');
  
  // Keep trying to process messages
  // Don't close connection - let it auto-recover
}
```

### Recovery Strategies

```javascript
class RecoveryManager {
  constructor() {
    this.retryCount = 0;
    this.maxRetries = 3;
    this.backoffMultiplier = 2;
    this.initialDelay = 1000; // 1 second
  }
  
  async retry(fn, label) {
    try {
      this.retryCount = 0;
      return await fn();
    } catch (error) {
      return this.scheduleRetry(fn, label);
    }
  }
  
  async scheduleRetry(fn, label) {
    if (this.retryCount >= this.maxRetries) {
      logger.error(`Max retries exceeded for ${label}`);
      throw new Error(`Failed after ${this.maxRetries} retries: ${label}`);
    }
    
    this.retryCount++;
    const delay = this.initialDelay * Math.pow(this.backoffMultiplier, this.retryCount - 1);
    
    logger.info(`Retrying ${label} in ${delay}ms (attempt ${this.retryCount})`);
    
    await sleep(delay);
    return this.retry(fn, label);
  }
  
  reset() {
    this.retryCount = 0;
  }
}
```

---

## Security Considerations

### 1. Browser Permissions

- **Camera Access:** Explicit user permission required
- **Data Persistence:** Use only session storage, clear on exit
- **Third-party Scripts:** Minimize external dependencies (WebGazer required)

### 2. API Communication

```javascript
// Always use HTTPS in production
const API_ENDPOINT = process.env.REACT_APP_API_URL || 'https://api.example.com';

// Include CSRF tokens if needed
const sendAPIRequest = async (endpoint, method, data) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': getCsrfToken() // If backend requires it
  };
  
  return fetch(`${API_ENDPOINT}${endpoint}`, {
    method,
    headers,
    body: JSON.stringify(data),
    credentials: 'include' // Include cookies
  });
};
```

### 3. Data Validation

- Validate all incoming data from backend
- Sanitize canvas content before rendering
- Validate frame dimensions and coordinates
- Ensure session_id matches expected format

### 4. Session Management

```javascript
// Secure session storage
const sessionStorage = {
  get(key) {
    try {
      return sessionStorage.getItem(`session_${key}`);
    } catch (e) {
      return null;
    }
  },
  
  set(key, value) {
    try {
      sessionStorage.setItem(`session_${key}`, value);
    } catch (e) {
      logger.warn('Session storage unavailable');
    }
  },
  
  clear() {
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('session_')) {
        sessionStorage.removeItem(key);
      }
    });
  }
};

// Clear sensitive data on exit
window.addEventListener('beforeunload', () => {
  sessionStorage.clear();
});
```

### 5. WebRTC Security

- Use STUN/TURN servers for NAT traversal
- Validate SDP before setting descriptions
- Monitor for ICE failures
- Don't expose local IP addresses unnecessarily

---

## Implementation Checklist

### Phase 1: Setup & Initialization
- [ ] Project scaffolding (Next.js 13+, TypeScript recommended)
- [ ] Environment configuration (API endpoint, STUN/TURN servers)
- [ ] Global error boundary setup
- [ ] Logging/monitoring integration
- [ ] Browser compatibility checks

### Phase 2: Camera & Permissions
- [ ] Camera permission flow
- [ ] Media stream acquisition
- [ ] Video element integration
- [ ] Fallback UI for denied permissions
- [ ] Device detection and validation

### Phase 3: Calibration
- [ ] WebGazer integration
- [ ] Calibration UI (target display)
- [ ] Sample collection logic
- [ ] Boundary computation and validation
- [ ] Calibration state management

### Phase 4: Precheck
- [ ] Frame capture from video element
- [ ] Base64 encoding for HTTP
- [ ] Lighting precheck API integration
- [ ] Result display and feedback UI
- [ ] Retry/reposition flow

### Phase 5: WebRTC
- [ ] RTCPeerConnection creation
- [ ] Data channel setup (before offer)
- [ ] SDP offer/answer flow
- [ ] State monitoring and logging
- [ ] Remote track handling

### Phase 6: Detection Display
- [ ] Canvas element management
- [ ] Coordinate transformation (crop offset)
- [ ] Bounding box rendering
- [ ] Confidence color coding
- [ ] Label display

### Phase 7: Real-time Features
- [ ] Frame buffering
- [ ] Analytics panel updates
- [ ] Performance monitoring
- [ ] Gaze position updates (WebGazer)
- [ ] Current view updates to backend

### Phase 8: Polish & Testing
- [ ] Error handling for all paths
- [ ] Performance optimization
- [ ] Responsive UI design
- [ ] Cross-browser testing
- [ ] Load testing (sustained detection)

---

## Summary

This Next.js frontend implementation should:

1. **Maintain compatibility** with existing FastAPI backend APIs
2. **Enhance reliability** over the test React version
3. **Provide better performance** through optimization
4. **Improve user experience** with polished UI and clear feedback
5. **Enable scalability** with proper state management and architecture
6. **Support monitoring** with comprehensive logging and metrics

The architecture is designed to be maintainable, testable, and extensible for future features while maintaining a clear separation of concerns between UI, data processing, and communication layers.
