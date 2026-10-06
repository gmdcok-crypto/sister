# 언니네닭 쇼핑몰 1차 구현

프론트: Vite + JavaScript / Netlify (`frontend/`). 백엔드: Python FastAPI + SQLAlchemy / Railway (저장소 루트). DB: Railway MySQL.

## 로컬 실행

저장소 루트에서 Python 3.12 권장:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
# .env의 DATABASE_URL을 MySQL 연결 주소로 변경
.venv/Scripts/python -m app.seed
.venv/Scripts/python -m uvicorn app.main:app --reload
```

프론트 폴더:

```powershell
cd frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

## Railway

1. 저장소 연결. Root Directory는 비워 둠(저장소 루트). `railway.toml` + Dockerfile 빌드.
2. 같은 프로젝트에 MySQL 생성.
3. API 서비스에 `MYSQL_URL=${{MySQL.MYSQL_URL}}` 또는 `DATABASE_URL=${{MySQL.MYSQL_URL}}` 지정(둘 다 인식). MySQL 서비스명이 다르면 참조 이름 변경. API에서 mysql://를 mysql+pymysql://로 변환.
4. `CORS_ORIGINS=https://실제사이트.netlify.app` 설정. 로컬도 필요하면 쉼표로 추가. `ADMIN_API_KEY`는 충분히 긴 임의 비밀값.
5. 컨테이너 기동 시 `app.seed`와 `app.update_images`가 자동 실행됩니다(없는 상품만 추가, 이미지 URL만 갱신). Shell에서 따로 실행할 필요 없습니다.
6. API 공개 도메인 생성. `/health`로 DB 연결 확인. DB 준비 전 healthcheck 실패는 정상.
7. `ORDERS_ENABLED=false` 유지. 가격·상품 옵션·배송비·개인정보 처리·결제·재고·중복 접수 방지·요청 제한 운영 정책을 확정한 후 실제 접수 활성화.

## Netlify

저장소에서 이 프로젝트를 연결. 제공된 `netlify.toml`이 Base directory를 `frontend`로 지정함.

환경 변수 `VITE_API_URL=https://실제API.up.railway.app`. 변경 시 재빌드. DB 비밀번호와 ADMIN_API_KEY는 프론트에 넣지 않음.

## API

GET /health, /api/config, /api/categories, /api/products?category_id=2&q=닭발, /api/products/{id}

POST /api/orders: customer_name, phone, address, items[{product_id, quantity}]. 서버가 DB 가격으로 상품 합계를 계산. 클라이언트 금액은 사용하지 않음. 결제 처리 없음. pending_payment 상태로 저장.

GET /api/admin/orders: X-Admin-Key 헤더 인증. 개인정보 포함하므로 백엔드 운영자만 사용. 공개 프론트에서 키 사용 금지.

## 검증

백엔드: `python -m pytest tests -q` (격리된 SQLite로 API 로직 검증, Railway MySQL 통합 검증은 별도 필요).
프론트: `npm run build`.

## 현재 범위

실제 카테고리 6개, 제공 캡처의 특수부위 13개. 다른 카테고리는 미등록 상태를 표시. 상품 검색/카테고리 필터/로컬 장바구니/배송정보 검증/주문 저장/관리자 주문 조회 구현.

로고는 캡처 원본 픽셀을 CSS로 표시. 원본 로고 파일을 받으면 교체 가능. 닭가슴살과 무뼈닭발은 AI 연출 이미지. 나머지는 제공한 캡처 원본. 금액과 옵션은 캡처에서 읽은 초기 자료로 실제 판매 전 검수 필요. 배송비·세금·결제·회원·재고·취소/환불·관리자 화면은 아직 미구현.

초기 스키마 생성은 seed 명령으로 명시 실행. 후속 스키마 변경부터 Alembic 마이그레이션 도입 필요.

## 확인 결과

API 테스트 5개 통과, Vite 프로덕션 빌드 통과. 브라우저에서 API 상품 13개 로딩 및 장바구니 담기/삭제 확인. 390px 너비에서 문서의 가로 넘침 없음 확인. 로컬 미리보기 DB는 SQLite이며 운영 MySQL 연결은 아직 미검증.

공식 설정 참고: https://docs.railway.com/databases/mysql , https://fastapi.tiangolo.com/tutorial/cors/ , https://docs.netlify.com/build/environment-variables/get-started/

## 상품 이미지 (Cloudflare R2)

상품 이미지는 R2 버킷 `sisterfood`의 `products/` 키에 저장합니다. 로고·캡처는 Netlify `frontend/public/assets`에 둡니다.

로컬 이미지를 R2에 올리고 `catalog.json` URL을 공개 URL로 바꾸려면 `.env`에 R2 값을 넣은 뒤:

```powershell
.venv/Scripts/python -m app.sync_r2_images
# 이미 seed된 DB면 이미지 URL만 갱신
.venv/Scripts/python -m app.update_images
```

R2 버킷은 공개 읽기(또는 커스텀 도메인)가 켜져 있어야 하고, `R2_PUBLIC_URL`은 그 공개 베이스 URL입니다.

