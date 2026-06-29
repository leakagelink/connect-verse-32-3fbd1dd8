-- Enforce: at most one 'accepted' call_invite per callee at any time.
-- When a call ends, the accepted invite is flipped to 'cancelled' (see calls.functions.ts),
-- so this partial-unique index never blocks normal flows — only the concurrent-accept race.
CREATE UNIQUE INDEX IF NOT EXISTS call_invites_one_accepted_per_callee
  ON public.call_invites (callee_id)
  WHERE status = 'accepted';