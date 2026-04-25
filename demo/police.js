'use strict';

// ── 警察が追記するフィールド定義 ─────────────────────────────
const POLICE_FIELDS = [
  {
    key: 'ps_status', label: '照会状況', type: 'select', required: true,
    options: ['未照会', '照会済（該当なし）', '盗難届あり', '持ち主判明', '持ち主返還済み', '廃棄処分', '保管中'],
  },
  { key: 'ps_reportNo',   label: '盗難届受理番号',   type: 'text',     placeholder: '例: 第12345号' },
  { key: 'ps_returnDate', label: '持ち主への返還日', type: 'date' },
  { key: 'ps_station',    label: '受理警察署',       type: 'text',     placeholder: '例: ○○警察署' },
  { key: 'ps_officer',    label: '担当者名',         type: 'text',     placeholder: '例: 山田 太郎' },
  { key: 'ps_memo',       label: '処理メモ',         type: 'textarea', placeholder: '処理に関するメモを入力（任意）' },
];

// 作業員CSVの列インデックス（exportCSV のヘッダー順に対応）
const W = {
  ID: 0, DATETIME: 1, REG_NO: 2, HAS_REG: 3, CONDITION: 4,
  COND_NOTE: 5, LAT: 6, LNG: 7, GPS_ACC: 8, LOC_NOTE: 9,
  STORAGE: 10, STORAGE_ADDR: 11, NOTES: 12, SYNCED: 13, CREATED: 14,
};

// ── 状態 ─────────────────────────────────────────────────────
let state = {
  headers: [],
  cases: [],     // [{row: string[], police: {}, status: 'pending'|'done'}]
  idx: 0,
  filename: '',
};

// ── localStorage 永続化 ─────────────────────────────────────
function saveSession() {
  try {
    localStorage.setItem('police_session', JSON.stringify({
      headers: state.headers,
      cases: state.cases,
      filename: state.filename,
    }));
  } catch(e) { console.warn('保存失敗:', e); }
}

function loadSession() {
  try {
    const raw = localStorage.getItem('police_session');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.cases) || !s.cases.length) return false;
    state.headers  = s.headers  || [];
    state.cases    = s.cases;
    state.filename = s.filename || '';
    return true;
  } catch { return false; }
}

// ── CSV パーサー ─────────────────────────────────────────────
function parseLine(line) {
  const res = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { res.push(cur); cur = ''; }
    else cur += c;
  }
  res.push(cur);
  return res;
}

function parseCSV(text) {
  const t = text.replace(/^﻿/, '');
  const lines = t.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

// ── CSV 書き出し（作業員列 ＋ 警察列） ──────────────────────
function buildAugmentedCSV() {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const policeHeaders = POLICE_FIELDS.map(f => f.label);
  const allHeaders = [...state.headers, ...policeHeaders];
  const rows = state.cases.map(c => {
    const policeCols = POLICE_FIELDS.map(f => c.police[f.key] ?? '');
    return [...c.row, ...policeCols];
  });
  return [allHeaders, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
}

// ── ユーティリティ ──────────────────────────────────────────
const $ = id => document.getElementById(id);
let _toastTimer;
function toast(msg, dur = 2800) {
  const el = $('pToast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}
const escH = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── ビュー切り替え ──────────────────────────────────────────
const VIEWS = ['viewImport', 'viewList', 'viewDetail'];
function showView(name) {
  VIEWS.forEach(id => { $(id).style.display = id === name ? '' : 'none'; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── 進捗 ────────────────────────────────────────────────────
function updateProgress() {
  const total = state.cases.length;
  const done = state.cases.filter(c => c.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('pProgressFill').style.width = pct + '%';
  $('pProgressLabel').textContent = `${done} / ${total} 件処理済`;
}

// ── ケース一覧 レンダリング ─────────────────────────────────
function renderList() {
  $('pListFilename').textContent = state.filename ? `📄 ${state.filename}` : '';
  updateProgress();

  const html = state.cases.map((c, i) => {
    const row = c.row;
    const regNo   = row[W.REG_NO]  || '（番号なし）';
    const hasReg  = row[W.HAS_REG] || '';
    const dt      = row[W.DATETIME] || '';
    const storage = row[W.STORAGE]  || '';
    const isDone  = c.status === 'done';

    let regBadge = '';
    if (hasReg === 'あり')     regBadge = '<span class="badge reg-yes">登録あり</span>';
    else if (hasReg === 'なし') regBadge = '<span class="badge reg-no">登録なし</span>';
    else                        regBadge = '<span class="badge reg-unk">不明</span>';

    const statusBadge = isDone
      ? '<span class="badge done">✅ 処理済み</span>'
      : '<span class="badge pending">⏳ 未処理</span>';

    return `
      <div class="p-case-card${isDone ? ' done' : ''}" onclick="openCase(${i})">
        <div class="p-case-num">#${i + 1}</div>
        <div class="p-case-body">
          <div class="p-case-reg">${escH(regNo)}</div>
          <div class="p-case-meta">${escH(dt)}　${escH(storage)}</div>
          <div class="p-case-badges">${regBadge}${statusBadge}</div>
        </div>
        <div class="p-case-arrow">›</div>
      </div>`;
  }).join('');

  $('pCaseList').innerHTML = html || '<p class="p-muted">ケースがありません。</p>';
  showView('viewList');
}

// ── ケース詳細 レンダリング ─────────────────────────────────
window.openCase = function(i) {
  state.idx = i;
  renderDetail();
};

function renderDetail() {
  const i = state.idx;
  const total = state.cases.length;
  const c = state.cases[i];
  const row = c.row;

  $('pCaseNavLabel').textContent = `${i + 1} / ${total}`;
  $('pPrevCaseBtn').disabled = i === 0;
  $('pNextCaseBtn').disabled = i === total - 1;

  // 地図リンク（GPS あれば）
  const lat = row[W.LAT], lng = row[W.LNG];
  const mapsHtml = (lat && lng && lat !== '')
    ? `<a href="https://maps.google.com/?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}" target="_blank" rel="noopener">📍 地図で確認 →</a>`
    : '（位置情報なし）';

  // 作業員情報（読み取り専用）
  const workerFields = [
    { label: '管理ID',   val: row[W.ID] },
    { label: '回収日時', val: row[W.DATETIME] },
    { label: '防犯登録', val: row[W.HAS_REG] },
    { label: '登録番号', val: row[W.REG_NO] || '（なし）', bold: true },
    { label: '車体状況', val: row[W.CONDITION] },
    { label: '状況備考', val: row[W.COND_NOTE] },
    { label: '場所目印', val: row[W.LOC_NOTE] },
    { label: '保管場所', val: row[W.STORAGE] },
    { label: '保管住所', val: row[W.STORAGE_ADDR] },
    { label: 'GPS',      val: mapsHtml, raw: true },
    { label: '備考',     val: row[W.NOTES] },
  ].filter(f => f.val);

  const workerHtml = workerFields.map(f => `
    <div class="p-info-row">
      <span class="p-info-label">${f.label}</span>
      <span class="p-info-val${f.bold ? ' bold' : ''}">${f.raw ? f.val : escH(f.val)}</span>
    </div>`).join('');

  // 警察フォーム
  const policeHtml = POLICE_FIELDS.map(f => {
    const val = c.police[f.key] ?? '';
    let input = '';
    if (f.type === 'select') {
      const opts = f.options.map(o =>
        `<option value="${escH(o)}"${val === o ? ' selected' : ''}>${escH(o)}</option>`
      ).join('');
      input = `<select id="pf_${f.key}" data-key="${f.key}">
        <option value="">-- 選択してください --</option>${opts}
      </select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="pf_${f.key}" rows="3" placeholder="${escH(f.placeholder || '')}">${escH(val)}</textarea>`;
    } else {
      input = `<input type="${f.type}" id="pf_${f.key}" value="${escH(val)}" placeholder="${escH(f.placeholder || '')}" />`;
    }
    const req = f.required ? '<span class="req">*</span>' : '';
    return `<div class="p-field"><label>${escH(f.label)}${req}</label>${input}</div>`;
  }).join('');

  $('pDetailContent').innerHTML = `
    <div class="p-info-card">
      <div class="p-info-card-header">📋 作業員記録情報（読み取り専用）</div>
      <div class="p-info-rows">${workerHtml}</div>
    </div>
    <div class="p-police-card">
      <div class="p-police-card-header">👮 警察処理情報を入力</div>
      <div class="p-police-form">${policeHtml}</div>
    </div>`;

  showView('viewDetail');
}

// フォームから police データを収集
function collectPoliceData() {
  const police = {};
  POLICE_FIELDS.forEach(f => {
    const el = document.getElementById(`pf_${f.key}`);
    police[f.key] = el ? el.value : '';
  });
  return police;
}

// ── CSV インポート ───────────────────────────────────────────
function importCSV(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseCSV(e.target.result);
    if (!parsed || !parsed.rows.length) {
      toast('⚠️ 有効なデータが見つかりません'); return;
    }
    state.headers  = parsed.headers;
    state.cases    = parsed.rows.map(row => ({
      row,
      police: { ps_status: '未照会' },
      status: 'pending',
    }));
    state.idx      = 0;
    state.filename = file.name;
    saveSession();
    toast(`✅ ${state.cases.length}件を読み込みました`);
    renderList();
  };
  reader.readAsText(file, 'UTF-8');
}

// ── イベント バインド ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // ── Import view ──
  $('pImportBtn').addEventListener('click', () => $('pFileInput').click());

  $('pFileInput').addEventListener('change', e => {
    importCSV(e.target.files[0]);
    e.target.value = '';
  });

  // Drag & drop
  const dropZone = $('dropZone');
  dropZone.addEventListener('dragover', e => {
    e.preventDefault(); dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.csv')) importCSV(file);
    else toast('⚠️ .csv ファイルをドロップしてください');
  });

  $('pLoadSavedBtn').addEventListener('click', () => {
    if (loadSession() && state.cases.length) {
      renderList();
    } else {
      toast('⚠️ 保存済みのセッションが見つかりません');
    }
  });

  // ── List view ──
  $('pNewImportBtn').addEventListener('click', () => {
    if (!confirm('現在の作業を破棄して新しいCSVを読み込みますか？')) return;
    localStorage.removeItem('police_session');
    state = { headers: [], cases: [], idx: 0, filename: '' };
    showView('viewImport');
  });

  $('pDownloadBtn').addEventListener('click', () => {
    if (!state.cases.length) { toast('⚠️ データがありません'); return; }
    const csv = buildAugmentedCSV();
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `police_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`✅ CSVをダウンロードしました`);
  });

  // ── Detail view ──
  $('pBackToListBtn').addEventListener('click', renderList);

  $('pPrevCaseBtn').addEventListener('click', () => {
    if (state.idx > 0) { state.idx--; renderDetail(); }
  });

  $('pNextCaseBtn').addEventListener('click', () => {
    if (state.idx < state.cases.length - 1) { state.idx++; renderDetail(); }
  });

  $('pSaveCaseBtn').addEventListener('click', () => {
    const c = state.cases[state.idx];
    c.police = collectPoliceData();
    c.status = 'done';
    saveSession();
    toast('✅ 保存しました');

    if (state.idx < state.cases.length - 1) {
      state.idx++;
      renderDetail();
    } else {
      toast('✅ 全件処理完了！一覧に戻ります', 2000);
      setTimeout(renderList, 1800);
    }
  });

  $('pSkipCaseBtn').addEventListener('click', () => {
    if (state.idx < state.cases.length - 1) { state.idx++; renderDetail(); }
    else renderList();
  });
});
