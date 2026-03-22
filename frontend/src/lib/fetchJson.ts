/**
 * Browser fetch with timeout and JSON parsing; surfaces API `{ error }` bodies.
 */
export async function fetchJsonWithTimeout<T>(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 75_000, ...rest } = init;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...rest, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (typeof j?.error === "string" && j.error) msg = j.error;
      } catch {
        if (text.trim().length) msg = text.slice(0, 200);
      }
      throw new Error(msg);
    }
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s — check Vercel function logs and env vars (Sheets / spreadsheet).`
      );
    }
    throw e;
  } finally {
    clearTimeout(tid);
  }
}
