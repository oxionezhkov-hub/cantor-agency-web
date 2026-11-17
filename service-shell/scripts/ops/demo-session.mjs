const encoder = new TextEncoder();
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function passwordAuthorized(request, expected) {
  const value = request.headers.get("x-demo-password") || "";
  if (!expected || !value || value.length > 1024) return false;
  return equal(hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))), expected);
}
async function mac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export async function imageSessionCookie(secret, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + 30 * 86400);
  return `cantor_demo_session=${expires}.${await mac(expires, secret)}; Path=/api/demo; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`;
}
export async function sessionAuthorized(request, secret, now = Date.now()) {
  if (!secret) return false;
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)cantor_demo_session=(\d{10})\.([a-f0-9]{64})(?:;|$)/);
  if (
    !token ||
    Number(token[1]) < Math.floor(now / 1000) ||
    Number(token[1]) > Math.floor(now / 1000) + 30 * 86400
  )
    return false;
  return equal(token[2], await mac(token[1], secret));
}
