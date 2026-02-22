/**
 * Saved Filters / Views — Global Enhancement for SellerData.
 *
 * Runs on: All Seller Central pages (orders, inventory, reports, etc.)
 *
 * Features:
 *   1. Save View — captures current URL params, form inputs, dropdowns,
 *      checkboxes and radio buttons as a named "view" preset.
 *   2. Restore View — one-click to reload the page with saved URL params
 *      and re-apply form values.
 *   3. Persistent Storage — views stored per page path in chrome.storage.local.
 *   4. Floating Button — unobtrusive pill button in bottom-right that
 *      expands to show saved views and a "Save current view" action.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const STORAGE_KEY = 'sd_saved_filters';
  const WIDGET_ID = 'sd-filters-widget';
  const PANEL_ID = 'sd-filters-panel';

  // Pages where saved filters are most useful
  const SUPPORTED_PATHS = [
    '/orders',
    '/myinventory',
    '/inventory',
    '/reportcentral',
    '/reports',
    '/business-reports',
    '/returns',
    '/coupons',
    '/promotions',
    '/advertising',
    '/brand-analytics',
    '/cu/case-lobby',
    '/case-dashboard',
    '/feedback-manager',
    '/listing',
    '/merchandising',
    '/fba',
    '/payments',
    '/gp/ssof',
    '/product-search',
    '/asdn'
  ];

  // ============================================================
  // HELPERS
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Get a stable page key for grouping saved views.
   * Strips query params so all views for /orders/* are grouped together.
   */
  function getPageKey() {
    const path = window.location.pathname;
    // Normalize to the first two segments: /orders-v3/order -> /orders-v3
    const segments = path.split('/').filter(Boolean);
    return '/' + segments.slice(0, 2).join('/');
  }

  function getPageLabel() {
    const key = getPageKey();
    const labels = {
      '/orders-v3': 'Orders',
      '/orders': 'Orders',
      '/myinventory': 'Inventory',
      '/inventory': 'Inventory',
      '/reportcentral': 'Reports',
      '/reports': 'Reports',
      '/business-reports': 'Business Reports',
      '/returns': 'Returns',
      '/coupons': 'Coupons',
      '/promotions': 'Promotions',
      '/advertising': 'Advertising',
      '/brand-analytics': 'Brand Analytics',
      '/cu': 'Cases',
      '/case-dashboard': 'Cases',
      '/feedback-manager': 'Feedback',
      '/listing': 'Listings',
      '/merchandising': 'Deals',
      '/payments': 'Payments',
      '/gp': 'FBA',
      '/asdn': 'Supply Chain'
    };
    return labels[key] || key;
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ============================================================
  // CAPTURE STATE
  // ============================================================

  /**
   * Capture the current page state: URL, form inputs, dropdowns, etc.
   */
  function captureCurrentState() {
    const state = {
      url: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      inputs: {},
      selects: {},
      checkboxes: {},
      radios: {},
      timestamp: new Date().toISOString()
    };

    // Capture text/number inputs
    document.querySelectorAll('input[type="text"], input[type="number"], input[type="date"], input[type="search"]').forEach(input => {
      const key = input.name || input.id || input.getAttribute('data-testid');
      if (key && input.value) {
        state.inputs[key] = input.value;
      }
    });

    // Capture selects
    document.querySelectorAll('select').forEach(select => {
      const key = select.name || select.id || select.getAttribute('data-testid');
      if (key && select.value) {
        state.selects[key] = select.value;
      }
    });

    // Capture checkboxes
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const key = cb.name || cb.id || cb.getAttribute('data-testid');
      if (key) {
        state.checkboxes[key] = cb.checked;
      }
    });

    // Capture radio buttons
    document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
      const key = radio.name || radio.getAttribute('data-testid');
      if (key) {
        state.radios[key] = radio.value;
      }
    });

    return state;
  }

  /**
   * Restore form state after page load.
   */
  function restoreFormState(state) {
    // Restore text inputs
    for (const [key, value] of Object.entries(state.inputs || {})) {
      const el = document.querySelector(
        `input[name="${key}"], input[id="${key}"], input[data-testid="${key}"]`
      );
      if (el) {
        setNativeValue(el, value);
      }
    }

    // Restore selects
    for (const [key, value] of Object.entries(state.selects || {})) {
      const el = document.querySelector(
        `select[name="${key}"], select[id="${key}"], select[data-testid="${key}"]`
      );
      if (el) {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Restore checkboxes
    for (const [key, checked] of Object.entries(state.checkboxes || {})) {
      const el = document.querySelector(
        `input[type="checkbox"][name="${key}"], input[type="checkbox"][id="${key}"], ` +
        `input[type="checkbox"][data-testid="${key}"]`
      );
      if (el && el.checked !== checked) {
        el.click();
      }
    }

    // Restore radios
    for (const [key, value] of Object.entries(state.radios || {})) {
      const el = document.querySelector(
        `input[type="radio"][name="${key}"][value="${value}"], ` +
        `input[type="radio"][data-testid="${key}"][value="${value}"]`
      );
      if (el && !el.checked) {
        el.click();
      }
    }
  }

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

  // ============================================================
  // STORAGE
  // ============================================================

  function loadSavedViews() {
    return new Promise(resolve => {
      chrome.storage.local.get(STORAGE_KEY, result => {
        resolve(result[STORAGE_KEY] || {});
      });
    });
  }

  function saveSavedViews(views) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [STORAGE_KEY]: views }, resolve);
    });
  }

  async function saveCurrentView(name) {
    const state = captureCurrentState();
    state.name = name;

    const views = await loadSavedViews();
    const pageKey = getPageKey();
    if (!views[pageKey]) views[pageKey] = [];

    // Replace if same name exists
    const existing = views[pageKey].findIndex(v => v.name === name);
    if (existing >= 0) {
      views[pageKey][existing] = state;
    } else {
      views[pageKey].push(state);
    }

    await saveSavedViews(views);
    return views;
  }

  async function deleteView(name) {
    const views = await loadSavedViews();
    const pageKey = getPageKey();
    if (views[pageKey]) {
      views[pageKey] = views[pageKey].filter(v => v.name !== name);
    }
    await saveSavedViews(views);
    return views;
  }

  async function restoreView(view) {
    // If URL differs, navigate to it
    const currentUrl = window.location.href;
    if (view.url && view.url !== currentUrl) {
      // Store form state to apply after navigation
      sessionStorage.setItem('sd_restore_form_state', JSON.stringify(view));
      window.location.href = view.url;
      return;
    }

    // Same page — just restore form state
    restoreFormState(view);
  }

  // ============================================================
  // UI: FLOATING WIDGET
  // ============================================================

  async function createWidget() {
    if (document.getElementById(WIDGET_ID)) return;

    const widget = document.createElement('div');
    widget.id = WIDGET_ID;
    widget.innerHTML = `
      <button class="sd-filters-toggle" id="sd-filters-toggle" title="Saved Filters">
        <span class="sd-filters-icon">&#9776;</span>
        <span class="sd-filters-label">Views</span>
      </button>
      <div class="sd-filters-panel hidden" id="${PANEL_ID}"></div>
    `;

    document.body.appendChild(widget);

    // Toggle panel
    document.getElementById('sd-filters-toggle').addEventListener('click', () => {
      const panel = document.getElementById(PANEL_ID);
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        renderPanel();
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      const widget = document.getElementById(WIDGET_ID);
      if (widget && !widget.contains(e.target)) {
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.classList.add('hidden');
      }
    });
  }

  async function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const views = await loadSavedViews();
    const pageKey = getPageKey();
    const pageViews = views[pageKey] || [];
    const pageLabel = getPageLabel();

    let viewsHTML = '';
    if (pageViews.length === 0) {
      viewsHTML = '<div class="sd-filters-empty">No saved views for this page</div>';
    } else {
      viewsHTML = pageViews.map(v => {
        const date = new Date(v.timestamp);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const paramCount = (v.search || '').split('&').filter(Boolean).length;

        return `
          <div class="sd-filters-view-item">
            <div class="sd-filters-view-info" data-name="${escapeHtml(v.name)}">
              <span class="sd-filters-view-name">${escapeHtml(v.name)}</span>
              <span class="sd-filters-view-meta">${dateStr} | ${paramCount} filter${paramCount !== 1 ? 's' : ''}</span>
            </div>
            <button class="sd-filters-view-delete" data-name="${escapeHtml(v.name)}" title="Delete">&#x2715;</button>
          </div>
        `;
      }).join('');
    }

    panel.innerHTML = `
      <div class="sd-filters-panel-header">
        <span class="sd-filters-panel-title">Saved Views — ${pageLabel}</span>
      </div>
      <div class="sd-filters-view-list">
        ${viewsHTML}
      </div>
      <div class="sd-filters-save-row">
        <input type="text" class="sd-filters-name-input" id="sd-filters-name"
               placeholder="View name..." maxlength="50" />
        <button class="sd-filters-save-btn" id="sd-filters-save">Save</button>
      </div>
    `;

    // Click to restore
    panel.querySelectorAll('.sd-filters-view-info').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.name;
        const view = pageViews.find(v => v.name === name);
        if (view) restoreView(view);
      });
    });

    // Delete
    panel.querySelectorAll('.sd-filters-view-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        await deleteView(name);
        renderPanel();
      });
    });

    // Save
    document.getElementById('sd-filters-save').addEventListener('click', async () => {
      const input = document.getElementById('sd-filters-name');
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      await saveCurrentView(name);
      renderPanel();
    });

    // Enter key to save
    document.getElementById('sd-filters-name').addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const input = e.target;
        const name = input.value.trim();
        if (!name) return;
        await saveCurrentView(name);
        renderPanel();
      }
    });
  }

  // ============================================================
  // CHECK FOR PENDING RESTORE
  // ============================================================

  async function checkPendingRestore() {
    const pending = sessionStorage.getItem('sd_restore_form_state');
    if (!pending) return;

    sessionStorage.removeItem('sd_restore_form_state');

    try {
      const state = JSON.parse(pending);
      // Wait for page to load
      await sleep(2000);
      restoreFormState(state);
    } catch { /* ignore */ }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isSupportedPage() {
    const path = window.location.pathname;
    return SUPPORTED_PATHS.some(p => path.startsWith(p)) ||
           /sellercentral\.amazon\./.test(window.location.href);
  }

  async function init() {
    // The saved filters widget runs on ALL Seller Central pages
    if (!isSupportedPage()) return;

    await sleep(1000);

    createWidget();
    checkPendingRestore();

    console.log('[SellerData] Saved Filters widget loaded');
  }

  init();
})();
