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
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const TOOLBAR_ID = 'sd-deals-toolbar';
  const PROGRESS_ID = 'sd-deals-progress';

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
  // INITIALIZATION
  // ============================================================

  function isDealsPage() {
    const url = window.location.href;
    return /\/merchandising-new/.test(url) || /\/deals\/create/.test(url);
  }

  async function init() {
    if (!isDealsPage()) return;

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

    // Observe for dynamic updates (pagination, AJAX re-renders)
    const observer = new MutationObserver(() => {
      injectCheckboxes();
      applyCountryFilter();
      updateAutoCreateState();
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  init();
})();
