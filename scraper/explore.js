// Exploratory script: capture network JSON responses that may contain popular keywords.
const { chromium } = require('playwright');

const TARGET = process.argv[2] || 'musinsa';

const SITES = {
  musinsa: 'https://www.musinsa.com/main/musinsa/recommend?skip_bf=Y&gf=F',
  '29cm': 'https://www.29cm.co.kr/store/search/start',
  wconcept: 'https://display.wconcept.co.kr/rn/women',
  naver: 'https://datalab.naver.com/shoppingInsight/sCategory.naver',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    viewport: { width: 1400, height: 900 },
  });
  const page = await ctx.newPage();

  const hits = [];
  page.on('response', async (res) => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const text = await res.text();
      // heuristic: contains keyword/rank/popular and korean text
      if (/keyword|rank|popular|hot|search|trend|인기|검색/i.test(url + text)) {
        hits.push({ url, len: text.length, sample: text.slice(0, 300) });
      }
    } catch (e) {}
  });

  console.log('LOADING', SITES[TARGET]);
  await page.goto(SITES[TARGET], { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // try to click a search box to trigger popular-keyword panel
  const searchSelectors = [
    'input[type="search"]',
    'input[placeholder*="검색"]',
    '[class*="search" i] input',
    'button[aria-label*="검색"]',
    '[class*="Search" i]',
  ];
  for (const sel of searchSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ timeout: 2000 });
        console.log('clicked', sel);
        await page.waitForTimeout(2500);
        break;
      }
    } catch (e) {}
  }
  await page.waitForTimeout(2000);

  console.log('\n===== JSON HITS (' + hits.length + ') =====');
  for (const h of hits) {
    console.log('\nURL:', h.url);
    console.log('SAMPLE:', h.sample.replace(/\s+/g, ' '));
  }

  await browser.close();
})();
