import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export const AuthPage = () => {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [mbti, setMbti] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | 'none'>('none')
  const [age, setAge] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true })
    }
  }, [user, navigate])

  const handleSubmit = async () => {
    setError(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
        navigate('/', { replace: true })
      } else {
        if (!nickname || !mbti || !age) {
          throw new Error('닉네임, MBTI, 나이를 모두 입력해주세요.')
        }
        const numericAge = Number(age)
        if (Number.isNaN(numericAge) || numericAge < 20 || numericAge > 80) {
          throw new Error('나이는 20~80 사이의 숫자로 입력해주세요.')
        }

        const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) throw signUpError

        const newUser = data.user
        const session = data.session
        // 이메일 확인이 비활성화된 경우에만 바로 프로필 생성
        if (newUser && session) {
          const { error: profileError } = await supabase.from('profiles').insert({
            id: newUser.id,
            nickname,
            mbti,
            gender,
            age: numericAge,
          })
          if (profileError) throw profileError
          navigate('/', { replace: true })
        } else {
          // 이메일 확인이 필요한 프로젝트인 경우
          throw new Error('회원가입이 완료되었습니다. 이메일을 확인한 후 다시 로그인해주세요.')
        }
      }
    } catch (e: any) {
      setError(e.message ?? '인증 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Card sx={{ width: 400 }}>
        <CardContent>
          <Typography variant="h5" mb={2} fontWeight={700}>
            MeTI
          </Typography>
          <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mb: 2 }} aria-label="auth-mode-tabs">
            <Tab label="로그인" value="login" />
            <Tab label="회원가입" value="signup" />
          </Tabs>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="이메일"
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="비밀번호"
              type="password"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'signup' && (
              <>
                <TextField
                  label="닉네임"
                  fullWidth
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
                <TextField
                  label="MBTI (예: INTP)"
                  fullWidth
                  value={mbti}
                  onChange={(e) => setMbti(e.target.value.toUpperCase())}
                />
                <TextField
                  label="나이"
                  type="number"
                  fullWidth
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
                <TextField
                  select
                  label="성별"
                  fullWidth
                  value={gender}
                  onChange={(e) => setGender(e.target.value as 'male' | 'female' | 'none')}
                >
                  <MenuItem value="none">선택 안 함</MenuItem>
                  <MenuItem value="male">남자</MenuItem>
                  <MenuItem value="female">여자</MenuItem>
                </TextField>
              </>
            )}
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={handleSubmit}
              disabled={loading}
            >
              {mode === 'login' ? '로그인' : '회원가입'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}

