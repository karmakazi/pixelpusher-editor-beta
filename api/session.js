const { equal, isSignedIn, sessionCookie } = require('../lib/editor-session');

module.exports = function session(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.EDITOR_ACCESS_TOKEN;
  if (!secret) return res.status(503).json({ error: 'Editor sign-in needs EDITOR_ACCESS_TOKEN in Vercel.' });

  if (req.method === 'GET') return res.status(200).json({ signedIn: isSignedIn(req, secret) });
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie());
    return res.status(200).json({ signedIn: false });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Unsupported sign-in request.' });
  }
  if (!equal(req.body?.password, secret)) {
    return res.status(401).json({ error: 'That editor password didn’t match.' });
  }
  res.setHeader('Set-Cookie', sessionCookie(secret));
  return res.status(200).json({ signedIn: true });
};
