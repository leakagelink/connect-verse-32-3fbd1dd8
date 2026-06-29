import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listNewJoiners } from "@/lib/discovery.functions";
import { getOrCreateConversation } from "@/lib/chat.functions";
import { AppShell } from "@/components/app-shell";
import { CreatorPreviewDialog } from "@/components/creator-preview-dialog";
import { CallInviteDialog } from "@/components/call-invite-dialog";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageCircle, Phone, Video, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/new-joiners")({
  component: NewJoinersPage,
});

function NewJoinersPage() {
  const navigate = useNavigate();
  const fn = useServerFn(listNewJoiners);
  const startChat = useServerFn(getOrCreateConversation);
  const { data, isLoading } = useQuery({
    queryKey: ["new-joiners"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });
  const [preview, setPreview] = useState<{ userId: string; kind: "voice" | "video" } | null>(null);
  const [callInvite, setCallInvite] = useState<{ userId: string; kind: "voice" | "video" } | null>(null);

  async function openChat(uid: string) {
    try {
      const { id } = await startChat({ data: { otherUserId: uid } });
      navigate({ to: "/chat/$conversationId", params: { conversationId: id } });
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/home"><Button size="icon" variant="ghost"><ArrowLeft className="size-4" /></Button></Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="size-5 text-emerald-400" /> New Joiners
          </h1>
          <p className="text-xs text-muted-foreground">Say hi to people who joined Talkora in the last 24 hours.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-10">Loading…</div>
      ) : !data?.length ? (
        <Card className="glass p-8 text-center text-muted-foreground">
          No new joiners in the last 24 hours. Check back soon!
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((u: any) => (
            <Card key={u.id} className="glass p-3 flex items-center gap-3">
              <div className="relative">
                <Avatar className="size-12">
                  {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                  <AvatarFallback className="brand-gradient text-primary-foreground font-semibold">
                    {(u.username ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {u.online && (
                  <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 border-2 border-background" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">@{u.username ?? "anon"}</p>
                  <Badge variant="secondary" className="text-[10px]">New</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {[u.gender, u.country, u.language].filter(Boolean).join(" · ") || "Just joined"}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="icon" variant="outline" onClick={() => openChat(u.id)} aria-label="Message">
                  <MessageCircle className="size-4" />
                </Button>
                <Button size="icon" className="brand-gradient" onClick={() => setPreview({ userId: u.id, kind: "voice" })} aria-label="Voice call">
                  <Phone className="size-4" />
                </Button>
                <Button size="icon" className="brand-gradient" onClick={() => setPreview({ userId: u.id, kind: "video" })} aria-label="Video call">
                  <Video className="size-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreatorPreviewDialog
        userId={preview?.userId ?? null}
        kind={preview?.kind ?? "voice"}
        onOpenChange={(v) => { if (!v) setPreview(null); }}
        onConfirm={(uid) => {
          const kind = preview?.kind ?? "voice";
          setPreview(null);
          setCallInvite({ kind, userId: uid });
        }}
      />
      <CallInviteDialog pendingCall={callInvite} onClose={() => setCallInvite(null)} />
    </AppShell>
  );
}
