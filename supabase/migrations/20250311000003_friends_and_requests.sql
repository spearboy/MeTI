-- ============================================================
-- 3. Friend requests and friends (with token deduction RPC)
-- ============================================================

-- Friend requests: one row per (from, to) pair
CREATE TABLE public.friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_requests_different_users CHECK (from_user_id <> to_user_id),
  CONSTRAINT friend_requests_unique_pair UNIQUE (from_user_id, to_user_id)
);

CREATE INDEX idx_friend_requests_from ON public.friend_requests(from_user_id);
CREATE INDEX idx_friend_requests_to ON public.friend_requests(to_user_id);
CREATE INDEX idx_friend_requests_status ON public.friend_requests(status);

CREATE TRIGGER friend_requests_updated_at
  BEFORE UPDATE ON public.friend_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY friend_requests_select_involved ON public.friend_requests
  FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY friend_requests_insert_own ON public.friend_requests
  FOR INSERT WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY friend_requests_update_receiver ON public.friend_requests
  FOR UPDATE USING (auth.uid() = to_user_id);

-- Friends: symmetric relationship; store canonical order (user_a_id < user_b_id) for uniqueness
CREATE TABLE public.friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friends_different_users CHECK (user_a_id <> user_b_id),
  CONSTRAINT friends_canonical_order CHECK (user_a_id < user_b_id),
  CONSTRAINT friends_unique_pair UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX idx_friends_user_a ON public.friends(user_a_id);
CREATE INDEX idx_friends_user_b ON public.friends(user_b_id);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY friends_select_own ON public.friends
  FOR SELECT USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- INSERT only via RPC (when request is accepted)
CREATE POLICY friends_insert_own ON public.friends
  FOR INSERT WITH CHECK (
    auth.uid() = user_a_id OR auth.uid() = user_b_id
  );

-- ============================================================
-- RPC: request_friend(target_user_id) — deduct 5 tokens and create request
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_friend(p_to_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_id uuid := auth.uid();
  v_balance int;
  v_existing public.friend_requests;
BEGIN
  IF v_from_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_to_user_id = v_from_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_request_self');
  END IF;

  SELECT token_balance INTO v_balance FROM public.profiles WHERE id = v_from_id;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;
  IF v_balance < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_tokens', 'required', 5);
  END IF;

  SELECT * INTO v_existing FROM public.friend_requests
  WHERE from_user_id = v_from_id AND to_user_id = p_to_user_id;
  IF FOUND THEN
    IF v_existing.status = 'pending' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'request_already_pending');
    END IF;
    IF v_existing.status = 'rejected' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'request_previously_rejected');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'already_friends_or_pending');
  END IF;

  -- Check if already friends
  IF EXISTS (
    SELECT 1 FROM public.friends f
    WHERE (f.user_a_id = v_from_id AND f.user_b_id = p_to_user_id)
       OR (f.user_a_id = p_to_user_id AND f.user_b_id = v_from_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_friends');
  END IF;

  UPDATE public.profiles SET token_balance = token_balance - 5 WHERE id = v_from_id;
  INSERT INTO public.friend_requests (from_user_id, to_user_id, status)
  VALUES (v_from_id, p_to_user_id, 'pending');

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.request_friend(uuid) IS 'Deducts 5 tokens from caller and creates a pending friend request. Returns { ok, error?, required? }.';

-- ============================================================
-- RPC: respond_friend_request(request_id, accept boolean)
-- ============================================================
CREATE OR REPLACE FUNCTION public.respond_friend_request(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_req public.friend_requests;
  v_a uuid;
  v_b uuid;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_req FROM public.friend_requests WHERE id = p_request_id AND to_user_id = v_me;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found_or_not_receiver');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_already_responded');
  END IF;

  IF p_accept THEN
    v_a := LEAST(v_req.from_user_id, v_req.to_user_id);
    v_b := GREATEST(v_req.from_user_id, v_req.to_user_id);
    INSERT INTO public.friends (user_a_id, user_b_id) VALUES (v_a, v_b)
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING;
    UPDATE public.friend_requests SET status = 'accepted', updated_at = now() WHERE id = p_request_id;
  ELSE
    UPDATE public.friend_requests SET status = 'rejected', updated_at = now() WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'accepted', p_accept);
END;
$$;

COMMENT ON FUNCTION public.respond_friend_request(uuid, boolean) IS 'Receiver accepts or rejects a friend request. On accept, inserts into friends.';
