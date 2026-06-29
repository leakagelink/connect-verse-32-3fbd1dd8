// One-off diagnostic: returns the project_id (and client_email host) from
// FCM_SERVICE_ACCOUNT_JSON so we can confirm it matches the Android
// google-services.json project_id. Returns no secret material.
Deno.serve(() => {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) {
    return new Response(JSON.stringify({ ok: false, reason: "secret_not_set" }), {
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const j = JSON.parse(raw);
    return new Response(
      JSON.stringify({
        ok: true,
        project_id: j.project_id ?? null,
        type: j.type ?? null,
        client_email_domain: typeof j.client_email === "string"
          ? j.client_email.split("@")[1] ?? null
          : null,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: "parse_failed", error: String(e) }), {
      headers: { "content-type": "application/json" },
    });
  }
});
