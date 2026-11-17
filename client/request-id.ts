// Request identity only, not a security token. Works in native and web clients.
export function requestId() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
    (Number(digit) ^ (Math.floor(Math.random() * 16) >> (Number(digit) / 4))).toString(16),
  );
}
