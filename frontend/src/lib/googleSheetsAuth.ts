import { google } from "googleapis";

/**
 * Vercel / serverless: paste full service account JSON in GOOGLE_SERVICE_ACCOUNT_JSON.
 * Local: GOOGLE_APPLICATION_CREDENTIALS = path to the same JSON file.
 */
export function createSheetsGoogleAuth(scopes: string[]) {
  const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    let creds: Record<string, unknown>;
    try {
      creds = JSON.parse(jsonRaw) as Record<string, unknown>;
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    return new google.auth.GoogleAuth({ credentials: creds, scopes });
  }
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFile) {
    return new google.auth.GoogleAuth({ keyFile, scopes });
  }
  throw new Error(
    "Set GOOGLE_SERVICE_ACCOUNT_JSON (full JSON, e.g. on Vercel) or GOOGLE_APPLICATION_CREDENTIALS (file path, local)."
  );
}
