import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import talkoraLogo from "@/assets/talkora-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: `Sign in — ${APP_NAME}` }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ageOk, setAgeOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home", replace: true });
    });
  }, [navigate]);

  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message); else navigate({ to: "/home", replace: true });
  }

  async function signUp() {
    if (!ageOk) return toast.error("You must confirm you are 18 or older");
    if (!termsOk) return toast.error("Please accept Terms, Privacy & Community Guidelines");
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin + "/home" },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Account created! Continue to set up your profile."); navigate({ to: "/home", replace: true }); }
  }

  const consents = (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
      <label className="flex items-start gap-2 cursor-pointer">
        <Checkbox checked={ageOk} onCheckedChange={(v) => setAgeOk(!!v)} className="mt-0.5" />
        <span>I confirm I am <strong>18 years or older</strong>.</span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer">
        <Checkbox checked={termsOk} onCheckedChange={(v) => setTermsOk(!!v)} className="mt-0.5" />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" className="underline">Terms</a>,{" "}
          <a href="/privacy" target="_blank" className="underline">Privacy Policy</a> and{" "}
          <a href="/community-guidelines" target="_blank" className="underline">Community Guidelines</a>.
        </span>
      </label>
    </div>
  );

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="glass w-full max-w-md p-8">
        <div className="flex items-center gap-2 font-bold text-lg justify-center">
          <img src={talkoraLogo.url} alt={`${APP_NAME} logo`} width={32} height={32} className="size-8 rounded-lg" />
          {APP_NAME}
        </div>
        <p className="mt-2 text-center text-sm text-muted-foreground">18+ verified community</p>

        <Tabs defaultValue="signin" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="space-y-3">
            <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <Button onClick={signIn} disabled={busy} className="w-full brand-gradient text-primary-foreground">Sign in</Button>
          </TabsContent>

          <TabsContent value="signup" className="space-y-3">
            {consents}
            <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" /></div>
            <Button onClick={signUp} disabled={busy || !ageOk || !termsOk} className="w-full brand-gradient text-primary-foreground">Create account</Button>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
