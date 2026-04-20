import { useState } from 'react'

export default function Login({ onLogin, serverUrl, onServerUrlChange, appMode = 'staff' }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [serverInput, setServerInput] = useState(serverUrl || 'http://localhost:3001')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  function normalizeServerUrl(value) {
    const raw = String(value || '').trim()
    if (!raw) return 'http://localhost:3001'
    if (/^https?:\/\//i.test(raw)) return raw
    return `http://${raw}`
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const effectiveServerUrl = normalizeServerUrl(serverInput)
    onServerUrlChange?.(effectiveServerUrl)
    try {
      const res  = await fetch(`${effectiveServerUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, appMode })
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || 'Login failed')
      else onLogin(data)
    } catch {
      setError('Cannot connect to server. Make sure the app is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4 drop-shadow-sm">🍽️</div>
          <h1 className="text-3xl font-bold">{appMode === 'admin' ? 'Admin Panel' : 'Staff Terminal'}</h1>
          <p className="text-stone-400 mt-1 text-sm">{appMode === 'admin' ? 'Administrator Login' : 'One-time staff terminal login'}</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white/78 border border-stone-200/40 rounded-2xl p-8 shadow-[0_4px_24px_rgba(0,0,0,0.06)] backdrop-blur-lg">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-500 mb-1.5">Server URL</label>
              <input
                className="input"
                type="text"
                placeholder="http://192.168.x.x:3001"
                value={serverInput}
                onChange={e => setServerInput(e.target.value)}
                onBlur={() => onServerUrlChange?.(serverInput)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-500 mb-1.5">Username</label>
              <input className="input" type="text" placeholder={appMode === 'admin' ? 'admin' : 'bartender / manager'}
                value={username} onChange={e => setUsername(e.target.value)} autoFocus required />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-500 mb-1.5">Password</label>
              <input className="input" type="password" placeholder="••••••"
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200/80 text-red-600 text-sm rounded-lg px-4 py-2.5">{error}</div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full mt-2 py-3 text-base">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
        <div className="mt-6 bg-white/50 border border-stone-200/40 rounded-xl p-4 backdrop-blur">
          <p className="text-xs text-stone-400 font-medium mb-2">Default credentials</p>
          <div className="space-y-1 text-xs text-stone-400">
            {appMode === 'admin' ? (
              <p><span className="text-stone-600 font-medium">admin</span> / 123 — Menu, tables, staff &amp; restaurants</p>
            ) : (
              <>
                <p><span className="text-stone-600 font-medium">bartender</span> / 123 — Order board</p>
                <p><span className="text-stone-600 font-medium">manager</span> / 123 — Overview &amp; history</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
