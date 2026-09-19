/**
 * Google Play Billing bridge (Capacitor).
 *
 * The native plugin lives in
 * `android/app/src/main/java/in/talkora/app/PlayBillingPlugin.java`.
 * Every helper here is safe to call from the web: it resolves to an
 * "unavailable" result instead of throwing so the Recharge screen can show a
 * clear message in a browser.
 *
 * Prices are ALWAYS the strings Google returns for the user's country — the app
 * never renders its own price for a Play product.
 */

import { registerPlugin } from "@capacitor/core";
import { isNative, platform } from "./native";

export interface PlayProduct {
  productId: string;
  title: string;
  description: string;
  /** Localised, Google-formatted price, e.g. "₹99.00". */
  price: string;
  priceAmountMicros: number;
  priceCurrencyCode: string;
}

export interface PlayPurchase {
  productId: string;
  purchaseToken: string;
  orderId?: string;
  purchaseTime?: number;
  acknowledged?: boolean;
  /** 1 = purchased, 2 = pending */
  purchaseState?: number;
}

interface PlayBillingPluginShape {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  queryProducts(options: { productIds: string[] }): Promise<{ products: PlayProduct[] }>;
  purchase(options: {
    productId: string;
    obfuscatedAccountId?: string;
  }): Promise<{ status: "purchased" | "pending" | "cancelled"; purchase?: PlayPurchase }>;
  getPurchases(): Promise<{ purchases: PlayPurchase[] }>;
  consume(options: { purchaseToken: string }): Promise<{ ok: boolean }>;
}

const PlayBilling = registerPlugin<PlayBillingPluginShape>("PlayBilling");

export function playBillingSupported(): boolean {
  return isNative() && platform() === "android";
}

export async function playBillingAvailable(): Promise<{ available: boolean; reason?: string }> {
  if (!playBillingSupported()) {
    return { available: false, reason: "not_android_app" };
  }
  try {
    return await PlayBilling.isAvailable();
  } catch (e) {
    return { available: false, reason: (e as Error)?.message ?? "plugin_unavailable" };
  }
}

export async function queryPlayProducts(productIds: string[]): Promise<PlayProduct[]> {
  if (!playBillingSupported() || productIds.length === 0) return [];
  try {
    const res = await PlayBilling.queryProducts({ productIds });
    return res.products ?? [];
  } catch {
    return [];
  }
}

export async function startPlayPurchase(
  productId: string,
  obfuscatedAccountId?: string,
): Promise<{ status: "purchased" | "pending" | "cancelled" | "unavailable"; purchase?: PlayPurchase }> {
  if (!playBillingSupported()) return { status: "unavailable" };
  const res = await PlayBilling.purchase({ productId, obfuscatedAccountId });
  return res;
}

/** Purchases Google still considers owned — used to recover interrupted buys. */
export async function getOwnedPlayPurchases(): Promise<PlayPurchase[]> {
  if (!playBillingSupported()) return [];
  try {
    const res = await PlayBilling.getPurchases();
    return res.purchases ?? [];
  } catch {
    return [];
  }
}

/**
 * Consume a purchase so the same coin pack can be bought again. Only ever call
 * this AFTER the server has confirmed the coins were credited.
 */
export async function consumePlayPurchase(purchaseToken: string): Promise<boolean> {
  if (!playBillingSupported()) return false;
  try {
    const res = await PlayBilling.consume({ purchaseToken });
    return !!res?.ok;
  } catch {
    return false;
  }
}
