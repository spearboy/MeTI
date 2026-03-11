-- ============================================================
-- 1. Profiles table (user profile + token balance)
-- Links to auth.users via id. Email is used as login (Supabase Auth).
-- ============================================================

-- Enable UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles: one row per auth user
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text NOT NULL UNIQUE,
  mbti text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male', 'female', 'none')),
  age int NOT NULL CHECK (age >= 20 AND age <= 80),
  avatar_url text,
  token_balance int NOT NULL DEFAULT 0 CHECK (token_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for lookups by nickname (login/display)
CREATE INDEX idx_profiles_nickname ON public.profiles(nickname);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read and update only their own profile
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Insert is allowed only for the same user (used by signup trigger)
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Optional: trigger to create profile on signup (insert into profiles from auth.users)
-- Requires a server-side trigger or Edge Function; for manual/API signup flow,
-- the app can insert after auth.signUp(). Document in API section.

COMMENT ON TABLE public.profiles IS 'User profile and token balance. id = auth.users.id.';
