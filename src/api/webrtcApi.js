const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

function ensureJsonObject(payload, fallbackMessage) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(fallbackMessage);
    }

    return payload;
}

export const webrtcApi = {
    async sendOffer(sdp, type) {
        const response = await fetch(`${API_BASE_URL}/api/v1/webrtc/offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: sdp, type: type })
        });

        if (!response.ok) {
            throw new Error(`Signaling failed: ${response.statusText}`);
        }

        const payload = await response.json();
        return payload;
    },

    async runLightingPrecheck(frames) {
        const response = await fetch(`${API_BASE_URL}/api/v1/precheck/lighting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frames })
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            const message = payload?.message || `Lighting precheck failed: ${response.statusText}`;
            throw new Error(message);
        }

        return ensureJsonObject(
            payload,
            'Lighting precheck returned an invalid response. Expected JSON with ok/status fields.'
        );
    },

    async saveCalibration(sessionId, boundaries) {
        const response = await fetch(`${API_BASE_URL}/api/v1/monitoring/calibration/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                ...boundaries
            })
        });

        if (!response.ok) {
            throw new Error(`Calibration save failed: ${response.statusText}`);
        }

        return response.json().catch(() => ({}));
    },

};
