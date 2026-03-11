-- ============================================================
-- 6. Matching RPC: try_match() - pair current user from queue
-- ============================================================

CREATE OR REPLACE FUNCTION public.try_match()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.match_queue;
  v_candidate record;
  v_match_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- My queue row (lock it)
  SELECT * INTO v_me
  FROM public.match_queue
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_in_queue');
  END IF;

  -- Find first candidate that satisfies MY conditions.
  -- (단방향 조건만 적용: 상대가 내 조건에 맞는지만 본다.)
  SELECT q.*, p.*
  INTO v_candidate
  FROM public.match_queue q
  JOIN public.profiles p ON p.id = q.user_id
  WHERE q.user_id <> v_me.user_id
    AND (
      v_me.gender_preference = 'all'
      OR (v_me.gender_preference = 'male' AND p.gender = 'male')
      OR (v_me.gender_preference = 'female' AND p.gender = 'female')
    )
    AND p.age BETWEEN v_me.age_min AND v_me.age_max
    AND (v_me.mbti_preference = 'ALL' OR p.mbti = v_me.mbti_preference)
  ORDER BY q.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_candidate');
  END IF;

  INSERT INTO public.matches (user_a_id, user_b_id, status, expires_at)
  VALUES (v_me.user_id, v_candidate.user_id, 'active', now() + interval '10 minutes')
  RETURNING id INTO v_match_id;

  DELETE FROM public.match_queue WHERE user_id IN (v_me.user_id, v_candidate.user_id);

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id);
END;
$$;

COMMENT ON FUNCTION public.try_match() IS 'Tries to match current user from match_queue and creates an active match if a candidate exists.';

