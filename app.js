// Alex Stock Screener 대시보드 (스펙 §8, M4). 판단 로직은 빌드(site/build.py)가 계산해 summary.json에 넣는다.
// 여기서는 그리기와 화면 필터만 한다. 로컬 서버(serve.py)로 열면 ★로 관심 종목을 바꿀 수 있고, 공개 페이지에서는 읽기 전용.
'use strict';
const $ = id => document.getElementById(id);
const TAG = {BREAKOUT: 't-brk', ABOVE_PIVOT_LOW_VOL: 't-weak', WATCH: 't-wat', FORMING: 't-frm', FAILED: 't-bad',
  MISSED: 't-frm', EXTENDED: 't-frm', UNTRACKED: 't-frm', NO_SETUP: 't-frm', NO_DATA: 't-frm'};
const IDX = {'^GSPC': 'S&P 500', '^IXIC': '나스닥', '^KS11': 'KOSPI', '^KQ11': 'KOSDAQ'};
const MK = {US: '미국', KR: '한국'};
const REASON = {NOT_DECREASING: '수축 깊이가 매번 줄지 않음', MANY_CONTRACTIONS: '수축이 너무 많음',
  FEW_CONTRACTIONS: '수축이 1회뿐', FINAL_OUT_OF_RANGE: '마지막 수축 깊이가 범위 밖', FIRST_TOO_DEEP: '첫 수축이 너무 깊음',
  LOWER_LOW: '저점이 높아지지 않음', NO_CONTRACTION: '수축 없음', SHORT_HISTORY: '이력 부족'};
const GRADE_ORDER = {'A+': 4, A: 3, B: 2, C: 1};
const PAGE = 300;

const VER = (document.querySelector('meta[name=build]') || {}).content || '';
const V = u => VER ? `${u}?v=${VER}` : u;  // 빌드 번호로 캐시 무효화 (Pages 캐시 10분)
let S = null, R = [], BY = {}, SPARK = null, EDIT = false, ITEMS = {}, cur = null, tab = 'today', allLimit = PAGE;
const DET = {};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fp = (v, mk) => v == null ? '—' : mk === 'KR' ? Math.round(v).toLocaleString('ko-KR')
  : v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pct = (v, d = 1) => v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(d) + '%';
const riskLbl = r => r.rb === 'plan' ? '피벗 매수 시' : '지금 매수 시';
// 공개 페이지 별 (2026-10-15): 텔레그램으로 요청한 것을 이 브라우저에 기억해 다음 빌드 전에도 별을 바꿔 보인다.
// 요청 시각보다 새 빌드가 오면 빌드 값(실제 관심 목록)을 믿고 지운다
const PKEY = 'pendingStars';
let PEND = {};
function loadPend() {
  try { PEND = JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch (e) { PEND = {}; }
  const built = Date.parse(S.builtAt);
  for (const [k, v] of Object.entries(PEND)) if (!(v && v.at > built)) delete PEND[k];
  savePend();
}
function savePend() { try { localStorage.setItem(PKEY, JSON.stringify(PEND)); } catch (e) { /* 저장 불가: 이번 화면에서만 */ } }
const watched = r => r.id in ITEMS || (!EDIT && (PEND[r.id] ? PEND[r.id].op === 'w' : r.w));
const addedClose = r => (ITEMS[r.id] && ITEMS[r.id].added_close) ?? r.addedClose;

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

const starBtn = r => {
  const on = watched(r), bot = S.params.bot;
  if (!EDIT && bot) return `<a class="star${PEND[r.id] ? ' pend' : ''}" data-tgstar="${esc(r.id)}" href="https://t.me/${encodeURIComponent(bot)}?start=${on ? 'u' : 'w'}_${r.mk}_${encodeURIComponent(r.tk)}" target="_blank" rel="noopener"
    aria-pressed="${on}" title="${PEND[r.id] ? '텔레그램에서 요청함 (시작을 눌렀다면 다음 자동 실행 때 확정). 다시 누르면 ' : '텔레그램에서 관심 종목 '}${on ? '해제' : '추가'}" aria-label="${esc(r.tk)} 관심 종목 ${on ? '해제' : '추가'} (텔레그램 열림)">${on ? '★' : '☆'}</a>`;
  return `<button class="star" data-star="${esc(r.id)}" aria-pressed="${on}" ${EDIT ? '' : 'disabled title="공개 페이지에서는 바꿀 수 없습니다. PC 로컬 대시보드에서 바꾸세요."'}
    aria-label="${esc(r.tk)} 관심 종목 ${on ? '해제' : '추가'}">${on ? '★' : '☆'}</button>`;
};
const tagH = r => `<span class="tag ${TAG[r.st] || 't-frm'}">${esc(r.stk || '—')}</span>`;
const nameH = r => `<span class="k">${r.mk}</span><span class="mut mob-hide">${r.mk}</span>&nbsp; <b class="tk">${esc(r.tk)}</b>&nbsp; <span class="mut">${esc(r.nm || '')}</span>`;
const riskCell = r => r.risk == null ? '—' : `${(r.risk * 100).toFixed(1)}%`;

// 상세 수치 줄과 가격 사다리 (2026-10-12). 색은 뜻 하나씩: 녹색 매수 구간, 빨강 손절, 파랑 익절 참고(2R 이상), 주황 추격 주의(+5% 위).
// 기준은 S.params.judge (config). 위치는 배치의 dist를 써서 상태 뱃지(확장, 놓침)와 같은 값으로 판정한다
const pctN = v => +(v * 100).toFixed(1);
function judge(r) {
  const J = S.params.judge, d = r.dist ?? (r.piv && r.cl != null ? r.cl / r.piv - 1 : null);
  if (d == null || r.stop == null || r.cl == null) return null;
  if (r.cl <= r.stop) return ['no', '손절가 이하'];
  if (d >= 0 && d <= J.buyZone) return ['go', `피벗 ${pct(d)}, 매수 구간`];
  // 손절 폭이 아주 좁으면 2R이 매수 구간 안에 들어온다. 파랑은 매수 구간을 넘은 뒤에만
  if (d > J.buyZone && r.t2 != null && r.cl >= r.t2) return ['tp', `${r.t3 != null && r.cl >= r.t3 ? '3R' : '2R'} 도달, 익절 참고`];
  if (d > J.skipAbove) return ['hot', `피벗 ${pct(d)}, 추격 금지`];
  if (d > J.buyZone) return ['hot', `피벗 ${pct(d)}, 확장 (추격 주의)`];
  return ['', `피벗 ${pct(d)}, ${d >= -J.buyZone ? '피벗 바로 아래' : '기저 형성 중'}`];
}
function stripH(r) {
  const J = S.params.judge, pos = judge(r), hasStop = r.stop != null;
  const over = r.risk != null && r.risk > J.maxStop + 1e-9, weak = r.rs != null && r.rs < J.rsMin;
  const sub = (k, t) => `<div class="sub ${k}">${t}</div>`;
  const cell = (l, v, k, s, lk = '') => `<div><div class="l ${lk}">${l}</div><div class="v ${k}">${v}</div>${s}</div>`;
  return [
    cell('종가', fp(r.cl, r.mk), pos ? pos[0] : '', pos ? sub(pos[0], pos[1]) : ''),
    cell('피벗', fp(r.piv, r.mk), '', r.piv && r.cl ? sub('', '종가까지 ' + pct(r.piv / r.cl - 1)) : ''),
    cell('손절', fp(r.stop, r.mk), hasStop ? 'no' : '', hasStop && r.cl ? sub('no', '종가 대비 ' + pct(r.stop / r.cl - 1)) : '', hasStop ? 'no' : ''),
    cell(`손절 폭 (${riskLbl(r)})`, riskCell(r), over ? 'no' : '', r.risk != null ? sub(over ? 'no' : '', `한도 ${pctN(J.maxStop)}% ${over ? '초과' : '이내'}`) : ''),
    cell('RS', r.rs ?? '—', weak ? 'no' : '', r.rs != null ? sub(weak ? 'no' : '', `기준 ${J.rsMin} ${weak ? '미만' : '이상'}`) : ''),
  ].join('');
}
function ladderH(r) {
  if (r.piv == null || r.stop == null || r.cl == null || !(r.piv > r.stop)) return '';
  const J = S.params.judge, P = r.piv, R = P - r.stop, f = v => fp(v, r.mk), pos = judge(r);
  const lo = Math.min(r.stop, r.cl) - R * .45, top = Math.max(P * (1 + J.skipAbove), r.cl, r.t3 ?? P), hi = top + (top - lo) * .02;
  const x = v => ((v - lo) / (hi - lo) * 100).toFixed(2) + '%', span = (a, b) => `left:${x(a)};width:calc(${x(b)} - ${x(a)})`;
  const zones = [['loss', lo, r.stop], ['', r.stop, P], ['buy', P, P * (1 + J.buyZone)], ['ext', P * (1 + J.buyZone), hi]]
    .filter(z => z[2] > z[1]).map(([k, a, b]) => `<i class="z ${k}" style="${span(a, b)}"></i>`).join('');
  // data-p: 라벨 우선순위 (작을수록 중요). 겹치면 큰 번호부터 숨긴다 (ladFit)
  const tk = (k, v) => `<i class="tk ${k}" style="left:${x(v)}"></i>`;
  const lb = (k, v, p, t) => `<span class="lb ${k}" data-p="${p}" style="left:${x(v)}">${t}</span>`;
  const tg = [[r.t2, '2R', 3], [r.t3, '3R', 4]].filter(t => t[0] != null);
  const entry = r.risk != null ? r.stop / (1 - r.risk) : null;  // 손절 폭과 같은 진입가 (지금 매수면 max(피벗, 종가), 호가 반영)
  const br = entry > r.stop ? `<i class="br" style="${span(r.stop, entry)}"></i>` +
    `<span class="lb brl" data-p="1" style="left:calc((${x(r.stop)} + ${x(entry)}) / 2)">−${riskCell(r)}${r.rb === 'plan' ? ' (피벗 매수 시)' : ''}</span>` : '';
  const aria = `가격 사다리: 종가 ${f(r.cl)}${pos ? ', ' + pos[1] : ''}. 손절 ${f(r.stop)}, 피벗 ${f(P)}, 매수 구간 +${pctN(J.buyZone)}%까지` +
    tg.map(([v, n]) => `, ${n} ${f(v)}`).join('');
  return `<div class="lad" role="img" aria-label="${esc(aria)}">${zones}` +
    tk('piv', P) + tk('', P * (1 + J.buyZone)) + tk('', P * (1 + J.skipAbove)) + tg.map(([v]) => tk('tg', v)).join('') + tk('stop', r.stop) +
    lb('stop', r.stop, 0, `손절<span class="pr"> ${f(r.stop)}</span>`) + lb('', P, 2, '피벗') + lb('', P * (1 + J.buyZone), 5, `+${pctN(J.buyZone)}%`) +
    lb('', P * (1 + J.skipAbove), 6, `+${pctN(J.skipAbove)}%`) + tg.map(([v, n, p]) => lb('tg', v, p, `${n}<span class="pr"> ${f(v)}</span>`)).join('') +
    `<i class="now" style="left:${x(r.cl)}"></i>` + lb(`nl ${pos ? pos[0] : ''}`, r.cl, 1, `종가 ${f(r.cl)}`) + br + '</div>' +
    `<div class="lgd"><span><i class="sw2 loss"></i>손절 아래</span><span><i class="sw2"></i>기저</span><span><i class="sw2 buy"></i>매수 구간 (+${pctN(J.buyZone)}%)</span>` +
    `<span><i class="sw2 ext"></i>추격 주의 (+${pctN(J.buyZone)}% 위)</span>${tg.length ? '<span><i class="sw2 tg"></i>2R, 3R 익절 참고 (피벗 매수 기준)</span>' : ''}</div>`;
}
// 라벨이 카드 밖으로 나가면 안쪽으로 밀고, 겹치면 우선순위 낮은 쪽을 숨긴다. 폭이 바뀌면 다시 (창 크기)
function ladFit() {
  const L = document.querySelector('#dlad .lad'); if (!L || !L.offsetWidth) return;
  const box = L.getBoundingClientRect(), kept = [];
  for (const e of [...L.querySelectorAll('[data-p]')].sort((a, b) => a.dataset.p - b.dataset.p)) {
    e.style.visibility = ''; e.style.transform = '';
    let a = e.getBoundingClientRect();
    const dx = a.left < box.left ? box.left - a.left : a.right > box.right ? box.right - a.right : 0;
    if (dx) { e.style.transform = `translateX(calc(-50% + ${dx}px))`; a = e.getBoundingClientRect(); }
    if (kept.some(b => a.left < b.right + 6 && b.left < a.right + 6 && a.top < b.bottom && b.top < a.bottom)) e.style.visibility = 'hidden';
    else kept.push(a);
  }
}
let ladT; addEventListener('resize', () => { clearTimeout(ladT); ladT = setTimeout(ladFit, 150); });
// 그래프는 칸 폭이 바뀔 때마다 맞춘다 (2026-10-12). plotly responsive는 창 resize만 보고 숨은 그래프는 건너뛴다.
// 다른 탭에 있을 때 창 크기가 바뀌면 돌아와도 예전 폭(638px가 918px 칸 왼쪽에)으로 남던 버그. 숨었다 보이는 순간도 폭 변화로 잡힌다
function fitEl(el) {
  if (el.id === 'dlad') return ladFit();
  if (el._fullLayout && el.clientWidth && Math.abs(el._fullLayout.width - el.clientWidth) > 1) Plotly.Plots.resize(el);
}
const fitRO = new ResizeObserver(es => es.forEach(e => fitEl(e.target)));
const fitWatch = el => { fitRO.observe(el); return el; };

function headRow(cols) { return `<div class="hd">${cols.map(c => `<span${c[1] ? ' class="r"' : ''}>${c[0]}</span>`).join('')}</div>`; }

function stdRow(r, stateCell) {
  return `<div class="rw ${r.id === cur ? 'sel' : ''}" data-k="${esc(r.id)}">
  <span class="c" style="--o:1;--fb:calc(100% - 46px)">${nameH(r)}</span>
  <span class="c sec" style="--o:4" title="${esc(r.secd || '')}">${esc(r.sec || '—')}</span>
  <span class="c" style="--o:3">${stateCell}</span>
  <span class="c r mob-hide" style="--o:5"><span class="k">피벗</span>${fp(r.piv, r.mk)}</span>
  <span class="c r" style="--o:5"><span class="k">대비</span>${pct(r.dist)}</span>
  <span class="c r" style="--o:5" title="${riskLbl(r)}"><span class="k">손절 폭</span>${riskCell(r)}</span>
  <span class="c r" style="--o:5"><span class="k">RS</span>${r.rs ?? '—'}</span>
  <span class="c ctr" style="--o:5"><span class="k">재무</span>${esc(r.grade || '—')}</span>
  <span class="c" style="--o:2">${starBtn(r)}</span></div>`;
}
// 섹터 칸 (2026-10-13). 숫자 네 칸은 같은 폭, 재무는 가운데 (머리 간격이 들쭉날쭉하던 것, 2026-10-13)
const STD_COLS = '--cols:2fr 1.3fr 1.4fr .8fr .8fr .8fr .8fr .7fr 32px';
const byRank = (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.rs ?? -1) - (a.rs ?? -1);
// 전체 후보 정렬 (2026-10-11). 첫 클릭은 보통 먼저 보고 싶은 쪽, 두 번째는 반대, 세 번째는 기본 순위.
// 피벗가는 달러와 원이 한 열에 섞여 있어 정렬하지 않는다. 값이 없으면 방향과 관계없이 맨 아래, 같으면 순위 순
const SORTS = {dist: {t: '피벗 대비', get: r => r.dist, first: -1, lab: ['낮은 순', '높은 순']},
  risk: {t: '손절 폭', get: r => r.risk, first: 1, lab: ['좁은 순', '넓은 순']},
  rs: {t: 'RS', get: r => r.rs, first: -1, lab: ['낮은 순', '높은 순']},
  grade: {t: '재무', get: r => GRADE_ORDER[r.g], first: -1, lab: ['낮은 순', '높은 순']}};
// 거르기와 정렬 상태는 표마다 따로 (2026-10-13). 오늘 표와 전체 후보 표가 같은 장치를 쓴다
const F0 = () => ({mk: '', st: '', sec: '', k: '', dir: 0, open: false});
// 오늘 탭은 신호(돌파, 관찰, 약한 돌파, 형성)를 먼저, 나머지 변화는 접는다 (2026-10-15). 42건 중 30건이 기저 없음이라 신호가 묻혔다
const SIG = ['BREAKOUT', 'WATCH', 'ABOVE_PIVOT_LOW_VOL', 'FORMING'];
const F = {today: F0(), all: F0()};
function sorter(f) {
  if (!f.k) return byRank;
  const g = SORTS[f.k].get;
  return (a, b) => {
    const x = g(a), y = g(b);
    if (x == null || y == null) return (x == null) - (y == null) || byRank(a, b);
    return (x - y) * f.dir || byRank(a, b);
  };
}
const keep = (f, skip) => r => (skip === 'mk' || !f.mk || r.mk === f.mk) && (skip === 'st' || !f.st || r.st === f.st) && (skip === 'sec' || !f.sec || r.sec === f.sec);
const todayBase = () => R.filter(r => r.chg === true);
const todayRows = () => todayBase().filter(keep(F.today)).sort(sorter(F.today));
const watchRows = () => R.filter(watched).sort((a, b) => a.wr - b.wr || (b.rs ?? -1) - (a.rs ?? -1));
const allRows = () => candidates(filt()).sort(sorter(F.all));

function renderToday() {
  queueMicrotask(navBar);  // 거르기, 정렬이 바뀌면 이동 줄 위치도 다시
  const L = $('todayList'), base = todayBase(), f = F.today, rows = todayRows();
  L.style.cssText = STD_COLS;
  $('n-today').textContent = base.length;
  const stRows = base.filter(keep(f, 'st'));
  $('todayBar').innerHTML = base.length ? mobBar('today', stRows) : '';
  $('todayMk').innerHTML = base.length ? mkSeg(base.filter(keep(f, 'mk')), f.mk) : '';
  $('todayChips').innerHTML = base.length ? stChips(stRows, f.st) : '';
  if (!base.length) {
    const n = R.filter(r => watched(r) && (r.st === 'WATCH' || r.st === 'FORMING')).length;
    const first = Object.values(S.markets).every(m => m.firstRun);
    const head = first ? '첫 실행이라 전날 상태와 비교할 수 없습니다. 다음 배치부터 바뀐 종목이 여기에 나옵니다.'
      : '오늘 상태가 바뀐 종목이 없습니다.';
    L.innerHTML = `<div class="empty">${head}<br>관찰 중인 관심 종목 ${n}개는 <button class="mockbtn" data-go="watch">관심 종목 탭</button>에서 볼 수 있습니다.</div>`;
    return;
  }
  const row = r => stdRow(r, `<span class="mut">${r.stp ? esc(S.stateKo[r.stp] || r.stp) : '신규'} →</span> ${tagH(r)}`);
  let body;
  if (!rows.length) body = '<div class="empty">조건에 맞는 종목이 없습니다.</div>';
  else if (f.st) body = rows.map(row).join('');
  else {
    const sig = rows.filter(r => SIG.includes(r.st)), rest = rows.filter(r => !SIG.includes(r.st));
    body = `<div class="grp"><b>신호</b><span>돌파, 관찰, 약한 돌파, 형성 · ${sig.length}</span></div>` +
      (sig.length ? sig.map(row).join('') : '<div class="empty">오늘 새 신호가 없습니다.</div>') +
      (rest.length ? `<button type="button" class="fold" data-fold aria-expanded="${f.open}"><span>그 밖의 변화 <span class="mut">기저 없음, 이격 과다 등 · ${rest.length}</span></span>` +
        `<span aria-hidden="true">${f.open ? '▴' : '▾'}</span></button>` + (f.open ? rest.map(row).join('') : '') : '');
  }
  L.innerHTML = `<div class="hd">${listHead('today', stRows)}</div>` + body;
}

// 머리 칸: 섹터, 상태 드롭다운(건수는 다른 조건을 건 상태 기준)과 정렬 화살표. 휴대폰은 머리가 숨겨져 표 위 선택 상자
function countBy(rows, k) { const n = {}; for (const r of rows) if (r[k]) n[r[k]] = (n[r[k]] || 0) + 1; return n; }
function stOpts(rows, cur) {
  const n = countBy(rows, 'st'), ORD = Object.keys(TAG);  // 돌파부터
  const ks = [...new Set([...Object.keys(n), ...(cur ? [cur] : [])])].sort((a, b) => ORD.indexOf(a) - ORD.indexOf(b));
  return '<option value="">상태 전체</option>' + ks.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(S.stateKo[v] || v)} (${n[v] || 0})</option>`).join('');
}
function sortOpts(f) {
  return '<option value="">순위 (기본)</option>' + Object.entries(SORTS).map(([k, o]) => [o.first, -o.first].map(d =>
    `<option value="${k}:${d}"${f.k === k && f.dir === d ? ' selected' : ''}>${o.t} ${o.lab[d > 0 ? 0 : 1]}</option>`).join('')).join('');
}
function listHead(list, stRows) {
  const f = F[list];
  const sb = (k, cls) => {  // cls: r(오른쪽 정렬 숫자 칸) 또는 ctr(가운데)
    const on = f.k === k, next = !on ? SORTS[k].first : f.dir === SORTS[k].first ? -SORTS[k].first : 0;
    const lab = `${SORTS[k].t} ${next ? SORTS[k].lab[next > 0 ? 0 : 1] + '으로 정렬' : '정렬 해제 (기본 순위)'}`;
    return `<span class="${cls}" role="columnheader" aria-sort="${on ? (f.dir > 0 ? 'ascending' : 'descending') : 'none'}">` +
      `<button class="sortb" data-sort="${k}" data-list="${list}"${on ? ' data-on' : ''} aria-label="${lab}">${SORTS[k].t}` +
      `<span class="ar" aria-hidden="true">${on ? (f.dir > 0 ? '▲' : '▼') : '↕'}</span></button></span>`;
  };
  const sel = (k, opts, lab) => `<span><select class="hsel${f[k] ? ' on' : ''}" data-f="${k}" data-list="${list}" aria-label="${lab}">${opts}</select></span>`;
  return `<span>종목</span><span class="dd">${secBtn(list, 'head')}</span>${list === 'today' ? '<span>상태</span>' : sel('st', stOpts(stRows, f.st), '상태로 거르기')}` +
    `<span class="r">피벗가</span>${sb('dist', 'r')}${sb('risk', 'r')}${sb('rs', 'r')}${sb('grade', 'ctr')}<span></span>`;
}
// 수집률 경고 띠 (2026-10-15). 미장 10/14가 47.7%였는데 화면에 아무 표시가 없었다
function dqBanner() {
  const min = S.params.minCoverage, bad = Object.entries(S.markets).filter(([, x]) =>
    x.degraded || (min != null && x.coverage != null && x.coverage < min));
  $('dqBan').hidden = !bad.length;
  $('dqBan').innerHTML = bad.map(([m, x]) => {
    const d = new Date(x.asof + 'T00:00:00');
    return `<b>${MK[m]} ${d.getMonth() + 1}월 ${d.getDate()}일 수집률 ${(x.coverage * 100).toFixed(1)}%</b>` +
      `${min != null ? ` (기준 ${Math.round(min * 100)}%)` : ''}. 가격을 다 받지 못해 숫자가 불완전할 수 있습니다. 다음 자동 실행에서 다시 만듭니다.`;
  }).join('<br>');
}
// 시장 버튼 (2026-10-15 B안). 건수는 시장을 뺀 나머지 조건 기준
function mkSeg(rows, cur) {
  const n = m => m ? rows.filter(r => r.mk === m).length : rows.length;
  return [['', '전체'], ['US', '미장'], ['KR', '국장']].map(([v, t]) =>
    `<button type="button" data-mk="${v}" aria-pressed="${cur === v}">${t}<span class="n">${n(v)}</span></button>`).join('');
}
// 상태 칩 (2026-10-15): 오늘 탭의 상태 선택 상자를 대신한다. 건수는 상태를 뺀 나머지 조건 기준
function stChips(rows, cur) {
  const n = countBy(rows, 'st'), ks = Object.keys(TAG).filter(k => n[k] || k === cur);
  return [['', '전체', rows.length], ...ks.map(k => [k, S.stateKo[k] || k, n[k] || 0])].map(([v, t, c]) =>
    `<button type="button" class="chip" data-st="${v}" aria-pressed="${cur === v}">${esc(t)}<span class="n">${c}</span></button>`).join('');
}
function mobBar(list, stRows) {
  const f = F[list], sel = (k, opts, lab) => `<label><span class="kk">${lab}</span><select data-f="${k}" data-list="${list}">${opts}</select></label>`;
  return `<span class="lbl"><span class="kk">섹터</span>${secBtn(list, 'mob')}</span>` + (list === 'today' ? '' : sel('st', stOpts(stRows, f.st), '상태')) + sel('sort', sortOpts(f), '정렬');
}

// 섹터 고르기 (2026-10-13 B안). 기본 드롭다운은 다크 모드에서 흰 바탕에 흐린 글자가 되고, 두 시장 업종이 섞여 읽기 어려웠다.
// 검색칸, 시장별 묶음(미장 섹터, 국장 업종), 오른쪽 건수. 목록은 body에 하나만 띄워 표를 다시 그려도 열린 상태가 남는다
const MKLAB = {US: '미장 섹터', KR: '국장 업종'};
let SP = null;  // 열린 목록 {list, place, q, act, opts}
const secRowsOf = list => list === 'all' ? candidates({...filt(), sec: ''}) : todayBase().filter(keep(F.today, 'sec'));
function secBtn(list, place) {
  const v = F[list].sec, open = !!(SP && SP.list === list && SP.place === place);
  return `<button type="button" class="ddb${v ? ' on' : ''}" data-secdd="${list}" data-place="${place}" aria-haspopup="listbox" aria-expanded="${open}" aria-label="섹터로 거르기, 지금 ${esc(v || '전체')}">` +
    `<span>${esc(v || '섹터 전체')}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`;
}
function secItems(list, q) {
  // 건수는 섹터를 뺀 나머지 조건 기준. 섹터가 없는 종목은 '섹터 전체'에만 센다
  const rows = secRowsOf(list), cur = F[list].sec, ql = q.toLowerCase(), out = [{v: '', t: '섹터 전체', n: rows.length, all: true}];
  for (const m of ['US', 'KR']) {
    const n = countBy(rows.filter(r => r.mk === m), 'sec');
    const ks = Object.keys(n).filter(k => !ql || k.toLowerCase().includes(ql)).sort((a, b) => n[b] - n[a] || a.localeCompare(b, 'ko'));
    if (ks.length) out.push({grp: MKLAB[m], n: ks.reduce((t, k) => t + n[k], 0)}, ...ks.map(k => ({v: k, t: k, n: n[k]})));
  }
  if (cur && !ql && !out.some(x => x.v === cur)) out.splice(1, 0, {v: cur, t: cur, n: 0});  // 다른 조건으로 0건이 된 선택도 보이게
  return out;
}
function secFill(initial) {
  const it = secItems(SP.list, SP.q), opts = it.filter(x => !x.grp), cur = F[SP.list].sec;
  if (initial) SP.act = Math.max(0, opts.findIndex(o => o.v === cur));
  SP.act = Math.min(SP.act, opts.length - 1); SP.opts = opts;
  let k = -1;
  $('secL').innerHTML = it.map(x => {
    if (x.grp) return `<div class="grp" role="presentation"><span>${x.grp}</span><span>${x.n}</span></div>`;
    k++;
    return `<div class="opt${x.all ? ' all' : ''}${k === SP.act ? ' act' : ''}" id="secO${k}" role="option" data-i="${k}" aria-selected="${x.v === cur}">` +
      `<span class="ck" aria-hidden="true">✓</span><span class="nm">${esc(x.t)}</span><span class="n">${x.n}</span></div>`;
  }).join('') + (opts.length === 1 && SP.q ? '<div class="none">맞는 업종이 없습니다</div>' : '');
  $('secQ').setAttribute('aria-activedescendant', 'secO' + SP.act);
  $('secO' + SP.act)?.scrollIntoView({block: 'nearest'});
}
function secOpen(btn) {
  const pop = $('secPop');
  SP = {list: btn.dataset.secdd, place: btn.dataset.place, q: '', act: 0};
  pop.innerHTML = '<input id="secQ" type="search" placeholder="업종 검색 (예: 반도체)" aria-label="섹터 검색" autocomplete="off" role="combobox" aria-controls="secL" aria-expanded="true">' +
    '<div class="sl" id="secL" role="listbox" aria-label="섹터"></div>';
  pop.hidden = false;
  secFill(true);
  const r = btn.getBoundingClientRect(), w = Math.min(340, innerWidth - 32);
  Object.assign(pop.style, {width: w + 'px', top: (r.bottom + scrollY + 4) + 'px', left: (Math.max(16, Math.min(r.left, innerWidth - w - 16)) + scrollX) + 'px'});
  btn.setAttribute('aria-expanded', 'true');
  $('secQ').focus();
}
function secClose(refocus) {
  if (!SP) return;
  const {list, place} = SP, b = document.querySelector(`[data-secdd="${list}"][data-place="${place}"]`);
  SP = null; $('secPop').hidden = true;
  if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
}
function secPick(i) {
  const {list, place} = SP, v = SP.opts[i].v;
  secClose(false);
  F[list].sec = v; relist(list);
  document.querySelector(`[data-secdd="${list}"][data-place="${place}"]`)?.focus();
}
function relist(list, el) {
  // 다시 그리면 선택 상자와 버튼이 새로 생기므로 같은 자리(머리 또는 휴대폰 상자)의 것에 초점을 돌려준다
  const q = el && (el.dataset.sort ? `[data-sort="${el.dataset.sort}"][data-list="${list}"]` : `select[data-f="${el.dataset.f}"][data-list="${list}"]`);
  const inHead = !!el?.closest('.hd'), had = el && document.activeElement === el;
  if (list === 'all') { allLimit = PAGE; renderAll(); } else renderToday();
  if (had) [...document.querySelectorAll(q)].find(x => !!x.closest('.hd') === inHead)?.focus();
}

function spark(r) {
  const S_ = SPARK && SPARK[r.id];
  if (!S_ || S_.length < 2) return '';
  const W = 110, H = 30, vals = S_.filter(v => v != null), lo0 = Math.min(...vals), hi0 = Math.max(...vals);
  const lo = Math.min(lo0, r.piv ?? lo0, r.stop ?? lo0), hi = Math.max(hi0, r.piv ?? hi0);
  const y = v => 2 + (hi - v) / ((hi - lo) || 1) * (H - 4), x = i => i * (W / (S_.length - 1));
  const red = (r.toStop != null && r.toStop < 0) || r.tp === false;
  const pl = r.piv != null ? `<line x1="0" x2="${W}" y1="${y(r.piv)}" y2="${y(r.piv)}" stroke="${cv('--up')}" stroke-dasharray="3 3"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${pl}<polyline fill="none" stroke="${cv(red ? '--dn' : '--tx2')}" stroke-width="1.4" points="${S_.map((v, i) => v == null ? '' : x(i) + ',' + y(v)).join(' ')}"/></svg>`;
}

function renderEvents() {
  const ev = (S.events || []).filter(e => BY[e.id] && watched(BY[e.id]));
  const TG = {bad: ['t-bad', '주의'], soon: ['t-wat', '예정'], chg: ['t-weak', '변화']};
  $('watchEvents').innerHTML = ev.map(e => `<div class="ev"><span class="mut">${e.date.slice(5)}</span><span><b>${esc(BY[e.id].tk)}</b> ${esc(BY[e.id].nm || '')} · ${esc(e.text)}</span><span class="tag ${TG[e.tag][0]}">${TG[e.tag][1]}</span></div>`).join('')
    || '<div class="empty">아직 알림 기록이 없습니다.</div>';
}

function renderWatch() {
  queueMicrotask(navBar);  // 별을 끄면 관심 종목 목록에서 빠진다
  renderEvents();
  const L = $('watchList'), rows = watchRows();
  L.style.cssText = '--cols:2fr 1.4fr .9fr .9fr .9fr 120px 1.6fr 32px';
  $('n-watch').textContent = rows.length;
  // 설명 (2026-10-12): 정렬은 단계로 늘 보이고, 용어 풀이는 '읽는 법'에 접어 둔다. 점 색은 판정색 원칙(녹색 살 자리, 빨강 손절, 주황 주의)
  const wn = $('watchNote'), open = wn.querySelector('details')?.open;  // 별을 눌러 다시 그려도 펼친 상태 유지
  const steps = [['ok', '돌파, 피벗 5% 이내'], ['bad', '손절가 이탈'], ['warn', `손절가 ${(S.watch.stopNear * 100).toFixed(0)}% 이내, 템플릿 탈락`], ['tx2', '나머지']];
  wn.innerHTML = `<div class="steps" aria-label="정렬 순서"><span class="k">정렬</span>` +
    steps.map(([c, t], i) => `${i ? '<span class="arr" aria-hidden="true">→</span>' : ''}<span class="step"><span class="n">${i + 1}</span><i style="background:var(--${c})"></i>${t}</span>`).join('') +
    `</div><details${open ? ' open' : ''}><summary><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>읽는 법</summary>` +
    `<dl class="defs"><dt>상태 옆 숫자</dt><dd>그 상태가 된 지 며칠째. 배치 기록이 쌓인 만큼만 세고, <code>+</code>는 기록 이전부터</dd>` +
    `<dt>추가 후</dt><dd>추가한 날 마감 종가 대비 등락</dd>` +
    `<dt>별</dt><dd>${EDIT ? '별을 끄면 목록에서 빠집니다' : (S.params.bot ? '별을 누르면 텔레그램이 열리고, 시작을 누르면 반영됩니다' : '공개 페이지에서는 바꿀 수 없습니다')}</dd></dl></details>`;
  if (!rows.length) { L.innerHTML = '<div class="empty">관심 종목이 없습니다. 종목 상세나 오늘 탭에서 ☆을 눌러 추가하세요.</div>'; return; }
  L.innerHTML = headRow([['종목'], ['상태'], ['피벗 대비', 1], ['손절까지', 1], ['추가 후', 1], ['60일'], ['마지막 변화 / 실적'], ['']]) +
    rows.map(r => {
      const ac = addedClose(r), since = ac && r.cl ? r.cl / ac - 1 : null;
      const ts = r.toStop, tsTxt = ts == null ? '—' : ts < 0 ? '이탈 ' + pct(ts) : pct(ts);
      const days = r.days == null ? '' : ` <span class="mut">${r.days}일째${r.daysOpen ? '+' : ''}</span>`;
      const drop = r.tp === false ? ` <span class="bad">템플릿 ${r.ts}/8</span>` : '';
      const earn = r.mk === 'KR' ? '' : `<br><span class="${r.earnSoon ? 'warn' : 'mut'}" style="${r.earnSoon ? 'font-weight:600' : ''}">실적 ${r.earn ? r.earn.slice(5) + (r.earnDays != null && r.earnDays >= 0 ? ` (${r.earnDays}일 후)` : '') : '—'}</span>`;
      const extra = r.flags && r.flags.includes('OUT_OF_UNIVERSE') ? '<span class="mut">유니버스 밖 (가격 없음)</span>' : '';
      return `<div class="rw ${r.id === cur ? 'sel' : ''}" data-k="${esc(r.id)}">
  <span class="c" style="--o:1;--fb:calc(100% - 46px)">${nameH(r)}</span>
  <span class="c" style="--o:3;--fb:100%;white-space:normal">${tagH(r)}${days}${drop}</span>
  <span class="c r" style="--o:5"><span class="k">피벗 대비</span>${pct(r.dist)}</span>
  <span class="c r ${r.near || (ts != null && ts < 0) ? 'bad' : ''}" style="--o:5"><span class="k">손절까지</span>${tsTxt}</span>
  <span class="c r" style="--o:5"><span class="k">추가 후</span>${pct(since)}</span>
  <span class="c mob-hide">${spark(r)}</span>
  <span class="c" style="--o:6;--fb:100%;font-size:12px;white-space:normal">${esc(r.last || '변화 기록 없음')}${earn}${extra}</span>
  <span class="c" style="--o:2">${starBtn(r)}</span></div>`;
    }).join('');
}

// 전체 후보: 템플릿 조건 중 RS를 뺀 7개 통과 + RS 최소. 손절 폭은 피벗이 있는 종목에만
function candidates(f) {
  return R.filter(r => r.t17 && r.rs != null && r.rs >= f.rs && (r.risk == null || r.risk * 100 <= f.rk + 1e-9)
    && (!f.mk || r.mk === f.mk) && (!f.st || r.st === f.st) && (!f.sec || r.sec === f.sec) && (!f.gr || (GRADE_ORDER[r.g] || 0) >= GRADE_ORDER[f.gr]));
}
const filt = () => ({rs: +$('fRs').value, rk: +$('fRk').value, mk: $('fMk').value, st: F.all.st, sec: F.all.sec, gr: $('fGr').value});

function renderAll() {
  queueMicrotask(navBar);  // 필터, 정렬이 바뀌면 이동 줄의 위치도 다시 (빈 목록으로 일찍 끝나는 경우 포함)
  const f = filt(), P = S.params.filters;
  $('fRsO').textContent = f.rs; $('fRkO').textContent = f.rk + '%';
  const rows = candidates(f).sort(sorter(F.all));
  const def = candidates({...f, rs: P.rsMin.default, rk: P.riskMax.default}).length;
  $('cnt').textContent = rows.length + '건';
  $('cntDef').textContent = `(RS, 손절 폭 기본값이면 ${def}건)`;
  $('n-all').textContent = candidates({rs: P.rsMin.default, rk: P.riskMax.default}).length;
  const stRows = candidates({...f, st: ''});
  $('allList').style.cssText = STD_COLS;
  $('allHead').innerHTML = listHead('all', stRows);
  $('fSt').innerHTML = stOpts(stRows, f.st); $('fSecW').innerHTML = secBtn('all', 'mob'); $('fSort').innerHTML = sortOpts(F.all);
  const L = $('allRows');
  $('allHead').hidden = !candidates({...f, st: '', sec: ''}).length;  // 상태, 섹터로 0건이어도 머리는 남겨 되돌릴 수 있게
  if (!rows.length) { L.innerHTML = '<div class="empty">조건에 맞는 후보가 없습니다.</div>'; return; }
  L.innerHTML = rows.slice(0, allLimit).map(r => stdRow(r, tagH(r))).join('') +
    (rows.length > allLimit ? `<div class="rw more" data-more="1">${rows.length - allLimit}건 더 보기</div>` : '');
}

function cycleSort(list, k) {
  const f = F[list], first = SORTS[k].first;
  [f.k, f.dir] = f.k !== k ? [k, first] : f.dir === first ? [k, -first] : ['', 0];
}

function exportCsv() {
  const rows = allRows();
  const cols = [['market', r => r.mk], ['ticker', r => r.tk], ['name', r => r.nm], ['state', r => r.st], ['pivot', r => r.piv],
    ['close', r => r.cl], ['vs_pivot', r => r.dist], ['risk', r => r.risk], ['risk_basis', r => r.rb], ['stop', r => r.stop],
    ['rs', r => r.rs], ['grade', r => r.grade], ['rank', r => r.rank], ['sector', r => r.sec], ['sector_detail', r => r.secd]];
  const q = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const text = '﻿' + [cols.map(c => c[0]).join(','), ...rows.map(r => cols.map(c => q(c[1](r))).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv'}));
  a.download = `candidates_${Object.values(S.markets).map(m => m.asof).sort().pop()}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderMkt() {
  const rows = Object.entries(S.markets).map(([m, x]) => {
    const p = x.panel || {}, fu = x.funnel || {};
    const idx = (p.indices || []).map(i => i.error ? `${IDX[i.symbol] || i.symbol} 없음` :
      `${IDX[i.symbol] || i.symbol} ${[50, 200].map(n => i['above' + n] == null ? '' : i['above' + n] ? `${n}일선 위` : `<span class="warn">${n}일선 아래</span>`).filter(Boolean).join(', ')}`).join('<br>') || '—';
    const br = fu.universe ? (fu.template_pass / fu.universe * 100).toFixed(1) + '%' : '—';
    const hl = p.highs ? `${p.highs.new_high ?? '—'} / ${p.highs.new_low ?? '—'}` : '—';
    const flow = fu.universe ? `${fu.universe.toLocaleString()} → ${fu.template_pass} → ${fu.vcp_valid} → ${fu.within_buy_zone_of_pivot}` : '—';
    return `<div class="rw" style="cursor:default"><span class="c" style="--o:1;--fb:calc(100% - 46px)">${MK[m]}</span>
      <span class="c" style="--o:3;--fb:100%;white-space:normal">${idx}</span><span class="c r" style="--o:5"><span class="k">템플릿</span>${br}</span>
      <span class="c r" style="--o:5"><span class="k">신고/신저</span>${hl}</span><span class="c mut" style="--o:6;--fb:100%">${flow}</span>
      <span class="c r" style="--o:5"><span class="k">수집</span>${x.coverage != null ? (x.coverage * 100).toFixed(1) + '%' : '—'}</span></div>`;
  }).join('');
  $('mkt').innerHTML = headRow([[''], ['지수'], ['템플릿 통과', 1], ['52주 신고 / 신저', 1], ['종목 수 흐름'], ['수집률', 1]]) + rows;
}

// 시장별 52주 신고가, 신저가 일별 흐름 (2026-10-11). 숨은 탭에서 그리면 폭이 0이라 시장 탭이 보일 때만 그린다
// 확대 (2026-10-11): 가로로 끌어 구간 확대, 세로축은 보이는 구간에 맞춤. 손가락 기기는 스크롤과 겹쳐 카드에서는 끄고 확대 창에서만
let brMonths = 0, brDirty = true, brBigMk = null;
const FINE = matchMedia('(hover:hover) and (pointer:fine)').matches;
const brSeries = m => S.markets[m]?.panel?.highs_series;
function brStart(s) {
  const end = s.date[s.date.length - 1];
  if (!brMonths) return s.date[0];
  const d = new Date(end); d.setMonth(d.getMonth() - brMonths);
  const st = d.toISOString().slice(0, 10);
  return st > s.date[0] ? st : s.date[0];
}
function brFitY(gd, s) {
  const r = gd._fullLayout.xaxis.range.map(v => String(v).slice(0, 10));
  let mx = 1;
  s.date.forEach((d, i) => { if (d >= r[0] && d <= r[1]) mx = Math.max(mx, s.new_high[i], s.new_low[i]); });
  Plotly.relayout(gd, {'yaxis.range': [0, mx * 1.08]});
}
function brPlot(el, s, zoom) {
  fitWatch(el);
  const line = (y, name, c) => ({x: s.date, y, name, type: 'scatter', mode: 'lines', line: {color: c, width: 1.5},
    hovertemplate: `${name} %{y:,}<extra></extra>`});
  return Plotly.react(el, [line(s.new_high, '신고가', cv('--up')), line(s.new_low, '신저가', cv('--dn'))], {
    margin: {l: 40, r: 8, t: 8, b: 28}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: {color: cv('--tx2'), size: 11, family: cv('--sans')}, hovermode: 'x unified', showlegend: true,
    legend: {orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: {size: 11}}, dragmode: zoom ? 'zoom' : false,
    xaxis: {type: 'date', range: [brStart(s), s.date[s.date.length - 1]], gridcolor: cv('--grid'), tickformat: '%y/%m', fixedrange: !zoom},
    yaxis: {range: [0, 1], gridcolor: cv('--grid'), rangemode: 'tozero', fixedrange: true, tickformat: ','},
  }, {displayModeBar: false, responsive: true, doubleClick: false}).then(gd => {
    brFitY(gd, s);
    if (!gd._brFit) {  // 가로 범위가 바뀐 이벤트에서만 (세로축 변경 이벤트로 다시 부르지 않게)
      gd._brFit = true;
      gd.on('plotly_relayout', e => { if ('xaxis.range[0]' in e || 'xaxis.range' in e || 'xaxis.autorange' in e) brFitY(gd, gd._brS); });
      // 두 번 누르면 지금 고른 기간으로 (plotly 기본 reset은 처음 그린 범위로 돌아가 기간 버튼과 어긋난다)
      gd.on('plotly_doubleclick', () => { const s = gd._brS; Plotly.relayout(gd, {'xaxis.range': [brStart(s), s.date[s.date.length - 1]]}); });
    }
    gd._brS = s;
  });
}
function renderBreadth() {
  if (tab !== 'market') { brDirty = true; return; }
  brDirty = false;
  const ms = Object.keys(S.markets).filter(m => brSeries(m)?.date?.length);
  if (!ms.length) { $('br').innerHTML = '<div class="card mut">아직 데이터가 없습니다. 다음 배치부터 표시됩니다.</div>'; return; }
  const zoomIc = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
  $('br').innerHTML = ms.map(m => {
    const x = S.markets[m], h = x.panel.highs || {}, n = v => v == null ? '—' : v.toLocaleString();
    return `<div class="card"><div class="brhd"><b>${MK[m]}</b><span style="display:inline-flex;align-items:center;gap:10px">
      <span class="mut" style="font-size:12px">기준 ${esc(x.asof || '')}</span>
      <button class="zoom" data-brzoom="${m}" aria-label="${MK[m]} 신고가, 신저가 그래프 크게 보기">${zoomIc}</button></span></div>
      <div class="brst"><div><div class="l">신고가</div><div class="v" style="color:var(--ok)">${n(h.new_high)}</div></div>
      <div><div class="l">신저가</div><div class="v" style="color:var(--bad)">${n(h.new_low)}</div></div>
      <div><div class="l">집계 대상</div><div class="v">${n(h.eligible)}</div></div></div>
      <div class="brch" id="brch${m}" role="img" aria-label="${MK[m]} 52주 신고가와 신저가 종목 수 일별 그래프"></div>
      <div class="brhint">가로로 끌어 확대, 두 번 눌러 원래대로</div></div>`;
  }).join('');
  for (const m of ms) brPlot($('brch' + m), brSeries(m), FINE);
  if ($('brdlg').open && brBigMk) brPlot($('brBig'), brSeries(brBigMk), true);
}
function openBrBig(m) {
  brBigMk = m;
  $('brdTitle').textContent = `${MK[m]} 52주 신고가와 신저가`;
  $('brBig').setAttribute('aria-label', `${MK[m]} 52주 신고가와 신저가 종목 수 일별 그래프, 크게 보기`);
  $('brdlg').showModal();  // 연 다음에 그려야 폭이 잡힌다
  brPlot($('brBig'), brSeries(m), true);
}
function setBrMonths(v) {
  brMonths = v;
  for (const g of ['brRng', 'brdRng']) $(g).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', +x.dataset.m === v));
  renderBreadth();
}

// 분기 실적 카드 (2026-10-11 목업 v2). 단위: US 매출 억/만 달러, KR 매출 조/억 원, EPS 달러/원
const sgn = v => v < 0 ? '−' : '';
function money(v, mk) {
  const a = Math.abs(v);
  if (mk === 'KR') return a >= 1e12 ? [sgn(v) + (a / 1e12).toFixed(1), '조 원'] : [sgn(v) + Math.round(a / 1e8).toLocaleString(), '억 원'];
  return a >= 1e8 ? [sgn(v) + (a / 1e8).toFixed(1), '억 달러'] : [sgn(v) + Math.round(a / 1e4).toLocaleString(), '만 달러'];
}
const QK = {
  rev: {t: '매출', f: money},
  eps: {t: 'EPS', f: (v, mk) => mk === 'KR' ? [sgn(v) + Math.round(Math.abs(v)).toLocaleString(), '원'] : [sgn(v) + Math.abs(v).toFixed(2), '달러']},
  margin: {t: '순이익률', f: v => [sgn(v) + Math.abs(v).toFixed(1) + '%', ''], line: true},
};
const qfmt = (k, v, mk) => v == null ? ['—', ''] : QK[k].f(v, mk);
function qyoy(k, a, i) {
  // 전년 동기 대비. 전년이 적자면 흑전/적자 (§8.2), 순이익률은 %p 차이
  const p = i >= 4 ? a[i - 4] : null, v = a[i];
  if (p == null || v == null) return null;
  if (QK[k].line) { const d = v - p; return {t: (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%p', up: d >= 0}; }
  if (p > 0 && v >= 0) return {t: (v >= p ? '+' : '−') + Math.abs(Math.round((v - p) / p * 100)) + '%', up: v >= p};
  return {t: v > 0 ? '흑전' : '적자', up: v > 0};
}
const ARW = up => `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${up ? 'M12 4l9 14H3z' : 'M12 20L3 6h18z'}"/></svg>`;
const ZOOM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
function qhead(k, q, mk) {
  const a = q[k], n = a.length, [v, u] = qfmt(k, a[n - 1], mk), y = qyoy(k, a, n - 1);
  const pill = y ? `<span class="pill ${y.up ? 'up' : 'dn'}">${ARW(y.up)}${y.t.replace(/^[+−]/, '')}</span>` : '';
  return `<span class="qv">${v}${u ? `<span class="unit">${u}</span>` : ''}</span>${pill}`;
}
function qchart(k, q, mk, big, width) {
  // 확대 창은 실제 폭으로 그린다 (viewBox를 줄여 그리면 휴대폰에서 글자가 5px대로 작아진다)
  const nums = q[k].filter(v => v != null);
  if (!nums.length) return '<div class="mut">—</div>';
  const a = q[k], n = a.length, W = big ? Math.max(300, Math.round(width || 700)) : 300, H = big ? 260 : 140, top = big ? 26 : 22;
  const mx = Math.max(...nums, 0), mn = Math.min(...nums, 0), rr = mx - mn || 1, fs = big ? 12 : 11;
  const bot = (big ? 24 : 20) + (mn < 0 ? 14 : 0), pad = big ? 10 : 20, bw = (W - pad * 2) / n;  // 적자 막대 아래 글자 자리
  const y = v => top + (mx - v) / rr * (H - top - bot), lab = v => qfmt(k, v, mk).join('');
  let s = `<line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}" stroke="${cv('--line')}"/>`;
  a.forEach((v, i) => {
    const cx = pad + i * bw + bw / 2, recent = i >= n - 4, yy = qyoy(k, a, i);
    if (big || i === 0 || i === n - 1) s += `<text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="${fs}" fill="${cv('--tx2')}">${q.labels[i]}</text>`;
    if (v == null) return;
    if (QK[k].line) {
      if (i && a[i - 1] != null) s += `<line x1="${cx - bw}" y1="${y(a[i - 1])}" x2="${cx}" y2="${y(v)}" stroke="${cv('--warn')}" stroke-width="2"/>`;
      s += `<circle cx="${cx}" cy="${y(v)}" r="${big ? 3.5 : 2.5}" fill="${cv(v < 0 ? '--dn' : '--warn')}"/>`;
      if (big || i === n - 1 || v < 0) s += `<text class="halo" x="${cx}" y="${v < 0 ? y(v) + 15 : y(v) - 8}" text-anchor="middle" font-size="${fs}" fill="${cv('--tx')}"${i === n - 1 ? ' font-weight="600"' : ''}>${lab(v)}</text>`;
    } else {
      s += `<rect x="${cx - bw * .32}" y="${Math.min(y(v), y(0))}" width="${bw * .64}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="2" fill="${cv(v < 0 ? '--dn' : recent ? '--s50' : '--bar')}"/>`;
      const t = big ? qfmt(k, v, mk)[0] : (recent && yy ? yy.t : '');
      if (t) s += `<text class="halo" x="${cx}" y="${v < 0 ? y(v) + 14 : y(v) - 5}" text-anchor="middle" font-size="${fs}" fill="${cv('--tx')}">${t}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${QK[k].t} ${n}분기 차트">${s}</svg>`;
}
function qcards(q, mk) {
  $('qtag').textContent = q.labels[q.labels.length - 1];
  $('fq').innerHTML = Object.keys(QK).map(k => `<article class="q"><div class="qh"><div class="qt">${QK[k].t}</div>
    <button class="zoom" data-k="${k}" aria-label="${QK[k].t} 크게 보기" title="크게 보기">${ZOOM}</button></div>
    <div class="qrow">${qhead(k, q, mk)}</div>${qchart(k, q, mk, false)}</article>`).join('');
  $('fq').querySelectorAll('.zoom').forEach(b => b.onclick = () => qopen(b.dataset.k, q, mk));
}
function qopen(k, q, mk) {
  const a = q[k], u = qfmt(k, a.find(v => v != null), mk)[1];
  $('qdTitle').textContent = QK[k].t + (u ? ` (${u})` : '');
  $('qdHead').innerHTML = qhead(k, q, mk) + ` <span class="qt">${q.labels[a.length - 1]}</span>`;
  $('qdlg').showModal();
  $('qdChart').innerHTML = qchart(k, q, mk, true, $('qdChart').clientWidth);
  const row = (name, f) => `<tr><th>${name}</th>${a.map((v, i) => `<td>${f(v, i)}</td>`).join('')}</tr>`;
  $('qdTable').innerHTML = `<thead><tr><th></th>${q.labels.map(l => `<th>${l}</th>`).join('')}</tr></thead><tbody>`
    + row(QK[k].t, v => `<span class="${v != null && v < 0 ? 'dn' : ''}">${qfmt(k, v, mk)[0]}</span>`)
    + row('전년 대비', (v, i) => { const y = qyoy(k, a, i); return y ? `<span class="${y.up ? 'up' : 'dn'}">${y.t}</span>` : '—'; }) + '</tbody>';
}

function setupMemo(d) {
  // 셋업 요약 3줄: 수축, 거래량, 주의 (2026-10-11). 87%처럼 비율만 쓰면 많은지 적은지 바로 안 읽혀서 말로 푼다
  const v = d.vcp || {}, dep = v.depths || [], li = [];
  if (v.valid) {
    const shr = dep.length > 1 && dep.every((x, i) => !i || x < dep[i - 1]);
    li.push(['수축', `<b>VCP ${dep.length}회</b>, 깊이 ${dep.map(x => '−' + Math.round(x * 100) + '%').join(' → ')}${shr ? ' <span class="mut">(얕아지는 중)</span>' : ''}`]);
  } else if (v.reason) li.push(['수축', `VCP 아님: ${esc(REASON[v.reason] || v.reason)}`]);
  if (v.vdu != null) {
    const p = Math.round((v.vdu - 1) * 100);
    li.push(['거래량', `최근 5일 평균이 50일 평균${p ? `보다 <b>${Math.abs(p)}% ${p < 0 ? '적음' : '많음'}</b>` : '과 <b>같음</b>'} <span class="mut">(${Math.round(v.vdu * 100)}%)</span>`]);
  }
  const warn = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>';
  (d.flagsKo || []).forEach(f => li.push([warn + '주의', esc(f), true]));
  $('dmemo').innerHTML = li.map(([k, t, w]) => `<li${w ? ' class="w"' : ''}><span class="mk">${k}</span><span>${t}</span></li>`).join('');
}

function themed(fig) {
  // 빌드는 밝은 색으로 그린다. 다크 모드면 글자, 격자, 라벨 배경만 CSS 변수로 바꾼다
  const L = JSON.parse(JSON.stringify(fig.layout)), tx = cv('--tx'), tx2 = cv('--tx2'), grid = cv('--grid'), card = cv('--card');
  L.font = {...L.font, color: tx, family: cv('--sans')};  // 웹 글꼴 (2026-10-11). 알림 PNG는 시스템 글꼴 그대로
  for (const k of ['xaxis', 'xaxis2', 'yaxis', 'yaxis2']) if (L[k]) { L[k].gridcolor = grid; L[k].tickfont = {...(L[k].tickfont || {}), color: tx2}; }
  // 돌파일 띠와 라벨 (2026-10-11): 다크에서는 밝은 주황
  (L.shapes || []).forEach(s => { if (s.name === 'brk') s.fillcolor = cv('--brkband'); });
  (L.annotations || []).forEach(a => { if (a.name === 'brk') { a.bgcolor = cv('--brk'); a.font = {...a.font, color: cv('--brkink')}; } else if (a.name === 'halo') { a.bgcolor = card; a.font = {...a.font, color: tx}; } else if (!a.bgcolor) a.font = {...a.font, color: tx2}; });
  L.autosize = true; delete L.width;
  for (const k of ['xaxis', 'xaxis2']) if (L[k]) L[k].tickangle = 0;
  return L;
}

// 차트 기간 버튼 (2026-10-12). 범위와 눈금은 빌드(charts.py _views)가 버튼마다 만들어 둔 값을 적용만 한다.
// 고른 기간은 종목을 바꿔도 유지. 이력이 짧아 그 보기가 없으면 가장 긴 보기를 쓴다
let chView = null;
const vLabel = v => { const m = Math.round(v / 21); return m < 12 ? `${m}M` : `${Math.round(m / 12)}Y`; };
function viewKey(meta) {
  if (chView == null) chView = innerWidth < 640 ? S.params.chart.viewMobile : S.params.chart.view;
  const ks = Object.keys(meta.views).map(Number);
  return meta.views[chView] ? chView : ks[ks.length - 1];
}
function viewAttrs(w) {
  let mt = w.mt, ml = w.ml;
  if (innerWidth < 640 && mt.length > 7) {  // 좁은 화면은 월 라벨을 하나 걸러 (오른쪽 끝 기준)
    const keep = (_, i) => (mt.length - 1 - i) % 2 === 0;
    mt = mt.filter(keep); ml = ml.filter(keep);
  }
  return {'xaxis.range': w.x, 'xaxis2.range': w.x, 'xaxis.tickvals': mt, 'xaxis.ticktext': ml, 'xaxis2.tickvals': mt,
    'xaxis2.ticktext': ml, 'yaxis.range': w.y, 'yaxis.tickmode': 'array', 'yaxis.tickvals': w.tv, 'yaxis.ticktext': w.tt,
    'yaxis2.range': w.vol};
}
function setAttrs(L, a) { for (const [k, v] of Object.entries(a)) { const [ax, p] = k.split('.'); L[ax] = {...L[ax], [p]: v}; } return L; }
function zoomFit(gd) {
  // 끌어서 확대한 구간: 가격과 거래량 범위만 다시 잡고 가격 눈금은 자동 (태그 피하기는 버튼 보기에만)
  const m = gd.layout.meta, c = gd.data[0], vol = gd.data.find(t => t.name === '거래량'), [a, b] = gd.layout.xaxis.range;
  let lo = Math.min(...m.tags), hi = Math.max(...m.tags), vm = 0;
  for (let i = Math.max(0, Math.ceil(a)); i <= Math.min(c.x.length - 1, Math.floor(b)); i++) {
    if (c.low[i] != null) lo = Math.min(lo, c.low[i]);
    if (c.high[i] != null) hi = Math.max(hi, c.high[i]);
    vm = Math.max(vm, vol?.y[i] || 0);
  }
  if (!isFinite(lo) || !isFinite(hi)) return;
  const p = (hi - lo) * 0.04;
  Plotly.relayout(gd, {'yaxis.range': [lo - p, hi + p], 'yaxis.tickmode': 'auto', 'yaxis.tickvals': null, 'yaxis.ticktext': null,
    'yaxis2.range': [0, vm * 1.05], 'xaxis.tickvals': m.mt, 'xaxis.ticktext': m.ml, 'xaxis2.tickvals': m.mt, 'xaxis2.ticktext': m.ml});
}
function renderRng(meta) {
  const bar = $('chBar'); bar.hidden = !meta?.views;
  if (bar.hidden) return;
  const on = viewKey(meta);
  $('chRng').innerHTML = S.params.chart.views.map(v => `<button type="button" data-v="${v}" aria-pressed="${v === on}"${meta.views[v] ? '' : ' disabled title="상장 기간이 짧아 없음"'}>${vLabel(v)}</button>`).join('');
  $('chHint').textContent = FINE ? '가로로 끌면 확대, 두 번 누르면 고른 기간으로' : '';
}

async function loadDetail(id) {
  if (!DET[id]) {
    const r = BY[id];
    const res = await fetch(V(`data/t/${r.mk}_${encodeURIComponent(r.tk)}.json`));
    if (!res.ok) throw new Error(res.status);
    DET[id] = await res.json();
  }
  return DET[id];
}

async function draw(id, scroll) {
  const r = BY[id]; if (!r) return;
  cur = id;
  // 상태 뱃지는 이름 바로 뒤 (2026-10-11). 오른쪽 끝에 두면 넓은 화면에서 이름과 멀어져 안 보인다
  $('dhead').innerHTML = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${starBtn(r)}<span class="mut">${r.mk}</span> <b class="tk big">${esc(r.tk)}</b> <span class="mut">${esc(r.nm || '')}</span> ${tagH(r).replace('class="tag ', 'class="tag big ')}</div>`;
  $('dm').innerHTML = stripH(r);
  const lad = ladderH(r);
  $('dlad').innerHTML = lad; $('dlad').hidden = !lad; $('dm').classList.toggle('joined', !!lad);
  ladFit(); fitWatch($('dlad'));
  $('swStop').style.borderTopColor = S.candle === 'kr' ? cv('--s200') : cv('--dn');
  renderLists(); navBar();
  if (scroll) $('detail').scrollIntoView({block: 'start'});  // 목록이 길면 상세가 수만 px 아래라 바로 이동
  const ch = $('ch');
  if (!r.detail) {
    $('chBar').hidden = true;
    Plotly.purge(ch); ch.innerHTML = '<div class="empty">상세 차트는 템플릿 7/8 이상, 기저가 있는 종목, 관심 종목만 만듭니다. 다음 배치 이후 나옵니다.</div>';
    $('dmemo').innerHTML = ''; $('tcard').hidden = $('qcard').hidden = true;
    return;
  }
  let d;
  try { d = await loadDetail(id); } catch (e) { $('chBar').hidden = true; Plotly.purge(ch); ch.innerHTML = '<div class="empty">상세 데이터를 불러오지 못했습니다.</div>'; return; }
  if (cur !== id) return;
  // innerHTML만 비우면 plotly 내부 상태(_fullLayout)가 남아 react가 '수정'으로 보고 아무것도 그리지 않는다.
  // 두 번째 종목부터 차트가 비던 원인 (M4부터, 2026-10-11 관측). purge로 상태까지 지운다
  Plotly.purge(ch); ch.innerHTML = '';
  ch.style.height = d.fig.layout.height + 'px';  // 높이를 먼저 잡아야 plotly가 전체 높이로 그린다
  // 평균선은 글자색 점선. 빌드는 밝은 화면 기준이라 다크 모드면 여기서 바꾼다
  // 빌드는 밝은 화면 기준 색. 평소 막대와 급증 막대, 평균선을 테마 색으로 바꾼다 (2026-10-11 B안)
  const cc = S.chartColors || {}, vbar = cv('--vbar'), spike = cv('--spike'), brk = cv('--brk');
  const data = d.fig.data.map(t => t.name === '50일 평균 거래량' ? {...t, line: {...t.line, color: cv('--tx2')}}
    : t.type === 'bar' && Array.isArray(t.marker?.color) ? {...t, marker: {...t.marker, color: t.marker.color.map(c => c === cc.bar ? vbar : c === cc.spike ? spike : c === cc.brk ? brk : c)}}
    : t.name === '돌파일' ? {...t, marker: {...t.marker, color: cv('--card'), line: {...t.marker.line, color: brk}}} : t);
  const meta = d.fig.layout.meta, L = themed(d.fig);
  if (meta?.views) {
    setAttrs(L, viewAttrs(meta.views[viewKey(meta)]));
    if (FINE) { L.dragmode = 'zoom'; L.xaxis.fixedrange = L.xaxis2.fixedrange = false; }  // 휴대폰은 버튼만 (스크롤과 겹치지 않게)
  }
  renderRng(meta);
  await Plotly.react(ch, data, L, {displayModeBar: false, responsive: true, scrollZoom: false, doubleClick: false});
  if (meta?.views) {  // purge가 이벤트도 지우므로 그릴 때마다 단다
    ch.on('plotly_relayout', e => { if (('xaxis.range[0]' in e || 'xaxis2.range[0]' in e) && !('yaxis.range' in e)) zoomFit(ch); });
    ch.on('plotly_doubleclick', () => { Plotly.relayout(ch, viewAttrs(meta.views[viewKey(meta)])); return false; });
  }
  fitWatch(ch);
  setupMemo(d);
  const t = d.tpl, all = t.n_pass === t.n;
  $('tcard').hidden = $('qcard').hidden = false;
  $('tsum').innerHTML = `<span><b>트렌드 템플릿</b> <b style="color:var(${all ? '--ok' : '--bad'})">${t.n_pass} / ${t.n} 통과</b> <span class="mut">${esc(t.text)}</span></span>`;
  $('tcount').textContent = `조건 ${t.conds.length}개`;
  $('tc').innerHTML = t.conds.map(c => `<div class="${c.k === t.near ? 'near' : ''}"><span>${c.pass === true ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">✗</span>'} ${esc(c.label)}${c.enabled ? '' : ' (꺼짐)'}</span><span>${c.val ?? '—'}${c.k === t.near ? ' · 가장 가까움' : ''}</span></div>`).join('');
  const q = d.q;
  $('fchips').innerHTML = (d.chips || []).map(c => `<span class="chip${/주의/.test(c) ? ' w' : ''}">${esc(c)}</span>`).join('');
  $('qtag').hidden = $('fq').hidden = !q;
  if (q) qcards(q, d.mk || r.mk); else $('fq').innerHTML = '';
  $('fqt').textContent = q ? '' : `분기 실적 없음: ${d.fund || '재무 없음'}`;
}

function renderLists() { renderToday(); renderWatch(); renderAll(); }

// 상세 이동 줄 (2026-10-11): 기준은 '지금 탭'이 아니라 '이 종목을 연 목록'(SRC).
// 오늘 탭이 0건이라 전체 후보 1위를 띄웠을 때 지금 탭 기준이면 버튼이 모두 꺼졌다 (관측).
// draw()는 별, 테마 변경에도 다시 불리므로 SRC는 openFrom()에서만 정한다. 순서는 누를 때마다 다시 계산 (필터, 정렬 반영)
let SRC = '';
const SRC_NAME = {today: '오늘', watch: '관심 종목', all: '전체 후보'};
const SRC_BACK = {today: '오늘 목록으로', watch: '관심 종목으로', all: '전체 후보로'};
const listIds = t => (t === 'today' ? todayRows() : t === 'watch' ? watchRows() : t === 'all' ? allRows() : []).map(r => r.id);
function openFrom(id, src, scroll) { SRC = src || ''; return draw(id, scroll); }
function navBar() {
  $('dnav').hidden = !SRC;
  if (!SRC) return;
  const ids = listIds(SRC), i = ids.indexOf(cur), on = i >= 0, n = ids.length;
  $('navBackT').textContent = SRC_BACK[SRC];
  $('navPos').innerHTML = on
    ? `${SRC_NAME[SRC]} · <b>${i + 1}</b> / ${n}${i === 0 ? ' · 첫 종목' : ''}${i === n - 1 && n > 1 ? ' · 마지막 종목' : ''}`
    : `${SRC_NAME[SRC]} 목록에 없음 (필터나 관심 종목이 바뀜)`;
  $('navPrev').closest('.seg').hidden = !on;
  for (const [b, j, w] of [[$('navPrev'), i - 1, '이전'], [$('navNext'), i + 1, '다음']]) {
    const t = on && ids[j] ? BY[ids[j]].tk : null;
    b.disabled = !t;
    b.setAttribute('aria-label', t ? `${w} 종목: ${t}` : `${w} 종목 없음`);
    b.title = t ? `${w}: ${t}` : '';
  }
}
function step(d) {
  const ids = listIds(SRC), i = ids.indexOf(cur);
  if (i < 0 || !ids[i + d]) return;
  draw(ids[i + d], true);
}
function backToList() {
  if (!SRC) return;
  if (tab !== SRC) setTab(SRC);
  const i = listIds(SRC).indexOf(cur);
  if (SRC === 'all' && i >= allLimit) { allLimit = (Math.floor(i / PAGE) + 1) * PAGE; renderAll(); }
  const row = i >= 0 && document.querySelector(`[data-panel="${SRC}"] .rw[data-k="${CSS.escape(cur)}"]`);
  (row || document.querySelector(`[data-panel="${SRC}"]`)).scrollIntoView({block: row ? 'center' : 'start'});
}

function setTab(t) {
  tab = t;
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t);
  if (S) navBar();
  $('detail').hidden = t === 'market';
  if (S && t === 'market' && brDirty) renderBreadth();
  if (location.hash.slice(1) !== t) history.replaceState(null, '', '#' + t);
}

// 텔레그램 캡션 링크 (#t=시장:종목): 그 종목 상세를 연다 (M5)
function openTicker(raw) {
  const id = decodeURIComponent(raw), r = BY[id];
  if (!r) { toast('목록에 없는 종목입니다'); return; }
  setTab(watched(r) ? 'watch' : r.chg === true ? 'today' : 'all');
  history.replaceState(null, '', '#' + tab);
  openFrom(id, tab, false).then(() => $('detail').scrollIntoView());
}

async function toggleStar(id) {
  const r = BY[id], on = id in ITEMS;
  const res = await fetch('api/watchlist', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({op: on ? 'remove' : 'add', market: r.mk, ticker: r.tk})});
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) { toast(j.error || '저장하지 못했습니다'); return; }
  setItems(j.items);
  if (!on) toast('추가했습니다. 상태 일수와 실적일은 다음 배치부터 채워집니다.');
  draw(cur);
}
function setItems(items) { ITEMS = {}; for (const i of items) ITEMS[`${i.market}:${i.ticker}`] = i; }

document.addEventListener('click', e => {
  const path = e.composedPath();
  if (SP && !path.some(n => n.id === 'secPop' || n.dataset?.secdd)) secClose(false);
  const sd = e.target.closest('[data-secdd]');
  if (sd) { const same = SP && SP.list === sd.dataset.secdd && SP.place === sd.dataset.place; secClose(false); if (!same) secOpen(sd); return; }
  const so_ = e.target.closest('#secPop .opt'); if (so_) { secPick(+so_.dataset.i); return; }
  if (e.target.closest('#secPop')) return;
  const tg = e.target.closest('[data-tgstar]');
  if (tg) {  // 링크는 그대로 열리게 두고, 요청을 기억해 별을 바로 바꾼다
    e.stopPropagation();
    const r = BY[tg.dataset.tgstar], op = watched(r) ? 'u' : 'w';
    if ((op === 'w') === !!r.w) delete PEND[r.id]; else PEND[r.id] = {op, at: Date.now()};
    savePend(); renderLists(); if (cur) draw(cur);
    toast(`텔레그램에서 시작을 누르면 ${op === 'w' ? '추가' : '해제'}됩니다. 이 기기에는 바로 표시해 둡니다.`);
    return;
  }
  const s = e.target.closest('[data-star]');
  if (s) { e.stopPropagation(); if (EDIT) toggleStar(s.dataset.star); return; }
  const g = e.target.closest('[data-go]'); if (g) { setTab(g.dataset.go); return; }
  if (e.target.closest('[data-more]')) { allLimit += PAGE; renderAll(); return; }
  const ch = e.target.closest('#todayChips [data-st]');
  if (ch) { F.today.st = ch.dataset.st; renderToday(); $('todayChips').querySelector(`[data-st="${ch.dataset.st}"]`)?.focus(); return; }
  if (e.target.closest('#todayList [data-fold]')) { F.today.open = !F.today.open; renderToday(); $('todayList').querySelector('[data-fold]')?.focus(); return; }
  const mb = e.target.closest('#todayMk [data-mk]');
  if (mb) { F.today.mk = mb.dataset.mk; renderToday(); $('todayMk').querySelector(`[data-mk="${mb.dataset.mk}"]`)?.focus(); return; }
  const so = e.target.closest('[data-sort]'); if (so) { cycleSort(so.dataset.list, so.dataset.sort); relist(so.dataset.list, so); return; }
  const r = e.target.closest('.rw[data-k]'); if (r) { openFrom(r.dataset.k, r.closest('[data-panel]')?.dataset.panel, true); return; }
  const t = e.target.closest('[role=tab]'); if (t) setTab(t.dataset.tab);
});

async function init() {
  S = await (await fetch(V('data/summary.json'))).json();
  loadPend();
  R = S.rows; BY = Object.fromEntries(R.map(r => [r.id, r]));
  // plotly는 그릴 때의 글꼴로 글자 폭을 잰다. 웹 글꼴이 도착한 뒤 첫 차트를 그린다 (최대 1.5초 대기)
  await Promise.race([document.fonts?.load('14px "Plex KR"'), new Promise(r => setTimeout(r, 1500))]).catch(() => {});
  if (['127.0.0.1', 'localhost'].includes(location.hostname)) try {  // 공개 페이지는 API가 없으니 묻지 않는다
    const res = await fetch('api/watchlist');
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) { setItems((await res.json()).items); EDIT = true; }
  } catch (e) { /* 공개 페이지: API 없음 */ }
  const mk = Object.entries(S.markets).map(([m, x]) => {
    const d = new Date(x.asof + 'T00:00:00');
    return `${MK[m]} ${d.getMonth() + 1}월 ${d.getDate()}일`;
  });
  $('asof').textContent = mk.join(' / ') + ' 장 마감 기준' + (EDIT ? ' · 로컬 (별 편집 가능)' : '');
  dqBanner();
  $('built').textContent = `빌드 ${S.builtAt.slice(0, 16).replace('T', ' ')} UTC`;
  const P = S.params.filters;
  for (const [id, p] of [['fRs', P.rsMin], ['fRk', P.riskMax]]) {
    Object.assign($(id), {min: p.min, max: p.max, value: p.default});
    $(id + 'T').textContent = p.tag;
  }
  // 섹터, 상태, 정렬 선택 상자 (머리와 휴대폰 상자 모두 data-f, data-list로)
  addEventListener('resize', () => secClose(false));
  $('secPop').addEventListener('input', e => { if (e.target.id === 'secQ') { SP.q = e.target.value.trim(); SP.act = 0; secFill(); } });
  $('secPop').addEventListener('keydown', e => {
    if (!SP) return;
    const n = SP.opts.length;
    if (e.key === 'ArrowDown') { SP.act = (SP.act + 1) % n; secFill(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { SP.act = (SP.act - 1 + n) % n; secFill(); e.preventDefault(); }
    else if (e.key === 'Enter') { secPick(SP.act); e.preventDefault(); }
    else if (e.key === 'Escape') { secClose(true); e.preventDefault(); }
    else if (e.key === 'Tab') secClose(false);
  });
  document.addEventListener('input', e => {
    const el = e.target.closest('select[data-f]'); if (!el) return;
    const f = F[el.dataset.list];
    if (el.dataset.f === 'sort') { const [k, d] = el.value.split(':'); [f.k, f.dir] = k ? [k, +d] : ['', 0]; } else f[el.dataset.f] = el.value;
    relist(el.dataset.list, el);
  });
  $('navBack').onclick = backToList; $('navPrev').onclick = () => step(-1); $('navNext').onclick = () => step(1);
  addEventListener('keydown', e => {
    // 입력칸, 슬라이더(RS가 ←/→를 씀), 드롭다운, 확대 창에서는 가로채지 않는다
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || $('qdlg').open || tab === 'market') return;
    if (e.target.closest && e.target.closest('input,select,textarea,[contenteditable]')) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  });
  $('params').innerHTML = S.params.batch.map(p => `<span class="mut">${esc(p.label)}</span><span>${esc(p.value)}</span><span class="src">${esc(p.tag)}</span>`).join('');
  ['fRs', 'fRk', 'fMk', 'fGr'].forEach(i => $(i).addEventListener('input', () => { allLimit = PAGE; renderAll(); }));
  $('csv').addEventListener('click', exportCsv);
  $('reset').addEventListener('click', () => { $('fRs').value = P.rsMin.default; $('fRk').value = P.riskMax.default;
    ['fMk', 'fGr'].forEach(i => $(i).value = ''); F.all = F0(); renderAll(); });
  $('volMult').textContent = S.volMult ?? 1.4;
  $('qdClose').onclick = () => $('qdlg').close();
  $('qdlg').addEventListener('click', e => { if (e.target === $('qdlg')) $('qdlg').close(); });
  renderMkt();
  const h0 = location.hash.slice(1);
  setTab(['today', 'watch', 'all', 'market'].includes(h0) ? h0 : 'today');
  fetch(V('data/spark.json')).then(x => x.json()).then(j => { SPARK = j; renderWatch(); }).catch(() => {});
  // 처음 띄울 종목: 오늘 → 관심 → 전체 후보 순으로 처음 찾은 목록의 1위. 그 목록이 이동 기준
  const src = ['today', 'watch', 'all'].find(t => listIds(t).length), first = src ? BY[listIds(src)[0]] : R[0];
  if (h0.startsWith('t=') && BY[decodeURIComponent(h0.slice(2))]) openTicker(h0.slice(2));
  else if (first) openFrom(first.id, src, false); else renderLists();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (cur) draw(cur); renderBreadth(); });
  for (const g of ['brRng', 'brdRng']) $(g).addEventListener('click', e => { const b = e.target.closest('button'); if (b) setBrMonths(+b.dataset.m); });
  $('brdRng').querySelector('[data-m="0"]').setAttribute('aria-pressed', 'true');
  $('chRng').addEventListener('click', e => {
    const b = e.target.closest('button:not(:disabled)'), ch = $('ch'), meta = ch.layout?.meta;
    if (!b || !meta?.views) return;
    chView = +b.dataset.v;
    $('chRng').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    Plotly.relayout(ch, viewAttrs(meta.views[chView]));
  });
  $('br').addEventListener('click', e => { const b = e.target.closest('[data-brzoom]'); if (b) openBrBig(b.dataset.brzoom); });
  $('brdClose').onclick = () => $('brdlg').close();
  $('brdlg').addEventListener('click', e => { if (e.target === $('brdlg')) $('brdlg').close(); });
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h.startsWith('t=')) openTicker(h.slice(2)); else if (h !== tab && ['today', 'watch', 'all', 'market'].includes(h)) setTab(h); });
}
init().catch(e => { document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="card bad">데이터를 불러오지 못했습니다: ${esc(e.message)}</div>`); });
