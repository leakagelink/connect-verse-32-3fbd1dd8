import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createRoom } from "@/lib/rooms.functions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rooms/new")({
  component: NewRoom,
});

function NewRoom() {
  const navigate = useNavigate();
  const create = useServerFn(createRoom);

  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<"voice" | "video" | "game" | "live">("voice");
  const [seats, setSeats] = useState(8);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await create({
        data: {
          title,
          topic: topic || undefined,
          kind,
          max_seats: seats,
          // Rooms are neutral community rooms; gender-gated rooms are disabled.
          gender_gate: "all",
        },
      });
      navigate({ to: "/rooms/$id", params: { id } });
    } catch (err: any) {
      toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <Card className="glass p-6 max-w-xl mx-auto">
        <h1 className="text-xl font-bold mb-1">Host a Room</h1>
        <p className="text-sm text-muted-foreground mb-5">Start a live room and invite people in.</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday night chill" required minLength={3} maxLength={60} />
          </div>
          <div>
            <Label>Topic (optional)</Label>
            <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={160} rows={2} />
          </div>
          <div>
            <Label>Type</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as any)} className="grid grid-cols-2 gap-2 mt-2">
              {(["voice", "video", "game", "live"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer hover:border-primary/50">
                  <RadioGroupItem value={k} /> <span className="capitalize">{k}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <div>
            <Label>Seats: {seats}</Label>
            <Slider value={[seats]} onValueChange={(v) => setSeats(v[0])} min={2} max={20} step={1} className="mt-2" />
          </div>


          <Button type="submit" className="w-full brand-gradient" disabled={busy}>
            {busy ? "Creating…" : "Start Room"}
          </Button>
        </form>
      </Card>
    </AppShell>
  );
}
