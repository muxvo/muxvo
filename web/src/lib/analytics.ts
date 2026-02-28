const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.muxvo.com';
const DEVICE_ID_KEY = 'muxvo_device_id';

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function track(metric: string, metadata?: Record<string, unknown>): void {
  fetch(`${API_BASE}/analytics/track`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': getDeviceId(),
    },
    body: JSON.stringify({ metric, metadata }),
  }).catch(() => {});
}
