/**
 * Deals Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/merchandising-new/create
 *          (and the deals dashboard at /merchandising-new)
 *
 * Features:
 *   1. Country / marketplace toggle — filter eligible deals by marketplace.
 *   2. Select individual deals or select-all for the visible country.
 *   3. Auto-create button — fills minimum price & quantity for each selected
 *      deal and submits them in sequence.
 *   4. Fix All Needs Attention — on the dashboard, finds deals with
 *      "needs attention" status, opens each one, sets price & quantity
 *      to the minimum required, and saves them automatically.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const TOOLBAR_ID = 'sd-deals-toolbar';
  const PROGRESS_ID = 'sd-deals-progress';
  const FIX_BTN_ID = 'sd-deal-fix-attention';
  const FIX_PROGRESS_ID = 'sd-fix-progress';
  const FIX_LOG_ID = 'sd-fix-log';

  // Marketplace country codes and labels.
  // Seller Central uses domain TLDs and sometimes data attributes to
  // indicate marketplace.  We also detect from the URL domain itself.
  const MARKETPLACES = {
    US: { label: 'US', tld: '.com', patterns: ['ATVPDKIKX0DER', 'US', 'amazon.com'] },
    UK: { label: 'UK', tld: '.co.uk', patterns: ['A1F83G8C2ARO7P', 'UK', 'GB', 'amazon.co.uk'] },
    DE: { label: 'DE', tld: '.de', patterns: ['A1PA6795UKMFR9', 'DE', 'amazon.de'] },
    FR: { label: 'FR', tld: '.fr', patterns: ['A13V1IB3VIYZZH', 'FR', 'amazon.fr'] },
    IT: { label: 'IT', tld: '.it', patterns: ['APJ6JRA9NG5V4', 'IT', 'amazon.it'] },
    ES: { label: 'ES', tld: '.es', patterns: ['A1RKKUPIHCS9HS', 'ES', 'amazon.es'] },
    CA: { label: 'CA', tld: '.ca', patterns: ['A2EUQ1WTGCTBG2', 'CA', 'amazon.ca'] },
    JP: { label: 'JP', tld: '.co.jp', patterns: ['A1VC38T7YXB528', 'JP', 'amazon.co.jp'] },
    AU: { label: 'AU', tld: '.com.au', patterns: ['A39IBJ37TRP1C6', 'AU', 'amazon.com.au'] },
    MX: { label: 'MX', tld: '.com.mx', patterns: ['A1AM78C64UM0Y8', 'MX', 'amazon.com.mx'] }
  };

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

  /**
   * Set a value on an input / select in a React-friendly way.
   */
  function setNativeValue(el, value) {
    const proto = el.tagName === 'SELECT'
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Detect the current Seller Central domain's marketplace.
   */
  function detectCurrentMarketplace() {
    const host = window.location.hostname;
    for (const [code, mp] of Object.entries(MARKETPLACES)) {
      if (host.includes(mp.tld) && mp.tld !== '.com') return code;
    }
    // .com could be US, CA, MX, AU — default to US for sellercentral.amazon.com
    if (host.includes('sellercentral.amazon.com')) return 'US';
    return 'US';
  }

  // ============================================================
  // DEAL ROW DISCOVERY
  // ============================================================

  /**
   * Get all deal product rows / cards from the page.
   * Amazon's deals page uses various layouts — try multiple selectors.
   */
  function getDealRows() {
    const selectors = [
      '[data-testid="deal-product-row"]',
      '[data-testid="recommendation-row"]',
      '.recommendation-row',
      '.deal-product-row',
      'tr[data-asin]',
      '.product-row',
      'table.deals-table tbody tr',
      // The deals dashboard often renders each eligible product as a card or row
      '.merchandising-recommendation',
      '[class*="DealRecommendation"]',
      '[class*="deal-recommendation"]',
      '[class*="ProductCard"]',
      // Generic table rows inside the main deals content area
      '.a-table tbody tr',
      'table tbody tr'
    ];
    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      // Filter out header rows and tiny rows
      const filtered = Array.from(rows).filter(r => !r.querySelector('th') && r.textContent.trim().length > 10);
      if (filtered.length > 0) return filtered;
    }
    return [];
  }

  /**
   * Extract marketplace / country info from a deal row.
   * Returns a marketplace code or null.
   */
  function getRowMarketplace(row) {
    const text = row.textContent || '';
    const data = row.innerHTML || '';

    for (const [code, mp] of Object.entries(MARKETPLACES)) {
      for (const pat of mp.patterns) {
        if (text.includes(pat) || data.includes(pat)) return code;
      }
    }

    // Check data attributes
    const mpAttr = row.dataset.marketplace || row.dataset.marketplaceId || '';
    for (const [code, mp] of Object.entries(MARKETPLACES)) {
      if (mp.patterns.includes(mpAttr)) return code;
    }

    // Default to the domain's marketplace
    return detectCurrentMarketplace();
  }

  /**
   * Extract ASIN from a deal row.
   */
  function getRowAsin(row) {
    if (row.dataset.asin) return row.dataset.asin;
    const asinMatch = (row.innerHTML || '').match(/\b[A-Z0-9]{10}\b/);
    return asinMatch ? asinMatch[0] : '';
  }

  /**
   * Extract the product title from a deal row.
   */
  function getRowTitle(row) {
    const titleEl = row.querySelector(
      '[data-testid*="title"], .product-title, .deal-title, .a-text-bold, a[href*="/dp/"]'
    );
    if (titleEl) return titleEl.textContent.trim().substring(0, 80);
    // Fallback: first meaningful text
    const firstCell = row.querySelector('td, .product-info, [class*="product"]');
    if (firstCell) return firstCell.textContent.trim().substring(0, 80);
    return '';
  }

  /**
   * Read the minimum deal price Amazon requires for this row.
   * Amazon typically shows "Min deal price: $X.XX" or populates it in an input.
   */
  function getMinimumDealPrice(row) {
    // Look for text like "Min deal price", "Minimum price", "Deal price"
    const text = row.textContent || '';
    const minPriceMatch = text.match(/(?:min(?:imum)?[\s.]*(?:deal[\s.]*)?price|deal[\s.]*price)[\s:]*\$?([\d,.]+)/i);
    if (minPriceMatch) return parseFloat(minPriceMatch[1].replace(',', ''));

    // Check input placeholders or pre-filled values
    const priceInputs = row.querySelectorAll(
      'input[name*="price"], input[data-testid*="price"], input[placeholder*="price"], input[type="number"]'
    );
    for (const input of priceInputs) {
      const placeholder = input.placeholder || '';
      const minAttr = input.min || '';
      if (minAttr) return parseFloat(minAttr);
      const phMatch = placeholder.match(/\$?([\d,.]+)/);
      if (phMatch) return parseFloat(phMatch[1].replace(',', ''));
    }

    // Look for data attributes
    const minEl = row.querySelector('[data-min-price], [data-minimum-price]');
    if (minEl) {
      return parseFloat(minEl.dataset.minPrice || minEl.dataset.minimumPrice);
    }

    return null;
  }

  /**
   * Read the minimum deal quantity Amazon requires.
   */
  function getMinimumQuantity(row) {
    const text = row.textContent || '';
    const minQtyMatch = text.match(/(?:min(?:imum)?[\s.]*(?:deal[\s.]*)?(?:qty|quantity))[\s:]*(\d+)/i);
    if (minQtyMatch) return parseInt(minQtyMatch[1]);

    const qtyInputs = row.querySelectorAll(
      'input[name*="quantity"], input[name*="qty"], input[data-testid*="quantity"]'
    );
    for (const input of qtyInputs) {
      const minAttr = input.min || '';
      if (minAttr) return parseInt(minAttr);
      const placeholder = input.placeholder || '';
      const phMatch = placeholder.match(/(\d+)/);
      if (phMatch) return parseInt(phMatch[1]);
    }

    const minEl = row.querySelector('[data-min-quantity], [data-minimum-quantity]');
    if (minEl) {
      return parseInt(minEl.dataset.minQuantity || minEl.dataset.minimumQuantity);
    }

    return null;
  }

  // ============================================================
  // 1. COUNTRY TOGGLE + SELECT-ALL + AUTO-CREATE TOOLBAR
  // ============================================================

  let activeCountry = null; // null = show all

  function getMarketplacesOnPage() {
    const rows = getDealRows();
    const codes = new Set();
    rows.forEach(row => codes.add(getRowMarketplace(row)));
    return Array.from(codes);
  }

  function createToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;

    const marketplacesFound = getMarketplacesOnPage();
    // Default to current domain marketplace
    activeCountry = detectCurrentMarketplace();

    const container = document.createElement('div');
    container.id = TOOLBAR_ID;

    // Country buttons
    let countryBtnsHTML = `<button class="sd-deal-country-btn" data-country="ALL">All</button>`;
    const allCodes = marketplacesFound.length > 0 ? marketplacesFound : [detectCurrentMarketplace()];
    allCodes.forEach(code => {
      const label = MARKETPLACES[code]?.label || code;
      countryBtnsHTML += `<button class="sd-deal-country-btn" data-country="${code}">${label}</button>`;
    });

    container.innerHTML = `
      <div class="sd-deal-toolbar-row">
        <div class="sd-deal-country-group">
          <span class="sd-deal-toolbar-label">Country:</span>
          <div class="sd-deal-country-btns">${countryBtnsHTML}</div>
        </div>
        <div class="sd-deal-actions-group">
          <label class="sd-deal-select-all-label">
            <input type="checkbox" id="sd-deal-select-all" />
            <span>Select All</span>
          </label>
          <button class="sd-deal-auto-create-btn" id="sd-deal-auto-create" disabled>
            Auto-Create Selected Deals
          </button>
        </div>
      </div>
      <div class="sd-deal-progress hidden" id="${PROGRESS_ID}">
        <div class="sd-deal-progress-bar"><div class="sd-deal-progress-fill" id="sd-deal-progress-fill"></div></div>
        <span class="sd-deal-progress-text" id="sd-deal-progress-text">0 / 0</span>
      </div>
    `;

    // Insert before the deals list
    const anchor = document.querySelector(
      '[data-testid="deal-list"], [data-testid="recommendation-list"], .deals-list, .recommendation-list, .a-table-wrapper, table, [class*="DealList"]'
    );
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(container, anchor);
    } else {
      const main = document.querySelector('#sc-content-container, .content-container, main, #content, [role="main"]');
      if (main) main.prepend(container);
    }

    // Set initial active country
    setActiveCountryButton(activeCountry);

    // ---- Event: Country buttons ----
    container.querySelectorAll('.sd-deal-country-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const country = btn.dataset.country;
        activeCountry = country === 'ALL' ? null : country;
        setActiveCountryButton(country);
        applyCountryFilter();
        syncSelectAll();
        updateAutoCreateState();
      });
    });

    // ---- Event: Select All ----
    document.getElementById('sd-deal-select-all').addEventListener('change', (e) => {
      const checked = e.target.checked;
      getVisibleDealRows().forEach(row => {
        const cb = row.querySelector('.sd-deal-checkbox');
        if (cb) cb.checked = checked;
      });
      updateAutoCreateState();
    });

    // ---- Event: Auto-Create ----
    document.getElementById('sd-deal-auto-create').addEventListener('click', () => {
      autoCreateDeals();
    });
  }

  function setActiveCountryButton(code) {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;
    toolbar.querySelectorAll('.sd-deal-country-btn').forEach(btn => {
      btn.classList.toggle('sd-deal-country-active', btn.dataset.country === (code || 'ALL'));
    });
  }

  // ============================================================
  // 2. INJECT CHECKBOXES INTO DEAL ROWS
  // ============================================================

  function injectCheckboxes() {
    const rows = getDealRows();
    rows.forEach(row => {
      if (row.querySelector('.sd-deal-checkbox')) return; // already injected

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'sd-deal-checkbox';
      cb.title = 'Select for auto-create';

      cb.addEventListener('change', () => {
        updateAutoCreateState();
        syncSelectAll();
      });

      // Insert at the start of the row
      const firstChild = row.querySelector('td') || row.firstElementChild;
      if (firstChild) {
        firstChild.style.position = firstChild.style.position || 'relative';
        firstChild.insertBefore(cb, firstChild.firstChild);
      } else {
        row.prepend(cb);
      }
    });
  }

  // ============================================================
  // 3. COUNTRY FILTER
  // ============================================================

  function applyCountryFilter() {
    const rows = getDealRows();
    rows.forEach(row => {
      if (!activeCountry) {
        row.style.display = '';
        return;
      }
      const mp = getRowMarketplace(row);
      row.style.display = mp === activeCountry ? '' : 'none';
    });
  }

  function getVisibleDealRows() {
    return getDealRows().filter(row => row.style.display !== 'none');
  }

  function getSelectedDealRows() {
    return getVisibleDealRows().filter(row => {
      const cb = row.querySelector('.sd-deal-checkbox');
      return cb && cb.checked;
    });
  }

  function syncSelectAll() {
    const selectAll = document.getElementById('sd-deal-select-all');
    if (!selectAll) return;
    const visible = getVisibleDealRows();
    const selected = getSelectedDealRows();
    selectAll.checked = visible.length > 0 && visible.length === selected.length;
  }

  function updateAutoCreateState() {
    const btn = document.getElementById('sd-deal-auto-create');
    if (!btn) return;
    const count = getSelectedDealRows().length;
    btn.disabled = count === 0;
    btn.textContent = count > 0
      ? `Auto-Create ${count} Deal${count > 1 ? 's' : ''}`
      : 'Auto-Create Selected Deals';
  }

  // ============================================================
  // 4. AUTO-CREATE DEALS
  // ============================================================

  /**
   * Fill a single deal row with minimum price / quantity and trigger its
   * create / submit action.
   */
  async function fillAndSubmitDeal(row, index, total) {
    updateProgress(index + 1, total, getRowTitle(row) || getRowAsin(row));

    // --- Fill deal price ---
    const minPrice = getMinimumDealPrice(row);
    const priceInputs = row.querySelectorAll(
      'input[name*="price"], input[data-testid*="price"], input[placeholder*="price"], input[placeholder*="Price"], input[type="number"]'
    );
    if (minPrice && priceInputs.length > 0) {
      setNativeValue(priceInputs[0], minPrice.toString());
      // Brief pause to let React update
      await sleep(200);
    }

    // --- Fill deal quantity ---
    const minQty = getMinimumQuantity(row);
    const qtyInputs = row.querySelectorAll(
      'input[name*="quantity"], input[name*="qty"], input[data-testid*="quantity"], input[data-testid*="qty"]'
    );
    if (minQty && qtyInputs.length > 0) {
      setNativeValue(qtyInputs[0], minQty.toString());
      await sleep(200);
    }

    // --- Click the row-level create / select / submit button ---
    const actionBtn = findRowActionButton(row);
    if (actionBtn) {
      actionBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);
      actionBtn.click();
      await sleep(800);
    }

    // Mark visually
    row.classList.add('sd-deal-created');
  }

  /**
   * Find the per-row action button (e.g. "Create deal", "Select", "Submit").
   */
  function findRowActionButton(row) {
    const selectors = [
      'button[data-testid*="create"], button[data-testid*="submit"]',
      'button[data-testid*="select-deal"]',
      'a[data-testid*="create"]',
      'kat-button[label*="Create"]',
      'kat-button[label*="Select"]'
    ];
    for (const sel of selectors) {
      const el = row.querySelector(sel);
      if (el) return el;
    }
    // Fallback: any button with relevant text
    const btns = row.querySelectorAll('button, a.a-button-text, [role="button"], kat-button');
    for (const btn of btns) {
      const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase();
      if (text.includes('create') || text.includes('select') || text.includes('edit deal')) {
        return btn;
      }
    }
    return null;
  }

  async function autoCreateDeals() {
    const rows = getSelectedDealRows();
    if (rows.length === 0) return;

    const confirmed = window.confirm(
      `This will auto-create ${rows.length} deal${rows.length > 1 ? 's' : ''} at minimum prices and quantities.\n\nContinue?`
    );
    if (!confirmed) return;

    const btn = document.getElementById('sd-deal-auto-create');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating...';
    }

    showProgress();

    for (let i = 0; i < rows.length; i++) {
      try {
        await fillAndSubmitDeal(rows[i], i, rows.length);
      } catch (err) {
        console.error('[SellerData] Failed to create deal for row', i, err);
        rows[i].classList.add('sd-deal-error');
      }
      // Pause between deals so Amazon's UI keeps up
      await sleep(1200);
    }

    updateProgress(rows.length, rows.length, 'Done!');
    if (btn) {
      btn.textContent = `Done — ${rows.length} deal${rows.length > 1 ? 's' : ''} created`;
      setTimeout(() => {
        btn.disabled = false;
        updateAutoCreateState();
      }, 3000);
    }

    // After finishing, check if there's a page-level "Submit all" button
    const submitAllBtn = document.querySelector(
      'button[data-testid*="submit-all"], button[data-testid*="create-deals"], [data-testid*="submit-deals"]'
    );
    if (submitAllBtn) {
      submitAllBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      submitAllBtn.classList.add('sd-deal-highlight');
    }
  }

  // ============================================================
  // PROGRESS BAR
  // ============================================================

  function showProgress() {
    const el = document.getElementById(PROGRESS_ID);
    if (el) el.classList.remove('hidden');
  }

  function updateProgress(current, total, label) {
    const fill = document.getElementById('sd-deal-progress-fill');
    const text = document.getElementById('sd-deal-progress-text');
    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
    if (text) text.textContent = `${current} / ${total}${label ? ' — ' + label : ''}`;
  }

  // ============================================================
  // 5. FIX ALL "NEEDS ATTENTION" DEALS  (Dashboard view)
  // ============================================================

  /**
   * Detect whether we're on the deals dashboard (listing) vs the create page.
   */
  function isDealsDashboard() {
    const url = window.location.href;
    // Dashboard: /merchandising-new/ or /merchandising-new/?... without /create
    return /\/merchandising-new(?:\/?\?|\/?\s*$)/.test(url) && !/\/create/.test(url);
  }

  /**
   * Find all deal rows that have a "needs attention" status indicator.
   * Amazon marks these with status text, badge, icon, or CSS class.
   */
  function getNeedsAttentionRows() {
    const rows = getDealRows();
    return rows.filter(row => {
      const text = (row.textContent || '').toLowerCase();
      const html = (row.innerHTML || '').toLowerCase();

      // Status text patterns Amazon uses
      if (text.includes('needs attention')) return true;
      if (text.includes('action required')) return true;
      if (text.includes('action needed')) return true;
      if (text.includes('suppressed')) return true;
      if (text.includes('update required')) return true;
      if (text.includes('fix pricing')) return true;
      if (text.includes('fix quantity')) return true;
      if (text.includes('update deal')) return true;

      // Data attributes / CSS classes
      if (html.includes('needs_attention') || html.includes('needsattention')) return true;
      if (html.includes('status-warning') || html.includes('status-error')) return true;
      if (row.querySelector('[data-status*="attention"], [data-status*="suppressed"], [data-status*="action"]')) return true;
      if (row.querySelector('.warning, .alert, [class*="warning"], [class*="attention"], [class*="suppressed"]')) return true;

      return false;
    });
  }

  /**
   * Add the "Fix All Needs Attention" toolbar to the dashboard.
   */
  function createFixToolbar() {
    if (document.getElementById(FIX_BTN_ID)) return;
    if (!isDealsDashboard()) return;

    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;

    const needsAttention = getNeedsAttentionRows();

    const fixSection = document.createElement('div');
    fixSection.className = 'sd-deal-fix-section';
    fixSection.innerHTML = `
      <div class="sd-deal-toolbar-row sd-deal-fix-row">
        <div class="sd-deal-fix-info">
          <span class="sd-deal-fix-badge" id="sd-fix-count">${needsAttention.length}</span>
          <span class="sd-deal-toolbar-label">Needs Attention</span>
        </div>
        <button class="sd-deal-fix-btn" id="${FIX_BTN_ID}" ${needsAttention.length === 0 ? 'disabled' : ''}>
          Fix All Needs Attention
        </button>
      </div>
      <div class="sd-deal-progress hidden" id="${FIX_PROGRESS_ID}">
        <div class="sd-deal-progress-bar"><div class="sd-deal-progress-fill" id="sd-fix-progress-fill"></div></div>
        <span class="sd-deal-progress-text" id="sd-fix-progress-text">0 / 0</span>
      </div>
      <div class="sd-fix-log hidden" id="${FIX_LOG_ID}"></div>
    `;

    toolbar.appendChild(fixSection);

    document.getElementById(FIX_BTN_ID).addEventListener('click', () => {
      fixAllNeedsAttention();
    });
  }

  function updateFixCount() {
    const badge = document.getElementById('sd-fix-count');
    const btn = document.getElementById(FIX_BTN_ID);
    if (!badge || !btn) return;
    const count = getNeedsAttentionRows().length;
    badge.textContent = count;
    btn.disabled = count === 0;
    btn.textContent = count > 0
      ? `Fix All Needs Attention (${count})`
      : 'Fix All Needs Attention';
  }

  /**
   * Append a line to the fix log panel.
   */
  function fixLog(message, type = 'info') {
    const log = document.getElementById(FIX_LOG_ID);
    if (!log) return;
    log.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = `sd-fix-log-line sd-fix-log-${type}`;
    line.textContent = message;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function updateFixProgress(current, total, label) {
    const fill = document.getElementById('sd-fix-progress-fill');
    const text = document.getElementById('sd-fix-progress-text');
    if (fill) fill.style.width = `${Math.round((current / total) * 100)}%`;
    if (text) text.textContent = `${current} / ${total}${label ? ' — ' + label : ''}`;
  }

  /**
   * Try to find the "Edit" / "View" / "Fix" link/button on a deal row
   * that opens the deal detail/edit page.
   */
  function findEditButton(row) {
    // Try specific selectors first
    const selectors = [
      'a[href*="edit"], a[href*="update"]',
      'button[data-testid*="edit"], button[data-testid*="fix"]',
      'a[data-testid*="edit"], a[data-testid*="fix"]',
      'kat-button[label*="Edit"], kat-button[label*="Fix"]',
      'a[href*="merchandising-new"][href*="dealId"]'
    ];
    for (const sel of selectors) {
      const el = row.querySelector(sel);
      if (el) return el;
    }
    // Fallback: links / buttons with edit-like text
    const clickables = row.querySelectorAll('a, button, [role="button"], kat-button, [role="link"]');
    for (const el of clickables) {
      const text = (el.textContent || el.getAttribute('label') || '').toLowerCase();
      if (text.includes('edit') || text.includes('fix') || text.includes('update') || text.includes('view deal')) {
        return el;
      }
    }
    // Last resort: the row itself may be clickable, or the first link
    const firstLink = row.querySelector('a[href]');
    return firstLink;
  }

  /**
   * On a deal detail / edit page, find the minimum required price and
   * quantity, fill them in, and save.  Returns true on success.
   *
   * The deal edit page typically shows:
   *   - Current deal price input(s) with the minimum required shown nearby
   *   - Quantity / inventory input(s) with the minimum required
   *   - A "Save" / "Submit" / "Update" button
   */
  async function fixDealOnEditPage() {
    // Wait for the edit form to render
    await sleep(1500);

    // ----- Fix price -----
    const priceFixed = await fixDealPrice();

    // ----- Fix quantity -----
    const qtyFixed = await fixDealQuantity();

    if (!priceFixed && !qtyFixed) {
      fixLog('  No fixable price/quantity fields found — may already be correct', 'warn');
    }

    // Small pause for validation to settle
    await sleep(500);

    // ----- Click Save / Submit -----
    const saved = await clickSaveButton();
    return saved;
  }

  /**
   * Find price inputs on the deal edit page and set them to the minimum.
   * Returns true if any price was changed.
   */
  async function fixDealPrice() {
    let changed = false;

    // Strategy 1: Look for explicit "minimum" / "required" price text near inputs
    const allInputs = document.querySelectorAll(
      'input[type="text"], input[type="number"], input:not([type])'
    );

    for (const input of allInputs) {
      const context = getInputContext(input);

      // Skip if this doesn't look like a price field
      if (!isPriceField(input, context)) continue;

      const minPrice = extractMinimumFromContext(context, 'price');
      if (minPrice !== null) {
        const currentVal = parseFloat(input.value) || 0;
        // Only update if the current value doesn't meet the minimum
        // For deals, "minimum" means we need to go AT or BELOW this price
        if (currentVal === 0 || currentVal > minPrice) {
          fixLog(`  Price: ${currentVal || '(empty)'} -> ${minPrice}`, 'fix');
          setNativeValue(input, minPrice.toString());
          changed = true;
          await sleep(300);
        }
      }
    }

    // Strategy 2: Look for deal-price specific inputs
    if (!changed) {
      const dealPriceInputs = document.querySelectorAll(
        '[data-testid*="deal-price"] input, [data-testid*="dealPrice"] input, ' +
        '[class*="deal-price"] input, [class*="dealPrice"] input, ' +
        'input[name*="dealPrice"], input[name*="deal_price"], input[name*="deal-price"]'
      );
      for (const input of dealPriceInputs) {
        const min = input.min ? parseFloat(input.min) : null;
        const placeholder = input.placeholder || '';
        const phVal = placeholder.match(/[\d,.]+/);
        const minVal = min || (phVal ? parseFloat(phVal[0].replace(',', '')) : null);
        if (minVal !== null) {
          const currentVal = parseFloat(input.value) || 0;
          if (currentVal === 0 || currentVal > minVal) {
            fixLog(`  Deal price: ${currentVal || '(empty)'} -> ${minVal}`, 'fix');
            setNativeValue(input, minVal.toString());
            changed = true;
            await sleep(300);
          }
        }
      }
    }

    // Strategy 3: Look for discount % inputs
    if (!changed) {
      const discountInputs = document.querySelectorAll(
        'input[name*="discount"], input[data-testid*="discount"], ' +
        '[class*="discount"] input'
      );
      for (const input of discountInputs) {
        const context = getInputContext(input);
        const minDiscount = extractMinimumFromContext(context, 'discount');
        if (minDiscount !== null) {
          const currentVal = parseFloat(input.value) || 0;
          if (currentVal < minDiscount) {
            fixLog(`  Discount: ${currentVal}% -> ${minDiscount}%`, 'fix');
            setNativeValue(input, minDiscount.toString());
            changed = true;
            await sleep(300);
          }
        }
      }
    }

    return changed;
  }

  /**
   * Find quantity inputs on the deal edit page and set them to the minimum.
   */
  async function fixDealQuantity() {
    let changed = false;

    const allInputs = document.querySelectorAll(
      'input[type="text"], input[type="number"], input:not([type])'
    );

    for (const input of allInputs) {
      const context = getInputContext(input);
      if (!isQuantityField(input, context)) continue;

      const minQty = extractMinimumFromContext(context, 'quantity');
      if (minQty !== null) {
        const currentVal = parseInt(input.value) || 0;
        if (currentVal < minQty) {
          fixLog(`  Quantity: ${currentVal || '(empty)'} -> ${minQty}`, 'fix');
          setNativeValue(input, minQty.toString());
          changed = true;
          await sleep(300);
        }
      }
    }

    // Fallback: dedicated quantity inputs
    if (!changed) {
      const qtyInputs = document.querySelectorAll(
        'input[name*="quantity"], input[name*="qty"], ' +
        'input[data-testid*="quantity"], input[data-testid*="qty"], ' +
        '[class*="quantity"] input, [class*="qty"] input'
      );
      for (const input of qtyInputs) {
        const min = input.min ? parseInt(input.min) : null;
        if (min !== null) {
          const currentVal = parseInt(input.value) || 0;
          if (currentVal < min) {
            fixLog(`  Quantity: ${currentVal || '(empty)'} -> ${min}`, 'fix');
            setNativeValue(input, min.toString());
            changed = true;
            await sleep(300);
          }
        }
      }
    }

    return changed;
  }

  /**
   * Get surrounding context text for an input element (labels, siblings, parent).
   */
  function getInputContext(input) {
    const parts = [];

    // Aria label
    if (input.getAttribute('aria-label')) parts.push(input.getAttribute('aria-label'));

    // Associated <label>
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) parts.push(label.textContent);
    }

    // Name / placeholder
    parts.push(input.name || '');
    parts.push(input.placeholder || '');

    // Closest parent container text (limited scope)
    const wrapper = input.closest('div, td, .form-group, [class*="field"], [class*="input"]');
    if (wrapper) parts.push(wrapper.textContent.substring(0, 500));

    return parts.join(' ').toLowerCase();
  }

  function isPriceField(input, context) {
    return /price|cost|amount|\$|deal.?price|sale.?price/.test(context) &&
           !/quantity|qty|units|count|inventory/.test(input.name || '');
  }

  function isQuantityField(input, context) {
    return /quantity|qty|units|inventory|stock|count|minimum.?deal.?qty/.test(context) &&
           !/price|cost|amount|\$/.test(input.name || '');
  }

  /**
   * Extract a minimum required value from the context text around an input.
   * Amazon shows things like "Minimum: $12.99", "Min. 50 units", "Required: 15%".
   */
  function extractMinimumFromContext(context, fieldType) {
    const patterns = [
      // "Minimum: $12.99", "Min deal price: 12.99", "min: 50"
      /min(?:imum)?[\s.:]*(?:deal\s*)?(?:price|qty|quantity|discount|units)?[\s.:]*\$?([\d,.]+)/,
      // "Required: $12.99", "required price: 12.99"
      /required[\s.:]*(?:deal\s*)?(?:price|qty|quantity|discount)?[\s.:]*\$?([\d,.]+)/,
      // "at least $12.99", "at least 50 units"
      /at\s+least[\s.:]*\$?([\d,.]+)/,
      // "must be $12.99 or less" (for price — lower is better)
      /must\s+be[\s.:]*\$?([\d,.]+)\s+or\s+(?:less|lower|below)/,
      // "must be 50 or more" (for quantity — higher is better)
      /must\s+be[\s.:]*\$?([\d,.]+)\s+or\s+(?:more|higher|above|greater)/,
      // "$12.99 or less" / "50 or more"
      /\$?([\d,.]+)\s+or\s+(?:less|lower|more|higher)/,
      // "new minimum: $12.99"
      /new\s+min(?:imum)?[\s.:]*\$?([\d,.]+)/,
      // "update to $12.99" / "update to 50"
      /update\s+(?:to|price\s+to|quantity\s+to)[\s.:]*\$?([\d,.]+)/
    ];

    for (const pat of patterns) {
      const match = context.match(pat);
      if (match) {
        const val = parseFloat(match[1].replace(',', ''));
        if (!isNaN(val) && val > 0) return val;
      }
    }

    return null;
  }

  /**
   * Find and click the Save / Submit / Update button on the deal edit page.
   */
  async function clickSaveButton() {
    const selectors = [
      'button[data-testid*="save"], button[data-testid*="submit"], button[data-testid*="update"]',
      'input[type="submit"]',
      'kat-button[label*="Save"], kat-button[label*="Submit"], kat-button[label*="Update"]',
      '[data-testid*="save-deal"], [data-testid*="submit-deal"], [data-testid*="update-deal"]'
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        btn.click();
        fixLog('  Clicked save button', 'ok');
        await sleep(1000);
        return true;
      }
    }

    // Fallback: any button with save-like text
    const allBtns = document.querySelectorAll('button, [role="button"], kat-button, a.a-button-text');
    for (const btn of allBtns) {
      const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase().trim();
      if (text === 'save' || text === 'submit' || text === 'update' ||
          text === 'save deal' || text === 'submit deal' || text === 'update deal' ||
          text === 'save changes') {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        btn.click();
        fixLog('  Clicked save button', 'ok');
        await sleep(1000);
        return true;
      }
    }

    fixLog('  Could not find save button', 'error');
    return false;
  }

  /**
   * Main flow: iterate through "needs attention" deals, open each one,
   * fix the price/quantity, save, and return to the dashboard.
   *
   * Two strategies:
   *   A) Inline editing — if the dashboard supports expanding a deal row to
   *      edit in-place, do it without navigating away.
   *   B) Navigation — click "Edit" to go to a detail page, fix, save,
   *      and come back.  We store progress in sessionStorage so we can
   *      resume after page navigation.
   */
  async function fixAllNeedsAttention() {
    const rows = getNeedsAttentionRows();
    if (rows.length === 0) {
      fixLog('No deals with "Needs Attention" status found.', 'warn');
      return;
    }

    const confirmed = window.confirm(
      `Found ${rows.length} deal${rows.length > 1 ? 's' : ''} needing attention.\n\n` +
      `This will update each deal to the minimum required price and quantity and save them.\n\nContinue?`
    );
    if (!confirmed) return;

    const btn = document.getElementById(FIX_BTN_ID);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Fixing...';
    }

    const progressEl = document.getElementById(FIX_PROGRESS_ID);
    if (progressEl) progressEl.classList.remove('hidden');

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = getRowTitle(row) || getRowAsin(row) || `Deal ${i + 1}`;
      updateFixProgress(i + 1, rows.length, title);
      fixLog(`[${i + 1}/${rows.length}] ${title}`, 'info');

      // ---- Strategy A: Try inline editing first ----
      const inlineSuccess = await tryInlineFixDeal(row);
      if (inlineSuccess) {
        row.classList.add('sd-deal-fixed');
        fixed++;
        fixLog(`  Fixed successfully (inline)`, 'ok');
        await sleep(800);
        continue;
      }

      // ---- Strategy B: Navigate to deal edit page ----
      const editBtn = findEditButton(row);
      if (!editBtn) {
        fixLog(`  No edit button found — skipping`, 'error');
        row.classList.add('sd-deal-fix-error');
        failed++;
        continue;
      }

      const editHref = editBtn.getAttribute('href');
      if (editHref) {
        // Save progress so we resume after navigation
        saveFixProgress(i, rows.length, title);
        fixLog(`  Opening edit page...`, 'info');
        editBtn.click();
        // The page will navigate away. On return, resumeFixProgress() picks up.
        return;
      } else {
        // It's a button that might open a modal / side panel
        editBtn.click();
        await sleep(2000);

        // Check if a modal / overlay appeared
        const modal = document.querySelector(
          '[role="dialog"], .modal, [class*="modal"], [class*="Modal"], ' +
          '[class*="overlay"], [class*="Overlay"], [class*="side-panel"], [class*="SidePanel"]'
        );
        if (modal) {
          fixLog(`  Editing in modal...`, 'info');
          const editSuccess = await fixDealInModal(modal);
          if (editSuccess) {
            row.classList.add('sd-deal-fixed');
            fixed++;
            fixLog(`  Fixed successfully`, 'ok');
          } else {
            row.classList.add('sd-deal-fix-error');
            failed++;
            fixLog(`  Failed to fix in modal`, 'error');
          }
          // Close modal if still open
          await closeModal(modal);
          await sleep(800);
        } else {
          // The button might have expanded an inline section
          const inlineRetry = await tryInlineFixDeal(row);
          if (inlineRetry) {
            row.classList.add('sd-deal-fixed');
            fixed++;
            fixLog(`  Fixed successfully`, 'ok');
          } else {
            row.classList.add('sd-deal-fix-error');
            failed++;
            fixLog(`  Could not find edit interface — skipping`, 'error');
          }
          await sleep(800);
        }
      }
    }

    updateFixProgress(rows.length, rows.length, 'Complete');
    fixLog(`\nDone: ${fixed} fixed, ${failed} failed out of ${rows.length}`, fixed > 0 ? 'ok' : 'warn');
    clearFixProgress();

    if (btn) {
      btn.textContent = `Done — ${fixed} fixed`;
      setTimeout(() => {
        btn.disabled = false;
        updateFixCount();
      }, 3000);
    }
  }

  /**
   * Attempt to fix a deal using inline controls (no navigation).
   * The row might have expandable price / qty inputs directly in it.
   */
  async function tryInlineFixDeal(row) {
    const priceInputs = row.querySelectorAll(
      'input[name*="price"], input[data-testid*="price"], input[type="number"]'
    );
    const qtyInputs = row.querySelectorAll(
      'input[name*="quantity"], input[name*="qty"], input[data-testid*="quantity"]'
    );

    if (priceInputs.length === 0 && qtyInputs.length === 0) return false;

    let changed = false;

    // Fix price
    for (const input of priceInputs) {
      const context = getInputContext(input);
      if (!isPriceField(input, context)) continue;
      const minPrice = extractMinimumFromContext(context, 'price') ||
                       (input.min ? parseFloat(input.min) : null);
      if (minPrice !== null) {
        const currentVal = parseFloat(input.value) || 0;
        if (currentVal === 0 || currentVal > minPrice) {
          fixLog(`  Price: ${currentVal || '(empty)'} -> ${minPrice}`, 'fix');
          setNativeValue(input, minPrice.toString());
          changed = true;
          await sleep(200);
        }
      }
    }

    // Fix quantity
    for (const input of qtyInputs) {
      const context = getInputContext(input);
      if (!isQuantityField(input, context)) continue;
      const minQty = extractMinimumFromContext(context, 'quantity') ||
                     (input.min ? parseInt(input.min) : null);
      if (minQty !== null) {
        const currentVal = parseInt(input.value) || 0;
        if (currentVal < minQty) {
          fixLog(`  Quantity: ${currentVal || '(empty)'} -> ${minQty}`, 'fix');
          setNativeValue(input, minQty.toString());
          changed = true;
          await sleep(200);
        }
      }
    }

    // If we changed something, look for a per-row save button
    if (changed) {
      const saveBtn = row.querySelector(
        'button[data-testid*="save"], button[data-testid*="submit"], button[data-testid*="update"]'
      );
      if (saveBtn) {
        saveBtn.click();
        await sleep(800);
      } else {
        // Try text-match
        const btns = row.querySelectorAll('button, [role="button"], kat-button');
        for (const b of btns) {
          const t = (b.textContent || b.getAttribute('label') || '').toLowerCase();
          if (t.includes('save') || t.includes('submit') || t.includes('update')) {
            b.click();
            await sleep(800);
            break;
          }
        }
      }
    }

    return changed;
  }

  /**
   * Fix a deal inside a modal / dialog overlay.
   */
  async function fixDealInModal(modal) {
    let changed = false;

    const allInputs = modal.querySelectorAll(
      'input[type="text"], input[type="number"], input:not([type])'
    );

    for (const input of allInputs) {
      const context = getInputContext(input);

      if (isPriceField(input, context)) {
        const minPrice = extractMinimumFromContext(context, 'price') ||
                         (input.min ? parseFloat(input.min) : null);
        if (minPrice !== null) {
          const currentVal = parseFloat(input.value) || 0;
          if (currentVal === 0 || currentVal > minPrice) {
            fixLog(`  Price: ${currentVal || '(empty)'} -> ${minPrice}`, 'fix');
            setNativeValue(input, minPrice.toString());
            changed = true;
            await sleep(200);
          }
        }
      }

      if (isQuantityField(input, context)) {
        const minQty = extractMinimumFromContext(context, 'quantity') ||
                       (input.min ? parseInt(input.min) : null);
        if (minQty !== null) {
          const currentVal = parseInt(input.value) || 0;
          if (currentVal < minQty) {
            fixLog(`  Quantity: ${currentVal || '(empty)'} -> ${minQty}`, 'fix');
            setNativeValue(input, minQty.toString());
            changed = true;
            await sleep(200);
          }
        }
      }
    }

    if (changed) {
      // Find save button inside modal
      const btns = modal.querySelectorAll('button, [role="button"], kat-button');
      for (const b of btns) {
        const t = (b.textContent || b.getAttribute('label') || '').toLowerCase();
        if (t.includes('save') || t.includes('submit') || t.includes('update') || t.includes('apply')) {
          b.click();
          await sleep(1000);
          break;
        }
      }
    }

    return changed;
  }

  /**
   * Close an open modal.
   */
  async function closeModal(modal) {
    const closeBtn = modal.querySelector(
      '[data-testid*="close"], [aria-label*="close"], [aria-label*="Close"], ' +
      'button.close, .modal-close, [class*="close-button"]'
    );
    if (closeBtn) {
      closeBtn.click();
      await sleep(500);
      return;
    }
    // Press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
  }

  // ---- Navigation-based fix: progress persistence ----

  const FIX_STORAGE_KEY = 'sd_fix_progress';

  function saveFixProgress(currentIndex, total, title) {
    sessionStorage.setItem(FIX_STORAGE_KEY, JSON.stringify({
      currentIndex,
      total,
      title,
      returnUrl: window.location.href,
      timestamp: Date.now()
    }));
  }

  function loadFixProgress() {
    try {
      const data = sessionStorage.getItem(FIX_STORAGE_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      // Expire after 5 minutes
      if (Date.now() - parsed.timestamp > 5 * 60 * 1000) {
        clearFixProgress();
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function clearFixProgress() {
    sessionStorage.removeItem(FIX_STORAGE_KEY);
  }

  /**
   * If we navigated to a deal edit page from the fix flow, this runs on
   * that edit page: fixes the deal, saves, then navigates back.
   */
  async function resumeFixOnEditPage() {
    const progress = loadFixProgress();
    if (!progress) return false;

    // We're on the deal edit page — not the dashboard
    if (isDealsDashboard()) return false;

    fixLog(`Resuming fix for: ${progress.title}`, 'info');

    await fixDealOnEditPage();

    // Navigate back to the dashboard
    fixLog('Navigating back to dashboard...', 'info');
    await sleep(500);

    // Update progress index for next deal
    progress.currentIndex += 1;
    if (progress.currentIndex < progress.total) {
      sessionStorage.setItem(FIX_STORAGE_KEY, JSON.stringify({
        ...progress,
        timestamp: Date.now()
      }));
    } else {
      clearFixProgress();
    }

    // Go back
    if (progress.returnUrl) {
      window.location.href = progress.returnUrl;
    } else {
      window.history.back();
    }
    return true;
  }

  /**
   * On the dashboard, if we previously navigated away to fix a deal
   * and just came back, continue with the remaining deals.
   */
  async function resumeFixOnDashboard() {
    const progress = loadFixProgress();
    if (!progress || !isDealsDashboard()) return;

    // Wait for page to fully load
    await sleep(1500);

    fixLog(`Resuming: completed deal ${progress.currentIndex} of ${progress.total}`, 'info');

    const rows = getNeedsAttentionRows();
    if (rows.length === 0 || progress.currentIndex >= progress.total) {
      fixLog('All deals processed.', 'ok');
      clearFixProgress();
      return;
    }

    // Continue the fix loop from where we left off
    const btn = document.getElementById(FIX_BTN_ID);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Fixing...';
    }
    const progressEl = document.getElementById(FIX_PROGRESS_ID);
    if (progressEl) progressEl.classList.remove('hidden');

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = getRowTitle(row) || getRowAsin(row) || `Deal ${i + 1}`;
      const globalIdx = progress.currentIndex + i;
      updateFixProgress(globalIdx + 1, progress.total, title);
      fixLog(`[${globalIdx + 1}/${progress.total}] ${title}`, 'info');

      const inlineSuccess = await tryInlineFixDeal(row);
      if (inlineSuccess) {
        row.classList.add('sd-deal-fixed');
        fixed++;
        fixLog(`  Fixed successfully`, 'ok');
        await sleep(800);
        continue;
      }

      const editBtn = findEditButton(row);
      if (!editBtn) {
        fixLog(`  No edit button found — skipping`, 'error');
        row.classList.add('sd-deal-fix-error');
        failed++;
        continue;
      }

      const editHref = editBtn.getAttribute('href');
      if (editHref) {
        saveFixProgress(globalIdx + 1, progress.total, title);
        fixLog(`  Opening edit page...`, 'info');
        editBtn.click();
        return;
      }
    }

    updateFixProgress(progress.total, progress.total, 'Complete');
    fixLog(`Done: ${fixed} fixed, ${failed} failed`, fixed > 0 ? 'ok' : 'warn');
    clearFixProgress();

    if (btn) {
      btn.textContent = `Done — ${fixed} fixed`;
      setTimeout(() => {
        btn.disabled = false;
        updateFixCount();
      }, 3000);
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isDealsPage() {
    const url = window.location.href;
    return /\/merchandising-new/.test(url) || /\/deals\/create/.test(url);
  }

  async function init() {
    if (!isDealsPage()) return;

    // If we're on a deal edit page mid-fix-flow, handle that first
    const resuming = await resumeFixOnEditPage();
    if (resuming) return;

    try {
      await waitForElement(
        'table, [data-testid="deal-list"], [data-testid="recommendation-list"], .deals-list, [class*="DealList"], .a-table',
        20000
      );
    } catch {
      // May be a different layout — still try
    }

    // Wait a beat for React to finish rendering
    await sleep(800);

    injectCheckboxes();
    createToolbar();
    applyCountryFilter();

    // Add the Fix Needs Attention toolbar on the dashboard
    if (isDealsDashboard()) {
      createFixToolbar();
      // Check if we need to resume a fix flow
      await resumeFixOnDashboard();
    }

    // Observe for dynamic updates (pagination, AJAX re-renders)
    const observer = new MutationObserver(() => {
      injectCheckboxes();
      applyCountryFilter();
      updateAutoCreateState();
      if (isDealsDashboard()) updateFixCount();
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  init();
})();
