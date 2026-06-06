const defaultApiUrl = `${window.location.protocol}//${window.location.hostname || 'localhost'}:4000`;

export const API_URL = (import.meta.env.VITE_API_URL || defaultApiUrl).replace(/\/$/, '');

export async function getRobotState() {
  const response = await fetch(`${API_URL}/api/robot/state`);
  if (!response.ok) throw new Error('Unable to load robot state');
  return response.json();
}

export async function postRobotCommand(command) {
  return postJson('/api/robot/command', { command });
}

export async function deleteHistoryItem(id) {
  const response = await fetch(`${API_URL}/api/robot/history/${id}`, {
    method: 'DELETE'
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Delete failed');
  return payload;
}

export async function postMicEnabled(enabled) {
  return postJson('/api/robot/mic', { enabled });
}

export async function startMicRecording() {
  return postJson('/api/robot/recordings/start', {});
}

export async function stopMicRecording() {
  return postJson('/api/robot/recordings/stop', {});
}

export async function deleteMicRecording(id) {
  const response = await fetch(`${API_URL}/api/robot/recordings/${id}`, {
    method: 'DELETE'
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Delete failed');
  return payload;
}

export async function startVideoRecording() {
  return postJson('/api/robot/videos/start', {});
}

export async function stopVideoRecording() {
  return postJson('/api/robot/videos/stop', {});
}

export async function deleteVideoRecording(id) {
  const response = await fetch(`${API_URL}/api/robot/videos/${id}`, {
    method: 'DELETE'
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Delete failed');
  return payload;
}

async function postJson(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Command failed');
  return payload;
}
