import { useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import Login from './components/Login'
import BartenderBoard from './components/BartenderBoard'
import AdminPanel from './components/AdminPanel'
import ManagerPanel from './components/ManagerPanel'
import Header from './components/Header'

const DEFAULT_SERVER_URL = 'https://easyorder-19ze.onrender.com'

function getAppModeFromLocation() {
  try {
    const mode = new URLSearchParams(window.location.search).get('appMode')
    return String(mode || '').toLowerCase() === 'admin' ? 'admin' : 'staff'
  } catch {
    return 'staff'
  }
}

function normalizeServerUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return DEFAULT_SERVER_URL
  if (/^https?:\/\//i.test(raw)) return raw
  return `http://${raw}`
}

function shouldFallbackToCloud(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(String(url || ''))
}

export default function App() {
  const appMode = getAppModeFromLocation()
  const [user, setUser] = useState(null)
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [authReady, setAuthReady] = useState(appMode !== 'staff')
  const [serverUrl, setServerUrl] = useState(() => {
    try {
      const normalized = normalizeServerUrl(localStorage.getItem('serverUrl') || DEFAULT_SERVER_URL)
      return shouldFallbackToCloud(normalized) ? DEFAULT_SERVER_URL : normalized
    } catch {
      return DEFAULT_SERVER_URL
    }
  })
  const [serverInfo, setServerInfo] = useState({ ip: 'loading...', port: 3001 })
  const [assignedRestaurant, setAssignedRestaurant] = useState(null)

  useEffect(() => {
    if (appMode !== 'staff') return
    let cancelled = false

    fetch(`${serverUrl}/api/auth/device-binding?appMode=${appMode}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed')
        return await r.json()
      })
      .then((data) => {
        if (cancelled) return
        if (data?.locked && data?.user) {
          setUser(data.user)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [appMode, serverUrl])

  useEffect(() => {
    fetch(`${serverUrl}/api/server-info`)
      .then(r => r.json())
      .then(setServerInfo)
      .catch(() => setServerInfo({ ip: 'unreachable', port: 3001 }))
  }, [serverUrl])

  useEffect(() => {
    if (!user?.restaurantId) {
      setAssignedRestaurant(null)
      return
    }

    fetch(`${serverUrl}/api/restaurants`)
      .then(r => r.json())
      .then((restaurants) => {
        const match = restaurants.find(r => r.id === user.restaurantId) || null
        setAssignedRestaurant(match)
      })
      .catch(() => setAssignedRestaurant(null))
  }, [serverUrl, user?.restaurantId])

  useEffect(() => {
    const s = io(serverUrl, { autoConnect: false })
    s.connect()
    setSocket(s)
    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => setConnected(false))
    return () => {
      s.off('connect')
      s.off('disconnect')
      s.disconnect()
    }
  }, [serverUrl])

  const handleServerUrlChange = useCallback((nextValue) => {
    const normalized = normalizeServerUrl(nextValue)
    setServerUrl(normalized)
    try { localStorage.setItem('serverUrl', normalized) } catch {}
  }, [])

  const handleLogin  = useCallback((userData) => setUser(userData), [])
  const handleLogout = useCallback(() => {
    if (appMode === 'staff') return
    setUser(null)
  }, [appMode])

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-stone-500 text-sm">Loading terminal session...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <Login
        onLogin={handleLogin}
        serverUrl={serverUrl}
        onServerUrlChange={handleServerUrlChange}
        appMode={appMode}
      />
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        user={user}
        onLogout={handleLogout}
        connected={connected}
        serverInfo={serverInfo}
        restaurant={assignedRestaurant}
        appMode={appMode}
      />
      <main className="flex-1 overflow-auto">
        {user.role === 'bartender' && <BartenderBoard socket={socket} serverUrl={serverUrl} user={user} />}
        {user.role === 'admin'     && <AdminPanel     socket={socket} serverUrl={serverUrl} serverInfo={serverInfo} user={user} />}
        {user.role === 'manager'   && <ManagerPanel   socket={socket} serverUrl={serverUrl} user={user} />}
      </main>
    </div>
  )
}
