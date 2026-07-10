# 플랫폼 인기 키워드 수집 & 대시보드

네이버 데이터랩(패션의류) · 무신사 · W컨셉 · 29cm 의 **인기검색어 상위 10개**를
매일 **오전 8시**에 자동 수집하여 **일자별로 누적 저장**하고, 대시보드로 보여줍니다.

## 폴더 구조
```
0704_f키워드분석/
├─ scraper/
│  ├─ scrape.js          # 4개 소스 인기키워드 수집 → data/ 저장 (핵심)
│  ├─ trends.js          # 베스트 키워드들의 검색 추이(증감) 수집
│  ├─ explore.js         # (참고용) 사이트 API 탐색 스크립트
│  ├─ wconcept-key.txt   # W컨셉 API 키 캐시 (자동 생성/갱신)
│  └─ package.json
├─ data/                 # ★ 수집 결과 (백엔드에서 이 파일들을 읽어가면 됨)
│  ├─ history.json       # 전체 일자 누적본 { "YYYY-MM-DD": {...} }  ← 인기키워드 메인
│  ├─ latest.json        # 가장 최근 스냅샷
│  ├─ index.json         # 수집된 날짜 목록 + 소스 메타
│  ├─ daily/keywords_YYYY-MM-DD.json  # 하루치 스냅샷 파일
│  ├─ trends.json        # 키워드별 월별 검색추이 시계열 + 증감 ← 추이 메인
│  ├─ trends_index.json  # 키워드별 최신값·MoM·YoY 요약
│  ├─ trends_state.json  # 키워드별 마지막 수집시각(재수집 스킵용)
│  ├─ run.log            # 실행 요약 로그
│  └─ scheduler.log      # 작업 스케줄러 실행 로그
├─ web/                  # 대시보드 (정적 사이트)
│  ├─ index.html · style.css · app.js   # 인기키워드 대시보드
│  ├─ trends.html                        # 검색 추이(증감) 뷰어
│  ├─ data.js            # 인기키워드 데이터 (scrape.js 가 자동 생성)
│  └─ trends.js          # 추이 데이터 (trends.js 가 자동 생성)
├─ run_daily.bat         # 스케줄러가 호출하는 실행기
└─ setup_schedule.ps1    # Windows 작업 스케줄러 등록/해제
```

## 동작 방식
- 4개 소스 모두 **공개 HTTP API** 로 직접 수집합니다 (브라우저 불필요, 빠르고 안정적).
  - 무신사: `client.musinsa.com/.../keyword/search-home`
  - 29cm: `search-api.29cm.co.kr/api/v4/popular`
  - W컨셉: `gw-front.wconcept.co.kr/.../keywords/popular` (`display-api-key` 헤더)
  - 네이버: `datalab.naver.com/.../getCategoryKeywordRank.naver` (패션의류 cid=50000000, 전일 기준)
- **W컨셉 키 자동 갱신**: 하드코딩된 키가 만료되면 헤드리스 브라우저로 살아있는 키를
  가로채 `wconcept-key.txt` 에 저장 후 재시도 → 사람 개입 없이 계속 동작합니다.
- **부분 실패 보존**: 특정 소스가 실패해도 나머지는 저장되고, 실패 소스는 같은 날
  이전 성공값을 유지합니다(`이전값` 태그 표시).
- **순위 변동**: 소스가 제공하는 값이 없으면 직전 수집일과 비교해 자동 계산(▲/▼/NEW).

## 검색 추이(증감) 수집 — trends.js
매일 모이는 **베스트 키워드**들에 대해 시점별(월별) 검색 추이와 증감을 수집합니다.

- **네이버**: 데이터랩 쇼핑인사이트 **키워드 클릭추이**(키 불필요). 패션의류→패션잡화
  카테고리 폴백, `timeUnit=month`, 기본 최근 **36개월**. 값은 상대지수(0~100, 키워드별 자체 최대=100 기준).
- **유튜브**: **구글 트렌드(유튜브 검색 속성)** 상대지수 — *best effort*. 구글이 데이터센터 IP를
  차단(429)하므로 **사용자 PC(가정용 IP)에서 실행**해야 값이 채워집니다. 차단 시 네이버만 저장하고
  건너뜁니다(수집 자체는 중단되지 않음).
- **핀터레스트**: **핀터레스트 트렌드(국가=KR)** 주별 추이 + 자체 WoW/MoM/YoY(`raw_growth`).
  한국은 핀터레스트 사용량이 적어 **일부 키워드만 데이터가 있습니다**(예: 53개 중 17개). 데이터가
  없으면 `available:false`로 저장하고 건너뜁니다. 국가 변경: `--pin-country=US`.
- **증감 지표**: 각 시점의 전월 대비(MoM), 최신값의 전월/전년(YoY) 증감%를 함께 저장.
- **부분월 제외**: 집계 진행 중인 이번 달은 왜곡을 막기 위해 제외(마지막 완결 월 기준).
- **재수집 스킵**: 월별 데이터라 최근 7일 내 갱신분은 건너뜀. `--force`로 전부 재수집.

```powershell
node scraper/trends.js                 # 기본(최근 갱신분 스킵)
node scraper/trends.js --force         # 전부 재수집
node scraper/trends.js --months=60     # 조회 기간 변경
node scraper/trends.js --no-youtube    # 유튜브 건너뜀
node scraper/trends.js --no-pinterest  # 핀터레스트 건너뜀
node scraper/trends.js --pin-country=US # 핀터레스트 국가 변경
```
뷰어: `web/trends.html` — **소스 전환(네이버·핀터레스트·유튜브)** + 키워드별 스파크라인 + 단기변화(MoM/WoW)·YoY,
정렬·검색·"데이터 있는 것만" 필터. 8시 자동작업이 `scrape.js` 직후 `trends.js`도 실행합니다.

> ⚠️ 상대지수는 **절대 검색 건수가 아닙니다.** 네이버·구글 모두 절대량은 비공개이며, 증감 추적에는
> 상대지수가 표준입니다. 키워드별로 자체 정규화되므로 **키워드 간 크기 비교가 아니라, 각 키워드의
> 시간에 따른 증감(방향)** 으로 해석하세요.

## 자동 업데이트 (매일 오전 8시)
### 등록
관리자 PowerShell 권장:
```powershell
powershell -ExecutionPolicy Bypass -File setup_schedule.ps1
```
- 작업 이름: `KeywordScraperDaily`, 트리거: 매일 08:00
- PC가 꺼져 있어 놓친 실행은 켜진 뒤 자동 보충됩니다(`-StartWhenAvailable`).

### 상태 확인 / 즉시 실행 / 해제
```powershell
Get-ScheduledTask -TaskName KeywordScraperDaily | Get-ScheduledTaskInfo
Start-ScheduledTask -TaskName KeywordScraperDaily          # 지금 즉시 한 번
powershell -ExecutionPolicy Bypass -File setup_schedule.ps1 -Remove   # 해제
```

## 수동 실행
```powershell
cd scraper
node scrape.js
```

## 대시보드 열기
- 정적 서버로 보기(권장):
  ```powershell
  python -m http.server 8777 --directory web
  # 브라우저에서 http://localhost:8777
  ```
- 또는 `web/index.html` 파일을 브라우저로 바로 열어도 됩니다(`data.js` 를 함께 읽음).

## 백엔드 연동 (나중에)
- 가장 쓰기 좋은 파일은 **`data/history.json`** (일자별 누적, 순위·변동 포함) 입니다.
- 개별 일자만 필요하면 `data/daily/keywords_YYYY-MM-DD.json`, 최신값은 `data/latest.json`.
- 스키마 예:
  ```json
  {
    "date": "2026-07-04",
    "collectedAt": "2026-07-04T20:13:24+09:00",
    "sources": [
      { "id": "naver", "name": "네이버", "ok": true, "sourceUpdatedAt": "...",
        "items": [ { "rank": 1, "keyword": "원피스", "change": 0, "isNew": false } ] }
    ]
  }
  ```
