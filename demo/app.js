'use strict';

// ── 設定 ──────────────────────────────────────────
const STORAGE_LOCATIONS = [
  { id: 'A', name: '保管場所A', address: '東京都○○区○○1丁目1-1（第一駐輪センター）' },
  { id: 'B', name: '保管場所B', address: '東京都○○区○○2丁目2-2（第二駐輪センター）' },
  { id: 'C', name: '保管場所C', address: '東京都○○区○○3丁目3-3（第三保管場）' },
  { id: 'D', name: '保管場所D', address: '東京都○○区○○4丁目4-4（臨時保管場）' },
];

const CONDITION_OPTIONS = [
  '良好', '一部損傷', '大破', '錆が多い',
  '施錠あり', 'カゴなし', 'タイヤパンク', 'ライトなし',
  '放置ステッカーあり', '泥・汚れ多い',
];

// ── IndexedDB ─────────────────────────────────────
const DB_NAME = 'bicycle_recovery';
const DB_VER = 1;
const STORE = 'recoveries';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const s = d.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('collectedAt', 'collectedAt', { unique: false });
        s.createIndex('synced', 'synced', { unique: false });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function txStore(mode = 'readonly') {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const req = txStore().getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const req = txStore('readwrite').put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const req = txStore('readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── UUID ──────────────────────────────────────────
function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ── 画像リサイズ ───────────────────────────────────
function resizeImage(file, maxPx = 1200) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = url;
  });
}

// ── OCR ───────────────────────────────────────────
async function runOCR(dataUrl) {
  setOcrStatus('loading', '⏳ 文字認識中…（数秒かかります）');
  try {
    const worker = await Tesseract.createWorker('jpn+eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          setOcrStatus('loading', `⏳ 認識中… ${pct}%`);
        }
      },
    });
    const { data: { text } } = await worker.recognize(dataUrl);
    await worker.terminate();

    // 番号っぽいパターンを抽出（数字・ハイフン・スペース、都道府県名含む）
    const cleaned = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    // 防犯登録番号：都道府県名 + 数字 or 数字のみ
    const match = cleaned.match(/([都道府県]?[^\d]*\d[\d\-\s]{4,})/);
    const extracted = match ? match[0].trim() : cleaned.slice(0, 30);

    setOcrStatus('done', `✅ 認識完了。下の入力欄を確認・修正してください。`);
    return extracted;
  } catch (err) {
    setOcrStatus('error', `⚠️ 認識失敗: ${err.message}。手動で入力してください。`);
    return '';
  }
}

function setOcrStatus(type, msg) {
  const el = document.getElementById('ocrStatus');
  el.className = `ocr-status ${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Toast ─────────────────────────────────────────
let toastTimer = null;
function toast(msg, dur = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ── State ─────────────────────────────────────────
const state = {
  hasReg: 'yes',
  photoDataUrl: null,
  lat: null,
  lng: null,
  locationAccuracy: null,
};

// ── DOM helpers ───────────────────────────────────
const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  await openDB();
  buildConditionGrid();
  buildStorageOptions();
  initNav();
  initRegSection();
  initPhotoCapture();
  initGeolocation();
  initSave();
  initList();
  initExport();
  initModal();
  setDefaultDatetime();
  updateSyncBadge();
  window.addEventListener('online', updateSyncBadge);
  window.addEventListener('offline', updateSyncBadge);
});

function updateSyncBadge() {
  const el = $('syncBadge');
  if (navigator.onLine) {
    el.textContent = '● オンライン';
    el.className = 'sync-badge online';
  } else {
    el.textContent = '● オフライン';
    el.className = 'sync-badge offline';
  }
}

// ── Tab nav ───────────────────────────────────────
function initNav() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`${page}Page`).classList.add('active');
      if (page === 'list') renderList();
      if (page === 'export') renderExportSummary();
    });
  });
}

// ── 防犯登録セクション ───────────────────────────
function initRegSection() {
  document.querySelectorAll('#hasRegCtrl .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#hasRegCtrl .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.hasReg = btn.dataset.value;
      $('regSection').style.display = state.hasReg === 'yes' ? 'block' : 'none';
    });
  });
}

// ── 写真撮影・OCR ──────────────────────────────────
function initPhotoCapture() {
  $('shootBtn').addEventListener('click', () => $('photoInput').click());
  $('retakeBtn').addEventListener('click', () => {
    state.photoDataUrl = null;
    $('photoPreview').style.display = 'none';
    $('photoPlaceholder').style.display = 'flex';
    $('retakeBtn').style.display = 'none';
    $('shootBtn').style.display = 'block';
    $('ocrStatus').style.display = 'none';
    $('regNumber').value = '';
  });

  $('photoInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    const dataUrl = await resizeImage(file);
    state.photoDataUrl = dataUrl;

    const canvas = $('photoPreview');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      canvas.style.display = 'block';
      $('photoPlaceholder').style.display = 'none';
      $('retakeBtn').style.display = 'flex';
      $('shootBtn').style.display = 'none';
    };
    img.src = dataUrl;

    // OCR
    const text = await runOCR(dataUrl);
    if (text) $('regNumber').value = text;
    // reset file input so same file can be re-selected
    e.target.value = '';
  });
}

// ── 位置情報 ──────────────────────────────────────
function initGeolocation() {
  $('getLocationBtn').addEventListener('click', () => {
    if (!navigator.geolocation) {
      showLocationStatus('error', '位置情報APIが使用できません。');
      return;
    }
    showLocationStatus('loading', '⏳ 位置情報を取得中…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.lat = pos.coords.latitude;
        state.lng = pos.coords.longitude;
        state.locationAccuracy = Math.round(pos.coords.accuracy);
        const link = `https://maps.google.com/?q=${state.lat},${state.lng}`;
        showLocationStatus('ok', `✅ 取得完了（精度: ±${state.locationAccuracy}m）\n緯度: ${state.lat.toFixed(6)} / 経度: ${state.lng.toFixed(6)}`);
        const a = $('mapsLink');
        a.href = link;
        a.style.display = 'inline';
        toast('位置情報を取得しました');
      },
      err => {
        showLocationStatus('error', `取得失敗: ${err.message}。手動で住所を入力してください。`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function showLocationStatus(type, msg) {
  const el = $('locationStatus');
  el.className = `location-status ${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}

// ── 保管場所 ──────────────────────────────────────
function buildStorageOptions() {
  const sel = $('storageLocation');
  const filterSel = $('filterStorage');
  STORAGE_LOCATIONS.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = `${loc.name}（${loc.id}）`;
    sel.appendChild(opt);

    const fopt = opt.cloneNode(true);
    filterSel.appendChild(fopt);
  });
  sel.addEventListener('change', () => {
    const loc = STORAGE_LOCATIONS.find(l => l.id === sel.value);
    $('storageAddress').textContent = loc ? loc.address : '';
  });
}

// ── 車体状況チェックボックス ──────────────────────
function buildConditionGrid() {
  const grid = $('conditionGrid');
  CONDITION_OPTIONS.forEach(opt => {
    const label = document.createElement('label');
    label.className = 'cond-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = opt;
    cb.addEventListener('change', () => {
      label.classList.toggle('checked', cb.checked);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(opt));
    grid.appendChild(label);
  });
}

function getSelectedConditions() {
  return Array.from(document.querySelectorAll('#conditionGrid input:checked')).map(cb => cb.value);
}

// ── デフォルト日時 ────────────────────────────────
function setDefaultDatetime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  $('collectedAt').value = local.toISOString().slice(0, 16);
}

// ── 保存 ──────────────────────────────────────────
function initSave() {
  $('saveBtn').addEventListener('click', async () => {
    const collectedAt = $('collectedAt').value;
    const storageId = $('storageLocation').value;

    if (!collectedAt) { toast('⚠️ 回収日時を入力してください'); return; }
    if (!storageId) { toast('⚠️ 保管場所を選択してください'); return; }

    const storageLoc = STORAGE_LOCATIONS.find(l => l.id === storageId);
    const record = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      collectedAt: new Date(collectedAt).toISOString(),
      hasRegistration: state.hasReg,
      registrationNumber: state.hasReg === 'yes' ? ($('regNumber').value.trim() || '') : '',
      photoDataUrl: state.hasReg === 'yes' ? (state.photoDataUrl || null) : null,
      conditions: getSelectedConditions(),
      conditionNote: $('conditionNote').value.trim(),
      lat: state.lat,
      lng: state.lng,
      locationAccuracy: state.locationAccuracy,
      locationNote: $('locationNote').value.trim(),
      storageLocationId: storageId,
      storageLocationName: storageLoc ? storageLoc.name : '',
      storageLocationAddress: storageLoc ? storageLoc.address : '',
      notes: $('notes').value.trim(),
      synced: false,
    };

    try {
      await dbPut(record);
      toast('✅ 保存しました');
      resetForm();
    } catch (err) {
      toast(`❌ 保存失敗: ${err.message}`);
    }
  });
}

function resetForm() {
  state.hasReg = 'yes';
  state.photoDataUrl = null;
  state.lat = null;
  state.lng = null;
  state.locationAccuracy = null;

  document.querySelectorAll('#hasRegCtrl .seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  $('regSection').style.display = 'block';
  $('photoPreview').style.display = 'none';
  $('photoPlaceholder').style.display = 'flex';
  $('retakeBtn').style.display = 'none';
  $('shootBtn').style.display = 'block';
  $('ocrStatus').style.display = 'none';
  $('regNumber').value = '';
  document.querySelectorAll('#conditionGrid input').forEach(cb => {
    cb.checked = false;
    cb.closest('label').classList.remove('checked');
  });
  $('conditionNote').value = '';
  $('locationStatus').style.display = 'none';
  $('mapsLink').style.display = 'none';
  $('locationNote').value = '';
  $('storageLocation').value = '';
  $('storageAddress').textContent = '';
  $('notes').value = '';
  setDefaultDatetime();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── 一覧 ──────────────────────────────────────────
function initList() {
  $('searchInput').addEventListener('input', renderList);
  $('filterStorage').addEventListener('change', renderList);
}

async function renderList() {
  const records = await dbGetAll();
  const query = $('searchInput').value.toLowerCase();
  const filterLoc = $('filterStorage').value;

  const filtered = records
    .filter(r => {
      if (filterLoc && r.storageLocationId !== filterLoc) return false;
      if (query) {
        const haystack = [r.registrationNumber, r.locationNote, r.notes, r.storageLocationName].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));

  const list = $('recordList');
  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted center">該当するデータがありません。</p>';
    return;
  }

  list.innerHTML = filtered.map(r => {
    const badgeClass = r.hasRegistration === 'yes' ? 'ok' : r.hasRegistration === 'no' ? 'no' : 'unk';
    const badgeText = r.hasRegistration === 'yes' ? '登録あり' : r.hasRegistration === 'no' ? '登録なし' : '不明';
    const cardClass = r.hasRegistration === 'yes' ? 'has-reg' : r.hasRegistration === 'no' ? 'no-reg' : 'unknown-reg';
    const dt = new Date(r.collectedAt).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    const numText = r.registrationNumber ? r.registrationNumber : '（番号なし）';
    const condText = r.conditions.length ? r.conditions.join(' / ') : '';
    return `
      <div class="record-card ${cardClass}" data-id="${r.id}" onclick="openDetail('${r.id}')">
        <div class="rc-header">
          <span class="rc-num">${escHtml(numText)}</span>
          <span class="rc-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="rc-meta">
          <span>📅 ${dt}</span>
          <span>🏢 ${escHtml(r.storageLocationName)}</span>
          ${r.lat ? `<span>📍 GPS取得済み</span>` : ''}
          ${r.synced ? '<span>✅ 送信済</span>' : '<span>🕐 未送信</span>'}
        </div>
        ${condText ? `<div class="rc-conditions">${escHtml(condText)}</div>` : ''}
      </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 詳細モーダル ──────────────────────────────────
function initModal() {
  $('modalClose').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', closeModal);
}

function closeModal() {
  $('modal').style.display = 'none';
}

window.openDetail = async function(id) {
  const records = await dbGetAll();
  const r = records.find(x => x.id === id);
  if (!r) return;

  const hasRegText = { yes: 'あり', no: 'なし', unknown: '不明' }[r.hasRegistration] || '不明';
  const dt = new Date(r.collectedAt).toLocaleString('ja-JP');
  const mapsUrl = r.lat ? `https://maps.google.com/?q=${r.lat},${r.lng}` : null;

  $('modalContent').innerHTML = `
    <div class="detail-title">回収記録詳細</div>
    ${r.photoDataUrl ? `<img class="detail-photo" src="${r.photoDataUrl}" alt="防犯登録シール写真">` : ''}
    <div class="detail-row"><span class="detail-label">防犯登録</span><span class="detail-val">${hasRegText}</span></div>
    ${r.registrationNumber ? `<div class="detail-row"><span class="detail-label">登録番号</span><span class="detail-val">${escHtml(r.registrationNumber)}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">回収日時</span><span class="detail-val">${dt}</span></div>
    <div class="detail-row"><span class="detail-label">車体状況</span><span class="detail-val">${escHtml(r.conditions.join(', ') || '—')}</span></div>
    ${r.conditionNote ? `<div class="detail-row"><span class="detail-label">状況備考</span><span class="detail-val">${escHtml(r.conditionNote)}</span></div>` : ''}
    ${r.lat ? `<div class="detail-row"><span class="detail-label">GPS</span><span class="detail-val">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}<br><a href="${mapsUrl}" target="_blank">地図で確認</a></span></div>` : ''}
    ${r.locationNote ? `<div class="detail-row"><span class="detail-label">場所目印</span><span class="detail-val">${escHtml(r.locationNote)}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">保管場所</span><span class="detail-val">${escHtml(r.storageLocationName)}<br><small>${escHtml(r.storageLocationAddress)}</small></span></div>
    ${r.notes ? `<div class="detail-row"><span class="detail-label">備考</span><span class="detail-val">${escHtml(r.notes)}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">送信状態</span><span class="detail-val">${r.synced ? '✅ 送信済み' : '🕐 未送信'}</span></div>
    <br>
    <button class="btn-primary" style="width:100%" onclick="markSynced('${r.id}')">✅ 送信済みとしてマーク</button>
    <button class="btn-danger-outline" style="width:100%;margin-top:8px;" onclick="deleteRecord('${r.id}')">🗑 この記録を削除</button>
  `;
  $('modal').style.display = 'flex';
};

window.markSynced = async function(id) {
  const records = await dbGetAll();
  const r = records.find(x => x.id === id);
  if (!r) return;
  r.synced = true;
  await dbPut(r);
  toast('送信済みにマークしました');
  closeModal();
  renderList();
};

window.deleteRecord = async function(id) {
  if (!confirm('この記録を削除しますか？')) return;
  await dbDelete(id);
  toast('削除しました');
  closeModal();
  renderList();
};

// ── CSV出力 ───────────────────────────────────────
function initExport() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  $('exportFrom').value = monthAgo;
  $('exportTo').value = today;

  $('exportFrom').addEventListener('change', renderExportSummary);
  $('exportTo').addEventListener('change', renderExportSummary);
  $('exportBtn').addEventListener('click', () => exportCSV(false));
  $('exportAllBtn').addEventListener('click', () => exportCSV(true));
  $('clearSyncedBtn').addEventListener('click', clearSynced);
}

async function renderExportSummary() {
  const records = await dbGetAll();
  const { from, to } = getExportRange();
  const filtered = records.filter(r => inRange(r.collectedAt, from, to));
  const unsynced = filtered.filter(r => !r.synced).length;
  $('exportSummary').textContent = `期間内: ${filtered.length}件（未送信: ${unsynced}件）`;

  const total = records.length;
  const totalUnsynced = records.filter(r => !r.synced).length;
  $('storageInfo').innerHTML = `全件: ${total}件<br>未送信: ${totalUnsynced}件<br>送信済み: ${total - totalUnsynced}件`;
}

function getExportRange() {
  const from = $('exportFrom').value ? new Date($('exportFrom').value + 'T00:00:00') : null;
  const to = $('exportTo').value ? new Date($('exportTo').value + 'T23:59:59') : null;
  return { from, to };
}

function inRange(dateStr, from, to) {
  const d = new Date(dateStr);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

async function exportCSV(all = false) {
  const records = await dbGetAll();
  const { from, to } = getExportRange();
  const target = all ? records : records.filter(r => inRange(r.collectedAt, from, to));
  target.sort((a, b) => new Date(a.collectedAt) - new Date(b.collectedAt));

  if (target.length === 0) { toast('該当データがありません'); return; }

  const headers = [
    '管理ID', '回収日時', '登録番号', '防犯登録', '車体状況', '状況備考',
    '緯度', '経度', 'GPS精度(m)', '場所目印', '保管場所', '保管住所', '備考', '送信済み', '作成日時'
  ];

  const rows = target.map(r => [
    r.id,
    new Date(r.collectedAt).toLocaleString('ja-JP'),
    r.registrationNumber || '',
    { yes: 'あり', no: 'なし', unknown: '不明' }[r.hasRegistration] || '',
    r.conditions.join(' / '),
    r.conditionNote || '',
    r.lat != null ? r.lat.toFixed(6) : '',
    r.lng != null ? r.lng.toFixed(6) : '',
    r.locationAccuracy != null ? r.locationAccuracy : '',
    r.locationNote || '',
    r.storageLocationName || '',
    r.storageLocationAddress || '',
    r.notes || '',
    r.synced ? '済み' : '未',
    new Date(r.createdAt).toLocaleString('ja-JP'),
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const bom = '﻿'; // Excel用BOM
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = `bicycle_recovery_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`✅ ${target.length}件をCSV出力しました`);
}

async function clearSynced() {
  if (!confirm('送信済みとしてマークされたデータを全件削除しますか？\nこの操作は元に戻せません。')) return;
  const records = await dbGetAll();
  const synced = records.filter(r => r.synced);
  for (const r of synced) await dbDelete(r.id);
  toast(`${synced.length}件の送信済みデータを削除しました`);
  renderExportSummary();
}
