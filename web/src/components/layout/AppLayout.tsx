import { ReactNode } from 'react'
import { AppBar, Avatar, Box, IconButton, Toolbar, Typography } from '@mui/material'
import PeopleAltIcon from '@mui/icons-material/PeopleAlt'
import FavoriteIcon from '@mui/icons-material/Favorite'
import PersonIcon from '@mui/icons-material/Person'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { useEffect, useState } from 'react'
import type { Profile } from '../../types'

type Props = {
  children: ReactNode
}

export const AppLayout = ({ children }: Props) => {
  const location = useLocation()
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setProfile(null)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('id,nickname,avatar_url,token_balance')
        .eq('id', user.id)
        .maybeSingle()
      if (data) {
        setProfile(data as Profile)
      }
    }
    load()
  }, [user])

  const isActive = (path: string) => location.pathname === path

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', gap: 2 }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h6" fontWeight={700}>
              MeTI
            </Typography>
            {profile && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar src={profile.avatar_url ?? undefined} sx={{ width: 32, height: 32 }}>
                  {profile.nickname?.[0] ?? '?'}
                </Avatar>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="body2" fontWeight={600}>
                    {profile.nickname}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    토큰 {profile.token_balance}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton
              component={RouterLink}
              to="/"
              color={isActive('/') ? 'primary' : 'default'}
            >
              <PeopleAltIcon />
            </IconButton>
            <IconButton
              component={RouterLink}
              to="/match"
              color={isActive('/match') ? 'primary' : 'default'}
            >
              <FavoriteIcon />
            </IconButton>
            <IconButton
              component={RouterLink}
              to="/me"
              color={isActive('/me') ? 'primary' : 'default'}
            >
              <PersonIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Box>
  )
}

