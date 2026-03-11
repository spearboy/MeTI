import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Slider,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { Match, MatchMessage, Profile } from '../types'

type State = 'idle' | 'waiting' | 'active'

export const MatchPage = () => {
  const { user } = useAuth()
  const myId = user?.id ?? ''

  const [gender, setGender] = useState<'all' | 'male' | 'female'>('all')
  const [ageRange, setAgeRange] = useState<number[]>([20, 30])
  const [mbti, setMbti] = useState<string>('ALL')

  const [state, setState] = useState<State>('idle')
  const [currentMatch, setCurrentMatch] = useState<Match | null>(null)
  const [opponent, setOpponent] = useState<Profile | null>(null)
  const [messages, setMessages] = useState<MatchMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [timeoutDialogOpen, setTimeoutDialogOpen] = useState(false)

  const matchId = currentMatch?.id ?? null

  useEffect(() => {
    if (!myId) return

    const init = async () => {
      const { data: queue } = await supabase
        .from('match_queue')
        .select('*')
        .eq('user_id', myId)
        .maybeSingle()
      if (queue) {
        setState('waiting')
      }

      const { data: match } = await supabase
        .from('matches')
        .select('*')
        .or(`user_a_id.eq.${myId},user_b_id.eq.${myId}`)
        .in('status', ['waiting', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (match) {
        const m = match as Match
        setCurrentMatch(m)
        setState(m.status === 'active' ? 'active' : 'waiting')
        const opponentId = m.user_a_id === myId ? m.user_b_id : m.user_a_id
        const { data: opp } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', opponentId)
          .maybeSingle()
        if (opp) setOpponent(opp as Profile)
      }
    }

    init()

    const channel = supabase
      .channel('match-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_queue', filter: `user_id=eq.${myId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setState('idle')
          } else if (payload.eventType === 'INSERT') {
            setState('waiting')
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        async (payload) => {
          const m = payload.new as Match
          if (m.user_a_id !== myId && m.user_b_id !== myId) return
          if (m.status === 'active') {
            setCurrentMatch(m)
            setState('active')
            const opponentId = m.user_a_id === myId ? m.user_b_id : m.user_a_id
            const { data: opp } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', opponentId)
              .maybeSingle()
            if (opp) setOpponent(opp as Profile)
          } else if (m.status === 'ended' || m.status === 'cancelled') {
            setCurrentMatch(null)
            setOpponent(null)
            setMessages([])
            setState('idle')
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [myId])

  useEffect(() => {
    if (!matchId) {
      setMessages([])
      setTimeLeft(null)
      return
    }

    const load = async () => {
      const { data } = await supabase
        .from('match_messages')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true })
      setMessages((data ?? []) as MatchMessage[])
    }
    load()

    const channel = supabase
      .channel(`match-chat-${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_messages',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as MatchMessage])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [matchId])

  // 10분 타이머
  useEffect(() => {
    if (!currentMatch || state !== 'active') return
    const createdAt = new Date(currentMatch.created_at).getTime()
    const deadline = createdAt + 10 * 60 * 1000

    const tick = () => {
      const now = Date.now()
      const left = Math.max(0, Math.floor((deadline - now) / 1000))
      setTimeLeft(left)
      if (left === 0) {
        setTimeoutDialogOpen(true)
      }
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [currentMatch, state])

  const formattedTimeLeft = useMemo(() => {
    if (timeLeft === null) return ''
    const m = Math.floor(timeLeft / 60)
    const s = timeLeft % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }, [timeLeft])

  const handleMatch = async () => {
    if (!myId) return
    await supabase.from('match_queue').upsert({
      user_id: myId,
      gender_preference: gender === 'all' ? 'all' : gender,
      age_min: ageRange[0],
      age_max: ageRange[1],
      mbti_preference: mbti,
    })
    setState('waiting')

    // 서버에서 바로 매칭 시도 (상대가 이미 대기 중이면 곧바로 매칭)
    const { data, error } = await supabase.rpc('try_match')
    if (error) {
      // eslint-disable-next-line no-console
      console.error('try_match error', error)
      return
    }
    if (data?.ok && data.match_id) {
      // matches 테이블 Realtime 구독이 이미 있으므로
      // 별도 처리 없이도 active 상태가 반영된다.
    }
  }

  const handleCancel = async () => {
    if (!myId) return
    await supabase.from('match_queue').delete().eq('user_id', myId)
    setState('idle')
  }

  const handleSendMessage = async () => {
    if (!matchId || !myId || !newMessage.trim()) return
    const text = newMessage.trim()
    setNewMessage('')
    await supabase.from('match_messages').insert({
      match_id: matchId,
      sender_id: myId,
      message: text,
    })
  }

  const handleTimeoutConfirm = async () => {
    setTimeoutDialogOpen(false)
    if (currentMatch) {
      await supabase
        .from('matches')
        .update({ status: 'ended', ended_reason: 'timeout' })
        .eq('id', currentMatch.id)
    }
    setCurrentMatch(null)
    setOpponent(null)
    setMessages([])
    setState('idle')
    setTimeLeft(null)
  }

  if (state === 'active' && currentMatch && opponent) {
    return (
      <Box sx={{ maxWidth: 640 }}>
        <Card>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" fontWeight={600}>
                매칭 상대: {opponent.nickname} ({opponent.mbti}, {opponent.age}세)
              </Typography>
              <Typography variant="body2" color="primary">
                남은 시간: {formattedTimeLeft}
              </Typography>
            </Box>
            <Box
              sx={{
                height: 320,
                borderRadius: 2,
                bgcolor: 'background.default',
                p: 2,
                overflowY: 'auto',
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
                fullWidth
                placeholder="메시지를 입력하세요"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
              />
              <Button variant="contained" onClick={handleSendMessage}>
                전송
              </Button>
            </Box>
          </CardContent>
        </Card>

        <Dialog open={timeoutDialogOpen} onClose={handleTimeoutConfirm}>
          <DialogTitle>매칭 시간 종료</DialogTitle>
          <DialogContent>
            <DialogContentText>10분이 지나 매칭이 종료되었습니다.</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleTimeoutConfirm} autoFocus>
              확인
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    )
  }

  if (state === 'waiting') {
    return (
      <Box sx={{ maxWidth: 480 }}>
        <Card>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
            <Typography variant="h6" fontWeight={600}>
              매칭 대기 중...
            </Typography>
            <Typography variant="body2" color="text.secondary">
              조건에 맞는 상대를 찾는 중입니다.
            </Typography>
            <Button variant="outlined" onClick={handleCancel}>
              취소
            </Button>
          </CardContent>
        </Card>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={600} mb={2}>
            매칭 조건 설정
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              select
              label="성별"
              value={gender}
              onChange={(e) => setGender(e.target.value as 'all' | 'male' | 'female')}
            >
              <MenuItem value="all">전체</MenuItem>
              <MenuItem value="male">남자</MenuItem>
              <MenuItem value="female">여자</MenuItem>
            </TextField>

            <Box>
              <Typography variant="body2" gutterBottom>
                나이 범위: {ageRange[0]} ~ {ageRange[1]}세
              </Typography>
              <Slider
                value={ageRange}
                onChange={(_, v) => setAgeRange(v as number[])}
                valueLabelDisplay="auto"
                min={20}
                max={80}
              />
            </Box>

            <TextField
              select
              label="MBTI"
              value={mbti}
              onChange={(e) => setMbti(e.target.value)}
            >
              <MenuItem value="ALL">전체</MenuItem>
              {[
                'INTJ',
                'INTP',
                'INFJ',
                'INFP',
                'ISTJ',
                'ISTP',
                'ISFJ',
                'ISFP',
                'ENTJ',
                'ENTP',
                'ENFJ',
                'ENFP',
                'ESTJ',
                'ESTP',
                'ESFJ',
                'ESFP',
              ].map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>

            <Button variant="contained" size="large" fullWidth onClick={handleMatch}>
              매칭하기
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}

