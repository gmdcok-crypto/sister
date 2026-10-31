import './pay.css';

const api = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const PAY_LAUNCH_KEY = 'unnine-pay-launch';
const PAY_PENDING_KEY = 'unnine-pay-pending';
const msg = document.querySelector('#pay-msg');
const sub = document.querySelector('#pay-sub');

function setMsg(text, detail = '') {
  if (msg) msg.textContent = text;
  if (sub) sub.textContent = detail;
}

function readLaunch() {
  try {
    return JSON.parse(sessionStorage.getItem(PAY_LAUNCH_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearLaunch() {
  sessionStorage.removeItem(PAY_LAUNCH_KEY);
}

function savePending(orderId, paymentId) {
  sessionStorage.setItem(PAY_PENDING_KEY, JSON.stringify({ order_id: orderId, payment_id: paymentId }));
}

async function confirmPayment(orderId, paymentId) {
  const r = await fetch(`${api}/api/payments/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId, payment_id: paymentId }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '결제 확인에 실패했습니다.');
  return data;
}

async function run() {
  const launch = readLaunch();
  if (!launch?.payment || !launch.payment_id || !launch.order_id) {
    setMsg('결제 정보가 없습니다.', '장바구니에서 다시 주문해 주세요.');
    return;
  }
  if (!api) {
    setMsg('API 주소가 설정되지 않았습니다.');
    return;
  }
  if (!window.PortOne?.requestPayment) {
    setMsg('결제 모듈을 불러오지 못했습니다.', '페이지를 새로고침한 뒤 다시 시도해 주세요.');
    return;
  }

  const pay = launch.payment;
  const phoneDigits = String(launch.customer?.phone || '').replace(/\D/g, '');
  savePending(launch.order_id, launch.payment_id);
  setMsg('결제창을 여는 중입니다…', '결제창이 나타나면 카드 결제를 진행해 주세요.');

  let response;
  try {
    response = await window.PortOne.requestPayment({
      storeId: pay.store_id,
      channelKey: pay.channel_key,
      paymentId: launch.payment_id,
      orderName: launch.order_name || '언니네닭 주문',
      totalAmount: launch.total,
      currency: pay.currency === 'CURRENCY_KRW' ? 'KRW' : pay.currency || 'KRW',
      payMethod: pay.pay_method || 'CARD',
      redirectUrl: `${location.origin}/?pay_return=1`,
      windowType: { pc: 'IFRAME', mobile: 'REDIRECTION' },
      customer: {
        fullName: launch.customer?.name || '고객',
        ...(phoneDigits ? { phoneNumber: phoneDigits } : {}),
      },
    });
  } catch (error) {
    clearLaunch();
    setMsg('결제창을 열지 못했습니다.', error?.message || '잠시 후 다시 시도해 주세요.');
    return;
  }

  // 모바일 리다이렉트면 여기까지 오지 않음
  if (response == null) {
    setMsg('결제창에서 결제를 마쳐 주세요.');
    return;
  }
  if (response.code != null) {
    clearLaunch();
    sessionStorage.removeItem(PAY_PENDING_KEY);
    setMsg('결제가 취소되었거나 실패했습니다.', response.message || '');
    return;
  }

  setMsg('결제 확인 중…');
  try {
    const paymentId = response.paymentId || launch.payment_id;
    const confirmed = await confirmPayment(launch.order_id, paymentId);
    clearLaunch();
    sessionStorage.removeItem(PAY_PENDING_KEY);
    localStorage.setItem('unnine-last-order', confirmed.id);
    setMsg('결제가 완료됐습니다.', `주문번호 ${confirmed.id}`);
    setTimeout(() => {
      location.href = '/#/mypage';
    }, 800);
  } catch (error) {
    setMsg('결제는 됐을 수 있지만 확인에 실패했습니다.', error.message || '주문내역에서 상태를 확인해 주세요.');
  }
}

run();
