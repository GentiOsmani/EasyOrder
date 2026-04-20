import { useState, useEffect, useRef } from 'react'

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white/95 backdrop-blur-xl border border-stone-200/60 rounded-2xl w-full max-w-lg shadow-[0_24px_48px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200/60">
          <h3 className="font-bold text-stone-800 text-lg">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none transition-colors">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export default function AdminPanel({ socket, serverUrl, serverInfo }) {
  const [tab, setTab]                  = useState('restaurants')
  const [restaurants, setRestaurants]  = useState([])
  const [selectedRestaurantId, setSelectedRestaurantId] = useState(null)
  const [categories, setCategories]    = useState([])
  const [items, setItems]              = useState([])
  const [tables, setTables]            = useState([])
  const [users, setUsers]              = useState([])
  const [modal, setModal]              = useState(null)
  const [form, setForm]                = useState({})
  const [saving, setSaving]            = useState(false)
  const [msg, setMsg]                  = useState(null)
  const selectedRestaurantRef          = useRef(null)

  const selectedRestaurant = restaurants.find(r => r.id === selectedRestaurantId) || null

  useEffect(() => { fetchRestaurants() }, [])
  useEffect(() => {
    if (!selectedRestaurantId) return
    selectedRestaurantRef.current = selectedRestaurantId
    if (socket) socket.emit('staff:set_restaurant', { restaurantId: selectedRestaurantId })
    fetchMenu(selectedRestaurantId)
    fetchTables(selectedRestaurantId)
    fetchUsers()
  }, [selectedRestaurantId, socket])

  useEffect(() => {
    selectedRestaurantRef.current = selectedRestaurantId
  }, [selectedRestaurantId])

  useEffect(() => {
    if (!socket) return
    socket.on('menu:updated', ({ restaurantId, categories: c, items: i }) => {
      const currentRestaurantId = selectedRestaurantRef.current
      if (restaurantId && currentRestaurantId && restaurantId !== currentRestaurantId) return
      if (c && i) {
        setCategories(c)
        setItems(i)
      }
    })
    socket.on('tables:updated', (allTables) => {
      const currentRestaurantId = selectedRestaurantRef.current
      if (!currentRestaurantId) return
      setTables(allTables.filter(t => t.restaurantId === currentRestaurantId))
    })
    socket.on('restaurants:updated', (nextRestaurants) => {
      setRestaurants(nextRestaurants)
      if (!selectedRestaurantRef.current && nextRestaurants[0]) setSelectedRestaurantId(nextRestaurants[0].id)
    })
    socket.on('users:updated', (nextUsers) => {
      setUsers(nextUsers)
    })
    return () => {
      socket.off('menu:updated')
      socket.off('tables:updated')
      socket.off('restaurants:updated')
      socket.off('users:updated')
    }
  }, [socket])

  async function fetchRestaurants() {
    const r = await fetch(`${serverUrl}/api/restaurants`)
    const d = await r.json()
    setRestaurants(d)
    if (!selectedRestaurantId && d[0]) setSelectedRestaurantId(d[0].id)
  }

  async function fetchMenu(restaurantId = selectedRestaurantId) {
    if (!restaurantId) return
    const r = await fetch(`${serverUrl}/api/menu?restaurantId=${restaurantId}`)
    const d = await r.json()
    setCategories(d.categories)
    setItems(d.items)
  }

  async function fetchTables(restaurantId = selectedRestaurantId) {
    if (!restaurantId) return
    const r = await fetch(`${serverUrl}/api/tables?restaurantId=${restaurantId}`)
    setTables(await r.json())
  }

  async function fetchUsers() {
    const r = await fetch(`${serverUrl}/api/users`)
    setUsers(await r.json())
  }

  function notify(text, ok = true) { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000) }

  async function apiCall(method, endpoint, body) {
    setSaving(true)
    try {
      const r = await fetch(`${serverUrl}${endpoint}`, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      })
      if (!r.ok) {
        let message = 'Request failed'
        try {
          const err = await r.json()
          if (err?.error) message = err.error
        } catch {}
        throw new Error(message)
      }
      return await r.json()
    } catch (e) { notify(e.message, false); return null }
    finally { setSaving(false) }
  }

  function openAddRestaurant() { setForm({ name: '', logoUrl: '' }); setModal('addRestaurant') }
  function openEditRestaurant(restaurant) { setForm({ ...restaurant }); setModal('editRestaurant') }
  function openAddUser() { setForm({ username: '', password: '', role: 'bartender', restaurantId: selectedRestaurantId || restaurants[0]?.id || '' }); setModal('addUser') }
  function openEditUser(staffUser) { setForm({ ...staffUser, password: '' }); setModal('editUser') }

  async function saveRestaurant() {
    const body = { name: String(form.name || '').trim(), logoUrl: String(form.logoUrl || '').trim() }
    if (!body.name) return notify('Restaurant name is required', false)
    const saved = await apiCall(
      modal === 'addRestaurant' ? 'POST' : 'PUT',
      modal === 'addRestaurant' ? '/api/restaurants' : `/api/restaurants/${form.id}`,
      body
    )
    if (!saved) return
    await fetchRestaurants()
    if (modal === 'addRestaurant') setSelectedRestaurantId(saved.id)
    notify(modal === 'addRestaurant' ? 'Restaurant created!' : 'Restaurant updated!')
    setModal(null)
  }

  function openAddItem()   { setForm({ name: '', description: '', price: '', categoryId: categories[0]?.id || '', available: true }); setModal('addItem') }
  function openEditItem(i) { setForm({ ...i }); setModal('editItem') }
  async function saveItem() {
    if (!selectedRestaurantId) return notify('Please select a restaurant first', false)
    const price = parseFloat(form.price)
    const categoryId = parseInt(form.categoryId, 10)
    if (!String(form.name || '').trim()) return notify('Item name is required', false)
    if (!Number.isFinite(price) || price < 0) return notify('Price must be a valid number', false)
    if (!Number.isInteger(categoryId)) return notify('Please select a category', false)
    const body = { ...form, restaurantId: selectedRestaurantId, price: parseFloat(form.price), categoryId: parseInt(form.categoryId) }
    const result = await apiCall(modal === 'addItem' ? 'POST' : 'PUT', modal === 'addItem' ? '/api/menu/items' : `/api/menu/items/${form.id}`, body)
    if (!result) return
    notify(modal === 'addItem' ? 'Item added!' : 'Item updated!')
    setModal(null)
  }
  async function deleteItem(id) { if (!confirm('Delete this item?')) return; await apiCall('DELETE', `/api/menu/items/${id}`); notify('Item deleted!') }

  function openAddCat() { setForm({ name: '' }); setModal('addCat') }
  async function saveCat() {
    if (!selectedRestaurantId) return notify('Please select a restaurant first', false)
    if (!String(form.name || '').trim()) return notify('Category name is required', false)
    const result = await apiCall('POST', '/api/menu/categories', { ...form, restaurantId: selectedRestaurantId })
    if (!result) return
    notify('Category added!')
    setModal(null)
  }
  async function deleteCat(id) { if (!confirm('Delete category and all its items?')) return; await apiCall('DELETE', `/api/menu/categories/${id}`); notify('Category deleted!') }

  function openAddTable()  { setForm({ name: '', moduleId: '', esp32Ip: '' }); setModal('addTable') }
  function openEditTable(t){ setForm({ ...t }); setModal('editTable') }
  async function saveTable() {
    if (!selectedRestaurantId) return notify('Please select a restaurant first', false)
    const moduleId = parseInt(form.moduleId, 10)
    if (!String(form.name || '').trim()) return notify('Display name is required', false)
    if (!Number.isInteger(moduleId) || moduleId < 1 || moduleId > 100) {
      return notify('Module ID must be between 1 and 100', false)
    }
    const body = {
      name: form.name,
      moduleId,
      esp32Ip: form.esp32Ip || '',
      restaurantId: selectedRestaurantId
    }
    const result = await apiCall(modal === 'addTable' ? 'POST' : 'PUT', modal === 'addTable' ? '/api/tables' : `/api/tables/${form.id}`, body)
    if (!result) return
    notify(modal === 'addTable' ? 'Table added!' : 'Table updated!')
    setModal(null); fetchTables(selectedRestaurantId)
  }
  async function deleteTable(id) { if (!confirm('Delete this table?')) return; await apiCall('DELETE', `/api/tables/${id}`); notify('Table deleted!'); fetchTables(selectedRestaurantId) }

  async function saveUser() {
    const body = {
      username: String(form.username || '').trim(),
      password: String(form.password || ''),
      role: form.role,
      restaurantId: parseInt(form.restaurantId, 10)
    }
    if (!body.username) return notify('Username is required', false)
    if (!['bartender', 'manager'].includes(body.role)) return notify('Role must be bartender or manager', false)
    if (!Number.isInteger(body.restaurantId)) return notify('Please select a restaurant', false)
    if (modal === 'addUser' && body.password.length < 3) return notify('Password must be at least 3 characters', false)
    if (modal === 'editUser' && body.password && body.password.length < 3) return notify('Password must be at least 3 characters', false)

    if (!body.password) delete body.password

    const result = await apiCall(
      modal === 'addUser' ? 'POST' : 'PUT',
      modal === 'addUser' ? '/api/users' : `/api/users/${form.id}`,
      body
    )
    if (!result) return
    notify(modal === 'addUser' ? 'Staff user created!' : 'Staff user updated!')
    setModal(null)
    fetchUsers()
  }

  async function deleteUser(id) {
    if (!confirm('Delete this staff account?')) return
    const result = await apiCall('DELETE', `/api/users/${id}`)
    if (!result) return
    notify('Staff user deleted!')
    fetchUsers()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-6 py-3.5 bg-white/70 backdrop-blur-lg border-b border-stone-200/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] shrink-0">
        {['restaurants', 'staff', 'menu', 'tables', 'info'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-white text-stone-800 shadow-sm ring-1 ring-stone-200/50' : 'text-stone-500 hover:text-stone-700 hover:bg-white/50'}`}>
            {t === 'restaurants' ? '🏢 Restaurants' : t === 'staff' ? '👥 Staff' : t === 'menu' ? '🍴 Menu' : t === 'tables' ? '📟 NFC Modules' : 'ℹ️ System Info'}
          </button>
        ))}
        {(tab === 'menu' || tab === 'tables') && (
          <select
            className="ml-3 input max-w-xs"
            value={selectedRestaurantId || ''}
            onChange={(e) => setSelectedRestaurantId(parseInt(e.target.value, 10))}
          >
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}

        {tab === 'staff' && (
          <div className="max-w-5xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-stone-800">Staff Assignment by Restaurant</h2>
              <button onClick={openAddUser} className="btn-primary">+ Add Staff Account</button>
            </div>
            <p className="text-sm text-stone-400">Assign each bartender/manager account to exactly one restaurant. Assigned staff cannot switch restaurants.</p>
            {users.length === 0 ? <div className="card text-center py-10 text-stone-400">No staff accounts yet.</div> : (
              <div className="space-y-2">
                {users.map(u => {
                  const rName = restaurants.find(r => r.id === u.restaurantId)?.name || `Restaurant #${u.restaurantId}`
                  return (
                    <div key={u.id} className="card flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-stone-800">{u.username} <span className="text-xs px-2 py-0.5 rounded-md bg-stone-100 text-stone-500 ml-2">{u.role}</span></p>
                        <p className="text-sm text-amber-700/80">Assigned: {rName}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEditUser(u)} className="btn-secondary text-sm py-1.5 px-3">Edit</button>
                        <button onClick={() => deleteUser(u.id)} className="btn-danger text-sm py-1.5 px-3">Delete</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {msg && <div className={`ml-4 px-3 py-1.5 rounded-lg text-sm font-medium ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</div>}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'restaurants' && (
          <div className="max-w-4xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-stone-800">Restaurant Subscription Setup</h2>
              <button onClick={openAddRestaurant} className="btn-primary">+ Add Restaurant</button>
            </div>
            <p className="text-sm text-stone-400">Create each restaurant, add its logo URL, then select it in the Menu/Modules tabs to manage isolated data.</p>
            {restaurants.length === 0 ? <div className="card text-center py-10 text-stone-400">No restaurants yet.</div> : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {restaurants.map(r => (
                  <div key={r.id} className={`card ${selectedRestaurantId === r.id ? 'ring-2 ring-amber-300/40 border-amber-300/40' : ''}`}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-stone-800">{r.name}</h3>
                      <button onClick={() => setSelectedRestaurantId(r.id)} className="btn-secondary text-xs py-1 px-2">Use</button>
                    </div>
                    {r.logoUrl ? <img src={r.logoUrl} alt={r.name} className="h-14 w-14 rounded-lg object-cover border border-stone-200" /> : <div className="h-14 w-14 rounded-lg bg-stone-100 border border-stone-200" />}
                    <p className="text-xs text-stone-400 mt-3 break-all">Logo URL: {r.logoUrl || 'Not set'}</p>
                    <button onClick={() => openEditRestaurant(r)} className="mt-3 btn-secondary text-sm py-1.5 px-3">Edit</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'menu' && (
          <div className="max-w-4xl space-y-6">
            {!selectedRestaurantId ? (
              <div className="card text-center py-10 text-stone-400">Please add and select a restaurant first.</div>
            ) : (
              <>
                <div className="card ring-1 ring-amber-200/40">
                  <p className="text-sm text-stone-400">Editing menu for</p>
                  <p className="text-lg font-bold text-amber-700">{selectedRestaurant?.name}</p>
                </div>
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-stone-800">Categories</h3>
                <button onClick={openAddCat} className="btn-primary text-sm py-1.5 px-3">+ Add Category</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center gap-2 bg-stone-50 border border-stone-200/60 rounded-lg px-3 py-1.5">
                    <span className="text-sm text-stone-700">{cat.name}</span>
                    <button onClick={() => deleteCat(cat.id)} className="text-red-400 hover:text-red-500 text-xs">✕</button>
                  </div>
                ))}
              </div>
            </div>
            {categories.map(cat => {
              const catItems = items.filter(i => i.categoryId === cat.id)
              return (
                <div key={cat.id} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-stone-800">{cat.name}</h3>
                    <button onClick={() => { openAddItem(); setForm(f => ({ ...f, categoryId: cat.id })) }} className="btn-secondary text-xs py-1 px-2">+ Add Item</button>
                  </div>
                  {catItems.length === 0 ? <p className="text-stone-400 text-sm">No items in this category</p> : (
                    <div className="space-y-2">
                      {catItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between bg-stone-50/80 rounded-lg px-3 py-2.5">
                          <div>
                            <span className="font-medium text-stone-700">{item.name}</span>
                            {item.description && <span className="text-stone-400 text-xs ml-2">{item.description}</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-amber-700 font-semibold">${parseFloat(item.price).toFixed(2)}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${item.available ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60' : 'bg-red-50 text-red-500 ring-1 ring-red-200/60'}`}>{item.available ? 'Available' : 'Unavailable'}</span>
                            <button onClick={() => openEditItem(item)} className="text-stone-500 hover:text-amber-700 text-sm transition-colors">Edit</button>
                            <button onClick={() => deleteItem(item.id)} className="text-stone-400 hover:text-red-500 text-sm transition-colors">Del</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <button onClick={openAddItem} className="btn-primary">+ Add Menu Item</button>
              </>
            )}
          </div>
        )}

        {tab === 'tables' && (
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-stone-800">NFC Module Setup (ID 1-100)</h2>
              <button onClick={openAddTable} className="btn-primary" disabled={!selectedRestaurantId}>+ Add Module</button>
            </div>
            {selectedRestaurant && <p className="text-sm text-amber-700/80">Restaurant: {selectedRestaurant.name}</p>}
            <p className="text-stone-400 text-sm">
              ESP32 WebSocket endpoint:&nbsp;
              <code className="px-2 py-0.5 bg-stone-100 rounded text-amber-700 text-xs font-mono">ws://{serverInfo.ip}:{serverInfo.port}/esp32</code>
            </p>
            {!selectedRestaurantId ? <div className="card text-center py-10 text-stone-400">Please add and select a restaurant first.</div> : tables.length === 0 ? <div className="card text-center py-10 text-stone-400">No modules added yet.</div> : (
              <div className="space-y-3">
                {tables.map(t => (
                  <div key={t.id} className="card flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-stone-800">{t.name} <span className="text-amber-700/70">(Module #{t.moduleId || t.id})</span></p>
                      <p className="text-xs text-stone-400">Menu URL: <span className="text-amber-700 font-mono">http://{serverInfo.ip}:{serverInfo.port}/menu/{t.id}</span></p>
                      {t.esp32Ip && <p className="text-xs text-stone-400">ESP32 IP: {t.esp32Ip}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openEditTable(t)} className="btn-secondary text-sm py-1.5 px-3">Edit</button>
                      <button onClick={() => deleteTable(t.id)} className="btn-danger text-sm py-1.5 px-3">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'info' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-xl font-bold text-stone-800">System Information</h2>
            <div className="card space-y-4">
              <div><p className="text-stone-400 text-sm mb-1">Server LAN IP</p><code className="text-amber-700 text-lg font-mono">{serverInfo.ip}:{serverInfo.port}</code></div>
              <div><p className="text-stone-400 text-sm mb-1">Client Menu URL</p><code className="text-emerald-700 text-sm font-mono">http://{serverInfo.ip}:{serverInfo.port}/menu/[TABLE_ID]</code></div>
              <div><p className="text-stone-400 text-sm mb-1">ESP32 WebSocket</p><code className="text-blue-700 text-sm font-mono">ws://{serverInfo.ip}:{serverInfo.port}/esp32</code></div>
            </div>
            <div className="card">
              <p className="font-semibold text-stone-800 mb-3">ESP32 Setup</p>
              <ol className="text-sm text-stone-500 space-y-2 list-decimal list-inside">
                <li>Flash <code className="text-amber-700 bg-stone-50 px-1 rounded">esp32/main.ino</code> to your ESP32</li>
                <li>Set WiFi SSID and password in the sketch</li>
                <li>Set <code className="text-amber-700 bg-stone-50 px-1 rounded">SERVER_IP</code> to <code className="text-emerald-700 bg-stone-50 px-1 rounded">{serverInfo.ip}</code></li>
                <li>Set <code className="text-amber-700 bg-stone-50 px-1 rounded">MODULE_ID</code> (1-100) to match the module/table ID created in Admin</li>
                <li>PN532 emulates NFC tag with menu URL; LCD updates live</li>
              </ol>
            </div>
          </div>
        )}
      </div>

      {(modal === 'addItem' || modal === 'editItem') && (
        <Modal title={modal === 'addItem' ? 'Add Menu Item' : 'Edit Menu Item'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div><label className="block text-sm text-stone-500 mb-1">Name</label><input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm text-stone-500 mb-1">Description</label><input className="input" value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="block text-sm text-stone-500 mb-1">Price ($)</label><input className="input" type="number" step="0.01" value={form.price || ''} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></div>
              <div className="flex-1"><label className="block text-sm text-stone-500 mb-1">Category</label>
                <select className="input" value={form.categoryId || ''} onChange={e => setForm(f => ({ ...f, categoryId: parseInt(e.target.value) }))}>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.available !== false} onChange={e => setForm(f => ({ ...f, available: e.target.checked }))} className="accent-amber-600" />
              <span className="text-sm text-stone-500">Available</span>
            </label>
            <div className="flex gap-3 pt-2">
              <button onClick={saveItem} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {(modal === 'addUser' || modal === 'editUser') && (
        <Modal title={modal === 'addUser' ? 'Add Staff Account' : 'Edit Staff Account'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div><label className="block text-sm text-stone-500 mb-1">Username</label><input className="input" value={form.username || ''} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoFocus /></div>
            <div><label className="block text-sm text-stone-500 mb-1">Role</label>
              <select className="input" value={form.role || 'bartender'} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="bartender">Bartender</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <div><label className="block text-sm text-stone-500 mb-1">Restaurant</label>
              <select className="input" value={form.restaurantId || ''} onChange={e => setForm(f => ({ ...f, restaurantId: parseInt(e.target.value, 10) }))}>
                {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div><label className="block text-sm text-stone-500 mb-1">Password {modal === 'editUser' ? '(leave blank to keep current)' : ''}</label><input className="input" type="password" value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveUser} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'addCat' && (
        <Modal title="Add Category" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div><label className="block text-sm text-stone-500 mb-1">Category Name</label><input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveCat} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Add'}</button>
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {(modal === 'addRestaurant' || modal === 'editRestaurant') && (
        <Modal title={modal === 'addRestaurant' ? 'Add Restaurant' : 'Edit Restaurant'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-stone-500 mb-1">Restaurant Name</label>
              <input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
            </div>
            <div>
              <label className="block text-sm text-stone-500 mb-1">Logo URL</label>
              <input className="input" placeholder="https://..." value={form.logoUrl || ''} onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveRestaurant} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {(modal === 'addTable' || modal === 'editTable') && (
        <Modal title={modal === 'addTable' ? 'Add NFC Module' : 'Edit NFC Module'} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div><label className="block text-sm text-stone-500 mb-1">Display Name</label><input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
            <div><label className="block text-sm text-stone-500 mb-1">Module ID (1-100)</label><input className="input" type="number" min="1" max="100" value={form.moduleId || ''} onChange={e => setForm(f => ({ ...f, moduleId: e.target.value }))} /></div>
            <div><label className="block text-sm text-stone-500 mb-1">ESP32 IP (optional)</label><input className="input" placeholder="192.168.1.x" value={form.esp32Ip || ''} onChange={e => setForm(f => ({ ...f, esp32Ip: e.target.value }))} /></div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveTable} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
