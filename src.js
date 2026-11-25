import './style.css';
import { requestText } from './lib/pay.js';
import { parseAddress, prepareTransfer, fetchBalances, formatUnits } from './lib/pay-wallet.js';
import { validDate, expiryInfo, shareText } from './lib/smart.js';
import { drawQR, drawBarcode, drawMatrix, warmCodes } from './lib/code-renderer.js';
import { icon, brandMark, brandHTML } from './components/icons.js';
import { types, themes, palettes, cardStyle } from './core/config.js';
import { esc, loadItems } from './core/storage.js';
import { createCollectionIndex, debounce, PAGE_SIZE } from './core/collection.js';
import { homeView, listHTML, cardsHTML, pluralize, reminderHTML, detailSidebar } from './features/collection-view.js';
import { editorView, detailView } from './features/editor.js';
import { showTour } from './features/onboarding.js';
import { TelegramUI } from './lib/telegram-ui.js';

const tg = window.Telegram?.WebApp;
const telegram = new TelegramUI(tg, { onError: () => toast('Could not complete the action. Please try again.') });
if (import.meta.hot) import.meta.hot.dispose(() => telegram.destroy());

let payConnection = null;
let payLoading = false;
let payError = '';
let payBusy = false;
let balanceState = { address:'', loading:false, ton:null, usdt:null, at:0 };
let balanceController = null;
let transferDialog = null;
let payDraft = { amount: '', memo: '' };
let cloudToken = null;
let revision = 0;
let cloudStatus = 'Local storage';
let syncing = false;
let verifiedUser = null;
let authFlight = null;
let sortOrder = 'recent';
try { const savedSort = localStorage.getItem('velt.sort'); if (['name','expiry'].includes(savedSort)) sortOrder = savedSort; } catch {}
let authStatus = tg?.initData ? 'Verifying your profile…' : 'Guest mode';

const haptic = (type = 'light') => telegram.haptic(type);

function verifyProfile() {
  if (authFlight) return authFlight;
  authFlight = verifyProfileOnce().finally(() => { authFlight = null; });
  return authFlight;
}
async function verifyProfileOnce() {
  if (!tg?.initData) return;
  authStatus = 'Verifying your profile…';
  if (screen === 'settings') render();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData }),
      cache: 'no-store', signal: controller.signal,
    });
    if (!r.ok) throw Error(r.status === 503 ? 'Server authentication is not configured' : r.status === 401 ? 'Session invalid or expired. Reopen Velt from Telegram.' : 'Profile verification failed');
    const data = await r.json();
    if (!Number.isSafeInteger(data.user?.id) || data.user.id <= 0) throw Error('Invalid profile response');
    verifiedUser = data.user;
    cloudToken = data.session;
    key = 'velt.items.user.' + verifiedUser.id;
    items = loadItems(key);
    cloudStatus = cloudToken ? 'Cloud sync ready' : 'Local storage';
    authStatus = 'Telegram profile verified';
  } catch (e) {
    authStatus = e.name === 'AbortError' ? 'Verification timed out. Try again.' : e.message === 'Failed to fetch' ? 'Offline — verification unavailable' : e.message;
  } finally { clearTimeout(timeout); }
  if (screen === 'home' || screen === 'settings' || screen === 'pay') render();
  else syncNative();
  if (screen === 'pay') loadPay();
}

const clientUser = () => tg?.initDataUnsafe?.user || null;

function displayName(user = verifiedUser || clientUser()) {
  if (!user) return '';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || '';
}

function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map(part => part[0]).join('') || 'V').toUpperCase();
}

function walletTitle() {
  const name = displayName();
  const owner = name ? `${name}${/s$/i.test(name) ? '’' : '’s'}` : 'Your';
  return `<span class="wallet-owner" dir="auto">${esc(owner)}</span> <span class="wallet-word">wallet</span>`;
}

function avatarHTML(kind = 'hero') {
  const user = clientUser();
  const name = displayName(verifiedUser || user) || 'Velt';
  const photo = (!verifiedUser || verifiedUser.id === user?.id) && typeof user?.photo_url === 'string' && /^https:\/\//i.test(user.photo_url) ? user.photo_url : '';
  const content = `<span class="${kind}-avatar-fallback" aria-hidden="true">${esc(initialsOf(name))}</span>` + (photo
    ? `<img src="${esc(photo)}" alt="" class="${kind}-avatar-image" referrerpolicy="no-referrer" decoding="async">`
    : '');
  return `<div class="${kind}-avatar-shell" role="img" aria-label="${esc(name)} profile photo"><div class="${kind}-avatar-glow" aria-hidden="true"></div><div class="${kind}-avatar">${content}</div></div>`;
}

function profileHTML() {
  const fullName = displayName() || 'Velt Wallet';
  return `
    <div class="profile-card">
      ${avatarHTML('profile')}
      <div class="profile-info">
        <b>${esc(fullName)}</b>
        <small>${esc(authStatus)}</small>
      </div>
      <span class="badge">v0.9.2.5</span>
    </div>
  `;
}

function syncNative() {
  const locked = !!busy || (screen === 'form' && !!tg?.initData && !verifiedUser);
  const submit = document.querySelector('#form button[type=submit]');
  if (submit) { submit.disabled = locked; submit.setAttribute('aria-busy', String(!!busy)); }
  telegram.set(tourActions || {
    main: null,
    secondary: null,
    back: screen !== 'home' ? { onClick: back, disabled: !!busy } : null,
    settings: null,
  });
  document.querySelectorAll('[data-native-action]').forEach(button => {
    button.disabled = locked;
    button.setAttribute('aria-busy', String(!!busy));
  });
}

let theme = 'auto';
try {
  theme = localStorage.getItem('velt.theme') || 'auto';
} catch {}
if (!Object.hasOwn(themes, theme)) theme = 'auto';

const media = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const dark = theme === 'dark' || (theme === 'auto' && (telegram.active ? tg.colorScheme === 'dark' : media.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  telegram.paint();
  payConnection?.theme(dark);
}

function setTheme(t) {
  if (!Object.hasOwn(themes, t)) return;
  theme = t;
  try {
    localStorage.setItem('velt.theme', t);
  } catch {}
  haptic('selection');
  applyTheme();
  render();
}

media.addEventListener?.('change', applyTheme);
telegram.onTheme = applyTheme;
applyTheme();

let key = tg?.initData ? 'velt.items.locked' : 'velt.items.v1';
let items = tg?.initData ? [] : loadItems(key);
const visibleItems = () => items;
let scanner = null;
let scanStream = null;
let tab = 'all';
let query = '';
let screen = 'home';
let selected = null;
let wake = null;
let highContrast = false;
let toastTimer;
let busy = '';
let tourActions = null;
let formBaseline = '';
let navigating = false;
let submitFlight = null;

const app = document.querySelector('#app');
app.innerHTML = '<div id="screen"></div><nav class="bottomnav" aria-label="Navigation"></nav>';
const screenContent = app.querySelector('#screen');
const navigation = app.querySelector('.bottomnav');
function save(next) {
  if (syncing || (tg?.initData && !verifiedUser)) {
    toast('Please wait for profile verification');
    return false;
  }
  try {
    localStorage.setItem(key, JSON.stringify(next));
    items = next;
    if (cloudStatus === 'Just synced') cloudStatus = cloudToken ? 'Cloud sync ready' : 'Local storage';
    return true;
  } catch {
    toast('Not enough device storage');
    return false;
  }
}

function toast(s) {
  let el = document.querySelector('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = s;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function formSnapshot() {
  const formEl = document.querySelector('#form');
  return formEl ? JSON.stringify([...new FormData(formEl)].map(([k, v]) => [k, v instanceof File ? (v.name ? [v.name, v.size, v.lastModified] : null) : v])) : '';
}

function updateDirty() {
  telegram.closingConfirmation(screen === 'form' && formSnapshot() !== formBaseline);
}

async function go(s, nextSelected = s === 'home' ? null : selected) {
  if (busy || navigating || tourActions || payBusy || transferDialog) return;
  navigating = true;
  try {
    if (screen === 'form' && formSnapshot() !== formBaseline && !await telegram.confirm('Discard your unsaved changes?')) return;
    if (document.activeElement?.matches?.("input, select, textarea")) document.activeElement.blur();
    selected = nextSelected;
    stopScan();
    telegram.call(tg, 'closeScanQrPopup');
    highContrast = false;
    screen = s;
    telegram.closingConfirmation(false);
    wake?.release().catch(() => {});
    wake = null;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  } finally { navigating = false; }
}

function renderNavigation() {
  if (!navigation.children.length) {
    navigation.innerHTML = `<span class="nav-indicator" aria-hidden="true"></span>${[
      ['wallet', 'Wallet'], ['star', 'Favorites'], ['plus', 'Add'], ['pay', 'Pay'], ['settings', 'Settings'],
    ].map(([symbol, label], index) => `<button data-nav="${index}">${icon(symbol)}<small>${label}</small></button>`).join('')}`;
  }
  const active = screen === 'settings' ? 4 : screen === 'pay' ? 3 : screen === 'form' ? 2 : tab === 'favorites' ? 1 : 0;
  navigation.style.setProperty('--nav-index', active);
  navigation.querySelectorAll('button').forEach((button, index) => {
    button.classList.toggle('nav-active', index === active);
    if (index === active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.disabled = !!busy || payBusy;
  });
}

function setBusy(value) {
  busy = value;
  syncNative();
  renderNavigation();
  const formEl = document.querySelector('#form');
  if (formEl) {
    formEl.setAttribute('aria-busy', String(!!busy));
    formEl.inert = !!busy;
  }
}

function startNewItem() {
  return go('form', null);
}

const selectCollection = createCollectionIndex();
let collectionLimit = PAGE_SIZE;
function filteredItems() { return selectCollection(visibleItems(), {query, tab, sort:sortOrder}); }
const searchUpdate = debounce(() => updateCollection(), 160);
function home() { return homeView({items, list:filteredItems(), tab, query, sortOrder, status:statusText(), avatar:avatarHTML('hero'), title:walletTitle(), limit:collectionLimit}); }
function form() { return editorView({selected, telegram, tg, verifiedUser, authStatus}); }
function detail() { return `<div class="desktop-detail-layout ${highContrast ? 'detail-focus' : ''}">${detailSidebar(selectCollection(items,{sort:sortOrder}),selected)}${detailView({selected, highContrast})}</div>`; }
function showTutorial(force=false) { return showTour({force, user:verifiedUser, setActions:actions=>{tourActions=actions;}, syncNative, haptic}); }

function statusText() {
  if (tg?.initData && !verifiedUser) return authStatus;
  return navigator.onLine ? 'Stored on this device' : 'Offline · Stored on this device';
}
function updateCollection({reset=true} = {}) {
  searchUpdate.cancel();
  if (reset) collectionLimit = PAGE_SIZE;
  if (screen !== 'home') return;
  const reminders = document.querySelector('#reminders');
  if (reminders) reminders.innerHTML = reminderHTML(items);
  const list = document.querySelector('#list');
  const matches = filteredItems();
  if (list) list.innerHTML = listHTML(matches, {query,tab,limit:collectionLimit});
  const favCount=items.filter(i=>i.favorite).length;
  screenContent.querySelectorAll('[data-count]').forEach(el=>{el.textContent=String(items.filter(i=>i.type===el.dataset.count).length);});
  const allTab=screenContent.querySelector('[role=tab][data-tab=all]');
  const favTab=screenContent.querySelector('[role=tab][data-tab=favorites]');
  if(allTab)allTab.textContent=`All (${items.length})`;
  if(favTab)favTab.textContent=`Favorites${favCount ? ` (${favCount})` : ''}`;
  const count = document.querySelector('#resultCount');
  if (count) count.textContent = `${matches.length} ${pluralize(matches.length)}`;
  screenContent.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    if (button.classList.contains('quick-tile')) {
      button.classList.toggle('chosen', active);
      button.setAttribute('aria-pressed', String(active));
    } else if (button.getAttribute('role') === 'tab') {
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }
  });
  renderNavigation();
}
function updateConnection() {
  const status = document.querySelector('#walletStatus');
  if (status) status.textContent = statusText();
}
window.addEventListener('online', updateConnection);
window.addEventListener('offline', updateConnection);

async function loadPay() {
  if (payConnection) { refreshBalances(); return; }
  if (payLoading || (tg?.initData && !verifiedUser)) return;
  payLoading = true; payError = '';
  if (screen === 'pay') render();
  try {
    const { createPayConnection } = await import('./lib/pay-ui.js');
    const scope = verifiedUser ? 'user.' + verifiedUser.id : 'guest';
    payConnection = createPayConnection(scope, () => { if (transferDialog && currentPayWallet()?.address !== transferDialog.dataset.wallet) transferDialog.dispatchEvent(new Event('cancel', {cancelable:true})); if (screen === 'pay') render(); refreshBalances(); });
    refreshBalances();
  } catch { payError = 'Could not load TON Connect. Check your connection and try again.'; }
  finally { payLoading = false; if (screen === 'pay') render(); }
}
function payPage() {
  const state = payConnection?.status();
  const locked = !!tg?.initData && !verifiedUser;
  const connected = !locked && !!state?.connected;
  const canRequest = connected && state.ready && state.mainnet && validPayAddress(state.address);
  return `<div class="subpage pay-page">
    <header class="topbar">${brandHTML()}<button class="icon-btn" id="settings" aria-label="Settings">${icon('settings')}</button></header>
    <section class="pay-hero"><div class="pay-orb">${icon('wallet')}</div><span class="pay-kicker">VELT PAY · BETA</span><h1>Velt Pay</h1><p>Send, receive and request TON directly from your wallet.</p></section>
    <section class="pay-card" aria-label="Wallet connection">
      <div class="pay-card-head"><div><span class="pay-kicker">CONNECTED WALLET</span><h2>${connected ? esc(state.name) : 'Connect wallet'}</h2></div><span class="pay-status">${connected ? state.mainnet ? 'Mainnet' : 'Other network' : 'Not connected'}</span></div>
      ${locked ? '<p class="muted">Verify your Telegram profile in Settings before connecting.</p><button class="secondary" id="retryProfile">Retry verification</button>' : connected ? `<code class="pay-address">${esc(state.address || 'Address unavailable')}</code><div class="action-grid"><button class="secondary" id="payCopyAddress" ${!state.address || payBusy ? 'disabled' : ''}>${icon('copy')} Copy address</button><button class="secondary" id="payDisconnect" ${payBusy ? 'disabled' : ''}>Disconnect</button></div>${!state.mainnet ? '<p class="muted">Connect a mainnet wallet to create a request.</p>' : ''}` : `<p>Use a supported TON wallet. Velt never asks for your seed phrase. Connected public addresses are sent to TonAPI to read balances.</p><button class="primary" id="payConnect" ${payLoading || (state && !state.ready) || payBusy ? 'disabled' : ''}>${payLoading || (state && !state.ready) ? 'Loading wallet connection…' : 'Connect wallet'}</button>`}
      ${payError || state?.error ? `<p role="status" class="pay-error">${esc(payError || state.error)}</p>` : ''}
    </section>
    ${canRequest ? `<section class="pay-card pay-assets"><div class="pay-card-head"><div><span class="pay-kicker">MAINNET</span><h2>Assets</h2></div><button class="secondary pay-refresh" id="payRefresh" ${payBusy ? 'disabled' : ''}>Refresh</button></div><div id="payBalances" aria-live="polite" aria-busy="${balanceState.loading}">${balanceHTML(state.address)}</div><div class="action-grid pay-quick"><button class="primary" id="paySend" ${payBusy?'disabled':''}>${icon('share')} Send TON</button><button class="secondary" id="payReceive" ${payBusy?'disabled':''}>${icon('qr')} Receive</button></div></section>` : ''}
    <section class="pay-card"><div class="pay-card-head"><div><span class="pay-kicker">PEER TO PEER</span><h2>Request payment</h2></div>${icon('receipt')}</div>
      <p>Share an amount and receiving address. This is a manual request, not a tracked invoice.</p>
      <form id="payRequest" class="pay-form"><label class="field"><span>Amount (TON)</span><input name="amount" inputmode="decimal" placeholder="0.00" value="${esc(payDraft.amount)}" maxlength="19" required ${canRequest ? '' : 'disabled'}></label><label class="field"><span>Description (optional)</span><input name="memo" maxlength="120" placeholder="e.g. Lunch" value="${esc(payDraft.memo)}" ${canRequest ? '' : 'disabled'}></label><button class="primary" type="submit" ${canRequest && !payBusy ? '' : 'disabled'}>${icon('share')} Preview request</button></form>
      ${!canRequest ? '<p class="muted">Connect a TON mainnet wallet to continue.</p>' : ''}
    </section><p class="muted">Transfers are made in your external wallet. Velt does not hold funds or verify payments in this beta. Not for digital goods sold inside Telegram.</p>
  </div>`;
}
async function payAction(id) {
  if (payBusy || transferDialog) return;
  if (tg?.initData && !verifiedUser) return toast('Verify your Telegram profile first');
  if (id === 'payConnect' && !payConnection) await loadPay();
  if (!payConnection) return;
  if (id === 'payRefresh') return refreshBalances(true);
  if (id === 'payReceive') return showReceive();
  if (id === 'paySend') return showSend();
  payBusy = true;
  try {
    if (id === 'payConnect') await payConnection.connect();
    if (id === 'payDisconnect' && await telegram.confirm('Disconnect this TON wallet from Velt?')) { await payConnection.disconnect(); payDraft = { amount:'', memo:'' }; }
    if (id === 'payCopyAddress') { const address = payConnection.status().address; if (!address) throw Error(); await navigator.clipboard.writeText(address); toast('Address copied'); haptic('success'); }
  } catch { toast('Wallet action could not be completed. Try again.'); }
  finally { payBusy = false; if (screen === 'pay') render(); }
}
function validPayAddress(address) { try { parseAddress(address); return true; } catch { return false; } }
function currentPayWallet() {
  const state = payConnection?.status();
  return !(tg?.initData && !verifiedUser) && state?.connected && state.ready && state.mainnet && validPayAddress(state.address) ? state : null;
}
function balanceHTML(address) {
  const b = balanceState.address === address ? balanceState : {};
  const value = (v,d) => v == null ? b.loading ? 'Loading…' : 'Unavailable' : formatUnits(v,d);
  return `<div class="asset-row"><span class="asset-symbol" data-symbol="TON">TON</span><div><b>Toncoin</b><small>TON</small></div><strong class="${b.loading ? 'balance-skeleton' : ''}">${esc(value(b.ton,9))}</strong></div><div class="asset-row"><span class="asset-symbol" data-symbol="USDT">₮</span><div><b>Tether</b><small>USDT · TON</small></div><strong class="${b.loading ? 'balance-skeleton' : ''}">${esc(value(b.usdt,6))}</strong></div><p class="balance-note">${b.loading ? 'Updating balances…' : b.at ? 'Updated ' + esc(new Date(b.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})) : 'Balance not loaded'} · Public address lookup via TonAPI. Unavailable does not mean zero.</p>`;
}
function paintBalances() {
  const node = document.querySelector('#payBalances');
  const state = currentPayWallet();
  if (node && state) { node.innerHTML = balanceHTML(state.address); node.setAttribute('aria-busy', String(balanceState.loading)); }
  const button = document.querySelector('#payRefresh');
  if (button) button.disabled = balanceState.loading || payBusy;
}
async function refreshBalances(force = false) {
  const state = currentPayWallet();
  if (!state) { balanceController?.abort(); balanceController = null; balanceState={address:'',loading:false,ton:null,usdt:null,at:0}; return; }
  if (screen !== 'pay') return;
  if (balanceState.address === state.address && (balanceState.loading || (!force && Date.now()-balanceState.at < 30000))) return;
  balanceController?.abort();
  const controller = new AbortController(); balanceController = controller;
  balanceState = {address:state.address,loading:true,ton:null,usdt:null,at:0}; paintBalances();
  const timer = setTimeout(()=>controller.abort(),12000);
  try {
    const result = await fetchBalances(state.address,{signal:controller.signal});
    if (balanceController !== controller || currentPayWallet()?.address !== state.address) return;
    balanceState = {...result,address:state.address,loading:false,at:Date.now()};
  } catch { if (balanceController === controller) balanceState={address:state.address,loading:false,ton:null,usdt:null,at:Date.now()}; }
  finally { clearTimeout(timer); if (balanceController === controller) { balanceController=null; paintBalances(); } }
}
function payDialog(html) {
  if (transferDialog || document.querySelector('dialog[open]')) return null;
  const dialog = document.createElement('dialog'); dialog.className='pay-preview pay-sheet'; dialog.innerHTML=html;
  transferDialog=dialog; dialog.dataset.wallet=currentPayWallet()?.address || ''; document.body.append(dialog);
  const close=()=>{ if (transferDialog===dialog) transferDialog=null; dialog.close();dialog.remove(); };
  dialog.addEventListener('cancel', e=>{e.preventDefault();close();});
  dialog.addEventListener('click',e=>{if(e.target.closest('[data-pay-close]'))close();});
  dialog.showModal(); return {dialog,close};
}
function showReceive() {
  const state=currentPayWallet(); if(!state)return toast('Connect a TON mainnet wallet first');
  const modal=payDialog(`<div class="sheet-handle"></div><h2>Receive TON / USDT</h2><p class="muted">TON mainnet only. Use your own receiving address for TON and USDT on TON, not another network.</p><div class="receive-qr"><canvas aria-label="Receiving address QR code"></canvas></div><code class="pay-address">${esc(state.address)}</code><button class="primary" id="receiveCopy">${icon('copy')} Copy address</button><button class="secondary" data-pay-close>Close</button>`);
  if(!modal)return;
  drawQR(modal.dialog.querySelector('canvas'),state.address,{width:220,margin:3,color:{dark:'#111111',light:'#ffffff'}}).catch(()=>{modal.dialog.querySelector('.receive-qr')?.replaceChildren(document.createTextNode('QR unavailable. Copy the address below.'));});
  modal.dialog.querySelector('#receiveCopy').onclick=async()=>{if(currentPayWallet()?.address!==state.address){modal.close();return toast('Wallet changed');}try{await navigator.clipboard.writeText(state.address);toast('Address copied');}catch{toast('Could not copy address');}};
}
function showSend() {
  const state=currentPayWallet(); if(!state)return toast('Connect a TON mainnet wallet first');
  const modal=payDialog(`<div class="sheet-handle"></div><h2>Send TON</h2><p class="muted">Enter the recipient’s TON mainnet address. USDT transfers are not available yet.</p><form class="pay-form"><label class="field"><span>Recipient address</span><input name="recipient" required maxlength="48" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="UQ… or EQ…"></label><label class="field"><span>Amount (TON)</span><input name="amount" required inputmode="decimal" maxlength="19" placeholder="0.00"></label><p class="pay-error" role="alert"></p><button class="primary" type="submit">Review transfer</button></form><button class="secondary" data-pay-close>Cancel</button>`);
  if(!modal)return;
  modal.dialog.querySelector('form').onsubmit=e=>{
    e.preventDefault(); const f=new FormData(e.target); const error=modal.dialog.querySelector('[role=alert]');
    let review;
    try {
      if(currentPayWallet()?.address!==state.address)throw Error('Wallet changed. Reopen Send.');
      review=prepareTransfer({sender:state.address,recipient:f.get('recipient'),amount:f.get('amount')});
      if(balanceState.address===state.address && balanceState.ton!==null && BigInt(review.nano)>=BigInt(balanceState.ton))throw Error('Leave enough TON for network fees.');
    }catch(e){error.textContent=e.message;return;}
    modal.dialog.innerHTML=`<div class="sheet-handle"></div><h2>Review transfer</h2><div class="send-amount">${esc(review.amount)} <small>TON</small></div><span class="pay-kicker">RECIPIENT · TON MAINNET</span><code class="pay-address">${esc(review.recipient)}</code><span class="pay-kicker">FROM</span><code class="pay-address">${esc(state.address)}</code><p class="muted">Check the complete address and amount. Your external wallet shows network fees. Transfers cannot usually be reversed. Velt does not verify final settlement yet.</p><button class="primary" id="confirmSend">Open wallet to confirm</button><button class="secondary" data-pay-close>Cancel</button>`;
    modal.dialog.querySelector('#confirmSend').onclick=async()=>{
      if(payBusy)return;
      if(currentPayWallet()?.address!==state.address){modal.close();return toast('Wallet changed. Review again.');}
      payBusy=true; modal.close(); if(screen==='pay')render();
      try{await payConnection.send(review);toast('Wallet accepted request. Check transaction status in your wallet.');}
      catch{toast('Transfer not confirmed by Velt. Check your wallet before retrying.');}
      finally{payBusy=false;if(screen==='pay'){render();refreshBalances(true);}}
    };
  };
}
function previewPayRequest() {
  const state = payConnection?.status();
  if (!state?.ready || !state.mainnet || !state.connected || (tg?.initData && !verifiedUser)) return toast('Connect a TON mainnet wallet first');
  let text;
  try { text = requestText(payDraft.amount, state.address, payDraft.memo); } catch(e) { return toast(e.message); }
  const dialog = document.createElement('dialog'); dialog.className = 'pay-preview';
  dialog.innerHTML = `<h2>Review payment request</h2><p class="pay-preview-text"></p><p class="muted">Anyone you share this with can see the address, amount and description. No funds will be sent by Velt.</p><button class="primary" data-pay-preview="share">Share in Telegram</button><button class="secondary" data-pay-preview="copy">Copy request</button><button class="secondary" data-pay-preview="close">Cancel</button>`;
  dialog.querySelector('.pay-preview-text').textContent = text;
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', async e => {
    const action = e.target.closest('[data-pay-preview]')?.dataset.payPreview;
    if (action === 'close') return close();
    if (!action) return;
    const current = payConnection?.status();
    if (!current?.connected || !current.mainnet || current.address !== state.address) { close(); return toast('Wallet changed. Create a new request.'); }
    if (action === 'copy') { try { await navigator.clipboard.writeText(text); toast('Request copied'); close(); } catch { toast('Could not copy request'); } }
    if (action === 'share') { const url = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text); if (!telegram.call(tg,'openTelegramLink',url)) window.open(url,'_blank','noopener,noreferrer'); close(); }
  });
  dialog.showModal();
}

function settings() {
  return `
    <div class="subpage">
      <header class="topbar">
        <button class="icon-btn back" aria-label="Back">${icon('arrow')}</button>
        <div class="page-title">Settings</div>
        <span class="spacer"></span>
      </header>

      ${profileHTML()}
      ${tg?.initData && !verifiedUser ? '<button class="secondary" id="retryProfile">Retry verification</button>' : ''}

      <div class="settings-group">
        <h2>Appearance</h2>
        <div class="theme-options">
          ${Object.entries(themes)
            .map(
              ([k, v]) =>
                `<button data-theme="${k}" class="${theme === k ? 'active' : ''}" aria-pressed="${theme === k}">${v}</button>`
            )
            .join('')}
        </div>
      </div>

      <div class="settings-group"><h2>Reminders</h2><p>Expiry reminders appear inside your wallet. No background notifications are sent.</p></div>
      <div class="settings-group">
        <h2>Cloud sync</h2>
        <p>${esc(cloudStatus === 'Just synced' ? 'Last backup or restore completed.' : cloudStatus === 'Cloud sync ready' ? 'Cloud backup available.' : cloudStatus === 'Local storage' ? 'Your items are stored on this device.' : 'Last cloud action: ' + cloudStatus + '.')} Back up or restore your wallet manually.</p>
        ${
          cloudToken
            ? `
            <div class="action-grid">
              <button class="secondary" id="cloudPull">Restore from cloud</button>
              <button class="secondary" id="cloudPush">Back up to cloud</button>
            </div>
          `
            : ''
        }
        ${verifiedUser ? `<button class="secondary" id="legacy">Import legacy local items</button>` : ''}
      </div>

      <div class="settings-group">
        <h2>Backup & restore</h2>
        <p>Your JSON backup contains all items and photos. Store it securely.</p>
        <button class="primary" id="export">Export backup</button>
        <button class="secondary" type="button" id="pickRestore">Import JSON backup</button>
        <input id="restore" type="file" accept="application/json,.json" hidden>
      </div>

      <button class="secondary" id="showTutorial">Show welcome tour</button><p class="muted version-foot">Velt · Your everyday digital wallet</p>
    </div>
  `;
}

function render() {
  searchUpdate.cancel();
  if (screen !== 'home') collectionLimit=PAGE_SIZE;
  const entered = app.dataset.screen !== screen;
  app.dataset.screen = screen;
  screenContent.innerHTML =
    screen === 'home' ? home() : screen === 'form' ? form() : screen === 'settings' ? settings() : screen === 'pay' ? payPage() : detail();
  if (entered && screen === 'detail') screenContent.querySelector('.desktop-detail-layout')?.classList.add('detail-enter');
  screenContent.querySelectorAll('.hero-avatar-image, .profile-avatar-image').forEach(img => {
    const hideBroken = () => { img.hidden = true; };
    img.addEventListener('error', hideBroken, { once: true });
    if (img.complete && !img.naturalWidth) hideBroken();
  });
  if (screen === 'form') { updateCodeField(); formBaseline = formSnapshot(); }
  renderNavigation();
  syncNative();

  if (screen === 'detail' && selected?.code && selected.format !== 'none') {
    const item = selected;
    const target = document.querySelector(['QR','DATAMATRIX'].includes(item.format) ? '#qr' : '#barcode');
    const error = document.querySelector('#codeError');
    if (target && error) {
      error.textContent = 'Loading code…';
      const work = item.format === 'DATAMATRIX' ? drawMatrix(target,item.code) : item.format === 'QR' ? drawQR(target,item.code,{width:220,margin:2}) : drawBarcode(target,item.code,{format:item.format,width:2.1,height:86,displayValue:false,margin:10});
      work.then(()=>{if(error.isConnected)error.textContent='';}).catch(()=>{if(error.isConnected)error.textContent=navigator.onLine?'Could not render code. Check the format or try again.':'Code renderer unavailable offline. Copy the code below.';});
    }

    if (navigator.wakeLock) {
      navigator.wakeLock
        .request('screen')
        .then((w) => {
          if (screen === 'detail' && !document.hidden && !wake) { wake = w; w.addEventListener?.('release', () => { if (wake === w) wake = null; }); }
          else w.release();
        })
        .catch(() => {});
    }
  }
}

function updateCodeField() {
  const form = document.querySelector('#form');
  if (!form) return;
  const code = form.elements.code;
  const enabled = form.elements.format.value !== 'none';
  code.disabled = !enabled;
  code.required = enabled;
  document.querySelector('#codeField')?.classList.toggle('field-inactive', !enabled);
}
function back() {
  if (transferDialog) { transferDialog.dispatchEvent(new Event('cancel',{cancelable:true})); return; }
  haptic('light');
  return go('home');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && screen !== 'home' && !tourActions && !document.querySelector('dialog[open]') && !payBusy) back();
});

window.addEventListener('beforeunload', (e) => {
  if (screen === 'form' && formSnapshot() !== formBaseline) { e.preventDefault(); e.returnValue = ''; }
});
app.addEventListener('change', (e) => {
  if (e.target.id === 'scanPhotoInput') { const file = e.target.files?.[0]; e.target.value = ''; if (file) scanPhoto(file); return; }
  if (e.target.id === 'restore') { const file = e.target.files?.[0]; if (file) importBackup(file); e.target.value = ''; return; }
  if (e.target.id === 'sortOrder') { sortOrder = ['name','expiry'].includes(e.target.value) ? e.target.value : 'recent'; try { localStorage.setItem('velt.sort', sortOrder); } catch {} updateCollection(); return; }
  if (e.target.name === 'format') updateCodeField();
  updateDirty();
  if (e.target.id === 'photoInput') {
    const name = e.target.files?.[0]?.name || (selected?.photo ? 'Photo attached' : 'No file selected');
    document.querySelector('#photoName')?.replaceChildren(document.createTextNode(name));
  }
});

app.addEventListener('input', (e) => {
  if (e.target.form?.id === 'payRequest' && ['amount','memo'].includes(e.target.name)) payDraft[e.target.name] = e.target.value;
  if (screen === 'form') updateDirty();
  if (e.target.id === 'search') {
    query = e.target.value;
    searchUpdate();
    const wrap = e.target.closest('.search-wrap');
    const existingClear = wrap?.querySelector('#clearSearch');
    if (query && !existingClear && wrap) {
      const btn = document.createElement('button');
      btn.className = 'clear-search';
      btn.id = 'clearSearch';
      btn.setAttribute('aria-label', 'Clear search');
      btn.innerHTML = icon('close');
      wrap.append(btn);
    } else if (!query && existingClear) {
      existingClear.remove();
    }
  }
});

app.addEventListener('click', async (e) => {
  if (busy || tourActions) return;
  const copyTarget = e.target.closest('#copyCode');
  if (copyTarget && selected?.code) {
    try {
      await navigator.clipboard.writeText(selected.code);
      haptic('success');
      toast('Code copied');
    } catch {
      toast('Could not copy');
    }
    return;
  }

  const b = e.target.closest('button');
  if (!b) return;

  if (['payConnect','payDisconnect','payCopyAddress','payRefresh','paySend','payReceive'].includes(b.id)) return payAction(b.id);
  if (b.id === 'retryProfile') return verifyProfile();
  if (b.id === 'pickRestore') { document.querySelector('#restore')?.click(); return; }
  if (b.id === 'pickScanPhoto') { document.querySelector('#scanPhotoInput')?.click(); return; }
  if (b.id === 'pickPhoto') {
    if (screen === 'form') document.querySelector('#photoInput')?.click();
    return;
  }

  if (b.dataset.nav !== undefined) {
    const index = Number(b.dataset.nav);
    haptic('selection');
    if (index === 2) return startNewItem();
    if (index === 3) { await go('pay'); if (screen === 'pay') await loadPay(); return; }
    if (index === 4) return go('settings');
    const destination = index === 1 ? 'favorites' : 'all';
    if (screen !== 'home') await go('home');
    if (screen === 'home') { tab = destination; updateCollection(); }
    return;
  }

  if (b.id === 'loadMore') {
    // If the search has changed but its debounce is still pending, refresh instead.
    const list = document.querySelector('#list .collection');
    const matches = filteredItems();
    const displayed = Array.from(list?.querySelectorAll('[data-id]') || [], el=>el.dataset.id);
    if (!list || displayed.length!==collectionLimit || displayed.some((id,n)=>matches[n]?.id!==id)) { updateCollection(); return; }
    searchUpdate.cancel();
    const next=matches.slice(collectionLimit,collectionLimit+PAGE_SIZE);
    list.insertAdjacentHTML('beforeend',cardsHTML(next,collectionLimit));
    collectionLimit+=next.length;
    if(collectionLimit>=matches.length) b.remove(); else b.textContent=`Show more · ${matches.length-collectionLimit} remaining`;
    return;
  }
  if (b.id === 'showTutorial') return showTutorial(true);
  if (b.id === 'clearSearch') {
    query = '';
    haptic('light');
    const search = document.querySelector('#search');
    if (search) { search.value = ''; search.focus(); }
    b.remove(); updateCollection();
    return;
  }


  if (b.dataset.fav) {
    e.stopPropagation();
    const target = items.find((i) => i.id === b.dataset.fav);
    if (!target) return;
    const updated = items.map((i) => (i.id === target.id ? { ...i, favorite: !i.favorite } : i));
    if (save(updated)) {
      haptic('selection');
      updateCollection({reset:false});
    }
    return;
  }

  if (b.id === 'toggleContrast') {
    highContrast = !highContrast;
    haptic('selection');
    render();
    return;
  }

  if (b.dataset.theme) return setTheme(b.dataset.theme);
  if (b.id === 'settings' || b.id === 'navSettings') {
    haptic('light');
    return go('settings');
  }
  if (b.id === 'cloudPull') return cloudSync('pull');
  if (b.id === 'cloudPush') return cloudSync('push');
  if (b.id === 'legacy') return migrateLegacy();
  if (b.id === 'export') return exportBackup();

  if (b.id === 'nativeQR') {
    try {
      tg.showScanQrPopup({ text: 'Point the camera at a QR code' }, (value) => {
        const formEl = document.querySelector('#form');
        if (!formEl || !value || value.length > 500) return false;
        formEl.elements.code.value = value;
        formEl.elements.format.value = 'QR';
        updateCodeField(); updateDirty();
        haptic('success');
        toast('QR code scanned');
        return true;
      });
    } catch {
      toast('Telegram scanner unavailable. Trying the camera.');
      return startScan();
    }
    return;
  }

  if (b.id === 'scan') return startScan();
  if (b.id === 'stopScan') return stopScan();

  if (b.id === 'favorite') {
    const next = { ...selected, favorite: !selected.favorite };
    if (save(items.map((i) => (i.id === next.id ? next : i)))) {
      selected = next;
      haptic('selection');
      render();
    }
    return;
  }

  if (b.dataset.tab) {
    if (b.classList.contains('reminder-card')) { query = ''; const search = document.querySelector('#search'); if (search) search.value = ''; document.querySelector('#clearSearch')?.remove(); }
    tab = tab === b.dataset.tab && b.classList.contains('quick-tile') ? 'all' : b.dataset.tab;
    haptic('selection');
    updateCollection();
    return;
  }

  if (b.dataset.id) {
    const item = visibleItems().find((i) => i.id === b.dataset.id);
    if (!item) return;
    haptic('light');
    return go('detail', item);
  }

  if (b.classList.contains('back') || b.id === 'cancel') return back();

  if (['add', 'addBottom', 'emptyAdd'].includes(b.id)) {
    haptic('light');
    return startNewItem();
  }

  if (b.id === 'edit') {
    haptic('light');
    go('form');
    return;
  }

  if (b.id === 'delete') {
    const id = selected.id;
    setBusy('Deleting item');
    try {
      if (await telegram.confirm('Delete this item from your wallet?') && save(items.filter(i => i.id !== id))) {
        haptic('warning');
        toast('Item deleted');
        setBusy('');
        await back();
      }
    } finally { setBusy(''); }
    return;
  }

  if (b.id === 'share') return showShare(selected);
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'payRequest' && !payBusy && !transferDialog) return previewPayRequest();
  if (e.target.id !== 'form' || busy || submitFlight || screen !== 'form') return;
  submitFlight = submitItem(e.target).finally(() => { submitFlight = null; });
});

async function submitItem(formEl) {
  const f = new FormData(formEl);
  const name = String(f.get('name')).trim();
  const format = f.get('format');
  const rawCode = String(f.get('code') || '');
  const code = format === 'DATAMATRIX' ? rawCode : rawCode.trim();
  if (f.get('expiresOn') && !validDate(f.get('expiresOn'))) return toast('Enter a valid expiry date');

  if (tg?.initData && !verifiedUser) return toast('Verify your Telegram profile in Settings first');
  if (!name) return toast('Enter an item name');
  if (format !== 'none' && !code) return toast('Enter a code or text');

  setBusy(selected ? 'Updating item' : 'Saving item');
  try {
    if (format === 'DATAMATRIX') {
      if (/[\x00-\x1f\x7f\ufffd]/.test(code)) return toast('Binary or GS1 Data Matrix is not supported. Attach the original code image.');
      try { await drawMatrix(document.createElement('canvas'),code); }
      catch { return toast('Could not render Data Matrix. Check the code or reconnect.'); }
    } else if (format !== 'none' && format !== 'QR') {
      try { await drawBarcode(document.createElementNS('http://www.w3.org/2000/svg','svg'),code,{format}); }
      catch { return toast(navigator.onLine ? `Could not validate ${format}. Check the code or try again.` : 'Barcode validation unavailable offline. Reconnect and try again.'); }
    }
    let photo = selected?.photo || '';
    const file = f.get('photo');
    if (file?.size) {
      try {
        photo = await compress(file);
      } catch {
        return toast('Could not process photo');
      }
    }

    const obj = {
      favorite: !!selected?.favorite,
      id: selected?.id || crypto.randomUUID(),
      name,
      type: Object.hasOwn(types, f.get('type')) ? f.get('type') : 'card',
      color: Object.hasOwn(palettes, f.get('color')) ? f.get('color') : 'graphite',
      note: String(f.get('note')).trim(),
      format,
      code: format === 'none' ? '' : code,
      photo,
      expiresOn: validDate(String(f.get('expiresOn') || '')),
    };

    if (save([obj, ...items.filter((i) => i.id !== obj.id)])) {
      formBaseline = formSnapshot();
      tab = 'all';
      query = '';
      setBusy('');
      await go('home');
      toast('Saved to wallet');
      haptic('success');
    }
  } catch {
    haptic('error');
    toast('Could not save item. Please try again.');
  } finally { setBusy(''); }
}

async function scanPhoto(file) {
  const formEl = document.querySelector('#form');
  const status = document.querySelector('#photoScanStatus');
  if (!formEl || !status || busy) return;
  const say = text => { if (status.isConnected) status.textContent = text; };
  if (file.size > 20 * 1024 * 1024 || !file.type.startsWith('image/')) return say('Choose an image smaller than 20 MB.');
  let bitmap;
  setBusy('Scanning image'); say('Looking for codes…');
  try {
    const {createScanner,openScanImage}=await import('./lib/scanner.js');
    bitmap = await openScanImage(file);
    const detector=await createScanner();
    const candidates = await detector.detect(bitmap);
    if (!formEl.isConnected) return;
    if (!candidates.length) return say('No supported code found. Try a clearer image or enter the code manually.');
    if (candidates.length > 1) {
      say('Multiple codes found. Choose one:');
      candidates.forEach(({format, code}) => {
        const button = document.createElement('button'); button.type='button'; button.className='secondary';
        button.textContent = `${format} · ${code.length > 26 ? code.slice(0,26)+'…' : code}`;
        button.addEventListener('click', () => applyScannedCode(formEl, status, {format,code})); status.append(button);
      });
    } else applyScannedCode(formEl, status, candidates[0]);
  } catch { say('Could not scan this image. Try another photo or enter the code manually.'); }
  finally { bitmap?.close?.(); setBusy(''); }
}
function applyScannedCode(formEl, status, candidate) {
  if (!formEl.isConnected || busy && busy !== 'Scanning image') return;
  formEl.elements.format.value = candidate.format;
  formEl.elements.code.value = candidate.code;
  updateCodeField(); updateDirty();
  status.textContent = 'Code found. Review it before saving.'; haptic('success');
}
function showShare(item) {
  if (!item || document.querySelector('#shareDialog')) return;
  const d = document.createElement('dialog'); d.id='shareDialog'; d.className='share-dialog';
  d.innerHTML = `<div class="sheet-handle"></div><h2>Share item</h2><p>Choose what to share. Attachments and notes stay private.</p>${item.code ? '<label class="share-check"><input type="checkbox" id="includeShareCode"> Include barcode / QR content</label><small>Anyone with the code may be able to use this pass.</small>' : ''}<button class="primary" data-share="telegram">Share to Telegram</button><button class="secondary" data-share="copy">Copy text</button><button class="secondary" data-share="close">Cancel</button>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove(), {once:true});
  d.addEventListener('click', async e => {
    const action=e.target.closest('[data-share]')?.dataset.share; if (!action) return;
    if (action==='close') {d.close();return;}
    const text=shareText(item, !!d.querySelector('#includeShareCode')?.checked);
    if (action==='copy') { try { await navigator.clipboard.writeText(text); d.close(); toast('Copied'); haptic('success'); } catch { toast('Clipboard unavailable'); } return; }
    const url='https://t.me/share/url?url='+encodeURIComponent('https://velt.lumyn.space')+'&text='+encodeURIComponent(text);
    if (!telegram.call(tg,'openTelegramLink',url)) window.open(url,'_blank','noopener,noreferrer');
    d.close();
  });
  d.showModal();
}

async function compress(file) {
  if (file.size > 20 * 1024 * 1024) throw Error();
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * r));
  c.height = Math.max(1, Math.round(bmp.height * r));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.75);
}

async function migrateLegacy() {
  const old = loadItems('velt.items.v1');
  if (!verifiedUser || !old.length) return toast('No legacy items found');
  setBusy('Importing items');
  try {
    if (!await telegram.confirm(`Import ${old.length} local items into your profile?`)) return;
    const ids = new Set(items.map((i) => i.id));
    if (save([...items, ...old.filter((i) => !ids.has(i.id))])) {
      haptic('success');
      toast('Items imported');
      render();
    }
  } finally { setBusy(''); }
}

async function cloudSync(mode) {
  if (!cloudToken || syncing || busy) return;
  const user = verifiedUser.id;
  syncing = true;
  setBusy(mode === 'pull' ? 'Restoring backup' : 'Backing up wallet');
  try {
    const headers = { Authorization: 'Bearer ' + cloudToken, 'Content-Type': 'application/json' };
    let r = await fetch('/api/wallet', { headers, cache: 'no-store' });
    if (!r.ok) throw Error('Cloud temporarily unavailable');
    const remote = await r.json();
    if (mode === 'pull') {
      if (!await telegram.confirm(`Replace local items with cloud backup (${remote.items.length})?`)) return;
      localStorage.setItem(key, JSON.stringify(remote.items));
      items = remote.items;
      revision = remote.revision;
    } else {
      if (!await telegram.confirm(`Update cloud backup (${items.length} items)?`)) return;
      r = await fetch('/api/wallet', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ items, revision: remote.revision }),
      });
      if (r.status === 409) throw Error('Version conflict: refresh your data');
      if (!r.ok) throw Error('Could not save backup');
      revision = (await r.json()).revision;
    }
    cloudStatus = 'Just synced';
    haptic('success');
    toast(cloudStatus);
  } catch (e) {
    cloudStatus = e.message;
    haptic('error');
    toast(cloudStatus);
  } finally {
    syncing = false;
    setBusy('');
    if (verifiedUser?.id === user && (screen === 'settings' || screen === 'home')) render();
  }
}

function exportBackup() {
  if (tg?.initData && !verifiedUser) return toast('Profile is not verified yet');
  const blob = new Blob([JSON.stringify({ version: 1, items }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `velt-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  if (!file || busy) return;
  setBusy('Importing backup');
  try {
    if (file.size > 8 * 1024 * 1024) throw Error();
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 1000) throw Error();
    const next = data.items.map((i) => {
      if (
        !i ||
        !Object.hasOwn(types, i.type) ||
        typeof i.name !== 'string' ||
        !i.name.trim() ||
        !['none', 'CODE128', 'EAN13', 'EAN8', 'QR', 'DATAMATRIX'].includes(i.format)
      ) {
        throw Error();
      }
      return {
        id: crypto.randomUUID(),
        type: i.type,
        color: Object.hasOwn(palettes, i.color) ? i.color : 'graphite',
        name: i.name.slice(0, 80),
        note: String(i.note || '').slice(0, 180),
        code: String(i.code || '').slice(0, 500),
        format: i.format,
        favorite: !!i.favorite,
        expiresOn: validDate(i.expiresOn),
        photo:
          typeof i.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(i.photo)
            ? i.photo
            : '',
      };
    });
    if (await telegram.confirm(`Import ${next.length} items from backup?`) && save([...items, ...next])) {
      haptic('success');
      toast('Backup imported');
      render();
    }
  } catch {
    haptic('error');
    toast('Invalid backup file');
  } finally { setBusy(''); }
}

let scanGeneration = 0;

function stopScan() {
  scanGeneration++;
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
  scanner = null;
  const el = document.querySelector('#scanner');
  if (el) el.hidden = true;
}

async function startScan() {
  stopScan();
  const token = scanGeneration;
  const formEl = document.querySelector('#form');
  if (!formEl) return;

  const box = document.querySelector('#scanner');
  const status = document.querySelector('#scanStatus');
  const video = box.querySelector('video');
  box.hidden = false;

  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'Automatic scanning is not supported. Enter the code manually.';
    return;
  }

  try {
    const {createScanner}=await import('./lib/scanner.js');
    const detector=await createScanner();
    if (token !== scanGeneration) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });

    if (token !== scanGeneration) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    scanStream = stream;
    video.srcObject = stream;
    await video.play();
    if (token !== scanGeneration) return;
    scanner = detector;
    status.textContent = 'Align the barcode, QR or Data Matrix inside the frame';

    async function tick() {
      if (token !== scanGeneration || !scanner) return;
      try {
        const codes = await scanner.detect(video);
        if (token !== scanGeneration) return;
        const c = codes[0];
        if (c) {
          formEl.elements.code.value = c.code;
          formEl.elements.format.value = c.format;
          updateCodeField(); updateDirty();
          stopScan();
          haptic('success');
          toast('Code scanned');
          return;
        }
      } catch {
        if (token === scanGeneration) {stopScan();box.hidden=false;status.textContent="Scanner unavailable. Reconnect or try Scan code from image.";}
        return;
      }
      if (token === scanGeneration) setTimeout(tick, 350);
    }
    tick();
  } catch {
    if (token === scanGeneration) {
      stopScan();
      box.hidden = false;
      status.textContent = 'Camera unavailable. Check permissions or enter the code manually.';
    }
  }
}

document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('app-background',document.hidden);
  if (!document.hidden && screen === 'home') updateCollection();
  if (document.hidden) {
    stopScan();
    wake?.release().catch(() => {}); wake = null;
  } else if (screen === 'detail' && selected?.code && navigator.wakeLock) {
    navigator.wakeLock
      .request('screen')
      .then((w) => {
        if (screen === 'detail' && !document.hidden && !wake) { wake = w; w.addEventListener?.('release', () => { if (wake === w) wake = null; }); }
        else w.release();
      })
      .catch(() => {});
  }
});


render();
verifyProfile().finally(() => showTutorial());
if ('serviceWorker' in navigator && import.meta.env?.PROD) {
  navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'}).catch(() => {});
  // Warm the small code chunks once the service worker controls the page; never warm TON Connect.
  const warm = () => { if (!navigator.onLine || navigator.connection?.saveData) return; const run=()=>warmCodes(); if ('requestIdleCallback' in window) requestIdleCallback(run,{timeout:5000}); else setTimeout(run,1500); };
  if (navigator.serviceWorker.controller) warm(); else navigator.serviceWorker.addEventListener('controllerchange',warm,{once:true});
}
