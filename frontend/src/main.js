import './style.css';
const api=(import.meta.env.VITE_API_URL || '').replace(/\/$/,'');
const won=n=>n.toLocaleString('ko-KR')+'원';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AUTH_KEY='unnine-auth';
const GUEST_KEY='unnine-guest';
let products=[], categories=[], selected=0, search='', enabled=false, detailId=null, authView=null, mypageView=false, authUser=null, social={kakao:false,naver:false}, myOrders=[], lookupOrder=null;
let cart=[]; try {cart=JSON.parse(localStorage.getItem('unnine-cart')||'[]').filter(x=>Number.isInteger(x.id)&&Number.isInteger(x.quantity)&&x.quantity>0&&x.quantity<=100)}catch{}

function getToken(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')?.token||''}catch{return ''}}
function isGuest(){return localStorage.getItem(GUEST_KEY)==='1'}
function setGuest(){localStorage.setItem(GUEST_KEY,'1')}
function clearGuest(){localStorage.removeItem(GUEST_KEY)}
function saveAuth(data){localStorage.setItem(AUTH_KEY,JSON.stringify(data));clearGuest();authUser=data.user;updateAccountUI()}
function clearAuth(){localStorage.removeItem(AUTH_KEY);authUser=null;updateAccountUI()}
function canCheckout(){return !!getToken()||isGuest()}

function opts(p){return (p.options&&p.options.length)?p.options:[{id:0,label:p.option||'기본',price:p.price}]}
function pickOpt(p,optionId){const list=opts(p);return list.find(o=>o.id===optionId)||list[0]}
function addonsFor(p,optionId){return (p.addons||[]).filter(a=>!a.option_ids?.length||a.option_ids.includes(optionId))}
function pickAddons(p,optionId,addonIds){const avail=addonsFor(p,optionId);const set=new Set(addonIds||[]);return avail.filter(a=>set.has(a.id))}
function lineUnit(p,optionId,addonIds){const o=pickOpt(p,optionId);return o.price+pickAddons(p,optionId,addonIds).reduce((n,a)=>n+a.price,0)}
function sameAddons(a,b){const x=[...(a||[])].sort((i,j)=>i-j).join(',');const y=[...(b||[])].sort((i,j)=>i-j).join(',');return x===y}
function image(p,cls='photo'){return `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.name)} 연출 사진" loading="lazy" decoding="async">`}
async function request(path,options={}){
  const headers={...(options.headers||{})};
  const token=getToken();
  if(token) headers.Authorization=`Bearer ${token}`;
  const r=await fetch(api+path,{...options,headers});
  const data=await r.json();
  if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'입력 내용을 확인해 주세요.');
  return data;
}

const LOGO='https://pub-236307febd5647328aae37b69df5373d.r2.dev/brand/unnine-logo-transparent.webp?v=1';

document.querySelector('#app').innerHTML=`<header><div class="top"><a href="#/" class="logo" aria-label="언니네닭 홈"><img src="${LOGO}" alt="언니네닭"></a><form id="search"><input aria-label="상품 검색" placeholder="어떤 상품을 찾으세요?"><button>검색</button></form><button type="button" id="orders-btn" class="account-btn">주문내역</button><button type="button" id="account-btn" class="account-btn">로그인</button><button id="cart-open">장바구니 <span id="count">0</span></button></div></header><main>
<section id="home-view"><section class="hero" aria-label="메인 소개"><img class="hero-bg" src="https://pub-236307febd5647328aae37b69df5373d.r2.dev/brand/hero-premium-fresh.webp?v=1" alt="" decoding="async"><div class="hero-copy"><p class="accent">우리 집 식탁을 위한 장보기</p><h1>맛있는 선택,<br>언니네닭에서.</h1><p>닭고기부터 다양한 육류까지. 필요한 상품을 편리하게 만나보세요.</p><button id="browse">상품 둘러보기</button></div></section><div class="category-nav-wrap"><nav id="nav" class="category-nav" aria-label="상품 카테고리"></nav><span class="category-nav-hint" aria-hidden="true">›</span></div><section id="catalog"><div class="title"><h2 id="title">전체상품</h2><span id="results" aria-live="polite"></span></div><p id="error" role="alert"></p><div id="grid" class="grid"></div></section></section>
<section id="product-view" class="product-view" hidden></section>
<section id="auth-view" class="auth-view" hidden></section>
<section id="mypage-view" class="mypage-view" hidden></section>
</main><footer>언니네닭 <p>상품·가격은 제공된 캡처를 바탕으로 등록한 초기 자료입니다. 상품 사진은 AI로 제작한 연출 이미지입니다.</p></footer><dialog id="cart"><div class="title"><h2>장바구니</h2><button id="cart-close" aria-label="닫기">닫기</button></div><div id="cart-lines"></div><p id="total"></p><form id="order"><h3>배송 정보</h3><label>받는 분<input name="customer_name" required maxlength="100" autocomplete="name"></label><label>연락처<input name="phone" required type="tel" pattern="0[0-9-]{8,19}" autocomplete="tel"></label><label>배송 주소<input name="address" required minlength="5" maxlength="500" autocomplete="street-address"></label><p>결제·배송비 연동 전입니다. 현재 기능은 결제 대기 상태의 주문 접수입니다.</p><button id="submit" type="submit">주문 접수</button><p id="order-message" role="status"></p></form></dialog>`;

function persist(){localStorage.setItem('unnine-cart',JSON.stringify(cart));document.querySelector('#count').textContent=cart.reduce((n,x)=>n+x.quantity,0)}
function parseRoute(){
  const h=(location.hash||'#/').replace(/^#/, '');
  if(/^\/?login/.test(h)) return {view:'login',id:null};
  if(/^\/?signup/.test(h)) return {view:'signup',id:null};
  if(/^\/?mypage/.test(h)||/^\/?orders/.test(h)) return {view:'mypage',id:null};
  const m=h.match(/^\/?product\/(\d+)/);
  return m?{view:'product',id:+m[1]}:{view:'home',id:null};
}
function goHome(){location.hash='#/'}
function goProduct(id){location.hash=`#/product/${id}`}
function goLogin(){location.hash='#/login'}
function goSignup(){location.hash='#/signup'}
function goMypage(){location.hash='#/mypage'}
function formatWhen(value){
  if(!value) return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('ko-KR');
}

function updateAccountUI(){
  const btn=document.querySelector('#account-btn');
  if(!btn)return;
  if(authUser){btn.textContent=authUser.name||authUser.username;btn.dataset.mode='user'}
  else if(isGuest()){btn.textContent='비회원';btn.dataset.mode='guest'}
  else{btn.textContent='로그인';btn.dataset.mode='login'}
}

function renderLogin(){
  const savedId=localStorage.getItem('unnine-saved-id')||'';
  return `<div class="auth-shell">
    <div class="auth-top">
      <button type="button" class="auth-icon" data-auth-back aria-label="뒤로">‹</button>
      <a href="#/" class="auth-brand" aria-label="홈"><img src="${LOGO}" alt="언니네닭"><span>언니네닭</span></a>
      <button type="button" class="auth-icon" data-auth-home aria-label="홈">⌂</button>
    </div>
    <h1 class="auth-title">로그인</h1>
    <p class="auth-lead">아이디와 비밀번호 입력하기 귀찮으시죠?<br>1초 만에 회원가입 하고 로그인 하세요</p>
    <button type="button" class="btn-kakao" data-social="kakao"><span class="social-ico">💬</span> 카카오 1초 로그인/회원가입</button>
    <button type="button" class="btn-naver" data-social="naver"><span class="social-ico">N</span> 네이버 1초 로그인/회원가입</button>
    <div class="auth-or"><span>또는</span></div>
    <form id="login-form" class="auth-form">
      <input name="username" required maxlength="50" placeholder="아이디" value="${esc(savedId)}" autocomplete="username">
      <label class="pw-wrap"><input name="password" type="password" required maxlength="100" placeholder="비밀번호" autocomplete="current-password"><button type="button" class="pw-toggle" aria-label="비밀번호 보기">👁</button></label>
      <label class="save-id"><input type="checkbox" name="save_id" ${savedId?'checked':''}> 아이디 저장</label>
      <button type="submit" class="btn-member">기존 회원 로그인</button>
    </form>
    <div class="auth-links">
      <button type="button" class="linkish" data-soon="id">아이디 찾기</button>
      <button type="button" class="linkish" data-soon="pw">비밀번호 찾기</button>
      <button type="button" class="linkish signup-link" data-go-signup>회원가입</button>
    </div>
    <button type="button" class="btn-guest" data-guest>비회원 구매</button>
    <p class="auth-msg" id="auth-msg" role="status"></p>
  </div>`;
}

function renderSignup(){
  return `<div class="auth-shell">
    <div class="auth-top">
      <button type="button" class="auth-icon" data-auth-back aria-label="뒤로">‹</button>
      <a href="#/" class="auth-brand" aria-label="홈"><img src="${LOGO}" alt="언니네닭"><span>언니네닭</span></a>
      <button type="button" class="auth-icon" data-auth-home aria-label="홈">⌂</button>
    </div>
    <h1 class="auth-title">회원가입</h1>
    <p class="auth-lead">간단한 정보만 입력하면 바로 주문할 수 있어요.</p>
    <form id="signup-form" class="auth-form">
      <input name="username" required minlength="3" maxlength="50" placeholder="아이디 (영문·숫자)" autocomplete="username">
      <input name="name" required maxlength="100" placeholder="이름" autocomplete="name">
      <input name="phone" maxlength="30" placeholder="연락처 (선택)" autocomplete="tel">
      <label class="pw-wrap"><input name="password" type="password" required minlength="4" maxlength="100" placeholder="비밀번호" autocomplete="new-password"><button type="button" class="pw-toggle" aria-label="비밀번호 보기">👁</button></label>
      <label class="pw-wrap"><input name="password2" type="password" required minlength="4" maxlength="100" placeholder="비밀번호 확인" autocomplete="new-password"><button type="button" class="pw-toggle" aria-label="비밀번호 보기">👁</button></label>
      <button type="submit" class="btn-member-primary">가입하고 로그인</button>
    </form>
    <button type="button" class="btn-guest" data-go-login>이미 회원이신가요? 로그인</button>
    <p class="auth-msg" id="auth-msg" role="status"></p>
  </div>`;
}

function optionSelect(p,selectedId){const list=opts(p);const sid=selectedId??list[0].id;if(list.length<=1)return `<p class="detail-option-one">${esc(list[0].label)}</p><input type="hidden" data-option-for="${p.id}" value="${list[0].id}">`;return `<label class="option-pick">옵션<select data-option-for="${p.id}" aria-label="${esc(p.name)} 옵션">${list.map(o=>`<option value="${o.id}" ${o.id===sid?'selected':''}>${esc(o.label)} · ${won(o.price)}</option>`).join('')}</select></label>`}
function addonSelect(p,optionId){const list=addonsFor(p,optionId);if(!list.length)return '';return `<div class="addon-pick" data-addons-for="${p.id}"><p class="detail-label">추가옵션</p>${list.map(a=>`<label class="addon-check"><input type="checkbox" data-addon-id="${a.id}" value="${a.id}"> ${esc(a.label)} <span>+${won(a.price)}</span></label>`).join('')}</div>`}
function selectedAddonIds(root){return [...(root?.querySelectorAll('[data-addon-id]:checked')||[])].map(el=>+el.value)}
function currentOptionId(root,p){const el=root.querySelector('[data-option-for]');return el?+el.value:opts(p)[0].id}

function renderGrid(){const filtered=products.filter(p=>(!selected||p.category_id===selected)&&p.name.includes(search));document.querySelector('#title').textContent=categories.find(c=>c.id===selected)?.name||'전체상품';document.querySelector('#results').textContent=filtered.length+'개 상품';document.querySelector('#grid').innerHTML=filtered.length?filtered.map(p=>{const first=opts(p)[0];const more=opts(p).length>1||(p.addons||[]).length;return `<article class="product-card" data-open-product="${p.id}" tabindex="0" role="link" aria-label="${esc(p.name)} 상세 보기">${image(p)}<h3>${esc(p.name)}</h3><p class="card-option">${esc(first.label)}${more?' 외':''}</p><div class="price"><strong>${won(first.price)}${more?'~':''}</strong><button type="button" data-open-product="${p.id}">자세히</button></div></article>`}).join(''):'<p class="empty">등록된 상품이 없습니다.</p>';document.querySelectorAll('[data-category]').forEach(e=>e.classList.toggle('active',+e.dataset.category===selected))}

function renderDetail(){
  const view=document.querySelector('#product-view');
  const p=products.find(x=>x.id===detailId);
  if(!p){view.innerHTML=`<div class="detail-missing"><p>상품을 찾을 수 없습니다.</p><button type="button" data-back-home>목록으로</button></div>`;return}
  const cat=categories.find(c=>c.id===p.category_id);
  const first=opts(p)[0];
  view.innerHTML=`<div class="detail" data-product-detail="${p.id}">
    <button type="button" class="detail-back" data-back-home>← 목록으로</button>
    <div class="detail-grid">
      <div class="detail-media">${image(p,'photo detail-photo')}</div>
      <div class="detail-info">
        <p class="detail-cat">${esc(cat?.name||'')}</p>
        <h1>${esc(p.name)}</h1>
        <p class="detail-price"><strong data-price>${won(first.price)}</strong></p>
        <div class="detail-fields">
          <p class="detail-label">옵션</p>
          ${optionSelect(p,first.id)}
          ${addonSelect(p,first.id)}
          <label class="qty-pick">수량<input type="number" min="1" max="100" value="1" data-detail-qty aria-label="수량"></label>
        </div>
        <div class="detail-actions">
          <button type="button" data-detail-add>장바구니 담기</button>
        </div>
        <p class="detail-msg" data-detail-msg hidden></p>
      </div>
    </div>
  </div>`;
}

function orderHistoryCard(o){
  const items=(o.items||[]).map(i=>{
    const addons=(i.addons||[]).map(a=>`${esc(a.label)}`).join(', ');
    return `<li>${esc(i.name)}${i.option?` / ${esc(i.option)}`:''} × ${i.quantity}${addons?` <span class="muted">(+${addons})</span>`:''}</li>`;
  }).join('');
  return `<article class="my-order">
    <div class="my-order-head">
      <div>
        <p class="my-order-date">${formatWhen(o.created_at)}</p>
        <p class="muted">주문번호 ${esc(o.id)}</p>
      </div>
      <div class="my-order-badges">
        <span class="status-chip">${esc(o.status_label||o.status)}</span>
        <strong>${won(o.total)}</strong>
      </div>
    </div>
    <ul class="my-order-items">${items||'<li>상품 정보 없음</li>'}</ul>
    <div class="my-order-meta">
      <p><strong>결제/진행</strong> ${esc(o.payment_label||o.status_label||o.status)}</p>
      <p><strong>받는 분</strong> ${esc(o.customer_name)} · ${esc(o.phone)}</p>
      <p><strong>배송지</strong> ${esc(o.address)}</p>
    </div>
  </article>`;
}

function renderMypage(){
  const view=document.querySelector('#mypage-view');
  const loggedIn=!!authUser;
  const list=lookupOrder?[lookupOrder]:myOrders;
  view.innerHTML=`<div class="mypage">
    <div class="mypage-top">
      <button type="button" class="detail-back" data-back-home>← 쇼핑 계속하기</button>
      ${loggedIn?`<button type="button" class="account-btn" data-logout>로그아웃</button>`:''}
    </div>
    <h1>주문·결제 내역</h1>
    <p class="mypage-lead">${loggedIn?`${esc(authUser.name||authUser.username)}님의 주문과 결제 진행 상태입니다.`:'로그인하면 내 주문을 한눈에 볼 수 있습니다. 비회원은 주문번호로 조회하세요.'}</p>
    ${loggedIn?'':`
      <div class="mypage-actions">
        <button type="button" data-go-login>로그인하고 내 주문 보기</button>
        <button type="button" class="account-btn" data-go-signup>회원가입</button>
      </div>
      <form id="lookup-form" class="lookup-form">
        <h2>비회원 주문 조회</h2>
        <input name="order_id" required placeholder="주문번호" autocomplete="off">
        <input name="phone" required type="tel" placeholder="주문 시 연락처" autocomplete="tel">
        <button type="submit">조회하기</button>
        <p class="auth-msg" id="lookup-msg" role="status"></p>
      </form>
    `}
    <div class="my-order-list" id="my-order-list">
      ${list.length?list.map(orderHistoryCard).join(''):`<section class="empty-orders mypage-empty">
        <h2>${loggedIn?'주문 내역이 없습니다':'조회된 주문이 없습니다'}</h2>
        <p>${loggedIn?'상품을 담고 주문하면 이곳에 표시됩니다.':'주문 접수 후 안내된 주문번호와 연락처로 조회해 주세요.'}</p>
      </section>`}
    </div>
  </div>`;
}

async function loadMyOrders(){
  if(!getToken()){myOrders=[];return}
  try{myOrders=await request('/api/my/orders')}catch{myOrders=[]}
}

function showView(){
  const route=parseRoute();
  detailId=route.view==='product'?route.id:null;
  authView=route.view==='login'||route.view==='signup'?route.view:null;
  mypageView=route.view==='mypage';
  const home=document.querySelector('#home-view');
  const product=document.querySelector('#product-view');
  const auth=document.querySelector('#auth-view');
  const mypage=document.querySelector('#mypage-view');
  const header=document.querySelector('header');
  const footer=document.querySelector('footer');
  if(authView){
    home.hidden=true;product.hidden=true;auth.hidden=false;mypage.hidden=true;
    header.classList.add('auth-mode');footer.classList.add('auth-mode');
    auth.innerHTML=authView==='signup'?renderSignup():renderLogin();
    window.scrollTo({top:0,behavior:'smooth'});
  }else if(mypageView){
    home.hidden=true;product.hidden=true;auth.hidden=true;mypage.hidden=false;
    header.classList.remove('auth-mode');footer.classList.remove('auth-mode');
    loadMyOrders().then(()=>{renderMypage();window.scrollTo({top:0,behavior:'smooth'})});
  }else if(detailId){
    home.hidden=true;product.hidden=false;auth.hidden=true;mypage.hidden=true;
    header.classList.remove('auth-mode');footer.classList.remove('auth-mode');
    renderDetail();window.scrollTo({top:0,behavior:'smooth'});
  }else{
    home.hidden=false;product.hidden=true;auth.hidden=true;mypage.hidden=true;
    header.classList.remove('auth-mode');footer.classList.remove('auth-mode');
    renderGrid();updateCategoryHint();
  }
}

function refreshDetailAddons(root){
  const p=products.find(x=>x.id===+root.dataset.productDetail);if(!p)return;
  const optionId=currentOptionId(root,p);
  const prev=selectedAddonIds(root);
  let box=root.querySelector('[data-addons-for]');
  const html=addonSelect(p,optionId);
  const fields=root.querySelector('.detail-fields');
  if(!html){box?.remove()}
  else if(box){box.outerHTML=html}
  else{fields.querySelector('.qty-pick').insertAdjacentHTML('beforebegin',html)}
  box=root.querySelector('[data-addons-for]');
  prev.forEach(id=>{const el=box?.querySelector(`[data-addon-id="${id}"]`);if(el)el.checked=true});
  updateDetailPrice(root);
}
function updateDetailPrice(root){
  const p=products.find(x=>x.id===+root.dataset.productDetail);if(!p)return;
  const el=root.querySelector('[data-price]');
  if(el)el.textContent=won(lineUnit(p,currentOptionId(root,p),selectedAddonIds(root)));
}

function cartRender(){let total=0;document.querySelector('#cart-lines').innerHTML=cart.map((line,index)=>{const p=products.find(p=>p.id===line.id);if(!p)return '';const o=pickOpt(p,line.optionId);const extras=pickAddons(p,line.optionId,line.addonIds);const unit=lineUnit(p,line.optionId,line.addonIds);total+=unit*line.quantity;const extraText=extras.length?`<br><span class="cart-addons">${extras.map(a=>esc(a.label)+' +'+won(a.price)).join(', ')}</span>`:'';return `<div class="line"><div>${esc(p.name)}<br><span>${esc(o.label)}</span>${extraText}<br><strong>${won(unit)}</strong></div><label>수량<input type="number" min="1" max="100" value="${line.quantity}" data-quantity-index="${index}"></label><button data-remove-index="${index}">삭제</button></div>`}).join('')||'<p>장바구니가 비어 있습니다.</p>';document.querySelector('#total').textContent='상품 합계 '+won(total);document.querySelector('#submit').disabled=!enabled||!cart.length;document.querySelector('#submit').textContent=enabled?'주문 접수':'주문 준비 중'}

function addToCart(p,optionId,addonIds,quantity){
  const line=cart.find(x=>x.id===p.id&&x.optionId===optionId&&sameAddons(x.addonIds,addonIds));
  if(line)line.quantity=Math.min(100,line.quantity+quantity);
  else cart.push({id:p.id,optionId,addonIds,quantity});
  persist();
}

function afterAuthSuccess(){
  updateAccountUI();
  goHome();
  cartRender();
  document.querySelector('#cart').showModal();
}

document.querySelector('#grid').addEventListener('click',e=>{
  const open=e.target.closest('[data-open-product]');
  if(!open)return;
  goProduct(+open.dataset.openProduct);
});
document.querySelector('#grid').addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const open=e.target.closest('[data-open-product]');
  if(!open)return;
  e.preventDefault();
  goProduct(+open.dataset.openProduct);
});

document.querySelector('#product-view').addEventListener('click',e=>{
  if(e.target.closest('[data-back-home]')){goHome();return}
  const add=e.target.closest('[data-detail-add]');
  if(!add)return;
  const root=e.target.closest('[data-product-detail]');
  const p=products.find(x=>x.id===+root.dataset.productDetail);if(!p)return;
  addToCart(p,currentOptionId(root,p),selectedAddonIds(root),Math.max(1,Math.min(100,Math.trunc(+root.querySelector('[data-detail-qty]').value)||1)));
  const msg=root.querySelector('[data-detail-msg]');
  msg.hidden=false;msg.textContent='장바구니에 담았습니다.';
  add.textContent='담았어요';
  setTimeout(()=>{add.textContent='장바구니 담기'},900);
});
document.querySelector('#product-view').addEventListener('change',e=>{
  const root=e.target.closest('[data-product-detail]');if(!root)return;
  if(e.target.closest('[data-option-for]')){refreshDetailAddons(root);return}
  if(e.target.closest('[data-addon-id]'))updateDetailPrice(root);
});

document.querySelector('#auth-view').addEventListener('click',async e=>{
  if(e.target.closest('[data-auth-back]')||e.target.closest('[data-auth-home]')){goHome();return}
  if(e.target.closest('[data-go-signup]')){goSignup();return}
  if(e.target.closest('[data-go-login]')){goLogin();return}
  if(e.target.closest('[data-guest]')){setGuest();updateAccountUI();afterAuthSuccess();return}
  if(e.target.closest('[data-soon]')){const msg=document.querySelector('#auth-msg');if(msg)msg.textContent='준비 중인 기능입니다.';return}
  const toggle=e.target.closest('.pw-toggle');
  if(toggle){
    const input=toggle.parentElement.querySelector('input');
    input.type=input.type==='password'?'text':'password';
    return;
  }
  const socialBtn=e.target.closest('[data-social]');
  if(socialBtn){
    const provider=socialBtn.dataset.social;
    const msg=document.querySelector('#auth-msg');
    try{
      const data=await request(`/api/auth/social/${provider}/start`);
      if(data.url) location.href=data.url;
    }catch(error){
      if(msg) msg.textContent=error.message;
    }
  }
});

document.querySelector('#auth-view').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=document.querySelector('#auth-msg');
  if(e.target.id==='login-form'){
    const fd=new FormData(e.target);
    const username=String(fd.get('username')||'').trim();
    const password=String(fd.get('password')||'');
    if(fd.get('save_id')) localStorage.setItem('unnine-saved-id',username);
    else localStorage.removeItem('unnine-saved-id');
    msg.textContent='로그인 중…';
    try{
      const data=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
      saveAuth(data);
      afterAuthSuccess();
    }catch(error){msg.textContent=error.message}
    return;
  }
  if(e.target.id==='signup-form'){
    const fd=new FormData(e.target);
    const password=String(fd.get('password')||'');
    const password2=String(fd.get('password2')||'');
    if(password!==password2){msg.textContent='비밀번호가 일치하지 않습니다.';return}
    msg.textContent='가입 중…';
    try{
      const data=await request('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        username:String(fd.get('username')||'').trim(),
        name:String(fd.get('name')||'').trim(),
        phone:String(fd.get('phone')||'').trim(),
        password,
      })});
      saveAuth(data);
      afterAuthSuccess();
    }catch(error){msg.textContent=error.message}
  }
});

document.querySelector('#nav').addEventListener('click',e=>{
  const button=e.target.closest('[data-category]');if(!button)return;
  selected=+button.dataset.category;
  if(detailId||authView||mypageView)goHome();
  else{renderGrid();document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})}
});
document.querySelector('#search').onsubmit=e=>{
  e.preventDefault();
  search=e.target.querySelector('input').value.trim();
  if(detailId||authView||mypageView)goHome();
  else{renderGrid();document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})}
};
document.querySelector('#browse').onclick=()=>{if(detailId||authView||mypageView)goHome();document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})};
document.querySelector('.logo').addEventListener('click',e=>{e.preventDefault();goHome()});

document.querySelector('#orders-btn').onclick=()=>goMypage();
document.querySelector('#account-btn').onclick=async ()=>{
  const mode=document.querySelector('#account-btn').dataset.mode;
  if(mode==='user'||mode==='guest'){goMypage();return}
  goLogin();
};

document.querySelector('#mypage-view').addEventListener('click',async e=>{
  if(e.target.closest('[data-back-home]')){goHome();return}
  if(e.target.closest('[data-go-login]')){goLogin();return}
  if(e.target.closest('[data-go-signup]')){goSignup();return}
  if(e.target.closest('[data-logout]')){
    try{await request('/api/auth/logout',{method:'POST'})}catch{}
    clearAuth();lookupOrder=null;myOrders=[];renderMypage();
  }
});
document.querySelector('#mypage-view').addEventListener('submit',async e=>{
  if(e.target.id!=='lookup-form')return;
  e.preventDefault();
  const msg=document.querySelector('#lookup-msg');
  const fd=new FormData(e.target);
  msg.textContent='조회 중…';
  try{
    lookupOrder=await request('/api/orders/lookup',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({order_id:String(fd.get('order_id')||'').trim(),phone:String(fd.get('phone')||'').trim()}),
    });
    renderMypage();
  }catch(error){
    lookupOrder=null;
    msg.textContent=error.message;
  }
});

document.querySelector('#cart-open').onclick=()=>{cartRender();document.querySelector('#cart').showModal()};
document.querySelector('#cart-close').onclick=()=>document.querySelector('#cart').close();
document.querySelector('#cart-lines').addEventListener('click',e=>{if(e.target.dataset.removeIndex==null)return;cart.splice(+e.target.dataset.removeIndex,1);persist();cartRender()});
document.querySelector('#cart-lines').addEventListener('change',e=>{if(e.target.dataset.quantityIndex==null)return;const line=cart[+e.target.dataset.quantityIndex];if(!line)return;line.quantity=Math.max(1,Math.min(100,Math.trunc(+e.target.value)||1));persist();cartRender()});
document.querySelector('#order').onsubmit=async e=>{
  e.preventDefault();
  if(!canCheckout()){
    document.querySelector('#cart').close();
    goLogin();
    return;
  }
  const button=document.querySelector('#submit'),message=document.querySelector('#order-message');
  button.disabled=true;message.textContent='주문 접수 중…';
  try{
    const values=Object.fromEntries(new FormData(e.target));
    const result=await request('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,items:cart.map(x=>({product_id:x.id,option_id:x.optionId||undefined,quantity:x.quantity,addons:(x.addonIds||[]).map(id=>({addon_id:id,quantity:1}))}))})});
    cart=[];persist();cartRender();e.target.reset();
    localStorage.setItem('unnine-last-order',result.order_id);
    message.textContent=`주문이 접수됐습니다. 번호 ${result.order_id} · 상품 합계 ${won(result.total)} · 결제 대기`;
    message.innerHTML+=` <button type="button" class="linkish" id="goto-mypage">내역 보기</button>`;
    document.querySelector('#goto-mypage')?.addEventListener('click',()=>{document.querySelector('#cart').close();goMypage()});
  }catch(error){message.textContent=error.message;button.disabled=!enabled||!cart.length}
};

function navButton(c){const img=c.image?`<img src="${esc(c.image)}" alt="" loading="lazy">`:'';return `<button type="button" class="cat" data-category="${c.id}">${img}<span>${esc(c.name)}</span></button>`}
async function init(){
  try{
    if(!api)throw new Error('API 주소가 설정되지 않았습니다. VITE_API_URL을 설정해 주세요.');
    let allImage='';
    let cfg;
    [categories,products,cfg]=await Promise.all([request('/api/categories'),request('/api/products'),request('/api/config')]);
    enabled=cfg.orders_enabled;allImage=cfg.all_category_image||'';social=cfg.social||social;
    if(getToken()){
      try{authUser=await request('/api/auth/me')}catch{clearAuth()}
    }
    cart=cart.map(x=>{const p=products.find(p=>p.id===x.id);if(!p)return null;const optionId=x.optionId??opts(p)[0].id;const addonIds=(x.addonIds||[]).filter(id=>addonsFor(p,optionId).some(a=>a.id===id));return {id:x.id,optionId,addonIds,quantity:x.quantity}}).filter(Boolean);
    document.querySelector('#nav').innerHTML=[{id:0,name:'전체상품',image:allImage},...categories].map(navButton).join('');
    updateAccountUI();persist();showView();
  }catch(error){document.querySelector('#error').textContent=error.message}
}

function updateCategoryHint(){const nav=document.querySelector('#nav'),wrap=document.querySelector('.category-nav-wrap');if(!nav||!wrap||document.querySelector('#home-view').hidden)return;const more=nav.scrollWidth-nav.clientWidth-nav.scrollLeft>8;wrap.classList.toggle('has-more',more)}
document.querySelector('#nav')?.addEventListener('scroll',updateCategoryHint,{passive:true});
window.addEventListener('resize',updateCategoryHint);
window.addEventListener('hashchange',showView);

persist();init();
