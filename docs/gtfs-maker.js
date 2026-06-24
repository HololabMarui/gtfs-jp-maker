// ============================================================
// GTFS-JP Maker — gtfs-maker.js
// Single source of truth: window.makerData
// ============================================================

window.makerData = window.makerData || { routes: null, stops: null, timetable: null, calendar: null };
const csvData = window.makerData;

// ---------- Tab navigation ----------
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
    btn.setAttribute('aria-selected', btn.dataset.tab === tabId ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-content').forEach(div => {
    div.classList.toggle('active', div.id === tabId);
  });
  document.dispatchEvent(new CustomEvent('tabChange', { detail: { tabId } }));
}

document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.goto));
});

// ---------- Shared helpers ----------
function v(id) { return document.getElementById(id)?.value?.trim() || ''; }

function csvLine(fields) {
  return fields.map(f => {
    const s = String(f ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',') + '\r\n';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function downloadCSV(name, content) {
  const bom = '﻿';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name + '.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ---------- Calendar normalization helpers ----------
function isValidYyyymmdd(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function calcOneYearMinusOneDay(startYyyymmdd) {
  const y = Number(startYyyymmdd.slice(0, 4));
  const m = Number(startYyyymmdd.slice(4, 6));
  const d = Number(startYyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(y + 1, m - 1, d));
  date.setUTCDate(date.getUTCDate() - 1);
  return String(date.getUTCFullYear()) +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    String(date.getUTCDate()).padStart(2, '0');
}

function normalizeCalendarRows(calendarRows) {
  const warnings = [];
  const errors = [];
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (const row of calendarRows) {
    const serviceId = String(row.service_id || '').trim() || '(service_id未設定)';
    const start = String(row.start_date || '').trim();
    let end = String(row.end_date || '').trim();

    if (!start) {
      errors.push(`calendar.csv の start_date が空欄です: ${serviceId}`);
      continue;
    }
    if (!isValidYyyymmdd(start)) {
      errors.push(`calendar.csv の start_date が不正です（YYYYMMDD形式）: ${serviceId} / ${start}`);
      continue;
    }

    if (!end) {
      end = calcOneYearMinusOneDay(start);
      row.end_date = end;
      warnings.push(`calendar.csv の end_date が空欄だったため自動設定しました: ${serviceId} ${start} → ${end}`);
    } else if (!isValidYyyymmdd(end)) {
      errors.push(`calendar.csv の end_date が不正です（YYYYMMDD形式）: ${serviceId} / ${end}`);
      continue;
    } else if (end < start) {
      errors.push(`calendar.csv の end_date が start_date より前です: ${serviceId} ${start} → ${end}`);
    }

    dayNames.forEach(day => {
      const val = String(row[day] ?? '').trim();
      if (val !== '0' && val !== '1') {
        errors.push(`calendar.csv の ${day} は 0 または 1 を指定してください: service_id=${serviceId} / 値=${val || '空欄'}`);
      }
    });
  }

  return { rows: calendarRows, warnings, errors };
}

// ---------- GTFS file generators ----------
function makeAgencyTxt() {
  const id    = v('agency-id')    || 'A001';
  const name  = v('agency-name')  || '未設定事業者';
  const url   = v('agency-url')   || 'https://example.com';
  const phone = v('agency-phone') || '';
  return csvLine(['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone']) +
         csvLine([id, name, url, 'Asia/Tokyo', 'ja', phone]);
}

function makeRoutesTxt(routes) {
  const agencyId = v('agency-id') || 'A001';
  let out = csvLine(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color']);
  const seen = new Set();
  routes.forEach(r => {
    if (seen.has(r.route_id)) return;
    seen.add(r.route_id);
    out += csvLine([r.route_id, agencyId, r.route_short_name || '', r.route_long_name || '', r.route_type || '3', (r.route_color || '000080').replace('#', ''), 'FFFFFF']);
  });
  return out;
}

function makeStopsTxt(stops) {
  let out = csvLine(['stop_id', 'stop_name', 'stop_lat', 'stop_lon']);
  stops.forEach(r => { out += csvLine([r.stop_id, r.stop_name, r.stop_lat || '', r.stop_lon || '']); });
  return out;
}

function getStopCols(timetable) {
  if (!timetable.length) return [];
  const fixedCols = new Set(['route_id', 'direction_id', 'service_id', 'trip_name', 'notes',
                              'trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time']);
  return Object.keys(timetable[0]).filter(c => !fixedCols.has(c));
}

function normalizeTime(s) {
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  return m[1].padStart(2, '0') + ':' + m[2];
}

function parseTimeMin(s) {
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function makeTripsAndStopTimes(timetable, stopCols, stops) {
  let tripsTxt     = csvLine(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id']);
  let stopTimesTxt = csvLine(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence']);

  // Detect new-style timetable (has stop_id / stop_sequence / arrival_time columns)
  const isNewStyle = timetable.length > 0 && ('stop_id' in timetable[0] || 'arrival_time' in timetable[0]);

  if (isNewStyle) {
    // Group rows by trip_name+route_id+service_id
    const tripGroups = {};
    timetable.forEach((row, i) => {
      const key = `${row.trip_name || ''}|${row.route_id || ''}|${row.service_id || ''}|${row.direction_id || '0'}`;
      if (!tripGroups[key]) tripGroups[key] = { row, stops: [] };
      tripGroups[key].stops.push(row);
    });
    let tripIdx = 1;
    for (const [key, group] of Object.entries(tripGroups)) {
      const r = group.row;
      const tripId  = 'T' + String(tripIdx++).padStart(3, '0');
      const dirId   = r.direction_id || '0';
      const shapeId = `${r.route_id}_${dirId}`;
      tripsTxt += csvLine([r.route_id, r.service_id, tripId, r.trip_name || '', dirId, shapeId]);
      group.stops.sort((a, b) => parseInt(a.stop_sequence || 0) - parseInt(b.stop_sequence || 0));
      group.stops.forEach((s, si) => {
        const arr = normalizeTime((s.arrival_time || s.departure_time || '').trim());
        const dep = normalizeTime((s.departure_time || s.arrival_time || '').trim());
        if (!arr && !dep) return;
        const seq = s.stop_sequence || (si + 1);
        stopTimesTxt += csvLine([tripId, (arr || dep) + ':00', (dep || arr) + ':00', s.stop_id, String(seq)]);
      });
    }
  } else {
    // Legacy wide-format: each row is a trip, stop columns are the stop IDs
    timetable.forEach((row, i) => {
      const tripId  = 'T' + String(i + 1).padStart(3, '0');
      const dirId   = row.direction_id || '0';
      const shapeId = `${row.route_id}_${dirId}`;
      tripsTxt += csvLine([row.route_id, row.service_id, tripId, row.trip_name || '', dirId, shapeId]);
      let seq = 1;
      stopCols.forEach(col => {
        const hhmm = normalizeTime((row[col] || '').trim());
        if (!hhmm) return;
        stopTimesTxt += csvLine([tripId, hhmm + ':00', hhmm + ':00', col, String(seq++)]);
      });
    });
  }

  return { tripsTxt, stopTimesTxt };
}

function makeCalendarTxt(calendar) {
  let out = csvLine(['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date']);
  calendar.forEach(r => {
    out += csvLine([r.service_id, r.monday || '0', r.tuesday || '0', r.wednesday || '0', r.thursday || '0', r.friday || '0', r.saturday || '0', r.sunday || '0', r.start_date || '', r.end_date || '']);
  });
  return out;
}

function makeShapesTxt(routes, stops, stopCols, timetable) {
  const stopMap = {};
  stops.forEach(r => {
    if (r.stop_lat && r.stop_lon) stopMap[r.stop_id] = { lat: parseFloat(r.stop_lat), lon: parseFloat(r.stop_lon) };
  });

  const isNewStyle = timetable.length > 0 && ('stop_id' in timetable[0] || 'arrival_time' in timetable[0]);
  const shapeStops = {};

  if (isNewStyle) {
    timetable.forEach(row => {
      const dirId   = row.direction_id || '0';
      const shapeId = `${row.route_id}_${dirId}`;
      if (!shapeStops[shapeId]) shapeStops[shapeId] = [];
      shapeStops[shapeId].push(row);
    });
    // Sort each shape's stops by sequence and deduplicate
    for (const shapeId of Object.keys(shapeStops)) {
      const rows = shapeStops[shapeId];
      rows.sort((a, b) => parseInt(a.stop_sequence || 0) - parseInt(b.stop_sequence || 0));
      shapeStops[shapeId] = [...new Map(rows.map(r => [r.stop_sequence + '|' + r.stop_id, r.stop_id])).values()];
    }
  } else {
    timetable.forEach(row => {
      const dirId   = row.direction_id || '0';
      const shapeId = `${row.route_id}_${dirId}`;
      if (shapeStops[shapeId]) return;
      shapeStops[shapeId] = stopCols.filter(col => row[col] && row[col].trim());
    });
  }

  let out = csvLine(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled']);
  let hasAny = false;
  for (const [shapeId, stopIds] of Object.entries(shapeStops)) {
    let seq = 1, cumDist = 0, prevPt = null;
    stopIds.forEach(stopId => {
      const pt = stopMap[stopId];
      if (!pt) return;
      if (prevPt) cumDist += haversine(prevPt.lat, prevPt.lon, pt.lat, pt.lon);
      out += csvLine([shapeId, pt.lat.toFixed(6), pt.lon.toFixed(6), String(seq++), cumDist.toFixed(1)]);
      prevPt = pt;
      hasAny = true;
    });
  }
  return hasAny ? out : 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n';
}

function makeFeedInfoTxt() {
  const name  = v('feed-publisher-name') || v('agency-name') || '未設定';
  const url   = v('feed-publisher-url')  || v('agency-url')  || 'https://example.com';
  const start = v('feed-start-date')?.replace(/-/g, '') || '';
  const end   = v('feed-end-date')?.replace(/-/g, '')   || '';
  return csvLine(['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date']) +
         csvLine([name, url, 'ja', start, end]);
}

// ---------- Validation ----------
let calendarNormWarnings = [];

function runValidation(resultsContainerId, warningNoticeId) {
  const errors = [];
  const warnings = [];

  const routes    = csvData.routes   || [];
  const stops     = csvData.stops    || [];
  const timetable = csvData.timetable || [];
  const calendar  = csvData.calendar  || [];

  const requiredCols = {
    routes:    ['route_id', 'route_short_name', 'route_long_name'],
    stops:     ['stop_id', 'stop_name'],
    timetable: ['route_id', 'service_id', 'trip_name'],
    calendar:  ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date'],
  };
  for (const [key, cols] of Object.entries(requiredCols)) {
    const data = csvData[key];
    if (!data || data.length === 0) { errors.push(`${key}.csv にデータがありません`); continue; }
    const actualCols = Object.keys(data[0]);
    cols.forEach(c => {
      if (!actualCols.includes(c)) errors.push(`${key}.csv に必須列「${c}」がありません`);
    });
  }

  if (errors.length) { renderValidation(errors, warnings, resultsContainerId); updateWarningNotice(errors, warnings, warningNoticeId); return { errors, warnings }; }

  const norm = normalizeCalendarRows(calendar);
  norm.errors.forEach(e => errors.push(e));
  calendarNormWarnings.forEach(w => warnings.push(w));

  if (errors.length) { renderValidation(errors, warnings, resultsContainerId); updateWarningNotice(errors, warnings, warningNoticeId); return { errors, warnings }; }

  const stopIds = stops.map(r => r.stop_id).filter(Boolean);
  const dupStopIds = stopIds.filter((id, i) => stopIds.indexOf(id) !== i);
  if (dupStopIds.length) errors.push(`stops.csv に stop_id が重複しています: ${[...new Set(dupStopIds)].join(', ')}`);

  const routeIdSet = new Set(routes.map(r => r.route_id));
  [...new Set(timetable.map(r => r.route_id))].forEach(id => {
    if (!routeIdSet.has(id)) errors.push(`timetable.csv の route_id「${id}」が routes.csv に存在しません`);
  });

  const calServiceIds = new Set(calendar.map(r => r.service_id));
  [...new Set(timetable.map(r => r.service_id))].forEach(id => {
    if (!calServiceIds.has(id)) errors.push(`timetable.csv の service_id「${id}」が calendar.csv に存在しません`);
  });

  // For wide-format: check stop cols exist in stops.csv
  const isNewStyle = timetable.length > 0 && ('stop_id' in timetable[0] || 'arrival_time' in timetable[0]);
  if (!isNewStyle) {
    const stopIdSet = new Set(stopIds);
    const stopCols = getStopCols(timetable);
    stopCols.forEach(col => {
      if (!stopIdSet.has(col)) errors.push(`timetable.csv の列「${col}」が stops.csv の stop_id に存在しません`);
    });

    const timeRe = /^\d{1,2}:\d{2}$/;
    let badTimeCount = 0;
    timetable.forEach(row => {
      stopCols.forEach(col => { if (row[col] && !timeRe.test(row[col])) badTimeCount++; });
    });
    if (badTimeCount > 0) errors.push(`時刻形式が不正な値が ${badTimeCount} 件あります（HH:MM 形式で入力してください）`);

    timetable.forEach(row => {
      let prev = -1;
      stopCols.forEach(col => {
        const val = row[col];
        if (!val) return;
        const t = parseTimeMin(val);
        if (t !== null && t < prev) warnings.push(`便「${row.trip_name}」で時刻が逆行しています（${col}: ${val}）`);
        if (t !== null) prev = t;
      });
    });
  }

  const noLatLon = stops.filter(r => !r.stop_lat || !r.stop_lon);
  if (noLatLon.length) warnings.push(`緯度経度が空欄の停留所が ${noLatLon.length} 件あります（shapes.txt は未設定停留所を除外します）`);

  routes.forEach(r => {
    if (!r.route_color) warnings.push(`routes.csv の route_id「${r.route_id}」に route_color が設定されていません`);
  });

  const withNotes = [...routes, ...stops, ...timetable, ...calendar].filter(r => r.notes && r.notes.trim());
  if (withNotes.length) warnings.push(`notes 列に未確認情報が ${withNotes.length} 件あります。内容を確認してください`);

  renderValidation(errors, warnings, resultsContainerId);
  updateWarningNotice(errors, warnings, warningNoticeId);
  return { errors, warnings };
}

function renderValidation(errors, warnings, containerId) {
  const container = document.getElementById(containerId || 'validation-results');
  if (!container) return;
  let html = '';
  if (errors.length === 0 && warnings.length === 0) {
    html = '<div class="val-item val-ok">✅ 検査OK — すべてのチェックを通過しました</div>';
  }
  errors.forEach(e => { html += `<div class="val-item val-error">❌ エラー: ${esc(e)}</div>`; });
  warnings.forEach(w => { html += `<div class="val-item val-warn">⚠️ 警告: ${esc(w)}</div>`; });
  container.innerHTML = html;
}

function updateWarningNotice(errors, warnings, noticeId) {
  const notice = document.getElementById(noticeId || 'maker-warning-notice');
  if (!notice) return;
  if (warnings.length > 0 && errors.length === 0) {
    notice.textContent = `⚠️ ${warnings.length} 件の警告があります。確認のうえ、生成を実行してください。`;
    notice.classList.remove('hidden');
  } else {
    notice.classList.add('hidden');
  }
}

// ---------- Preview table ----------
let currentPreview = 'routes';

function renderPreview(key) {
  const wrap = document.getElementById('preview-table-wrap');
  if (!wrap) return;
  const data = csvData[key];
  if (!data || data.length === 0) { wrap.innerHTML = '<p class="no-data">データなし</p>'; return; }
  const cols = Object.keys(data[0]);
  const rows = data.slice(0, 20);
  let html = '<div class="table-scroll"><table class="preview-table"><thead><tr>';
  cols.forEach(c => { html += `<th>${esc(c)}</th>`; });
  html += '</tr></thead><tbody>';
  rows.forEach(row => {
    html += '<tr>';
    cols.forEach(c => { html += `<td>${esc(row[c] ?? '')}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  if (data.length > 20) html += `<p class="preview-note">先頭20行を表示（全${data.length}行）</p>`;
  wrap.innerHTML = html;
}

function onAllCSVCheck() {
  const allLoaded = csvData.routes && csvData.stops && csvData.timetable && csvData.calendar;
  const anyLoaded = Object.values(csvData).some(Boolean);

  const previewSection = document.getElementById('maker-preview-section');
  if (previewSection) {
    previewSection.classList.toggle('hidden', !anyLoaded);
    if (anyLoaded) renderPreview(currentPreview);
  }

  const validationSection = document.getElementById('maker-validation-section');
  if (validationSection) {
    validationSection.classList.toggle('hidden', !allLoaded);
  }

  if (allLoaded) {
    runValidation('validation-results', null);
  }
}

// ---------- AI CSV extraction ----------
function extractCsvBlocksFromText(text) {
  const result = { routes: null, stops: null, timetable: null, calendar: null };
  const blocks = [];

  const re = /```(?:csv)?\r?\n([\s\S]+?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push(m[1].trim());
  }

  if (!blocks.length) {
    const sections = text.split(/\n{2,}/);
    sections.forEach(sec => {
      const lines = sec.trim().split('\n');
      if (lines.length >= 2 && lines[0].includes(',')) blocks.push(sec.trim());
    });
  }

  for (const block of blocks) {
    if (!block.trim()) continue;
    const firstLine = block.split('\n')[0].toLowerCase();
    if (firstLine.includes('route_short_name') || (firstLine.includes('route_id') && !firstLine.includes('service_id') && !firstLine.includes('stop_sequence') && !firstLine.includes('trip_name'))) {
      if (!result.routes) result.routes = parseTextToCsvRows(block);
    } else if (firstLine.includes('stop_id') && firstLine.includes('stop_name')) {
      if (!result.stops) result.stops = parseTextToCsvRows(block);
    } else if (firstLine.includes('trip_name') || (firstLine.includes('service_id') && firstLine.includes('route_id') && !firstLine.includes('monday'))) {
      if (!result.timetable) result.timetable = parseTextToCsvRows(block);
    } else if (firstLine.includes('monday') || (firstLine.includes('service_id') && firstLine.includes('start_date'))) {
      if (!result.calendar) result.calendar = parseTextToCsvRows(block);
    }
  }

  return result;
}

function parseTextToCsvRows(text) {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  return result.data;
}

// ---------- STEP 1: AI Prompt & Templates ----------
function initStep1() {
  const promptEl = document.getElementById('ai-prompt');
  const copyBtn  = document.getElementById('copy-prompt-btn');

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(promptEl.textContent);
      copyBtn.textContent = '✅ コピーしました';
      setTimeout(() => { copyBtn.textContent = '📋 プロンプトをコピー'; }, 2000);
    } catch {
      copyBtn.textContent = '❌ コピー失敗';
      setTimeout(() => { copyBtn.textContent = '📋 プロンプトをコピー'; }, 2000);
    }
  });

  const TEMPLATES = {
    routes:    `route_id,agency_id,route_short_name,route_long_name,route_type,route_color,notes\nR001,A001,北回り,○○町コミュニティバス 北回り,3,2E86DE,\nR002,A001,南回り,○○町コミュニティバス 南回り,3,E8A838,`,
    stops:     `stop_id,stop_name,stop_lat,stop_lon,notes\nS001,市役所前,35.000000,139.000000,\nS002,文化センター前,35.001000,139.002000,\nS003,病院前,35.003000,139.004000,`,
    timetable: `trip_name,route_id,service_id,direction_id,stop_id,stop_sequence,arrival_time,departure_time\n第1便,R001,weekday,0,S001,1,08:00:00,08:00:00\n第1便,R001,weekday,0,S002,2,08:05:00,08:05:00\n第1便,R001,weekday,0,S003,3,08:12:00,08:12:00\n第2便,R001,weekday,0,S001,1,09:00:00,09:00:00\n第2便,R001,weekday,0,S002,2,09:05:00,09:05:00\n第2便,R001,weekday,0,S003,3,09:12:00,09:12:00`,
    calendar:  `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date,notes\nweekday,1,1,1,1,1,0,0,20260401,20270331,\nsaturday,0,0,0,0,0,1,0,20260401,20270331,\nholiday,0,0,0,0,0,0,1,20260401,20270331,`,
  };

  document.querySelectorAll('.btn-template[data-template]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.template;
      downloadCSV(key, TEMPLATES[key]);
    });
  });

  document.getElementById('dl-all-templates-btn')?.addEventListener('click', () => {
    Object.entries(TEMPLATES).forEach(([k, v]) => downloadCSV(k, v));
  });

  // AI paste & extract
  document.getElementById('ai-paste-clear-btn')?.addEventListener('click', () => {
    const area = document.getElementById('ai-paste-area');
    if (area) area.value = '';
    const result = document.getElementById('ai-extract-result');
    if (result) { result.innerHTML = ''; result.classList.add('hidden'); }
  });

  document.getElementById('ai-extract-btn')?.addEventListener('click', () => {
    const text = document.getElementById('ai-paste-area')?.value || '';
    if (!text.trim()) {
      alert('AIの出力テキストを貼り付けてください。');
      return;
    }

    const extracted = extractCsvBlocksFromText(text);
    const resultEl = document.getElementById('ai-extract-result');
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '';

    const keys = ['routes', 'stops', 'timetable', 'calendar'];
    let anyFound = false;
    keys.forEach(key => {
      if (extracted[key] && extracted[key].length > 0) {
        csvData[key] = extracted[key];
        anyFound = true;
        resultEl.innerHTML += `<span class="extract-chip ok">✅ ${key}.csv (${extracted[key].length}行)</span>`;
      } else {
        resultEl.innerHTML += `<span class="extract-chip err">⚠ ${key}.csv 未検出</span>`;
      }
    });

    if (anyFound) {
      // Update calendar norm warnings
      if (csvData.calendar) {
        const norm = normalizeCalendarRows(csvData.calendar);
        calendarNormWarnings = norm.warnings;
      }
      onAllCSVCheck();
      switchTab('tab-step2');
      const notice = document.getElementById('step2-ai-notice');
      if (notice) notice.classList.remove('hidden');
    }
  });
}

// ---------- STEP 2: CSV upload & preview ----------
function initStep2() {
  const BULK_KEYS = ['routes', 'stops', 'timetable', 'calendar'];
  const bulkZone   = document.getElementById('bulk-drop-zone');
  const bulkInput  = document.getElementById('input-bulk');
  const bulkStatus = document.getElementById('bulk-status');

  function loadCSVFile(key, file) {
    if (!file) return;
    const statusEl = document.getElementById(`status-${key}`);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: result => {
        csvData[key] = result.data;
        let notice = '';
        if (key === 'calendar') {
          const norm = normalizeCalendarRows(result.data);
          calendarNormWarnings = norm.warnings;
          if (norm.warnings.length) {
            notice = ' <span class="csv-warn">⚠️ end_date 自動補完あり</span>';
          }
        }
        if (statusEl) statusEl.innerHTML = `<span class="csv-ok">✅ ${esc(file.name)}（${result.data.length}行）</span>${notice}`;

        const uploadCard = document.getElementById(`upload-${key}`);
        if (uploadCard) uploadCard.classList.add('loaded');

        onAllCSVCheck();
      },
      error: () => {
        if (statusEl) statusEl.innerHTML = `<span class="csv-err">❌ 読み込みエラー</span>`;
      }
    });
  }

  function handleBulkFiles(files) {
    const matched = {};
    const unmatched = [];

    Array.from(files).forEach(file => {
      const base = file.name.replace(/\.csv$/i, '').toLowerCase();
      if (BULK_KEYS.includes(base)) {
        matched[base] = file;
      } else {
        unmatched.push(file.name);
      }
    });

    if (Object.keys(matched).length === 0) {
      if (bulkStatus) {
        bulkStatus.innerHTML = `<span class="bulk-chip err">❌ routes / stops / timetable / calendar のいずれにも一致するファイルがありません</span>`;
      }
      return;
    }

    for (const [key, file] of Object.entries(matched)) {
      loadCSVFile(key, file);
    }

    if (bulkStatus) {
      let chips = BULK_KEYS.map(k =>
        matched[k]
          ? `<span class="bulk-chip ok">✅ ${k}.csv</span>`
          : `<span class="bulk-chip err">未選択: ${k}.csv</span>`
      ).join('');
      if (unmatched.length) chips += `<span class="bulk-chip err">⚠ 未認識: ${unmatched.join(', ')}</span>`;
      bulkStatus.innerHTML = chips;
    }

    if (BULK_KEYS.every(k => matched[k]) && bulkZone) {
      bulkZone.classList.add('all-loaded');
    }
  }

  bulkInput?.addEventListener('change', e => handleBulkFiles(e.target.files));

  if (bulkZone) {
    bulkZone.addEventListener('dragover', e => { e.preventDefault(); bulkZone.classList.add('drag-over'); });
    bulkZone.addEventListener('dragleave', () => bulkZone.classList.remove('drag-over'));
    bulkZone.addEventListener('drop', e => {
      e.preventDefault();
      bulkZone.classList.remove('drag-over');
      handleBulkFiles(e.dataTransfer.files);
    });
    bulkZone.addEventListener('click', e => {
      if (e.target !== bulkInput && !e.target.closest('label')) {
        bulkInput?.click();
      }
    });
    bulkZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bulkInput?.click(); }
    });
  }

  BULK_KEYS.forEach(key => {
    const input = document.getElementById(`input-${key}`);
    if (!input) return;
    input.addEventListener('change', e => loadCSVFile(key, e.target.files[0]));
  });

  // Preview tabs
  document.querySelectorAll('.preview-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preview-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPreview = btn.dataset.preview;
      renderPreview(currentPreview);
    });
  });

  // Re-render preview if we arrive at step2 with data already loaded (from AI extraction)
  document.addEventListener('tabChange', e => {
    if (e.detail.tabId === 'tab-step2') {
      onAllCSVCheck();
    }
  });
}

// ---------- STEP 4: Agency info + generate ----------
function initStep4() {
  let generatedZipBlob = null;

  const generateBtn = document.getElementById('generate-btn');
  const makerLog    = document.getElementById('maker-log');
  const makerError  = document.getElementById('maker-error');
  const dlGroup     = document.getElementById('maker-download-group');
  const dlGtfsBtn   = document.getElementById('download-gtfs-btn');
  const nextStep    = document.getElementById('maker-next-step');

  function log(msg) {
    if (!makerLog) return;
    makerLog.classList.remove('hidden');
    const line = document.createElement('div');
    line.textContent = msg;
    makerLog.appendChild(line);
    makerLog.scrollTop = makerLog.scrollHeight;
  }

  // Show validation on step4 tab
  document.addEventListener('tabChange', e => {
    if (e.detail.tabId === 'tab-step4') {
      const allLoaded = csvData.routes && csvData.stops && csvData.timetable && csvData.calendar;
      const sec = document.getElementById('maker-validation-section-step4');
      if (sec) sec.classList.toggle('hidden', !allLoaded);
      if (allLoaded) {
        runValidation('validation-results-step4', 'maker-warning-notice');
      }
    }
  });

  generateBtn?.addEventListener('click', async () => {
    // Validate first
    const allLoaded = csvData.routes && csvData.stops && csvData.timetable && csvData.calendar;
    if (!allLoaded) {
      if (makerError) {
        makerError.textContent = '❌ STEP 2 で4つのCSVをすべて読み込んでください。';
        makerError.classList.remove('hidden');
      }
      return;
    }

    // agency fields are optional — defaults are applied in makeAgencyTxt()

    generateBtn.disabled = true;
    if (makerLog) { makerLog.classList.remove('hidden'); makerLog.innerHTML = ''; }
    if (makerError) makerError.classList.add('hidden');
    if (dlGroup) dlGroup.classList.add('hidden');
    if (nextStep) nextStep.classList.add('hidden');
    generatedZipBlob = null;

    try {
      const zip = new JSZip();
      const routes    = csvData.routes;
      const stops     = csvData.stops;
      const timetable = csvData.timetable;
      const calendar  = csvData.calendar;
      const stopCols  = getStopCols(timetable);

      const norm = normalizeCalendarRows(calendar);
      if (norm.errors.length) {
        throw new Error('calendar.csv にエラーがあります:\n' + norm.errors.join('\n'));
      }

      log('agency.txt を生成中...');
      zip.file('agency.txt', makeAgencyTxt());
      log('routes.txt を生成中...');
      zip.file('routes.txt', makeRoutesTxt(routes));
      log('stops.txt を生成中...');
      zip.file('stops.txt', makeStopsTxt(stops));
      log('trips.txt / stop_times.txt を生成中...');
      const { tripsTxt, stopTimesTxt } = makeTripsAndStopTimes(timetable, stopCols, stops);
      zip.file('trips.txt', tripsTxt);
      zip.file('stop_times.txt', stopTimesTxt);
      log('calendar.txt を生成中...');
      zip.file('calendar.txt', makeCalendarTxt(calendar));
      log('calendar_dates.txt を生成中（空ファイル）...');
      zip.file('calendar_dates.txt', 'service_id,date,exception_type\n');
      log('shapes.txt を生成中...');
      zip.file('shapes.txt', makeShapesTxt(routes, stops, stopCols, timetable));
      log('feed_info.txt を生成中...');
      zip.file('feed_info.txt', makeFeedInfoTxt());
      log('ZIPをパック中...');
      generatedZipBlob = await zip.generateAsync({ type: 'blob' });
      log('✅ 生成完了！');

      if (dlGroup) dlGroup.classList.remove('hidden');
      if (nextStep) nextStep.classList.remove('hidden');
    } catch (e) {
      if (makerError) {
        makerError.textContent = '❌ 生成中にエラーが発生しました: ' + e.message;
        makerError.classList.remove('hidden');
      }
    } finally {
      generateBtn.disabled = false;
    }
  });

  dlGtfsBtn?.addEventListener('click', () => {
    if (!generatedZipBlob) return;
    const url = URL.createObjectURL(generatedZipBlob);
    const a = document.createElement('a');
    a.href = url; a.download = 'gtfs-jp.zip'; a.click();
    URL.revokeObjectURL(url);
  });
}

// ---------- Bootstrap ----------
document.addEventListener('DOMContentLoaded', () => {
  initStep1();
  initStep2();
  initStep4();
});
