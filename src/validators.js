const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Returns amount as a clean string like "50.25", or null if invalid.
// Must be > 0, max 2 decimals.
function parseAmount(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const s = String(v).trim();
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(s)) return null;
  if (Number(s) <= 0) return null;
  return s;
}

// Returns a positive integer or null.
function parsePositiveInt(v) {
  if (!/^\d+$/.test(String(v))) return null;
  const n = parseInt(v, 10);
  return n >= 1 ? n : null;
}

module.exports = { isUuid, parseAmount, parsePositiveInt };
