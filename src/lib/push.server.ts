/**
 * FCM HTTP v1 sender (Worker-safe).
 *
 * Requires the `FCM_SERVICE_ACCOUNT_JSON` secret — paste the raw JSON of a
 * Firebase service account key (Project Settings → Service accounts →
 * "Generate new private key"). When the secret is missing, calls become
 * no-ops and we only log; in-app notifications (`app_notifications` rows)
 * still work — the user just won't get a system-level banner.
 *
 * This module is `.server.ts` so the Vite bundler strips it from the
 * client. Import lazily from server-function handlers only.
 */

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
};

let cached: { token: string; exp: number } | null = null;
let svc: ServiceAccount | null | undefined; // undefined = not loaded; null = missing
let svcLoadedAt = 0;

async function loadServiceAccount(): Promise<ServiceAccount | null> {
  // env wins (immutable per deploy)
  if (svc !== undefined && Date.now() - svcLoadedAt < 60_000) return svc;
  const envRaw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  let raw = envRaw || "";
  if (!raw) {
    // fallback: admin-managed value stored in app_settings
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("app_settings").select("value").eq("key", "fcm_service_account_json").maybeSingle();
      if (typeof data?.value === "string") raw = data.value;
    } catch { /* ignore — leave raw empty */ }
  }
  if (!raw) { svc = null; svcLoadedAt = Date.now(); return null; }
  try {
    svc = JSON.parse(raw) as ServiceAccount;
  } catch (e) {
    console.error("[fcm] FCM service account JSON is not valid JSON", e);
    svc = null;
  }
  svcLoadedAt = Date.now();
  // invalidate cached oauth token whenever the service account changes
  cached = null;
  return svc;
}

function b64url(buf: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof buf === "string") bytes = new TextEncoder().encode(buf);
  else if (buf instanceof Uint8Array) bytes = buf;
  else bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function getAccessToken(): Promise<string | null> {
  const sa = await loadServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch(claims.aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    console.error("[fcm] oauth token error", res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

export type FcmPayload = {
  title: string;
  body?: string | null;
  deepLink?: string | null;
  data?: Record<string, string>;
};

/**
 * Send the same notification to up to N FCM tokens. Returns counts and
 * the list of invalid tokens that should be deleted by the caller.
 */
export async function sendFcmToTokens(
  tokens: string[],
  payload: FcmPayload,
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  const out = { sent: 0, failed: 0, invalidTokens: [] as string[] };
  if (tokens.length === 0) return out;
  const sa = await loadServiceAccount();
  const accessToken = await getAccessToken();
  if (!sa || !accessToken) {
    console.warn("[fcm] skipping push — FCM_SERVICE_ACCOUNT_JSON not configured");
    return out;
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const data: Record<string, string> = { ...(payload.data || {}) };
  if (payload.deepLink) data.deep_link = payload.deepLink;

  // FCM v1 has no batch endpoint for multicast; fan out in parallel.
  await Promise.all(tokens.map(async (token) => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body ?? "" },
            data,
            android: { priority: "HIGH" },
          },
        }),
      });
      if (res.ok) { out.sent += 1; return; }
      const errText = await res.text();
      out.failed += 1;
      // 404 / UNREGISTERED → token is dead, mark for deletion
      if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(errText)) {
        out.invalidTokens.push(token);
      } else {
        console.error("[fcm] send failed", res.status, errText.slice(0, 200));
      }
    } catch (e) {
      out.failed += 1;
      console.error("[fcm] send threw", e);
    }
  }));
  return out;
}

/**
 * Data-only HIGH priority FCM message. The Android FirebaseMessagingService
 * (TalkoraMessagingService) listens for these and decides whether to launch
 * the full-screen IncomingCallActivity, dismiss it (cancel), or show nothing.
 *
 * Data-only (no `notification` field) is REQUIRED so the worker callback
 * fires even when the app is swiped away / force-stopped, which is the
 * only way to wake the device into a WhatsApp-style call screen.
 */
export async function sendDataOnlyFcm(
  tokens: string[],
  data: Record<string, string>,
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  const out = { sent: 0, failed: 0, invalidTokens: [] as string[] };
  if (tokens.length === 0) return out;
  const sa = await loadServiceAccount();
  const accessToken = await getAccessToken();
  if (!sa || !accessToken) {
    console.warn("[fcm] data-only push skipped — FCM not configured");
    return out;
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  await Promise.all(tokens.map(async (token) => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            // NO notification block — pure data so onMessageReceived always fires.
            data,
            android: {
              priority: "HIGH",
              // ttl short — call invites are useless after ~45s
              ttl: "60s",
            },
          },
        }),
      });
      if (res.ok) { out.sent += 1; return; }
      const errText = await res.text();
      out.failed += 1;
      if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(errText)) {
        out.invalidTokens.push(token);
      } else {
        console.error("[fcm] data-only send failed", res.status, errText.slice(0, 200));
      }
    } catch (e) {
      out.failed += 1;
      console.error("[fcm] data-only send threw", e);
    }
  }));
  return out;
}

