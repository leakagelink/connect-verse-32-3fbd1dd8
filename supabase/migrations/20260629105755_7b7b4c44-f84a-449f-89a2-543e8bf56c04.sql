-- Fix 1: moderation_events — remove self-read policy (subjects can see evidence/reporter)
DROP POLICY IF EXISTS "Users read their own moderation events" ON public.moderation_events;

-- Fix 2: follows — restrict UPDATE so only the target (following_id) can change status
DROP POLICY IF EXISTS "Follow participants can update" ON public.follows;
DROP POLICY IF EXISTS "Users can update follows they are part of" ON public.follows;
DROP POLICY IF EXISTS "follows_update" ON public.follows;

CREATE POLICY "Target can update follow status"
ON public.follows
FOR UPDATE
TO authenticated
USING (auth.uid() = following_id)
WITH CHECK (auth.uid() = following_id);

-- Fix 3: perf_events — disallow NULL user_id inserts from clients
DROP POLICY IF EXISTS "Users can insert their own perf events" ON public.perf_events;
DROP POLICY IF EXISTS "perf_events_insert" ON public.perf_events;
DROP POLICY IF EXISTS "Authenticated can insert perf events" ON public.perf_events;

CREATE POLICY "Users insert their own perf events"
ON public.perf_events
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());