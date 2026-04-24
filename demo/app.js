'use strict';

const STORAGE_LOCATIONS = [
  { id: 'A', name: '保管場所A', address: '東京都○○区○○1丁目1-1（第一駐輪センター）' },
  { id: 'B', name: '保管場所B', address: '東京都○○区○○2丁目2-2（第二駐輪センター）' },
  { id: 'C', name: '保管場所C', address: '東京都○○区○○3丁目3-3（第三保管場）' },
  { id: 'D', name: '保管場所D', address: '東京都○○区○○4丁目4-4（臨時保管場）' },
];
const CONDITION_OPTIONS = ['良好','一部損傷','大破','錆が多い','施錠あり','カゴなし','タイヤパンク','ライトなし','放置ステッカーあり','泥・汚れ多い'];
const SV_CONDITION_OPTIONS = [
  { icon: '✅', label: '特に問題なし' },
  { icon: '🔧', label: '傷・へこみあり' },
  { icon: '💥', label: '大きく壊れている' },
  { icon: '🔒', label: '鍵がかかっている' },
  { icon: '🫧', label: 'タイヤがしぼんでいる' },
  { icon: '🟫', label: 'とても汚れている・錆びている' },
];

// ── IndexedDB ──────────────────────────────────
const DB_NAME = 'bicycle_recovery', DB_VER = 1, STORE = 'recoveries';
let db = null;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
const txStore = (mode='readonly') => db.transaction(STORE, mode).objectStore(STORE);
const dbGetAll = () => new Promise((res, rej) => { const r = txStore().getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbPut = rec => new Promise((res, rej) => { const r = txStore('readwrite').put(rec); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbDelete = id => new Promise((res, rej) => { const r = txStore('readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

function uuid() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16));
}
function resizeImage(file, maxPx=1200) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let w=img.width, h=img.height;
      if (w>maxPx||h>maxPx) { if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;} }
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg',.82));
    }; img.src=url;
  });
}
async function runOCR(dataUrl, statusCb) {
  statusCb?.('loading','⏳ 文字を読み取っています…少々お待ちください');
  try {
    const worker = await Tesseract.createWorker('jpn+eng', 1, {
      logger: m => { if(m.status==='recognizing text') statusCb?.('loading',`⏳ 読み取り中… ${Math.round((m.progress||0)*100)}%`); }
    });
    const { data: { text } } = await worker.recognize(dataUrl);
    await worker.terminate();
    const cleaned = text.replace(/\n/g,' ').replace(/\s+/g,' ').trim();
    const match = cleaned.match(/([都道府県]?[^\d]*\d[\d\-\s]{4,})/);
    const extracted = match ? match[0].trim() : cleaned.slice(0,30);
    statusCb?.('done','✅ 読み取り完了');
    return extracted;
  } catch(err) { statusCb?.('error','⚠️ 読み取り失敗。手動で入力してください。'); return ''; }
}

let toastTimer=null;
function toast(msg, dur=2800) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),dur);
}
const $=id=>document.getElementById(id);
const escHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── モード管理 ─────────────────────────────────
function getMode() { return localStorage.getItem('appMode') || 'normal'; }
function setMode(mode) {
  localStorage.setItem('appMode', mode);
  const isNormal = mode === 'normal';
  $('normalApp').style.display = isNormal ? 'block' : 'none';
  $('silverApp').style.display = isNormal ? 'none' : 'block';
  renderSettingsPages(mode);
  if (!isNormal) { svGoHome(); svRenderCurrentStep(); }
}

function renderSettingsPages(mode) {
  const html = (activeMode) => `
    <div class="${activeMode==='silver' ? 'sv-settings-wrap' : 'settings-section'}">
      <div class="${activeMode==='silver' ? 'sv-settings-title' : 'settings-title'}">⚙️ 設定</div>
      <div class="${activeMode==='silver' ? 'sv-settings-desc' : 'settings-desc'}">画面の種類を切り替えられます。</div>
      <div class="${activeMode==='silver' ? '' : ''}">
        <div class="current-mode-badge" style="${activeMode==='silver'?'font-size:0.9rem;padding:5px 14px;':''}">
          現在：${activeMode==='normal' ? '通常版' : 'シルバー版'}
        </div>
      </div>
      <div class="${activeMode==='silver' ? 'sv-mode-cards' : 'mode-cards'}">
        <button class="${activeMode==='silver' ? `sv-mode-card${mode==='normal'?' active-mode':''}` : `mode-card${mode==='normal'?' active-mode':''}`}" onclick="setMode('normal')">
          <span class="${activeMode==='silver'?'sv-mode-card-icon':'mode-card-icon'}">💻</span>
          <span>
            <div class="${activeMode==='silver'?'sv-mode-card-name':'mode-card-name'}">通常版</div>
            <div class="${activeMode==='silver'?'sv-mode-card-desc':'mode-card-desc'}">スタンダードな操作画面<br>CSV出力・検索機能つき</div>
          </span>
          ${mode==='normal' ? `<span class="${activeMode==='silver'?'sv-mode-card-check':'mode-card-check'}">✅</span>` : ''}
        </button>
        <button class="${activeMode==='silver' ? `sv-mode-card${mode==='silver'?' active-silver':''}` : `mode-card${mode==='silver'?' active-silver':''}`}" onclick="setMode('silver')">
          <span class="${activeMode==='silver'?'sv-mode-card-icon':'mode-card-icon'}">🌟</span>
          <span>
            <div class="${activeMode==='silver'?'sv-mode-card-name':'mode-card-name'}">シルバー版</div>
            <div class="${activeMode==='silver'?'sv-mode-card-desc':'mode-card-desc'}">大きな文字・ボタン<br>1ステップずつ丁寧に案内</div>
          </span>
          ${mode==='silver' ? `<span class="${activeMode==='silver'?'sv-mode-card-check':'mode-card-check'}">✅</span>` : ''}
        </button>
      </div>
    </div>`;
  const nSettings = $('nSettingsContent');
  const svSettings = $('svSettingsContent');
  if (nSettings) nSettings.innerHTML = html('normal');
  if (svSettings) svSettings.innerHTML = html('silver');
}

function updateSyncBadge() {
  ['syncBadge','svSyncBadge'].forEach(id => {
    const el=$(id); if(!el) return;
    if(navigator.onLine){el.textContent='● オンライン';el.className='sync-badge online';}
    else{el.textContent='● オフライン';el.className='sync-badge offline';}
  });
}

// ── 通常版 ─────────────────────────────────────
const ns = { hasReg:'yes', photoDataUrl:null, lat:null, lng:null, locationAccuracy:null };

function initNormalApp() {
  buildNormalConditionGrid();
  buildStorageSelects();
  initNormalNav();
  initRegSection();
  initPhotoCapture();
  initGeolocation();
  initSave();
  initList();
  initExport();
  setDefaultDatetime();
}

function initNormalNav() {
  document.querySelectorAll('.n-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.n-tab').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.n-page').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.nTab;
      $(`n${page.charAt(0).toUpperCase()+page.slice(1)}Tab`).classList.add('active');
      if(page==='list') renderList();
      if(page==='export') renderExportSummary();
    });
  });
}

function initRegSection() {
  document.querySelectorAll('#hasRegCtrl .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#hasRegCtrl .seg-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      ns.hasReg = btn.dataset.value;
      $('regSection').style.display = ns.hasReg==='yes' ? 'block' : 'none';
    });
  });
}

function initPhotoCapture() {
  $('shootBtn').addEventListener('click', ()=>$('photoInput').click());
  $('retakeBtn').addEventListener('click', ()=>{
    ns.photoDataUrl=null;
    $('photoPreview').style.display='none'; $('photoPlaceholder').style.display='flex';
    $('retakeBtn').style.display='none'; $('shootBtn').style.display='block';
    $('ocrStatus').style.display='none'; $('regNumber').value='';
  });
  $('photoInput').addEventListener('change', async e=>{
    const file=e.target.files[0]; if(!file) return;
    const dataUrl=await resizeImage(file); ns.photoDataUrl=dataUrl;
    const canvas=$('photoPreview'), img=new Image();
    img.onload=()=>{
      canvas.width=img.width; canvas.height=img.height;
      canvas.getContext('2d').drawImage(img,0,0);
      canvas.style.display='block'; $('photoPlaceholder').style.display='none';
      $('retakeBtn').style.display='flex'; $('shootBtn').style.display='none';
    }; img.src=dataUrl;
    const text=await runOCR(dataUrl,(type,msg)=>{
      const el=$('ocrStatus'); el.className=`ocr-status ${type}`; el.textContent=msg; el.style.display='block';
    });
    if(text) $('regNumber').value=text;
    e.target.value='';
  });
}

function initGeolocation() {
  $('getLocationBtn').addEventListener('click', ()=>{
    if(!navigator.geolocation){showLocStatus('error','位置情報APIが使えません');return;}
    showLocStatus('loading','⏳ 取得中…');
    navigator.geolocation.getCurrentPosition(pos=>{
      ns.lat=pos.coords.latitude; ns.lng=pos.coords.longitude; ns.locationAccuracy=Math.round(pos.coords.accuracy);
      showLocStatus('ok',`✅ 取得完了（精度±${ns.locationAccuracy}m）`);
      const a=$('mapsLink'); a.href=`https://maps.google.com/?q=${ns.lat},${ns.lng}`; a.style.display='inline';
      toast('位置情報を取得しました');
    }, err=>showLocStatus('error',`取得失敗: ${err.message}`), {enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });
}
function showLocStatus(type,msg){const el=$('locationStatus');el.className=`location-status ${type}`;el.textContent=msg;el.style.display='block';}

function buildNormalConditionGrid() {
  const grid=$('conditionGrid'); if(!grid) return;
  CONDITION_OPTIONS.forEach(opt=>{
    const label=document.createElement('label'); label.className='cond-label';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.value=opt;
    cb.addEventListener('change',()=>label.classList.toggle('checked',cb.checked));
    label.appendChild(cb); label.appendChild(document.createTextNode(opt)); grid.appendChild(label);
  });
}

function buildStorageSelects() {
  const sel=$('storageLocation');
  if(sel) {
    STORAGE_LOCATIONS.forEach(loc=>{
      const opt=document.createElement('option'); opt.value=loc.id; opt.textContent=`${loc.name}（${loc.id}）`; sel.appendChild(opt);
    });
    sel.addEventListener('change',()=>{
      const loc=STORAGE_LOCATIONS.find(l=>l.id===sel.value); $('storageAddress').textContent=loc?loc.address:'';
    });
  }
  const fs=$('filterStorage');
  if(fs) STORAGE_LOCATIONS.forEach(loc=>{const opt=document.createElement('option');opt.value=loc.id;opt.textContent=loc.name;fs.appendChild(opt);});
}

function getSelectedConditions(){return Array.from(document.querySelectorAll('#conditionGrid input:checked')).map(cb=>cb.value);}
function setDefaultDatetime(){const now=new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000),el=$('collectedAt');if(el)el.value=local.toISOString().slice(0,16);}

function initSave() {
  $('saveBtn').addEventListener('click', async ()=>{
    const collectedAt=$('collectedAt').value, storageId=$('storageLocation').value;
    if(!collectedAt){toast('⚠️ 回収日時を入力してください');return;}
    if(!storageId){toast('⚠️ 保管場所を選択してください');return;}
    await saveRecord({
      hasRegistration:ns.hasReg,
      registrationNumber:ns.hasReg==='yes'?($('regNumber').value.trim()||''):'',
      photoDataUrl:ns.hasReg==='yes'?(ns.photoDataUrl||null):null,
      conditions:getSelectedConditions(), conditionNote:$('conditionNote').value.trim(),
      lat:ns.lat, lng:ns.lng, locationAccuracy:ns.locationAccuracy,
      locationNote:$('locationNote').value.trim(),
      collectedAt:new Date(collectedAt).toISOString(), storageLocationId:storageId, notes:$('notes').value.trim(),
    });
    toast('✅ 保存しました'); resetNormalForm();
  });
}

async function saveRecord(data) {
  const loc=STORAGE_LOCATIONS.find(l=>l.id===data.storageLocationId)||{};
  const record={id:uuid(),createdAt:new Date().toISOString(),synced:false,
    storageLocationName:loc.name||'',storageLocationAddress:loc.address||'',notes:'',...data};
  await dbPut(record); return record;
}

function resetNormalForm(){
  ns.hasReg='yes';ns.photoDataUrl=null;ns.lat=null;ns.lng=null;ns.locationAccuracy=null;
  document.querySelectorAll('#hasRegCtrl .seg-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
  $('regSection').style.display='block';
  $('photoPreview').style.display='none';$('photoPlaceholder').style.display='flex';
  $('retakeBtn').style.display='none';$('shootBtn').style.display='block';
  $('ocrStatus').style.display='none';$('regNumber').value='';
  document.querySelectorAll('#conditionGrid input').forEach(cb=>{cb.checked=false;cb.closest('label').classList.remove('checked');});
  $('conditionNote').value='';$('locationStatus').style.display='none';
  $('mapsLink').style.display='none';$('locationNote').value='';
  $('storageLocation').value='';$('storageAddress').textContent='';$('notes').value='';
  setDefaultDatetime(); window.scrollTo({top:0,behavior:'smooth'});
}

function initList(){
  $('searchInput')?.addEventListener('input',renderList);
  $('filterStorage')?.addEventListener('change',renderList);
}
async function renderList(){
  const records=await dbGetAll();
  const query=($('searchInput')?.value||'').toLowerCase();
  const filterLoc=$('filterStorage')?.value||'';
  const filtered=records.filter(r=>{
    if(filterLoc&&r.storageLocationId!==filterLoc)return false;
    if(query){const h=[r.registrationNumber,r.locationNote,r.notes,r.storageLocationName].join(' ').toLowerCase();if(!h.includes(query))return false;}
    return true;
  }).sort((a,b)=>new Date(b.collectedAt)-new Date(a.collectedAt));
  const list=$('recordList'); if(!list) return;
  if(!filtered.length){list.innerHTML='<p class="muted center">該当するデータがありません。</p>';return;}
  list.innerHTML=filtered.map(r=>{
    const bc=r.hasRegistration==='yes'?'ok':r.hasRegistration==='no'?'no':'unk';
    const bt=r.hasRegistration==='yes'?'登録あり':r.hasRegistration==='no'?'登録なし':'不明';
    const cc=r.hasRegistration==='yes'?'has-reg':r.hasRegistration==='no'?'no-reg':'unknown-reg';
    const dt=new Date(r.collectedAt).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    return `<div class="record-card ${cc}" onclick="openDetail('${r.id}')">
      <div class="rc-header"><span class="rc-num">${escHtml(r.registrationNumber||'（番号なし）')}</span><span class="rc-badge ${bc}">${bt}</span></div>
      <div class="rc-meta"><span>📅 ${dt}</span><span>🏢 ${escHtml(r.storageLocationName)}</span>${r.lat?'<span>📍 GPS済</span>':''}${r.synced?'<span>✅ 送信済</span>':'<span>🕐 未送信</span>'}</div>
      ${r.conditions?.length?`<div class="rc-conditions">${escHtml(r.conditions.join(' / '))}</div>`:''}
    </div>`;
  }).join('');
}

function initExport(){
  const today=new Date().toISOString().slice(0,10);
  const monthAgo=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  if($('exportFrom'))$('exportFrom').value=monthAgo;
  if($('exportTo'))$('exportTo').value=today;
  $('exportFrom')?.addEventListener('change',renderExportSummary);
  $('exportTo')?.addEventListener('change',renderExportSummary);
  $('exportBtn')?.addEventListener('click',()=>exportCSV(false));
  $('exportAllBtn')?.addEventListener('click',()=>exportCSV(true));
  $('clearSyncedBtn')?.addEventListener('click',clearSynced);
}
function getExportRange(){
  return{from:$('exportFrom')?.value?new Date($('exportFrom').value+'T00:00:00'):null,
         to:$('exportTo')?.value?new Date($('exportTo').value+'T23:59:59'):null};
}
function inRange(d,from,to){const dt=new Date(d);if(from&&dt<from)return false;if(to&&dt>to)return false;return true;}
async function renderExportSummary(){
  const records=await dbGetAll();const{from,to}=getExportRange();
  const filtered=records.filter(r=>inRange(r.collectedAt,from,to));
  if($('exportSummary'))$('exportSummary').textContent=`期間内: ${filtered.length}件（未送信: ${filtered.filter(r=>!r.synced).length}件）`;
  if($('storageInfo'))$('storageInfo').innerHTML=`全件: ${records.length}件<br>未送信: ${records.filter(r=>!r.synced).length}件<br>送信済み: ${records.filter(r=>r.synced).length}件`;
}
async function exportCSV(all=false){
  const records=await dbGetAll();const{from,to}=getExportRange();
  const target=(all?records:records.filter(r=>inRange(r.collectedAt,from,to))).sort((a,b)=>new Date(a.collectedAt)-new Date(b.collectedAt));
  if(!target.length){toast('該当データがありません');return;}
  const headers=['管理ID','回収日時','登録番号','防犯登録','車体状況','状況備考','緯度','経度','GPS精度(m)','場所目印','保管場所','保管住所','備考','送信済み','作成日時'];
  const rows=target.map(r=>[r.id,new Date(r.collectedAt).toLocaleString('ja-JP'),r.registrationNumber||'',
    {yes:'あり',no:'なし',unknown:'不明'}[r.hasRegistration]||'',r.conditions?.join(' / ')||'',r.conditionNote||'',
    r.lat!=null?r.lat.toFixed(6):'',r.lng!=null?r.lng.toFixed(6):'',r.locationAccuracy??'',r.locationNote||'',
    r.storageLocationName||'',r.storageLocationAddress||'',r.notes||'',r.synced?'済み':'未',new Date(r.createdAt).toLocaleString('ja-JP')]);
  const csv=[headers,...rows].map(row=>row.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`bicycle_recovery_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
  a.click();URL.revokeObjectURL(a.href);toast(`✅ ${target.length}件をCSV出力しました`);
}
async function clearSynced(){
  if(!confirm('送信済みデータを全件削除しますか？元に戻せません。'))return;
  const records=await dbGetAll(),synced=records.filter(r=>r.synced);
  for(const r of synced)await dbDelete(r.id);toast(`${synced.length}件削除しました`);renderExportSummary();
}

// ── 詳細モーダル（共通）─────────────────────────
function initModal(){
  $('modalClose').addEventListener('click',closeModal);
  $('modalOverlay').addEventListener('click',closeModal);
}
function closeModal(){$('modal').style.display='none';}
window.openDetail=async function(id){
  const records=await dbGetAll();const r=records.find(x=>x.id===id);if(!r)return;
  const hasRegText={yes:'あり',no:'なし',unknown:'不明'}[r.hasRegistration]||'不明';
  const dt=new Date(r.collectedAt).toLocaleString('ja-JP');
  const mapsUrl=r.lat?`https://maps.google.com/?q=${r.lat},${r.lng}`:null;
  $('modalContent').innerHTML=`
    <div class="detail-title">回収記録詳細</div>
    ${r.photoDataUrl?`<img class="detail-photo" src="${r.photoDataUrl}" alt="防犯登録シール">`:''}
    <div class="detail-row"><span class="detail-label">防犯登録</span><span class="detail-val">${hasRegText}</span></div>
    ${r.registrationNumber?`<div class="detail-row"><span class="detail-label">登録番号</span><span class="detail-val">${escHtml(r.registrationNumber)}</span></div>`:''}
    <div class="detail-row"><span class="detail-label">回収日時</span><span class="detail-val">${dt}</span></div>
    <div class="detail-row"><span class="detail-label">車体状況</span><span class="detail-val">${escHtml(r.conditions?.join(', ')||'—')}</span></div>
    ${r.conditionNote?`<div class="detail-row"><span class="detail-label">状況備考</span><span class="detail-val">${escHtml(r.conditionNote)}</span></div>`:''}
    ${r.lat?`<div class="detail-row"><span class="detail-label">GPS</span><span class="detail-val">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}<br><a href="${mapsUrl}" target="_blank">地図で確認</a></span></div>`:''}
    ${r.locationNote?`<div class="detail-row"><span class="detail-label">場所目印</span><span class="detail-val">${escHtml(r.locationNote)}</span></div>`:''}
    <div class="detail-row"><span class="detail-label">保管場所</span><span class="detail-val">${escHtml(r.storageLocationName)}<br><small>${escHtml(r.storageLocationAddress)}</small></span></div>
    ${r.notes?`<div class="detail-row"><span class="detail-label">備考</span><span class="detail-val">${escHtml(r.notes)}</span></div>`:''}
    <div class="detail-row"><span class="detail-label">送信状態</span><span class="detail-val">${r.synced?'✅ 送信済み':'🕐 未送信'}</span></div>
    <br>
    <button class="btn-primary" style="width:100%" onclick="markSynced('${r.id}')">✅ 送信済みとしてマーク</button>
    <button class="btn-danger-outline" style="width:100%;margin-top:8px;" onclick="deleteRecord('${r.id}')">🗑 この記録を削除</button>`;
  $('modal').style.display='flex';
};
window.markSynced=async function(id){const records=await dbGetAll();const r=records.find(x=>x.id===id);if(!r)return;r.synced=true;await dbPut(r);toast('送信済みにマーク');closeModal();renderList();};
window.deleteRecord=async function(id){if(!confirm('削除しますか？'))return;await dbDelete(id);toast('削除しました');closeModal();renderList();};

// ═══════════════════════════════════════════════
// シルバー版ウィザード
// ═══════════════════════════════════════════════
const sv = {
  currentStep: 0,
  state: { hasReg:null, photoDataUrl:null, regNumber:'', conditions:[], lat:null, lng:null, locationAccuracy:null, storageId:null },
};
const SV_STEPS = [
  { id:'reg',       title:'防犯登録シールについて',     render:svRenderReg },
  { id:'photo',     title:'シールの写真を撮りましょう', render:svRenderPhoto, skip:()=>sv.state.hasReg!=='yes' },
  { id:'condition', title:'自転車の状態を教えてください', render:svRenderCondition },
  { id:'location',  title:'現在地を記録します',          render:svRenderLocation },
  { id:'storage',   title:'保管場所を選んでください',    render:svRenderStorage },
  { id:'confirm',   title:'確認して保存しましょう',      render:svRenderConfirm },
];
const svActiveSteps = () => SV_STEPS.filter(s => !s.skip?.());

function svInit() {
  // Tab nav
  document.querySelectorAll('.sv-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sv-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.sv-tab-content').forEach(c=>c.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.svTab;
      $(`sv${name.charAt(0).toUpperCase()+name.slice(1)}Tab`).classList.add('active');
      if(name==='list') svRenderList();
    });
  });
  $('svPrevBtn').addEventListener('click', svPrev);
  $('svNextBtn').addEventListener('click', svNext);
  $('svResetBtn').addEventListener('click', ()=>{
    if(sv.currentStep===0||confirm('入力中のデータが消えます。最初から始めますか？')){svGoHome();}
  });
  svRenderCurrentStep();
}

function svGoHome() {
  sv.currentStep = 0;
  sv.state = {hasReg:null,photoDataUrl:null,regNumber:'',conditions:[],lat:null,lng:null,locationAccuracy:null,storageId:null};
  // Switch to home tab
  document.querySelectorAll('.sv-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.sv-tab-content').forEach(c=>c.classList.remove('active'));
  document.querySelector('.sv-tab[data-sv-tab="home"]').classList.add('active');
  $('svHomeTab').classList.add('active');
  svRenderCurrentStep();
}

function svRenderCurrentStep() {
  const steps = svActiveSteps();
  const idx = sv.currentStep, total = steps.length;
  const step = steps[idx];
  $('svProgressFill').style.width = `${((idx+1)/total)*100}%`;
  $('svStepLabel').textContent = `ステップ ${idx+1} / ${total}`;
  $('svResetBtn').style.display = idx > 0 ? 'block' : 'none';
  $('svPrevBtn').disabled = idx === 0;
  if(idx===total-1){$('svNextBtn').textContent='💾 保存する';$('svNextBtn').className='sv-btn-next last-step';}
  else{$('svNextBtn').textContent='つぎへ →';$('svNextBtn').className='sv-btn-next';}
  const content=$('svStepContent'); content.innerHTML='';
  const card=document.createElement('div'); card.className='sv-card';
  card.innerHTML=`<div class="sv-step-title">${step.title}</div>`;
  content.appendChild(card); step.render(card);
  window.scrollTo({top:0,behavior:'smooth'});
}

function svNext() {
  const steps=svActiveSteps(), step=steps[sv.currentStep], errEl=$('svErr');
  if(!svValidate(step.id,errEl)) return;
  if(sv.currentStep<steps.length-1){sv.currentStep++;svRenderCurrentStep();}
  else svSave();
}
function svPrev(){if(sv.currentStep>0){sv.currentStep--;svRenderCurrentStep();}}
function svValidate(id,errEl){
  const show=msg=>{if(errEl){errEl.textContent='⚠️ '+msg;errEl.classList.add('show');}else toast('⚠️ '+msg);return false;};
  if(id==='reg'&&sv.state.hasReg===null)return show('シールの有無を選んでください');
  if(id==='storage'&&!sv.state.storageId)return show('保管場所を選んでください');
  return true;
}

function svRenderReg(card) {
  card.innerHTML+=`<p class="sv-step-hint">自転車についている防犯登録のシールを確認してください</p>
    <div class="sv-choice-grid">
      ${[{val:'yes',icon:'✅',label:'シールがある',sub:'番号が書いてあるシール'},
         {val:'no',icon:'❌',label:'シールがない',sub:'シールが見当たらない'},
         {val:'unknown',icon:'❓',label:'わからない',sub:'確認できなかった'}].map(o=>`
        <button class="sv-choice-btn${sv.state.hasReg===o.val?' selected':''}" data-reg="${o.val}">
          <span class="sv-choice-icon">${o.icon}</span>
          <span><span>${o.label}</span><span class="sv-choice-sub">${o.sub}</span></span>
        </button>`).join('')}
    </div>
    <div class="sv-error-msg" id="svErr"></div>`;
  card.querySelectorAll('[data-reg]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      sv.state.hasReg=btn.dataset.reg;
      card.querySelectorAll('[data-reg]').forEach(b=>b.className='sv-choice-btn');
      btn.className='sv-choice-btn selected';
      $('svErr')?.classList.remove('show');
    });
  });
}

function svRenderPhoto(card) {
  const hasPhoto=!!sv.state.photoDataUrl;
  card.innerHTML+=`<p class="sv-step-hint">シールに近づいて、できるだけ真正面から撮影してください。番号を自動で読み取ります。</p>
    ${hasPhoto?`<img class="sv-photo-preview" src="${sv.state.photoDataUrl}" alt="写真">`:''}
    <button class="sv-camera-btn${hasPhoto?' done':''}" id="svCameraBtn">
      ${hasPhoto?'📷 撮り直す':'📷 カメラで撮影する'}
    </button>
    <input type="file" id="svPhotoInput" accept="image/*" capture="environment" style="display:none;" />
    <div class="sv-error-msg" id="svOcrStatus" style="display:none;background:#ebf4ff;border-color:#bee3f8;color:#2b6cb0;"></div>
    ${hasPhoto?`<div class="sv-ocr-box">
      <div class="sv-ocr-label">📋 読み取った番号（修正できます）</div>
      <input class="sv-ocr-input" id="svRegInput" type="text" value="${escHtml(sv.state.regNumber)}" inputmode="text" autocomplete="off" placeholder="例: 東京 12345678" />
      <div class="sv-ocr-hint">文字が違う場合はここで直接なおしてください</div>
    </div>`:''}
    <div class="sv-error-msg" id="svErr"></div>`;
  $('svCameraBtn').addEventListener('click',()=>$('svPhotoInput').click());
  $('svPhotoInput').addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file) return;
    const dataUrl=await resizeImage(file); sv.state.photoDataUrl=dataUrl; sv.state.regNumber='';
    svRenderCurrentStep();
    const text=await runOCR(dataUrl,(type,msg)=>{
      const el=$('svOcrStatus');if(!el)return;
      el.style.display='block';
      if(type==='loading'){el.style.background='#ebf4ff';el.style.borderColor='#bee3f8';el.style.color='#2b6cb0';}
      else if(type==='done'){el.style.background='#f0fff4';el.style.borderColor='#c6f6d5';el.style.color='#276749';}
      else{el.style.background='#fff5f5';el.style.borderColor='#fed7d7';el.style.color='#c53030';}
      el.classList.add('show'); el.textContent=msg;
    });
    sv.state.regNumber=text;
    const inp=$('svRegInput'); if(inp) inp.value=text;
    e.target.value='';
  });
  const inp=$('svRegInput');
  if(inp) inp.addEventListener('input',()=>{sv.state.regNumber=inp.value;});
}

function svRenderCondition(card) {
  card.innerHTML+=`<p class="sv-step-hint">あてはまるものをすべてタップしてください（なければそのまま「つぎへ」）</p>
    <div class="sv-cond-grid">
      ${SV_CONDITION_OPTIONS.map(o=>`
        <label class="sv-cond-label${sv.state.conditions.includes(o.label)?' checked':''}">
          <input type="checkbox" value="${o.label}"${sv.state.conditions.includes(o.label)?' checked':''} />
          <span>${o.icon} ${o.label}</span>
        </label>`).join('')}
    </div>`;
  card.querySelectorAll('.sv-cond-grid input').forEach(cb=>{
    cb.addEventListener('change',()=>{
      cb.closest('label').classList.toggle('checked',cb.checked);
      if(cb.checked){if(!sv.state.conditions.includes(cb.value))sv.state.conditions.push(cb.value);}
      else sv.state.conditions=sv.state.conditions.filter(c=>c!==cb.value);
    });
  });
}

function svRenderLocation(card) {
  const hasGps=sv.state.lat!==null;
  card.innerHTML+=`<p class="sv-step-hint">ボタンを押すと現在の場所が自動で記録されます。「許可」を選んでください。</p>
    <button class="sv-gps-btn" id="svGpsBtn">${hasGps?'✅ 位置情報を再取得する':'📍 現在地を記録する'}</button>
    ${hasGps?`<div class="sv-gps-result ok">✅ 位置情報を記録しました<br>精度：±${sv.state.locationAccuracy}m<br>
      <a class="sv-maps-link" href="https://maps.google.com/?q=${sv.state.lat},${sv.state.lng}" target="_blank">📍 地図で確認する →</a>
    </div>`:`<div class="sv-gps-result" id="svGpsResult" style="display:none;"></div>`}
    <p class="sv-step-hint" style="margin-top:12px;">取得できない場合はそのまま「つぎへ」を押しても構いません。</p>`;
  $('svGpsBtn').addEventListener('click',()=>{
    if(!navigator.geolocation){svShowGps('error','位置情報が使えません。「つぎへ」を押してください。');return;}
    svShowGps('loading','⏳ 位置情報を取得しています…');
    navigator.geolocation.getCurrentPosition(pos=>{
      sv.state.lat=pos.coords.latitude;sv.state.lng=pos.coords.longitude;sv.state.locationAccuracy=Math.round(pos.coords.accuracy);
      svShowGps('ok',`✅ 記録しました（精度 ±${sv.state.locationAccuracy}m）`);
      $('svGpsBtn').textContent='✅ 位置情報を再取得する';toast('位置情報を記録しました');
    },err=>svShowGps('error','取得できませんでした。「つぎへ」で進んでください。'),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });
}
function svShowGps(type,msg){
  let el=$('svGpsResult');if(!el)return;
  el.style.display='block';el.className=`sv-gps-result ${type}`;
  el.innerHTML=msg+(type==='ok'&&sv.state.lat?`<br><a class="sv-maps-link" href="https://maps.google.com/?q=${sv.state.lat},${sv.state.lng}" target="_blank">📍 地図で確認する →</a>`:'');
}

function svRenderStorage(card) {
  card.innerHTML+=`<p class="sv-step-hint">この自転車をどこに持っていきますか？</p>
    <div class="sv-choice-grid">
      ${STORAGE_LOCATIONS.map(loc=>`
        <button class="sv-choice-btn${sv.state.storageId===loc.id?' selected-green':''}" data-storage="${loc.id}">
          <span class="sv-choice-icon">🏢</span>
          <span><span>${loc.name}</span><span class="sv-choice-sub">${loc.address}</span></span>
        </button>`).join('')}
    </div>
    <div class="sv-error-msg" id="svErr"></div>`;
  card.querySelectorAll('[data-storage]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      sv.state.storageId=btn.dataset.storage;
      card.querySelectorAll('[data-storage]').forEach(b=>b.className='sv-choice-btn');
      btn.className='sv-choice-btn selected-green';
      $('svErr')?.classList.remove('show');
    });
  });
}

function svRenderConfirm(card) {
  const loc=STORAGE_LOCATIONS.find(l=>l.id===sv.state.storageId);
  const regText=sv.state.hasReg==='yes'?`あり${sv.state.regNumber?'（'+sv.state.regNumber+'）':'（番号未読取）'}`:sv.state.hasReg==='no'?'なし':'不明';
  const items=[
    {label:'防犯登録',val:regText,status:'ok'},
    {label:'自転車の状態',val:sv.state.conditions.length?sv.state.conditions.join('、'):'（選択なし）',status:sv.state.conditions.length?'ok':'warn'},
    {label:'現在地',val:sv.state.lat?`取得済み（±${sv.state.locationAccuracy}m）`:'未取得',status:sv.state.lat?'ok':'warn'},
    {label:'保管場所',val:loc?loc.name:'（未選択）',status:loc?'ok':'missing'},
  ];
  const icons={ok:'✅',warn:'⚠️',missing:'❌'};
  card.innerHTML+=`<p class="sv-step-hint">入力内容を確認して「保存する」を押してください。</p>
    <div class="sv-confirm-list">
      ${items.map(item=>`<div class="sv-confirm-item ${item.status}">
        <span class="sv-confirm-icon">${icons[item.status]}</span>
        <div><div class="sv-confirm-label">${item.label}</div><div class="sv-confirm-val">${escHtml(item.val)}</div></div>
      </div>`).join('')}
    </div>
    ${items.some(i=>i.status==='missing')?'<div class="sv-error-msg show" id="svErr">❌ 保管場所が選ばれていません。「もどる」を押して選んでください。</div>':'<div class="sv-error-msg" id="svErr"></div>'}`;
}

async function svSave(){
  if(!sv.state.storageId){toast('⚠️ 保管場所を選んでください');sv.currentStep=svActiveSteps().findIndex(s=>s.id==='storage');svRenderCurrentStep();return;}
  try{
    await saveRecord({
      hasRegistration:sv.state.hasReg||'unknown',
      registrationNumber:sv.state.regNumber||'',photoDataUrl:sv.state.photoDataUrl||null,
      conditions:sv.state.conditions,conditionNote:'',
      lat:sv.state.lat,lng:sv.state.lng,locationAccuracy:sv.state.locationAccuracy,
      locationNote:'',collectedAt:new Date().toISOString(),
      storageLocationId:sv.state.storageId,notes:'',
    });
    toast('✅ 保存しました！'); svGoHome();
  }catch(err){toast('❌ 保存失敗: '+err.message);}
}

async function svRenderList(){
  const records=(await dbGetAll()).sort((a,b)=>new Date(b.collectedAt)-new Date(a.collectedAt));
  const list=$('svRecordList'); if(!list) return;
  if(!records.length){list.innerHTML='<p class="sv-muted">まだ記録がありません。</p>';return;}
  list.innerHTML=records.slice(0,30).map(r=>{
    const bc=r.hasRegistration==='yes'?'ok':'no';
    const bt=r.hasRegistration==='yes'?'登録あり':r.hasRegistration==='no'?'登録なし':'不明';
    const cc=r.hasRegistration==='yes'?'has-reg':'no-reg';
    const dt=new Date(r.collectedAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<div class="sv-record-card ${cc}" onclick="openDetail('${r.id}')">
      <div><span class="sv-record-badge ${bc}">${bt}</span></div>
      <div class="sv-record-num">${escHtml(r.registrationNumber||'（番号なし）')}</div>
      <div class="sv-record-meta">📅 ${dt}<br>🏢 ${escHtml(r.storageLocationName||'')}${r.lat?'<br>📍 位置情報あり':''}<br>${r.synced?'✅ 送信済み':'🕐 まだ送っていません'}</div>
    </div>`;
  }).join('');
}

// ── アプリ起動 ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async ()=>{
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  await openDB();
  initModal();
  updateSyncBadge();
  window.addEventListener('online', updateSyncBadge);
  window.addEventListener('offline', updateSyncBadge);

  const mode = getMode();
  $('normalApp').style.display = mode==='normal' ? 'block' : 'none';
  $('silverApp').style.display = mode==='silver' ? 'block' : 'none';
  renderSettingsPages(mode);

  if(mode==='normal'){
    initNormalApp();
  } else {
    svInit();
  }
});
