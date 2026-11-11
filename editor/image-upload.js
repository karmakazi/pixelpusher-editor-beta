import { put } from '@vercel/blob/client';

export async function uploadImage(file) {
  const response = await fetch('/api/image-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error);
    error.status = response.status;
    throw error;
  }
  const blob = await put(result.pathname, file, {
    access: 'public',
    token: result.token,
    contentType: file.type,
    abortSignal: AbortSignal.timeout(120000),
  });
  return blob.url;
}
