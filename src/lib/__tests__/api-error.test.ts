import { describe, expect, it } from 'vitest';
import { ApiError, errorResponse } from '../api-error';

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

describe('ApiError constructor + subclasses', () => {
  it('defaults statusCode to 500 and keeps the given message', () => {
    const err = new ApiError('boom');
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('ApiError');
    expect(err).toBeInstanceOf(Error);
  });

  it('maps the badRequest factory to a 400 status code', () => {
    const err = ApiError.badRequest('missing field');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('missing field');
  });

  it('maps the notFound factory to a 404 status code', () => {
    const err = ApiError.notFound('nope');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('nope');
  });

  it('maps the serviceUnavailable factory to a 503 status code', () => {
    const err = ApiError.serviceUnavailable('upstream down');
    expect(err.statusCode).toBe(503);
    expect(err.message).toBe('upstream down');
  });
});

describe('errorResponse()', () => {
  it('uses the ApiError statusCode verbatim', async () => {
    const res = errorResponse(ApiError.badRequest('no tariff'));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ ok: false, error: 'no tariff' });
  });

  it('falls back to 500 for generic Error instances', async () => {
    const res = errorResponse(new Error('db down'));
    expect(res.status).toBe(500);
    expect(await readJson(res)).toEqual({ ok: false, error: 'db down' });
  });

  it("encodes 'Unknown error' when given a non-Error value", async () => {
    const res = errorResponse('not an error');
    expect(res.status).toBe(500);
    expect(await readJson(res)).toEqual({ ok: false, error: 'Unknown error' });

    const res2 = errorResponse(undefined);
    expect(await readJson(res2)).toEqual({ ok: false, error: 'Unknown error' });
  });

  it('respects the fallbackStatus argument for generic errors', async () => {
    const res = errorResponse(new Error('oops'), 502);
    expect(res.status).toBe(502);
    expect(await readJson(res)).toEqual({ ok: false, error: 'oops' });
  });

  it('does NOT let fallbackStatus override an ApiError status', async () => {
    // ApiError.badRequest should stay 400 even if the caller suggests 599.
    const res = errorResponse(ApiError.badRequest('bad'), 599);
    expect(res.status).toBe(400);
  });

  it('ignores error classes that extend Error but are not ApiError (uses fallback)', async () => {
    class CustomError extends Error {
      constructor() {
        super('custom');
      }
    }
    const res = errorResponse(new CustomError());
    expect(res.status).toBe(500);
    expect(await readJson(res)).toEqual({ ok: false, error: 'custom' });
  });
});
