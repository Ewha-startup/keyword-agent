/**
 * 키워드 검색 추이(증감) 수집기 — trends.js
 *
 * 매일 수집되는 '베스트 키워드'들에 대해 시점별(월별) 검색 추이와 증감을 수집한다.
 *   - 네이버: 데이터랩 쇼핑인사이트 키워드 클릭추이 (키 불필요, 상대지수 0~100)
 *   - 유튜브: 구글 트렌드(유튜브 검색 속성) 상대지수 — best effort
 *             (구글이 데이터센터 IP를 차단하므로 사용자 PC(가정용 IP)에서 실행 권장.
 *              차단(429) 시 해당 키워드 유튜브 값은 건너뛰고 네이버만 저장한다.)
 *
 * 산출물 (../data):
 *   - trends.json         : { updatedAt, unit, keywords: { "<키워드>": {naver, youtube} } }
 *   - trends_index.json   : 키워드별 최신값·증감 요약(백엔드/대시보드용)
 *   - trends_state.json   : 키워드별 마지막 수집 시각(재수집 스킵 판단)
 *   - ../web/trends.js     : window.TREND_DATA (대시보드가 바로 읽음)
 *
 * 옵션:
 *   node trends.js            : 오늘 베스트 키워드 + 누적 추적 키워드 갱신(최근 갱신분 스킵)
 *   node trends.js --force    : 스킵 없이 전부 재수집
 *   node trends.js --months=36: 조회 개월 수(기본 36)
 *   node trends.js --no-youtube : 유튜브 건너뜀
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WEB_DIR = path.join(__dirname, '..', 'web');

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes('--force');
const NO_YT = ARGS.includes('--no-youtube');
const NO_PIN = ARGS.includes('--no-pinterest');
const PIN_COUNTRY = (ARGS.find((a) => a.startsWith('--pin-country=')) || '').split('=')[1] || 'KR';
const MONTHS = parseInt((ARGS.find((a) => a.startsWith('--months=')) || '').split('=')[1] || '36', 10);
const REFRESH_DAYS = 7; // 이 기간 내 갱신된 키워드는 스킵(월별 데이터라 잦은 재수집 불필요)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// 네이버 쇼핑 카테고리 폴백: 패션의류 → 패션잡화 (첫 유효 응답 사용)
const NAVER_CATEGORIES = [
  { cid: '50000000', name: '패션의류' },
  { cid: '50000001', name: '패션잡화' },
];

// ---------- 유틸 ----------
function kstNowIso() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}+09:00`;
}
function monthStartOffset(monthsBack) {
  const d = new Date();
  const kst = new Date(d.getTime() + (9 * 60 - -d.getTimezoneOffset()) * 60000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() - monthsBack;
  const dt = new Date(Date.UTC(y, m, 1));
  return dt.toISOString().slice(0, 10);
}
function todayYmd() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function readJsonSafe(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 대상 키워드 수집 ----------
function collectTrackedKeywords() {
  const history = readJsonSafe(path.join(DATA_DIR, 'history.json'), {});
  const state = readJsonSafe(path.join(DATA_DIR, 'trends_state.json'), { keywords: {} });
  const set = new Set(Object.keys(state.keywords || {})); // 과거 추적분 유지
  // 최근 7일 스냅샷의 모든 플랫폼 베스트 키워드 추가
  const dates = Object.keys(history).sort().slice(-7);
  for (const d of dates) {
    for (const src of history[d].sources || []) {
      if (src.ok) for (const it of src.items) if (it.keyword) set.add(it.keyword.trim());
    }
  }
  return [...set].filter(Boolean);
}

// ---------- 네이버 추이 ----------
async function fetchNaverSeries(keyword) {
  const startDate = monthStartOffset(MONTHS);
  const endDate = todayYmd();
  for (const cat of NAVER_CATEGORIES) {
    const body = new URLSearchParams({
      cid: cat.cid, timeUnit: 'month', startDate, endDate,
      age: '', gender: '', device: '', keyword,
    }).toString();
    let j;
    try {
      const res = await fetch('https://datalab.naver.com/shoppingInsight/getKeywordClickTrend.naver', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Referer: 'https://datalab.naver.com/shoppingInsight/sCategory.naver',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body,
      });
      const txt = await res.text();
      if (txt[0] !== '{') continue; // 301 등 비정상 응답 → 다음 카테고리
      j = JSON.parse(txt);
    } catch (e) { continue; }
    let data = ((j.result || [])[0] || {}).data || [];
    // 이번 달은 집계가 진행 중(부분 데이터)이라 증감 왜곡 → 현재 월 포인트 제외
    const curYm = todayYmd().slice(0, 7).replace('-', ''); // YYYYMM
    data = data.filter((p) => String(p.period).slice(0, 6) !== curYm);
    if (data.length) {
      const points = data.map((p) => ({ period: p.period, value: Math.round(p.value * 10) / 10 }));
      return { source: 'naver', unit: 'month', category: cat.name, points, ...summarize(points, 12) };
    }
  }
  return { source: 'naver', unit: 'month', category: null, points: [], latest: null, momPct: null, yoyPct: null, empty: true };
}

// ---------- 유튜브(구글 트렌드) 추이 — best effort ----------
let GT_COOKIE = null;
async function ensureGtCookie() {
  if (GT_COOKIE) return GT_COOKIE;
  try {
    const res = await fetch('https://trends.google.com/?geo=KR', { headers: { 'User-Agent': UA } });
    const sc = res.headers.get('set-cookie');
    if (sc) GT_COOKIE = sc.split(';')[0];
  } catch (e) {}
  return GT_COOKIE;
}
function stripGtPrefix(t) { return t.replace(/^\)\]\}'\s*/, ''); }
async function gtFetch(url) {
  const cookie = await ensureGtCookie();
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://trends.google.com/trends/explore',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (res.status === 429) throw Object.assign(new Error('rate-limited (429)'), { rate: true });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return stripGtPrefix(await res.text());
}
async function fetchYoutubeSeries(keyword) {
  const time = `today ${MONTHS}-m`;
  const exploreReq = JSON.stringify({
    comparisonItem: [{ keyword, geo: 'KR', time }],
    category: 0, property: 'youtube',
  });
  const exploreUrl =
    'https://trends.google.com/trends/api/explore?hl=ko&tz=-540&req=' +
    encodeURIComponent(exploreReq);
  const meta = JSON.parse(await gtFetch(exploreUrl));
  const widget = (meta.widgets || []).find((w) => w.id === 'TIMESERIES');
  if (!widget) throw new Error('no TIMESERIES widget');
  const mlUrl =
    'https://trends.google.com/trends/api/widgetdata/multiline?hl=ko&tz=-540&req=' +
    encodeURIComponent(JSON.stringify(widget.request)) +
    '&token=' + encodeURIComponent(widget.token);
  const ml = JSON.parse(await gtFetch(mlUrl));
  const timeline = (ml.default && ml.default.timelineData) || [];
  const points = timeline.map((t) => ({
    period: t.formattedAxisTime || t.formattedTime || t.time,
    value: Array.isArray(t.value) ? t.value[0] : t.value,
  }));
  // 구글 트렌드 3년 조회는 주별(≈52) 데이터 → YoY 스텝 52
  return { source: 'youtube', unit: 'week', points, ...summarize(points, 52) };
}

// ---------- 핀터레스트(트렌드) 추이 — best effort ----------
// 국가별 지원(대한민국 포함). 단 한국은 핀터레스트 사용량이 적어 한국어 패션 키워드는
// 데이터가 비어 있는 경우가 많다(있으면 채우고, 없으면 available:false 로 저장).
let PIN_COOKIE = null;
let PIN_END = null;
async function ensurePinterest() {
  if (PIN_COOKIE && PIN_END) return;
  try {
    const res = await fetch('https://trends.pinterest.com/?country=' + PIN_COUNTRY, { headers: { 'User-Agent': UA } });
    const sc = res.headers.get('set-cookie');
    if (sc) PIN_COOKIE = sc.split(',').map((s) => s.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch (e) {}
  try {
    const r = await fetch('https://trends.pinterest.com/latest_available_date/', {
      headers: { 'User-Agent': UA, Referer: 'https://trends.pinterest.com/?country=' + PIN_COUNTRY, 'x-new-site': 'true', ...(PIN_COOKIE ? { Cookie: PIN_COOKIE } : {}) },
    });
    const j = await r.json();
    PIN_END = j.date;
  } catch (e) {}
  if (!PIN_END) { // 폴백: 최근 토요일
    const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
    PIN_END = d.toISOString().slice(0, 10);
  }
}
async function fetchPinterestSeries(keyword) {
  await ensurePinterest();
  const qs = new URLSearchParams({
    terms: keyword, country: PIN_COUNTRY, end_date: PIN_END,
    days: '365', aggregation: '2', normalize_against_group: 'false', predicted_days: '0',
  }).toString();
  const res = await fetch('https://trends.pinterest.com/metrics/?' + qs, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://trends.pinterest.com/?country=' + PIN_COUNTRY,
      'x-new-site': 'true',
      'X-Requested-With': 'XMLHttpRequest',
      ...(PIN_COOKIE ? { Cookie: PIN_COOKIE } : {}),
    },
  });
  if (res.status === 429) throw Object.assign(new Error('rate-limited (429)'), { rate: true });
  const arr = await res.json();
  const g = Array.isArray(arr) && arr[0];
  if (!g || !g.counts || !g.counts.length) {
    return { source: 'pinterest', country: PIN_COUNTRY, unit: 'week', points: [], available: false, reason: 'no-data' };
  }
  const points = g.counts.map((c) => ({ period: c.date, value: c.normalizedCount }));
  const nonzero = points.filter((p) => p.value > 0).length;
  const summary = summarize(points, 52);
  return {
    source: 'pinterest', country: PIN_COUNTRY, unit: 'week',
    available: nonzero > 0, points,
    raw_growth: g.growth_rates || null, // 핀터레스트 자체 wow/mom/yoy
    ...summary,
  };
}

// ---------- 증감 계산 ----------
function pct(cur, prev) {
  if (prev === null || prev === undefined || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10; // 소수1자리 %
}
function summarize(points, yoyStep) {
  if (!points.length) return { latest: null, momPct: null, yoyPct: null };
  // 각 포인트에 직전 대비 증감(%) 부여
  for (let i = 0; i < points.length; i++) {
    points[i].change = i === 0 ? null : pct(points[i].value, points[i - 1].value);
  }
  const n = points.length;
  const latest = points[n - 1].value;
  const prev = n >= 2 ? points[n - 2].value : null;
  // yoyStep(월별=12, 주별≈52) 전 지점과 비교(YoY)
  const yoyIdx = n - 1 - yoyStep;
  const yoyPrev = yoyIdx >= 0 ? points[yoyIdx].value : null;
  return { latest, momPct: pct(latest, prev), yoyPct: pct(latest, yoyPrev) };
}

// ---------- 메인 ----------
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(WEB_DIR, { recursive: true });
  const now = kstNowIso();
  const today = todayYmd();

  const keywords = collectTrackedKeywords();
  if (!keywords.length) { console.log('추적할 키워드가 없습니다. 먼저 scrape.js 를 실행하세요.'); return; }

  const store = readJsonSafe(path.join(DATA_DIR, 'trends.json'), { updatedAt: null, unit: 'month', keywords: {} });
  const state = readJsonSafe(path.join(DATA_DIR, 'trends_state.json'), { keywords: {} });
  store.keywords = store.keywords || {};
  state.keywords = state.keywords || {};

  let ytBlocked = false, pinBlocked = false, done = 0, skipped = 0;
  for (const kw of keywords) {
    const last = state.keywords[kw] && state.keywords[kw].updatedAt;
    if (!FORCE && last) {
      const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
      if (ageDays < REFRESH_DAYS && store.keywords[kw] && store.keywords[kw].naver && !store.keywords[kw].naver.empty) {
        skipped++; continue;
      }
    }
    const entry = store.keywords[kw] || { keyword: kw };
    // 네이버
    try {
      entry.naver = await fetchNaverSeries(kw);
    } catch (e) {
      entry.naver = entry.naver || { source: 'naver', points: [], latest: null, error: String(e.message || e) };
    }
    await sleep(450); // 예의상 지연

    // 유튜브 (best effort)
    if (!NO_YT && !ytBlocked) {
      try {
        entry.youtube = await fetchYoutubeSeries(kw);
        await sleep(1200);
      } catch (e) {
        if (e.rate) { ytBlocked = true; console.warn('  [유튜브] 429 차단 감지 → 이후 유튜브 수집 중단(네이버만 계속)'); }
        entry.youtube = entry.youtube || { source: 'youtube', points: [], available: false, reason: String(e.message || e) };
      }
    } else if (!entry.youtube) {
      entry.youtube = { source: 'youtube', points: [], available: false, reason: NO_YT ? 'disabled' : 'blocked' };
    }

    // 핀터레스트 (best effort)
    if (!NO_PIN && !pinBlocked) {
      try {
        entry.pinterest = await fetchPinterestSeries(kw);
        await sleep(500);
      } catch (e) {
        if (e.rate) { pinBlocked = true; console.warn('  [핀터레스트] 429 차단 감지 → 이후 핀터레스트 수집 중단'); }
        entry.pinterest = entry.pinterest || { source: 'pinterest', points: [], available: false, reason: String(e.message || e) };
      }
    } else if (!entry.pinterest) {
      entry.pinterest = { source: 'pinterest', points: [], available: false, reason: NO_PIN ? 'disabled' : 'blocked' };
    }

    entry.updatedAt = now;
    store.keywords[kw] = entry;
    state.keywords[kw] = { updatedAt: now };
    done++;
    const nv = entry.naver || {};
    const pin = entry.pinterest || {};
    console.log(`[${done}/${keywords.length}] ${kw}  네이버 ${nv.points ? nv.points.length : 0}pt` +
      (nv.latest != null ? ` 최신 ${nv.latest} (MoM ${nv.momPct ?? '-'}% · YoY ${nv.yoyPct ?? '-'}%)` : ' (데이터 없음)') +
      (entry.youtube && entry.youtube.points && entry.youtube.points.length ? ` · YT ${entry.youtube.points.length}pt` : '') +
      (pin.available ? ` · PIN ${pin.points.length}pt YoY ${pin.yoyPct ?? '-'}%` : ''));
  }

  store.updatedAt = now;
  store.unit = 'month';
  fs.writeFileSync(path.join(DATA_DIR, 'trends.json'), JSON.stringify(store, null, 2), 'utf8');
  fs.writeFileSync(path.join(DATA_DIR, 'trends_state.json'), JSON.stringify(state, null, 2), 'utf8');

  // 요약 인덱스
  const pinCount = Object.values(store.keywords).filter((e) => e.pinterest && e.pinterest.available).length;
  const index = {
    updatedAt: now,
    unit: 'month',
    months: MONTHS,
    youtubeAvailable: !ytBlocked && !NO_YT,
    pinterestCountry: PIN_COUNTRY,
    pinterestAvailableCount: pinCount,
    keywords: Object.values(store.keywords).map((e) => ({
      keyword: e.keyword,
      naverLatest: e.naver ? e.naver.latest : null,
      naverMomPct: e.naver ? e.naver.momPct : null,
      naverYoyPct: e.naver ? e.naver.yoyPct : null,
      youtubeLatest: e.youtube ? e.youtube.latest ?? null : null,
      youtubeYoyPct: e.youtube ? e.youtube.yoyPct ?? null : null,
      pinterestLatest: e.pinterest && e.pinterest.available ? e.pinterest.latest ?? null : null,
      pinterestYoyPct: e.pinterest && e.pinterest.available ? e.pinterest.yoyPct ?? null : null,
      updatedAt: e.updatedAt,
    })).sort((a, b) => (b.naverYoyPct ?? -1e9) - (a.naverYoyPct ?? -1e9)),
  };
  fs.writeFileSync(path.join(DATA_DIR, 'trends_index.json'), JSON.stringify(index, null, 2), 'utf8');
  fs.writeFileSync(path.join(WEB_DIR, 'trends.js'), 'window.TREND_DATA = ' + JSON.stringify({ index, series: store.keywords }) + ';', 'utf8');

  fs.appendFileSync(path.join(DATA_DIR, 'run.log'), `${now} trends: ${done} updated, ${skipped} skipped, youtube=${ytBlocked ? 'blocked' : (NO_YT ? 'off' : 'ok')}, pinterest=${pinBlocked ? 'blocked' : (NO_PIN ? 'off' : pinCount + '/' + Object.keys(store.keywords).length)}\n`, 'utf8');
  console.log(`\n완료: ${done}개 갱신 · ${skipped}개 스킵 · 유튜브 ${ytBlocked ? '차단됨' : (NO_YT ? '비활성' : '수집')} · 핀터레스트(${PIN_COUNTRY}) ${NO_PIN ? '비활성' : pinCount + '개 키워드 데이터有'} · 추적 ${keywords.length}개`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
