/* 대시보드 렌더러: window.KEYWORD_DATA (data.js) 를 읽어 4개 소스 카드로 표시 */
(function () {
  const DATA = window.KEYWORD_DATA;
  const LOGO = {
    naver: { cls: 'naver', txt: 'N' },
    musinsa: { cls: 'musinsa', txt: 'M' },
    wconcept: { cls: 'wconcept', txt: 'W' },
    '29cm': { cls: 'c29', txt: '29' },
  };
  const ORDER = ['naver', 'musinsa', 'wconcept', '29cm'];

  if (!DATA || !DATA.index || !DATA.index.dates.length) {
    document.getElementById('cards').innerHTML =
      '<p class="err-msg">아직 수집된 데이터가 없습니다. 스크래퍼를 먼저 실행하세요.</p>';
    return;
  }

  const dateSel = document.getElementById('dateSel');
  const dates = DATA.index.dates.slice().sort().reverse();
  dateSel.innerHTML = dates
    .map((d) => `<option value="${d}">${d}</option>`)
    .join('');
  dateSel.value = dates[0];
  dateSel.addEventListener('change', () => render(dateSel.value));

  document.getElementById('dayCount').textContent =
    `누적 ${DATA.index.dates.length}일`;

  function changeCell(it) {
    if (it.isNew) return '<span class="chg new">NEW</span>';
    if (it.change === null || it.change === undefined)
      return '<span class="chg same">–</span>';
    if (it.change > 0) return `<span class="chg up">▲${it.change}</span>`;
    if (it.change < 0) return `<span class="chg down">▼${Math.abs(it.change)}</span>`;
    return '<span class="chg same">–</span>';
  }

  function srcTimeLabel(s) {
    if (!s.sourceUpdatedAt) return '';
    return `기준: ${s.sourceUpdatedAt}`;
  }

  function render(date) {
    const snap = DATA.history[date];
    const cards = document.getElementById('cards');
    document.getElementById('collectedAt').textContent = snap
      ? `· 수집: ${snap.collectedAt.replace('T', ' ').slice(0, 19)}`
      : '';

    const byId = {};
    (snap ? snap.sources : []).forEach((s) => (byId[s.id] = s));

    cards.innerHTML = ORDER.map((id) => {
      const s = byId[id];
      const lg = LOGO[id];
      const name = s ? s.name : id;
      if (!s || !s.ok || !s.items.length) {
        return `<section class="card error">
          <div class="card-head"><span class="logo ${lg.cls}">${lg.txt}</span><h2>${name}</h2></div>
          <div class="err-msg">수집 실패${s && s.error ? ': ' + s.error : ''}</div>
        </section>`;
      }
      const rows = s.items
        .map(
          (it) => `<li>
            <span class="rank ${it.rank <= 3 ? 'top' : ''}">${it.rank}</span>
            <span class="kw">${escapeHtml(it.keyword)}</span>
            ${changeCell(it)}
          </li>`
        )
        .join('');
      return `<section class="card">
        <div class="card-head">
          <span class="logo ${lg.cls}">${lg.txt}</span>
          <h2>${name} 키워드</h2>
          ${s.stale ? '<span class="stale-tag">이전값</span>' : ''}
        </div>
        <div class="src-time">${srcTimeLabel(s)}</div>
        <ol class="list">${rows}</ol>
      </section>`;
    }).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  render(dateSel.value);
})();
