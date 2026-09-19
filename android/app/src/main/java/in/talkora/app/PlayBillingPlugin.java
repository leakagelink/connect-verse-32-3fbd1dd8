package in.talkora.app;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Play Billing bridge.
 *
 * Coins are consumable in-app products. The flow is:
 *   1. JS calls queryProducts() to get Google's localised prices.
 *   2. JS calls purchase() -> Play sheet -> this plugin resolves with the token.
 *   3. JS sends the token to the Talkora server, which verifies it with the
 *      Play Developer API and credits coins.
 *   4. Only then does JS call consume() so the pack can be bought again.
 *
 * The plugin never grants anything by itself — no client-side entitlement.
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;
    private final Map<String, ProductDetails> productCache = new HashMap<>();

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases()
                .build();
        connect(null);
    }

    private void connect(final Runnable onReady) {
        if (billingClient == null) return;
        if (billingClient.isReady()) {
            if (onReady != null) onReady.run();
            return;
        }
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                if (onReady != null) onReady.run();
            }

            @Override
            public void onBillingServiceDisconnected() {
                // Capacitor calls reconnect lazily on the next request.
            }
        });
    }

    @PluginMethod
    public void isAvailable(final PluginCall call) {
        connect(new Runnable() {
            @Override
            public void run() {
                JSObject ret = new JSObject();
                boolean ready = billingClient != null && billingClient.isReady();
                ret.put("available", ready);
                if (!ready) ret.put("reason", "billing_service_unavailable");
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void queryProducts(final PluginCall call) {
        final JSArray ids = call.getArray("productIds");
        if (ids == null || ids.length() == 0) {
            call.reject("productIds is required");
            return;
        }
        connect(new Runnable() {
            @Override
            public void run() {
                List<QueryProductDetailsParams.Product> products = new ArrayList<>();
                for (int i = 0; i < ids.length(); i++) {
                    String id = ids.optString(i, null);
                    if (id == null || id.isEmpty()) continue;
                    products.add(QueryProductDetailsParams.Product.newBuilder()
                            .setProductId(id)
                            .setProductType(BillingClient.ProductType.INAPP)
                            .build());
                }
                if (products.isEmpty()) {
                    call.reject("productIds is required");
                    return;
                }
                QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                        .setProductList(products)
                        .build();
                billingClient.queryProductDetailsAsync(params, (billingResult, list) -> {
                    JSONArray out = new JSONArray();
                    if (list != null) {
                        for (ProductDetails details : list) {
                            productCache.put(details.getProductId(), details);
                            ProductDetails.OneTimePurchaseOfferDetails offer =
                                    details.getOneTimePurchaseOfferDetails();
                            JSObject item = new JSObject();
                            item.put("productId", details.getProductId());
                            item.put("title", details.getTitle());
                            item.put("description", details.getDescription());
                            item.put("price", offer != null ? offer.getFormattedPrice() : "");
                            item.put("priceAmountMicros", offer != null ? offer.getPriceAmountMicros() : 0);
                            item.put("priceCurrencyCode", offer != null ? offer.getPriceCurrencyCode() : "");
                            out.put(item);
                        }
                    }
                    JSObject ret = new JSObject();
                    ret.put("products", out);
                    call.resolve(ret);
                });
            }
        });
    }

    @PluginMethod
    public void purchase(final PluginCall call) {
        final String productId = call.getString("productId");
        final String accountId = call.getString("obfuscatedAccountId");
        if (productId == null || productId.isEmpty()) {
            call.reject("productId is required");
            return;
        }
        if (pendingPurchaseCall != null) {
            call.reject("Another purchase is already in progress");
            return;
        }
        connect(new Runnable() {
            @Override
            public void run() {
                ProductDetails cached = productCache.get(productId);
                if (cached != null) {
                    launch(call, cached, accountId);
                    return;
                }
                List<QueryProductDetailsParams.Product> products = new ArrayList<>();
                products.add(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build());
                billingClient.queryProductDetailsAsync(
                        QueryProductDetailsParams.newBuilder().setProductList(products).build(),
                        (billingResult, list) -> {
                            if (list == null || list.isEmpty()) {
                                call.reject("Product not available on Google Play");
                                return;
                            }
                            ProductDetails details = list.get(0);
                            productCache.put(details.getProductId(), details);
                            launch(call, details, accountId);
                        });
            }
        });
    }

    private void launch(PluginCall call, ProductDetails details, String accountId) {
        List<BillingFlowParams.ProductDetailsParams> params = new ArrayList<>();
        params.add(BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .build());
        BillingFlowParams.Builder flow = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(params);
        if (accountId != null && !accountId.isEmpty()) {
            flow.setObfuscatedAccountId(accountId);
        }
        pendingPurchaseCall = call;
        call.setKeepAlive(true);
        BillingResult result = billingClient.launchBillingFlow(getActivity(), flow.build());
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            pendingPurchaseCall = null;
            call.setKeepAlive(false);
            call.reject("Could not open Google Play: " + result.getDebugMessage());
        }
    }

    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        PluginCall call = pendingPurchaseCall;
        pendingPurchaseCall = null;
        if (call == null) return;
        call.setKeepAlive(false);

        int code = billingResult.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            JSObject ret = new JSObject();
            ret.put("status", "cancelled");
            call.resolve(ret);
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            call.reject("Purchase failed: " + billingResult.getDebugMessage());
            return;
        }

        Purchase purchase = purchases.get(0);
        JSObject ret = new JSObject();
        ret.put("status", purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED
                ? "purchased" : "pending");
        ret.put("purchase", toJs(purchase));
        call.resolve(ret);
    }

    @PluginMethod
    public void getPurchases(final PluginCall call) {
        connect(new Runnable() {
            @Override
            public void run() {
                billingClient.queryPurchasesAsync(
                        QueryPurchasesParams.newBuilder()
                                .setProductType(BillingClient.ProductType.INAPP)
                                .build(),
                        (billingResult, list) -> {
                            JSONArray out = new JSONArray();
                            if (list != null) {
                                for (Purchase p : list) out.put(toJs(p));
                            }
                            JSObject ret = new JSObject();
                            ret.put("purchases", out);
                            call.resolve(ret);
                        });
            }
        });
    }

    /** Consume a coin pack so it can be bought again (server already credited). */
    @PluginMethod
    public void consume(final PluginCall call) {
        final String token = call.getString("purchaseToken");
        if (token == null || token.isEmpty()) {
            call.reject("purchaseToken is required");
            return;
        }
        connect(new Runnable() {
            @Override
            public void run() {
                // Acknowledge first (harmless if already acknowledged), then consume.
                billingClient.acknowledgePurchase(
                        AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(),
                        ackResult -> billingClient.consumeAsync(
                                ConsumeParams.newBuilder().setPurchaseToken(token).build(),
                                (consumeResult, outToken) -> {
                                    JSObject ret = new JSObject();
                                    ret.put("ok", consumeResult.getResponseCode()
                                            == BillingClient.BillingResponseCode.OK);
                                    call.resolve(ret);
                                }));
            }
        });
    }

    private JSObject toJs(Purchase purchase) {
        JSObject obj = new JSObject();
        List<String> products = purchase.getProducts();
        obj.put("productId", products.isEmpty() ? "" : products.get(0));
        obj.put("purchaseToken", purchase.getPurchaseToken());
        obj.put("orderId", purchase.getOrderId());
        obj.put("purchaseTime", purchase.getPurchaseTime());
        obj.put("acknowledged", purchase.isAcknowledged());
        obj.put("purchaseState", purchase.getPurchaseState());
        return obj;
    }
}
