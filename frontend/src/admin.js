import './admin.css'

const api = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const won = (n) => Number(n).toLocaleString('ko-KR') + '원'
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const KEY = 'unnine-admin-key'
const STATUSES = [
  ['pending_payment', '결제 대기'],
  ['paid', '결제 완료'],
  ['preparing', '상품 준비중'],
  ['shipping', '배송중'],
  ['completed', '완료'],
  ['cancelled', '취소'],
]

let adminKey = localStorage.getItem(KEY) || ''
let products = []
let categories = []
let orders = []
let tab = 'products'

const app = document.querySelector('#app')
app.innerHTML = `
  <div class="wrap">
    <div class="top">
      <h1 id="page-title">상품 관리</h1>
      <div class="auth">
        <input id="admin-key" type="password" placeholder="관리자 키" autocomplete="current-password" value="${esc(adminKey)}">
        <button type="button" id="login">불러오기</button>
        <button type="button" id="new-product" class="secondary" hidden>새 상품 추가</button>
        <a href="/">스토어로</a>
      </div>
    </div>
    <nav class="tabs" id="tabs" hidden>
      <button type="button" class="tab is-active" data-tab="products">상품</button>
      <button type="button" class="tab" data-tab="orders">주문</button>
    </nav>
    <p class="status" id="status">관리자 키를 입력한 뒤 불러오기를 눌러 주세요.</p>
    <div id="panel-products" class="list"></div>
    <div id="panel-orders" class="order-list" hidden></div>
  </div>
`

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (adminKey) headers['X-Admin-Key'] = adminKey
  const r = await fetch(api + path, { ...options, headers })
  let data = null
  const text = await r.text()
  try { data = text ? JSON.parse(text) : null } catch { data = { detail: text } }
  if (!r.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : '요청에 실패했습니다.')
  return data
}

function setStatus(msg, isError = false) {
  const el = document.querySelector('#status')
  el.textContent = msg
  el.style.color = isError ? '#b42318' : '#666'
}

function optionRows(product) {
  const opts = product.options?.length ? product.options : [{ id: null, label: product.option || '', price: product.price || 0 }]
  return opts.map((o, i) => `
    <div class="option-row" data-option-index="${i}">
      <input data-field="label" value="${esc(o.label || '')}" placeholder="옵션명 (예: 500g)" ${o.id ? `data-id="${o.id}"` : ''}>
      <input data-field="price" type="number" min="0" step="10" value="${o.price ?? 0}" placeholder="가격">
      <button type="button" class="danger" data-remove-option>삭제</button>
    </div>
  `).join('')
}

function addonLinkChecks(product, addon) {
  const opts = (product.options || []).filter((o) => o.id)
  if (!opts.length) return '<p class="muted">본옵션을 먼저 저장하면 연계할 수 있습니다. 비우면 전체 옵션에 적용됩니다.</p>'
  const linked = new Set(addon.option_ids || [])
  return `<div class="link-checks">${opts.map((o) => `
    <label class="check"><input type="checkbox" data-link-option="${o.id}" ${linked.has(o.id) ? 'checked' : ''}> ${esc(o.label)}</label>
  `).join('')}<p class="hint">체크 없으면 모든 본옵션에 노출</p></div>`
}

function addonRows(product) {
  const addons = product.addons || []
  if (!addons.length) return ''
  return addons.map((a, i) => `
    <div class="addon-row" data-addon-index="${i}">
      <div class="option-row">
        <input data-field="addon-label" value="${esc(a.label || '')}" placeholder="추가옵션명 (예: 소스 추가)" ${a.id ? `data-id="${a.id}"` : ''}>
        <input data-field="addon-price" type="number" min="0" step="10" value="${a.price ?? 0}" placeholder="추가금">
        <button type="button" class="danger" data-remove-addon>삭제</button>
      </div>
      ${addonLinkChecks(product, a)}
    </div>
  `).join('')
}

function blankProduct() {
  const category_id = categories[0]?.id || 1
  return {
    id: 'new',
    name: '',
    category_id,
    active: true,
    image: '',
    option: '기본',
    price: 0,
    options: [{ id: null, label: '기본', price: 0 }],
    addons: [],
  }
}

function card(p) {
  const isNew = p.id === 'new'
  const cat = categories.find((c) => c.id === p.category_id)
  const previewId = isNew ? 'preview-new' : `preview-${p.id}`
  return `
    <article class="card ${isNew ? 'is-new' : ''}" data-product="${p.id}">
      <div>
        <img src="${esc(p.image || '')}" alt="${esc(p.name || '새 상품')}" id="${previewId}" style="background:#fcf2ec">
        <div class="actions">
          ${isNew ? '<p class="muted">저장 후 이미지를 업로드할 수 있습니다.</p>' : `
          <label class="secondary" style="display:inline-block;padding:10px 16px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer">
            이미지 업로드
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-upload="${p.id}">
          </label>`}
        </div>
      </div>
      <div class="meta">
        <h2>${isNew ? '새 상품' : esc(p.name)}</h2>
        <p class="muted">${isNew ? '신규 등록' : `#${p.id} · ${esc(cat?.name || '카테고리')}`}</p>
        <div class="row">
          <label>상품명<input data-field="name" value="${esc(p.name)}" placeholder="상품명"></label>
          <label>카테고리
            <select data-field="category_id">
              ${categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <label>판매
            <select data-field="active">
              <option value="true" ${p.active !== false ? 'selected' : ''}>판매중</option>
              <option value="false" ${p.active === false ? 'selected' : ''}>숨김</option>
            </select>
          </label>
        </div>
        <h3 class="section-title">본옵션</h3>
        <div class="options" data-options>${optionRows(p)}</div>
        <div class="actions">
          <button type="button" class="secondary" data-add-option>옵션 추가</button>
        </div>
        <h3 class="section-title">추가옵션</h3>
        <p class="muted">본옵션과 함께 고르는 항목입니다. 특정 본옵션에만 보이게 연계할 수 있습니다.</p>
        <div class="addons" data-addons>${addonRows(p)}</div>
        <div class="actions">
          <button type="button" class="secondary" data-add-addon>추가옵션 추가</button>
          <button type="button" data-save="${p.id}">${isNew ? '상품 등록' : '저장'}</button>
          ${isNew ? '<button type="button" class="secondary" data-cancel-new>취소</button>' : ''}
        </div>
        <p class="msg" data-msg hidden></p>
      </div>
    </article>
  `
}

function formatWhen(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('ko-KR')
}

function orderCard(o) {
  const items = (o.items || []).map((i) => {
    const addons = (i.addons || []).map((a) => `${esc(a.label)}×${a.quantity}`).join(', ')
    return `<li>${esc(i.name)} / ${esc(i.option || '-')} × ${i.quantity} · ${won(i.unit_price)}${addons ? `<br><span class="muted">추가: ${addons}</span>` : ''}</li>`
  }).join('')
  return `
    <article class="order-card" data-order="${esc(o.id)}">
      <div class="order-head">
        <div>
          <h2>${esc(o.customer_name)}</h2>
          <p class="muted">${formatWhen(o.created_at)} · ${esc(o.id)}</p>
        </div>
        <strong>${won(o.total)}</strong>
      </div>
      <div class="order-meta">
        <p><strong>연락처</strong> ${esc(o.phone)}</p>
        <p><strong>주소</strong> ${esc(o.address)}</p>
      </div>
      <ul class="order-items">${items || '<li>상품 없음</li>'}</ul>
      <div class="order-actions">
        <label>상태
          <select data-order-status="${esc(o.id)}">
            ${STATUSES.map(([value, label]) => `<option value="${value}" ${o.status === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <button type="button" data-save-status="${esc(o.id)}">상태 저장</button>
        <span class="msg" data-order-msg hidden></span>
      </div>
    </article>
  `
}

function readOptions(cardEl) {
  return [...cardEl.querySelectorAll('[data-option-index]')].map((row) => {
    const label = row.querySelector('[data-field="label"]').value.trim()
    const price = Math.trunc(Number(row.querySelector('[data-field="price"]').value) || 0)
    const id = Number(row.querySelector('[data-field="label"]').dataset.id) || undefined
    return id ? { id, label, price } : { label, price }
  }).filter((o) => o.label)
}

function readAddons(cardEl) {
  return [...cardEl.querySelectorAll('[data-addon-index]')].map((row) => {
    const labelEl = row.querySelector('[data-field="addon-label"]')
    const label = labelEl.value.trim()
    const price = Math.trunc(Number(row.querySelector('[data-field="addon-price"]').value) || 0)
    const id = Number(labelEl.dataset.id) || undefined
    const option_ids = [...row.querySelectorAll('[data-link-option]:checked')].map((el) => +el.dataset.linkOption)
    const item = { label, price, option_ids }
    if (id) item.id = id
    return item
  }).filter((o) => o.label)
}

function setTab(next) {
  tab = next
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('is-active', el.dataset.tab === tab))
  document.querySelector('#panel-products').hidden = tab !== 'products'
  document.querySelector('#panel-orders').hidden = tab !== 'orders'
  document.querySelector('#new-product').hidden = tab !== 'products' || !categories.length
  document.querySelector('#page-title').textContent = tab === 'orders' ? '주문 관리' : '상품 관리'
  if (tab === 'products') {
    setStatus(`상품 ${products.filter((p) => p.id !== 'new').length}개`)
  } else {
    setStatus(`주문 ${orders.length}건`)
  }
}

function renderProducts() {
  document.querySelector('#panel-products').innerHTML = products.map(card).join('') || '<p>등록된 상품이 없습니다.</p>'
  document.querySelector('#new-product').hidden = tab !== 'products' || !categories.length
}

function renderOrders() {
  const panel = document.querySelector('#panel-orders')
  if (orders.length) {
    panel.innerHTML = orders.map(orderCard).join('')
    return
  }
  panel.innerHTML = `
    <section class="empty-orders">
      <h2>아직 주문이 없습니다</h2>
      <p>스토어에서 주문이 접수되면 이 탭에 목록이 나타납니다.</p>
      <ul>
        <li>고객이 장바구니에서 배송 정보를 넣고 주문합니다.</li>
        <li>여기에 주문자·연락처·주소·상품·금액이 표시됩니다.</li>
        <li>상태를 바꿔 결제 대기 → 준비중 → 배송중 → 완료로 관리합니다.</li>
      </ul>
      <p class="muted">주문이 안 들어오면 Railway의 <code>ORDERS_ENABLED=true</code> 설정을 확인해 주세요.</p>
      <div class="status-guide">
        ${STATUSES.map(([, label]) => `<span>${label}</span>`).join('')}
      </div>
    </section>
  `
}

async function load() {
  if (!api) {
    setStatus('VITE_API_URL이 설정되지 않았습니다.', true)
    return
  }
  adminKey = document.querySelector('#admin-key').value.trim()
  localStorage.setItem(KEY, adminKey)
  setStatus('불러오는 중…')
  try {
    ;[categories, products, orders] = await Promise.all([
      request('/api/categories'),
      request('/api/admin/products'),
      request('/api/admin/orders'),
    ])
    document.querySelector('#tabs').hidden = false
    renderProducts()
    renderOrders()
    setTab(tab)
  } catch (error) {
    products = []
    orders = []
    document.querySelector('#tabs').hidden = true
    document.querySelector('#new-product').hidden = true
    renderProducts()
    renderOrders()
    setStatus(error.message, true)
  }
}

document.querySelector('#login').onclick = load
document.querySelector('#admin-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') load()
})
document.querySelector('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]')
  if (!btn) return
  setTab(btn.dataset.tab)
})
document.querySelector('#new-product').onclick = () => {
  setTab('products')
  if (!categories.length) {
    setStatus('카테고리를 먼저 불러와 주세요.', true)
    return
  }
  if (products.some((p) => p.id === 'new')) {
    document.querySelector('[data-product="new"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  products = [blankProduct(), ...products]
  renderProducts()
  document.querySelector('[data-product="new"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

document.querySelector('#panel-products').addEventListener('click', async (e) => {
  if (e.target.closest('[data-cancel-new]')) {
    products = products.filter((p) => p.id !== 'new')
    renderProducts()
    return
  }

  const addBtn = e.target.closest('[data-add-option]')
  if (addBtn) {
    const box = addBtn.closest('.meta').querySelector('[data-options]')
    const i = box.querySelectorAll('[data-option-index]').length
    box.insertAdjacentHTML('beforeend', `
      <div class="option-row" data-option-index="${i}">
        <input data-field="label" value="" placeholder="옵션명 (예: 1kg)">
        <input data-field="price" type="number" min="0" step="10" value="0" placeholder="가격">
        <button type="button" class="danger" data-remove-option>삭제</button>
      </div>
    `)
    return
  }

  if (e.target.closest('[data-remove-option]')) {
    const rows = e.target.closest('[data-options]').querySelectorAll('[data-option-index]')
    if (rows.length <= 1) {
      alert('옵션은 최소 1개 필요합니다.')
      return
    }
    e.target.closest('[data-option-index]').remove()
    return
  }

  const addAddon = e.target.closest('[data-add-addon]')
  if (addAddon) {
    const cardEl = addAddon.closest('[data-product]')
    const product = products.find((p) => String(p.id) === String(cardEl.dataset.product))
    const box = cardEl.querySelector('[data-addons]')
    const i = box.querySelectorAll('[data-addon-index]').length
    box.insertAdjacentHTML('beforeend', `
      <div class="addon-row" data-addon-index="${i}">
        <div class="option-row">
          <input data-field="addon-label" value="" placeholder="추가옵션명 (예: 소스 추가)">
          <input data-field="addon-price" type="number" min="0" step="10" value="0" placeholder="추가금">
          <button type="button" class="danger" data-remove-addon>삭제</button>
        </div>
        ${addonLinkChecks(product || { options: [] }, { option_ids: [] })}
      </div>
    `)
    return
  }

  if (e.target.closest('[data-remove-addon]')) {
    e.target.closest('[data-addon-index]').remove()
    return
  }

  const saveBtn = e.target.closest('[data-save]')
  if (!saveBtn) return
  const saveRaw = saveBtn.dataset.save
  const isNew = saveRaw === 'new'
  const saveId = isNew ? 'new' : +saveRaw
  const cardEl = e.target.closest('[data-product]')
  const msg = cardEl.querySelector('[data-msg]')
  const name = cardEl.querySelector('[data-field="name"]').value.trim()
  const options = readOptions(cardEl)
  if (!name) {
    msg.hidden = false
    msg.className = 'err'
    msg.textContent = '상품명을 입력해 주세요.'
    return
  }
  if (!options.length) {
    msg.hidden = false
    msg.className = 'err'
    msg.textContent = '옵션을 1개 이상 입력해 주세요.'
    return
  }
  const body = {
    name,
    category_id: Number(cardEl.querySelector('[data-field="category_id"]').value),
    active: cardEl.querySelector('[data-field="active"]').value === 'true',
    options,
    addons: readAddons(cardEl),
  }
  saveBtn.disabled = true
  msg.hidden = false
  msg.className = 'msg'
  msg.textContent = isNew ? '등록 중…' : '저장 중…'
  try {
    const updated = isNew
      ? await request('/api/admin/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      : await request(`/api/admin/products/${saveId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
    if (isNew) {
      products = products.filter((p) => p.id !== 'new')
      products.unshift(updated)
    } else {
      const idx = products.findIndex((p) => p.id === saveId)
      if (idx >= 0) products[idx] = updated
    }
    renderProducts()
    const fresh = document.querySelector(`[data-product="${updated.id}"]`)
    fresh?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const freshMsg = fresh?.querySelector('[data-msg]')
    if (freshMsg) {
      freshMsg.hidden = false
      freshMsg.className = 'msg'
      freshMsg.textContent = isNew
        ? `등록됨 #${updated.id} · 이제 이미지를 업로드하세요`
        : `저장됨 · 본옵션 ${updated.options.length} · 추가옵션 ${(updated.addons || []).length}`
    }
    setStatus(`상품 ${products.filter((p) => p.id !== 'new').length}개`)
  } catch (error) {
    msg.className = 'err'
    msg.textContent = error.message
    saveBtn.disabled = false
  }
})

document.querySelector('#panel-products').addEventListener('change', async (e) => {
  const input = e.target.closest('[data-upload]')
  if (!input || !input.files?.[0]) return
  const productId = +input.dataset.upload
  const file = input.files[0]
  const msg = input.closest('.card').querySelector('[data-msg]')
  const form = new FormData()
  form.append('file', file)
  msg.hidden = false
  msg.className = 'msg'
  msg.textContent = '이미지 업로드 중…'
  try {
    const result = await request(`/api/admin/products/${productId}/image`, { method: 'POST', body: form })
    const idx = products.findIndex((p) => p.id === productId)
    if (idx >= 0) products[idx].image = result.image
    const preview = document.querySelector(`#preview-${productId}`)
    if (preview) preview.src = result.image + '?t=' + Date.now()
    msg.textContent = '이미지 반영됨'
  } catch (error) {
    msg.className = 'err'
    msg.textContent = error.message
  } finally {
    input.value = ''
  }
})

document.querySelector('#panel-orders').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-save-status]')
  if (!btn) return
  const orderId = btn.dataset.saveStatus
  const cardEl = e.target.closest('[data-order]')
  const select = cardEl.querySelector('[data-order-status]')
  const msg = cardEl.querySelector('[data-order-msg]')
  btn.disabled = true
  msg.hidden = false
  msg.className = 'msg'
  msg.textContent = '저장 중…'
  try {
    const updated = await request(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: select.value }),
    })
    const idx = orders.findIndex((o) => o.id === orderId)
    if (idx >= 0) orders[idx] = updated
    renderOrders()
    const fresh = document.querySelector(`[data-order="${CSS.escape(orderId)}"] [data-order-msg]`)
    if (fresh) {
      fresh.hidden = false
      fresh.className = 'msg'
      fresh.textContent = `상태 변경: ${updated.status_label || updated.status}`
    }
  } catch (error) {
    msg.className = 'err'
    msg.textContent = error.message
    btn.disabled = false
  }
})

if (adminKey) load()
