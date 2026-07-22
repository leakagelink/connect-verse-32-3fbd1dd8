import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  loadMessages, sendMessage, startChatSession, tickChatBilling, endChatSession,
} from "@/lib/chat.functions";
import { getMyProfile } from "@/lib/onboarding.functions";
import { getWallet } from "@/lib/wallet.functions";
import {
  getPartnerProfile, sendFollowRequest, respondFollowRequest, unfollowUser,
} from "@/lib/follows.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CoinBadge } from "@/components/coin-badge";
import { ReportDialog } from "@/components/report-dialog";
import { ArrowLeft, Send, Sparkles, UserPlus, UserCheck, UserX, Check, X, Phone, Smile } from "lucide-react";
import { toast } from "sonner";
import { CHAT_COINS_PER_MINUTE, MESSAGE_COIN_COST_MALE, detectContactShare, contactShareWarning } from "@/lib/constants";

export const Route = createFileRoute("/_authenticated/chat/$conversationId")({
  component: ChatRoom,
});

type Msg = { id: string; sender_id: string; body: string; created_at: string; is_deleted: boolean };

function ChatRoom() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const loadFn = useServerFn(loadMessages);
  const sendFn = useServerFn(sendMessage);
  const startFn = useServerFn(startChatSession);
  const tickFn = useServerFn(tickChatBilling);
  const endFn = useServerFn(endChatSession);
  const profileFn = useServerFn(getMyProfile);
  const walletFn = useServerFn(getWallet);
  const partnerFn = useServerFn(getPartnerProfile);
  const followFn = useServerFn(sendFollowRequest);
  const respondFn = useServerFn(respondFollowRequest);
  const unfollowFn = useServerFn(unfollowUser);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => profileFn() });
  const { data: wallet, refetch: refetchWallet } = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });

  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // initial load + figure out the other user from messages or fetch
  useEffect(() => {
    loadFn({ data: { conversationId } }).then((m) => setMessages(m as Msg[]));
    supabase.from("conversations").select("user_a, user_b").eq("id", conversationId).maybeSingle().then(({ data }) => {
      if (!data || !me?.profile) return;
      setOtherUserId(data.user_a === me.profile.id ? data.user_b : data.user_a);
    });
  }, [conversationId, loadFn, me?.profile]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase.channel(`msg:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Msg]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId]);

  // Realtime: react instantly when the peer accepts/rejects the friend request
  useEffect(() => {
    const myId = me?.profile?.id;
    if (!myId || !otherUserId) return;
    const ch = supabase.channel(`follows:${myId}:${otherUserId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `follower_id=eq.${myId}` },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (row?.following_id === otherUserId) qc.invalidateQueries({ queryKey: ["partner", otherUserId] });
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `following_id=eq.${myId}` },
        (payload: any) => {
          const row = payload.new ?? payload.old;
          if (row?.follower_id === otherUserId) qc.invalidateQueries({ queryKey: ["partner", otherUserId] });
        })
      // Also refresh when anyone follows/unfollows the partner (their public count).
      .on("postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `following_id=eq.${otherUserId}` },
        () => { qc.invalidateQueries({ queryKey: ["partner", otherUserId] }); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me?.profile?.id, otherUserId, qc]);

  // start session on mount, tick every 30s, end on unmount
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    startFn({ data: { conversationId } }).then((r) => {
      if (cancelled) return;
      setSessionId(r.sessionId);
      interval = setInterval(async () => {
        try {
          const result = await tickFn({ data: { sessionId: r.sessionId, elapsedSeconds: 30 } });
          refetchWallet();
          qc.invalidateQueries({ queryKey: ["me"] });
          if (result.ended) {
            setSessionEnded(true);
            if (interval) clearInterval(interval);
            toast.error(result.reason === "insufficient_coins" ? "Out of coins. Please recharge." : "Chat session ended.");
          }
        } catch {}
      }, 30_000);
    }).catch((e: any) => toast.error(e.message ?? "Cannot start chat"));
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      // best-effort end
      supabase.auth.getSession().then(() => {
        // session id may be unset if start failed; ignore
      });
    };
  }, [conversationId, startFn, tickFn, refetchWallet, qc]);

  useEffect(() => {
    if (!sessionId) return;
    return () => { endFn({ data: { sessionId } }).catch(() => {}); };
  }, [sessionId, endFn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || sessionEnded) return;
    // Client-side safety net: block off-platform contact sharing instantly with
    // an explicit warning. Server enforces the same rule and logs a strike.
    const cat = detectContactShare(body);
    if (cat) {
      toast.warning("⚠️ Safety warning", {
        description: contactShareWarning(cat) + " Please keep all conversations inside the app.",
        duration: 6000,
      });
      return;
    }
    setText("");
    try { await sendFn({ data: { conversationId, body } }); refetchWallet(); }
    catch (e: any) {
      const msg: string = e?.message ?? "Failed to send";
      if (msg.startsWith("CONTACT_SHARE_BLOCKED")) {
        const parts = msg.split(":");
        const reason = parts.slice(2).join(":") || "Sharing contact details is not allowed.";
        toast.warning("⚠️ Message blocked", {
          description: reason + " Repeated attempts may result in an account ban.",
          duration: 7000,
        });
        setText(body); // restore so user can edit
      } else {
        toast.error(msg);
      }
    }
  }

  const myId = me?.profile?.id;
  const freeSec = me?.profile?.free_seconds_remaining ?? 0;
  const coinBal = wallet?.balance ?? 0;
  const myGender = me?.profile?.gender;
  const messageCost = myGender === "male" ? MESSAGE_COIN_COST_MALE : 0;

  const { data: partner, refetch: refetchPartner } = useQuery({
    queryKey: ["partner", otherUserId],
    queryFn: () => partnerFn({ data: { userId: otherUserId! } }),
    enabled: !!otherUserId,
  });

  async function doFollow() {
    if (!otherUserId) return;
    try { await followFn({ data: { userId: otherUserId } }); toast.success("Follow request sent"); refetchPartner(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function doUnfollow() {
    if (!otherUserId) return;
    try { await unfollowFn({ data: { userId: otherUserId } }); refetchPartner(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function respond(action: "accept" | "reject") {
    if (!otherUserId) return;
    try { await respondFn({ data: { userId: otherUserId, action } }); refetchPartner(); }
    catch (e: any) { toast.error(e.message); }
  }

  const p = partner?.profile;
  const initials = (p?.username ?? "U").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="glass border-b sticky top-0 z-30">
        <div className="mx-auto max-w-3xl flex items-center gap-3 px-3 py-2">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/chat" })}>
            <ArrowLeft className="size-5" />
          </Button>
          <Avatar className="size-10">
            {p?.avatar_url ? <AvatarImage src={p.avatar_url} /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate">{p?.username ?? "User"}</p>
              {p?.gender && <Badge variant="secondary" className="capitalize text-[10px]">{p.gender}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {[p?.state, p?.country].filter(Boolean).join(", ") || "—"}
              {" · "}
              <span><strong className="text-foreground">{partner?.followers ?? 0}</strong> followers · <strong className="text-foreground">{partner?.following ?? 0}</strong> following</span>
            </p>
          </div>
          <CoinBadge value={coinBal} />
          {otherUserId && <ReportDialog targetUserId={otherUserId} conversationId={conversationId} />}
        </div>
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-2 px-3 pb-2">
          <p className="text-[11px] text-muted-foreground">
            {freeSec > 0 ? `${Math.floor(freeSec/60)}m free · ` : ""}
            {CHAT_COINS_PER_MINUTE} coins/min{messageCost > 0 ? ` · ${messageCost} coin/message` : " · messages free"}
          </p>
          <div className="flex items-center gap-2">
            {partner?.incoming === "pending" ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => respond("accept")}>
                  <Check className="size-3.5 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => respond("reject")}>
                  <X className="size-3.5 mr-1" /> Reject
                </Button>
              </>
            ) : partner?.outgoing === "accepted" ? (
              <Button size="sm" variant="secondary" onClick={doUnfollow}>
                <UserCheck className="size-3.5 mr-1" /> Following
              </Button>
            ) : partner?.outgoing === "pending" ? (
              <Button size="sm" variant="ghost" onClick={doUnfollow}>
                <UserX className="size-3.5 mr-1" /> Cancel request
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={doFollow}>
                <UserPlus className="size-3.5 mr-1" /> Follow
              </Button>
            )}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 mx-auto w-full max-w-3xl space-y-2">
        {messages.map((m) => {
          const mine = m.sender_id === myId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "glass"}`}>
                {m.is_deleted ? <em className="opacity-60">message deleted</em> : m.body}
              </div>
            </div>
          );
        })}
        {sessionEnded && (
          <div className="glass mx-auto max-w-xs rounded-xl p-4 text-center mt-4">
            <Sparkles className="mx-auto size-5 text-primary" />
            <p className="mt-2 text-sm">Chat session ended.</p>
            <Link to="/recharge"><Button size="sm" className="mt-2 brand-gradient text-primary-foreground">Recharge coins</Button></Link>
          </div>
        )}
      </div>

      {(() => {
        const isFriends = partner?.outgoing === "accepted" || partner?.incoming === "accepted";
        const blockReason: "REQUEST_PENDING" | "INCOMING_PENDING" | "NOT_FRIENDS" | null = isFriends
          ? null
          : partner?.outgoing === "pending"
            ? "REQUEST_PENDING"
            : partner?.incoming === "pending"
              ? "INCOMING_PENDING"
              : "NOT_FRIENDS";
        const reasonText =
          blockReason === "REQUEST_PENDING"
            ? "REQUEST_PENDING — Waiting for them to accept your friend request before you can message."
            : blockReason === "INCOMING_PENDING"
              ? "NOT_FRIENDS — Accept their friend request above to start messaging."
              : blockReason === "NOT_FRIENDS"
                ? "NOT_FRIENDS — Send a friend request and wait for them to accept before messaging."
                : null;
        const disabled = sessionEnded || !!blockReason;
        const placeholder = sessionEnded
          ? "Recharge to continue"
          : blockReason === "REQUEST_PENDING"
            ? "Waiting for them to accept your request…"
            : blockReason === "INCOMING_PENDING"
              ? "Accept their request to start messaging"
              : blockReason === "NOT_FRIENDS"
                ? "Send a friend request to message"
                : "Type a message…";
        return (
          <div className="glass border-t sticky bottom-0">
            {reasonText && (
              <div className="mx-auto max-w-3xl px-3 pt-2">
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] px-3 py-2 flex items-center justify-between gap-2">
                  <span className="truncate">{reasonText}</span>
                  {blockReason === "NOT_FRIENDS" && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={doFollow}>
                      <UserPlus className="size-3 mr-1" /> Send request
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="mx-auto max-w-3xl flex gap-2 p-3">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={placeholder}
                disabled={disabled}
              />
              <Button onClick={send} disabled={disabled || !text.trim()}>
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
