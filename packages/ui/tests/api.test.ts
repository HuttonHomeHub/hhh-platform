// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CSRF_COOKIE, apiFetch, readCsrfToken } from '../src/index.ts';

function setCookie(value: string | null): void {
  document.cookie =
    value === null
      ? `${CSRF_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      : `${CSRF_COOKIE}=${value}; path=/`;
}

function reply(status: number, body?: unknown, raw?: string): Response {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  return new Response(text || null, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCookie(null);
});

function stubFetch(...replies: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const r of replies) fetchMock.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callAt(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, i: number) {
  const call = fetchMock.mock.calls[i];
  if (!call) throw new Error(`fetch was not called ${i + 1} times`);
  return call;
}

function sentHeaders(call: Parameters<typeof fetch>): Record<string, string> {
  return (call[1]?.headers ?? {}) as Record<string, string>;
}

describe('apiFetch', () => {
  it('GETs JSON without a CSRF header', async () => {
    setCookie('tok1');
    const fetchMock = stubFetch(reply(200, [{ id: 1 }]));
    await expect(apiFetch<{ id: number }[]>('/api/cranes')).resolves.toEqual([{ id: 1 }]);
    const call = callAt(fetchMock, 0);
    expect(call[0]).toBe('/api/cranes');
    expect(call[1]?.method).toBe('GET');
    expect(call[1]?.credentials).toBe('same-origin');
    expect(sentHeaders(call)['X-CSRF-Token']).toBeUndefined();
  });

  it('sends JSON bodies with the CSRF token from the cookie', async () => {
    setCookie('tok1');
    const fetchMock = stubFetch(reply(201, { id: 'a' }));
    await apiFetch('/api/cranes', { method: 'POST', body: { name: 'LTM 1100' } });
    const call = callAt(fetchMock, 0);
    expect(sentHeaders(call)).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'tok1',
    });
    expect(call[1]?.body).toBe('{"name":"LTM 1100"}');
  });

  it('sends FormData as is, leaving the content type to the browser', async () => {
    setCookie('tok1');
    const fetchMock = stubFetch(reply(201, {}));
    const form = new FormData();
    form.append('photo', new Blob(['x']), 'a.jpg');
    await apiFetch('/api/photos', { method: 'POST', body: form });
    const call = callAt(fetchMock, 0);
    expect(call[1]?.body).toBe(form);
    expect(sentHeaders(call)['Content-Type']).toBeUndefined();
  });

  it('returns undefined for an empty reply', async () => {
    stubFetch(reply(204));
    await expect(apiFetch('/api/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it("throws ApiError with the server's message and details", async () => {
    stubFetch(reply(400, { error: 'Invalid request', details: [{ path: 'name' }] }));
    const err = await apiFetch('/api/x', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      message: 'Invalid request',
      details: [{ path: 'name' }],
    });
  });

  it('keeps a generic message when the reply is not JSON', async () => {
    stubFetch(reply(502, undefined, '<html>Bad gateway</html>'));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });
  });

  it('retries a rejected write once when the server issued a new CSRF cookie', async () => {
    setCookie('old');
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      setCookie('new'); // what the server's Set-Cookie does on a 403
      return reply(403, { error: 'Missing or invalid CSRF token' });
    });
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/api/x', { method: 'PATCH', body: {} })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(callAt(fetchMock, 1))['X-CSRF-Token']).toBe('new');
  });

  it('does not retry a 403 when the cookie did not change', async () => {
    setCookie('same');
    const fetchMock = stubFetch(reply(403, { error: 'Forbidden' }));
    await expect(apiFetch('/api/x', { method: 'DELETE' })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the token from among other cookies', () => {
    document.cookie = 'other=1; path=/';
    setCookie('a%20b');
    expect(readCsrfToken()).toBe('a b');
  });
});
