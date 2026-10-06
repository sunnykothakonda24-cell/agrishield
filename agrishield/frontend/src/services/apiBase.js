export function resolveApiBase(configuredUrl, isProduction) {
  const apiBase = String(configuredUrl || '').trim().replace(/\/+$/, '');
  if (!apiBase) {
    const error = new Error('The AgriShield API is not configured. Set VITE_API_BASE_URL for this deployment.');
    error.code = 'API_CONFIG_MISSING';
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(apiBase);
  } catch {
    const error = new Error('VITE_API_BASE_URL must be an absolute HTTP(S) API URL.');
    error.code = 'API_CONFIG_INVALID';
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    const error = new Error('VITE_API_BASE_URL must be an absolute HTTP(S) API URL without embedded credentials.');
    error.code = 'API_CONFIG_INVALID';
    throw error;
  }
  if (isProduction &&
      (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    const error = new Error('Production AgriShield API configuration must use a public HTTPS endpoint.');
    error.code = 'HTTPS_REQUIRED';
    throw error;
  }
  return apiBase;
}
