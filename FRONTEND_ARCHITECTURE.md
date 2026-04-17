# Frontend Architecture

This document describes the architecture of the `Sharingon_Vision_Web` frontend application, how it handles the session lifecycle, and the implementation steps required to support the full detection workflow.

## Overview

The frontend is a React + Vite application that:
- requests camera access from the browser,
- calibrates gaze tracking with WebGazer,
- performs lighting precheck,
- establishes a WebRTC connection with the backend,
- receives detection and face monitoring data over a data channel,
- renders bounding boxes and face overlays, and
- synchronizes the user's current view back to the backend.

### Main responsibilities

- UI and session control: `src/App.jsx`
- WebRTC connection and signaling: `src/services/webrtcService.js`
- Detection data channel handling: `src/services/detectionDataManager.js`
- Backend REST calls: `src/api/webrtcApi.js`
- Drawing detection overlays: `src/components/DetectionCanvas.jsx`
- Drawing face gaze/marker overlays: `src/components/mediapipe/FaceCanvas.jsx`
- Face analytics panel: `src/components/mediapipe/FaceAnalysisPanel.jsx`
- Calibration flow: `src/components/CalibrationOverlay.jsx`

## Architecture Diagram

```mermaid
flowchart TD
  A[Browser Camera] -->|MediaStream| B[App.jsx]
  B --> C[CalibrationOverlay]
  B --> D[FaceCanvas]
  B --> E[DetectionCanvas]
  B --> F[FaceAnalysisPanel]
  B --> G[WebRTCService]
  G --> H[RTCPeerConnection]
  H -->|Tracks| I[Backend WebRTC Answer]
  H -->|Data Channel "detections"| J[DetectionDataManager]
  J -->|Parsed detections| B
  B -->|Offer SDP| K[webrtcApi.sendOffer()]
  B -->|Lighting frames| L[webrtcApi.runLightingPrecheck()]
  B -->|Calibration save| M[webrtcApi.saveCalibration()]
  I -->|Video stream| B
  J -->|current_view updates| H
  style A fill:#f9f,stroke:#333,stroke-width:1px
  style B fill:#bbf,stroke:#333,stroke-width:1px
  style G fill:#bfb,stroke:#333,stroke-width:1px
  style J fill:#ffe4b5,stroke:#333,stroke-width:1px
``` 

---

## Component and File Roles

### `src/App.jsx`

This file is the core application controller. It handles:
- camera permission and preview setup,
- WebGazer initialization,
- calibration flow and safe-zone building,
- lighting precheck logic,
- starting and stopping sessions,
- managing UI state and status text,
- passing the latest video ref to overlay components,
- receiving processed detection frames,
- throttling `current_view` updates back to the backend.

### `src/services/webrtcService.js`

This service encapsulates the WebRTC session lifecycle:
- creates an `RTCPeerConnection` with STUN/TURN configuration,
- adds local camera tracks to the peer connection,
- creates the `detections` data channel before offer creation,
- sends the SDP offer to backend signaling via `webrtcApi.sendOffer()`,
- receives the SDP answer and sets remote description,
- exposes a `sendCurrentView()` helper to send user view updates,
- exposes `stop()` to close the connection cleanly.

### `src/services/detectionDataManager.js`

This module handles the detection data channel and frame buffering:
- attaches to the data channel and listens for `onmessage`, `onopen`, `onclose`, `onerror`,
- parses JSON messages from the backend,
- routes messages of type `detection_frame`,
- normalizes YOLO detection payloads and crop offset metadata,
- stores recent frames in a FIFO buffer,
- computes UI-friendly stats,
- returns the latest detections for rendering,
- sends `current_view` updates over the data channel.

### `src/api/webrtcApi.js`

This file provides the REST API interface:
- `sendOffer(sdp, type)` for WebRTC signaling to `/api/v1/webrtc/offer`,
- `runLightingPrecheck(frames)` for backend lighting validation at `/api/v1/precheck/lighting`,
- `saveCalibration(sessionId, boundaries)` for saving gaze calibration data.

### `src/components/DetectionCanvas.jsx`

This component overlays bounding boxes on top of the video preview:
- uses a `<canvas>` element sized to the displayed video,
- scales YOLO bounding boxes to the rendered video rectangle,
- applies simple overlap filtering (NMS) before drawing,
- renders label text and confidence color coding,
- clears the canvas when no detections are present.

### `src/components/mediapipe/FaceCanvas.jsx`

This component draws gaze/facial markers and alerts:
- aligns drawing to the video preview size,
- supports `crop_offset` and coordinate scaling,
- draws face center points, head direction vectors, and alert texts,
- uses the `faceData.gaze_assessment` state to color feedback.

### `src/components/mediapipe/FaceAnalysisPanel.jsx`

This panel displays face metrics and monitoring details:
- shows counts for people, devices, and faces,
- displays yaw, movement, velocity, and attention state,
- renders a status pill for attentive / looking away / far away.

### `src/components/CalibrationOverlay.jsx`

This overlay handles user calibration before session start:
- renders 4 corner targets,
- tracks clicks per target,
- guides the user to click targets and collect gaze samples,
- indicates sample collection and progress.

---

## Frontend Session Flow

### 1. Camera Initialization

1. `App` calls `requestCameraStream()`.
2. Browser prompts for camera permission.
3. If granted, the stream is attached to `localVideoRef`.
4. `waitForVideoReady()` ensures the camera preview is playable.
5. `cameraReady` state is set.

### 2. Gaze Calibration

1. `App` initializes WebGazer in `initializeWebGazer()`.
2. `CalibrationOverlay` displays 4 targets.
3. User clicks each target multiple times.
4. WebGazer records screen positions and gaze samples.
5. `finalizeCalibration()` computes `boundaries` from collected samples.
6. `calibrationComplete` is set and the app becomes ready.

### 3. Lighting Precheck

1. On session start, app captures a short series of preview frames.
2. Frames are sent to backend via `webrtcApi.runLightingPrecheck()`.
3. Backend returns `ok` / `too_dark` / `too_bright`.
4. If lighting passes, the session continues.
5. If it fails, the app stops session start and shows a message.

### 4. WebRTC Offer / Answer

1. `WebRTCService.createSession()` creates the peer connection.
2. Adds local video tracks to the connection.
3. Creates the `detections` data channel first.
4. Creates an SDP offer and sets local description.
5. Sends `offer` to backend via `webrtcApi.sendOffer()`.
6. Receives backend SDP answer and sets remote description.
7. The peer connection begins ICE negotiation.
8. Remote camera/video track arrives via `ontrack`.

### 5. Detection Data Flow

1. Backend sends detection frames on the `detections` data channel.
2. `DetectionDataManager` parses `detection_frame` payloads.
3. Frames are normalized and buffered.
4. The app callback `handleDetectionsReceived()` updates state.
5. `DetectionCanvas` and `FaceCanvas` render overlays.
6. `FaceAnalysisPanel` updates metrics.

### 6. Current View Feedback

1. The backend may send `face.current_view` in detection frames.
2. App checks if the current view changed significantly.
3. If changed, `sendCurrentView()` sends a `current_view` event back.
4. This happens through the same WebRTC data channel.

### 7. Session Teardown

1. `stop()` closes the RTCPeerConnection.
2. `App` clears timers and stops the camera preview if needed.
3. UI state resets to `Disconnected` or `Ready to start`.

---

## Implementation Notes and Best Practices

- The frontend always creates the data channel before creating the SDP offer. This ensures the backend can answer correctly.
- The video overlay canvases are sized to the rendered DOM video dimensions, not the raw video pixel size, to keep boxes aligned.
- Calibration must complete before session start to avoid unreliable gaze assessment.
- Lighting precheck runs both locally in preview mode and by the backend to prevent poor-quality inputs.
- Detection message handling is defensive: invalid JSON or missing `type` is ignored.
- The current frontend expects the backend detection payload to include `yolo`, `face`, and optionally `crop_offset`.

## Frontend File Structure

```
Sharingon_Vision_Web/
├── src/
│   ├── App.jsx
│   ├── api/
│   │   └── webrtcApi.js
│   ├── components/
│   │   ├── CalibrationOverlay.jsx
│   │   ├── DetectionCanvas.jsx
│   │   └── mediapipe/
│   │       ├── FaceAnalysisPanel.jsx
│   │       └── FaceCanvas.jsx
│   └── services/
│       ├── detectionDataManager.js
│       └── webrtcService.js
```

## Recommended Frontend Implementation Steps

1. Build the camera preview and handle user media permission.
2. Initialize gaze tracking and show calibration targets.
3. Capture calibration samples and compute safe-zone boundaries.
4. Perform a lighting precheck before attempting session connect.
5. Establish WebRTC with the backend using offer/answer.
6. Attach local tracks and create the detection data channel.
7. Receive detection frames and normalize payloads.
8. Render YOLO bounding boxes and face overlays.
9. Update analytics and alert panels from face data.
10. Send `current_view` updates when user gaze position changes.

---

## How to Use This Document

- Use this file as the canonical frontend architecture reference.
- Keep the diagram updated when new tracking or signaling flows are added.
- Use the implementation steps to verify that new features follow the existing session lifecycle.
- When backend payload shape changes, update both `DetectionDataManager` and the canvas rendering logic.
