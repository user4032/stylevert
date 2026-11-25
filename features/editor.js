import { icon, brandHTML } from '../components/icons.js';
import { types, palettes, cardStyle } from '../core/config.js';
import { esc } from '../core/storage.js';
import { validDate } from '../lib/smart.js';
import { expiryBadge } from './collection-view.js';

export function editorView({selected, telegram, tg, verifiedUser, authStatus}) {
  const i = selected || {};
  return `
    <div class="sheet-page">
      <div class="sheet-backdrop"></div>
      <div class="sheet-panel">
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="topbar sheet-topbar">
          <div class="page-title">${selected ? 'Edit item' : 'New item'}</div>
          <button class="icon-btn back" id="closeForm" type="button" aria-label="Close">${icon('close')}</button>
        </header>

        <form id="form" class="card-form">
          <div class="segmented-type">
            ${Object.entries(types)
              .map(
                ([t, l]) => `
                <label class="seg-option">
                  <input type="radio" name="type" value="${t}" ${(i.type || 'card') === t ? 'checked' : ''}>
                  <span>${icon(t)} ${l}</span>
                </label>
              `
              )
              .join('')}
          </div>

          <label class="field">
            <span>Name</span>
            <input required maxlength="80" name="name" placeholder="e.g. Coffee Club or train ticket" value="${esc(i.name || '')}">
          </label>

          <div class="field">
            <span>Card appearance</span>
            <div class="swatches">
              ${Object.entries(palettes)
                .map(
                  ([k, v]) => `
                  <label class="swatch" style="--swatch-a:${v[0]};--swatch-b:${v[1]}">
                    <input type="radio" name="color" value="${k}" aria-label="${({graphite:"Graphite",blue:"Slate",green:"Silver",violet:"Onyx",rose:"Ash"})[k]}" ${(i.color || 'graphite') === k ? 'checked' : ''}>
                    <span></span>
                  </label>
                `
                )
                .join('')}
            </div>
          </div>

          <div class="scan-actions">
            ${
              telegram.supports('6.4', tg, ['showScanQrPopup', 'closeScanQrPopup'])
                ? `<button type="button" class="secondary scan-btn" id="nativeQR">${icon('qr')} Telegram scanner</button>`
                : ''
            }
            <button type="button" class="secondary scan-btn" id="scan">${icon('qr')} Camera (barcode / QR / Data Matrix)</button>
          </div>

          <button type="button" class="secondary scan-btn photo-scan" id="pickScanPhoto">${icon('qr')} Scan code from image</button>
          <input id="scanPhotoInput" type="file" accept="image/*" hidden>
          <div id="photoScanStatus" class="photo-scan-status" aria-live="polite"></div>
          <div id="scanner" class="scanner-box" hidden>
            <video playsinline muted autoplay></video>
            <div class="scan-frame"></div>
            <p id="scanStatus"></p>
            <button type="button" class="secondary" id="stopScan">Close camera</button>
          </div>

          <div class="two-cols">
            <label class="field">
              <span>Code format</span>
              <select name="format">
                <option value="none" ${(i.format || 'none') === 'none' ? 'selected' : ''}>No code</option>
                ${['CODE128', 'EAN13', 'EAN8', 'QR', 'DATAMATRIX']
                  .map((f) => `<option value="${f}" ${i.format === f ? 'selected' : ''}>${f === 'DATAMATRIX' ? 'Data Matrix' : f}</option>`)
                  .join('')}
              </select>
            </label>

            <label class="field" id="codeField">
              <span>Number / content</span>
              <input maxlength="500" name="code" placeholder="Code or text" value="${esc(i.code || '')}" inputmode="text">
            </label>
          </div>

          <label class="field">
            <span>Note</span>
            <input maxlength="180" name="note" placeholder="Membership, seat or expiry details" value="${esc(i.note || '')}">
          </label>

          <label class="field">
            <span>Valid until (optional)</span>
            <input type="date" name="expiresOn" min="1900-01-01" max="9999-12-31" value="${esc(validDate(i.expiresOn))}">
            <small class="field-help">See reminders in your wallet 7 days before expiry.</small>
          </label>
          <div class="field file-field">
            <span>${i.photo ? 'Replace attachment' : 'Attach a photo (optional)'}</span>
            <div class="file-control">
              <button class="file-button" id="pickPhoto" type="button" aria-controls="photoInput" aria-describedby="photoName">${icon('plus')} Add file</button>
              <span class="file-name" id="photoName" aria-live="polite">${i.photo ? 'Photo attached' : 'No file selected'}</span>
            </div>
            <input class="file-input" id="photoInput" type="file" name="photo" accept="image/*" hidden>
          </div>

          <p class="muted">Do not store bank card security codes or passwords.</p>
          ${tg?.initData && !verifiedUser ? `<p class="auth-notice" role="status">${esc(authStatus)}. Go to Settings to retry.</p>` : ''}
          <div class="form-actions">
            <button class="secondary" type="button" id="cancel">Cancel</button>
            <button class="primary" type="submit">${selected ? 'Update item' : 'Save to wallet'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function detailView({selected, highContrast}) {
  const i = selected;
  const hasCode = i.code && i.format !== 'none';
  return `
    <div class="subpage ${highContrast ? 'scanner-mode' : ''}">
      <header class="topbar">
        <button class="icon-btn back" aria-label="Back">${icon('arrow')}</button>
        ${brandHTML()}
        <div class="top-actions">
          ${
            hasCode
              ? `<button class="icon-btn ${highContrast ? 'active-pill' : ''}" id="toggleContrast" aria-label="High contrast mode">${icon('sun')}</button>`
              : ''
          }
          <button class="icon-btn" id="share" aria-label="Share">${icon('share')}</button>
        </div>
      </header>

      <div class="detailcard" style="${cardStyle(i)}">
        <div class="detail-head">
          <span class="wallet-badge">${icon(i.type)} ${types[i.type]}</span>
          <button class="card-star-btn" id="favorite" aria-label="Favorites">
            ${icon(i.favorite ? 'starFilled' : 'star')}
          </button>
        </div>
        <h1>${esc(i.name)}</h1>
        ${i.note ? `<p>${esc(i.note)}</p>` : ''}
      </div>

      ${i.expiresOn && validDate(i.expiresOn) ? `<div class="expiry-detail">${expiryBadge(i)}<small>Valid through ${esc(i.expiresOn)}</small></div>` : ''}
      ${
        hasCode
          ? `
          <div class="codebox" id="copyCode" role="button" tabindex="0" title="Tap to copy">
            <canvas id="qr" ${['QR','DATAMATRIX'].includes(i.format) ? '' : 'hidden'}></canvas>
            <svg id="barcode" ${['QR','DATAMATRIX'].includes(i.format) ? 'hidden' : ''}></svg>
            <p id="codeError"></p>
            <div class="code-footer">
              <code>${esc(i.code)}</code>
              <span class="copy-hint">${icon('copy')} Copy</span>
            </div>
          </div>
        `
          : ''
      }

      ${
        i.photo && /^data:image\/(jpeg|png|webp);base64,/.test(i.photo)
          ? `<img class="photo" src="${esc(i.photo)}" alt="Saved attachment">`
          : ''
      }

      <div class="action-grid">
        <button class="secondary" id="edit" data-native-action="secondary">${icon('edit')} Edit</button>
        <button class="secondary danger" id="delete">${icon('trash')} Delete</button>
      </div>

      <p class="muted">Screen stays awake on supported devices. Tap the code to copy it.</p>
    </div>
  `;
}

