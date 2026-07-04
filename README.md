# 플랫폼 인기 키워드 수집 & 대시보드

네이버 데이터랩(패션의류) · 무신사 · W컨셉 · 29cm 의 **인기검색어 상위 10개**를
매일 **오전 8시**에 자동 수집하여 **일자별로 누적 저장**하고, 대시보드로 보여줍니다.

## 폴더 구조
```
0704_f키워드분석/
├─ scraper/
│  ├─ scrape.js          # 4개 소스 수집 → data/ 에 저장 (핵심 로직)
│  ├─ explore.js         # (참고용) 사이트 API 탐색 스크립트
│  ├─ wconcept-key.txt   # W컨셉 API 키 캐시 (자동 생성/갱신)
│  └─ package.json
├─ data/                 # ★ 수집 결과 (백엔드에서 이 파일들을 읽어가면 됨)
│  ├─ history.json       # 전체 일자 누적본 { "YYYY-MM-DD": {...} }  ← 메인 데이터
│  ├─ latest.json        # 가장 최근 스냅샷
│  ├─ index.json         # 수집된 날짜 목록 + 소스 메타
│  ├─ daily/keywords_YYYY-MM-DD.json  # 하루치 스냅샷 파일
│  ├─ run.log            # 실행 요약 로그
│  └─ scheduler.log      # 작업 스케줄러 실행 로그
├─ web/                  # 대시보드 (정적 사이트)
│  ├─ index.html · style.css · app.js
│  └─ data.js            # 대시보드가 읽는 데이터 (scrape.js 가 자동 생성)
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
