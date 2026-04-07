# Backend Integration Guide: Gaze Calibration and Violation Monitoring

This document describes the backend work needed to support the frontend gaze-calibration flow implemented in this repo.

The frontend now:

1. Starts the webcam on page load.
2. Runs a 4-corner calibration flow with WebGazer.
3. Computes a "safe zone" using:
   - WebGazer prediction samples when available
   - or a fallback based on the clicked calibration points
4. Starts the interview/WebRTC session.
5. Sends calibration boundaries to the backend after a session is created.
6. Checks gaze every 500ms during the live interview.
7. Sends a violation event whenever the current gaze falls outside the saved boundaries.

## Goal

The backend should be able to:

- associate gaze calibration data with a session
- persist the safe-zone boundaries
- receive violation events in real time
- optionally aggregate, score, or alert on repeated violations

## Current Frontend API Contract

The frontend currently calls these endpoints:

### 1. Create WebRTC Session

Existing endpoint:

`POST /api/v1/webrtc/offer`

Request:

```json
{
  "sdp": "string",
  "type": "offer"
}
```

Response:

```json
{
  "sdp": "string",
  "type": "answer",
  "session_id": "session-123"
}
```

Important:

- `session_id` is required.
- The frontend uses that value as `sessionId` in the calibration and violation APIs below.

### 2. Save Calibration Boundaries

Required endpoint:

`POST /api/calibration/save`

Request:

```json
{
  "sessionId": "session-123",
  "minX": 101.25,
  "maxX": 1622.88,
  "minY": 84.14,
  "maxY": 901.42
}
```

Response:

Recommended:

```json
{
  "success": true,
  "sessionId": "session-123"
}
```

Behavior:

- This is called once, immediately after the WebRTC session starts successfully.
- Values are in browser viewport pixel coordinates.
- These boundaries represent the user's allowed gaze box on the screen.

Validation rules:

- `sessionId` must exist and match an active or known session.
- `minX`, `maxX`, `minY`, `maxY` must be numbers.
- `minX <= maxX`
- `minY <= maxY`

If validation fails:

- return `400 Bad Request`
- include a short error message

Example error:

```json
{
  "success": false,
  "error": "Invalid calibration boundaries"
}
```

### 3. Receive Violation Events

Required endpoint:

`POST /api/violation-event`

Request:

```json
{
  "sessionId": "session-123",
  "type": "violation-event",
  "point": {
    "x": 1788.1,
    "y": 932.6,
    "timestamp": 1775568123456
  },
  "boundaries": {
    "minX": 101.25,
    "maxX": 1622.88,
    "minY": 84.14,
    "maxY": 901.42
  },
  "timestamp": "2026-04-07T13:41:23.456Z"
}
```

Response:

Recommended:

```json
{
  "success": true
}
```

Behavior:

- The frontend sends this every 500ms when the current gaze point is outside the safe zone.
- The frontend currently does not throttle repeated identical violations beyond that 500ms check.
- Backend should be prepared for repeated events during a continuous out-of-bounds period.

Validation rules:

- `sessionId` must be present
- `type` should equal `violation-event`
- `point.x` and `point.y` must be numeric
- `boundaries` must contain numeric `minX`, `maxX`, `minY`, `maxY`

## Coordinate System

All gaze boundaries and points are currently based on browser viewport coordinates.

That means:

- origin is top-left of the browser viewport
- `x` increases left to right
- `y` increases top to bottom

Example:

- a gaze point of `{ "x": 500, "y": 300 }` means the predicted eye focus is near pixel `(500, 300)` in the page viewport

Backend should store these values as-is.

## Frontend Calibration Logic

The frontend calibration flow is:

1. Show dot at top-left
2. User clicks it 5 times
3. Show dot at top-right
4. User clicks it 5 times
5. Show dot at bottom-left
6. User clicks it 5 times
7. Show dot at bottom-right
8. User clicks it 5 times
9. Collect WebGazer prediction samples
10. Compute boundaries

Boundary generation currently uses:

- WebGazer prediction samples if at least 8 valid samples are captured
- otherwise the clicked calibration target positions are used as fallback

This means the backend does not need to know whether boundaries came from:

- live prediction samples
- or fallback click points

The backend only needs to trust and store the final `minX`, `maxX`, `minY`, `maxY` values it receives.

## Suggested Backend Data Model

Recommended session table:

```json
{
  "session_id": "session-123",
  "created_at": "2026-04-07T13:40:00.000Z",
  "webrtc_status": "connected",
  "calibration": {
    "minX": 101.25,
    "maxX": 1622.88,
    "minY": 84.14,
    "maxY": 901.42,
    "saved_at": "2026-04-07T13:40:12.000Z"
  }
}
```

Recommended violation event table:

```json
{
  "id": "violation-001",
  "session_id": "session-123",
  "event_type": "violation-event",
  "gaze_x": 1788.1,
  "gaze_y": 932.6,
  "minX": 101.25,
  "maxX": 1622.88,
  "minY": 84.14,
  "maxY": 901.42,
  "client_timestamp": "2026-04-07T13:41:23.456Z",
  "point_timestamp_ms": 1775568123456,
  "received_at": "2026-04-07T13:41:23.520Z"
}
```

## Recommended Backend Logic

### Calibration Save

When `/api/calibration/save` is called:

1. verify session exists
2. verify boundary numbers are valid
3. persist boundaries on the session
4. return success

### Violation Event

When `/api/violation-event` is called:

1. verify session exists
2. verify calibration exists for that session
3. store the event
4. optionally increment a violation counter
5. optionally trigger downstream alerting or review workflows

## Recommended Deduplication Strategy

Because the frontend checks every 500ms, a user looking away for 10 seconds can generate many events.

Backend may want to reduce noise by grouping consecutive violations.

Two common approaches:

### Option A: Store every event

Pros:

- simplest
- preserves full raw timeline

Cons:

- can generate many rows

### Option B: Collapse nearby events

Recommended logic:

- if the last violation for the same session was less than 2 seconds ago, update that violation window instead of creating a new row

Example aggregated structure:

```json
{
  "session_id": "session-123",
  "started_at": "2026-04-07T13:41:23.456Z",
  "ended_at": "2026-04-07T13:41:31.021Z",
  "sample_count": 15,
  "max_distance_outside": 220.4
}
```

## Recommended Status Codes

### `/api/calibration/save`

- `200 OK` or `201 Created`: calibration saved
- `400 Bad Request`: invalid payload
- `404 Not Found`: session does not exist
- `409 Conflict`: calibration already locked, if your workflow disallows overwrite
- `500 Internal Server Error`: unexpected backend failure

### `/api/violation-event`

- `200 OK` or `201 Created`: event saved
- `400 Bad Request`: invalid payload
- `404 Not Found`: session not found
- `409 Conflict`: calibration missing for session
- `500 Internal Server Error`: unexpected backend failure

## Example Express.js Pseudocode

```js
app.post('/api/calibration/save', async (req, res) => {
  const { sessionId, minX, maxX, minY, maxY } = req.body;

  if (
    !sessionId ||
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY) ||
    minX > maxX ||
    minY > maxY
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid calibration boundaries'
    });
  }

  const session = await sessionStore.findById(sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found'
    });
  }

  await calibrationStore.save({
    sessionId,
    minX,
    maxX,
    minY,
    maxY,
    savedAt: new Date().toISOString()
  });

  return res.json({
    success: true,
    sessionId
  });
});

app.post('/api/violation-event', async (req, res) => {
  const { sessionId, type, point, boundaries, timestamp } = req.body;

  if (
    !sessionId ||
    type !== 'violation-event' ||
    !point ||
    !boundaries ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid violation payload'
    });
  }

  const session = await sessionStore.findById(sessionId);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: 'Session not found'
    });
  }

  await violationStore.create({
    sessionId,
    type,
    gazeX: point.x,
    gazeY: point.y,
    boundaries,
    clientTimestamp: timestamp,
    pointTimestampMs: point.timestamp,
    receivedAt: new Date().toISOString()
  });

  return res.json({ success: true });
});
```

## Sequence Diagram

```text
Frontend                       Backend
   |                              |
   | POST /api/v1/webrtc/offer    |
   |----------------------------->|
   |   returns answer + session_id|
   |<-----------------------------|
   |                              |
   | POST /api/calibration/save   |
   |----------------------------->|
   |   save min/max boundaries    |
   |<-----------------------------|
   |                              |
   | interview starts             |
   |                              |
   | every 500ms if outside zone  |
   | POST /api/violation-event    |
   |----------------------------->|
   |   save violation             |
   |<-----------------------------|
```

## Open Decisions For Backend Team

These are not blocked by the frontend, but the backend team should choose them explicitly:

1. Should calibration be overwriteable for the same session?
2. Should repeated violation events be stored raw or aggregated?
3. Should violation count trigger an interview flag or review status?
4. Should sessions expire after a timeout?
5. Should calibration and violation events be linked to a user id or only a session id?

## Summary

Minimum backend work required:

1. Ensure `/api/v1/webrtc/offer` returns `session_id`
2. Implement `POST /api/calibration/save`
3. Implement `POST /api/violation-event`
4. Persist calibration boundaries by session
5. Persist or aggregate violation events by session

If you want, I can also prepare:

- a FastAPI version of this backend spec
- a Node/Express implementation skeleton
- a DB schema for PostgreSQL or MongoDB
