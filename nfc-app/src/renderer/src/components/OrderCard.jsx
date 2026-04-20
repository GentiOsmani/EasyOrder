import { useState } from 'react'

function timeSince(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function OrderCard({ order, tableName, socket, onComplete }) {
  const [, setNow] = useState(Date.now())
  useState(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  })

  const allDone   = order.items.every(i => i.done)
  const doneCount = order.items.filter(i => i.done).length
  const total     = order.items.reduce((s, i) => s + i.price * i.quantity, 0)
  const isReady   = order.status === 'ready'

  function toggleItem(itemId, currentDone) {
    socket.emit('bartender:item_done', { orderId: order.id, itemId, done: !currentDone })
  }
  function checkAll() {
    order.items.forEach(item => {
      if (!item.done) socket.emit('bartender:item_done', { orderId: order.id, itemId: item.id, done: true })
    })
  }
  function finishOrder()   { socket.emit('bartender:finish_order',    { orderId: order.id }) }
  function completeOrder() { socket.emit('bartender:complete_order',   { orderId: order.id }); if (onComplete) onComplete(order.id) }

  return (
    <div className="card flex flex-col gap-3 h-fit transition-all">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-stone-800 text-lg leading-tight">{tableName}</h3>
          <p className="text-xs text-stone-400">{order.customerName} · {timeSince(order.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${isReady ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60'}`}>
            {isReady ? '✓ Ready' : '🔥 Preparing'}
          </span>
          <span className="text-xs text-stone-400">{doneCount}/{order.items.length} done</span>
        </div>
      </div>

      <div className="w-full bg-stone-200/80 rounded-full h-1.5">
        <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${(doneCount / order.items.length) * 100}%` }} />
      </div>

      <label className="flex items-center gap-2 cursor-pointer text-sm text-stone-600 hover:text-stone-800 transition-colors select-none border-b border-stone-200/60 pb-2">
        <input type="checkbox" className="w-4 h-4 rounded accent-green-600 cursor-pointer" checked={allDone} onChange={checkAll} />
        <span className="font-medium">Check All</span>
      </label>

      <div className="space-y-1.5">
        {order.items.map(item => (
          <label key={item.id} className={`flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 transition-colors ${item.done ? 'bg-stone-100/60' : 'hover:bg-stone-50'}`}>
            <input type="checkbox" className="w-4 h-4 rounded accent-green-600 cursor-pointer shrink-0"
              checked={item.done} onChange={() => toggleItem(item.id, item.done)} />
            <span className={`flex-1 text-sm ${item.done ? 'line-through text-stone-400' : 'text-stone-700'}`}>
              <span className="font-semibold">{item.quantity}×</span> {item.name}
              {item.notes && <span className="text-stone-400 text-xs ml-1">({item.notes})</span>}
            </span>
            <span className="text-xs text-stone-400 shrink-0">${(item.price * item.quantity).toFixed(2)}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-stone-200/60">
        <span className="text-sm font-semibold text-stone-500">Total: <span className="text-stone-800">${total.toFixed(2)}</span></span>
        <div className="flex gap-2">
          {!isReady && (
            <button onClick={finishOrder} disabled={!allDone} className="btn-success text-sm px-3 py-1.5 disabled:opacity-30"
              title={allDone ? 'Mark as ready' : 'Check all items first'}>
              Finish Order
            </button>
          )}
          {isReady && (
            <button onClick={completeOrder} className="btn-secondary text-sm px-3 py-1.5">Served ✓</button>
          )}
        </div>
      </div>
    </div>
  )
}
