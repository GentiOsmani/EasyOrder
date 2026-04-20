import { useState, useEffect, useRef } from 'react'
import OrderCard from './OrderCard'

export default function BartenderBoard({ socket, serverUrl, user }) {
  const [orders, setOrders]           = useState([])
  const [tables, setTables]           = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [restaurantId, setRestaurantId] = useState(null)
  const [filter, setFilter]           = useState('active')
  const [notification, setNotification] = useState(null)
  const restaurantRef = useRef(null)
  const audioCtxRef = useRef(null)
  const beepIntervalRef = useRef(null)

  function playBeep() {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})

    const playBellPartial = (frequency, start, duration, volume) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration + 0.02)
    }

    const t = ctx.currentTime
    playBellPartial(1046, t, 0.75, 0.05)
    playBellPartial(1568, t, 0.52, 0.028)
    playBellPartial(2093, t, 0.34, 0.018)
  }

  function stopBeepLoop() {
    if (!beepIntervalRef.current) return
    clearInterval(beepIntervalRef.current)
    beepIntervalRef.current = null
  }

  function startBeepLoop() {
    if (beepIntervalRef.current) return
    playBeep()
    beepIntervalRef.current = setInterval(playBeep, 1200)
  }

  useEffect(() => {
    if (user?.restaurantId) {
      setRestaurantId(user.restaurantId)
      return
    }

    fetch(`${serverUrl}/api/restaurants`)
      .then(r => r.json())
      .then((data) => {
        setRestaurants(data)
        if (data[0]) setRestaurantId(data[0].id)
      })
      .catch(() => {})
  }, [serverUrl, user?.restaurantId])

  useEffect(() => {
    if (!socket || !restaurantId) return
    restaurantRef.current = restaurantId
    socket.emit('staff:set_restaurant', { restaurantId })

    fetch(`${serverUrl}/api/tables?restaurantId=${restaurantId}`)
      .then(r => r.json())
      .then(setTables)
      .catch(() => {})

    fetch(`${serverUrl}/api/orders?restaurantId=${restaurantId}`)
      .then(r => r.json())
      .then(setOrders)
      .catch(() => {})
  }, [socket, restaurantId])

  useEffect(() => {
    restaurantRef.current = restaurantId
  }, [restaurantId])

  useEffect(() => {
    if (!socket || !restaurantId || filter !== 'active') return
    socket.emit('bartender:view_preparing', { restaurantId })
  }, [socket, restaurantId, filter])

  useEffect(() => {
    if (filter === 'active') stopBeepLoop()
  }, [filter])

  useEffect(() => {
    if (!socket) return
    socket.on('init:data', ({ orders: o, tables: t }) => {
      setOrders(o)
      setTables(t)
    })
    socket.on('order:new', (order) => {
      const currentRestaurantId = restaurantRef.current
      if (currentRestaurantId && order.restaurantId && order.restaurantId !== currentRestaurantId) return
      setOrders(prev => prev.find(o => o.id === order.id) ? prev : [order, ...prev])
      const tbl = order.tableName ? { name: order.tableName } : null
      showNotification(`New order from ${tbl ? tbl.name : `Table ${order.tableId}`}!`, 'new')
      if (filter === 'ready') startBeepLoop()
    })
    socket.on('order:updated', (updated) => {
      const currentRestaurantId = restaurantRef.current
      if (currentRestaurantId && updated.restaurantId && updated.restaurantId !== currentRestaurantId) return
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))
    })
    socket.on('order:removed', ({ orderId }) => setOrders(prev => prev.filter(o => o.id !== orderId)))
    socket.on('tables:updated', setTables)
    return () => {
      stopBeepLoop()
      socket.off('init:data'); socket.off('order:new'); socket.off('order:updated')
      socket.off('order:removed'); socket.off('tables:updated')
    }
  }, [socket, filter])

  function showNotification(msg, type) {
    setNotification({ msg, type })
    setTimeout(() => setNotification(null), 4000)
  }

  function getTableName(tableId) {
    const t = tables.find(t => t.id === tableId)
    return t ? t.name : `Table ${tableId}`
  }

  const activeOrders = orders.filter(o => o.status === 'preparing')
  const readyOrders  = orders.filter(o => o.status === 'ready')
  const displayed    = filter === 'active' ? activeOrders : readyOrders

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3.5 bg-white/70 backdrop-blur-lg border-b border-stone-200/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-stone-800">Order Board</h2>
          {restaurants.length > 0 && !user?.restaurantId && (
            <select
              className="input min-w-52"
              value={restaurantId || ''}
              onChange={(e) => setRestaurantId(parseInt(e.target.value, 10))}
            >
              {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <div className="flex gap-1 bg-stone-100/80 rounded-lg p-1">
            <button onClick={() => setFilter('active')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${filter === 'active' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              🔥 Preparing
              {activeOrders.length > 0 && <span className="ml-1.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full px-1.5">{activeOrders.length}</span>}
            </button>
            <button onClick={() => setFilter('ready')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${filter === 'ready' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              ✓ Ready to Serve
              {readyOrders.length > 0 && <span className="ml-1.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full px-1.5">{readyOrders.length}</span>}
            </button>
          </div>
        </div>
        <div className="text-sm text-stone-400">{orders.length} active order{orders.length !== 1 ? 's' : ''}</div>
      </div>

      {notification && (
        <div className={`mx-6 mt-3 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 animate-pulse ${
          notification.type === 'new' ? 'bg-amber-50 border border-amber-200/80 text-amber-700' : 'bg-emerald-50 border border-emerald-200/80 text-emerald-700'
        }`}>
          {notification.type === 'new' ? '🔔' : '✅'} {notification.msg}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="text-5xl mb-4">{filter === 'active' ? '😴' : '🎉'}</div>
            <p className="text-stone-500 text-lg font-medium">{filter === 'active' ? 'No active orders' : 'Nothing ready yet'}</p>
            <p className="text-stone-400 text-sm mt-1">{filter === 'active' ? 'Orders will appear here when clients order' : 'Finish orders to see them here'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
            {displayed.map(order => (
              <OrderCard key={order.id} order={order} tableName={getTableName(order.tableId)}
                socket={socket} onComplete={(id) => setOrders(prev => prev.filter(o => o.id !== id))} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
