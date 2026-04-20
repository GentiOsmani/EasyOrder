import { useState, useEffect } from 'react'

export default function ManagerPanel({ socket, serverUrl, user }) {
  const [restaurants, setRestaurants] = useState([])
  const [restaurantId, setRestaurantId] = useState(null)
  const [orders, setOrders]       = useState([])
  const [tables, setTables]       = useState([])
  const [tab, setTab]             = useState('live')
  const [allOrders, setAllOrders] = useState([])

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
    if (!restaurantId) return
    fetch(`${serverUrl}/api/tables?restaurantId=${restaurantId}`).then(r => r.json()).then(setTables)
    fetch(`${serverUrl}/api/orders?restaurantId=${restaurantId}`).then(r => r.json()).then(setOrders)
    fetch(`${serverUrl}/api/orders/all?restaurantId=${restaurantId}`).then(r => r.json()).then(setAllOrders)
    if (socket) socket.emit('staff:set_restaurant', { restaurantId })
  }, [serverUrl, restaurantId, socket])

  useEffect(() => {
    if (!socket) return
    socket.on('init:data', ({ orders: o, tables: t }) => { setOrders(o); setTables(t) })
    socket.on('order:new', o => {
      setOrders(prev => prev.find(x => x.id === o.id) ? prev : [o, ...prev])
      setAllOrders(prev => prev.find(x => x.id === o.id) ? prev : [o, ...prev])
    })
    socket.on('order:updated', u => {
      setOrders(prev => prev.map(o => o.id === u.id ? u : o))
      setAllOrders(prev => prev.map(o => o.id === u.id ? u : o))
    })
    socket.on('order:removed', ({ orderId }) => setOrders(prev => prev.filter(o => o.id !== orderId)))
    socket.on('tables:updated', setTables)
    return () => { socket.off('init:data'); socket.off('order:new'); socket.off('order:updated'); socket.off('order:removed'); socket.off('tables:updated') }
  }, [socket])

  const getTableName = (id) => tables.find(t => t.id === id)?.name || `Table ${id}`

  const revenue   = allOrders.reduce((sum, o) => (o.status === 'completed' || o.status === 'ready') ? sum + o.items.reduce((s, i) => s + i.price * i.quantity, 0) : sum, 0)
  const preparing = orders.filter(o => o.status === 'preparing').length
  const ready     = orders.filter(o => o.status === 'ready').length
  const completed = allOrders.filter(o => o.status === 'completed').length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-6 py-3.5 bg-white/70 backdrop-blur-lg border-b border-stone-200/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0">
        {restaurants.length > 0 && !user?.restaurantId && (
          <select
            className="input max-w-xs mr-3"
            value={restaurantId || ''}
            onChange={(e) => setRestaurantId(parseInt(e.target.value, 10))}
          >
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        {['live', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-white text-stone-800 shadow-sm ring-1 ring-stone-200/50' : 'text-stone-500 hover:text-stone-700 hover:bg-white/50'}`}>
            {t === 'live' ? '📊 Live Overview' : '📋 Order History'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'live' && (
          <div className="space-y-6 max-w-5xl">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Preparing',       value: preparing,            cls: 'text-amber-600', icon: '🔥' },
                { label: 'Ready to Serve',  value: ready,                cls: 'text-emerald-600',  icon: '✅' },
                { label: 'Completed Today', value: completed,            cls: 'text-blue-600',   icon: '🎯' },
                { label: 'Revenue',         value: `$${revenue.toFixed(2)}`, cls: 'text-violet-600', icon: '💰' }
              ].map(stat => (
                <div key={stat.label} className="card text-center">
                  <div className="text-3xl mb-1">{stat.icon}</div>
                  <div className={`text-2xl font-bold ${stat.cls}`}>{stat.value}</div>
                  <div className="text-xs text-stone-400 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            <div>
              <h3 className="font-bold text-stone-800 mb-3">Table Status</h3>
              {tables.length === 0 ? <div className="card text-center py-8 text-stone-400">No tables configured.</div> : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {tables.map(table => {
                    const tableOrders = orders.filter(o => o.tableId === table.id)
                    const hasActive = tableOrders.length > 0
                    const allReady  = hasActive && tableOrders.every(o => o.status === 'ready')
                    return (
                      <div key={table.id} className={`card text-center transition-all ${allReady ? 'ring-1 ring-emerald-300/50 bg-emerald-50/40' : hasActive ? 'ring-1 ring-amber-300/50 bg-amber-50/40' : ''}`}>
                        <div className="text-2xl mb-2">{allReady ? '✅' : hasActive ? '🔥' : '🪑'}</div>
                        <p className="font-semibold text-stone-700 text-sm">{table.name}</p>
                        <p className={`text-xs mt-0.5 ${allReady ? 'text-emerald-600' : hasActive ? 'text-amber-600' : 'text-stone-400'}`}>
                          {allReady ? 'Ready to serve' : hasActive ? `${tableOrders.length} active order${tableOrders.length > 1 ? 's' : ''}` : 'Empty'}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {orders.length > 0 && (
              <div>
                <h3 className="font-bold text-stone-800 mb-3">Active Orders</h3>
                <div className="space-y-2">
                  {orders.map(order => {
                    const total = order.items.reduce((s, i) => s + i.price * i.quantity, 0)
                    return (
                      <div key={order.id} className="card flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-stone-800">{getTableName(order.tableId)}</span>
                          <span className="text-stone-400 text-sm ml-2">· {order.customerName} · {order.items.length} items</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-amber-700 font-semibold">${total.toFixed(2)}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${order.status === 'ready' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60'}`}>
                            {order.status === 'ready' ? '✓ Ready' : '🔥 Preparing'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="max-w-4xl">
            <h3 className="font-bold text-stone-800 mb-4">All Orders</h3>
            {allOrders.length === 0 ? <div className="card text-center py-10 text-stone-400">No orders yet.</div> : (
              <div className="space-y-2">
                {[...allOrders].reverse().map(order => {
                  const total = order.items.reduce((s, i) => s + i.price * i.quantity, 0)
                  return (
                    <div key={order.id} className="card">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-semibold text-stone-800">{getTableName(order.tableId)}</span>
                          <span className="text-stone-400 text-sm ml-2">· {order.customerName}</span>
                          <span className="text-stone-400 text-xs ml-2">{new Date(order.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-amber-700 font-semibold">${total.toFixed(2)}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${order.status === 'completed' ? 'bg-stone-100 text-stone-500 ring-1 ring-stone-200/60' : order.status === 'ready' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60'}`}>
                            {order.status}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-stone-400 flex flex-wrap gap-2">
                        {order.items.map(i => <span key={i.id} className="bg-stone-100 text-stone-600 rounded px-2 py-0.5">{i.quantity}× {i.name}</span>)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
