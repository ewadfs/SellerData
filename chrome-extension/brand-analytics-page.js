/**
 * Brand Analytics Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/brand-analytics/dashboard/query-performance
 *          (Query Performance — ASIN view)
 *
 * Features:
 *   1. Download All ASINs — iterates through every ASIN in the catalog
 *      and triggers the report download for each, using the currently
 *      selected time period / reporting range.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_ID = 'sd-ba-panel';
  const LOG_ID = 'sd-ba-log';
  const PROGRESS_ID = 'sd-ba-progress';
  const PROGRESS_FILL_ID = 'sd-ba-progress-fill';
  const PROGRESS_TEXT_ID = 'sd-ba-progress-text';

  // ============================================================
  // HELPERS
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function waitForElement(selector, root = document, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = root.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(root === document ? document.body : root, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, timeout);
    });
  }

  /**
   * Set a value on a React-controlled input using native setter + events.
   */
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Query selector that traverses into open shadow DOM boundaries.
   * Amazon's kat-* web components use shadow DOM extensively.
   */
  function querySelectorDeep(selector, root = document) {
    const result = root.querySelector(selector);
    if (result) return result;
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        const found = querySelectorDeep(selector, el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }

  function querySelectorAllDeep(selector, root = document) {
    const results = [...root.querySelectorAll(selector)];
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        results.push(...querySelectorAllDeep(selector, el.shadowRoot));
      }
    }
    return results;
  }

  /**
   * Get the inner <input> from a shadow-DOM web component (e.g. kat-predictive-input).
   */
  function getShadowInput(el) {
    if (!el) return null;
    if (el.shadowRoot) {
      return el.shadowRoot.querySelector('input, textarea') || el;
    }
    return el.querySelector('input, textarea') || el;
  }

  // ============================================================
  // ASIN DISCOVERY
  // ============================================================

  /**
   * Find all ASINs available in the ASIN selector dropdown.
   * Amazon's ASIN picker is typically a search/select control that
   * lists all catalog ASINs.
   */
  async function discoverAllAsins() {
    baLog('Searching for ASIN selector...');

    // Strategy 1: Find the ASIN dropdown/select element
    const asinSelector = findAsinSelector();
    if (asinSelector) {
      baLog('Found ASIN selector, extracting ASINs...');
      return await extractAsinsFromSelector(asinSelector);
    }

    // Strategy 2: Look for ASIN chips/tags already rendered (multi-select)
    const chipAsins = extractAsinsFromChips();
    if (chipAsins.length > 0) {
      baLog(`Found ${chipAsins.length} ASINs from chips/tags`);
      return chipAsins;
    }

    // Strategy 3: Look for a table/list of ASINs on the page
    const tableAsins = extractAsinsFromTable();
    if (tableAsins.length > 0) {
      baLog(`Found ${tableAsins.length} ASINs from the page table`);
      return tableAsins;
    }

    // Strategy 4: Try opening the ASIN picker and scraping its options
    const pickerAsins = await extractAsinsFromPicker();
    if (pickerAsins.length > 0) {
      baLog(`Found ${pickerAsins.length} ASINs from picker dropdown`);
      return pickerAsins;
    }

    // Strategy 5: Full page scan — search all DOM text/attributes for ASINs
    baLog('Trying full page scan for ASINs...');
    const pageAsins = extractAsinsFromFullPage();
    if (pageAsins.length > 0) {
      baLog(`Found ${pageAsins.length} ASINs from page content`);
      return pageAsins;
    }

    return [];
  }

  /**
   * Find the ASIN selector control on the page.
   */
  function findAsinSelector() {
    // Priority 1: Amazon's kat-predictive-input for ASIN (exact matches first)
    const katPredictive = document.querySelector(
      'kat-predictive-input#asin, ' +
      'kat-predictive-input[data-test-id="PredictiveTextFilter"], ' +
      'kat-predictive-input[data-test-id*="asin" i], ' +
      'kat-predictive-input[data-test-id*="product" i], ' +
      'kat-predictive-input[id*="asin" i]'
    );
    if (katPredictive) return katPredictive;

    const selectors = [
      'select[data-testid*="asin"], select[name*="asin"], select[id*="asin"]',
      '[data-testid*="asin-select"], [data-testid*="asin-picker"], [data-testid*="asin-dropdown"]',
      '[data-testid*="product-select"], [data-testid*="product-picker"], [data-testid*="catalog"]',
      '[class*="asin-select"], [class*="asinSelect"], [class*="AsinSelect"]',
      '[class*="asin-picker"], [class*="asinPicker"], [class*="AsinPicker"]',
      'kat-dropdown[data-testid*="asin"], kat-select[data-testid*="asin"]',
      // Amazon custom elements (broader matches)
      'kat-combobox[data-testid*="asin"], kat-combobox[data-testid*="product"]',
      'kat-dropdown[data-testid*="product"], kat-select[data-testid*="product"]',
      // Amazon's predictive input (broader)
      'kat-predictive-input',
      // Data-cy attributes (React testing)
      '[data-cy*="asin" i], [data-cy*="product-select" i]',
      // Amazon often uses a combobox pattern for ASIN search
      '[role="combobox"][aria-label*="ASIN" i]',
      '[role="combobox"][aria-label*="product" i]',
      '[role="combobox"][aria-label*="catalog" i]',
      'input[placeholder*="ASIN" i]',
      'input[placeholder*="Search your" i]',
      'input[placeholder*="Search ASIN" i]',
      'input[placeholder*="Search product" i]',
      'input[placeholder*="Enter ASIN" i]',
      'input[aria-label*="ASIN" i]',
      'input[aria-label*="product" i]',
      'input[aria-label*="catalog" i]',
      // Broader search input patterns near ASIN-related labels
      'input[type="search"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }

    return null;
  }

  /**
   * Extract ASINs from a <select> or custom dropdown.
   */
  async function extractAsinsFromSelector(selector) {
    const asins = [];

    // If it's a native <select>
    if (selector.tagName === 'SELECT') {
      const options = selector.querySelectorAll('option');
      options.forEach(opt => {
        const val = opt.value || opt.textContent.trim();
        const asin = extractAsinFromText(val);
        if (asin) asins.push({ asin, label: opt.textContent.trim() });
      });
      return asins;
    }

    // If it's Amazon's kat-predictive-input (shadow DOM component)
    if (selector.tagName === 'KAT-PREDICTIVE-INPUT') {
      const innerInput = getShadowInput(selector);
      return await extractAsinsFromPredictiveInput(selector, innerInput);
    }

    // If it's a search/combobox input, try to open it and read options
    if (selector.tagName === 'INPUT') {
      return await extractAsinsFromSearchInput(selector);
    }

    // For custom dropdown components (kat-dropdown, etc.)
    const listbox = selector.querySelector('[role="listbox"]') ||
                    selector.querySelector('[class*="dropdown-list"], [class*="options"]');
    if (listbox) {
      const items = listbox.querySelectorAll('[role="option"], li, [class*="option"]');
      items.forEach(item => {
        const text = item.textContent.trim();
        const asin = extractAsinFromText(text);
        if (asin) asins.push({ asin, label: text });
      });
    }

    return asins;
  }

  /**
   * Extract ASINs from Amazon's kat-predictive-input component.
   * Opens the dropdown, reads all available options.
   */
  async function extractAsinsFromPredictiveInput(katEl, innerInput) {
    const asins = [];

    // Focus and clear the input to show all options
    if (innerInput) {
      innerInput.focus();
      innerInput.click();
      await sleep(500);
      setNativeValue(innerInput, '');
      await sleep(1500);
    } else {
      katEl.click();
      await sleep(1500);
    }

    // Options may appear in: shadow DOM, light DOM children, or body-level popover
    const optionSources = [
      // Inside the kat-predictive-input's shadow root
      ...(katEl.shadowRoot ? katEl.shadowRoot.querySelectorAll('[role="option"], [part*="option"], li, [class*="option"]') : []),
      // As light DOM children
      ...katEl.querySelectorAll('[role="option"], li, [class*="option"]'),
      // In a body-level popover/dropdown
      ...document.querySelectorAll('[role="listbox"] [role="option"], [class*="predictive"] [role="option"]'),
      // Deep search as fallback
      ...querySelectorAllDeep('[role="option"]')
    ];

    // De-duplicate by element reference
    const seen = new Set();
    for (const item of optionSources) {
      if (seen.has(item)) continue;
      seen.add(item);

      const text = item.textContent.trim();
      const asin = extractAsinFromText(text);
      if (asin && !asins.find(a => a.asin === asin)) {
        asins.push({ asin, label: text.substring(0, 100) });
      }
    }

    // Close dropdown
    if (innerInput) innerInput.blur();
    document.body.click();
    await sleep(300);

    return asins;
  }

  /**
   * Open a search input, type to load all results, and extract ASINs.
   */
  async function extractAsinsFromSearchInput(input) {
    const asins = [];

    // Focus the input to trigger dropdown
    input.focus();
    input.click();
    await sleep(500);

    // Clear existing value and trigger options to appear
    setNativeValue(input, '');
    await sleep(1000);

    // Try clicking any "show all" / expand control
    const showAllBtn = document.querySelector(
      '[class*="show-all"], [class*="showAll"], [class*="view-all"], ' +
      'button[class*="load-more"], [data-testid*="show-all"]'
    );
    if (showAllBtn) {
      showAllBtn.click();
      await sleep(1000);
    }

    // Read options from the dropdown that appeared
    const dropdownSelectors = [
      '[role="listbox"]',
      '[class*="dropdown-menu"]',
      '[class*="autocomplete"]',
      '[class*="suggestions"]',
      '[class*="options-list"]',
      '[class*="popover"] [role="list"]',
      'ul[class*="dropdown"]',
      '[data-testid*="option"]'
    ];

    for (const sel of dropdownSelectors) {
      const dropdown = document.querySelector(sel);
      if (!dropdown || !isVisible(dropdown)) continue;

      const items = dropdown.querySelectorAll(
        '[role="option"], li, [class*="option"], [class*="item"], [class*="suggestion"]'
      );
      items.forEach(item => {
        const text = item.textContent.trim();
        const asin = extractAsinFromText(text);
        if (asin && !asins.find(a => a.asin === asin)) {
          asins.push({ asin, label: text.substring(0, 100) });
        }
      });

      if (asins.length > 0) break;
    }

    // Close dropdown
    input.blur();
    document.body.click();
    await sleep(300);

    return asins;
  }

  /**
   * Extract ASINs from chip/tag elements already on the page.
   */
  function extractAsinsFromChips() {
    const asins = [];
    const chips = document.querySelectorAll(
      '[class*="chip"], [class*="tag"], [class*="badge"], ' +
      '[class*="selected-asin"], [class*="selectedAsin"], ' +
      '[data-testid*="selected"], [class*="token"]'
    );
    chips.forEach(chip => {
      const text = chip.textContent.trim();
      const asin = extractAsinFromText(text);
      if (asin && !asins.find(a => a.asin === asin)) {
        asins.push({ asin, label: text.substring(0, 100) });
      }
    });
    return asins;
  }

  /**
   * Extract ASINs from any table visible on the page.
   */
  function extractAsinsFromTable() {
    const asins = [];

    // Check standard table rows and role-based rows
    const rows = document.querySelectorAll('table tbody tr, [role="row"], [role="gridcell"]');
    rows.forEach(row => {
      const text = row.textContent || '';
      const match = text.match(/\b(B[A-Z0-9]{9})\b/);
      if (match && !asins.find(a => a.asin === match[1])) {
        const nameEl = row.querySelector('a, [class*="product"], [class*="title"]');
        const label = nameEl ? nameEl.textContent.trim().substring(0, 80) : match[1];
        asins.push({ asin: match[1], label });
      }
    });
    if (asins.length > 0) return asins;

    // Check elements with data-asin attributes
    document.querySelectorAll('[data-asin], [data-product-asin]').forEach(el => {
      const asin = el.getAttribute('data-asin') || el.getAttribute('data-product-asin');
      if (asin && /^B[A-Z0-9]{9}$/.test(asin) && !asins.find(a => a.asin === asin)) {
        const label = (el.textContent || '').trim().substring(0, 80) || asin;
        asins.push({ asin, label });
      }
    });
    if (asins.length > 0) return asins;

    // Check links for ASIN patterns in href
    document.querySelectorAll('a[href*="/dp/"], a[href*="asin="], a[href*="/product/"]').forEach(link => {
      const href = link.href || '';
      const match = href.match(/\/dp\/(B[A-Z0-9]{9})/) ||
                    href.match(/asin=(B[A-Z0-9]{9})/) ||
                    href.match(/\/product\/(B[A-Z0-9]{9})/);
      if (match && !asins.find(a => a.asin === match[1])) {
        asins.push({ asin: match[1], label: (link.textContent || '').trim().substring(0, 80) || match[1] });
      }
    });
    if (asins.length > 0) return asins;

    // Scan div-based grid/list structures
    document.querySelectorAll('[class*="row"], [class*="Row"], [class*="item"], [class*="Item"], [class*="product"], [class*="Product"]').forEach(el => {
      const text = el.textContent || '';
      const match = text.match(/\b(B[A-Z0-9]{9})\b/);
      if (match && !asins.find(a => a.asin === match[1])) {
        asins.push({ asin: match[1], label: match[1] });
      }
    });

    return asins;
  }

  /**
   * Full page text scan for ASINs — last resort strategy.
   */
  function extractAsinsFromFullPage() {
    const asins = [];

    // First try data attributes (most reliable)
    document.querySelectorAll('[data-asin], [data-product-asin]').forEach(el => {
      const asin = el.getAttribute('data-asin') || el.getAttribute('data-product-asin');
      if (asin && /^B[A-Z0-9]{9}$/.test(asin) && !asins.find(a => a.asin === asin)) {
        const label = (el.textContent || '').trim().substring(0, 80) || asin;
        asins.push({ asin, label });
      }
    });
    if (asins.length > 0) return asins;

    // Then try links
    document.querySelectorAll('a').forEach(link => {
      const href = link.href || '';
      const match = href.match(/\/dp\/(B[A-Z0-9]{9})/) ||
                    href.match(/asin=(B[A-Z0-9]{9})/) ||
                    href.match(/\/product\/(B[A-Z0-9]{9})/);
      if (match && !asins.find(a => a.asin === match[1])) {
        asins.push({ asin: match[1], label: (link.textContent || '').trim().substring(0, 80) || match[1] });
      }
    });
    if (asins.length > 0) return asins;

    // Full text scan as last resort
    const bodyText = document.body.innerText || '';
    const matches = [...new Set(bodyText.match(/\bB[A-Z0-9]{9}\b/g) || [])];
    for (const asin of matches) {
      asins.push({ asin, label: asin });
    }
    return asins;
  }

  /**
   * Try to open the ASIN picker by clicking its trigger and extract ASINs.
   */
  async function extractAsinsFromPicker() {
    const asins = [];

    // Find the ASIN picker trigger button
    const triggerSelectors = [
      'button[data-testid*="asin"], button[aria-label*="ASIN" i]',
      'button[data-testid*="product"], button[aria-label*="product" i]',
      '[class*="asin"] button, [class*="Asin"] button',
      '[class*="product-select"] button, [class*="productSelect"] button',
      'kat-dropdown-button[data-testid*="asin"], kat-dropdown-button[data-testid*="product"]',
      'kat-combobox[data-testid*="asin"], kat-combobox[data-testid*="product"]',
      // Look for any button near an "ASIN" label
      'label[for*="asin"] + button, label[for*="asin"] ~ button',
      'label[for*="product"] + button, label[for*="product"] ~ button'
    ];

    // Also find by text content
    const allBtns = document.querySelectorAll('button, [role="button"], kat-button');
    let triggerBtn = null;

    for (const sel of triggerSelectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) { triggerBtn = el; break; }
    }

    if (!triggerBtn) {
      for (const btn of allBtns) {
        const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase();
        if (text.includes('asin') || text.includes('select product') || text.includes('choose asin') ||
            text.includes('select asin') || text.includes('pick product') || text.includes('your products') ||
            text.includes('catalog')) {
          triggerBtn = btn;
          break;
        }
      }
    }

    if (!triggerBtn) return asins;

    // Click to open
    triggerBtn.click();
    await sleep(1500);

    // Now look for the opened picker/dropdown/modal
    const containers = document.querySelectorAll(
      '[role="listbox"], [role="dialog"], [class*="popover"], [class*="modal"], ' +
      '[class*="dropdown-menu"], [class*="picker"], [class*="Picker"]'
    );

    for (const container of containers) {
      if (!isVisible(container)) continue;
      const items = container.querySelectorAll(
        '[role="option"], li, [class*="option"], [class*="item"], [class*="row"]'
      );
      items.forEach(item => {
        const text = item.textContent.trim();
        const asin = extractAsinFromText(text);
        if (asin && !asins.find(a => a.asin === asin)) {
          asins.push({ asin, label: text.substring(0, 100) });
        }
      });
      if (asins.length > 0) break;
    }

    // Close the picker
    const closeBtn = document.querySelector(
      '[class*="popover"] button[class*="close"], [role="dialog"] button[aria-label*="close" i], ' +
      'button[class*="close"], [class*="modal"] button[class*="close"]'
    );
    if (closeBtn) closeBtn.click();
    else document.body.click();
    await sleep(300);

    return asins;
  }

  /**
   * Extract a 10-char ASIN (B...) from a text string.
   */
  function extractAsinFromText(text) {
    const match = (text || '').match(/\b(B[A-Z0-9]{9})\b/);
    return match ? match[1] : null;
  }

  // ============================================================
  // SELECT AN ASIN IN THE PICKER
  // ============================================================

  /**
   * Programmatically select a specific ASIN in the picker.
   */
  async function selectAsin(asin) {
    // Strategy 1: Native <select>
    const nativeSelect = document.querySelector(
      'select[data-testid*="asin"], select[name*="asin"], select[id*="asin"]'
    );
    if (nativeSelect) {
      nativeSelect.value = asin;
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);
      return true;
    }

    // Strategy 2: kat-predictive-input (Amazon's shadow DOM component)
    const katPredictive = document.querySelector(
      'kat-predictive-input#asin, kat-predictive-input[data-test-id="PredictiveTextFilter"]'
    );
    if (katPredictive) {
      const innerInput = getShadowInput(katPredictive);
      if (innerInput) {
        innerInput.focus();
        innerInput.click();
        await sleep(300);
        setNativeValue(innerInput, asin);
        await sleep(1500);

        // Click the matching option from the dropdown
        const options = [
          ...querySelectorAllDeep('[role="option"]'),
          ...document.querySelectorAll('[role="listbox"] [role="option"]')
        ];
        const seen = new Set();
        for (const opt of options) {
          if (seen.has(opt)) continue;
          seen.add(opt);
          if (opt.textContent.includes(asin)) {
            opt.click();
            await sleep(1000);
            return true;
          }
        }

        // Try pressing Enter on the inner input
        innerInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(1000);
        return true;
      }
    }

    // Strategy 3: Regular search input — type the ASIN and select it
    const searchInput = findAsinSelector();
    if (searchInput && searchInput.tagName === 'INPUT') {
      searchInput.focus();
      setNativeValue(searchInput, asin);
      await sleep(1500);

      // Click the matching option from the dropdown
      const options = querySelectorAllDeep(
        '[role="option"], [class*="option"], [class*="suggestion"], [class*="item"]'
      );
      for (const opt of options) {
        if (opt.textContent.includes(asin) && isVisible(opt)) {
          opt.click();
          await sleep(1000);
          return true;
        }
      }

      // Try pressing Enter
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(1000);
      return true;
    }

    // Strategy 4: Use the URL — navigate to the ASIN view with the ASIN param
    const url = new URL(window.location.href);
    url.searchParams.set('asin', asin);
    window.location.href = url.toString();
    // This will reload the page — caller should handle this
    return 'navigated';
  }

  // ============================================================
  // CLICK "APPLY" AFTER SELECTING AN ASIN
  // ============================================================

  /**
   * After selecting an ASIN in the picker, Amazon requires clicking an
   * "Apply" button to actually refresh the report data.  Without this
   * the page still shows data for the *previous* ASIN and "Generate
   * Download" would re-download the old report.
   */
  async function clickApplyButton() {
    // Priority 1: Amazon's kat-button with label "Apply"
    const katApply = querySelectorDeep('kat-button[label="Apply"]') ||
                     querySelectorDeep('kat-button[label="apply"]');
    if (katApply) {
      const inner = katApply.shadowRoot?.querySelector('button') || katApply;
      inner.click();
      baLog('  Clicked Apply button (kat-button)');
      await sleep(4000); // wait for data to refresh
      return true;
    }

    // Priority 2: Any visible button/kat-button whose text is "Apply"
    const allClickables = querySelectorAllDeep(
      'button, kat-button, [role="button"], input[type="submit"], input[type="button"]'
    );
    for (const el of allClickables) {
      const text = (el.textContent || el.value || el.getAttribute('label') || '').trim();
      if (/^apply$/i.test(text) && isVisible(el)) {
        const inner = el.shadowRoot?.querySelector('button') || el;
        inner.click();
        baLog('  Clicked Apply button');
        await sleep(4000);
        return true;
      }
    }

    // Priority 3: Button whose data-test-id / data-testid contains "apply"
    const testIdApply = querySelectorDeep('[data-test-id*="pply"]') ||
                        querySelectorDeep('[data-testid*="pply"]');
    if (testIdApply && isVisible(testIdApply)) {
      const inner = testIdApply.shadowRoot?.querySelector('button') || testIdApply;
      inner.click();
      baLog('  Clicked Apply button (data-test-id)');
      await sleep(4000);
      return true;
    }

    baLog('  No Apply button found — page may auto-apply on selection', 'warn');
    return false;
  }

  // ============================================================
  // TRIGGER DOWNLOAD
  // ============================================================

  /**
   * Find and click the "Generate Download" / "Download" button.
   */
  async function clickDownloadButton() {
    // Priority 1: Direct lookup for Amazon's known GenerateDownloadButton (may be in shadow DOM)
    const knownBtn = querySelectorDeep('#GenerateDownloadButton') ||
                     querySelectorDeep('[data-test-id="GenerateDownloadButton"]') ||
                     querySelectorDeep('kat-button[label="Generate Download"]');
    if (knownBtn) {
      baLog('Found Generate Download button');
      // For kat-button, click the inner <button> in its shadow root if available
      const innerBtn = knownBtn.shadowRoot?.querySelector('button') || knownBtn;
      innerBtn.click();
      await sleep(1000);
      return true;
    }

    const downloadPhrases = [
      'generate download',
      'generate report',
      'download report',
      'download csv',
      'download',
      'export'
    ];

    // Search both light DOM and shadow DOM for clickable elements
    const allClickables = querySelectorAllDeep(
      'button, a, kat-button, [role="button"], input[type="submit"], input[type="button"]'
    );

    for (const el of allClickables) {
      const text = (el.textContent || el.value || el.getAttribute('label') || '').toLowerCase().trim();
      const testid = (el.getAttribute('data-test-id') || el.dataset?.testid || '').toLowerCase();

      for (const phrase of downloadPhrases) {
        if (text.includes(phrase) || testid.includes(phrase.replace(/\s/g, '-'))) {
          // For kat-button, click inner <button> in shadow root
          const innerBtn = el.shadowRoot?.querySelector('button') || el;
          innerBtn.click();
          await sleep(1000);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * After clicking "Generate Download", a dialog appears asking which
   * download type (Simple View / Comprehensive).  Select "Simple View"
   * and click the "Generate Download" confirmation button.
   */
  async function handleDownloadTypeDialog() {
    // Wait for dialog to appear
    await sleep(2000);

    // ----- 1. Find the dialog (light DOM + shadow DOM) -----
    const dialogSelectors = [
      '[role="dialog"]', '.modal', '[class*="modal"]', '[class*="Modal"]',
      '[class*="download-type"]', '[class*="downloadType"]',
      '[class*="popover"]', '[class*="Popover"]'
    ];

    let dialog = null;
    for (const sel of dialogSelectors) {
      const el = querySelectorDeep(sel);
      if (el && isVisible(el)) { dialog = el; break; }
    }

    if (!dialog) {
      baLog('  No download-type dialog detected — download may have started directly');
      return true;
    }

    // ----- 2. Select "Simple View" radio -----
    // Search inside dialog and also broadly via deep traversal
    const radioSources = [
      ...dialog.querySelectorAll(
        '[role="radio"], [role="option"], input[type="radio"], label, ' +
        '[class*="option"], [class*="radio"], kat-radio-button, kat-radiobutton'
      ),
      ...querySelectorAllDeep('[role="radio"], kat-radio-button, kat-radiobutton')
    ];

    const seen = new Set();
    for (const opt of radioSources) {
      if (seen.has(opt)) continue;
      seen.add(opt);
      const text = (opt.textContent || opt.value || opt.getAttribute('label') || '').toLowerCase();
      if (text.includes('simple')) {
        // Click the radio input inside, or the element itself
        const radio = opt.querySelector('input[type="radio"]') ||
                      opt.shadowRoot?.querySelector('input[type="radio"]') ||
                      opt;
        radio.click();
        baLog('  Selected "Simple View"');
        await sleep(800);
        break;
      }
    }

    // ----- 3. Click "Generate Download" confirmation button -----
    const confirmSources = [
      ...dialog.querySelectorAll('button, kat-button, [role="button"]'),
      ...querySelectorAllDeep('button, kat-button, [role="button"]')
    ];

    const seenBtns = new Set();
    for (const el of confirmSources) {
      if (seenBtns.has(el)) continue;
      seenBtns.add(el);
      const text = (el.textContent || el.getAttribute('label') || '').toLowerCase().trim();
      if (text.includes('generate download') || text.includes('generate report')) {
        const inner = el.shadowRoot?.querySelector('button') || el;
        inner.click();
        baLog('  Clicked "Generate Download" in dialog');
        await sleep(2000);
        return true;
      }
    }

    // Broader fallback — any generate/download/confirm button inside the dialog
    for (const btn of dialog.querySelectorAll('button, kat-button, [role="button"]')) {
      const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase().trim();
      if (text.includes('generate') || text.includes('download') || text.includes('confirm')) {
        const inner = btn.shadowRoot?.querySelector('button') || btn;
        inner.click();
        baLog('  Clicked confirm button in dialog');
        await sleep(2000);
        return true;
      }
    }

    baLog('  Could not find confirmation button in download dialog', 'warn');
    return false;
  }

  // ============================================================
  // BULK DOWNLOAD ORCHESTRATOR
  // ============================================================

  let isRunning = false;
  let shouldStop = false;

  async function downloadAllAsins() {
    if (isRunning) return;
    isRunning = true;
    shouldStop = false;

    updateButtonState('running');
    baLog('Starting bulk download for all ASINs...');

    // Step 1: Discover all ASINs
    const asins = await discoverAllAsins();

    if (asins.length === 0) {
      baLog('No ASINs found. Make sure you are on the ASIN view (not Query view) and that your catalog has products listed.', 'error');
      isRunning = false;
      updateButtonState('idle');
      return;
    }

    baLog(`Found ${asins.length} ASINs to download`);
    showProgress(0, asins.length);

    let successCount = 0;
    let errorCount = 0;

    // Step 2: Iterate through each ASIN
    for (let i = 0; i < asins.length; i++) {
      if (shouldStop) {
        baLog('Stopped by user.', 'warn');
        break;
      }

      const { asin, label } = asins[i];
      const shortLabel = label.length > 50 ? label.substring(0, 50) + '...' : label;
      baLog(`[${i + 1}/${asins.length}] Selecting ASIN: ${asin} — ${shortLabel}`);
      showProgress(i, asins.length);

      try {
        // Select the ASIN
        const selectResult = await selectAsin(asin);

        if (selectResult === 'navigated') {
          // Page will reload with the new ASIN — save progress and resume
          saveResumeState(asins, i);
          baLog('Page navigating to new ASIN — will resume after reload...', 'info');
          return; // Page is reloading
        }

        // Click "Apply" so the page refreshes with the new ASIN's data
        await clickApplyButton();

        // Wait for data to finish loading after apply
        await sleep(2000);

        // Trigger download
        const downloaded = await clickDownloadButton();
        if (downloaded) {
          // Handle download type dialog if it appears
          await handleDownloadTypeDialog();
          baLog(`  Downloaded report for ${asin}`, 'ok');
          successCount++;
        } else {
          baLog(`  Could not find download button for ${asin}`, 'warn');
          errorCount++;
        }

        // Wait between downloads to not overwhelm Amazon
        if (i < asins.length - 1) {
          await sleep(2000);
        }
      } catch (err) {
        baLog(`  Error processing ${asin}: ${err.message}`, 'error');
        errorCount++;
      }
    }

    // Done
    showProgress(asins.length, asins.length);
    baLog(`Complete! ${successCount} downloaded, ${errorCount} errors out of ${asins.length} ASINs.`);
    isRunning = false;
    shouldStop = false;
    updateButtonState('idle');
    clearResumeState();
  }

  function stopDownload() {
    shouldStop = true;
    baLog('Stopping after current ASIN...', 'warn');
    updateButtonState('stopping');
  }

  // ============================================================
  // RESUME AFTER PAGE NAVIGATION
  // ============================================================

  function saveResumeState(asins, currentIndex) {
    sessionStorage.setItem('sd_ba_resume', JSON.stringify({
      asins,
      currentIndex,
      timestamp: Date.now()
    }));
  }

  function loadResumeState() {
    try {
      const data = JSON.parse(sessionStorage.getItem('sd_ba_resume'));
      if (data && Date.now() - data.timestamp < 5 * 60 * 1000) return data;
    } catch { /* ignore */ }
    return null;
  }

  function clearResumeState() {
    sessionStorage.removeItem('sd_ba_resume');
  }

  async function checkAndResume() {
    const state = loadResumeState();
    if (!state) return false;

    baLog(`Resuming bulk download from ASIN ${state.currentIndex + 1}/${state.asins.length}...`);

    // Wait for page to fully load
    await sleep(3000);

    // Download the current ASIN (the page loaded with it selected)
    const downloaded = await clickDownloadButton();
    if (downloaded) {
      await handleDownloadTypeDialog();
      baLog(`  Downloaded report for current ASIN`, 'ok');
    }

    // Continue with the rest
    const remainingAsins = state.asins.slice(state.currentIndex + 1);
    if (remainingAsins.length === 0) {
      baLog('All ASINs processed!');
      clearResumeState();
      return true;
    }

    isRunning = true;
    showProgress(state.currentIndex + 1, state.asins.length);

    let successCount = downloaded ? 1 : 0;
    let errorCount = downloaded ? 0 : 1;

    for (let i = 0; i < remainingAsins.length; i++) {
      if (shouldStop) break;

      const globalIdx = state.currentIndex + 1 + i;
      const { asin, label } = remainingAsins[i];
      baLog(`[${globalIdx + 1}/${state.asins.length}] Selecting ASIN: ${asin}`);
      showProgress(globalIdx, state.asins.length);

      try {
        const selectResult = await selectAsin(asin);
        if (selectResult === 'navigated') {
          saveResumeState(state.asins, globalIdx);
          return true;
        }

        // Click "Apply" so the page refreshes with the new ASIN's data
        await clickApplyButton();
        await sleep(2000);

        const dl = await clickDownloadButton();
        if (dl) {
          await handleDownloadTypeDialog();
          baLog(`  Downloaded report for ${asin}`, 'ok');
          successCount++;
        } else {
          baLog(`  Could not find download button for ${asin}`, 'warn');
          errorCount++;
        }

        if (i < remainingAsins.length - 1) await sleep(2000);
      } catch (err) {
        baLog(`  Error: ${err.message}`, 'error');
        errorCount++;
      }
    }

    showProgress(state.asins.length, state.asins.length);
    baLog(`Complete! ${successCount} downloaded, ${errorCount} errors.`);
    isRunning = false;
    updateButtonState('idle');
    clearResumeState();
    return true;
  }

  // ============================================================
  // UI: TOOLBAR PANEL
  // ============================================================

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="sd-ba-header">
        <span class="sd-ba-logo">SellerData</span>
        <span class="sd-ba-title">Bulk ASIN Report Download</span>
      </div>
      <div class="sd-ba-desc">
        Download Query Performance reports for all ASINs in your catalog using the currently selected time period.
      </div>
      <div class="sd-ba-actions">
        <button class="sd-ba-download-btn" id="sd-ba-download">
          Download All ASINs
        </button>
        <button class="sd-ba-stop-btn hidden" id="sd-ba-stop">
          Stop
        </button>
      </div>
      <div class="sd-ba-progress hidden" id="${PROGRESS_ID}">
        <div class="sd-ba-progress-bar">
          <div class="sd-ba-progress-fill" id="${PROGRESS_FILL_ID}"></div>
        </div>
        <span class="sd-ba-progress-text" id="${PROGRESS_TEXT_ID}">0 / 0</span>
      </div>
      <div class="sd-ba-log hidden" id="${LOG_ID}"></div>
    `;

    // Insert at top of main content
    const anchor = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    );
    if (anchor) {
      anchor.insertBefore(panel, anchor.firstChild);
    } else {
      document.body.prepend(panel);
    }

    // Event handlers
    document.getElementById('sd-ba-download').addEventListener('click', () => {
      downloadAllAsins();
    });

    document.getElementById('sd-ba-stop').addEventListener('click', () => {
      stopDownload();
    });
  }

  function updateButtonState(state) {
    const dlBtn = document.getElementById('sd-ba-download');
    const stopBtn = document.getElementById('sd-ba-stop');
    if (!dlBtn || !stopBtn) return;

    if (state === 'running') {
      dlBtn.disabled = true;
      dlBtn.textContent = 'Downloading...';
      stopBtn.classList.remove('hidden');
    } else if (state === 'stopping') {
      dlBtn.disabled = true;
      dlBtn.textContent = 'Stopping...';
      stopBtn.disabled = true;
    } else {
      dlBtn.disabled = false;
      dlBtn.textContent = 'Download All ASINs';
      stopBtn.classList.add('hidden');
      stopBtn.disabled = false;
    }
  }

  function showProgress(current, total) {
    const container = document.getElementById(PROGRESS_ID);
    const fill = document.getElementById(PROGRESS_FILL_ID);
    const text = document.getElementById(PROGRESS_TEXT_ID);
    if (!container || !fill || !text) return;

    container.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    fill.style.width = pct + '%';
    text.textContent = `${current} / ${total}`;
  }

  function baLog(message, type = 'info') {
    const log = document.getElementById(LOG_ID);
    if (!log) {
      console.log(`[SellerData BA] ${message}`);
      return;
    }
    log.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = `sd-ba-log-line sd-ba-log-${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isBrandAnalyticsPage() {
    const url = window.location.href;
    return /\/brand-analytics/.test(url);
  }

  async function init() {
    if (!isBrandAnalyticsPage()) return;

    // Wait for page content
    await sleep(2000);

    createPanel();

    // Check if we should resume a bulk download
    const resumed = await checkAndResume();
    if (!resumed) {
      baLog('Ready. Select your desired time period, then click "Download All ASINs".');
    }

    console.log('[SellerData] Brand Analytics page enhancements loaded');
  }

  init();
})();
