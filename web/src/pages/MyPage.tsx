import { Avatar, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import type { Profile } from '../types'

const AVATAR_BUCKET = 'avatars'

export const MyPage = () => {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [nickname, setNickname] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
      if (data) {
        const p = data as Profile
        setProfile(p)
        setNickname(p.nickname)
      }
    }
    load()
  }, [user])

  const handleSave = async () => {
    if (!user || !nickname.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from('profiles')
      .update({ nickname })
      .eq('id', user.id)
      .select('*')
      .maybeSingle()
    setSaving(false)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('update profile error', error)
      return
    }
    if (data) {
      setProfile(data as Profile)
    }
  }

  const handlePickAvatar = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const filePath = `${user.id}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(filePath, file)
      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath)
      const avatarUrl = publicUrlData.publicUrl

      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', user.id)
        .select('*')
        .maybeSingle()
      if (updateError) throw updateError
      if (data) {
        setProfile(data as Profile)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('avatar upload error', err)
    } finally {
      setUploading(false)
      // reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography variant="h6" fontWeight={600}>
            마이 페이지
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ width: 64, height: 64 }} src={profile?.avatar_url ?? undefined}>
              {profile?.nickname?.[0] ?? 'M'}
            </Avatar>
            <Button variant="outlined" size="small" onClick={handlePickAvatar} disabled={uploading}>
              프로필 사진 변경
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
          </Box>
          <TextField
            label="닉네임"
            fullWidth
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <Button variant="contained" onClick={handleSave} disabled={saving || !nickname.trim()}>
            저장
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}

