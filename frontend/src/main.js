import './style.css';
const api=(import.meta.env.VITE_API_URL || '').replace(/\/$/,'');
const won=n=>n.toLocaleString('ko-KR')+'원';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let products=[], categories=[], selected=0, search='', enabled=false, detailId=null;
let cart=[]; try {cart=JSON.parse(localStorage.getItem('unnine-cart')||'[]').filter(x=>Number.isInteger(x.id)&&Number.isInteger(x.quantity)&&x.quantity>0&&x.quantity<=100)}catch{}
function opts(p){return (p.options&&p.options.length)?p.options:[{id:0,label:p.option||'기본',price:p.price}]}
function pickOpt(p,optionId){const list=opts(p);return list.find(o=>o.id===optionId)||list[0]}
function addonsFor(p,optionId){return (p.addons||[]).filter(a=>!a.option_ids?.length||a.option_ids.includes(optionId))}
function pickAddons(p,optionId,addonIds){const avail=addonsFor(p,optionId);const set=new Set(addonIds||[]);return avail.filter(a=>set.has(a.id))}
function lineUnit(p,optionId,addonIds){const o=pickOpt(p,optionId);return o.price+pickAddons(p,optionId,addonIds).reduce((n,a)=>n+a.price,0)}
function sameAddons(a,b){const x=[...(a||[])].sort((i,j)=>i-j).join(',');const y=[...(b||[])].sort((i,j)=>i-j).join(',');return x===y}
function image(p,cls='photo'){return `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.name)} 연출 사진" loading="lazy" decoding="async">`}
async function request(path,options){const r=await fetch(api+path,options);const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'입력 내용을 확인해 주세요.');return data}

document.querySelector('#app').innerHTML=`<header><div class="top"><a href="#/" class="logo" aria-label="언니네닭 홈"><img src="https://pub-236307febd5647328aae37b69df5373d.r2.dev/brand/unnine-logo-transparent.webp?v=1" alt="언니네닭"></a><form id="search"><input aria-label="상품 검색" placeholder="어떤 상품을 찾으세요?"><button>검색</button></form><button id="cart-open">장바구니 <span id="count">0</span></button></div></header><main>
<section id="home-view"><section class="hero"><div><p class="accent">우리 집 식탁을 위한 장보기</p><h1>맛있는 선택,<br>언니네닭에서.</h1><p>닭고기부터 다양한 육류까지.<br>필요한 상품을 편리하게 만나보세요.</p><button id="browse">상품 둘러보기</button></div><div class="hero-media" aria-roledescription="carousel" aria-label="추천 상품 이미지"><div class="hero-slides"><img class="hero-slide is-active" src="https://pub-236307febd5647328aae37b69df5373d.r2.dev/brand/hero-products.webp?v=4" alt="닭고기 모음" decoding="async"><img class="hero-slide" src="https://pub-236307febd5647328aae37b69df5373d.r2.dev/brand/hero-beef-pork.webp?v=1" alt="소고기·돼지고기 모음" decoding="async"><img class="hero-slide" src="https://pub-236307febd5647328aae37b69df5373d.r2.dev/brand/hero-roast-chicken-duck.webp?v=1" alt="로스팅 치킨·오리 모음" decoding="async"></div><div class="hero-dots" role="tablist" aria-label="슬라이드"><button type="button" class="hero-dot is-active" aria-label="1번째 이미지" data-hero="0"></button><button type="button" class="hero-dot" aria-label="2번째 이미지" data-hero="1"></button><button type="button" class="hero-dot" aria-label="3번째 이미지" data-hero="2"></button></div></div></section><div class="category-nav-wrap"><nav id="nav" class="category-nav" aria-label="상품 카테고리"></nav><span class="category-nav-hint" aria-hidden="true">›</span></div><section id="catalog"><div class="title"><h2 id="title">전체상품</h2><span id="results" aria-live="polite"></span></div><p id="error" role="alert"></p><div id="grid" class="grid"></div></section></section>
<section id="product-view" class="product-view" hidden></section>
</main><footer>언니네닭 <p>상품·가격은 제공된 캡처를 바탕으로 등록한 초기 자료입니다. 상품 사진은 AI로 제작한 연출 이미지입니다.</p></footer><dialog id="cart"><div class="title"><h2>장바구니</h2><button id="cart-close" aria-label="닫기">닫기</button></div><div id="cart-lines"></div><p id="total"></p><form id="order"><h3>배송 정보</h3><label>받는 분<input name="customer_name" required maxlength="100" autocomplete="name"></label><label>연락처<input name="phone" required type="tel" pattern="0[0-9-]{8,19}" autocomplete="tel"></label><label>배송 주소<input name="address" required minlength="5" maxlength="500" autocomplete="street-address"></label><p>결제·배송비 연동 전입니다. 현재 기능은 결제 대기 상태의 주문 접수입니다.</p><button id="submit" type="submit">주문 접수</button><p id="order-message" role="status"></p></form></dialog>`;

function persist(){localStorage.setItem('unnine-cart',JSON.stringify(cart));document.querySelector('#count').textContent=cart.reduce((n,x)=>n+x.quantity,0)}
function parseRoute(){const h=(location.hash||'#/').replace(/^#/, '');const m=h.match(/^\/?product\/(\d+)/);return m?{view:'product',id:+m[1]}:{view:'home',id:null}}
function goHome(){location.hash='#/'}
function goProduct(id){location.hash=`#/product/${id}`}

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

function showView(){
  const route=parseRoute();
  detailId=route.view==='product'?route.id:null;
  const home=document.querySelector('#home-view');
  const product=document.querySelector('#product-view');
  if(detailId){home.hidden=true;product.hidden=false;renderDetail();window.scrollTo({top:0,behavior:'smooth'})}
  else{home.hidden=false;product.hidden=true;renderGrid();updateCategoryHint()}
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
  else{
    const qty=fields.querySelector('.qty-pick');
    qty.insertAdjacentHTML('beforebegin',html);
  }
  box=root.querySelector('[data-addons-for]');
  prev.forEach(id=>{const el=box?.querySelector(`[data-addon-id="${id}"]`);if(el)el.checked=true});
  updateDetailPrice(root);
}
function updateDetailPrice(root){
  const p=products.find(x=>x.id===+root.dataset.productDetail);if(!p)return;
  const optionId=currentOptionId(root,p);
  const el=root.querySelector('[data-price]');
  if(el)el.textContent=won(lineUnit(p,optionId,selectedAddonIds(root)));
}

function cartRender(){let total=0;document.querySelector('#cart-lines').innerHTML=cart.map((line,index)=>{const p=products.find(p=>p.id===line.id);if(!p)return '';const o=pickOpt(p,line.optionId);const extras=pickAddons(p,line.optionId,line.addonIds);const unit=lineUnit(p,line.optionId,line.addonIds);total+=unit*line.quantity;const extraText=extras.length?`<br><span class="cart-addons">${extras.map(a=>esc(a.label)+' +'+won(a.price)).join(', ')}</span>`:'';return `<div class="line"><div>${esc(p.name)}<br><span>${esc(o.label)}</span>${extraText}<br><strong>${won(unit)}</strong></div><label>수량<input type="number" min="1" max="100" value="${line.quantity}" data-quantity-index="${index}"></label><button data-remove-index="${index}">삭제</button></div>`}).join('')||'<p>장바구니가 비어 있습니다.</p>';document.querySelector('#total').textContent='상품 합계 '+won(total);document.querySelector('#submit').disabled=!enabled||!cart.length;document.querySelector('#submit').textContent=enabled?'주문 접수':'주문 준비 중'}

function addToCart(p,optionId,addonIds,quantity){
  const line=cart.find(x=>x.id===p.id&&x.optionId===optionId&&sameAddons(x.addonIds,addonIds));
  if(line)line.quantity=Math.min(100,line.quantity+quantity);
  else cart.push({id:p.id,optionId,addonIds,quantity});
  persist();
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
  const optionId=currentOptionId(root,p);
  const addonIds=selectedAddonIds(root);
  const qty=Math.max(1,Math.min(100,Math.trunc(+root.querySelector('[data-detail-qty]').value)||1));
  addToCart(p,optionId,addonIds,qty);
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

document.querySelector('#nav').addEventListener('click',e=>{
  const button=e.target.closest('[data-category]');if(!button)return;
  selected=+button.dataset.category;
  if(detailId)goHome();
  else{renderGrid();document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})}
});
document.querySelector('#search').onsubmit=e=>{
  e.preventDefault();
  search=e.target.querySelector('input').value.trim();
  if(detailId)goHome();
  else{renderGrid();document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})}
};
document.querySelector('#browse').onclick=()=>{if(detailId)goHome();document.querySelector('#catalog').scrollIntoView({behavior:'smooth'})};
document.querySelector('.logo').addEventListener('click',e=>{e.preventDefault();goHome()});

document.querySelector('#cart-open').onclick=()=>{cartRender();document.querySelector('#cart').showModal()};
document.querySelector('#cart-close').onclick=()=>document.querySelector('#cart').close();
document.querySelector('#cart-lines').addEventListener('click',e=>{if(e.target.dataset.removeIndex==null)return;cart.splice(+e.target.dataset.removeIndex,1);persist();cartRender()});
document.querySelector('#cart-lines').addEventListener('change',e=>{if(e.target.dataset.quantityIndex==null)return;const line=cart[+e.target.dataset.quantityIndex];if(!line)return;line.quantity=Math.max(1,Math.min(100,Math.trunc(+e.target.value)||1));persist();cartRender()});
document.querySelector('#order').onsubmit=async e=>{e.preventDefault();const button=document.querySelector('#submit'),message=document.querySelector('#order-message');button.disabled=true;message.textContent='주문 접수 중…';try{const values=Object.fromEntries(new FormData(e.target));const result=await request('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,items:cart.map(x=>({product_id:x.id,option_id:x.optionId||undefined,quantity:x.quantity,addons:(x.addonIds||[]).map(id=>({addon_id:id,quantity:1}))}))})});cart=[];persist();cartRender();e.target.reset();message.textContent=`주문이 접수됐습니다. 번호 ${result.order_id} · 상품 합계 ${won(result.total)} · 결제 대기`;}catch(error){message.textContent=error.message;button.disabled=!enabled||!cart.length}};

function navButton(c){const img=c.image?`<img src="${esc(c.image)}" alt="" loading="lazy">`:'';return `<button type="button" class="cat" data-category="${c.id}">${img}<span>${esc(c.name)}</span></button>`}
async function init(){try{if(!api)throw new Error('API 주소가 설정되지 않았습니다. VITE_API_URL을 설정해 주세요.');let allImage='';[categories,products,{orders_enabled:enabled,all_category_image:allImage}]=await Promise.all([request('/api/categories'),request('/api/products'),request('/api/config')]);cart=cart.map(x=>{const p=products.find(p=>p.id===x.id);if(!p)return null;const optionId=x.optionId??opts(p)[0].id;const addonIds=(x.addonIds||[]).filter(id=>addonsFor(p,optionId).some(a=>a.id===id));return {id:x.id,optionId,addonIds,quantity:x.quantity}}).filter(Boolean);document.querySelector('#nav').innerHTML=[{id:0,name:'전체상품',image:allImage},...categories].map(navButton).join('');persist();showView()}catch(error){document.querySelector('#error').textContent=error.message}}

function updateCategoryHint(){const nav=document.querySelector('#nav'),wrap=document.querySelector('.category-nav-wrap');if(!nav||!wrap||document.querySelector('#home-view').hidden)return;const more=nav.scrollWidth-nav.clientWidth-nav.scrollLeft>8;wrap.classList.toggle('has-more',more)}
document.querySelector('#nav')?.addEventListener('scroll',updateCategoryHint,{passive:true});
window.addEventListener('resize',updateCategoryHint);
window.addEventListener('hashchange',showView);

(function(){
  const slides=[...document.querySelectorAll('.hero-slide')];
  const dots=[...document.querySelectorAll('.hero-dot')];
  if(slides.length<2) return;
  let i=0, timer;
  function show(n){
    i=(n+slides.length)%slides.length;
    slides.forEach((el,idx)=>el.classList.toggle('is-active',idx===i));
    dots.forEach((el,idx)=>{el.classList.toggle('is-active',idx===i);el.setAttribute('aria-selected',idx===i?'true':'false')});
  }
  function next(){show(i+1)}
  function start(){timer=setInterval(next,4500)}
  function stop(){clearInterval(timer)}
  dots.forEach(btn=>btn.addEventListener('click',()=>{stop();show(+btn.dataset.hero);start()}));
  const media=document.querySelector('.hero-media');
  media?.addEventListener('mouseenter',stop);
  media?.addEventListener('mouseleave',start);
  start();
})();

persist();init();
