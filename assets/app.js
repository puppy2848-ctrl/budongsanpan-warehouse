/* ============================================================================
 *  부동산판 · 공장·창고 매물 아카이브 — app.js  (v4 · 인천 109 + 경기북부 5)
 *  매물 검색 · 지역/거래 필터 · 정렬 · 지도 · 상세 모달
 * ========================================================================== */
(function () {
  'use strict';

  /* ── 구글 시트 연동 (선택) ─────────────────────────────────────────────
     시트를 [파일 → 공유 → 웹에 게시 → CSV] 로 내보낸 주소를 아래에 넣으면
     시트 내용이 data/listings.js 보다 우선 적용됩니다. (실패 시 로컬 데이터)
     열 이름 규칙은 data/listings.js 상단 주석을 참고하세요.            */
  var SHEET_CSV_URL = '';

  /* 공동중개 매물 접수·의뢰 구글폼 주소 — 폼이 만들어지면 이 한 줄만 채우면 됩니다. */
  var FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScZuBbn-GkpoPEGhMv3PogJwaap8nl3wJVCXCW37432xJGLrg/viewform';

  var CRITERIA = window.WAREHOUSE_CRITERIA || [];
  var LISTINGS = (window.WAREHOUSE_LISTINGS || []).slice();

  var els = {
    q: document.getElementById('q'),
    qClear: document.getElementById('qClear'),
    bigChips: document.getElementById('bigChips'),
    moreChips: document.getElementById('moreChips'),
    moreToggle: document.getElementById('moreToggle'),
    searchForm: document.getElementById('searchForm'),
    qGo: document.getElementById('qGo'),
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
  /* 첫 화면에는 큰 버튼(primary)만, 세부 조건은 '상세 조건 더보기' 안에 */
  var FILTERS = [
    { id: 'd:매매',    label: '매매',   kind: 'deal',   primary: true, test: function (l) { return l.deal === '매매'; } },
    { id: 'd:임대',    label: '임대',   kind: 'deal',   primary: true, test: function (l) { return l.deal === '임대'; } },
    { id: 'g:인천',    label: '인천',   kind: 'group',  primary: true, test: function (l) { return l.district === '인천'; } },
    { id: 'g:경기북부', label: '경기북부', kind: 'group', primary: true, test: function (l) { return l.district !== '인천'; } },
    { id: 'r:부평구',  label: '부평구', kind: 'region', test: function (l) { return l.gu === '부평구'; } },
    { id: 'r:서해구',  label: '서해구(옛 서구)', kind: 'region', test: function (l) { return l.gu === '서해구'; } },
    { id: 'r:제물포구', label: '제물포구(옛 중·동구)', kind: 'region', test: function (l) { return l.gu === '제물포구'; } },
    { id: 'r:남양주',  label: '남양주', kind: 'region', test: function (l) { return l.district === '남양주'; } },
    { id: 'r:양주',    label: '양주',   kind: 'region', test: function (l) { return l.district === '양주'; } },
    { id: 'r:의정부',  label: '의정부', kind: 'region', test: function (l) { return l.district === '의정부'; } },
    { id: 'f:big',     label: '1,000평 이상', kind: 'feature', test: function (l) { return Math.max(l.area || 0, l.site || 0) >= 1000; } },
    { id: 'f:bigsite', label: '대지 500평 이상', kind: 'feature', test: function (l) { return (l.site || 0) >= 500; } },
    { id: 'f:dock',    label: '도크 완비', kind: 'feature', test: function (l) { return /완비/.test(l.dock || ''); } },
    { id: 'f:h9',      label: '층고 9m 이상', kind: 'feature', test: function (l) { return l.height >= 9; } },
    { id: 'f:ft40',    label: '40ft 진출입', kind: 'feature', test: function (l) { return /40\s*(ft|피트)/i.test((l.vehicle || '') + ' ' + (l.subtitle || '') + ' ' + (l.tags || '')); } },
    { id: 'f:rent',    label: '월세 2,500만 이하', kind: 'feature', test: function (l) { return l.rent > 0 && l.rent <= 25000000; } }
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
  function priceLine(l) {
    if (l.deal === '매매') return '매매 ' + won(l.price).num + won(l.price).unit;
    var d = won(l.deposit), r = won(l.rent);
    return '보증금 ' + d.num + d.unit + ' / 월 ' + r.num + r.unit;
  }
  function shortPrice(l) {
    var w = l.deal === '매매' ? won(l.price) : won(l.deposit);
    return w.num + w.unit;
  }
  function heightText(l) {
    return l.height ? l.height + 'm' : '미기재';
  }
  function dash(v) { return v && v !== '미기재' ? v : '—'; }
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
    return [l.region, l.district, l.gu, l.dong, l.title, l.subtitle, l.address, l.note, l.tags, l.source,
            l.use, l.brokerName, l.brokerPerson, l.areaNote, l.siteNote, l.heightNote, l.vehicle, l.dock,
            l.floor, l.priceText, l.article].join(' ').toLowerCase();
  }
  function near(a, b) { return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(40, a * 0.16); }
  function nearRent(rent, v) { return rent > 0 && v > 0 && Math.abs(rent / 10000 - v) <= v * 0.06; }

  /* 옛 행정구역 이름·줄임말도 알아듣게 */
  var ALIAS = {
    '서구': '서해구', '옛서구': '서해구', '중구': '제물포구', '동구': '제물포구', '중동구': '제물포구',
    '경기': '경기북부', '경기도': '경기북부', '부평': '부평구', '남양주시': '남양주', '양주시': '양주', '의정부시': '의정부'
  };

  function tokenMatcher(raw) {
    var t = raw.trim().toLowerCase();
    if (!t) return null;
    var m;
    /* 지역명은 부분일치로 하면 '양주'가 '남양주'까지 잡히므로 정확히 비교 */
    var bare = ALIAS[t] || t.replace(/(특별시|광역시|시|군|구|읍|면|동)$/, '');
    if (bare === '경기북부') {
      return function (l) { return l.district !== '인천'; };
    }
    if (bare === '인천') {
      return function (l) { return l.district === '인천'; };
    }
    if (['부평구', '서해구', '제물포구'].indexOf(bare) > -1) {
      return function (l) { return l.gu === bare; };
    }
    if (['남양주', '양주', '의정부'].indexOf(bare) > -1) {
      return function (l) { return l.district === bare; };
    }
    if (['청천동', '가좌동', '원창동', '석남동', '송림동'].indexOf(bare) > -1) {
      return function (l) { return l.dong === bare; };
    }
    /* '10억' 처럼 가격으로도 찾기 */
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*억(?:\s*원)?$/))) {
      var cap = Math.round(parseFloat(m[1]) * 100000000);
      return function (l) {
        var p = l.deal === '매매' ? l.price : l.deposit;
        return p > 0 && p <= cap;
      };
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
      return function (l) { return (l.rent > 0 && l.rent <= mv * 10000) || (l.price > 0 && l.price <= mv * 10000); };
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

  /* 같은 분류(지역 / 거래 / 조건) 안에서는 OR, 분류끼리는 AND */
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
    if (s === 'rent') out.sort(function (a, b) { return (a.rent || Infinity) - (b.rent || Infinity); });
    else if (s === 'deposit') out.sort(function (a, b) { return (a.deposit || Infinity) - (b.deposit || Infinity); });
    else if (s === 'price') out.sort(function (a, b) { return (a.price || Infinity) - (b.price || Infinity) || a.rank - b.rank; });
    else if (s === 'height') out.sort(function (a, b) { return (b.height || 0) - (a.height || 0) || a.rank - b.rank; });
    else if (s === 'area') out.sort(function (a, b) { return (b.area || 0) - (a.area || 0) || a.rank - b.rank; });
    else out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  /* ── 렌더 ──────────────────────────────────────────────────────────── */
  var ICO = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h3l1.6 4-2.2 1.5a12.5 12.5 0 0 0 6.1 6.1l1.5-2.2 4 1.6v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10.2" r="2.3"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.8-.4L4 21l1.5-4a8.2 8.2 0 0 1-1.5-4.7 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 7.6Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12.5a7.5 7.5 0 0 1-8 7.4 8.6 8.6 0 0 1-2.5-.3L5 21l1.3-3.6A7.4 7.4 0 0 1 5 12.5 7.5 7.5 0 0 1 12.5 5 7.5 7.5 0 0 1 20 12.5Z"/><path d="M9.2 11.2h.01M12.5 11.2h.01M15.8 11.2h.01"/></svg>',
    kakao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10.2" r="2.1"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6.5 18.5 12 13 17.5"/></svg>'
  };

  function rankLabel(l) {
    if (l.deal === '매매') return '매매';
    return l.isRef ? '참고' : l.rank + '순위';
  }

  function specPairs(l) {
    if (l.deal === '매매') {
      return [
        ['연면적', l.area ? l.area.toLocaleString('ko-KR') + '평' : '미기재', !l.area],
        ['대지', l.site ? l.site.toLocaleString('ko-KR') + '평' : '미기재', !l.site],
        ['층', dash(l.floor), !l.floor],
        ['준공', dash(String(l.built || '').replace(' 준공', '')), !l.built],
        ['매물 확인', dash(l.confDate), !l.confDate],
        ['같은 필지', l.dups > 1 ? l.dups + '건' : '1건', false]
      ];
    }
    return [
      ['창고면적', l.area ? l.area.toLocaleString('ko-KR') + '평' : '미기재', !l.area],
      ['대지·마당', l.site ? l.site.toLocaleString('ko-KR') + '평' : '미확인', !l.site],
      ['층고', heightText(l), !l.height],
      ['도크', dash(l.dock), !l.dock || l.dock === '미기재'],
      ['차량진입', dash(l.vehicle), !l.vehicle || l.vehicle === '미기재'],
      ['건물폭', dash(l.width), !l.width || l.width === '미기재']
    ];
  }

  function priceBlock(l, big) {
    if (l.deal === '매매') {
      return '<div class="price is-sale"><div class="p-cell"><p class="p-lab">매매가 (호가)</p>' +
        '<p class="p-val">' + priceHTML(l.price) + '</p>' +
        '<p class="p-vat">VAT·취득세 별도 여부 확인</p></div></div>';
    }
    var d = won(l.deposit);
    return '<div class="price">' +
        '<div class="p-cell"><p class="p-lab">보증금</p><p class="p-val">' + priceHTML(l.deposit) + '</p></div>' +
        '<div class="p-cell"><p class="p-lab">월세</p><p class="p-val">' + priceHTML(l.rent) + '</p>' +
          (l.maint ? '<p class="p-vat">관리비 ' + won(l.maint).num + won(l.maint).unit + '</p>' : (l.vat ? '<p class="p-vat">' + esc(l.vat) + '</p>' : '')) +
        '</div>' +
      '</div>';
  }

  function cardHTML(l) {
    var s = scoreOf(l);
    var media = l.photo
      ? '<img src="' + esc(l.photo) + '" alt="' + esc(l.region + ' ' + l.title + ' 매물 사진') + '" loading="lazy" decoding="async">'
      : '<span class="card-ph"><img src="assets/placeholder.svg" alt="" aria-hidden="true"><span class="ph-tag">PHOTO · 사진 미제공</span></span>';
    var track = (l.conditions || []).map(function (c) {
      return '<i class="' + (c.status === 'ok' ? 'ok' : c.status === 'check' ? 'check' : '') + '"></i>';
    }).join('');
    var specs = specPairs(l).map(function (x) {
      return '<div class="spec"><dt>' + x[0] + '</dt><dd class="' + (x[2] ? 'na' : '') + '" title="' + esc(String(x[1])) + '">' + esc(String(x[1])) + '</dd></div>';
    }).join('');

    var pillL = l.deal === '매매'
      ? '<span class="pill pill-deal">매매</span>'
      : '<span class="pill pill-rank">' + rankLabel(l) + '</span>';
    var pillR = '';
    if (l.deal === '임대') {
      pillR = '<span class="pill pill-score" title="8개 조건 중 충족 ' + s.ok + ' · 확인 필요 ' + s.check + ' · 미충족 ' + s.no + '">조건 <span class="ok num">' + s.ok + '</span>/8</span>';
    } else if (l.dups > 1) {
      pillR = '<span class="pill pill-dup">같은 필지 ' + l.dups + '건</span>';
    }

    return '' +
      '<article class="card ' + (l.deal === '매매' ? 'is-sale' : '') + '" data-id="' + l.id + '">' +
        '<button class="card-hit" type="button" data-open="' + l.id + '" aria-label="' + esc(l.region + ' ' + l.title + ' 상세 보기') + '"></button>' +
        '<div class="card-media">' +
          media + pillL + pillR +
        '</div>' +
        '<div class="card-body">' +
          '<p class="card-region">' + esc(l.region) + '</p>' +
          '<h3 class="card-title">' + esc(l.title) + '</h3>' +
          '<p class="card-sub">' + esc(l.subtitle) + '</p>' +
          priceBlock(l) +
          '<dl class="specs">' + specs + '</dl>' +
          (l.conditions && l.conditions.length
            ? '<div class="track" role="img" aria-label="조건 8개 중 충족 ' + s.ok + ', 확인 필요 ' + s.check + ', 미충족 ' + s.no + '">' + track + '</div>'
            : '') +
          (l.note ? '<p class="card-note">' + esc(l.note) + '</p>' : '') +
          '<div class="card-foot">' +
            '<div class="cf-top">' +
              '<span class="broker">' + esc(l.brokerName || '') + (l.brokerPerson ? ' · ' + esc(l.brokerPerson) : '') + '</span>' +
              '<span class="more">상세 보기' + ICO.arrow + '</span>' +
            '</div>' +
            '<div class="cf-btns">' +
              (l.brokerMobile || l.brokerTel
                ? '<a class="cf-call" href="tel:' + esc(String(l.brokerMobile || l.brokerTel).replace(/[^0-9+]/g, '')) + '">' + ICO.phone + '<span class="num">' + esc(l.brokerMobile || l.brokerTel) + '</span></a>'
                : '<span class="cf-call is-off">번호 미공개</span>') +
              (l.kakaoMap ? '<a class="cf-map" href="' + esc(l.kakaoMap) + '" target="_blank" rel="noopener noreferrer">' + ICO.kakao + '카카오맵</a>' : '') +
            '</div>' +
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
    return '' +
      '<div class="empty">' +
        '<div class="ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.6-4.6"/></svg></div>' +
        '<h3>조건에 맞는 매물이 없습니다</h3>' +
        '<p>검색어나 필터를 줄여 보세요. 조건에 가까운 매물은 조건 대조표와 함께 계속 올리고 있습니다.</p>' +
        '<button class="btn btn-line btn-md" type="button" id="emptyReset">전체 매물 보기</button>' +
      '</div>';
  }

  function chipHTML(f) {
    var on = state.filters.indexOf(f.id) > -1;
    var n = apply(state.q, state.filters, f.id, f.kind).filter(f.test).length;
    return '<button class="chip chip-' + f.kind + '" type="button" data-chip="' + f.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      f.label + ' <span class="n num">' + n + '</span></button>';
  }

  function renderChips() {
    var big = '<button class="chip chip-all" type="button" data-chip="all" aria-pressed="' + (state.filters.length === 0 ? 'true' : 'false') + '">전체 <span class="n num">' + apply(state.q, []).length + '</span></button>';
    big += FILTERS.filter(function (f) { return f.primary; }).map(chipHTML).join('');
    els.bigChips.innerHTML = big;

    els.moreChips.innerHTML = FILTERS.filter(function (f) { return !f.primary; }).map(chipHTML).join('');

    var detailOn = state.filters.some(function (id) { return FILTER_MAP[id] && !FILTER_MAP[id].primary; });
    if (detailOn && els.moreChips.hidden) setMore(true);
  }

  function setMore(open) {
    if (!els.moreChips || !els.moreToggle) return;
    els.moreChips.hidden = !open;
    els.moreToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    els.moreToggle.classList.toggle('is-open', open);
  }

  function renderCriteria() {
    if (!els.critGrid) return;
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
      var nb = document.querySelector('[data-chip="' + focusChip + '"]');
      if (nb) nb.focus();
    }

    els.grid.innerHTML = view.length
      ? view.map(cardHTML).join('') + ctaHTML()
      : emptyHTML();

    els.cnt.innerHTML = (state.filters.length || state.q ? '조건 적용 ' : '전체 ') +
      '<b class="num">' + view.length + '</b>건';
    if (els.heroCount) els.heroCount.textContent = view.length;

    els.activeTags.innerHTML = state.filters.map(function (id) {
      return '<span class="tag">' + esc(FILTER_MAP[id].label) +
        '<button type="button" data-unset="' + id + '" aria-label="' + esc(FILTER_MAP[id].label) + ' 필터 해제">×</button></span>';
    }).join('') + (state.q ? '<span class="tag">“' + esc(state.q) + '”<button type="button" data-unset="q" aria-label="검색어 해제">×</button></span>' : '');

    els.reset.hidden = !(state.filters.length || state.q);
    if (els.searchForm) els.searchForm.classList.toggle('has-value', !!state.q);

    var er = document.getElementById('emptyReset');
    if (er) er.addEventListener('click', resetAll);

    syncMap();
  }

  function resetAll() {
    state.filters = [];
    state.q = '';
    els.q.value = '';
    update();
  }

  /* ── 모달 ──────────────────────────────────────────────────────────── */
  function specRows(l) {
    var rows;
    if (l.deal === '매매') {
      rows = [
        ['연면적', (l.area ? l.area.toLocaleString('ko-KR') + '평' : '미기재'), l.areaNote],
        ['대지면적', (l.site ? l.site.toLocaleString('ko-KR') + '평' : '미기재'), l.siteNote],
        ['층', dash(l.floor), ''],
        ['사용승인', dash(String(l.built || '').replace(' 준공', '')) + (l.years ? ' (' + l.years + '년차)' : ''), ''],
        ['용도지역', dash(l.zone), '건축물대장·토지이용계획 확인 필요'],
        ['지목', dash(l.jimok), ''],
        ['전력 용량', dash(l.power), '한전·관리사무소 확인 필요'],
        ['진입로 폭', dash(l.roadWidth), '대형차 회전 반경 포함 실측'],
        ['인근 IC', dash(l.ic), ''],
        ['도크', dash(l.dock), ''],
        ['차량 진입', dash(l.vehicle), ''],
        ['매물 확인일', dash(l.confDate), l.owner ? '소유자 확인 매물' : ''],
        ['같은 필지', (l.dups > 1 ? l.dups + '건 (중개사무소별 호가 비교 필요)' : '1건'), ''],
        ['위치 확인', dash(l.locLevel), ''],
        ['원문', l.source || '네이버 부동산', l.article ? '매물번호 ' + l.article : '']
      ];
    } else {
      rows = [
        ['창고면적', (l.area ? l.area.toLocaleString('ko-KR') + '평' : '미기재'), l.areaNote],
        ['대지·마당', (l.site ? l.site.toLocaleString('ko-KR') + '평' : '미확인'), l.siteNote],
        ['층고', heightText(l), l.heightNote && l.height ? l.heightNote : ''],
        ['도크', dash(l.dock), ''],
        ['차량 진입', dash(l.vehicle), ''],
        ['건물폭', dash(l.width), ''],
        ['진입로 경사', dash(l.slope), ''],
        ['준공·입주', dash(l.built), ''],
        ['용도', dash(l.use), ''],
        ['전력 용량', dash(l.power), '확인 필요'],
        ['진입로 폭', dash(l.roadWidth), '확인 필요'],
        ['용도지역', dash(l.zone), '확인 필요'],
        ['지목', dash(l.jimok), '확인 필요'],
        ['인근 IC', dash(l.ic), '확인 필요'],
        ['출처', dash(l.source), '']
      ];
    }
    return rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) +
        (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</dd></div>';
    }).join('');
  }

  function brokerButtons(telPlain) {
    var tel = String(telPlain || '').replace(/[^0-9+]/g, '');
    if (!tel) return '';
    return '<div class="btns btns-3">' +
        '<a class="btn btn-navy btn-big" href="tel:' + esc(tel) + '">' + ICO.phone + '전화하기</a>' +
        '<a class="btn btn-line btn-big" href="sms:' + esc(tel) + '">' + ICO.sms + '문자</a>' +
        '<button class="btn btn-line btn-big" type="button" data-copy="' + esc(telPlain) + '">' + ICO.copy + '복사</button>' +
      '</div>';
  }

  function modalHTML(l) {
    var s = scoreOf(l);
    var isSale = l.deal === '매매';
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
    var broker = '<div class="m-broker"><p class="lab">' + (isSale ? '담당 부동산 (등록 중개사무소)' : '담당 부동산 (중개사 연락처)') + '</p>' +
      '<p class="nm">' + esc(l.brokerName) + (l.brokerPerson ? ' · ' + esc(l.brokerPerson) + ' 공인중개사' : '') + '</p>' +
      (telMain ? '<p class="tel-big num">' + esc(telMain) + '</p>' : '') +
      (l.brokerTel && l.brokerMobile && l.brokerTel !== l.brokerMobile ? '<p class="tel">사무실 ' + esc(l.brokerTel) + '</p>' : '') +
      (l.brokerAddr ? '<p class="tel sm">' + esc(l.brokerAddr) + '</p>' : '') +
      (telMain
        ? brokerButtons(telMain)
        : '<p class="none">연락처가 공개되지 않은 매물입니다. 아래 원문 매물에서 문의해 주세요.</p>') +
      '</div>';

    var photoCredit = l.photoNote ? '<p class="m-photonote">' + esc(l.photoNote) + '</p>' : '';

    var links = '' +
      '<div class="m-links">' +
        (l.kakaoRoute ? '<a class="btn btn-line btn-big" href="' + esc(l.kakaoRoute) + '" target="_blank" rel="noopener noreferrer">' + ICO.pin + '카카오맵 길찾기</a>' : '') +
        (l.kakaoMap ? '<a class="btn btn-line btn-big" href="' + esc(l.kakaoMap) + '" target="_blank" rel="noopener noreferrer">' + ICO.kakao + '카카오맵에서 보기</a>' : '') +
        (l.link ? '<a class="btn btn-line btn-big" href="' + esc(l.link) + '" target="_blank" rel="noopener noreferrer">' + ICO.out + '원문 매물</a>' : '') +
      '</div>';

    var ask = '' +
      '<div class="m-ask">' +
        '<p class="lab">공동중개 문의</p>' +
        '<p class="d">이 매물로 손님을 모시거나, 같은 조건의 다른 매물이 필요하시면 부동산판으로 연락 주세요. 공동중개로 바로 연결해 드립니다.</p>' +
        '<div class="btns btns-3">' +
          '<a class="btn btn-kakao btn-big" href="http://pf.kakao.com/_gbXRX/chat" target="_blank" rel="noopener noreferrer">' + ICO.chat + '카톡</a>' +
          '<a class="btn btn-navy btn-big" href="tel:01080281848">' + ICO.phone + '전화</a>' +
          '<a class="btn btn-line btn-big" href="sms:01080281848">' + ICO.sms + '문자</a>' +
        '</div>' +
      '</div>';

    var addr = '<p class="m-addr">' + ICO.pin +
      (l.kakaoMap ? '<a href="' + esc(l.kakaoMap) + '" target="_blank" rel="noopener noreferrer">' + esc(l.address) + ICO.out + '</a>' : esc(l.address)) +
      '</p>';

    return '' +
      '<h2 class="m-title" id="mTitle">' + esc(l.title) + '</h2>' +
      '<p class="m-sub">' + esc(l.subtitle) + '</p>' +
      addr +

      '<div class="m-grid">' +
        '<div class="m-left">' +
          (l.photo ? '<div class="m-photo">' + media + '</div>' + photoCredit : '') +
          priceBlock(l) +
          broker +
          links +
          ask +
        '</div>' +

        '<div class="m-right">' +
          '<div class="blk">' +
            '<div class="blk-head"><h4>매물 정보</h4>' + (isSale ? '<span class="sum">' + esc(l.dong || '') + ' ' + esc(l.floor || '') + '</span>' : '') + '</div>' +
            '<div class="blk-body"><dl class="m-spec">' + specRows(l) + '</dl></div>' +
          '</div>' +
          (l.conditions && l.conditions.length
            ? '<div class="blk">' +
                '<div class="blk-head"><h4>고객 조건 8개 대비</h4>' +
                '<span class="sum"><b>' + s.ok + '</b> 충족 · ' + s.check + ' 확인 · ' + s.no + ' 미충족</span></div>' +
                '<div class="blk-body">' + conds + '</div>' +
              '</div>'
            : '') +
          '<div class="blk">' +
            '<div class="blk-head"><h4>현장 확인 체크리스트</h4><span class="sum">방문 시 확인</span></div>' +
            '<div class="blk-body" style="padding:0"><ul class="checklist">' +
              (l.checklist || []).map(function (c, i) {
                return '<li><input type="checkbox" id="ck' + l.id + '_' + i + '"><label for="ck' + l.id + '_' + i + '"><span>' + esc(c) + '</span></label></li>';
              }).join('') +
            '</ul></div>' +
          '</div>' +
          (l.areaWarn ? '<p class="m-warn">' + esc(l.areaWarn) + '</p>' : '') +
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
    els.mCrumb.innerHTML = '<b>' + esc(l.region) + '</b> · ' + esc(priceLine(l));
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
    focusPin(l.id);
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

  /* ── 지도 (필지 단위로 묶어 핀 표시) ───────────────────────────────── */
  var map = null;
  var mapMarkers = {};
  var mapGroups = [];

  function hasGeo(l) { return l.lat && l.lng; }

  function groupListings(list) {
    var groups = {}, order = [];
    list.filter(hasGeo).forEach(function (l) {
      var key = l.deal === '임대' ? 'G' + l.id : (l.dong || '') + '|' + (l.jibun || l.address);
      if (!groups[key]) {
        groups[key] = { key: key, lat: l.lat, lng: l.lng, deal: l.deal, region: l.region, items: [] };
        order.push(key);
      }
      groups[key].items.push(l);
    });
    return order.map(function (k) { return groups[k]; });
  }

  /* 권역별 클러스터 — 지도 위 범례 칩 */
  var CLUSTERS = [
    { id: 'g:인천', label: '인천', test: function (l) { return l.district === '인천'; } },
    { id: 'r:부평구', label: '부평구', test: function (l) { return l.gu === '부평구'; } },
    { id: 'r:서해구', label: '서해구', test: function (l) { return l.gu === '서해구'; } },
    { id: 'r:제물포구', label: '제물포구', test: function (l) { return l.gu === '제물포구'; } },
    { id: 'r:남양주', label: '남양주', test: function (l) { return l.district === '남양주'; } },
    { id: 'r:양주', label: '양주', test: function (l) { return l.district === '양주'; } }
  ];

  function renderMapLegend() {
    var host = document.getElementById('mapLegend');
    if (!host) return;
    host.innerHTML = CLUSTERS.map(function (c) {
      var n = LISTINGS.filter(c.test).length;
      if (!n) return '';
      var on = state.filters.indexOf(c.id) > -1;
      return '<button class="map-chip' + (on ? ' is-active' : '') + '" type="button" data-cluster="' + c.id + '">' +
        '<b class="num">' + n + '</b><span class="mc-r">' + c.label + '</span></button>';
    }).join('');
  }

  function popupHTML(g) {
    var head = g.deal === '임대' ? '임대' : '매매';
    var rows = g.items.slice(0, 4).map(function (l) {
      var w = l.deal === '매매' ? won(l.price) : won(l.deposit);
      return '<button class="pk-row" type="button" data-open="' + l.id + '">' +
          '<span class="pk-n">' + esc(l.title) + '</span>' +
          '<span class="pk-p"><b>' + w.num + w.unit + '</b>' + (l.deal === '임대' ? '<i>/월 ' + won(l.rent).num + won(l.rent).unit + '</i>' : '') + '</span>' +
          '<span class="pk-b">' + esc(l.brokerName || '') + (l.brokerMobile || l.brokerTel ? ' · ' + esc(l.brokerMobile || l.brokerTel) : '') + '</span>' +
        '</button>';
    }).join('');
    var more = g.items.length > 4 ? '<p class="pk-more">외 ' + (g.items.length - 4) + '건 — 아래 매물 목록에서 확인</p>' : '';
    var first = g.items[0];
    return '<div class="pk">' +
      '<p class="pk-r">' + esc(g.region) + ' · ' + head + ' ' + g.items.length + '건</p>' +
      rows + more +
      '<div class="pk-btns">' +
        (first.kakaoMap ? '<a class="pk-k" href="' + esc(first.kakaoMap) + '" target="_blank" rel="noopener noreferrer">카카오맵</a>' : '') +
        '<button class="pk-d" type="button" data-open="' + first.id + '">상세 보기</button>' +
      '</div>' +
    '</div>';
  }

  function setActivePin(id) {
    Object.keys(mapMarkers).forEach(function (k) {
      var mk = mapMarkers[k];
      var el = mk.getElement && mk.getElement();
      if (!el) return;
      var hit = mk._items && mk._items.some(function (l) { return String(l.id) === String(id); });
      var pin = el.querySelector('.pin');
      if (pin) pin.classList.toggle('is-active', !!hit);
    });
  }

  function focusPin(id) {
    var found = null;
    mapGroups.forEach(function (g) {
      if (found) return;
      if (g.items.some(function (l) { return String(l.id) === String(id); })) found = g;
    });
    if (!found || !map || !mapMarkers[found.key]) return false;
    setActivePin(id);
    map.flyTo([found.lat, found.lng], Math.max(map.getZoom(), 14), { duration: 0.5 });
    setTimeout(function () { mapMarkers[found.key].openPopup(); }, 380);
    return true;
  }

  function mapRowHTML(g) {
    var l = g.items[0];
    var w = l.deal === '매매' ? won(l.price) : won(l.deposit);
    return '<li class="mf-row">' +
      '<span class="mf-r">' + esc(g.deal) + '</span>' +
      '<div class="mf-b">' +
        '<p class="mf-t">' + esc(l.address) + (g.items.length > 1 ? ' · ' + g.items.length + '건' : '') + '</p>' +
        '<p class="mf-a">' + esc(l.brokerName || '') + (l.brokerMobile || l.brokerTel ? ' · ' + esc(l.brokerMobile || l.brokerTel) : '') + '</p>' +
        '<p class="mf-p">' + w.num + w.unit + (l.deal === '임대' ? ' / 월 ' + won(l.rent).num + won(l.rent).unit : '') + '</p>' +
      '</div>' +
      '<button class="mf-k" type="button" data-open="' + l.id + '">상세</button>' +
    '</li>';
  }

  function mapFallback(groups) {
    var cv = document.getElementById('mapCanvas');
    var fb = document.getElementById('mapFallback');
    if (!fb) return;
    if (cv) cv.hidden = true;
    fb.hidden = false;
    fb.innerHTML = '<p class="mf-lead">지도를 표시하지 못했습니다. 매물 위치는 아래에서 확인하세요.</p>' +
      '<ul class="mf-list">' + groups.slice(0, 12).map(mapRowHTML).join('') + '</ul>' +
      (groups.length > 12 ? '<p class="mf-lead">외 ' + (groups.length - 12) + '필지 — 아래 매물 목록에서 확인</p>' : '');
  }

  function visibleGroups() {
    var ids = {};
    view.forEach(function (l) { ids[String(l.id)] = 1; });
    return mapGroups.filter(function (g) {
      return g.items.some(function (l) { return ids[String(l.id)]; });
    });
  }

  /* 필터 결과에 맞춰 핀만 켜고 끄기 + 필터가 바뀔 때만 지도 범위 다시 맞추기 */
  var lastFitKey = '';
  function syncMap() {
    renderMapLegend();
    if (!map) return;
    var vis = {};
    view.forEach(function (l) { vis[String(l.id)] = 1; });
    mapGroups.forEach(function (g) {
      var mk = mapMarkers[g.key];
      if (!mk) return;
      var on = g.items.some(function (l) { return vis[String(l.id)]; });
      var el = mk.getElement && mk.getElement();
      if (el) el.style.display = on ? '' : 'none';
    });
    var key = state.filters.slice().sort().join(',') + '|' + view.length;
    if (key !== lastFitKey) {
      lastFitKey = key;
      fitMap(visibleGroups());
    }
    labelPins();
  }

  function fitMap(groups) {
    if (!map) return;
    var pts = (groups || mapGroups).filter(function (g) { return g.lat && g.lng; });
    if (!pts.length) return;
    if (pts.length === 1) { map.setView([pts[0].lat, pts[0].lng], 13); return; }
    var b = L.latLngBounds(pts.map(function (g) { return [g.lat, g.lng]; }));
    map.fitBounds(b, { padding: [46, 46], maxZoom: 14 });
  }

  /* 핀·라벨이 서로 가리지 않도록 자리가 되는 핀에만 금액 라벨 표시 */
  function labelPins() {
    if (!map) return;
    var pins = [], items = [];
    var size = map.getSize();
    mapGroups.forEach(function (g) {
      var mk = mapMarkers[g.key];
      if (!mk) return;
      var node = mk.getElement && mk.getElement();
      if (!node || node.style.display === 'none') return;
      var pin = node.querySelector('.pin');
      if (!pin) return;
      pin.classList.remove('has-lbl');
      var p = map.latLngToContainerPoint(mk.getLatLng());
      pins.push({ key: g.key, box: { x: p.x - 15, y: p.y - 15, w: 30, h: 30 } });
      items.push({ g: g, pin: pin, x: p.x, y: p.y });
    });
    items.sort(function (a, b) { return a.y - b.y; });
    var W = 120, H = 26, taken = [];
    items.forEach(function (it) {
      var box = { x: it.x + 16, y: it.y - H / 2, w: W, h: H };
      if (box.x + box.w > size.x - 8) return;
      var hit = taken.some(function (b) { return overlaps(box, b); }) ||
                pins.some(function (p) { return p.key !== it.g.key && overlaps(box, p.box); });
      it.pin.classList.toggle('has-lbl', !hit);
      if (!hit) taken.push(box);
    });
    function overlaps(a, b) {
      return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
    }
  }

  function pinHTML(g) {
    var l = g.items[0];
    var n = g.items.length;
    var label = g.deal === '임대' ? shortPrice(l) : (n > 1 ? n + '건' : shortPrice(l));
    return '<span class="pin pin-' + (g.deal === '매매' ? 'sale' : 'rent') + '">' +
        '<b class="pin-d">' + (n > 1 ? '<i class="num">' + n + '</i>' : '') + '</b>' +
        '<span class="pin-l">' + esc(g.region.split(' ').slice(-1)[0] + ' · ' + label) + '</span>' +
      '</span>';
  }

  function initMap() {
    var el = document.getElementById('mapCanvas');
    var fb = document.getElementById('mapFallback');
    if (!el) return;
    mapGroups = groupListings(LISTINGS);
    renderMapLegend();

    if (map) { map.remove(); map = null; }
    mapMarkers = {};
    el.hidden = false;
    if (fb) { fb.hidden = true; fb.innerHTML = ''; }
    if (!window.L || !mapGroups.length) { mapFallback(mapGroups); return; }

    map = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: false, worldCopyJump: true });

    var tileErrs = 0, tileFailed = false;
    var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true });
    tiles.on('tileerror', function () {
      tileErrs += 1;
      if (tileFailed || tileErrs < 4) return;
      tileFailed = true;
      el.classList.add('is-offline');
      var note = document.getElementById('mapNote');
      if (note) note.hidden = false;
    });
    tiles.addTo(map);

    mapGroups.forEach(function (g) {
      var icon = L.divIcon({ className: 'pinwrap', html: pinHTML(g), iconSize: [1, 1], iconAnchor: [1, 1] });
      var mk = L.marker([g.lat, g.lng], {
        icon: icon, title: g.region + ' ' + (g.items.length > 1 ? g.items.length + '건' : ''), riseOnHover: true, keyboard: true
      });
      mk._items = g.items;
      mk.bindPopup(popupHTML(g), { maxWidth: 320, minWidth: 240, closeButton: true, autoPanPadding: [26, 26], offset: [0, -4] });
      mk.on('popupopen', function () { setActivePin(g.items[0].id); });
      mk.addTo(map);
      mapMarkers[g.key] = mk;
    });

    requestAnimationFrame(function () {
      if (!map) return;
      map.invalidateSize();
      fitMap();
      labelPins();
    });
    map.on('zoomend moveend', labelPins);
    window.addEventListener('resize', function () { setTimeout(labelPins, 180); });
  }

  /* ── 이벤트 ────────────────────────────────────────────────────────── */
  function setPlaceholder() {
    var short = window.matchMedia('(max-width: 720px)').matches;
    els.q.placeholder = short
      ? '지역 · 평수 · 키워드 검색'
      : '지역 · 평수 · 키워드로 검색 (예: 청천동 1,000평, 매매, 도크)';
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

  /* 큰 버튼은 '하나만' 고르는 방식 — 어르신 중개사님이 헷갈리지 않게 */
  function fam(kind) { return (kind === 'group' || kind === 'region') ? 'region' : kind; }
  function toggleFilter(id) {
    var f = FILTER_MAP[id];
    if (!f) return;
    var i = state.filters.indexOf(id);
    if (i > -1) { state.filters.splice(i, 1); return; }
    var mine = fam(f.kind);
    state.filters = state.filters.filter(function (x) {
      var g = FILTER_MAP[x];
      return !g || fam(g.kind) !== mine;
    });
    state.filters.push(id);
  }

  els.bigChips.addEventListener('click', function (e) {
    var b = e.target.closest('[data-chip]');
    if (!b) return;
    var id = b.getAttribute('data-chip');
    if (id === 'all') state.filters = [];
    else toggleFilter(id);
    update();
  });

  els.moreChips.addEventListener('click', function (e) {
    var b = e.target.closest('[data-chip]');
    if (!b) return;
    toggleFilter(b.getAttribute('data-chip'));
    update();
  });

  if (els.moreToggle) {
    els.moreToggle.addEventListener('click', function () {
      setMore(els.moreChips.hidden);
    });
  }

  function submitSearch() {
    state.q = els.q.value.trim();
    update();
    var sec = document.getElementById('listings');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (els.searchForm) {
    els.searchForm.addEventListener('submit', function (e) { e.preventDefault(); submitSearch(); });
  }
  if (els.qGo) {
    els.qGo.addEventListener('click', function (e) { e.preventDefault(); submitSearch(); });
  }
  els.q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); submitSearch(); }
  });

  var askBtn = document.getElementById('askFormBtn');
  if (askBtn && FORM_URL) { askBtn.setAttribute('href', FORM_URL); askBtn.removeAttribute('target'); }


  var legend = document.getElementById('mapLegend');
  if (legend) {
    legend.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cluster]');
      if (!b) return;
      toggleFilter(b.getAttribute('data-cluster'));
      update();
    });
  }

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

  var mapFitBtn = document.getElementById('mapFit');
  if (mapFitBtn) {
    mapFitBtn.addEventListener('click', function () {
      state.filters = []; state.q = ''; els.q.value = '';
      update();
      if (map) { fitMap(mapGroups); map.invalidateSize(); }
      var sec = document.getElementById('map');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  els.sort.addEventListener('change', function () {
    state.sort = els.sort.value;
    update();
  });

  document.addEventListener('click', function (e) {
    var op = e.target.closest('[data-open]');
    if (op) { e.preventDefault(); openModal(op.getAttribute('data-open')); return; }
    var foc = e.target.closest('[data-focus]');
    if (foc) { focusPin(foc.getAttribute('data-focus')); return; }
    var cp = e.target.closest('[data-copy]');
    if (cp) {
      copyText(cp.getAttribute('data-copy')).then(function (ok) {
        toast(ok ? '번호를 복사했습니다' : '복사가 막혀 있습니다. 번호를 길게 눌러 복사해 주세요');
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
      var deal = get('deal') || '임대';
      return {
        id: num(get('id')) || n + 1,
        rank: num(get('rank')) || n + 1,
        isRef: /참고|ref/i.test(get('rank')),
        deal: deal,
        district: get('district'),
        gu: get('gu'),
        dong: get('dong'),
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
        price: num(get('price')),
        priceText: get('price_text'),
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
        years: get('years'),
        floor: get('floor'),
        use: get('use'),
        power: get('power'),
        roadWidth: get('road_width'),
        zone: get('zone'),
        jimok: get('jimok'),
        ic: get('ic'),
        lat: num(get('lat')),
        lng: num(get('lng')),
        kakaoMap: get('kakao_map'),
        kakaoRoute: get('kakao_route'),
        confDate: get('conf_date'),
        dups: num(get('dups')) || 1,
        locLevel: get('loc_level'),
        brokerName: get('broker_name'),
        brokerTel: get('broker_tel'),
        brokerMobile: get('broker_mobile'),
        brokerPerson: get('broker_person'),
        brokerAddr: get('broker_addr'),
        link: get('link'),
        source: get('source'),
        note: get('note'),
        tags: get('tags'),
        areaWarn: get('area_warn'),
        conditions: conds,
        checklist: get('checklist').split('|').map(function (s) { return s.trim(); }).filter(Boolean)
      };
    }).filter(function (l) { return l.title; });
  }

  function boot() {
    renderCriteria();
    update();
    initMap();

    if (SHEET_CSV_URL) {
      fetch(SHEET_CSV_URL, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (csv) {
          var rows = fromSheet(csv);
          if (rows.length) { LISTINGS = rows; update(); initMap(); }
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
