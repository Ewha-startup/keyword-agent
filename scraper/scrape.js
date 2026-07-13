/**
 * 키워드 수집기 (Keyword Scraper)
 * 4개 소스의 인기검색어 상위 10개를 매일 수집하여 일자별로 누적 저장한다.
 *  - 무신사 (Musinsa)
 *  - 29cm
 *  - W컨셉 (W Concept)
 *  - 네이버 데이터랩 쇼핑인사이트 - 패션의류
 *
 * 저장 위치 (../data):
 *  - daily/keywords_YYYY-MM-DD.json : 하루 스냅샷 (같은 날 재실행 시 덮어씀)
 *  - history.json                   : 전체 일자 누적본 { "YYYY-MM-DD": {...} }
 *  - latest.json                    : 가장 최근 스냅샷
 *  - index.json                     : 수집된 날짜 목록 + 메타
 *  - ../web/data.js                 : 대시보드가 바로 읽는 파일 (window.KEYWORD_DATA)
 *
 * Node 18+ 의 내장 fetch 사용. playwright 는 W컨셉 API 키 자동 갱신 폴백에만 사용.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DAILY_DIR = path.join(DATA_DIR, 'daily');
const WEB_DIR = path.join(__dirname, '..', 'web');
const KEY_FILE = path.join(__dirname, 'wconcept-key.txt');

// W컨셉 프론트엔드 공개 API 키 (만료 시 브라우저로 자동 갱신됨)
const WCONCEPT_DEFAULT_KEY = 'VWmkUPgs6g2fviPZ5JQFQ3pERP4tIXv/J2jppLqSRBk=';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------- 날짜 유틸 (KST 기준) ----------
function kstNow() {
  // 서버 로캘과 무관하게 Asia/Seoul 기준 시각 문자열 확보
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    time: `${g('hour')}:${g('minute')}:${g('second')}`,
    iso: `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}+09:00`,
  };
}
function ymdOffset(days) {
  const d = new Date(Date.now() + days * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

async function fetchJson(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- 소스별 수집기 ----------
async function scrapeMusinsa() {
  const j = await fetchJson(
    'https://client.musinsa.com/api/display/v1/search/web/keyword/search-home?popularCount=10&gf=F',
    { headers: { 'User-Agent': UA, Referer: 'https://www.musinsa.com/' } }
  );
  const comp = j.data.componentList.find((c) => c.key === 'popular');
  const items = comp.items.slice(0, 10).map((x, i) => ({
    rank: i + 1,
    keyword: x.text,
    change: typeof x.rankIncrement === 'number' ? x.rankIncrement : null,
  }));
  return { items, sourceUpdatedAt: null };
}

async function scrape29cm() {
  const j = await fetchJson(
    'https://search-api.29cm.co.kr/api/v4/popular?brandLimit=30&keywordLimit=100',
    { headers: { 'User-Agent': UA, Referer: 'https://www.29cm.co.kr/' } }
  );
  const group = j.data.keyword.results[0];
  const items = group.keywords.slice(0, 10).map((x, i) => ({
    rank: i + 1,
    keyword: x.keyword,
    change: null,
  }));
  return { items, sourceUpdatedAt: j.data.keyword.updatedAt || null };
}

function readWconceptKey() {
  try {
    const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (k) return k;
  } catch (e) {}
  return WCONCEPT_DEFAULT_KEY;
}

async function wconceptRequest(key) {
  return fetchJson('https://gw-front.wconcept.co.kr/display/api/search/v1/keywords/popular', {
    headers: {
      'User-Agent': UA,
      Referer: 'https://display.wconcept.co.kr/',
      devicetype: 'PC',
      gendertype: 'ALL',
      'display-api-key': key,
    },
  });
}

// 브라우저로 W컨셉 페이지를 열어 살아있는 display-api-key 를 가로챈다 (폴백)
async function refreshWconceptKey() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    throw new Error('playwright 미설치 - W컨셉 키 갱신 불가');
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newContext({ locale: 'ko-KR', userAgent: UA }).then((c) => c.newPage());
    let key = null;
    page.on('request', (r) => {
      if (r.url().includes('keywords/popular')) {
        const h = r.headers()['display-api-key'];
        if (h) key = h;
      }
    });
    await page.goto('https://display.wconcept.co.kr/rn/women', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    try { const el = await page.$('input[type=search]'); if (el) await el.click({ timeout: 3000 }); } catch (e) {}
    await page.waitForTimeout(3000);
    if (key) fs.writeFileSync(KEY_FILE, key, 'utf8');
    return key;
  } finally {
    await browser.close();
  }
}

async function scrapeWconcept() {
  let key = readWconceptKey();
  let j;
  try {
    j = await wconceptRequest(key);
    if (!j.data) throw new Error(j.message || 'no data');
  } catch (e) {
    // 키 만료 추정 → 브라우저로 새 키 확보 후 재시도
    const fresh = await refreshWconceptKey();
    if (!fresh) throw new Error('W컨셉 키 갱신 실패: ' + e.message);
    j = await wconceptRequest(fresh);
    if (!j.data) throw new Error('W컨셉 재시도 실패: ' + (j.message || ''));
  }
  const items = j.data.popularWordsInfo.slice(0, 10).map((x) => ({
    rank: x.ranking,
    keyword: x.searchWord,
    change: typeof x.change === 'number' ? x.change : null,
  }));
  return { items, sourceUpdatedAt: j.data.popularWordsUpdateTime || null };
}

async function scrapeNaver() {
  // 네이버 일간 집계가 1~3일 지연될 수 있음(2026-07 확인: 전일은 빈값, 2일 전부터 존재)
  // → 어제부터 최대 4일 거슬러 올라가며 데이터가 있는 첫 날짜를 쓴다
  let lastError = null;
  for (let off = 1; off <= 4; off++) {
    const day = ymdOffset(-off);
    const body = new URLSearchParams({
      cid: '50000000', // 패션의류
      timeUnit: 'date',
      startDate: day,
      endDate: day,
      age: '', gender: '', device: '', page: '1', count: '20',
    }).toString();
    const j = await fetchJson(
      'https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver',
      {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Referer: 'https://datalab.naver.com/shoppingInsight/sCategory.naver',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body,
      }
    );
    if (j.ranks && j.ranks.length) {
      const items = j.ranks.slice(0, 10).map((x) => ({ rank: x.rank, keyword: x.keyword, change: null }));
      return { items, sourceUpdatedAt: j.range || null, dataDate: day };
    }
    lastError = new Error(`네이버 랭킹 비어있음 (${day})`);
  }
  throw lastError;
}

const SOURCES = [
  { id: 'naver', name: '네이버', fn: scrapeNaver },
  { id: 'musinsa', name: '무신사', fn: scrapeMusinsa },
  { id: 'wconcept', name: 'W컨셉', fn: scrapeWconcept },
  { id: '29cm', name: '29cm', fn: scrape29cm },
];

// ---------- 저장/누적 ----------
function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function computeChangeFromHistory(history, todayDate, snapshot) {
  // 이전 수집일 스냅샷과 비교해 순위 변동(전일 순위 - 현재 순위) 계산
  const dates = Object.keys(history).filter((d) => d < todayDate).sort();
  const prevDate = dates[dates.length - 1];
  const prev = prevDate ? history[prevDate] : null;
  for (const src of snapshot.sources) {
    const prevSrc = prev && prev.sources ? prev.sources.find((s) => s.id === src.id) : null;
    for (const it of src.items) {
      if (it.change === null && prevSrc && prevSrc.ok) {
        const pIdx = prevSrc.items.findIndex((p) => p.keyword === it.keyword);
        it.change = pIdx === -1 ? null : (pIdx + 1) - it.rank; // 양수=상승
        it.isNew = pIdx === -1;
      } else {
        it.isNew = false;
      }
    }
  }
}

async function main() {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.mkdirSync(WEB_DIR, { recursive: true });
  const now = kstNow();

  const results = [];
  for (const src of SOURCES) {
    try {
      const r = await src.fn();
      results.push({
        id: src.id, name: src.name, ok: true,
        items: r.items,
        sourceUpdatedAt: r.sourceUpdatedAt || null,
        dataDate: r.dataDate || now.date,
      });
      console.log(`[OK] ${src.name}: ${r.items.map((x) => x.keyword).join(', ')}`);
    } catch (e) {
      results.push({ id: src.id, name: src.name, ok: false, items: [], error: String(e.message || e) });
      console.error(`[FAIL] ${src.name}: ${e.message || e}`);
    }
  }

  const snapshot = { date: now.date, collectedAt: now.iso, sources: results };

  // 누적본 로드 후 순위변동 계산
  const history = readJsonSafe(path.join(DATA_DIR, 'history.json'), {});
  computeChangeFromHistory(history, now.date, snapshot);

  // 소스 하나라도 실패 시 이전 성공 데이터로 보존(부분 실패에도 대시보드 유지)
  const prevSnap = history[now.date];
  for (const src of snapshot.sources) {
    if (!src.ok && prevSnap) {
      const old = prevSnap.sources.find((s) => s.id === src.id);
      if (old && old.ok) {
        src.items = old.items; src.ok = true; src.stale = true;
        src.sourceUpdatedAt = old.sourceUpdatedAt;
      }
    }
  }

  // 저장
  history[now.date] = snapshot;
  fs.writeFileSync(path.join(DATA_DIR, 'history.json'), JSON.stringify(history, null, 2), 'utf8');
  fs.writeFileSync(path.join(DAILY_DIR, `keywords_${now.date}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, 'latest.json'), JSON.stringify(snapshot, null, 2), 'utf8');

  const dates = Object.keys(history).sort();
  const index = {
    updatedAt: now.iso,
    dates,
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name })),
  };
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

  // 대시보드용 (백엔드 없이 file:// 로도 열람 가능)
  const web = { index, latest: snapshot, history };
  fs.writeFileSync(path.join(WEB_DIR, 'data.js'), 'window.KEYWORD_DATA = ' + JSON.stringify(web) + ';', 'utf8');

  // 로그
  const okCount = snapshot.sources.filter((s) => s.ok).length;
  const logLine = `${now.iso} collected ${okCount}/${SOURCES.length} sources\n`;
  fs.appendFileSync(path.join(DATA_DIR, 'run.log'), logLine, 'utf8');
  console.log(`\n완료: ${okCount}/${SOURCES.length} 소스 · ${now.date} · 총 ${dates.length}일 누적`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
