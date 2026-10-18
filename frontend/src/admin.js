import './admin.css'

const api = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const won = (n) => Number(n).toLocaleString('ko-KR') + '원'
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const KEY = 'unnine-admin-key'
let adminKey = localStorage.getItem(KEY) || ''
let products = []
let categories = []

const app = document.querySelector('#app')
app.innerHTML = `
  <div class="wrap">
    <div class="top">
      <h1>상품 관리</h1>
      <div class="auth">
        <input id="admin-key" type="password" placeholder="관리자 키" autocomplete="current-password" value="${esc(adminKey)}">
        <button type="button" id="login">불러오기</button>
        <a href="/">스토어로</a>
      </div>
    </div>
    <p class="status" id="status">관리자 키를 입력한 뒤 불러오기를 눌러 주세요.</p>
    <div class="list" id="list"></div>
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

function card(p) {
  const cat = categories.find((c) => c.id === p.category_id)
  return `
    <article class="card" data-product="${p.id}">
      <div>
        <img src="${esc(p.image || '')}" alt="${esc(p.name)}" id="preview-${p.id}">
        <div class="actions">
          <label class="secondary" style="display:inline-block;padding:10px 16px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer">
            이미지 업로드
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-upload="${p.id}">
          </label>
        </div>
      </div>
      <div class="meta">
        <h2>${esc(p.name)}</h2>
        <p class="muted">#${p.id} · ${esc(cat?.name || '카테고리')}</p>
        <div class="row">
          <label>상품명<input data-field="name" value="${esc(p.name)}"></label>
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
          <button type="button" data-save="${p.id}">저장</button>
        </div>
        <p class="msg" data-msg hidden></p>
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

function render() {
  document.querySelector('#list').innerHTML = products.map(card).join('') || '<p>등록된 상품이 없습니다.</p>'
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
    ;[categories, products] = await Promise.all([
      request('/api/categories'),
      request('/api/admin/products'),
    ])
    render()
    setStatus(`상품 ${products.length}개`)
  } catch (error) {
    products = []
    render()
    setStatus(error.message, true)
  }
}

document.querySelector('#login').onclick = load
document.querySelector('#admin-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') load()
})

document.querySelector('#list').addEventListener('click', async (e) => {
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
    const product = products.find((p) => p.id === +cardEl.dataset.product)
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

  const saveId = +e.target.closest('[data-save]')?.dataset.save
  if (!saveId) return
  const cardEl = e.target.closest('[data-product]')
  const msg = cardEl.querySelector('[data-msg]')
  const options = readOptions(cardEl)
  if (!options.length) {
    msg.hidden = false
    msg.className = 'err'
    msg.textContent = '옵션을 1개 이상 입력해 주세요.'
    return
  }
  const body = {
    name: cardEl.querySelector('[data-field="name"]').value.trim(),
    category_id: Number(cardEl.querySelector('[data-field="category_id"]').value),
    active: cardEl.querySelector('[data-field="active"]').value === 'true',
    options,
    addons: readAddons(cardEl),
  }
  e.target.disabled = true
  msg.hidden = false
  msg.className = 'msg'
  msg.textContent = '저장 중…'
  try {
    const updated = await request(`/api/admin/products/${saveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const idx = products.findIndex((p) => p.id === saveId)
    if (idx >= 0) products[idx] = updated
    render()
    const fresh = document.querySelector(`[data-product="${saveId}"] [data-msg]`)
    if (fresh) {
      fresh.hidden = false
      fresh.className = 'msg'
      fresh.textContent = `저장됨 · 본옵션 ${updated.options.length} · 추가옵션 ${(updated.addons || []).length}`
    }
  } catch (error) {
    msg.className = 'err'
    msg.textContent = error.message
    e.target.disabled = false
  }
})

document.querySelector('#list').addEventListener('change', async (e) => {
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

if (adminKey) load()
