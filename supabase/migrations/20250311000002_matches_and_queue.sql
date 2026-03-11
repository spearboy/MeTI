-- ============================================================
-- 2. Matches (history + active) and match_queue (waiting pool)
-- ============================================================

-- Matches: each row = one random match (past or current)
CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'ended', 'cancelled')),
  ended_reason text,
  CONSTRAINT matches_different_users CHECK (user_a_id <> user_b_id)
);

-- Indexes for "my matches" list and ordering
CREATE INDEX idx_matches_user_a_created ON public.matches(user_a_id, created_at DESC);
CREATE INDEX idx_matches_user_b_created ON public.matches(user_b_id, created_at DESC);
CREATE INDEX idx_matches_status ON public.matches(status) WHERE status IN ('waiting', 'active');

-- RLS: users can see only matches they are part of
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY matches_select_own ON public.matches
  FOR SELECT USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- INSERT: only backend/service or SECURITY DEFINER function (matching engine)
-- No client INSERT policy; matching is done server-side.

CREATE POLICY matches_update_own ON public.matches
  FOR UPDATE USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- Match queue: one row per user waiting to be matched (conditions stored here)
CREATE TABLE public.match_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  gender_preference text NOT NULL CHECK (gender_preference IN ('male', 'female', 'all')),
  age_min int NOT NULL CHECK (age_min >= 20 AND age_min <= 80),
  age_max int NOT NULL CHECK (age_max >= 20 AND age_max <= 80),
  mbti_preference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_queue_age_range CHECK (age_min <= age_max)
);

CREATE INDEX idx_match_queue_created ON public.match_queue(created_at);

-- RLS: users see and manage only their own queue row
ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_queue_select_own ON public.match_queue
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY match_queue_insert_own ON public.match_queue
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY match_queue_delete_own ON public.match_queue
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY match_queue_update_own ON public.match_queue
  FOR UPDATE USING (auth.uid() = user_id);

COMMENT ON TABLE public.matches IS 'Random match history and active sessions. status: waiting→active→ended|cancelled.';
COMMENT ON TABLE public.match_queue IS 'Users currently waiting to be matched; one row per user with conditions.';
