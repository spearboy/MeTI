export type Profile = {
  id: string
  nickname: string
  mbti: string
  gender: 'male' | 'female' | 'none'
  age: number
  avatar_url: string | null
  token_balance: number
}

export type Match = {
  id: string
  user_a_id: string
  user_b_id: string
  created_at: string
  expires_at: string | null
  status: 'waiting' | 'active' | 'ended' | 'cancelled'
  ended_reason: string | null
}

export type Friend = {
  id: string
  user_a_id: string
  user_b_id: string
  created_at: string
}

export type FriendRequest = {
  id: string
  from_user_id: string
  to_user_id: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  updated_at: string
}

export type MatchMessage = {
  id: string
  match_id: string
  sender_id: string
  message: string
  created_at: string
}

export type FriendMessage = {
  id: string
  room_id: string
  sender_id: string
  message: string
  created_at: string
}

