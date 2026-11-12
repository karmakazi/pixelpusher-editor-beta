import { put } from '@vercel/blob/client';

async function uploadOnce(file) {
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

export async function uploadImage(file) {
  try {
    return await uploadOnce(file);
  } catch (error) {
    // Retry a duplicate-path response with a fresh upload authorization.
    if (!(error instanceof Error) || !/this blob already exists/i.test(error.message)) throw error;
    return uploadOnce(file);
  }
}
