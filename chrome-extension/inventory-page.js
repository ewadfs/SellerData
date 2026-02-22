/**
 * Inventory Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/myinventory/inventory
 *          (Manage Inventory page)
 *
 * Features:
 *   1. Change Tracking — monitors inline edits (price, quantity, images,
 *      copy) and logs every saved change with timestamp.
 *   2. Changelog Column — injects an extra "Changes" column into the
 *      inventory table showing the recent change history per listing.
 *   3. Persistent Storage — change log is stored in chrome.storage.local
 *      so it survives page reloads and browser restarts.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const STORAGE_KEY = 'sd_inventory_changelog';
  const COL_CLASS = 'sd-inv-changes-col';
  const HEADER_CLASS = 'sd-inv-changes-header';
  const MAX_LOG_ENTRIES = 50; // per SKU

  // Fields we track for change detection
  const TRACKED_FIELDS = ['price', 'quantity', 'title', 'image', 'status'];

  // ============================================================
  // HELPERS
  // ============================================================

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function formatDate(date) {
    const d = date || new Date();
    const mon = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const hour = d.getHours();
    const min = String(d.getMinutes()).padStart(2, '0');
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${mon} ${day}, ${h}:${min} ${ampm}`;
  }

  // ============================================================
  // CHANGELOG STORAGE (chrome.storage.local)
  // ============================================================

  /**
   * Changelog shape:
   * {
   *   "SKU-123": [
   *     { field: "price", oldVal: "19.99", newVal: "24.99", date: "2026-02-22T..." },
   *     { field: "image", oldVal: "", newVal: "updated", date: "2026-02-20T..." },
   *     ...
   *   ],
   *   ...
   * }
   */

  function loadChangelog() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] || {});
      });
    });
  }

  function saveChangelog(changelog) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: changelog }, resolve);
    });
  }

  async function addChangeEntry(sku, field, oldVal, newVal) {
    if (!sku || oldVal === newVal) return;

    const changelog = await loadChangelog();
    if (!changelog[sku]) changelog[sku] = [];

    changelog[sku].unshift({
      field,
      oldVal: String(oldVal || '').substring(0, 200),
      newVal: String(newVal || '').substring(0, 200),
      date: new Date().toISOString()
    });

    // Trim to max entries
    if (changelog[sku].length > MAX_LOG_ENTRIES) {
      changelog[sku] = changelog[sku].slice(0, MAX_LOG_ENTRIES);
    }

    await saveChangelog(changelog);
    return changelog;
  }

  // ============================================================
  // ROW DISCOVERY & DATA EXTRACTION
  // ============================================================

  function getInventoryTable() {
    const selectors = [
      'table[data-testid*="inventory"]',
      'table[data-testid*="product"]',
      '#myitable',
      '.mt-table',
      'table.a-table',
      'kat-table',
      '[data-testid="manage-inventory-table"]',
      'table'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.querySelectorAll('tr, kat-table-row, [role="row"]').length > 2) return el;
    }
    return null;
  }

  function getInventoryRows() {
    const table = getInventoryTable();
    if (!table) return [];

    const selectors = [
      'tbody tr[data-asin]',
      'tbody tr[data-sku]',
      'tbody tr',
      'kat-table-row',
      '[role="row"]'
    ];

    for (const sel of selectors) {
      const rows = table.querySelectorAll(sel);
      const filtered = Array.from(rows).filter(r =>
        !r.querySelector('th') && r.textContent.trim().length > 10
      );
      if (filtered.length > 0) return filtered;
    }
    return [];
  }

  function getHeaderRow() {
    const table = getInventoryTable();
    if (!table) return null;
    return table.querySelector('thead tr, tr:has(th), kat-table-header-row, [role="row"]:first-child');
  }

  /**
   * Extract the SKU identifier from a row.
   */
  function getRowSku(row) {
    // Data attributes
    if (row.dataset.sku) return row.dataset.sku;
    if (row.dataset.msku) return row.dataset.msku;

    // Look for SKU cell
    const skuEl = row.querySelector(
      '[data-testid*="sku"], [data-testid*="SKU"], [class*="sku"], [class*="SKU"]'
    );
    if (skuEl) {
      const text = skuEl.textContent.trim();
      if (text.length > 0 && text.length < 100) return text;
    }

    // Search cells for SKU-like text (alphanumeric with dashes, not too long)
    const cells = row.querySelectorAll('td');
    for (const cell of cells) {
      const text = cell.textContent.trim();
      // SKUs are typically alphanumeric with dashes/underscores, 3-50 chars
      if (/^[A-Za-z0-9_-]{3,50}$/.test(text)) return text;
    }

    // Fallback to ASIN
    if (row.dataset.asin) return row.dataset.asin;
    const asinEl = row.querySelector('[data-testid*="asin"], [class*="asin"]');
    if (asinEl) return asinEl.textContent.trim();

    return null;
  }

  /**
   * Extract the ASIN from a row.
   */
  function getRowAsin(row) {
    if (row.dataset.asin) return row.dataset.asin;
    const asinEl = row.querySelector('[data-testid*="asin"], [class*="asin"]');
    if (asinEl) return asinEl.textContent.trim();
    // Look for 10-char alphanumeric (ASIN pattern)
    const match = (row.innerHTML || '').match(/\b(B[A-Z0-9]{9})\b/);
    return match ? match[1] : '';
  }

  /**
   * Snapshot the current editable values from a row.
   */
  function snapshotRow(row) {
    const snap = {};

    // Price — find price input or display
    const priceInput = row.querySelector(
      'input[name*="price"], input[data-testid*="price"], input[id*="price"]'
    );
    if (priceInput) {
      snap.price = priceInput.value.trim();
    } else {
      const priceEl = row.querySelector(
        '[data-testid*="price"], [class*="price"], [class*="Price"]'
      );
      if (priceEl) snap.price = priceEl.textContent.trim().replace(/[^0-9.,]/g, '');
    }

    // Quantity
    const qtyInput = row.querySelector(
      'input[name*="quantity"], input[name*="qty"], input[data-testid*="quantity"], input[data-testid*="qty"]'
    );
    if (qtyInput) {
      snap.quantity = qtyInput.value.trim();
    } else {
      const qtyEl = row.querySelector(
        '[data-testid*="quantity"], [data-testid*="qty"], [class*="quantity"], [class*="qty"]'
      );
      if (qtyEl) snap.quantity = qtyEl.textContent.trim().replace(/[^0-9]/g, '');
    }

    // Title / product name
    const titleEl = row.querySelector(
      '[data-testid*="title"], [data-testid*="product-name"], [class*="product-title"], ' +
      '[class*="productTitle"], a[href*="/dp/"], a[href*="/product/"]'
    );
    if (titleEl) snap.title = titleEl.textContent.trim().substring(0, 200);

    // Image — capture src of the product thumbnail
    const imgEl = row.querySelector('img[src*="images-amazon"], img[src*="media-amazon"], img.product-image, img');
    if (imgEl) snap.image = imgEl.src || '';

    // Status
    const statusEl = row.querySelector(
      '[data-testid*="status"], [class*="status"], [class*="Status"]'
    );
    if (statusEl) snap.status = statusEl.textContent.trim();

    return snap;
  }

  // ============================================================
  // CHANGE DETECTION
  // ============================================================

  // Stores initial snapshots keyed by SKU
  const snapshots = {};

  // Track which fields have been edited (unsaved) per SKU
  const pendingEdits = {};

  function captureSnapshots() {
    const rows = getInventoryRows();
    rows.forEach(row => {
      const sku = getRowSku(row);
      if (!sku) return;
      if (!snapshots[sku]) {
        snapshots[sku] = snapshotRow(row);
      }
    });
  }

  /**
   * Detect changes between the snapshot and current row values.
   * Returns an array of { field, oldVal, newVal } objects.
   */
  function detectChanges(row, sku) {
    const snap = snapshots[sku];
    if (!snap) return [];

    const current = snapshotRow(row);
    const changes = [];

    for (const field of TRACKED_FIELDS) {
      if (snap[field] !== undefined && current[field] !== undefined) {
        const oldVal = snap[field];
        const newVal = current[field];
        if (oldVal !== newVal && newVal !== '') {
          changes.push({ field, oldVal, newVal });
        }
      }
    }

    return changes;
  }

  /**
   * Monitor input fields within a row for changes.
   */
  function watchRowInputs(row) {
    if (row.dataset.sdWatching) return;
    row.dataset.sdWatching = '1';

    const sku = getRowSku(row);
    if (!sku) return;

    // Watch all inputs in the row
    const inputs = row.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      if (input.dataset.sdWatching) return;
      input.dataset.sdWatching = '1';

      const fieldType = identifyFieldType(input);
      if (!fieldType) return;

      // Record initial value
      let initialValue = input.value;

      input.addEventListener('focus', () => {
        initialValue = input.value;
      });

      input.addEventListener('change', () => {
        if (input.value !== initialValue) {
          if (!pendingEdits[sku]) pendingEdits[sku] = {};
          pendingEdits[sku][fieldType] = { oldVal: initialValue, newVal: input.value };
        }
      });

      input.addEventListener('blur', () => {
        if (input.value !== initialValue) {
          if (!pendingEdits[sku]) pendingEdits[sku] = {};
          pendingEdits[sku][fieldType] = { oldVal: initialValue, newVal: input.value };
        }
      });
    });
  }

  /**
   * Identify what type of field an input represents.
   */
  function identifyFieldType(input) {
    const name = (input.name || '').toLowerCase();
    const testid = (input.dataset.testid || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const context = [name, testid, id, placeholder].join(' ');

    if (/price|cost|amount/.test(context)) return 'price';
    if (/quantity|qty|units|stock/.test(context)) return 'quantity';
    if (/title|name|product.?name/.test(context)) return 'title';
    if (/image|photo|img/.test(context)) return 'image';

    return null;
  }

  // ============================================================
  // SAVE DETECTION
  // ============================================================

  /**
   * Watch for save button clicks throughout the inventory page.
   * Amazon uses various save patterns: per-row save, bulk save, auto-save.
   */
  function watchForSaves() {
    // Strategy 1: Click listener on save-like buttons
    document.addEventListener('click', async (e) => {
      const target = e.target.closest(
        'button, input[type="submit"], a, kat-button, [role="button"], span[role="button"]'
      );
      if (!target) return;

      const text = (target.textContent || target.value || target.getAttribute('label') || '').toLowerCase().trim();
      const testid = (target.dataset.testid || '').toLowerCase();

      const isSave = text.includes('save') || text.includes('apply') || text.includes('update') ||
                     text.includes('submit') || testid.includes('save') || testid.includes('submit');

      if (!isSave) return;

      // Give Amazon a moment to process the save
      await sleep(1500);

      // Find which row this save belongs to
      const row = target.closest('tr, [role="row"], kat-table-row');
      if (row) {
        await processSaveForRow(row);
      } else {
        // Could be a bulk/page-level save — check all rows
        await processAllRows();
      }
    }, true);

    // Strategy 2: Watch for Enter key in inputs (Amazon often saves on Enter)
    document.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('input');
      if (!input) return;

      const row = input.closest('tr, [role="row"], kat-table-row');
      if (!row) return;

      await sleep(1500);
      await processSaveForRow(row);
    }, true);

    // Strategy 3: Intercept XHR/fetch to detect AJAX saves
    interceptSaveRequests();
  }

  /**
   * Process a single row after a save action.
   */
  async function processSaveForRow(row) {
    const sku = getRowSku(row);
    if (!sku) return;

    // Check if we have pending edits for this SKU
    if (pendingEdits[sku]) {
      for (const [field, change] of Object.entries(pendingEdits[sku])) {
        await addChangeEntry(sku, field, change.oldVal, change.newVal);
      }
      delete pendingEdits[sku];
    }

    // Also do a snapshot diff in case we missed input events
    const changes = detectChanges(row, sku);
    for (const change of changes) {
      await addChangeEntry(sku, change.field, change.oldVal, change.newVal);
    }

    // Update snapshot to new values
    snapshots[sku] = snapshotRow(row);

    // Refresh the changelog column
    await refreshChangelogColumn();
  }

  /**
   * Process all visible rows (for bulk saves).
   */
  async function processAllRows() {
    const rows = getInventoryRows();
    for (const row of rows) {
      const sku = getRowSku(row);
      if (!sku) continue;

      const changes = detectChanges(row, sku);
      if (changes.length === 0 && !pendingEdits[sku]) continue;

      if (pendingEdits[sku]) {
        for (const [field, change] of Object.entries(pendingEdits[sku])) {
          await addChangeEntry(sku, field, change.oldVal, change.newVal);
        }
        delete pendingEdits[sku];
      }

      for (const change of changes) {
        await addChangeEntry(sku, change.field, change.oldVal, change.newVal);
      }

      snapshots[sku] = snapshotRow(row);
    }

    await refreshChangelogColumn();
  }

  /**
   * Intercept XMLHttpRequest and fetch to detect save requests.
   * When Amazon saves listing data via AJAX, we can detect URL patterns.
   */
  function interceptSaveRequests() {
    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const method = args[1]?.method || 'GET';

        if (method.toUpperCase() !== 'GET' && isSaveUrl(url)) {
          // A save request was made — process after a delay
          setTimeout(() => processAllRows(), 2000);
        }
      } catch { /* ignore */ }

      return response;
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._sdMethod = method;
      this._sdUrl = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      if (this._sdMethod && this._sdMethod.toUpperCase() !== 'GET' && isSaveUrl(this._sdUrl || '')) {
        this.addEventListener('load', () => {
          setTimeout(() => processAllRows(), 2000);
        });
      }
      return originalSend.apply(this, arguments);
    };
  }

  /**
   * Check if a URL looks like a listing save endpoint.
   */
  function isSaveUrl(url) {
    return /inventory.*save/i.test(url) ||
           /listing.*update/i.test(url) ||
           /product.*save/i.test(url) ||
           /myinventory.*save/i.test(url) ||
           /edit.*listing/i.test(url) ||
           /update.*price/i.test(url) ||
           /update.*quantity/i.test(url) ||
           /manage.*inventory.*update/i.test(url);
  }

  // ============================================================
  // CHANGELOG COLUMN INJECTION
  // ============================================================

  let changelogCache = {};

  async function refreshChangelogColumn() {
    changelogCache = await loadChangelog();
    injectChangelogColumn();
  }

  function injectChangelogColumn() {
    const table = getInventoryTable();
    if (!table) return;

    // Add header cell if not present
    const headerRow = getHeaderRow();
    if (headerRow && !headerRow.querySelector('.' + HEADER_CLASS)) {
      const th = document.createElement('th');
      th.className = HEADER_CLASS;
      th.innerHTML = `
        <div class="sd-inv-header-content">
          <span class="sd-inv-header-label">SellerData Changes</span>
          <button class="sd-inv-clear-all-btn" id="sd-inv-clear-all" title="Clear all change history">Clear</button>
        </div>
      `;
      headerRow.appendChild(th);

      document.getElementById('sd-inv-clear-all').addEventListener('click', async () => {
        if (confirm('Clear all inventory change history?')) {
          await saveChangelog({});
          changelogCache = {};
          injectChangelogColumn();
        }
      });
    }

    // Add changelog cell to each row
    const rows = getInventoryRows();
    rows.forEach(row => {
      const sku = getRowSku(row);

      // Remove existing cell to refresh
      const existing = row.querySelector('.' + COL_CLASS);
      if (existing) existing.remove();

      const td = document.createElement('td');
      td.className = COL_CLASS;

      if (!sku) {
        td.innerHTML = '<span class="sd-inv-no-sku">—</span>';
        row.appendChild(td);
        return;
      }

      const entries = changelogCache[sku] || [];
      if (entries.length === 0) {
        td.innerHTML = '<span class="sd-inv-no-changes">No changes</span>';
      } else {
        // Show the most recent entries (up to 5 visible, rest in expandable)
        const visibleCount = 3;
        const visible = entries.slice(0, visibleCount);
        const hidden = entries.slice(visibleCount);

        let html = '<div class="sd-inv-changes-list">';
        visible.forEach(entry => {
          html += buildEntryHTML(entry);
        });

        if (hidden.length > 0) {
          const expandId = `sd-inv-expand-${sku.replace(/[^a-zA-Z0-9]/g, '_')}`;
          html += `<div class="sd-inv-more-entries hidden" id="${expandId}">`;
          hidden.forEach(entry => {
            html += buildEntryHTML(entry);
          });
          html += `</div>`;
          html += `<button class="sd-inv-show-more" data-target="${expandId}">+${hidden.length} more</button>`;
        }
        html += '</div>';

        // Clear button per SKU
        html += `<button class="sd-inv-clear-btn" data-sku="${sku}" title="Clear history for this SKU">clear</button>`;

        td.innerHTML = html;
      }

      row.appendChild(td);
    });

    // Attach event handlers for expand/clear buttons
    document.querySelectorAll('.sd-inv-show-more').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) {
          const isHidden = target.classList.toggle('hidden');
          btn.textContent = isHidden ? btn.textContent : 'show less';
          if (isHidden) {
            const count = target.querySelectorAll('.sd-inv-change-entry').length;
            btn.textContent = `+${count} more`;
          }
        }
      });
    });

    document.querySelectorAll('.sd-inv-clear-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sku = btn.dataset.sku;
        const changelog = await loadChangelog();
        delete changelog[sku];
        await saveChangelog(changelog);
        changelogCache = changelog;
        injectChangelogColumn();
      });
    });
  }

  function buildEntryHTML(entry) {
    const date = new Date(entry.date);
    const dateStr = formatDate(date);
    const fieldLabel = getFieldLabel(entry.field);
    const icon = getFieldIcon(entry.field);

    let detailHTML = '';
    if (entry.field === 'price') {
      detailHTML = `<span class="sd-inv-old-val">$${entry.oldVal}</span> → <span class="sd-inv-new-val">$${entry.newVal}</span>`;
    } else if (entry.field === 'quantity') {
      detailHTML = `<span class="sd-inv-old-val">${entry.oldVal}</span> → <span class="sd-inv-new-val">${entry.newVal}</span>`;
    } else if (entry.field === 'image') {
      detailHTML = '<span class="sd-inv-new-val">updated</span>';
    } else if (entry.field === 'title') {
      const oldShort = (entry.oldVal || '').substring(0, 40);
      const newShort = (entry.newVal || '').substring(0, 40);
      detailHTML = `<span class="sd-inv-old-val" title="${entry.oldVal}">${oldShort}...</span> → <span class="sd-inv-new-val" title="${entry.newVal}">${newShort}...</span>`;
    } else {
      detailHTML = `<span class="sd-inv-old-val">${entry.oldVal}</span> → <span class="sd-inv-new-val">${entry.newVal}</span>`;
    }

    return `
      <div class="sd-inv-change-entry">
        <span class="sd-inv-change-icon">${icon}</span>
        <span class="sd-inv-change-field">${fieldLabel}:</span>
        <span class="sd-inv-change-detail">${detailHTML}</span>
        <span class="sd-inv-change-date">${dateStr}</span>
      </div>
    `;
  }

  function getFieldLabel(field) {
    const labels = {
      price: 'Price',
      quantity: 'Qty',
      title: 'Title',
      image: 'Image',
      status: 'Status'
    };
    return labels[field] || field;
  }

  function getFieldIcon(field) {
    const icons = {
      price: '$',
      quantity: '#',
      title: 'T',
      image: '\u25A3',
      status: '\u25CF'
    };
    return icons[field] || '\u2022';
  }

  // ============================================================
  // PERIODIC SNAPSHOT REFRESH
  // ============================================================

  /**
   * Periodically check for image changes (since image swaps don't fire
   * input events — the src just changes).
   */
  function watchImageChanges() {
    setInterval(() => {
      const rows = getInventoryRows();
      rows.forEach(row => {
        const sku = getRowSku(row);
        if (!sku || !snapshots[sku]) return;

        const imgEl = row.querySelector('img[src*="images-amazon"], img[src*="media-amazon"], img');
        if (!imgEl) return;

        const currentSrc = imgEl.src || '';
        const oldSrc = snapshots[sku].image || '';

        if (oldSrc && currentSrc && oldSrc !== currentSrc) {
          // Image changed
          addChangeEntry(sku, 'image', 'previous image', 'new image').then(() => {
            snapshots[sku].image = currentSrc;
            refreshChangelogColumn();
          });
        }
      });
    }, 5000); // Check every 5 seconds
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isInventoryPage() {
    const url = window.location.href;
    return /\/myinventory\/inventory/.test(url) || /\/inventory\?/.test(url);
  }

  async function init() {
    if (!isInventoryPage()) return;

    // Wait for the inventory table to render
    try {
      await waitForElement(
        'table, kat-table, [data-testid*="inventory"], [data-testid*="product"], #myitable, .mt-table',
        20000
      );
    } catch {
      // May be a different layout
    }

    // Wait for dynamic content
    await sleep(1500);

    // Capture initial snapshots
    captureSnapshots();

    // Load existing changelog and inject column
    await refreshChangelogColumn();

    // Watch inputs on existing rows
    getInventoryRows().forEach(row => watchRowInputs(row));

    // Watch for save actions
    watchForSaves();

    // Watch for image changes
    watchImageChanges();

    // MutationObserver for dynamic updates (pagination, AJAX re-renders)
    const observer = new MutationObserver(async () => {
      captureSnapshots();
      getInventoryRows().forEach(row => watchRowInputs(row));
      await refreshChangelogColumn();
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });

    console.log('[SellerData] Inventory change tracking initialized');
  }

  init();
})();
