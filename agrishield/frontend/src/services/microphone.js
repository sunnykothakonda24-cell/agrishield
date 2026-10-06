export async function requestMicrophoneAccess({
  mediaDevices,
  permissions
} = {}) {
  if (typeof mediaDevices?.getUserMedia !== 'function') {
    const error = new Error('Microphone access is unavailable in this browser.');
    error.code = 'MICROPHONE_UNAVAILABLE';
    throw error;
  }

  let permissionState = 'unsupported';
  if (typeof permissions?.query === 'function') {
    try {
      permissionState = (await permissions.query({ name: 'microphone' })).state;
    } catch {
      permissionState = 'unsupported';
    }
  }

  const stream = await mediaDevices.getUserMedia({ audio: true });
  return { stream, permissionState };
}
