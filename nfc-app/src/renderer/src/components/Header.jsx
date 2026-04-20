import { useState, useEffect } from 'react'

export default function Header({ user, onLogout, connected, serverInfo, restaurant, appMode = 'staff' }) {
  const roleColors = { bartender: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60', admin: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60', manager: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60' }
  const roleLabels = { bartender: '🍺 Bartender', admin: '⚙️ Admin', manager: '📊 Manager' }
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  return (
    <header className="flex items-center justify-between px-6 py-3.5 bg-white/80 backdrop-blur-lg border-b border-stone-200/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0">
      <div className="flex items-center gap-3">
        {restaurant?.logoUrl ? (
          <img
            src={restaurant.logoUrl}
            alt={`${restaurant.name || 'Restaurant'} logo`}
            className="w-9 h-9 rounded-lg object-cover border border-stone-200/70 bg-white"
          />
        ) : (
          <span className="text-2xl">🍽️</span>
        )}
        <div>
          <h1 className="text-lg font-bold leading-tight">{restaurant?.name || 'Restaurant NFC System'}</h1>
          <p className="text-xs text-stone-400">Server: {serverInfo.ip}:{serverInfo.port}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs text-stone-400">{connected ? 'Live' : 'Offline'}</span>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${roleColors[user.role] || 'bg-stone-100 text-stone-600'}`}>
          {roleLabels[user.role] || user.role}
        </span>
        <span className="text-sm text-stone-600 font-medium">{user.username}</span>
        <button 
          onClick={toggleFullscreen}
          className="px-3 py-1.5 text-sm bg-white/80 hover:bg-white text-stone-500 hover:text-stone-700 border border-stone-200/60 rounded-lg transition-all"
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        >
          {isFullscreen ? '⛶' : '⛶'}
        </button>
        {appMode !== 'staff' && (
          <button onClick={onLogout} className="px-3 py-1.5 text-sm bg-white/80 hover:bg-white text-stone-500 hover:text-stone-700 border border-stone-200/60 rounded-lg transition-all">
            Logout
          </button>
        )}
      </div>
    </header>
  )
}
