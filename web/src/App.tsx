import { Box, CircularProgress, Container } from '@mui/material'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { AuthPage } from './pages/AuthPage'
import { MainPage } from './pages/MainPage'
import { MatchPage } from './pages/MatchPage'
import { MyPage } from './pages/MyPage'
import { useAuth } from './context/AuthContext'

const RequireAuth = ({ children }: { children: React.ReactElement }) => {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  return children
}

function App() {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppLayout>
                <MainPage />
              </AppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/match"
          element={
            <RequireAuth>
              <AppLayout>
                <MatchPage />
              </AppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/me"
          element={
            <RequireAuth>
              <AppLayout>
                <MyPage />
              </AppLayout>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Container>
  )
}

export default App
