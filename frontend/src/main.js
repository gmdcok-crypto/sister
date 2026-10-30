import './style.css';
const api=(import.meta.env.VITE_API_URL || '').replace(/\/$/,'');
const won=n=>n.toLocaleString('ko-KR')+'원';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AUTH_KEY='unnine-auth';
const GUEST_KEY='unnine-guest';
let products=[], categories=[], selected=0, search='', enabled=false, detailId=null, authView=null, mypageView=false, authUser=null, social={kakao:false,naver:false}, payment={card_enabled:false,store_id:'',channel_key_card:''}, myOrders=[], lookupOrder=null, savedAddresses=[], selectedAddressId=null, addressFormMode='list', editingAddressId=null;
const PAY_PENDING_KEY='unnine-pay-pending';
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

document.querySelector('#app').innerHTML=`<header class="${parseRoute().view==='home'?'home-mode':''}"><div class="top"><a href="#/" class="logo" aria-label="언니네닭 홈"><img src="${LOGO}" alt="언니네닭"></a><form id="search"><input aria-label="상품 검색" placeholder="어떤 상품을 찾으세요?"><button>검색</button></form><div class="top-actions"><button type="button" id="orders-btn" class="account-btn">주문내역</button><button type="button" id="account-btn" class="account-btn">로그인</button><button id="cart-open">장바구니 <span id="count">0</span></button></div></div></header><main>
<section id="home-view"><section class="hero" aria-label="메인 소개"><img class="hero-bg" src="https://pub-236307febd5647328aae37b69df5373d.r2.dev/brand/hero-premium-fresh.webp?v=1" alt="" decoding="async"><a href="#/" class="hero-logo" aria-label="언니네닭 홈"><img src="${LOGO}" alt="언니네닭"></a><div class="hero-copy"><p class="accent">우리 집 식탁을 위한 장보기</p><h1>맛있는 선택,<br>언니네닭에서.</h1><p>닭고기부터 다양한 육류까지. 필요한 상품을 편리하게 만나보세요.</p><button id="browse">상품 둘러보기</button></div></section><div class="category-nav-wrap"><nav id="nav" class="category-nav" aria-label="상품 카테고리"></nav><span class="category-nav-hint" aria-hidden="true">›</span></div><section id="catalog"><div class="title"><h2 id="title">전체상품</h2><span id="results" aria-live="polite"></span></div><p id="error" role="alert"></p><div id="grid" class="grid"></div></section></section>
<section id="product-view" class="product-view" hidden></section>
<section id="auth-view" class="auth-view" hidden></section>
<section id="mypage-view" class="mypage-view" hidden></section>
</main><div id="pay-status" class="pay-status" hidden role="status"></div><footer>언니네닭 <p>상품·가격은 제공된 캡처를 바탕으로 등록한 초기 자료입니다. 상품 사진은 AI로 제작한 연출 이미지입니다.</p></footer><dialog id="cart"><div class="title"><h2>장바구니</h2><button id="cart-close" aria-label="닫기">닫기</button></div><div id="cart-lines"></div><p id="total"></p><form id="order"><h3>배송 정보</h3><div id="address-book" class="address-book" hidden></div><div id="address-fields" class="address-fields"><label class="addr-label-field" hidden>배송지명<input name="label" maxlength="40" placeholder="예: 집, 회사" autocomplete="off"></label><label>받는 분<input name="customer_name" required maxlength="100" autocomplete="name"></label><label>연락처<input name="phone" required type="tel" pattern="0[0-9-]{8,19}" autocomplete="tel"></label><div class="addr-search-block"><label class="addr-zip-label">우편번호<span class="addr-zip-row"><input name="zonecode" readonly maxlength="10" placeholder="우편번호" autocomplete="postal-code"><button type="button" class="account-btn" data-postcode-search>주소찾기</button></span></label><label>기본 주소<input name="address_base" readonly required minlength="5" maxlength="400" placeholder="주소찾기로 검색해 주세요" autocomplete="street-address"></label><label>상세 주소<input name="address_detail" maxlength="200" placeholder="동·호수 등 상세주소" autocomplete="address-line2"></label><input type="hidden" name="address" value=""></div><label class="check-row" id="save-address-wrap" hidden><input type="checkbox" id="save-address"> 이 배송지를 주소록에 저장</label></div><p id="checkout-note">주문 접수 후 카드 결제를 진행합니다. 배송비는 별도 안내될 수 있습니다.</p><button id="submit" type="submit">주문 접수</button><p id="order-message" role="status"></p></form></dialog>`;

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
function goLogin(){
  // 비회원 고정 시 헤더가 로그인으로 안 열리는 문제 방지
  if(isGuest())clearGuest();
  updateAccountUI();
  location.hash='#/login';
}
function goSignup(){
  if(isGuest())clearGuest();
  updateAccountUI();
  location.hash='#/signup';
}
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

function optionSelect(p,selectedId){const list=opts(p);const sid=selectedId??list[0].id;if(list.length<=1){const hidden=`<input type="hidden" data-option-for="${p.id}" value="${list[0].id}">`;if(!list[0].label||list[0].label==='기본')return hidden;return `<p class="detail-option-one">${esc(list[0].label)}</p>${hidden}`}return `<label class="option-pick">옵션<select data-option-for="${p.id}" aria-label="${esc(p.name)} 옵션">${list.map(o=>`<option value="${o.id}" ${o.id===sid?'selected':''}>${esc(o.label)} · ${won(o.price)}</option>`).join('')}</select></label>`}
function addonSelect(p,optionId){const list=addonsFor(p,optionId);if(!list.length)return '';return `<div class="addon-pick" data-addons-for="${p.id}"><p class="detail-label">추가옵션</p>${list.map(a=>`<label class="addon-check"><input type="checkbox" data-addon-id="${a.id}" value="${a.id}"> ${esc(a.label)} <span>+${won(a.price)}</span></label>`).join('')}</div>`}
function selectedAddonIds(root){return [...(root?.querySelectorAll('[data-addon-id]:checked')||[])].map(el=>+el.value)}
function currentOptionId(root,p){const el=root.querySelector('[data-option-for]');return el?+el.value:opts(p)[0].id}

function renderGrid(){const filtered=products.filter(p=>(!selected||p.category_id===selected)&&p.name.includes(search));document.querySelector('#title').textContent=categories.find(c=>c.id===selected)?.name||'전체상품';document.querySelector('#results').textContent=filtered.length+'개 상품';document.querySelector('#grid').innerHTML=filtered.length?filtered.map(p=>{const first=opts(p)[0];const moreOptions=opts(p).length>1;const morePrice=moreOptions||(p.addons||[]).length;const optionLine=first.label&&first.label!=='기본'?`<p class="card-option">${esc(first.label)}${moreOptions?' 외':''}</p>`:'';return `<article class="product-card" data-open-product="${p.id}" tabindex="0" role="link" aria-label="${esc(p.name)} 상세 보기">${image(p)}<h3>${esc(p.name)}</h3>${p.description?`<p class="card-desc">${esc(p.description)}</p>`:''}${optionLine}<div class="price"><strong>${won(first.price)}${morePrice?'~':''}</strong><button type="button" data-open-product="${p.id}">자세히</button></div></article>`}).join(''):'<p class="empty">등록된 상품이 없습니다.</p>';document.querySelectorAll('[data-category]').forEach(e=>e.classList.toggle('active',+e.dataset.category===selected))}

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
        ${p.description?`<p class="detail-desc">${esc(p.description)}</p>`:''}
        <p class="detail-price"><strong data-price>${won(first.price)}</strong></p>
        <div class="detail-fields">
          ${opts(p).length>1||(opts(p)[0].label&&opts(p)[0].label!=='기본')?'<p class="detail-label">옵션</p>':''}
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
      <p><strong>배송조회</strong> ${o.tracking_number?`CJ대한통운 ${esc(o.tracking_number)} <a class="track-link" href="${esc(o.tracking_url)}" target="_blank" rel="noopener">조회하기</a>`:'운송장 등록 전'}</p>
    </div>
  </article>`;
}

async function loadAddresses(){
  if(!getToken()){savedAddresses=[];selectedAddressId=null;return}
  try{savedAddresses=await request('/api/my/addresses')}catch{savedAddresses=[]}
  if(selectedAddressId!=='new'&&!savedAddresses.some(a=>a.id===selectedAddressId)){
    const def=savedAddresses.find(a=>a.is_default)||savedAddresses[0];
    selectedAddressId=def?def.id:(savedAddresses.length?null:'new');
  }
}


function composeAddress(zone, base, detail){
  const parts=[];
  if(zone) parts.push(`[${String(zone).trim()}]`);
  if(base) parts.push(String(base).trim());
  if(detail) parts.push(String(detail).trim());
  return parts.join(' ').trim();
}
function syncAddressHidden(root){
  if(!root)return '';
  const zone=root.querySelector('[name=zonecode]')?.value||'';
  const base=root.querySelector('[name=address_base]')?.value||'';
  const detail=root.querySelector('[name=address_detail]')?.value||'';
  const composed=composeAddress(zone,base,detail);
  const hidden=root.querySelector('input[name=address]');
  if(hidden) hidden.value=composed;
  return composed;
}
function applyPostcodeResult(root, data){
  if(!root)return;
  const zone=root.querySelector('[name=zonecode]');
  const base=root.querySelector('[name=address_base]');
  const detail=root.querySelector('[name=address_detail]');
  if(zone) zone.value=data.zonecode||'';
  if(base) base.value=data.address||'';
  syncAddressHidden(root);
  if(detail){detail.focus();detail.select?.()}
}
function openKakaoPostcode(onComplete){
  if(!window.daum?.Postcode){
    alert('주소 검색 서비스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }
  new daum.Postcode({
    oncomplete(data){
      let addr=data.userSelectedType==='R'?data.roadAddress:data.jibunAddress;
      if(!addr) addr=data.address||'';
      let extra='';
      if(data.userSelectedType==='R'){
        if(data.bname&&/[동로가]$/g.test(data.bname)) extra+=data.bname;
        if(data.buildingName&&data.apartment==='Y') extra+=(extra?', ':'')+data.buildingName;
        if(extra) addr+=` (${extra})`;
      }
      onComplete({zonecode:data.zonecode||'', address:addr});
    },
  }).open();
}

function fillOrderAddress(a){
  const form=document.querySelector('#order');
  if(!form)return;
  form.customer_name.value=a?.recipient_name||authUser?.name||'';
  form.phone.value=a?.phone||authUser?.phone||'';
  if(form.zonecode) form.zonecode.value='';
  if(form.address_base) form.address_base.value=a?.address||'';
  if(form.address_detail) form.address_detail.value='';
  form.address.value=a?.address||'';
  if(form.label) form.label.value=a?.label||'';
}

function setAddressFieldsLocked(locked){
  const fields=document.querySelector('#address-fields');
  if(!fields)return;
  fields.classList.toggle('is-locked',!!locked);
  fields.querySelectorAll('input:not([type=checkbox])').forEach(el=>{
    if(el.name==='label'){el.disabled=!!locked;return}
    if(el.name==='address_detail'){el.readOnly=!!locked;return}
    if(el.name==='zonecode'||el.name==='address_base'){el.readOnly=true;return}
    if(el.name==='address')return;
    el.readOnly=!!locked;
  });
  fields.querySelectorAll('[data-postcode-search]').forEach(btn=>{btn.disabled=!!locked;btn.hidden=!!locked});
}

function renderAddressBook(){
  const box=document.querySelector('#address-book');
  const labelField=document.querySelector('.addr-label-field');
  const saveWrap=document.querySelector('#save-address-wrap');
  if(!box)return;
  const loggedIn=!!getToken();
  if(!loggedIn){
    box.hidden=true;box.innerHTML='';
    if(labelField)labelField.hidden=true;
    if(saveWrap)saveWrap.hidden=true;
    setAddressFieldsLocked(false);
    return;
  }
  box.hidden=false;
  const cards=savedAddresses.map(a=>{
    const on=selectedAddressId===a.id;
    return `<label class="addr-card${on?' is-selected':''}">
      <input type="radio" name="address_pick" value="${a.id}" ${on?'checked':''}>
      <span class="addr-card-body">
        <span class="addr-card-top"><strong>${esc(a.label||'배송지')}</strong>${a.is_default?'<em>기본</em>':''}</span>
        <span>${esc(a.recipient_name)} · ${esc(a.phone)}</span>
        <span class="addr-card-line">${esc(a.address)}</span>
      </span>
    </label>`;
  }).join('');
  const isNew=selectedAddressId==='new'||!savedAddresses.length;
  box.innerHTML=`
    <div class="addr-book-head">
      <p>등록된 배송지에서 선택하거나 새 주소를 입력하세요.</p>
      <button type="button" class="account-btn" data-addr-new>+ 새 배송지</button>
    </div>
    <div class="addr-card-list">${cards||'<p class="muted">저장된 배송지가 없습니다. 아래에서 추가해 주세요.</p>'}</div>
    ${savedAddresses.length?`<label class="addr-card${isNew?' is-selected':''}"><input type="radio" name="address_pick" value="new" ${isNew?'checked':''}><span class="addr-card-body"><strong>새 배송지 입력</strong><span class="muted">받는 분·연락처를 입력하고 주소찾기로 검색합니다.</span></span></label>`:''}
  `;
  if(labelField)labelField.hidden=!isNew;
  if(saveWrap){
    saveWrap.hidden=!isNew;
    const cb=document.querySelector('#save-address');
    if(cb&&isNew&&!savedAddresses.length)cb.checked=true;
  }
  if(isNew){
    setAddressFieldsLocked(false);
    if(selectedAddressId!=='new'&&!savedAddresses.length){
      fillOrderAddress({recipient_name:authUser?.name||'',phone:authUser?.phone||'',address:'',label:''});
    }
  }else{
    const picked=savedAddresses.find(a=>a.id===selectedAddressId);
    if(picked)fillOrderAddress(picked);
    setAddressFieldsLocked(true);
  }
}

function addressManageCard(a){
  return `<article class="addr-manage-card${a.is_default?' is-default':''}" data-addr-id="${a.id}">
    <div class="addr-manage-top">
      <div>
        <strong>${esc(a.label||'배송지')}</strong>
        ${a.is_default?'<em class="addr-default-badge">기본 배송지</em>':''}
      </div>
      <div class="addr-manage-actions">
        ${a.is_default?'':`<button type="button" class="account-btn" data-addr-default="${a.id}">기본으로</button>`}
        <button type="button" class="account-btn" data-addr-edit="${a.id}">수정</button>
        <button type="button" class="account-btn" data-addr-delete="${a.id}">삭제</button>
      </div>
    </div>
    <p>${esc(a.recipient_name)} · ${esc(a.phone)}</p>
    <p class="addr-card-line">${esc(a.address)}</p>
  </article>`;
}

function addressEditorHtml(a){
  return `<form id="addr-edit-form" class="addr-edit-form" data-edit-id="${a?.id||''}">
    <h3>${a?'배송지 수정':'새 배송지 등록'}</h3>
    <label>배송지명<input name="label" required maxlength="40" value="${esc(a?.label||'')}" placeholder="예: 집, 회사"></label>
    <label>받는 분<input name="recipient_name" required maxlength="100" value="${esc(a?.recipient_name||authUser?.name||'')}"></label>
    <label>연락처<input name="phone" required type="tel" pattern="0[0-9-]{8,19}" value="${esc(a?.phone||authUser?.phone||'')}"></label>
    <div class="addr-search-block"><label class="addr-zip-label">우편번호<span class="addr-zip-row"><input name="zonecode" readonly maxlength="10" placeholder="우편번호" value="" autocomplete="postal-code"><button type="button" class="account-btn" data-postcode-search>주소찾기</button></span></label><label>기본 주소<input name="address_base" readonly required minlength="5" maxlength="400" placeholder="주소찾기로 검색해 주세요" value="${esc(a?.address||'')}" autocomplete="street-address"></label><label>상세 주소<input name="address_detail" maxlength="200" placeholder="동·호수 등 상세주소" value="" autocomplete="address-line2"></label><input type="hidden" name="address" value="${esc(a?.address||'')}"></div>
    <label class="check-row"><input type="checkbox" name="is_default" ${!a||a.is_default?'checked':''}> 기본 배송지로 설정</label>
    <div class="addr-edit-actions">
      <button type="submit">${a?'저장':'등록'}</button>
      <button type="button" class="account-btn" data-addr-cancel>취소</button>
    </div>
    <p class="auth-msg" id="addr-edit-msg" role="status"></p>
  </form>`;
}

function renderMypage(){
  const view=document.querySelector('#mypage-view');
  const loggedIn=!!authUser;
  const list=lookupOrder?[lookupOrder]:myOrders;
  const editing=addressFormMode==='edit'?savedAddresses.find(a=>a.id===editingAddressId):null;
  view.innerHTML=`<div class="mypage">
    <div class="mypage-top">
      <button type="button" class="detail-back" data-back-home>← 쇼핑 계속하기</button>
      ${loggedIn?`<button type="button" class="account-btn" data-logout>로그아웃</button>`:''}
    </div>
    <h1>주문·결제 내역</h1>
    <p class="mypage-lead">${loggedIn?`${esc(authUser.name||authUser.username)}님의 주문과 결제 진행 상태입니다.`:'로그인하면 내 주문을 한눈에 볼 수 있습니다. 비회원은 주문번호로 조회하세요.'}</p>
    ${loggedIn?`
      <section class="addr-manage">
        <div class="addr-manage-head">
          <h2>배송지 관리</h2>
          ${addressFormMode==='new'||addressFormMode==='edit'?'':`<button type="button" class="account-btn" data-addr-add>+ 배송지 추가</button>`}
        </div>
        <p class="muted">여러 배송지를 등록하고, 주문 시 선택해 사용할 수 있습니다. (최대 10개)</p>
        ${addressFormMode==='new'||addressFormMode==='edit'?addressEditorHtml(editing):`
          <div class="addr-manage-list">
            ${savedAddresses.length?savedAddresses.map(addressManageCard).join(''):`<p class="mypage-empty-inline">등록된 배송지가 없습니다. 자주 쓰는 주소를 추가해 두세요.</p>`}
          </div>
        `}
      </section>
    `:`
      <div class="mypage-actions">
        <button type="button" data-go-login>회원 로그인</button>
        <button type="button" class="account-btn" data-go-signup>회원가입</button>
        ${isGuest()?`<button type="button" class="account-btn" data-exit-guest>비회원 종료</button>`:''}
      </div>
      <form id="lookup-form" class="lookup-form">
        <h2>비회원 주문 조회</h2>
        <input name="order_id" required placeholder="주문번호" autocomplete="off">
        <input name="phone" required type="tel" placeholder="주문 시 연락처" autocomplete="tel">
        <button type="submit">조회하기</button>
        <p class="auth-msg" id="lookup-msg" role="status"></p>
      </form>
    `}
    <h2 class="mypage-section-title">주문 내역</h2>
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
  header.classList.remove('home-mode');
  if(authView){
    home.hidden=true;product.hidden=true;auth.hidden=false;mypage.hidden=true;
    header.classList.add('auth-mode');footer.classList.add('auth-mode');
    auth.innerHTML=authView==='signup'?renderSignup():renderLogin();
    window.scrollTo({top:0,behavior:'smooth'});
  }else if(mypageView){
    home.hidden=true;product.hidden=true;auth.hidden=true;mypage.hidden=false;
    header.classList.remove('auth-mode');footer.classList.remove('auth-mode');
    Promise.all([loadMyOrders(),loadAddresses()]).then(()=>{
      addressFormMode='list';editingAddressId=null;
      renderMypage();window.scrollTo({top:0,behavior:'smooth'});
    });
  }else if(detailId){
    home.hidden=true;product.hidden=false;auth.hidden=true;mypage.hidden=true;
    header.classList.remove('auth-mode');footer.classList.remove('auth-mode');
    renderDetail();window.scrollTo({top:0,behavior:'smooth'});
  }else{
    home.hidden=false;product.hidden=true;auth.hidden=true;mypage.hidden=true;
    header.classList.remove('auth-mode');footer.classList.remove('auth-mode');header.classList.add('home-mode');
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

function cartRender(){let total=0;document.querySelector('#cart-lines').innerHTML=cart.map((line,index)=>{const p=products.find(p=>p.id===line.id);if(!p)return '';const o=pickOpt(p,line.optionId);const extras=pickAddons(p,line.optionId,line.addonIds);const unit=lineUnit(p,line.optionId,line.addonIds);total+=unit*line.quantity;const extraText=extras.length?`<br><span class="cart-addons">${extras.map(a=>esc(a.label)+' +'+won(a.price)).join(', ')}</span>`:'';return `<div class="line"><div>${esc(p.name)}<br><span>${esc(o.label)}</span>${extraText}<br><strong>${won(unit)}</strong></div><label>수량<input type="number" min="1" max="100" value="${line.quantity}" data-quantity-index="${index}"></label><button data-remove-index="${index}">삭제</button></div>`}).join('')||'<p>장바구니가 비어 있습니다.</p>';document.querySelector('#total').textContent='상품 합계 '+won(total);document.querySelector('#submit').disabled=!enabled||!cart.length;const note=document.querySelector('#checkout-note');
  if(payment.card_enabled){
    document.querySelector('#submit').textContent=enabled?'카드로 결제':'주문 준비 중';
    if(note)note.textContent='주문 정보를 확인한 뒤 카드 결제창으로 이동합니다. 배송비는 별도 안내될 수 있습니다.';
  }else{
    document.querySelector('#submit').textContent=enabled?'주문 접수':'주문 준비 중';
    if(note)note.textContent='결제 연동 전입니다. 현재는 결제 대기 상태로 주문이 접수됩니다.';
  }
}

function savePayPending(orderId, paymentId){
  sessionStorage.setItem(PAY_PENDING_KEY, JSON.stringify({order_id:orderId, payment_id:paymentId}));
}
function readPayPending(){
  try{return JSON.parse(sessionStorage.getItem(PAY_PENDING_KEY)||'null')}catch{return null}
}
function clearPayPending(){sessionStorage.removeItem(PAY_PENDING_KEY)}

async function confirmPortonePayment(orderId, paymentId){
  return request('/api/payments/complete',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({order_id:orderId, payment_id:paymentId}),
  });
}

function setPayStatus(text){
  const el=document.querySelector('#pay-status');
  if(!el)return;
  if(!text){el.hidden=true;el.textContent='';return}
  el.hidden=false;
  el.textContent=text;
}

async function startCardPayment(result, customer={}){
  const pay=result.payment;
  if(!pay||!window.PortOne?.requestPayment){
    throw new Error('결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  // dialog/팝업 차단을 피하기 위해 장바구니를 닫고 PC는 iframe, 모바일은 리다이렉트로 결제
  document.querySelector('#cart')?.close();
  setPayStatus('결제창을 여는 중입니다. 잠시만 기다려 주세요…');
  savePayPending(result.order_id, result.payment_id);
  const phoneDigits=String(customer.phone||'').replace(/\D/g,'');
  let response;
  try{
    response=await window.PortOne.requestPayment({
      storeId: pay.store_id,
      channelKey: pay.channel_key,
      paymentId: result.payment_id,
      orderName: result.order_name||'언니네닭 주문',
      totalAmount: result.total,
      currency: pay.currency==='CURRENCY_KRW'?'KRW':(pay.currency||'KRW'),
      payMethod: pay.pay_method||'CARD',
      redirectUrl: `${location.origin}/?pay_return=1`,
      // 팝업 차단 환경에서도 보이도록 iframe/리다이렉트 강제
      windowType: {pc:'IFRAME', mobile:'REDIRECTION'},
      customer: {
        fullName: customer.name||'고객',
        ...(phoneDigits?{phoneNumber:{number:phoneDigits}}:{}),
      },
    });
  }catch(error){
    clearPayPending();
    setPayStatus('');
    throw new Error(error?.message||'결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  setPayStatus('');
  // PC iframe은 완료 시 resolve. 모바일 리다이렉트면 이 코드까지 오지 않음.
  if(response==null)return null;
  if(response.code!=null){
    clearPayPending();
    throw new Error(response.message||'결제가 취소되었거나 실패했습니다.');
  }
  setPayStatus('결제 확인 중…');
  const paymentId=response.paymentId||result.payment_id;
  const confirmed=await confirmPortonePayment(result.order_id, paymentId);
  clearPayPending();
  setPayStatus('');
  return confirmed;
}

async function finishPayReturn(){
  const params=new URLSearchParams(location.search);
  if(params.get('pay_return')!=='1' && !params.get('paymentId'))return;
  const paymentId=params.get('paymentId')||'';
  const code=params.get('code');
  const message=params.get('message')||'결제가 취소되었거나 실패했습니다.';
  const pending=readPayPending();
  history.replaceState({}, '', location.pathname + (location.hash||'#/'));
  const cartDialog=document.querySelector('#cart');
  const orderMessage=document.querySelector('#order-message');
  if(code){
    clearPayPending();
    if(orderMessage)orderMessage.textContent=message;
    cartDialog?.showModal();
    return;
  }
  if(!paymentId||!pending?.order_id){
    clearPayPending();
    return;
  }
  try{
    const confirmed=await confirmPortonePayment(pending.order_id, paymentId);
    clearPayPending();
    localStorage.setItem('unnine-last-order', confirmed.id);
    if(orderMessage){
      orderMessage.innerHTML=`결제가 완료됐습니다. 주문번호 ${esc(confirmed.id)} · ${won(confirmed.total)} <button type="button" class="linkish" id="goto-mypage">내역 보기</button>`;
      document.querySelector('#goto-mypage')?.addEventListener('click',()=>{cartDialog?.close();goMypage()});
    }
    cartDialog?.showModal();
  }catch(error){
    if(orderMessage)orderMessage.textContent=error.message;
    cartDialog?.showModal();
  }
}

function addToCart(p,optionId,addonIds,quantity){
  const line=cart.find(x=>x.id===p.id&&x.optionId===optionId&&sameAddons(x.addonIds,addonIds));
  if(line)line.quantity=Math.min(100,line.quantity+quantity);
  else cart.push({id:p.id,optionId,addonIds,quantity});
  persist();
}

function afterAuthSuccess(){
  updateAccountUI();
  goHome();
  openCart();
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
  if(mode==='user'){goMypage();return}
  // 비회원 상태에선 회원 로그인으로 바로 이동 (마이페이지만 반복 진입되던 문제 방지)
  goLogin();
};

document.querySelector('#mypage-view').addEventListener('click',async e=>{
  if(e.target.closest('[data-back-home]')){goHome();return}
  if(e.target.closest('[data-go-login]')){goLogin();return}
  if(e.target.closest('[data-go-signup]')){goSignup();return}
  if(e.target.closest('[data-exit-guest]')){
    clearGuest();updateAccountUI();goLogin();return;
  }
  if(e.target.closest('[data-logout]')){
    try{await request('/api/auth/logout',{method:'POST'})}catch{}
    clearAuth();lookupOrder=null;myOrders=[];savedAddresses=[];selectedAddressId=null;addressFormMode='list';editingAddressId=null;renderMypage();
    return;
  }
  if(e.target.closest('[data-addr-add]')){
    if(savedAddresses.length>=10){alert('배송지는 최대 10개까지 등록할 수 있습니다.');return}
    addressFormMode='new';editingAddressId=null;renderMypage();return;
  }
  if(e.target.closest('[data-addr-cancel]')){
    addressFormMode='list';editingAddressId=null;renderMypage();return;
  }
  if(e.target.closest('[data-postcode-search]')){
    const form=e.target.closest('#addr-edit-form');
    if(form) openKakaoPostcode(data=>applyPostcodeResult(form, data));
    return;
  }
  const editBtn=e.target.closest('[data-addr-edit]');
  if(editBtn){
    addressFormMode='edit';editingAddressId=+editBtn.dataset.addrEdit;renderMypage();return;
  }
  const defBtn=e.target.closest('[data-addr-default]');
  if(defBtn){
    try{
      await request(`/api/my/addresses/${defBtn.dataset.addrDefault}/default`,{method:'POST'});
      await loadAddresses();
      addressFormMode='list';renderMypage();
    }catch(error){alert(error.message)}
    return;
  }
  const delBtn=e.target.closest('[data-addr-delete]');
  if(delBtn){
    if(!confirm('이 배송지를 삭제할까요?'))return;
    try{
      await request(`/api/my/addresses/${delBtn.dataset.addrDelete}`,{method:'DELETE'});
      await loadAddresses();
      addressFormMode='list';editingAddressId=null;renderMypage();
    }catch(error){alert(error.message)}
  }
});
document.querySelector('#mypage-view').addEventListener('input',e=>{
  if(!e.target.closest('#addr-edit-form'))return;
  if(e.target.name==='address_detail'||e.target.name==='address_base'||e.target.name==='zonecode'){
    syncAddressHidden(e.target.closest('#addr-edit-form'));
  }
});
document.querySelector('#mypage-view').addEventListener('submit',async e=>{
  if(e.target.id==='addr-edit-form'){
    e.preventDefault();
    const msg=document.querySelector('#addr-edit-msg');
    const address=syncAddressHidden(e.target);
    if(address.length<5){msg.textContent='주소찾기로 배송 주소를 입력해 주세요.';return}
    const fd=new FormData(e.target);
    const body={
      label:String(fd.get('label')||'').trim()||'기본',
      recipient_name:String(fd.get('recipient_name')||'').trim(),
      phone:String(fd.get('phone')||'').trim(),
      address,
      is_default:fd.get('is_default')==='on',
    };
    const editId=e.target.dataset.editId;
    msg.textContent='저장 중…';
    try{
      if(editId){
        await request(`/api/my/addresses/${editId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      }else{
        await request('/api/my/addresses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      }
      await loadAddresses();
      addressFormMode='list';editingAddressId=null;renderMypage();
    }catch(error){msg.textContent=error.message}
    return;
  }
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

async function openCart(){
  cartRender();
  if(getToken()){
    await loadAddresses();
    if(selectedAddressId==null){
      const def=savedAddresses.find(a=>a.is_default)||savedAddresses[0];
      selectedAddressId=def?def.id:'new';
    }
    renderAddressBook();
  }else{
    renderAddressBook();
  }
  document.querySelector('#cart').showModal();
}
document.querySelector('#cart-open').onclick=()=>{openCart()};
document.querySelector('#cart-close').onclick=()=>document.querySelector('#cart').close();
document.querySelector('#cart-lines').addEventListener('click',e=>{if(e.target.dataset.removeIndex==null)return;cart.splice(+e.target.dataset.removeIndex,1);persist();cartRender()});
document.querySelector('#cart-lines').addEventListener('change',e=>{if(e.target.dataset.quantityIndex==null)return;const line=cart[+e.target.dataset.quantityIndex];if(!line)return;line.quantity=Math.max(1,Math.min(100,Math.trunc(+e.target.value)||1));persist();cartRender()});
document.querySelector('#order').addEventListener('input',e=>{
  if(e.target.name==='address_detail'||e.target.name==='address_base'||e.target.name==='zonecode'){
    syncAddressHidden(e.target.form||document.querySelector('#order'));
  }
});
document.querySelector('#order').addEventListener('click',e=>{
  if(!e.target.closest('[data-postcode-search]'))return;
  const fields=document.querySelector('#address-fields');
  if(fields?.classList.contains('is-locked'))return;
  openKakaoPostcode(data=>applyPostcodeResult(document.querySelector('#order'), data));
});
document.querySelector('#order').addEventListener('change',e=>{
  if(e.target.name!=='address_pick')return;
  selectedAddressId=e.target.value==='new'?'new':+e.target.value;
  renderAddressBook();
});
document.querySelector('#order').addEventListener('click',e=>{
  if(!e.target.closest('[data-addr-new]'))return;
  selectedAddressId='new';
  fillOrderAddress({recipient_name:authUser?.name||'',phone:authUser?.phone||'',address:'',label:''});
  const cb=document.querySelector('#save-address');
  if(cb)cb.checked=true;
  renderAddressBook();
});
document.querySelector('#order').onsubmit=async e=>{
  e.preventDefault();
  if(!canCheckout()){
    document.querySelector('#cart').close();
    goLogin();
    return;
  }
  const button=document.querySelector('#submit'),message=document.querySelector('#order-message');
  button.disabled=true;message.textContent=payment.card_enabled?'결제 준비 중…':'주문 접수 중…';
  try{
    const address=syncAddressHidden(e.target);
    if(address.length<5){
      message.textContent='주소찾기로 배송 주소를 입력해 주세요.';
      button.disabled=!enabled||!cart.length;
      return;
    }
    const fd=new FormData(e.target);
    const customer_name=String(fd.get('customer_name')||'').trim();
    const phone=String(fd.get('phone')||'').trim();
    const label=String(fd.get('label')||'').trim()||'기본';
    const saveAddr=!!document.querySelector('#save-address')?.checked&&getToken()&&(selectedAddressId==='new'||!savedAddresses.length);
    if(saveAddr){
      await request('/api/my/addresses',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({label,recipient_name:customer_name,phone,address,is_default:!savedAddresses.length}),
      });
      await loadAddresses();
    }
    const result=await request('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name,phone,address,items:cart.map(x=>({product_id:x.id,option_id:x.optionId||undefined,quantity:x.quantity,addons:(x.addonIds||[]).map(id=>({addon_id:id,quantity:1}))}))})});
    cart=[];persist();cartRender();e.target.reset();
    selectedAddressId=null;
    renderAddressBook();
    localStorage.setItem('unnine-last-order',result.order_id);
    if(result.payment){
      message.textContent='결제창을 여는 중…';
      const confirmed=await startCardPayment(result,{name:customer_name,phone});
      document.querySelector('#cart')?.showModal();
      if(confirmed){
        message.innerHTML=`결제가 완료됐습니다. 주문번호 ${esc(confirmed.id)} · ${won(confirmed.total)} <button type="button" class="linkish" id="goto-mypage">내역 보기</button>`;
        document.querySelector('#goto-mypage')?.addEventListener('click',()=>{document.querySelector('#cart').close();goMypage()});
      }else{
        message.textContent=`주문이 생성됐습니다. 번호 ${result.order_id} · 결제창에서 결제를 마쳐 주세요. 끝나면 이 화면으로 돌아옵니다.`;
      }
    }else{
      message.textContent=`주문이 접수됐습니다. 번호 ${result.order_id} · 상품 합계 ${won(result.total)} · 결제 대기`;
      message.innerHTML+=` <button type="button" class="linkish" id="goto-mypage">내역 보기</button>`;
      document.querySelector('#goto-mypage')?.addEventListener('click',()=>{document.querySelector('#cart').close();goMypage()});
    }
  }catch(error){message.textContent=error.message}
  finally{button.disabled=!enabled||!cart.length}
};

function navButton(c){const img=c.image?`<img src="${esc(c.image)}" alt="" loading="lazy">`:'';return `<button type="button" class="cat" data-category="${c.id}">${img}<span>${esc(c.name)}</span></button>`}
async function init(){
  try{
    if(!api)throw new Error('API 주소가 설정되지 않았습니다. VITE_API_URL을 설정해 주세요.');
    let allImage='';
    let cfg;
    [categories,products,cfg]=await Promise.all([request('/api/categories'),request('/api/products'),request('/api/config')]);
    {const rank=new Map(categories.map((c,i)=>[c.id,i]));products.sort((a,b)=>(rank.get(a.category_id)??1e9)-(rank.get(b.category_id)??1e9)||a.id-b.id)}
    enabled=cfg.orders_enabled;allImage=cfg.all_category_image||'';social=cfg.social||social;payment=cfg.payment||payment;
    if(getToken()){
      try{authUser=await request('/api/auth/me')}catch{clearAuth()}
    }
    cart=cart.map(x=>{const p=products.find(p=>p.id===x.id);if(!p)return null;const optionId=x.optionId??opts(p)[0].id;const addonIds=(x.addonIds||[]).filter(id=>addonsFor(p,optionId).some(a=>a.id===id));return {id:x.id,optionId,addonIds,quantity:x.quantity}}).filter(Boolean);
    document.querySelector('#nav').innerHTML=[{id:0,name:'전체상품',image:allImage},...categories].map(navButton).join('');
    updateAccountUI();persist();cartRender();showView();
    await finishPayReturn();
  }catch(error){document.querySelector('#error').textContent=error.message}
}

function updateCategoryHint(){const nav=document.querySelector('#nav'),wrap=document.querySelector('.category-nav-wrap');if(!nav||!wrap||document.querySelector('#home-view').hidden)return;const more=nav.scrollWidth-nav.clientWidth-nav.scrollLeft>8;wrap.classList.toggle('has-more',more)}
document.querySelector('#nav')?.addEventListener('scroll',updateCategoryHint,{passive:true});
window.addEventListener('resize',updateCategoryHint);
window.addEventListener('hashchange',showView);

persist();init();
