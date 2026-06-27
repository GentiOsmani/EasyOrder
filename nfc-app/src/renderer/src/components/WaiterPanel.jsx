import { useState, useEffect, useMemo } from 'react'

const MIN_CELLS = 20 // guarantees at least a 4-column x 5-row grid

export default function WaiterPanel({ socket, serverUrl, user }) {
  const [tables, setTables] = useState([])
  const [orders, setOrders] = useState([])
  const [selectedTableId, setSelectedTableId] = useState(null)
  const restaurantId = user?.restaurantId || null

  useEffect(() => {
    if (!restaurantId) return
    fetch(`${serverUrl}/api/tables?restaurantId=${restaurantId}`).then(r => r.json()).then(setTables).catch(() => {})
    fetch(`${serverUrl}/api/orders?restaurantId=${restaurantId}`).then(r => r.json()).then(setOrders).catch(() => {})
    if (socket) socket.emit('staff:set_restaurant', { restaurantId })
  }, [serverUrl, restaurantId, socket])

  useEffect(() => {
    if (!socket) return
    socket.on('init:data', ({ orders: o, tables: t }) => { setOrders(o); setTables(t) })
    socket.on('order:new', o => setOrders(prev => prev.find(x => x.id === o.id) ? prev : [o, ...prev]))
    socket.on('order:updated', u => setOrders(prev => prev.map(o => o.id === u.id ? u : o)))
    socket.on('order:removed', ({ orderId }) => setOrders(prev => prev.filter(o => o.id !== orderId)))
    socket.on('tables:updated', setTables)
    return () => {
      socket.off('init:data'); socket.off('order:new'); socket.off('order:updated')
      socket.off('order:removed'); socket.off('tables:updated')
    }
  }, [socket])

  const orderTotal = (o) => o.items.reduce((s, i) => s + i.price * i.quantity, 0)

  // Map each table -> its active orders and running total
  const tableData = useMemo(() => {
    const map = new Map()
    tables.forEach(t => map.set(t.id, { table: t, orders: [], total: 0 }))
    orders.forEach(o => {
      const entry = map.get(o.tableId)
      if (entry) { entry.orders.push(o); entry.total += orderTotal(o) }
    })
    return map
  }, [tables, orders])

  const selected = selectedTableId != null ? tableData.get(selectedTableId) : null

  // Aggregate items across the table's active orders for the detail view
  const selectedItems = useMemo(() => {
    if (!selected) return []
    const agg = new Map()
    selected.orders.forEach(o => o.items.forEach(i => {
      const key = `${i.name}__${i.price}`
      const cur = agg.get(key) || { name: i.name, price: i.price, quantity: 0 }
      cur.quantity += i.quantity
      agg.set(key, cur)
    }))
    return [...agg.values()]
  }, [selected])

  const settleTable = (tableId) => {
    if (socket) socket.emit('staff:settle_table', { tableId })
    setSelectedTableId(null)
  }

  const emptyCount = Math.max(0, MIN_CELLS - tables.length)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3.5 bg-white/70 backdrop-blur-lg border-b border-stone-200/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0">
        <h2 className="font-bold text-stone-800">🍽️ Tables Overview</h2>
        <span className="text-xs text-stone-400">{tables.length} table{tables.length === 1 ? '' : 's'}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {tables.length === 0 ? (
          <div className="card text-center py-16 text-stone-400">No tables configured for this restaurant yet.</div>
        ) : (
          <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3 auto-rows-fr">
            {tables.map(table => {
              const data = tableData.get(table.id)
              const total = data?.total || 0
              const occupied = total > 0
              return (
                <button
                  key={table.id}
                  onClick={() => setSelectedTableId(table.id)}
                  className={`card flex flex-col items-center justify-center text-center min-h-[110px] transition-all hover:shadow-md hover:-translate-y-0.5 ${
                    occupied
                      ? 'ring-1 ring-amber-300/60 bg-amber-50/50'
                      : 'ring-1 ring-emerald-200/50 bg-emerald-50/30'
                  }`}
                >
                  <div className="text-xl mb-1">{occupied ? '🔥' : '🪑'}</div>
                  <p className="font-bold text-stone-800 text-sm leading-tight">{table.name || `Table ${table.id}`}</p>
                  <p className={`mt-1 text-sm font-semibold ${occupied ? 'text-amber-700' : 'text-emerald-600'}`}>
                    {occupied ? `$${total.toFixed(2)}` : 'Free'}
                  </p>
                </button>
              )
            })}
            {Array.from({ length: emptyCount }).map((_, i) => (
              <div key={`empty-${i}`} className="rounded-2xl border border-dashed border-stone-200/70 bg-white/20 min-h-[110px]" aria-hidden="true" />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm p-4" onClick={() => setSelectedTableId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
              <div>
                <h3 className="font-bold text-stone-800 text-lg">{selected.table.name || `Table ${selected.table.id}`}</h3>
                <p className="text-xs text-stone-400">{selected.orders.length} active order{selected.orders.length === 1 ? '' : 's'}</p>
              </div>
              <button onClick={() => setSelectedTableId(null)} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              {selectedItems.length === 0 ? (
                <p className="text-center text-stone-400 py-8">No active orders for this table.</p>
              ) : (
                <div className="space-y-2">
                  {selectedItems.map((it, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-stone-700"><span className="font-semibold text-stone-800">{it.quantity}×</span> {it.name}</span>
                      <span className="text-stone-500">${(it.price * it.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-stone-100 bg-stone-50/60">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-stone-600">Total</span>
                <span className="text-xl font-bold text-amber-700">${(selected.total || 0).toFixed(2)}</span>
              </div>
              <button
                onClick={() => settleTable(selected.table.id)}
                disabled={selected.orders.length === 0}
                className="w-full py-2.5 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
              >
                ✓ Done — Mark Paid & Free Table
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
