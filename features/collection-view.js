import { icon, brandMark, brandHTML } from '../components/icons.js';
import { cardStyle, types } from '../core/config.js';
import { esc } from '../core/storage.js';
import { expiryInfo } from '../lib/smart.js';

export function expiryBadge(item) {
  const info = expiryInfo(item);
  return info ? `<span class="expiry-badge ${info.kind}">${esc(info.text)}</span>` : '';
}
export function reminderHTML(items) {
  const all = items.map(item => expiryInfo(item)).filter(Boolean);
  const soon = all.filter(x => x.kind === 'soon').length;
  const expired = all.filter(x => x.kind === 'expired').length;
  if (!soon && !expired) return '';
  return `<button type="button" class="reminder-card" data-tab="expiry"><span class="reminder-icon">${icon('sun')}</span><span><b>Wallet reminders</b><small>${[soon ? `${soon} expiring within 7 days` : '', expired ? `${expired} expired` : ''].filter(Boolean).join(' · ')}</small></span><span class="reminder-arrow">›</span></button>`;
}
export function homeView({items, list, tab, query, sortOrder, status, avatar, title, limit}) {
  const favCount = items.filter((i) => i.favorite).length;

  return `
    <section class="hero">
      <header class="topbar">
        ${brandHTML()}
        <button class="icon-btn" id="settings" aria-label="Settings">${icon('settings')}</button>
      </header>

      <div class="welcome">
        <div class="hero-avatar-wrap">${avatar}</div>
        <h1 class="wallet-title">${title}</h1>
        <p>Cards, tickets and receipts in one place</p>
      </div>

      <div class="quick-grid" aria-label="Categories overview">
        ${Object.entries(types)
          .map(([t, l]) => {
            const count = items.filter((i) => i.type === t).length;
            const active = tab === t;
            return `
              <button class="quick-tile ${active ? 'chosen' : ''}" data-tab="${t}" aria-pressed="${active}">
                <div class="tile-top">
                  <span class="tile-icon">${icon(t)}</span>
                  <span class="tile-count" data-count="${t}">${count}</span>
                </div>
                <b>${l}</b>
              </button>
            `;
          })
          .join('')}
      </div>
    </section>

    <section class="wallet-section">
      <div class="sectionhead">
        <div>
          <h2>Collection</h2>
          <p class="status-line"><span class="storage-icon">${icon('device')}</span><span id="walletStatus" role="status">${esc(status)}</span></p>
        </div>
        <button class="add-pill" id="add" aria-label="Add item">
          ${icon('plus')}
          <span>Add</span>
        </button>
      </div>

      <div id="reminders">${reminderHTML(items)}</div>
      <div class="search-wrap">
        <label class="search">
          ${icon('search')}
          <input id="search" type="search" placeholder="Search your wallet…" value="${esc(query)}" autocomplete="off">
        </label>
        ${query ? `<button class="clear-search" id="clearSearch" aria-label="Clear search">${icon('close')}</button>` : ''}
      </div>

      <div class="tabs" role="tablist">
        ${[
          ['all', `All (${items.length})`],
          ['favorites', `Favorites${favCount ? ` (${favCount})` : ''}`],
          ...Object.entries(types),
          ['expiry', 'Expiry'],
        ]
          .map(
            ([t, l]) =>
              `<button role="tab" aria-selected="${tab === t}" class="${tab === t ? 'active' : ''}" data-tab="${t}">${l}</button>`
          )
          .join('')}
      </div>

      <div class="collection-tools"><span id="resultCount" aria-live="polite">${list.length} ${pluralize(list.length)}</span><label class="sort-control"><span>Sort</span><select id="sortOrder" aria-label="Sort wallet"><option value="recent" ${sortOrder === 'recent' ? 'selected' : ''}>Recent</option><option value="name" ${sortOrder === 'name' ? 'selected' : ''}>A–Z</option><option value="expiry" ${sortOrder === 'expiry' ? 'selected' : ''}>Expiry</option></select></label></div>
      <div id="list">${listHTML(list, {query, tab, limit})}</div>
    </section>

  `;
}

export function pluralize(n) { return n === 1 ? 'item' : 'items'; }

export function listHTML(list, {query = '', tab = 'all', limit = 40} = {}) {
  if (!list.length) {
    return `
      <div class="empty">
        <span class="empty-mark">${brandMark()}</span>
        <h3>${query ? 'No results found' : tab === 'favorites' ? 'No favorites yet' : tab === 'expiry' ? 'No expiry reminders' : 'Your wallet is empty'}</h3>
        <p>${
          query
            ? 'Try another search or clear the filter.'
            : tab === 'favorites'
              ? 'Star an item for quick access.'
              : tab === 'expiry' ? 'Items expiring within seven days or already expired appear here.' : 'Add a card, ticket or note in seconds.'
        }</p>
        ${
          !query && !['favorites','expiry'].includes(tab)
            ? `<button class="primary" id="emptyAdd">${icon('plus')} Add your first item</button>`
            : ''
        }
      </div>
    `;
  }

  return `
    <div class="collection">
      ${cardsHTML(list.slice(0, limit))}
    </div>
    ${list.length > limit ? `<button class="secondary load-more" type="button" id="loadMore">Show more · ${list.length-limit} remaining</button>` : ''}
  `;
}

function formatCodePreview(code) {
  if (code.length <= 16) return code.replace(/(.{4})/g, '$1 ').trim();
  return '•••• ' + code.slice(-6);
}


export function cardsHTML(list, offset = 0) { return list
        .map(
          (i, idx) => `
          <div class="wallet-card-wrap" style="--delay:${Math.min((idx + offset) * 35, 240)}ms">
            <button class="wallet-item" style="${cardStyle(i)}" data-id="${esc(i.id)}">
              <div class="wallet-top">
                <span class="wallet-badge">${icon(i.type)} ${types[i.type]}</span>
                <span class="wallet-format">${i.format !== 'none' ? esc(i.format) : 'Note'}</span>
              </div>
              <div class="wallet-body">
                <strong>${esc(i.name)}</strong>
                <span class="wallet-note">${esc(i.note || (i.code ? formatCodePreview(i.code) : 'Open item'))}</span>
                ${expiryBadge(i)}
              </div>
            </button>
            <button class="quick-fav ${i.favorite ? 'is-fav' : ''}" data-fav="${esc(i.id)}" aria-label="Toggle favorite">
              ${icon(i.favorite ? 'starFilled' : 'star')}
            </button>
          </div>
        `
        )
        .join(''); }

export function detailSidebar(items, selected, limit = 40) {
  const rows = items.slice(0, limit);
  if (selected && !rows.some(item => item.id === selected.id)) rows.push(selected);
  return `<aside class="detail-sidebar" aria-label="Wallet collection"><div class="sidebar-heading"><h2>Collection</h2><button class="secondary back" type="button">All items</button></div><p class="sidebar-count">${rows.length} of ${items.length} ${pluralize(items.length)}</p><div class="sidebar-list">${rows.map(item => `<button type="button" class="sidebar-item" data-id="${esc(item.id)}" ${item.id === selected?.id ? 'aria-current="true"' : ''}><span class="sidebar-icon">${icon(item.type)}</span><span><b>${esc(item.name)}</b><small>${esc(types[item.type] || 'Item')}</small></span></button>`).join('')}</div></aside>`;
}
