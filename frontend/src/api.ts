import type { ErrorResponse } from '@machine-memory/shared';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = body as Partial<ErrorResponse> | null;
    throw new ApiError(
      failure?.error?.code ?? 'REQUEST_FAILED',
      failure?.error?.message ?? 'The API is unavailable. Start the backend and retry.',
      failure?.error?.requestId,
    );
  }
  if (!body) throw new ApiError('INVALID_RESPONSE', 'The API returned an empty response.');
  return body as T;
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(`/api${path}`, { signal, headers: { Accept: 'application/json' } }));
}

export async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(`/api${path}`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }));
}

export async function del<T>(path: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(`/api${path}`, { method: 'DELETE', signal, headers: { Accept: 'application/json' } }));
}

/**
 * Multipart upload. The browser sets its own Content-Type boundary, so we must not set one here.
 */
export async function upload<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(`/api${path}`, { method: 'POST', signal, headers: { Accept: 'application/json' }, body: form }));
}

/** Turns an API failure into something a technician can act on. */
export function failureText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'DATABASE_NOT_CONFIGURED':
        return 'The API is running but no database is configured. Set DATABASE_URL, apply the migration and run the seed.';
      case 'DATABASE_UNAVAILABLE':
        return 'The database did not respond. Check that the project is running, then retry.';
      case 'RATE_LIMITED':
        return 'Too many investigations in the last minute. Wait a moment and retry.';
      case 'ASSET_NOT_FOUND':
        return 'That asset is not in the database.';
      case 'ASSET_EXISTS':
        return 'A turbine with that code already exists. Choose a different asset code.';
      case 'PREVIEW_EXPIRED':
        return 'The uploaded file is no longer held for import. Upload it again.';
      case 'SOURCE_PROTECTED':
        return 'Reviewed public and foundation sources cannot be deleted from the interface.';
      case 'PAYLOAD_TOO_LARGE':
        return 'That file is larger than the upload limit for this type.';
      default:
        return error.message;
    }
  }
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  return error instanceof Error ? error.message : 'The request could not be completed. Retry.';
}
