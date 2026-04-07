const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const webrtcApi = {
    async sendOffer(sdp, type) {
        console.log('[API] Sending WebRTC offer request');
        const response = await fetch(`${API_BASE_URL}/api/v1/webrtc/offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: sdp, type: type })
        });

        if (!response.ok) {
            throw new Error(`Signaling failed: ${response.statusText}`);
        }

        console.log('[API] WebRTC offer request succeeded');
        return await response.json();
    },

    async runLightingPrecheck(frames) {
        console.log('[API] Sending lighting precheck request', {
            frameCount: frames.length
        });
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

        console.log('[API] Lighting precheck request succeeded');
        return payload;
    }
};
