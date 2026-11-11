const { randomUUID } = require('node:crypto');
const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');
const { isSignedIn } = require('../lib/editor-session');

const extensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);
const maxBytes = 20 * 1024 * 1024;

module.exports = async function imageUpload(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to authorize an image upload.' });
  }
  if (!isSignedIn(req, process.env.EDITOR_ACCESS_TOKEN)) {
    return res.status(401).json({ error: 'Sign in to upload images.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Connect a public Vercel Blob store to the beta project to enable uploads.' });
  }
  const { contentType, size } = req.body || {};
  const extension = extensions.get(contentType);
  if (!extension || !Number.isInteger(size) || size < 1 || size > maxBytes) {
    return res.status(400).json({ error: 'Choose a JPEG, PNG, WebP, GIF, or AVIF image up to 20 MB.' });
  }

  try {
    const pathname = `case-studies/${randomUUID()}.${extension}`;
    const token = await generateClientTokenFromReadWriteToken({
      pathname,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: size,
      validUntil: Date.now() + 5 * 60 * 1000,
      allowOverwrite: false,
    });
    return res.status(200).json({ pathname, token });
  } catch {
    return res.status(502).json({ error: 'Could not authorize the upload. Check the beta’s Vercel Blob connection.' });
  }
};
