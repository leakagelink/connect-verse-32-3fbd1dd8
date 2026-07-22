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

  // Group messages by day for the "Aaj / Kal" separators
  function dayLabel(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return "Aaj";
    if (diffDays === 1) return "Kal";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
  function timeLabel(iso: string) {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary-soft/60 via-background to-background">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-primary/10">
        <div className="mx-auto max-w-3xl flex items-center gap-3 px-3 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/chat" })}
            className="rounded-full bg-background shadow-sm hover:bg-primary-soft"
          >
            <ArrowLeft className="size-5" />
          </Button>

          <div className="relative shrink-0">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-primary to-accent opacity-70 blur-[2px]" />
            <Avatar className="relative size-11 ring-2 ring-background">
              {p?.avatar_url ? <AvatarImage src={p.avatar_url} /> : null}
              <AvatarFallback className="bg-primary/15 text-primary font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <span className="absolute bottom-0 right-0 size-3 rounded-full bg-success ring-2 ring-background" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-base font-bold truncate">{p?.username ?? "User"}</p>
              {p?.gender && <Badge variant="secondary" className="capitalize text-[10px]">{p.gender}</Badge>}
            </div>
            <p className="text-xs text-success font-medium">Online</p>
          </div>

          <CoinBadge value={coinBal} />
          {otherUserId && <ReportDialog targetUserId={otherUserId} conversationId={conversationId} />}
        </div>

        {/* Follow / meta row */}
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-2 px-3 pb-2">
          <p className="text-[11px] text-muted-foreground truncate">
            {freeSec > 0 ? `${Math.floor(freeSec/60)}m free · ` : ""}
            {CHAT_COINS_PER_MINUTE} coins/min{messageCost > 0 ? ` · ${messageCost} coin/msg` : " · msgs free"}
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
              <Button size="sm" variant="secondary" onClick={doUnfollow} className="rounded-full">
                <UserCheck className="size-3.5 mr-1" /> Following
              </Button>
            ) : partner?.outgoing === "pending" ? (
              <Button size="sm" variant="ghost" onClick={doUnfollow} className="rounded-full">
                <UserX className="size-3.5 mr-1" /> Cancel request
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={doFollow} className="rounded-full border-primary/30 text-primary hover:bg-primary-soft">
                <UserPlus className="size-3.5 mr-1" /> Follow
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 mx-auto w-full max-w-3xl">
        {/* Free 5-min call promo banner */}
        {freeSec > 0 && otherUserId && (
          <Link
            to="/call/$kind/$userId"
            params={{ kind: "audio", userId: otherUserId }}
            className="group mb-5 block rounded-2xl bg-gradient-to-r from-primary-soft to-accent-soft border border-primary/20 p-3 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <Phone className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">🎉 Free {Math.floor(freeSec/60)} min call mila!</p>
                <p className="text-[11px] text-muted-foreground truncate">Abhi call karo aur connection badhao.</p>
              </div>
              <span className="rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-xs font-semibold px-4 py-2 shadow-[0_6px_18px_-8px_var(--primary)] group-hover:scale-[1.03] transition-transform">
                Call Now
              </span>
            </div>
          </Link>
        )}

        {(() => {
          let lastDay: string | null = null;
          return messages.map((m) => {
            const mine = m.sender_id === myId;
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            const senderInitial = mine
              ? (me?.profile?.username ?? "M").slice(0, 1).toUpperCase()
              : initials.slice(0, 1);
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="flex justify-center my-4">
                    <span className="text-[11px] font-medium text-muted-foreground bg-background/70 backdrop-blur border border-border rounded-full px-3 py-1">
                      {day}
                    </span>
                  </div>
                )}
                <div className={`flex items-end gap-2 mb-2 ${mine ? "justify-end" : "justify-start"}`}>
                  {!mine && (
                    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">
                      {senderInitial}
                    </div>
                  )}
                  <div
                    className={
                      "max-w-[75%] px-4 py-2.5 text-sm leading-relaxed shadow-sm " +
                      (mine
                        ? "bg-gradient-to-br from-primary-soft to-accent-soft text-foreground rounded-2xl rounded-br-md"
                        : "bg-background text-foreground rounded-2xl rounded-bl-md border border-border/60")
                    }
                  >
                    {m.is_deleted ? <em className="opacity-60">message deleted</em> : m.body}
                    <div className={`mt-1 text-[10px] ${mine ? "text-muted-foreground text-right" : "text-muted-foreground"}`}>
                      {timeLabel(m.created_at)}
                    </div>
                  </div>
                  {mine && (
                    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground text-xs font-bold">
                      {senderInitial}
                    </div>
                  )}
                </div>
              </div>
            );
          });
        })()}

        {sessionEnded && (
          <div className="mx-auto max-w-xs rounded-2xl bg-background border border-primary/20 p-4 text-center mt-6 shadow-md">
            <Sparkles className="mx-auto size-5 text-primary" />
            <p className="mt-2 text-sm font-medium">Chat session ended.</p>
            <Link to="/recharge">
              <Button size="sm" className="mt-2 bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-full">
                Recharge coins
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Composer */}
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
            ? "Waiting for them to accept your friend request before you can message."
            : blockReason === "INCOMING_PENDING"
              ? "Accept their friend request above to start messaging."
              : blockReason === "NOT_FRIENDS"
                ? "Send a friend request and wait for them to accept before messaging."
                : null;
        const disabled = sessionEnded || !!blockReason;
        const placeholder = sessionEnded
          ? "Recharge to continue"
          : blockReason
            ? "Send a request to start messaging"
            : "Message likho...";
        return (
          <div className="sticky bottom-0 backdrop-blur-xl bg-background/80 border-t border-primary/10">
            {reasonText && (
              <div className="mx-auto max-w-3xl px-3 pt-2">
                <div className="rounded-xl border border-warning/40 bg-warning/10 text-warning-foreground text-[11px] px-3 py-2 flex items-center justify-between gap-2">
                  <span className="truncate">{reasonText}</span>
                  {blockReason === "NOT_FRIENDS" && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] rounded-full" onClick={doFollow}>
                      <UserPlus className="size-3 mr-1" /> Send request
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="mx-auto max-w-3xl flex items-center gap-2 p-3">
              <div className="flex-1 flex items-center gap-2 rounded-full bg-background border border-border pl-2 pr-1 py-1 shadow-sm focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_var(--primary-soft)] transition">
                <button type="button" className="grid size-9 place-items-center rounded-full text-primary hover:bg-primary-soft" aria-label="Emoji">
                  <Smile className="size-5" />
                </button>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder={placeholder}
                  disabled={disabled}
                  className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-1 text-base"
                />
              </div>
              <button
                onClick={send}
                disabled={disabled || !text.trim()}
                aria-label="Send"
                className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-[0_10px_24px_-10px_var(--primary)] hover:scale-[1.04] active:scale-95 transition disabled:opacity-50 disabled:hover:scale-100"
              >
                <Send className="size-5" />
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

