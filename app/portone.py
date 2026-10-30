"""PortOne V2 payment helpers (server-side verification only)."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional


PORTONE_API = 'https://api.portone.io'


def fetch_payment(payment_id: str, api_secret: str, timeout: int = 60) -> dict[str, Any]:
    if not payment_id or not api_secret:
        raise ValueError('결제 조회에 필요한 정보가 없습니다.')
    url = f'{PORTONE_API}/payments/{urllib.parse.quote(payment_id, safe="")}'
    req = urllib.request.Request(url, headers={'Authorization': f'PortOne {api_secret}'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='replace')
        try:
            body = json.loads(detail)
            message = body.get('message') or body.get('type') or detail
        except Exception:
            message = detail or str(exc)
        raise RuntimeError(f'포트원 결제 조회 실패: {message}') from exc
    except urllib.error.URLError as exc:
        raise RuntimeError('포트원 결제 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.') from exc


def paid_total(payment: dict[str, Any]) -> Optional[int]:
    amount = payment.get('amount') or {}
    total = amount.get('total')
    if total is None:
        return None
    try:
        return int(total)
    except (TypeError, ValueError):
        return None
