const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

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

        return await response.json();
    }
};
