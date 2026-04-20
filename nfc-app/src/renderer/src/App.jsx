import { useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import Login from './components/Login'
import BartenderBoard from './components/BartenderBoard'
import AdminPanel from './components/AdminPanel'
import ManagerPanel from './components/ManagerPanel'
import Header from './components/Header'

const DEFAULT_SERVER_URL = 'http://localhost:3001'
const STAFF_SESSION_KEY = 'staffSessionUser'

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

export default function App() {
  const appMode = getAppModeFromLocation()
  const [user, setUser] = useState(null)
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [authReady, setAuthReady] = useState(appMode !== 'staff')
  const [serverUrl, setServerUrl] = useState(() => {
    try {
      return normalizeServerUrl(localStorage.getItem('serverUrl') || DEFAULT_SERVER_URL)
    } catch {
      return DEFAULT_SERVER_URL
    }
  })
  const [serverInfo, setServerInfo] = useState({ ip: 'loading...', port: 3001 })
  const [assignedRestaurant, setAssignedRestaurant] = useState(null)

  useEffect(() => {
    if (appMode !== 'staff') return
    let cancelled = false
    let retryTimer = null
    let attempt = 0
    const MAX_ATTEMPTS = 8

    let cachedUser = null
    try {
      cachedUser = JSON.parse(localStorage.getItem(STAFF_SESSION_KEY) || 'null')
    } catch {
      cachedUser = null
    }

    if (cachedUser?.id && cachedUser?.role) {
      setUser(cachedUser)
      setAuthReady(true)
    }

    const tryBootstrapBinding = () => {
      attempt += 1

      fetch(`${serverUrl}/api/auth/device-binding?appMode=${appMode}`)
        .then(async (r) => {
          if (!r.ok) {
            if (r.status >= 400 && r.status < 500) {
              return { unsupported: true, status: r.status }
            }
            throw new Error('Retryable')
          }
          return await r.json()
        })
        .then((data) => {
          if (cancelled) return
          if (data?.unsupported) {
            if (!cachedUser) setAuthReady(true)
            return
          }
          if (data?.locked && data?.user) {
            setUser(data.user)
            try { localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(data.user)) } catch {}
          } else {
            setUser(null)
            try { localStorage.removeItem(STAFF_SESSION_KEY) } catch {}
          }
          setAuthReady(true)
        })
        .catch(() => {
          if (cancelled) return
          if (attempt >= MAX_ATTEMPTS) {
            setAuthReady(true)
            return
          }
          retryTimer = setTimeout(tryBootstrapBinding, 500)
        })
    }

    if (!cachedUser) setAuthReady(false)
    tryBootstrapBinding()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
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

  const handleLogin  = useCallback((userData) => {
    if (appMode === 'staff') {
      try { localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(userData)) } catch {}
    }
    setUser(userData)
  }, [appMode])
  const handleLogout = useCallback(async () => {
    if (appMode === 'staff') {
      try { localStorage.removeItem(STAFF_SESSION_KEY) } catch {}
      try {
        await fetch(`${serverUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appMode })
        })
      } catch {}
    }
    setUser(null)
  }, [appMode, serverUrl])

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
