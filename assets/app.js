/* ============================================================================
 *  부동산판 · 공장·창고 매물 아카이브 — app.js
 *  매물 검색 · 필터 · 정렬 · 상세 모달
 * ========================================================================== */
(function () {
  'use strict';

  /* ── 구글 시트 연동 (선택) ─────────────────────────────────────────────
     시트를 [파일 → 공유 → 웹에 게시 → CSV] 로 내보낸 주소를 아래에 넣으면
     시트 내용이 data/listings.js 보다 우선 적용됩니다. (실패 시 로컬 데이터)
     열 이름 규칙은 data/listings.js 상단 주석을 참고하세요.            */
  var SHEET_CSV_URL = '';

  var CRITERIA = window.WAREHOUSE_CRITERIA || [];
  var LISTINGS = (window.WAREHOUSE_LISTINGS || []).slice();

  var els = {
    q: document.getElementById('q'),
    qClear: document.getElementById('qClear'),
    searchBox: document.getElementById('searchBox'),
    chips: document.getElementById('chips'),
    critGrid: document.getElementById('critGrid'),
    grid: document.getElementById('grid'),
    cnt: document.getElementById('cnt'),
    activeTags: document.getElementById('activeTags'),
    reset: document.getElementById('reset'),
    sort: document.getElementById('sort'),
    heroCount: document.getElementById('heroCount'),
    hdr: document.getElementById('hdr'),
    modal: document.getElementById('modal'),
    mBody: document.getElementById('mBody'),
    mRank: document.getElementById('mRank'),
    mCrumb: document.getElementById('mCrumb'),
    mPrev: document.getElementById('mPrev'),
    mNext: document.getElementById('mNext'),
    mClose: document.getElementById('mClose'),
    toast: document.getElementById('toast')
  };

  var state = { q: '', filters: [], sort: 'rank' };
  var view = [];           // 현재 화면에 보이는 매물 (정렬 순서)
  var modalIndex = -1;
  var lastFocus = null;

  /* ── 필터 정의 ─────────────────────────────────────────────────────── */
  var FILTERS = [
    { id: 'r:남양주', label: '남양주', kind: 'region', test: function (l) { return l.district === '남양주'; } },
    { id: 'r:양주',   label: '양주',   kind: 'region', test: function (l) { return l.district === '양주'; } },
    { id: 'r:의정부', label: '의정부', kind: 'region', test: function (l) { return l.district === '의정부'; } },
    { id: 'f:dock',   label: '도크 완비', kind: 'feature', test: function (l) { return /완비/.test(l.dock || ''); } },
    { id: 'f:h9',     label: '층고 9m 이상', kind: 'feature', test: function (l) { return l.height >= 9; } },
    { id: 'f:ft40',   label: '40ft 진출입', kind: 'feature', test: function (l) { return /40\s*(ft|피트)/i.test((l.vehicle || '') + ' ' + (l.subtitle || '') + ' ' + (l.tags || '')); } },
    { id: 'f:rent',   label: '월세 2,500만 이하', kind: 'feature', test: function (l) { return l.rent > 0 && l.rent <= 25000000; } }
  ];
  var FILTER_MAP = {};
  FILTERS.forEach(function (f) { FILTER_MAP[f.id] = f; });

  /* ── 포맷 ──────────────────────────────────────────────────────────── */
  function won(n) {
    if (!n) return { num: '—', unit: '' };
    var eok = Math.floor(n / 100000000);
    var man = Math.round((n % 100000000) / 10000);
    if (eok && !man) return { num: String(eok), unit: '억' };
    if (!eok) return { num: man.toLocaleString('ko-KR'), unit: '만' };
    return { num: eok + '억 ' + man.toLocaleString('ko-KR'), unit: '만' };
  }
  function priceHTML(n) {
    var p = won(n);
    return '<b class="num">' + p.num + '</b><span>' + p.unit + '</span>';
  }
  function heightText(l) {
    return l.height ? l.height + 'm' : '미기재';
  }
  function scoreOf(l) {
    var ok = 0, no = 0, check = 0;
    (l.conditions || []).forEach(function (c) {
      if (c.status === 'ok') ok++;
      else if (c.status === 'no') no++;
      else check++;
    });
    return { ok: ok, no: no, check: check };
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── 검색 ──────────────────────────────────────────────────────────── */
  function hay(l) {
    return [l.region, l.district, l.title, l.subtitle, l.address, l.note, l.tags, l.source,
            l.use, l.brokerName, l.areaNote, l.siteNote, l.heightNote, l.vehicle, l.dock].join(' ').toLowerCase();
  }
  function near(a, b) { return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(40, a * 0.16); }
  function nearRent(rent, v) { return rent > 0 && v > 0 && Math.abs(rent / 10000 - v) <= v * 0.06; }

  var DISTRICTS = ['남양주', '양주', '의정부'];

  function tokenMatcher(raw) {
    var t = raw.trim().toLowerCase();
    if (!t) return null;
    var m;
    /* 지역명은 부분일치로 하면 '양주'가 '남양주'까지 잡히므로 시/군 단위를 정확히 비교 */
    var bare = t.replace(/(특별시|광역시|시|군|구|읍|면|동)$/, '');
    if (DISTRICTS.indexOf(bare) > -1) {
      return function (l) { return l.district === bare; };
    }
    if ((m = t.match(/^(\d+)\s*(?:m|미터|메터)$/))) {
      var hv = +m[1];
      return function (l) { return l.height >= hv; };
    }
    if ((m = t.match(/^(\d[\d,]{1,5})\s*평$/))) {
      var pv = +m[1].replace(/,/g, '');
      return function (l) { return near(l.area, pv) || near(l.site, pv); };
    }
    if ((m = t.match(/^(\d[\d,]{2,5})\s*만(?:원)?$/))) {
      var mv = +m[1].replace(/,/g, '');
      return function (l) { return l.rent > 0 && l.rent <= mv * 10000; };
    }
    if ((m = t.match(/^(\d[\d,]{2,5})$/))) {
      var nv = +m[1].replace(/,/g, '');
      return function (l) {
        return near(l.area, nv) || near(l.site, nv) || nearRent(l.rent, nv) || nearRent(l.deposit / 10000, nv) || hay(l).indexOf(t) > -1;
      };
    }
    return function (l) { return hay(l).indexOf(t) > -1; };
  }
  function queryMatchers(q) {
    return q.split(/[\s,]+/).filter(Boolean).map(tokenMatcher).filter(Boolean);
  }

  /* 같은 분류(지역 / 조건) 안에서는 OR, 분류끼리는 AND */
  function apply(query, filterIds, skipId, skipKind) {
    var ms = queryMatchers(query || '');
    var groups = {};
    FILTERS.forEach(function (f) {
      if (f.id === skipId || f.kind === skipKind) return;
      if (filterIds.indexOf(f.id) < 0) return;
      (groups[f.kind] = groups[f.kind] || []).push(f);
    });
    var kinds = Object.keys(groups);
    return LISTINGS.filter(function (l) {
      for (var k = 0; k < kinds.length; k++) {
        var g = groups[kinds[k]], hit = false;
        for (var i = 0; i < g.length; i++) if (g[i].test(l)) { hit = true; break; }
        if (!hit) return false;
      }
      for (var j = 0; j < ms.length; j++) if (!ms[j](l)) return false;
      return true;
    });
  }

  function sortList(arr) {
    var s = state.sort;
    var out = arr.slice();
    if (s === 'rent') out.sort(function (a, b) { return a.rent - b.rent; });
    else if (s === 'deposit') out.sort(function (a, b) { return a.deposit - b.deposit; });
    else if (s === 'height') out.sort(function (a, b) { return b.height - a.height || a.rank - b.rank; });
    else if (s === 'area') out.sort(function (a, b) { return b.area - a.area; });
    else out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  var ICO = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h3l1.6 4-2.2 1.5a12.5 12.5 0 0 0 6.1 6.1l1.5-2.2 4 1.6v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10.2" r="2.3"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6.5 18.5 12 13 17.5"/></svg>'
  };

  function rankLabel(l) { return l.isRef ? '참고' : l.rank + '순위'; }

  function cardHTML(l) {
    var s = scoreOf(l);
    var media = l.photo
      ? '<img src="' + esc(l.photo) + '" alt="' + esc(l.region + ' ' + l.title + ' 매물 사진') + '" loading="lazy" decoding="async">'
      : '<span class="card-ph"><img src="assets/placeholder.svg" alt="" aria-hidden="true"><span class="ph-tag">PHOTO · 사진 미제공</span></span>';
    var track = (l.conditions || []).map(function (c) {
      return '<i class="' + (c.status === 'ok' ? 'ok' : c.status === 'check' ? 'check' : '') + '"></i>';
    }).join('');
    var specs = [
      ['창고면적', l.area ? l.area.toLocaleString('ko-KR') + '평' : '미기재', !l.area],
      ['대지·마당', l.site ? l.site.toLocaleString('ko-KR') + '평' : '미확인', !l.site],
      ['층고', heightText(l), !l.height],
      ['도크', l.dock || '미기재', !l.dock || l.dock === '미기재'],
      ['차량진입', l.vehicle || '미기재', !l.vehicle || l.vehicle === '미기재'],
      ['건물폭', l.width || '미기재', !l.width || l.width === '미기재']
    ].map(function (x) {
      return '<div class="spec"><dt>' + x[0] + '</dt><dd class="' + (x[2] ? 'na' : '') + '" title="' + esc(String(x[1])) + '">' + esc(String(x[1])) + '</dd></div>';
    }).join('');

    return '' +
      '<article class="card" data-id="' + l.id + '">' +
        '<button class="card-hit" type="button" data-open="' + l.id + '" aria-label="' + esc(l.region + ' ' + l.title + ' 상세 보기') + '"></button>' +
        '<div class="card-media">' +
          media +
          '<span class="pill pill-rank">' + rankLabel(l) + '</span>' +
          '<span class="pill pill-score" title="8개 조건 중 충족 ' + s.ok + ' · 확인 필요 ' + s.check + ' · 미충족 ' + s.no + '">조건 <span class="ok num">' + s.ok + '</span>/8</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<p class="card-region">' + esc(l.region) + '</p>' +
          '<h3 class="card-title">' + esc(l.title) + '</h3>' +
          '<p class="card-sub">' + esc(l.subtitle) + '</p>' +
          '<div class="price">' +
            '<div class="p-cell"><p class="p-lab">보증금</p><p class="p-val">' + priceHTML(l.deposit) + '</p></div>' +
            '<div class="p-cell"><p class="p-lab">월세</p><p class="p-val">' + priceHTML(l.rent) + '</p>' +
              (l.maint ? '<p class="p-vat">관리비 ' + won(l.maint).num + won(l.maint).unit + '</p>' : (l.vat ? '<p class="p-vat">' + esc(l.vat) + '</p>' : '')) +
            '</div>' +
          '</div>' +
          '<dl class="specs">' + specs + '</dl>' +
          '<div class="track" role="img" aria-label="조건 8개 중 충족 ' + s.ok + ', 확인 필요 ' + s.check + ', 미충족 ' + s.no + '">' + track + '</div>' +
          '<p class="card-note">' + esc(l.note) + '</p>' +
          '<div class="card-foot">' +
            '<span class="broker">' + esc(l.brokerName) + '</span>' +
            '<span class="more">상세 보기' + ICO.arrow + '</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function ctaHTML() {
    return '' +
      '<a class="cta-card" href="#contact" aria-label="매물 의뢰 및 등록 문의">' +
        '<div>' +
          '<p class="cta-kicker">MATCHING</p>' +
          '<h3>찾는 조건의<br>매물이 없으신가요?</h3>' +
          '<p>지역·평수·층고·도크·예산을 알려 주시면 맞는 매물이 나오는 대로 이 아카이브에 올립니다.</p>' +
          '<ul class="cta-list"><li>조건 그대로 접수</li><li>맞는 매물만 골라 수록</li><li>등록 매물은 조건 대조표와 함께</li></ul>' +
        '</div>' +
        '<span class="btn btn-md">매물 의뢰 · 등록 문의 ' + ICO.arrow + '</span>' +
      '</a>';
  }

  function emptyHTML() {
    var onlyUijeongbu = state.filters.length === 1 && state.filters[0] === 'r:의정부';
    return '' +
      '<div class="empty">' +
        '<div class="ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.6-4.6"/></svg></div>' +
        '<h3>조건에 맞는 매물이 없습니다</h3>' +
        '<p>' + (onlyUijeongbu
          ? '의정부는 현재 1,000평급 공개 임대 매물이 확인되지 않았습니다. 대신 양주·남양주 근접 후보를 보시겠어요?'
          : '검색어나 필터를 줄여 보세요. 조건에 가까운 매물은 조건 대조표와 함께 계속 올리고 있습니다.') + '</p>' +
        '<button class="btn btn-line btn-md" type="button" id="emptyReset">전체 매물 보기</button>' +
      '</div>';
  }

  function renderChips() {
    var html = '<button class="chip" type="button" data-chip="all" aria-pressed="' + (state.filters.length === 0 ? 'true' : 'false') + '">전체 <span class="n num">' + apply(state.q, []).length + '</span></button>';
    html += FILTERS.map(function (f) {
      var on = state.filters.indexOf(f.id) > -1;
      var n = apply(state.q, state.filters, f.id, f.kind).filter(f.test).length;
      return '<button class="chip" type="button" data-chip="' + f.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        f.label + ' <span class="n num">' + n + '</span></button>';
    }).join('');
    els.chips.innerHTML = html;
  }

  function renderCriteria() {
    els.critGrid.innerHTML = CRITERIA.map(function (c, i) {
      return '<div class="crit-item"><span class="n num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<div><p class="t">' + esc(c.label) + '</p><p class="d">' + esc(c.need) + '</p></div></div>';
    }).join('');
  }

  function update() {
    var focusChip = document.activeElement && document.activeElement.getAttribute
      ? document.activeElement.getAttribute('data-chip') : null;

    var matched = apply(state.q, state.filters);
    view = sortList(matched);

    renderChips();
    if (focusChip) {
      var nb = els.chips.querySelector('[data-chip="' + focusChip + '"]');
      if (nb) nb.focus();
    }

    els.grid.innerHTML = view.length
      ? view.map(cardHTML).join('') + ctaHTML()
      : emptyHTML();

    els.cnt.innerHTML = (state.filters.length || state.q ? '조건 적용 ' : '전체 ') +
      '<b class="num">' + view.length + '</b>건';
    els.heroCount.textContent = view.length;

    els.activeTags.innerHTML = state.filters.map(function (id) {
      return '<span class="tag">' + esc(FILTER_MAP[id].label) +
        '<button type="button" data-unset="' + id + '" aria-label="' + esc(FILTER_MAP[id].label) + ' 필터 해제">×</button></span>';
    }).join('') + (state.q ? '<span class="tag">“' + esc(state.q) + '”<button type="button" data-unset="q" aria-label="검색어 해제">×</button></span>' : '');

    els.reset.hidden = !(state.filters.length || state.q);
    els.searchBox.classList.toggle('has-value', !!state.q);

    var er = document.getElementById('emptyReset');
    if (er) er.addEventListener('click', resetAll);
  }

  function resetAll() {
    state.filters = [];
    state.q = '';
    els.q.value = '';
    update();
  }

  /* ── 모달 ──────────────────────────────────────────────────────────── */
  function specRows(l) {
    var rows = [
      ['창고면적', (l.area ? l.area.toLocaleString('ko-KR') + '평' : '미기재'), l.areaNote],
      ['대지·마당', (l.site ? l.site.toLocaleString('ko-KR') + '평' : '미확인'), l.siteNote],
      ['층고', heightText(l), l.heightNote && l.height ? l.heightNote : ''],
      ['도크', l.dock || '미기재', ''],
      ['차량 진입', l.vehicle || '미기재', ''],
      ['건물폭', l.width || '미기재', ''],
      ['진입로 경사', l.slope || '미기재', ''],
      ['준공·입주', l.built || '미기재', ''],
      ['용도', l.use || '미기재', ''],
      ['출처', l.source || '미기재', '']
    ];
    return rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) +
        (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</dd></div>';
    }).join('');
  }

  function modalHTML(l) {
    var s = scoreOf(l);
    var media = l.photo
      ? '<img src="' + esc(l.photo) + '" alt="' + esc(l.region + ' ' + l.title) + ' 매물 사진">'
      : '<span class="card-ph"><img src="assets/placeholder.svg" alt=""><span class="ph-tag">PHOTO · 사진 미제공</span></span>';

    var conds = (l.conditions || []).map(function (c, i) {
      var cr = CRITERIA[i] || {};
      var cls = c.status === 'ok' ? 'ok' : c.status === 'check' ? 'check' : 'no';
      var txt = c.status === 'ok' ? '충족' : c.status === 'check' ? '확인필요' : '미충족';
      return '<div class="cond"><p class="nm">' + esc(cr.label || '') + '<small>' + esc(cr.need || '') + '</small></p>' +
        '<span class="badge ' + cls + '">' + txt + '</span>' +
        '<p class="nt">' + esc(c.note) + '</p></div>';
    }).join('');

    var telMain = l.brokerMobile || l.brokerTel || '';
    var broker = '<div class="m-broker"><p class="lab">중개사 연락처</p>' +
      '<p class="nm">' + esc(l.brokerName) + (l.brokerPerson ? ' · ' + esc(l.brokerPerson) : '') + '</p>' +
      (l.brokerTel ? '<p class="tel">사무실 ' + esc(l.brokerTel) + '</p>' : '') +
      (l.brokerMobile ? '<p class="tel">휴대폰 ' + esc(l.brokerMobile) + '</p>' : '') +
      (telMain
        ? '<div class="btns">' +
            '<a class="btn btn-navy" href="tel:' + esc(telMain.replace(/[^0-9+]/g, '')) + '">' + ICO.phone + '전화</a>' +
            '<button class="btn btn-line" type="button" data-copy="' + esc(telMain) + '">' + ICO.copy + '번호 복사</button>' +
          '</div>'
        : '<p class="none">연락처가 공개되지 않은 매물입니다. 아래 원문 매물에서 문의해 주세요.</p>') +
      '</div>';

    var photoCredit = l.photoNote ? '<p class="m-photonote">' + esc(l.photoNote) + '</p>' : '';

    return '' +
      '<h2 class="m-title" id="mTitle">' + esc(l.title) + '</h2>' +
      '<p class="m-sub">' + esc(l.subtitle) + '</p>' +
      '<p class="m-addr">' + ICO.pin + esc(l.address) + '</p>' +

      '<div class="m-grid">' +
        '<div class="m-left">' +
          '<div class="m-photo">' + media + '</div>' + photoCredit +
          '<div class="m-price">' +
            '<div class="row"><span class="lab">보증금</span><span class="val">' + priceHTML(l.deposit) + '</span></div>' +
            '<div class="row"><span class="lab">월세</span><span class="val">' + priceHTML(l.rent) + '</span></div>' +
            (l.maint ? '<div class="row"><span class="lab">관리비</span><span class="val">' + priceHTML(l.maint) + '</span></div>' : '') +
            (l.maint && l.vat === 'VAT 별도' ? '<p class="vat">관리비 VAT 별도</p>' : (l.vat ? '<p class="vat">' + esc(l.vat) + '</p>' : '')) +
          '</div>' +
          broker +
          '<div class="m-link"><a href="' + esc(l.link) + '" target="_blank" rel="noopener noreferrer">' +
            '<span>원문 매물 보기<span class="u">' + esc(l.link) + '</span></span>' + ICO.out + '</a></div>' +
        '</div>' +

        '<div class="m-right">' +
          '<div class="blk">' +
            '<div class="blk-head"><h4>매물 정보</h4></div>' +
            '<div class="blk-body"><dl class="m-spec">' + specRows(l) + '</dl></div>' +
          '</div>' +
          '<div class="blk">' +
            '<div class="blk-head"><h4>고객 조건 8개 대비</h4>' +
              '<span class="sum"><b>' + s.ok + '</b> 충족 · ' + s.check + ' 확인 · ' + s.no + ' 미충족</span></div>' +
            '<div class="blk-body">' + conds + '</div>' +
          '</div>' +
          '<div class="blk">' +
            '<div class="blk-head"><h4>현장 확인 체크리스트</h4><span class="sum">방문 시 확인</span></div>' +
            '<div class="blk-body" style="padding:0"><ul class="checklist">' +
              (l.checklist || []).map(function (c, i) {
                return '<li><input type="checkbox" id="ck' + l.id + '_' + i + '"><label for="ck' + l.id + '_' + i + '"><span>' + esc(c) + '</span></label></li>';
              }).join('') +
            '</ul></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function openModal(id) {
    var idx = view.findIndex(function (l) { return String(l.id) === String(id); });
    if (idx < 0) return;
    modalIndex = idx;
    var l = view[idx];

    lastFocus = document.activeElement;
    els.mRank.textContent = rankLabel(l);
    els.mCrumb.innerHTML = '<b>' + esc(l.region) + '</b> · 조건 ' + scoreOf(l).ok + '/8 충족';
    els.mBody.innerHTML = modalHTML(l);
    els.mBody.scrollTop = 0;
    els.mNext.disabled = idx >= view.length - 1;
    els.mPrev.disabled = idx <= 0;

    els.modal.hidden = false;
    document.body.classList.add('is-locked');
    requestAnimationFrame(function () { els.modal.classList.add('is-open'); });
    var panel = els.modal.querySelector('.modal-panel');
    if (panel) panel.focus({ preventScroll: true });
    try { history.replaceState(null, '', '#l-' + l.id); } catch (e) {}
  }

  function closeModal() {
    els.modal.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    var done = function () {
      els.modal.hidden = true;
      els.mBody.innerHTML = '';
    };
    setTimeout(done, 180);
    modalIndex = -1;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function step(dir) {
    var n = modalIndex + dir;
    if (n < 0 || n >= view.length) return;
    openModal(view[n].id);
  }

  /* ── 토스트 / 복사 ─────────────────────────────────────────────────── */
  var toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2200);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(fallback);
    }
    return Promise.resolve(fallback());
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  /* ── 이벤트 ────────────────────────────────────────────────────────── */
  function setPlaceholder() {
    var short = window.matchMedia('(max-width: 720px)').matches;
    els.q.placeholder = short
      ? '지역 · 평수 · 키워드 검색'
      : '지역 · 평수 · 키워드로 검색 (예: 남양주 800평, 도크, 40ft)';
  }
  setPlaceholder();
  var rzT;
  window.addEventListener('resize', function () {
    clearTimeout(rzT);
    rzT = setTimeout(setPlaceholder, 200);
  });

  var qTimer;
  els.q.addEventListener('input', function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      state.q = els.q.value.trim();
      update();
    }, 90);
  });
  els.qClear.addEventListener('click', function () {
    els.q.value = '';
    state.q = '';
    update();
    els.q.focus();
  });

  els.chips.addEventListener('click', function (e) {
    var b = e.target.closest('[data-chip]');
    if (!b) return;
    var id = b.getAttribute('data-chip');
    if (id === 'all') {
      state.filters = [];
    } else {
      var i = state.filters.indexOf(id);
      if (i > -1) state.filters.splice(i, 1);
      else state.filters.push(id);
    }
    update();
  });

  els.activeTags.addEventListener('click', function (e) {
    var b = e.target.closest('[data-unset]');
    if (!b) return;
    var id = b.getAttribute('data-unset');
    if (id === 'q') { state.q = ''; els.q.value = ''; }
    else {
      var i = state.filters.indexOf(id);
      if (i > -1) state.filters.splice(i, 1);
    }
    update();
  });

  els.reset.addEventListener('click', function () {
    state.filters = []; state.q = ''; els.q.value = ''; update();
  });

  els.sort.addEventListener('change', function () {
    state.sort = els.sort.value;
    update();
  });

  document.addEventListener('click', function (e) {
    var op = e.target.closest('[data-open]');
    if (op) { openModal(op.getAttribute('data-open')); return; }
    var cp = e.target.closest('[data-copy]');
    if (cp) {
      copyText(cp.getAttribute('data-copy')).then(function (ok) {
        toast(ok ? '중개사 번호를 복사했습니다' : '복사가 막혀 있습니다. 번호를 길게 눌러 복사해 주세요');
      });
      return;
    }
    if (e.target.closest('[data-close]')) closeModal();
  });

  els.mClose.addEventListener('click', closeModal);
  els.mNext.addEventListener('click', function () { step(1); });
  els.mPrev.addEventListener('click', function () { step(-1); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !els.modal.hidden) { closeModal(); return; }
    if (!els.modal.hidden) {
      if (e.key === 'ArrowRight') { step(1); }
      if (e.key === 'ArrowLeft') { step(-1); }
      if (e.key === 'Tab') {
        var f = els.modal.querySelectorAll('button, a, input, select, textarea');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (e.key === '/' && document.activeElement !== els.q) {
      e.preventDefault();
      els.q.focus();
    }
  });

  var onScroll = function () {
    els.hdr.classList.toggle('is-stuck', window.scrollY > 6);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── 구글 시트 CSV (선택) ──────────────────────────────────────────── */
  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function fromSheet(csv) {
    var rows = parseCSV(csv).filter(function (r) { return r.some(function (c) { return c.trim(); }); });
    if (rows.length < 2) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    var idx = {};
    head.forEach(function (h, i) { idx[h] = i; });
    var num = function (v) { return Number(String(v || '').replace(/[^0-9.-]/g, '')) || 0; };

    return rows.slice(1).map(function (r, n) {
      var get = function (k) { return (r[idx[k]] || '').trim(); };
      var conds = CRITERIA.map(function (c, i) {
        var v = (r[idx['conditions_' + (i + 1)]] || '').trim().toLowerCase();
        return { status: (v === 'ok' || v === 'no') ? v : 'check', note: (r[idx['condition_note_' + (i + 1)]] || '').trim() };
      });
      return {
        id: num(get('id')) || n + 1,
        rank: num(get('rank')) || n + 1,
        isRef: /참고|ref/i.test(get('rank')),
        district: get('district'),
        region: get('region'),
        title: get('title'),
        subtitle: get('subtitle'),
        address: get('address'),
        photo: get('photo'),
        photoNote: get('photo_note'),
        deposit: num(get('deposit')),
        rent: num(get('rent')),
        maint: num(get('maint')),
        vat: get('vat'),
        area: num(get('area')),
        areaNote: get('area_note'),
        site: num(get('site')),
        siteNote: get('site_note'),
        height: num(get('height')),
        heightNote: get('height_note'),
        dock: get('dock'),
        vehicle: get('vehicle'),
        width: get('width'),
        slope: get('slope'),
        built: get('built'),
        use: get('use'),
        brokerName: get('broker_name'),
        brokerTel: get('broker_tel'),
        brokerMobile: get('broker_mobile'),
        brokerPerson: get('broker_person'),
        link: get('link'),
        source: get('source'),
        note: get('note'),
        tags: get('tags'),
        conditions: conds,
        checklist: get('checklist').split('|').map(function (s) { return s.trim(); }).filter(Boolean)
      };
    }).filter(function (l) { return l.title; });
  }

  function boot() {
    renderCriteria();
    update();

    if (SHEET_CSV_URL) {
      fetch(SHEET_CSV_URL, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (csv) {
          var rows = fromSheet(csv);
          if (rows.length) { LISTINGS = rows; update(); }
        })
        .catch(function (err) { console.warn('[매물 시트] 불러오기 실패, 로컬 데이터로 표시합니다:', err.message); });
    }

    var h = (location.hash || '').match(/^#l-(\d+)$/);
    if (h) {
      var found = view.find(function (l) { return String(l.id) === h[1]; });
      if (found) openModal(found.id);
    }

    /* 같은 탭에서 매물 링크(#l-3)로 이동했을 때도 해당 매물을 열어 줍니다 */
    window.addEventListener('hashchange', function () {
      var mm = (location.hash || '').match(/^#l-(\d+)$/);
      if (!mm) return;
      var f2 = LISTINGS.filter(function (l) { return String(l.id) === mm[1]; })[0];
      if (f2 && els.modal.hidden) openModal(f2.id);
    });
  }

  boot();
})();
