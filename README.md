# Vision Web - Real-Time Object Detection via WebRTC

A React + Vite application that displays real-time YOLO object detection data from a backend server using WebRTC technology.

## 🎯 Project Overview

**Vision Web** connects to a backend detection service via WebRTC, receives live object detection data (bounding boxes, confidence scores, class names), and renders them as overlays on a video feed.

**Key Features:**
- ✅ Real-time YOLO object detection
- ✅ WebRTC data channel for detection data
- ✅ Live video streaming
- ✅ Confidence-based color coding (green=high, yellow=medium, orange/red=low)
- ✅ Statistics panel with detection counts
- ✅ Responsive UI with glass-morphism design

---

## 🏗 Architecture

```
Frontend (React + Vite)
├── App.jsx                          # Main component
├── services/
│   ├── webrtcService.js            # WebRTC peer connection management
│   ├── detectionDataManager.js     # Data channel handlers
│   └── api/webrtcApi.js            # Backend API calls
└── components/
    └── DetectionCanvas.jsx         # Bounding box rendering

Backend (Python - Not in this repo)
├── WebRTC Signaling
├── YOLO Detection Model
└── Data Channel Management
```

---

## 🔧 Critical Fix Applied: Data Channel Negotiation

### The Problem
Backend was trying to create the data channel as the **answerer**, which doesn't work in WebRTC because:
- Data channels must be declared in the offer SDP
- The **initiator (frontend)** declares the channel
- The **answerer (backend)** can only mirror what's in the offer

**Symptom:** 
```
Answer SDP contains application/datachannel: false ❌
Channel stuck in "connecting" state
```

### The Solution
Frontend now **creates the data channel BEFORE creating the offer**:

```javascript
// 1. Create channel first
const detectionChannel = pc.createDataChannel('detections', {
    ordered: true,
    maxPacketLifeTime: 1000
});

// 2. Then create offer (now includes channel info)
const offer = await pc.createOffer();
// Offer SDP now has: m=application ... detections
```

**Result:**
```
✅ Offer SDP contains application/datachannel: true
✅ Answer SDP contains detections: true  
✅ Channel opens successfully
✅ Detection data flows
```

---

## 📋 Setup & Installation

### Prerequisites
- Node.js 16+ and npm
- Backend server running on `http://localhost:8000` (or configured endpoint)
- Modern browser with WebRTC support

### Installation

```bash
# Clone repository
git clone <repo-url>
cd Sharingon_Vision_Web

# Install dependencies
npm install

# Start development server
npm run dev
```

**Expected output:**
```
  VITE v4.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

### For Production

```bash
# Build
npm run build

# Preview build
npm run preview
```

---

## 🚀 Quick Start

1. **Start the app:**
   ```bash
   npm run dev
   ```

2. **Open browser:**
   - Navigate to `http://localhost:5173`
   - Open DevTools: F12 → Console tab

3. **Start a session:**
   - Click "▶ Start Session" button
   - Allow camera/microphone access when prompted

4. **Expected console output:**
   ```
   ✅ [DetectionChannel] 👂 Listening for incoming data channels...
   ✅ [DetectionChannel] 📨 Data channel received! Label: detections
   ✅ [DetectionChannel] ✅ Opened | readyState: open
   ✅ [App] ✅✅✅ DETECTION CALLBACK TRIGGERED! ✅✅✅
   ```

5. **On screen:**
   - Remote video shows camera feed
   - Bounding boxes appear on detected objects
   - Stats show detection count

---

## 📊 Data Flow

```
Backend YOLO Model (5 FPS)
    ↓ (detections)
Backend Detection Service
    ↓ (creates JSON frame)
WebRTC Data Channel
    ↓ (detection_channel.send(JSON))
Frontend Data Channel Handler
    ↓ (onmessage)
DetectionDataManager
    ↓ (parsedetections)
DetectionCanvas
    ↓ (renderBoundingBoxes)
Video Display ✨
```

### Data Format

Backend sends JSON messages:

```json
{
    "frame_id": 105,
    "timestamp": 1711449693.862,
    "detection_count": 3,
    "detections": [
        {
            "class_id": 0,
            "class_name": "person",
            "confidence": 0.88,
            "bounding_box": {
                "x1": 150,
                "y1": 200,
                "x2": 400,
                "y2": 600
            }
        }
    ]
}
```

---

## 🔍 Component Details

### App.jsx
- Main React component
- Manages WebRTC connection lifecycle
- Handles UI state (status, channel status)
- Processes detection callbacks

### webrtcService.js
- `WebRTCService` class
- Creates RTCPeerConnection
- Manages offer/answer exchange
- **Creates detection data channel BEFORE offer** ✅

### detectionDataManager.js
- `DetectionDataManager` class
- Handles incoming detection frames
- Parses JSON detection data
- Maintains frame buffer (30 frames)
- Calculates statistics

### DetectionCanvas.jsx
- `DetectionCanvas` component - renders bounding boxes on canvas overlay
- `DetectionStats` component - displays detection statistics

---

## 🐛 Troubleshooting

### Issue: No console messages
**Cause:** DevTools not open  
**Fix:** Press F12 and go to Console tab

### Issue: "Data channel received" but no "Opened"
**Cause:** Channel negotiation failed  
**Fix:**
- Check backend is running
- Check firewall/NAT issues
- Verify network connectivity

### Issue: Channel opens but no detection data
**Cause:** Backend not sending frames  
**Fix:** Check backend logs for errors, verify YOLO model is running

### Issue: Bounding boxes don't appear
**Cause:** Canvas not rendering or frame state not updating  
**Fix:**
```javascript
// In browser console:
webrtc.getLatestDetections()  // Should return detection frame
```

---

## 📈 Performance Metrics

- **Frame Rate:** 5 FPS (limited by YOLO detection)
- **Latency:** ~200-300ms (capture → detection → display)
- **Buffer Size:** 30 frames (frontend)
- **Video Resolution:** 1280x720
- **Data Channel:** Ordered, 1s max packet lifetime

---

## 🔐 Backend Requirements

Backend must:
1. ✅ Create WebRTC peer connection
2. ✅ Receive offer SDP from frontend (contains datachannel)
3. ✅ Create answer SDP with datachannel info mirrored from offer
4. ✅ Wait for datachannel.onopen before sending
5. ✅ Send detection JSON frames as UTF-8 text

### Backend Debugging

```python
# Check if incoming offer has datachannel
if 'application' in offer_sdp and 'detections' in offer_sdp:
    print("✅ Offer includes detection channel")
else:
    print("❌ Offer missing datachannel - frontend needs fix")

# Check if channel opened
print(f"Channel readyState: {channel.readyState}")  # Should be: open

# Verify answer has datachannel
if 'detections' in answer_sdp:
    print("✅ Answer includes detection channel")
```

---

## 📁 Project Structure

```
Sharingon_Vision_Web/
├── src/
│   ├── App.jsx                      # Main component
│   ├── App.css                      # Styles
│   ├── main.jsx                     # Entry point
│   ├── api/
│   │   └── webrtcApi.js            # API calls to backend
│   ├── services/
│   │   ├── webrtcService.js        # WebRTC connection management
│   │   └── detectionDataManager.js # Detection data handling
│   └── components/
│       └── DetectionCanvas.jsx     # Canvas rendering
├── public/                          # Static assets
├── README.md                        # This file
├── package.json                     # Dependencies
├── vite.config.js                  # Vite configuration
└── eslint.config.js                # ESLint configuration
```

---

## 🛠 Development

### Available Scripts

```bash
# Start development server with HMR
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint

# Fix linting issues
npm run lint -- --fix
```

### Technologies Used
- **React 18** - UI framework
- **Vite 4** - Build tool
- **WebRTC API** - Real-time communication
- **Vanilla CSS** - Styling (glass-morphism design)

---

## 🎨 UI Features

### Header
- App title "VisionWeb"
- Connection status indicator (Disconnected/Connecting/Live)
- Detection channel status indicator (open/closed)

### Video Grid
- **Remote:** Backend camera feed with detection overlay
- **Local:** Your camera feed

### Detection Canvas Overlay
- Green bounding boxes (high confidence: 85%+)
- Yellow boxes (medium confidence: 70-85%)
- Orange boxes (lower confidence: 50-70%)
- Red boxes (low confidence: <50%)
- Labels show class name + confidence %

### Statistics Panel
- Frame ID
- Objects detected count
- Timestamp
- Class breakdown (count per class + average confidence)

### Controls
- "▶ Start Session" - Begin WebRTC connection
- "⏹ End Session" - Close connection

---

## 🔄 Connection Lifecycle

```
1. User clicks "Start Session"
   ↓
2. Browser requests camera access
   ↓
3. WebRTC peer connection created
   ↓
4. Detection data channel created (BEFORE offer) ✅
   ↓
5. Offer SDP created (includes channel info)
   ↓
6. Offer sent to backend via HTTP
   ↓
7. Backend creates answer SDP (mirrors channel info)
   ↓
8. Answer received, remote description set
   ↓
9. DTLS handshake completes
   ↓
10. Detection channel opens ✅
   ↓
11. Backend sends buffered detection frames
   ↓
12. Frontend receives and displays detections ✨
```

---

## 🔗 API Endpoint Configuration

Backend API is configured in `src/api/webrtcApi.js`:

```javascript
// Current endpoint (modify as needed)
const BACKEND_URL = 'http://localhost:8000';

// POST /offer
// Sends: { sdp: string, type: 'offer' }
// Returns: { sdp: string, type: 'answer', session_id: string }
```

To use a different backend:
1. Update `BACKEND_URL` in `webrtcApi.js`
2. Restart frontend: `npm run dev`

---

## 📚 Key Files to Understand

| File | Purpose |
|------|---------|
| `App.jsx` | Main component, manages session lifecycle |
| `webrtcService.js` | **Creates detection channel BEFORE offer** ✅ |
| `detectionDataManager.js` | Handles incoming detection data |
| `DetectionCanvas.jsx` | Renders bounding boxes on video |

---

## ✅ Health Check

Run this in browser console to verify system:

```javascript
// Check manager exists
webrtc.getDetectionManager()

// Check if channel is open
webrtc.getDetectionManager().isChannelOpen()  // true = ✅

// Get latest detections
webrtc.getLatestDetections()

// Get statistics
webrtc.getDetectionStats()
```

---

## 🚨 Common Issues & Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| No console messages | DevTools not open | F12 → Console |
| "Channel not ready" in backend | Frontend not creating channel | Restart frontend (fix applied) |
| No video feed | Camera access denied | Allow camera in browser |
| Boxes don't appear | Canvas not rendering | Check DevTools console for errors |
| Connection fails | Backend not running | Start backend on port 8000 |
| "SDP missing datachannel" | Old frontend code | Clear cache: Ctrl+Shift+R |

---

## 📞 Support & Debugging

### Enable Detailed Logging

All logging is already verbose (see console output). Key prefixes:
- `[WebRTC]` - WebRTC connection events
- `[DetectionChannel]` - Data channel events
- `[YOLO]` - Detection data events
- `[App]` - Application state events

### Backend Logs (Expected)

Share these if troubleshooting:
```
[DEBUG] Incoming offer contains 'application': True ✅
[DEBUG] Incoming offer contains 'detections': True ✅
[DEBUG] Answer SDP contains 'detections': True ✅
[✅ CHANNEL OPENED] ✅
Sent detections | objects=X ✅
```

### Frontend Logs (Expected)

Share these if troubleshooting:
```
[WebRTC] ✅ Detection channel created ✅
[WebRTC] Offer SDP contains application/datachannel: true ✅
[WebRTC] Answer SDP contains "detections": true ✅
[DetectionChannel] ✅ Opened | readyState: open ✅
[App] ✅✅✅ DETECTION CALLBACK TRIGGERED! ✅✅✅
```

---

## 🚀 Deployment Checklist

- [ ] Backend is running and accessible
- [ ] Frontend starts without errors: `npm run dev`
- [ ] Browser console shows no errors (F12)
- [ ] Data channel creates before offer (logs show it)
- [ ] WebRTC connection established successfully
- [ ] Detection channel opens and data flows
- [ ] Bounding boxes render on video
- [ ] Statistics panel updates in real-time
- [ ] Application is responsive on different screen sizes

---

## 📝 License

[Add your license here]

---

## 🙏 Acknowledgments

Built with:
- React + Vite for fast development
- WebRTC for real-time communication
- YOLO for object detection (backend)

---

**Last Updated:** 2026-03-26  
**Status:** ✅ Detection channel negotiation fixed and tested  
**Version:** 1.0.0
