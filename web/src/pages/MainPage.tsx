import {
  Avatar,
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import ChatIcon from '@mui/icons-material/Chat'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { Friend, FriendMessage, FriendRequest, Match, Profile } from '../types'

type MatchListItem = {
  opponent: Profile
  latestMatch: Match
  requestStatus?: FriendRequest['status']
}

type FriendWithProfile = {
  friendRow: Friend
  profile: Profile
}

export const MainPage = () => {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [matchItems, setMatchItems] = useState<MatchListItem[]>([])
  const [friends, setFriends] = useState<FriendWithProfile[]>([])

  const [activeFriend, setActiveFriend] = useState<FriendWithProfile | null>(null)
  const [messages, setMessages] = useState<FriendMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  const myId = user?.id ?? ''

  const currentRoomId = useMemo(() => activeFriend?.friendRow.id ?? null, [activeFriend])

  useEffect(() => {
    if (!myId) return

    const load = async () => {
      setLoading(true)

      // 1) 내 친구 관계
      const { data: friendRows } = await supabase
        .from('friends')
        .select('*')
        .or(`user_a_id.eq.${myId},user_b_id.eq.${myId}`)
      const typedFriends = (friendRows ?? []) as Friend[]

      const friendIds = typedFriends.map((f) => (f.user_a_id === myId ? f.user_b_id : f.user_a_id))

      // 2) 나와 관련된 매칭
      const { data: matchRows } = await supabase
        .from('matches')
        .select('*')
        .or(`user_a_id.eq.${myId},user_b_id.eq.${myId}`)
        .order('created_at', { ascending: false })
      const matches = (matchRows ?? []) as Match[]

      const opponentIds = Array.from(
        new Set(
          matches
            .map((m) => (m.user_a_id === myId ? m.user_b_id : m.user_a_id))
            .filter((id) => !friendIds.includes(id)),
        ),
      )

      const allProfileIds = Array.from(new Set([...friendIds, ...opponentIds]))
      let profiles: Profile[] = []
      if (allProfileIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('*')
          .in('id', allProfileIds)
        profiles = (profileRows ?? []) as Profile[]
      }

      const { data: requestRows } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`from_user_id.eq.${myId},to_user_id.eq.${myId}`)
      const reqs = (requestRows ?? []) as FriendRequest[]

      // 친구 목록 가공
      const friendItems: FriendWithProfile[] = typedFriends
        .map((f) => {
          const otherId = f.user_a_id === myId ? f.user_b_id : f.user_a_id
          const profile = profiles.find((p) => p.id === otherId)
          if (!profile) return null
          return { friendRow: f, profile }
        })
        .filter(Boolean) as FriendWithProfile[]
      setFriends(friendItems)

      // 매칭 목록 가공 (비친구만)
      const matchMap = new Map<string, Match>()
      matches.forEach((m) => {
        const oppId = m.user_a_id === myId ? m.user_b_id : m.user_a_id
        if (friendIds.includes(oppId)) return
        if (!matchMap.has(oppId)) {
          matchMap.set(oppId, m)
        }
      })

      const matchItemsBuilt: MatchListItem[] = opponentIds
        .map((oid) => {
          const opponent = profiles.find((p) => p.id === oid)
          const latestMatch = matchMap.get(oid)
          if (!opponent || !latestMatch) return null

          const myReq = reqs.find((r) => r.from_user_id === myId && r.to_user_id === oid)
          return {
            opponent,
            latestMatch,
            requestStatus: myReq?.status,
          }
        })
        .filter(Boolean) as MatchListItem[]

      setMatchItems(matchItemsBuilt)
      setLoading(false)
    }

    load()

    // Realtime: friends, friend_requests, matches 변경 시 재로딩
    const channel = supabase
      .channel('main-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friends' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => load(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [myId])

  useEffect(() => {
    if (!currentRoomId) {
      setMessages([])
      return
    }

    const loadChat = async () => {
      const { data } = await supabase
        .from('friend_messages')
        .select('*')
        .eq('room_id', currentRoomId)
        .order('created_at', { ascending: true })
      setMessages((data ?? []) as FriendMessage[])
    }

    loadChat()

    const channel = supabase
      .channel(`friend-chat-${currentRoomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'friend_messages', filter: `room_id=eq.${currentRoomId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as FriendMessage])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentRoomId])

  const handleSendRequest = async (opponentId: string) => {
    if (!myId) return
    const { data, error } = await supabase.rpc('request_friend', { p_to_user_id: opponentId })
    if (error || !data?.ok) {
      // 최소한 콘솔에만 출력
      // eslint-disable-next-line no-console
      console.error('request_friend error', error ?? data)
    }
  }

  const handleSendMessage = async () => {
    if (!currentRoomId || !myId || !newMessage.trim()) return
    setChatLoading(true)
    const text = newMessage.trim()
    setNewMessage('')
    const { error } = await supabase.from('friend_messages').insert({
      room_id: currentRoomId,
      sender_id: myId,
      message: text,
    })
    setChatLoading(false)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('send friend message error', error)
    }
  }

  const getRequestLabel = (status?: FriendRequest['status']) => {
    if (!status) return '친구 요청 (5토큰)'
    if (status === 'pending') return '요청 대기 중'
    if (status === 'rejected') return '요청 거절됨'
    return '친구 요청 (5토큰)'
  }

  const isRequestDisabled = (status?: FriendRequest['status']) => {
    if (!status) return false
    if (status === 'pending') return true
    if (status === 'rejected') return true // 영구 비활성화
    return false
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        gap: 2,
      }}
    >
      <Box sx={{ flex: 1 }}>
        <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h6" fontWeight={600}>
            매칭 목록
          </Typography>
          {loading && (
            <Typography variant="body2" color="text.secondary">
              불러오는 중...
            </Typography>
          )}
          {!loading && matchItems.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              아직 매칭 이력이 없습니다.
            </Typography>
          )}
          <List dense>
            {matchItems.map((item) => (
              <ListItem
                key={item.opponent.id}
                secondaryAction={
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isRequestDisabled(item.requestStatus)}
                    onClick={() => handleSendRequest(item.opponent.id)}
                  >
                    {getRequestLabel(item.requestStatus)}
                  </Button>
                }
              >
                <ListItemAvatar>
                  <Avatar src={item.opponent.avatar_url ?? undefined}>
                    {item.opponent.nickname?.[0] ?? '?'}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={item.opponent.nickname}
                  secondary={`${item.opponent.mbti} · ${item.opponent.age}세`}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h6" fontWeight={600}>
            친구 목록
          </Typography>
          {!loading && friends.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              아직 친구가 없습니다. 매칭을 통해 친구를 만들어 보세요.
            </Typography>
          )}
          <List dense>
            {friends.map((f) => (
              <ListItem
                key={f.friendRow.id}
                secondaryAction={
                  <IconButton edge="end" onClick={() => setActiveFriend(f)}>
                    <ChatIcon />
                  </IconButton>
                }
              >
                <ListItemAvatar>
                  <Avatar src={f.profile.avatar_url ?? undefined}>
                    {f.profile.nickname?.[0] ?? '?'}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={f.profile.nickname}
                  secondary={`${f.profile.mbti} · ${f.profile.age}세`}
                />
              </ListItem>
            ))}
          </List>

          {activeFriend && (
            <Box
              sx={{
                borderTop: 1,
                borderColor: 'divider',
                mt: 1,
                pt: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                height: 260,
              }}
            >
              <Typography variant="subtitle2" fontWeight={600}>
                {activeFriend.profile.nickname} 님과의 채팅
              </Typography>
              <Box
                sx={{
                  flex: 1,
                  overflowY: 'auto',
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'background.default',
                }}
              >
                {messages.map((m) => (
                  <Box
                    key={m.id}
                    sx={{
                      display: 'flex',
                      justifyContent: m.sender_id === myId ? 'flex-end' : 'flex-start',
                      mb: 0.5,
                    }}
                  >
                    <Box
                      sx={{
                        px: 1.2,
                        py: 0.6,
                        borderRadius: 1.5,
                        bgcolor: m.sender_id === myId ? 'primary.main' : 'grey.300',
                        color: m.sender_id === myId ? 'primary.contrastText' : 'text.primary',
                        maxWidth: '80%',
                        fontSize: 13,
                      }}
                    >
                      {m.message}
                    </Box>
                  </Box>
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="메시지를 입력하세요"
                  fullWidth
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                />
                <Button variant="contained" size="small" onClick={handleSendMessage} disabled={chatLoading}>
                  전송
                </Button>
              </Box>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  )
}

