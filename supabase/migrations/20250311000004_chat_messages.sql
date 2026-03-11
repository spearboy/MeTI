-- ============================================================
-- 4. Chat messages: match (10-min session) and friend (1:1)
-- ============================================================

-- Match chat: messages within an active/ended match
CREATE TABLE public.match_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_messages_match_created ON public.match_messages(match_id, created_at ASC);

ALTER TABLE public.match_messages ENABLE ROW LEVEL SECURITY;

-- Participants of the match can read; only participants can insert
CREATE POLICY match_messages_select_participant ON public.match_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_messages.match_id
        AND (m.user_a_id = auth.uid() OR m.user_b_id = auth.uid())
    )
  );

CREATE POLICY match_messages_insert_participant ON public.match_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_id AND (m.user_a_id = auth.uid() OR m.user_b_id = auth.uid())
    )
  );

-- Friend chat: messages in a friend room (friends.id = room_id)
CREATE TABLE public.friend_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.friends(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_friend_messages_room_created ON public.friend_messages(room_id, created_at ASC);

ALTER TABLE public.friend_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY friend_messages_select_member ON public.friend_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.id = friend_messages.room_id
        AND (f.user_a_id = auth.uid() OR f.user_b_id = auth.uid())
    )
  );

CREATE POLICY friend_messages_insert_member ON public.friend_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.friends f
      WHERE f.id = room_id AND (f.user_a_id = auth.uid() OR f.user_b_id = auth.uid())
    )
  );

COMMENT ON TABLE public.match_messages IS 'Messages in a single random match (10-min session).';
COMMENT ON TABLE public.friend_messages IS 'Messages in a 1:1 friend chat room.';
