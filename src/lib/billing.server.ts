/**
 * Google Play Developer API access (server only).
 *
 * Requires the GOOGLE_PLAY_SERVICE_ACCOUNT_JSON secret: the JSON key of a
 * service account that has been granted "View financial data" + "Manage orders"
 * access to the Talkora Play Console app.
 *
 * Without that secret NOTHING is verified and NOTHING is credited — every
 * caller of these helpers surfaces an explicit error instead.
 */

const ANDROID_PACKAGE_NAME = "in.talkora.app";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export interface PlayProductPurchase {
  purchaseTimeMillis?: string;
  /** 0 = purchased, 1 = cancelled, 2 = pending */
  purchaseState?: number;
  /** 0 = yet to be consumed, 1 = consumed */
  consumptionState?: number;
  /** 0 = yet to be acknowledged, 1 = acknowledged */
  acknowledgementState?: number;
  orderId?: string;
  productId?: string;
  obfuscatedExternalAccountId?: string;
  regionCode?: string;
  quantity?: number;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super(
      "Google Play purchase verification is not configured yet. Coins cannot be credited until the Play service account is added.",
    );
    this.name = "BillingNotConfiguredError";
  }
}

function readServiceAccount(): ServiceAccount {
  const raw = process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"];
  if (!raw) throw new BillingNotConfiguredError();
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is missing client_email/private_key");
  }
  return parsed;
}

export function isPlayVerificationConfigured(): boolean {
  return !!process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"];
}

function b64url(bytes: Uint8Array | string): string {
  const str =
    typeof bytes === "string"
      ? bytes
      : Array.from(bytes)
          .map((b) => String.fromCharCode(b))
          .join("");
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const sa = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    console.error("Play token exchange failed", res.status, await res.text());
    throw new Error("Could not authenticate with Google Play");
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

/** Ask Google about one in-app product purchase token. Never trusts the client. */
export async function getPlayProductPurchase(
  productId: string,
  purchaseToken: string,
): Promise<PlayProductPurchase> {
  const token = await getAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(ANDROID_PACKAGE_NAME)}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new Error("Purchase not found on Google Play");
  if (!res.ok) {
    console.error("Play purchase lookup failed", res.status, await res.text());
    throw new Error("Could not verify this purchase with Google Play");
  }
  return (await res.json()) as PlayProductPurchase;
}

/** Acknowledge the purchase so Google does not auto-refund it after 3 days. */
export async function acknowledgePlayPurchase(
  productId: string,
  purchaseToken: string,
): Promise<void> {
  const token = await getAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(ANDROID_PACKAGE_NAME)}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok && res.status !== 400) {
    // 400 usually means "already acknowledged" — not fatal.
    console.warn("Play acknowledge failed", res.status, await res.text());
  }
}

export { ANDROID_PACKAGE_NAME };
