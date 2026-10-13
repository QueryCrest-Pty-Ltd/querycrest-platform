const ALLOWED_ORIGINS = [
  'https://www.QueryCrest.com', // Production domain
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

export function getCorsHeaders(origin: string | null) {
  // Check if the request's origin is in the allowlist.
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0]; // Fallback to the first allowed origin if not matched

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
    'Vary': 'Origin', // Important for caching
  };
}