import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyKyc, submitKyc, requestWithdrawal, listMyWithdrawals } from "@/lib/kyc.functions";
import { getWallet } from "@/lib/wallet.functions";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Upload, Clock, CheckCircle2, XCircle, ArrowLeft, IndianRupee } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useScreenPrivacy } from "@/hooks/use-screen-privacy";


export const Route = createFileRoute("/_authenticated/withdraw")({
  component: WithdrawPage,
});

const MIN_COINS = 10000;
const RATE = 0.05;

function WithdrawPage() {
  const router = useRouter();
  const qc = useQueryClient();
  // Phase 4 — Native: block screenshots of bank/PAN/Aadhaar previews.
  useScreenPrivacy(true);
  const kycFn = useServerFn(getMyKyc);

  const walletFn = useServerFn(getWallet);
  const listFn = useServerFn(listMyWithdrawals);
  const { data: kyc, isLoading } = useQuery({ queryKey: ["my-kyc"], queryFn: () => kycFn() });
  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });
  const { data: history } = useQuery({ queryKey: ["my-withdrawals"], queryFn: () => listFn() });

  return (
    <AppShell>
      <button onClick={() => router.history.back()} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Back
      </button>
      <h1 className="text-2xl font-bold mb-1">Withdraw earnings</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Min {MIN_COINS.toLocaleString("en-IN")} coins • 1 coin = ₹{RATE}
      </p>

      {isLoading ? (
        <Card className="glass p-6 text-sm text-muted-foreground">Loading…</Card>
      ) : !kyc ? (
        <KycForm onDone={() => qc.invalidateQueries({ queryKey: ["my-kyc"] })} />
      ) : kyc.status === "pending" ? (
        <Card className="glass p-6 border-amber-500/30">
          <div className="flex items-center gap-2 text-amber-500 font-semibold"><Clock className="size-5" /> KYC under review</div>
          <p className="mt-2 text-sm text-muted-foreground">Hum aapke documents verify kar rahe hain. Usually 24-48 hours lagte hain. Approve hone ke baad aap withdraw kar payenge.</p>
        </Card>
      ) : kyc.status === "rejected" ? (
        <Card className="glass p-6 border-destructive/30">
          <div className="flex items-center gap-2 text-destructive font-semibold"><XCircle className="size-5" /> KYC rejected</div>
          {kyc.review_notes && <p className="mt-2 text-sm text-muted-foreground">Reason: {kyc.review_notes}</p>}
          <Button className="mt-3" onClick={() => { /* allow resubmit */ qc.setQueryData(["my-kyc"], null); }}>
            Resubmit KYC
          </Button>
        </Card>
      ) : (
        <WithdrawForm
          balance={wallet?.balance ?? 0}
          kyc={kyc}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["wallet"] });
            qc.invalidateQueries({ queryKey: ["my-withdrawals"] });
          }}
        />
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">Withdrawal history</h2>
      {!history?.length ? (
        <Card className="glass p-6 text-center text-muted-foreground text-sm">No withdrawals yet.</Card>
      ) : (
        <div className="space-y-2">
          {history.map((w: any) => (
            <Card key={w.id} className="glass p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">₹{Number(w.inr_amount).toFixed(2)} <span className="text-xs text-muted-foreground">• {w.coins} coins</span></div>
                  <div className="text-xs text-muted-foreground">{format(new Date(w.created_at), "dd MMM yyyy, HH:mm")} • {w.payout_method.toUpperCase()}</div>
                </div>
                <StatusBadge status={w.status} />
              </div>
              {w.utr_reference && <p className="mt-2 text-xs text-muted-foreground">UTR: {w.utr_reference}</p>}
              {w.admin_notes && <p className="mt-1 text-xs text-muted-foreground">Note: {w.admin_notes}</p>}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-amber-500/15 text-amber-500" },
    processing: { label: "Processing", cls: "bg-blue-500/15 text-blue-500" },
    paid: { label: "Paid", cls: "bg-success/15 text-success" },
    rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] ?? { label: status, cls: "" };
  return <Badge className={m.cls}>{m.label}</Badge>;
}

function WithdrawForm({ balance, kyc, onDone }: { balance: number; kyc: any; onDone: () => void }) {
  const [coins, setCoins] = useState(MIN_COINS);
  const [busy, setBusy] = useState(false);
  const requestFn = useServerFn(requestWithdrawal);
  const inr = (coins * RATE).toFixed(2);

  async function submit() {
    if (coins < MIN_COINS) return toast.error(`Minimum ${MIN_COINS} coins`);
    if (coins > balance) return toast.error("Insufficient balance");
    setBusy(true);
    try {
      const res = await requestFn({ data: { coins } });
      toast.success(`Withdrawal of ₹${res.inr} submitted`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Card className="glass p-6 border-success/30 space-y-4">
      <div className="flex items-center gap-2 text-success font-semibold">
        <CheckCircle2 className="size-5" /> KYC Verified
      </div>
      <div className="text-xs text-muted-foreground">
        Payout to: {kyc.payout_method === "bank"
          ? `${kyc.bank_account_name} • ${String(kyc.bank_account_number).slice(-4).padStart(String(kyc.bank_account_number).length, "•")} • ${kyc.bank_ifsc}`
          : kyc.upi_id}
      </div>
      <div>
        <Label>Coins to withdraw</Label>
        <Input type="number" min={MIN_COINS} max={balance} value={coins} onChange={e => setCoins(parseInt(e.target.value || "0"))} />
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">You will receive</span>
          <span className="font-semibold text-success inline-flex items-center"><IndianRupee className="size-4" />{inr}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Available: {balance.toLocaleString("en-IN")} coins</p>
      </div>
      <Button onClick={submit} disabled={busy} className="w-full brand-gradient text-primary-foreground">
        {busy ? "Submitting…" : "Request withdrawal"}
      </Button>
    </Card>
  );
}

function KycForm({ onDone }: { onDone: () => void }) {
  const submitFn = useServerFn(submitKyc);
  const [form, setForm] = useState({
    full_name: "", dob: "", pan_number: "", aadhaar_last4: "",
    payout_method: "upi" as "bank" | "upi",
    bank_account_name: "", bank_account_number: "", bank_ifsc: "",
    upi_id: "",
  });
  const [files, setFiles] = useState<Record<string, File | null>>({
    pan: null, aadhaar_front: null, aadhaar_back: null, selfie: null,
  });
  const [busy, setBusy] = useState(false);

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(s => ({ ...s, [k]: v })); }

  async function upload(file: File, slot: string, userId: string): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${slot}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("kyc-docs").upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw new Error(`${slot}: ${error.message}`);
    return path;
  }

  async function submit() {
    const u = (await supabase.auth.getUser()).data.user;
    if (!u) return toast.error("Not signed in");
    if (!files.pan || !files.aadhaar_front || !files.aadhaar_back || !files.selfie) {
      return toast.error("All 4 documents are required");
    }
    setBusy(true);
    try {
      const [pan_doc_path, aadhaar_front_path, aadhaar_back_path, selfie_path] = await Promise.all([
        upload(files.pan!, "pan", u.id),
        upload(files.aadhaar_front!, "aadhaar-front", u.id),
        upload(files.aadhaar_back!, "aadhaar-back", u.id),
        upload(files.selfie!, "selfie", u.id),
      ]);
      await submitFn({ data: {
        full_name: form.full_name,
        dob: form.dob,
        pan_number: form.pan_number.toUpperCase(),
        aadhaar_last4: form.aadhaar_last4,
        pan_doc_path, aadhaar_front_path, aadhaar_back_path, selfie_path,
        payout_method: form.payout_method,
        bank_account_name: form.bank_account_name || null,
        bank_account_number: form.bank_account_number || null,
        bank_ifsc: (form.bank_ifsc || "").toUpperCase() || null,
        upi_id: form.upi_id || null,
      } });
      toast.success("KYC submitted for review");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "KYC submission failed");
    } finally { setBusy(false); }
  }

  return (
    <Card className="glass p-6 space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" />
        <div>
          <h2 className="font-semibold">Complete KYC verification</h2>
          <p className="text-xs text-muted-foreground">Required by RBI guidelines before any withdrawal.</p>
        </div>
      </div>

      <div className="grid gap-3">
        <div>
          <Label>Full name (as on PAN)</Label>
          <Input value={form.full_name} onChange={e => setF("full_name", e.target.value)} maxLength={100} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Date of birth</Label>
            <Input type="date" value={form.dob} onChange={e => setF("dob", e.target.value)} />
          </div>
          <div>
            <Label>PAN number</Label>
            <Input value={form.pan_number} onChange={e => setF("pan_number", e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" />
          </div>
        </div>
        <div>
          <Label>Aadhaar — last 4 digits only</Label>
          <Input value={form.aadhaar_last4} onChange={e => setF("aadhaar_last4", e.target.value.replace(/\D/g, ""))} maxLength={4} inputMode="numeric" placeholder="1234" />
          <p className="text-[11px] text-muted-foreground mt-1">For your safety we never store the full Aadhaar number.</p>
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-semibold">Upload documents</Label>
        <FileSlot label="PAN card photo" file={files.pan} onPick={f => setFiles(s => ({ ...s, pan: f }))} />
        <FileSlot label="Aadhaar — front" file={files.aadhaar_front} onPick={f => setFiles(s => ({ ...s, aadhaar_front: f }))} />
        <FileSlot label="Aadhaar — back" file={files.aadhaar_back} onPick={f => setFiles(s => ({ ...s, aadhaar_back: f }))} />
        <FileSlot label="Selfie with PAN card" file={files.selfie} onPick={f => setFiles(s => ({ ...s, selfie: f }))} />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-semibold">Payout method</Label>
        <RadioGroup value={form.payout_method} onValueChange={v => setF("payout_method", v as any)} className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 border rounded-md p-3 cursor-pointer">
            <RadioGroupItem value="upi" /> <span>UPI</span>
          </label>
          <label className="flex items-center gap-2 border rounded-md p-3 cursor-pointer">
            <RadioGroupItem value="bank" /> <span>Bank account</span>
          </label>
        </RadioGroup>
      </div>

      {form.payout_method === "upi" ? (
        <div>
          <Label>UPI ID</Label>
          <Input value={form.upi_id} onChange={e => setF("upi_id", e.target.value)} placeholder="yourname@upi" />
        </div>
      ) : (
        <div className="grid gap-3">
          <div>
            <Label>Account holder name</Label>
            <Input value={form.bank_account_name} onChange={e => setF("bank_account_name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Account number</Label>
              <Input value={form.bank_account_number} onChange={e => setF("bank_account_number", e.target.value.replace(/\D/g, ""))} maxLength={18} />
            </div>
            <div>
              <Label>IFSC</Label>
              <Input value={form.bank_ifsc} onChange={e => setF("bank_ifsc", e.target.value.toUpperCase())} maxLength={11} placeholder="HDFC0001234" />
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        By submitting, you confirm the documents are genuine and belong to you. False documents will result in permanent account ban.
      </p>
      <Button onClick={submit} disabled={busy} className="w-full brand-gradient text-primary-foreground">
        {busy ? "Submitting…" : "Submit for verification"}
      </Button>
    </Card>
  );
}

function FileSlot({ label, file, onPick }: { label: string; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <label className="flex items-center justify-between border rounded-md p-3 cursor-pointer hover:bg-muted/30">
      <div className="flex items-center gap-2">
        <Upload className="size-4 text-muted-foreground" />
        <div>
          <div className="text-sm">{label}</div>
          {file && <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">{file.name}</div>}
        </div>
      </div>
      {file ? <span className="text-xs text-success">Selected</span> : <span className="text-xs text-primary">Choose</span>}
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}
