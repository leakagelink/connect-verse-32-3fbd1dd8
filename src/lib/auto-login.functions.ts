import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  // Path (with query) on talkoraapp.com the user should land on after auth.
  // Restricted to a same-site path — never accept full external URLs from the client.
  redirectPath: z.string().startsWith("/").max(500),
});

const SITE_ORIGIN = "https://talkoraapp.com";

/**
 * Issues a one-time Supabase magic link that, when opened in the external
 * browser, signs the app user into the website so recharge doesn't require
 * a second sign-in. The link is short-lived (Supabase default ~1h) and
 * single-use; we return the raw action_link URL for the client to open.
 */
export const createAutoLoginUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Load user email from admin API (email is not on the JWT claims reliably).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !userRes?.user?.email) {
      throw new Error("Missing account email — please sign in on the website manually.");
    }
    const email = userRes.user.email;

    const redirectTo = `${SITE_ORIGIN}${data.redirectPath}`;

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(linkErr?.message ?? "Could not create auto-login link");
    }
    return { url: linkData.properties.action_link as string };
  });
