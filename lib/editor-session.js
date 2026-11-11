const { createHmac, timingSafeEqual } = require('node:crypto');

const cookieName = '__Host-pixelpusher-editor';
const lifetime = 7 * 24 * 60 * 60;

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(expires, secret) {
  return createHmac('sha256', secret).update(`pixelpusher-editor:${expires}`).digest('base64url');
}

function isSignedIn(req, secret) {
  if (!secret) return false;
  const entry = (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  const value = entry?.slice(cookieName.length + 1);
  const [expires, mac] = value?.split('.') || [];
  return /^\d{1,12}$/.test(expires) && Number(expires) > Math.floor(Date.now() / 1000) &&
    equal(mac, signature(expires, secret));
}

function sessionCookie(secret) {
  const expires = Math.floor(Date.now() / 1000) + lifetime;
  const value = secret ? `${expires}.${signature(expires, secret)}` : '';
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${secret ? lifetime : 0}`;
}

module.exports = { equal, isSignedIn, sessionCookie };
