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
let customers = []
let customerDetail = null
let customerQuery = ''
let tab = 'products'
let productCategoryId = 0
let orderStatusFilter = 'all'
let orderPeriod = '7d'
let orderDateFrom = ''
let orderDateTo = ''
let orderQuery = ''
let openOrderId = null
let ordersLoading = false
const ORDER_PERIODS = [
  ['today', '오늘'],
  ['yesterday', '어제'],
  ['7d', '최근 7일'],
  ['30d', '최근 30일'],
  ['all', '전체'],
]

function kstTodayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (t) => parts.find((p) => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function hasCustomOrderDates() {
  return !!(orderDateFrom || orderDateTo)
}

const app = document.querySelector('#app')
app.innerHTML = `
  <div class="wrap">
    <div class="top">
      <h1 id="page-title">상품 관리</h1>
      <div class="auth">
        <input id="admin-key" type="password" placeholder="관리자 키" autocomplete="current-password" value="${esc(adminKey)}">
        <button type="button" id="login">로그인</button>
        <button type="button" id="logout" class="secondary" hidden>로그아웃</button>
        <button type="button" id="new-product" class="secondary" hidden>새 상품 추가</button>
        <a href="/">쇼핑몰로</a>
      </div>
    </div>
    <nav class="tabs" id="tabs" hidden>
      <button type="button" class="tab is-active" data-tab="products">상품</button>
      <button type="button" class="tab" data-tab="orders">주문</button>
      <button type="button" class="tab" data-tab="customers">고객</button>
    </nav>
    <p class="status" id="status">관리자 키를 입력한 뒤 로그인하세요.</p>
    <div id="panel-products" class="panel list"></div>
    <div id="panel-orders" class="panel order-list is-hidden" hidden></div>
    <div id="panel-customers" class="panel customer-panel is-hidden" hidden></div>
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

function formatOrderWhen(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function orderNeedsAction(o) {
  if (o.status === 'pending_payment') return '결제대기'
  if (o.status === 'paid') return '상품준비'
  if (o.status === 'preparing' && !o.tracking_number) return '운송장'
  if (o.status === 'shipping' && !o.tracking_number) return '운송장'
  return ''
}

function statusLabel(status) {
  return STATUSES.find(([value]) => value === status)?.[1] || status
}

function orderItemSummary(o) {
  const items = o.items || []
  if (!items.length) return '상품 없음'
  const first = items[0]
  const more = items.length - 1
  const base = `${first.name}${first.option ? `/${first.option}` : ''} ×${first.quantity}`
  return more > 0 ? `${base} 외 ${more}건` : base
}

function orderStatusCounts() {
  const counts = { all: orders.length }
  for (const [value] of STATUSES) counts[value] = 0
  for (const o of orders) counts[o.status] = (counts[o.status] || 0) + 1
  return counts
}

function filteredOrders() {
  const q = orderQuery.trim().toLowerCase()
  return orders.filter((o) => {
    if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false
    if (!q) return true
    const blob = `${o.id} ${o.customer_name} ${o.phone} ${o.address} ${o.tracking_number || ''} ${(o.items || []).map((i) => i.name).join(' ')}`.toLowerCase()
    return blob.includes(q)
  })
}

function orderToolbarHtml() {
  const counts = orderStatusCounts()
  const custom = hasCustomOrderDates()
  const list = filteredOrders()
  const periods = ORDER_PERIODS.map(([value, label]) => {
    const on = !custom && orderPeriod === value
    return `<button type="button" class="order-period${on ? ' is-active' : ''}" data-order-period="${value}">${label}</button>`
  }).join('')
  const statusCards = [['all', '전체'], ...STATUSES].map(([value, label]) => {
    const on = orderStatusFilter === value
    const count = counts[value] || 0
    return `<button type="button" class="order-stat${on ? ' is-active' : ''}" data-order-filter="${value}">
      <strong>${count}</strong>
      <span>${label}</span>
    </button>`
  }).join('')
  const periodLabel = custom
    ? `${orderDateFrom || '…'} ~ ${orderDateTo || '…'}`
    : (ORDER_PERIODS.find(([v]) => v === orderPeriod)?.[1] || '최근 7일')
  const maxDay = kstTodayIso()
  const resetOn = orderQuery || orderStatusFilter !== 'all' || orderPeriod !== '7d' || custom
  return `
    <div class="order-console">
      <section class="order-box">
        <div class="order-box-title">
          <h2>1. 언제 주문?</h2>
          <p>빠른 기간을 고르거나, 달력으로 직접 지정하세요.</p>
        </div>
        <div class="order-period-row" role="tablist" aria-label="조회 기간">${periods}</div>
        <div class="order-calendar-row">
          <label class="order-date-field">시작일
            <input id="order-date-from" type="date" value="${esc(orderDateFrom)}" max="${esc(maxDay)}">
          </label>
          <span class="order-date-sep">~</span>
          <label class="order-date-field">종료일
            <input id="order-date-to" type="date" value="${esc(orderDateTo)}" max="${esc(maxDay)}">
          </label>
          <button type="button" class="secondary${custom ? ' is-active-date' : ''}" data-order-calendar>달력 적용</button>
        </div>
      </section>

      <section class="order-box">
        <div class="order-box-title">
          <h2>2. 어떤 상태?</h2>
          <p>처리가 필요한 주문을 상태로 바로 골라보세요.</p>
        </div>
        <div class="order-stats" role="tablist" aria-label="주문 상태">${statusCards}</div>
      </section>

      <section class="order-box order-box-search">
        <div class="order-box-title">
          <h2>3. 검색</h2>
          <p>주문번호, 이름, 연락처, 운송장으로 찾습니다.</p>
        </div>
        <div class="order-search">
          <input id="order-q" type="search" value="${esc(orderQuery)}" placeholder="예: 홍길동 / 010- / 운송장번호" autocomplete="off">
          <button type="button" data-order-search>검색</button>
          ${resetOn ? '<button type="button" class="secondary" data-order-reset>조건 초기화</button>' : ''}
        </div>
      </section>

      <div class="order-result-bar">
        <div>
          <strong>${esc(periodLabel)}</strong>
          <span>${orderStatusFilter === 'all' ? '전체 상태' : statusLabel(orderStatusFilter)} · 결과 <b>${list.length}</b>건</span>
        </div>
        <span class="muted">${ordersLoading ? '불러오는 중…' : `서버 로드 ${orders.length}건 · 최대 500건`}</span>
      </div>
    </div>
  `
}

function orderRow(o) {
  const open = openOrderId === o.id
  const action = orderNeedsAction(o)
  const items = (o.items || []).map((i) => {
    const addons = (i.addons || []).map((a) => `${esc(a.label)}×${a.quantity}`).join(', ')
    return `<li>${esc(i.name)} / ${esc(i.option || '-')} × ${i.quantity} · ${won(i.unit_price)}${addons ? `<br><span class="muted">추가: ${addons}</span>` : ''}</li>`
  }).join('')
  return `
    <article class="order-row${open ? ' is-open' : ''}${action ? ' needs-action' : ''}" data-order="${esc(o.id)}">
      <button type="button" class="order-row-main" data-toggle-order="${esc(o.id)}">
        <span class="o-status">
          <span class="status-pill status-${esc(o.status)}">${esc(o.status_label || statusLabel(o.status))}</span>
          ${action ? `<em class="action-tag">${esc(action)}</em>` : ''}
        </span>
        <span class="o-buyer">
          <strong>${esc(o.customer_name)}</strong>
          <em>${esc(o.phone || '-')}</em>
        </span>
        <span class="o-items">
          <strong>${esc(orderItemSummary(o))}</strong>
          <em>${esc(formatOrderWhen(o.created_at))} · ${esc(o.id)}</em>
        </span>
        <span class="o-total">${won(o.total)}</span>
        <span class="o-track">${o.tracking_number ? `CJ ${esc(o.tracking_number)}` : '<em class="muted">운송장 없음</em>'}</span>
        <span class="o-more">${open ? '접기 ▲' : '처리하기 ▼'}</span>
      </button>
      <div class="order-row-detail" ${open ? '' : 'hidden'}>
        <div class="order-detail-grid">
          <div>
            <h3>배송지</h3>
            <p><strong>${esc(o.customer_name)}</strong> · ${esc(o.phone)}</p>
            <p>${esc(o.address)}</p>
            <p class="muted">주문 ${esc(formatWhen(o.created_at))}</p>
          </div>
          <div>
            <h3>주문 상품</h3>
            <ul class="order-items">${items || '<li>상품 없음</li>'}</ul>
          </div>
        </div>
        <div class="order-actions">
          <label>진행 상태
            <select data-order-status="${esc(o.id)}">
              ${STATUSES.map(([value, label]) => `<option value="${value}" ${o.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <button type="button" data-save-status="${esc(o.id)}">상태 저장</button>
          <label>CJ 운송장
            <input class="tracking-input" data-tracking="${esc(o.id)}" value="${esc(o.tracking_number || '')}" inputmode="numeric" maxlength="20" placeholder="숫자만 입력">
          </label>
          <button type="button" data-save-tracking="${esc(o.id)}">운송장 저장</button>
          <span class="msg" data-order-msg hidden></span>
        </div>
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

function providerLabel(p) {
  if (p === 'kakao') return '카카오'
  if (p === 'naver') return '네이버'
  if (p === 'guest') return '비회원'
  return '회원'
}

function setTab(next) {
  tab = ['products', 'orders', 'customers'].includes(next) ? next : 'products'
  const panels = {
    products: document.querySelector('#panel-products'),
    orders: document.querySelector('#panel-orders'),
    customers: document.querySelector('#panel-customers'),
  }
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('is-active', el.dataset.tab === tab))
  Object.entries(panels).forEach(([name, el]) => {
    const on = name === tab
    el.classList.toggle('is-hidden', !on)
    el.hidden = !on
    el.style.display = on ? '' : 'none'
  })
  document.querySelector('#new-product').hidden = tab !== 'products' || !categories.length
  const titles = { products: '상품 관리', orders: '주문 관리', customers: '고객 관리' }
  document.querySelector('#page-title').textContent = titles[tab]
  if (tab === 'products') updateProductStatus()
  if (tab === 'orders') {
    if (!orders.length && adminKey && !ordersLoading) loadOrders()
    else renderOrders()
  }
  if (tab === 'customers') {
    renderCustomers()
    setStatus(`고객 ${customers.length}명`)
  }
}

function sortedProducts() {
  const rank = new Map(categories.map((c, i) => [c.id, i]))
  return [...products].sort((a, b) => {
    if (a.id === 'new') return -1
    if (b.id === 'new') return 1
    const ca = rank.get(a.category_id) ?? 1e9
    const cb = rank.get(b.category_id) ?? 1e9
    return ca - cb || Number(a.id) - Number(b.id)
  })
}

function filteredProducts() {
  const list = sortedProducts()
  if (!productCategoryId) return list
  return list.filter((p) => p.id === 'new' || p.category_id === productCategoryId)
}

function updateProductStatus() {
  const total = products.filter((p) => p.id !== 'new').length
  if (!productCategoryId) {
    setStatus(`상품 ${total}개 · 카테고리별 보기`)
    return
  }
  const cat = categories.find((c) => c.id === productCategoryId)
  const count = products.filter((p) => p.id !== 'new' && p.category_id === productCategoryId).length
  setStatus(`${cat?.name || '카테고리'} ${count}개 / 전체 ${total}개`)
}

function categoryFilterHtml() {
  const items = [{ id: 0, name: '전체상품', image: '' }, ...categories]
  return `
    <div class="product-filter" role="tablist" aria-label="상품 카테고리">
      ${items.map((c) => {
        const count = c.id
          ? products.filter((p) => p.id !== 'new' && p.category_id === c.id).length
          : products.filter((p) => p.id !== 'new').length
        const on = productCategoryId === c.id
        const img = c.image ? `<img src="${esc(c.image)}" alt="">` : ''
        return `<button type="button" class="cat-chip${on ? ' is-active' : ''}" data-product-cat="${c.id}" role="tab" aria-selected="${on}">
          ${img}<span>${esc(c.name)}</span><em>${count}</em>
        </button>`
      }).join('')}
    </div>
  `
}

function renderProducts() {
  const panel = document.querySelector('#panel-products')
  const list = filteredProducts()
  if (!products.length) {
    panel.innerHTML = `${categoryFilterHtml()}<p>등록된 상품이 없습니다.</p>`
    document.querySelector('#new-product').hidden = tab !== 'products' || !categories.length
    updateProductStatus()
    return
  }
  let body = ''
  if (!productCategoryId) {
    const draft = list.filter((p) => p.id === 'new')
    const byCat = new Map(categories.map((c) => [c.id, []]))
    const orphan = []
    for (const p of list) {
      if (p.id === 'new') continue
      if (byCat.has(p.category_id)) byCat.get(p.category_id).push(p)
      else orphan.push(p)
    }
    body = draft.map(card).join('')
    for (const c of categories) {
      const rows = byCat.get(c.id) || []
      if (!rows.length) continue
      body += `<section class="product-group" data-group="${c.id}">
        <header class="product-group-head">
          ${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}
          <div>
            <h2>${esc(c.name)}</h2>
            <p>${rows.length}개 상품</p>
          </div>
        </header>
        <div class="product-group-list">${rows.map(card).join('')}</div>
      </section>`
    }
    if (orphan.length) {
      body += `<section class="product-group">
        <header class="product-group-head"><div><h2>기타</h2><p>${orphan.length}개 상품</p></div></header>
        <div class="product-group-list">${orphan.map(card).join('')}</div>
      </section>`
    }
  } else {
    body = list.map(card).join('') || '<p class="empty-cat">이 카테고리에 등록된 상품이 없습니다.</p>'
  }
  panel.innerHTML = `${categoryFilterHtml()}${body}`
  document.querySelector('#new-product').hidden = tab !== 'products' || !categories.length
  updateProductStatus()
}

function updateOrderStatus() {
  const list = filteredOrders()
  const periodLabel = hasCustomOrderDates()
    ? `${orderDateFrom || '…'} ~ ${orderDateTo || '…'}`
    : (ORDER_PERIODS.find(([v]) => v === orderPeriod)?.[1] || '최근 7일')
  if (!orders.length) {
    setStatus(`${periodLabel} 주문 0건`)
    return
  }
  const label = orderStatusFilter === 'all' ? '상태 전체' : statusLabel(orderStatusFilter)
  setStatus(`${periodLabel} · ${label} ${list.length}건 (로드 ${orders.length}건)`)
}

async function loadOrders({ keepOpen = false } = {}) {
  if (!adminKey) return
  ordersLoading = true
  renderOrders()
  try {
    const params = new URLSearchParams()
    if (hasCustomOrderDates()) {
      if (orderDateFrom) params.set('date_from', orderDateFrom)
      if (orderDateTo) params.set('date_to', orderDateTo)
    } else {
      params.set('period', orderPeriod || '7d')
    }
    if (orderQuery.trim()) params.set('q', orderQuery.trim())
    orders = await request(`/api/admin/orders?${params}`)
    if (!keepOpen) openOrderId = null
  } finally {
    ordersLoading = false
    renderOrders()
  }
}

function renderOrders() {
  const panel = document.querySelector('#panel-orders')
  if (!orders.length) {
    panel.innerHTML = `
      ${orderToolbarHtml()}
      <section class="empty-orders">
        <h2>아직 주문이 없습니다</h2>
        <p>스토어에서 주문이 접수되면 이 탭에 목록이 나타납니다.</p>
        <ul>
          <li>고객이 장바구니에서 배송 정보를 넣고 주문합니다.</li>
          <li>상태 칩으로 결제대기·준비중·배송중을 나눠 봅니다.</li>
          <li>행을 눌러 상세·운송장을 처리합니다.</li>
        </ul>
        <p class="muted">주문이 안 들어오면 Railway의 <code>ORDERS_ENABLED=true</code> 설정을 확인해 주세요.</p>
      </section>
    `
    updateOrderStatus()
    return
  }
  const list = filteredOrders()
  panel.innerHTML = `
    ${orderToolbarHtml()}
    <div class="order-table" role="table" aria-label="주문 목록">
      <div class="order-table-head" role="row">
        <span>상태</span><span>구매자</span><span>상품 / 주문정보</span><span>금액</span><span>운송장</span><span>처리</span>
      </div>
      <div class="order-table-body">
        ${list.length ? list.map(orderRow).join('') : `
          <div class="empty-cat">
            <strong>조건에 맞는 주문이 없습니다.</strong>
            <p>기간·상태를 바꾸거나 검색어를 지워 보세요.</p>
          </div>`}
      </div>
    </div>
  `
  updateOrderStatus()
}

function customerRow(c) {
  return `
    <button type="button" class="customer-row" data-open-customer="${esc(String(c.id))}">
      <div>
        <strong>${esc(c.name || c.username || '고객')}</strong>
        <span class="pill">${providerLabel(c.provider)}</span>
        ${c.blocked ? '<span class="pill danger">차단</span>' : ''}
        <p class="muted">${esc(c.username ? `@${c.username}` : '비회원')} · ${esc(c.phone || '-')}</p>
      </div>
      <div class="customer-stats">
        <span>주문 ${c.order_count || 0}건</span>
        <strong>${won(c.order_total || 0)}</strong>
      </div>
    </button>
  `
}

function customerDetailView(c) {
  const ordersHtml = (c.orders || []).length
    ? c.orders.map((o) => `
      <div class="customer-order">
        <div><strong>${won(o.total)}</strong> · ${esc(o.status_label || o.status)}</div>
        <p class="muted">${formatWhen(o.created_at)} · ${esc(o.id)}</p>
        <p>${esc(o.address || '')}</p>
        <p class="muted">${o.tracking_number ? `CJ대한통운 ${esc(o.tracking_number)}` : '운송장 등록 전'}</p>
      </div>
    `).join('')
    : '<p class="muted">주문 내역이 없습니다.</p>'
  const editable = !c.is_guest && !String(c.id).startsWith('guest:')
  return `
    <section class="customer-detail" data-customer-id="${esc(String(c.id))}">
      <button type="button" class="secondary" data-back-customers>← 목록</button>
      <h2>${esc(c.name || c.username || '고객')} <span class="pill">${providerLabel(c.provider)}</span></h2>
      <p class="muted">${editable ? `@${esc(c.username)}` : '비회원'} · ${esc(c.phone || '-')} · 가입/최근 ${formatWhen(c.created_at)}</p>
      <p><strong>누적</strong> 주문 ${c.order_count || 0}건 · ${won(c.order_total || 0)}</p>
      ${editable ? `
      <label class="block-label">CS 메모
        <textarea data-customer-note rows="4" placeholder="통화·배송 메모">${esc(c.note || '')}</textarea>
      </label>
      <label class="check"><input type="checkbox" data-customer-blocked ${c.blocked ? 'checked' : ''}> 이용 차단</label>
      <div class="actions">
        <button type="button" data-save-customer>고객 정보 저장</button>
        <span class="msg" data-customer-msg hidden></span>
      </div>` : '<p class="muted">비회원은 주문 내역만 확인할 수 있습니다.</p>'}
      <h3 class="section-title">주문 내역</h3>
      <div class="customer-orders">${ordersHtml}</div>
    </section>
  `
}

function renderCustomers() {
  const panel = document.querySelector('#panel-customers')
  if (customerDetail) {
    panel.innerHTML = customerDetailView(customerDetail)
    return
  }
  panel.innerHTML = `
    <div class="customer-toolbar">
      <input id="customer-q" type="search" placeholder="이름·아이디·연락처 검색" value="${esc(customerQuery)}">
      <button type="button" class="secondary" data-search-customers>검색</button>
    </div>
    <div class="customer-list">
      ${customers.length ? customers.map(customerRow).join('') : `
        <section class="empty-orders">
          <h2>등록된 고객이 없습니다</h2>
          <p>회원가입·주문 고객이 생기면 여기에 표시됩니다.</p>
          <ul>
            <li>회원: 아이디/이름/연락처, 주문 수·누적금액</li>
            <li>비회원: 연락처 기준으로 주문을 묶어 표시</li>
            <li>회원 상세에서 CS 메모·이용 차단을 저장할 수 있습니다</li>
          </ul>
        </section>`}
    </div>
  `
}

async function openCustomer(id) {
  setStatus('고객 불러오는 중…')
  try {
    customerDetail = await request(`/api/admin/customers/${encodeURIComponent(id)}`)
    renderCustomers()
    setStatus(`${customerDetail.name || customerDetail.username || '고객'} 상세`)
  } catch (error) {
    setStatus(error.message, true)
  }
}

async function loadCustomers() {
  const q = customerQuery ? `?q=${encodeURIComponent(customerQuery)}` : ''
  customers = await request(`/api/admin/customers${q}`)
  customerDetail = null
}

function updateAuthUI(loggedIn) {
  const keyInput = document.querySelector('#admin-key')
  const loginBtn = document.querySelector('#login')
  const logoutBtn = document.querySelector('#logout')
  const tabs = document.querySelector('#tabs')
  const newProduct = document.querySelector('#new-product')
  if (keyInput) {
    keyInput.hidden = !!loggedIn
    if (loggedIn) keyInput.setAttribute('hidden', '')
    else keyInput.removeAttribute('hidden')
  }
  if (loginBtn) {
    loginBtn.hidden = !!loggedIn
    loginBtn.disabled = false
    loginBtn.textContent = '로그인'
  }
  if (logoutBtn) {
    logoutBtn.hidden = !loggedIn
    if (loggedIn) logoutBtn.removeAttribute('hidden')
    else logoutBtn.setAttribute('hidden', '')
  }
  if (tabs) tabs.hidden = !loggedIn
  if (newProduct && !loggedIn) newProduct.hidden = true
}

function clearAdminSession() {
  adminKey = ''
  localStorage.removeItem(KEY)
  products = []
  categories = []
  orders = []
  customers = []
  customerDetail = null
  customerQuery = ''
  productCategoryId = 0
  orderStatusFilter = 'all'
  orderPeriod = '7d'
  orderDateFrom = ''
  orderDateTo = ''
  orderQuery = ''
  openOrderId = null
  tab = 'products'
  const keyInput = document.querySelector('#admin-key')
  if (keyInput) keyInput.value = ''
  document.querySelector('#panel-products').innerHTML = ''
  document.querySelector('#panel-orders').innerHTML = ''
  document.querySelector('#panel-customers').innerHTML = ''
  updateAuthUI(false)
  document.querySelector('#page-title').textContent = '관리자'
  setStatus('관리자 키를 입력한 뒤 로그인하세요.')
}

async function load() {
  if (!api) {
    setStatus('VITE_API_URL이 설정되지 않았습니다.', true)
    return
  }
  const keyInput = document.querySelector('#admin-key')
  adminKey = (keyInput?.value || '').trim()
  if (!adminKey) {
    setStatus('관리자 키를 입력해 주세요.', true)
    keyInput?.focus()
    return
  }
  localStorage.setItem(KEY, adminKey)
  const loginBtn = document.querySelector('#login')
  if (loginBtn) {
    loginBtn.disabled = true
    loginBtn.textContent = '로그인 중…'
  }
  setStatus('로그인 중…')
  try {
    ;[categories, products] = await Promise.all([
      request('/api/categories'),
      request('/api/admin/products'),
    ])
    await Promise.all([loadOrders({ keepOpen: false }), loadCustomers()])
    updateAuthUI(true)
    renderProducts()
    renderCustomers()
    setTab(tab)
  } catch (error) {
    products = []
    orders = []
    customers = []
    localStorage.removeItem(KEY)
    adminKey = ''
    updateAuthUI(false)
    document.querySelector('#panel-products').innerHTML = ''
    document.querySelector('#panel-orders').innerHTML = ''
    document.querySelector('#panel-customers').innerHTML = ''
    setStatus(error.message || '로그인에 실패했습니다. 키를 확인해 주세요.', true)
  }
}

document.querySelector('#login').onclick = load
document.querySelector('#logout').onclick = () => clearAdminSession()
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
  const catBtn = e.target.closest('[data-product-cat]')
  if (catBtn) {
    productCategoryId = Number(catBtn.dataset.productCat) || 0
    renderProducts()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
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
  const periodBtn = e.target.closest('[data-order-period]')
  if (periodBtn) {
    orderPeriod = periodBtn.dataset.orderPeriod || '7d'
    orderDateFrom = ''
    orderDateTo = ''
    openOrderId = null
    loadOrders().catch((error) => setStatus(error.message, true))
    return
  }
  if (e.target.closest('[data-order-calendar]')) {
    const fromEl = document.querySelector('#order-date-from')
    const toEl = document.querySelector('#order-date-to')
    orderDateFrom = fromEl?.value || ''
    orderDateTo = toEl?.value || ''
    if (!orderDateFrom && !orderDateTo) {
      setStatus('시작일 또는 종료일을 선택해 주세요.', true)
      return
    }
    if (orderDateFrom && orderDateTo && orderDateFrom > orderDateTo) {
      setStatus('종료일이 시작일보다 빠를 수 없습니다.', true)
      return
    }
    openOrderId = null
    loadOrders().catch((error) => setStatus(error.message, true))
    return
  }
  const filterBtn = e.target.closest('[data-order-filter]')
  if (filterBtn) {
    orderStatusFilter = filterBtn.dataset.orderFilter || 'all'
    openOrderId = null
    renderOrders()
    return
  }
  if (e.target.closest('[data-order-search]')) {
    orderQuery = document.querySelector('#order-q')?.value || ''
    openOrderId = null
    loadOrders().catch((error) => setStatus(error.message, true))
    return
  }
  if (e.target.closest('[data-order-reset]')) {
    orderQuery = ''
    orderStatusFilter = 'all'
    orderPeriod = '7d'
    orderDateFrom = ''
    orderDateTo = ''
    openOrderId = null
    loadOrders().catch((error) => setStatus(error.message, true))
    return
  }
  const toggle = e.target.closest('[data-toggle-order]')
  if (toggle) {
    const id = toggle.dataset.toggleOrder
    openOrderId = openOrderId === id ? null : id
    renderOrders()
    return
  }

  const statusBtn = e.target.closest('[data-save-status]')
  if (statusBtn) {
    const orderId = statusBtn.dataset.saveStatus
    const cardEl = e.target.closest('[data-order]')
    const select = cardEl.querySelector('[data-order-status]')
    const msg = cardEl.querySelector('[data-order-msg]')
    statusBtn.disabled = true
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
      openOrderId = orderId
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
      statusBtn.disabled = false
    }
    return
  }

  const trackBtn = e.target.closest('[data-save-tracking]')
  if (!trackBtn) return
  const orderId = trackBtn.dataset.saveTracking
  const cardEl = e.target.closest('[data-order]')
  const input = cardEl.querySelector('[data-tracking]')
  const msg = cardEl.querySelector('[data-order-msg]')
  trackBtn.disabled = true
  msg.hidden = false
  msg.className = 'msg'
  msg.textContent = '운송장 저장 중…'
  try {
    const updated = await request(`/api/admin/orders/${encodeURIComponent(orderId)}/tracking`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracking_number: input.value }),
    })
    const idx = orders.findIndex((o) => o.id === orderId)
    if (idx >= 0) orders[idx] = updated
    openOrderId = orderId
    renderOrders()
    const fresh = document.querySelector(`[data-order="${CSS.escape(orderId)}"] [data-order-msg]`)
    if (fresh) {
      fresh.hidden = false
      fresh.className = 'msg'
      fresh.textContent = updated.tracking_number
        ? `CJ대한통운 ${updated.tracking_number} 저장 · ${updated.status_label}`
        : '운송장을 지웠습니다.'
    }
  } catch (error) {
    msg.className = 'err'
    msg.textContent = error.message
    trackBtn.disabled = false
  }
})

document.querySelector('#panel-orders').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.id !== 'order-q') return
  e.preventDefault()
  orderQuery = e.target.value || ''
  openOrderId = null
  loadOrders().catch((error) => setStatus(error.message, true))
})

document.querySelector('#panel-customers').addEventListener('click', async (e) => {
  if (e.target.closest('[data-back-customers]')) {
    customerDetail = null
    renderCustomers()
    setStatus(`고객 ${customers.length}명`)
    return
  }
  if (e.target.closest('[data-search-customers]')) {
    customerQuery = document.querySelector('#customer-q')?.value.trim() || ''
    try {
      await loadCustomers()
      renderCustomers()
      setStatus(`고객 ${customers.length}명`)
    } catch (error) {
      setStatus(error.message, true)
    }
    return
  }
  const open = e.target.closest('[data-open-customer]')
  if (open) {
    openCustomer(open.dataset.openCustomer)
    return
  }
  const save = e.target.closest('[data-save-customer]')
  if (!save) return
  const root = e.target.closest('[data-customer-id]')
  const id = root.dataset.customerId
  const msg = root.querySelector('[data-customer-msg]')
  save.disabled = true
  msg.hidden = false
  msg.className = 'msg'
  msg.textContent = '저장 중…'
  try {
    customerDetail = await request(`/api/admin/customers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: root.querySelector('[data-customer-note]')?.value || '',
        blocked: !!root.querySelector('[data-customer-blocked]')?.checked,
      }),
    })
    const idx = customers.findIndex((c) => String(c.id) === String(id))
    if (idx >= 0) {
      customers[idx] = {
        ...customers[idx],
        note: customerDetail.note,
        blocked: customerDetail.blocked,
      }
    }
    renderCustomers()
    const fresh = document.querySelector('[data-customer-msg]')
    if (fresh) {
      fresh.hidden = false
      fresh.className = 'msg'
      fresh.textContent = '저장됨'
    }
  } catch (error) {
    msg.className = 'err'
    msg.textContent = error.message
    save.disabled = false
  }
})

document.querySelector('#panel-customers').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.id !== 'customer-q') return
  e.preventDefault()
  document.querySelector('[data-search-customers]')?.click()
})

updateAuthUI(false)
if (adminKey) load()
else setStatus('관리자 키를 입력한 뒤 로그인하세요.')
