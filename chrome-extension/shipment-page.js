/**
 * Shipment Queue Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/gp/ssof/shipping-queue.html
 *
 * Features:
 *   1. FBA / AWD toggle — filters the shipment table to show only one type.
 *      Defaults to FBA every time the page loads.
 *   2. Hover tooltip — mousing over a shipment name shows a detail card with
 *      full contents (SKUs, quantities) and all tracking info.
 *   3. Red highlight on unreconciled shipments — rows where received units
 *      differ from shipped units get a red background.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const TOGGLE_ID = 'sellerdata-shipment-toggle';
  const TOOLTIP_ID = 'sellerdata-shipment-tooltip';
  const STORAGE_KEY = 'sellerdata_shipment_filter'; // not persisted — always FBA on load

  // Keywords that identify AWD shipments in the shipment name or workflow
  const AWD_KEYWORDS = [
    'AWD', 'Amazon Warehousing', 'Warehousing and Distribution',
    'SEND_TO_AMAZON_WAREHOUSING', 'SEND_TO_AWD'
  ];

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Wait for an element matching `selector` to appear in the DOM.
   */
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, timeout);
    });
  }

  /**
   * Check whether a shipment row is AWD based on its text content.
   */
  function isAWDShipment(row) {
    const text = row.textContent || '';
    return AWD_KEYWORDS.some(kw => text.toUpperCase().includes(kw.toUpperCase()));
  }

  // ============================================================
  // 1. FBA / AWD TOGGLE
  // ============================================================

  let currentFilter = 'FBA'; // always start on FBA

  function createToggle() {
    if (document.getElementById(TOGGLE_ID)) return;

    const container = document.createElement('div');
    container.id = TOGGLE_ID;
    container.innerHTML = `
      <span class="sd-toggle-label">Show shipments:</span>
      <div class="sd-toggle-btns">
        <button class="sd-toggle-btn sd-toggle-active" data-filter="FBA">FBA</button>
        <button class="sd-toggle-btn" data-filter="AWD">AWD</button>
      </div>
    `;

    // Insert before the shipment table
    const tableAnchor = document.querySelector(
      '.shipment-list-table, #fbaShipmentTable, [data-testid="shipment-list"], .a-table-wrapper, table'
    );
    if (tableAnchor && tableAnchor.parentElement) {
      tableAnchor.parentElement.insertBefore(container, tableAnchor);
    } else {
      // Fallback: insert at top of main content
      const main = document.querySelector('#sc-content-container, .content-container, main, #content');
      if (main) main.prepend(container);
    }

    // Button click handlers
    container.querySelectorAll('.sd-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sd-toggle-btn').forEach(b => b.classList.remove('sd-toggle-active'));
        btn.classList.add('sd-toggle-active');
        currentFilter = btn.dataset.filter;
        applyFilter();
      });
    });

    return container;
  }

  function getShipmentRows() {
    // The shipping queue page renders shipments as table rows.
    // Try several selectors the page may use.
    const selectors = [
      '.shipment-list-table tbody tr',
      '#fbaShipmentTable tbody tr',
      '[data-testid="shipment-row"]',
      'table.a-table tbody tr',
      'table tbody tr'
    ];
    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      if (rows.length > 0) return Array.from(rows);
    }
    return [];
  }

  function applyFilter() {
    const rows = getShipmentRows();
    rows.forEach(row => {
      // Skip header rows
      if (row.querySelector('th')) return;

      const awd = isAWDShipment(row);
      if (currentFilter === 'FBA') {
        row.style.display = awd ? 'none' : '';
      } else {
        row.style.display = awd ? '' : 'none';
      }
    });
  }

  // ============================================================
  // 2. HOVER TOOLTIP — SHIPMENT DETAILS
  // ============================================================

  let activeTooltip = null;
  let hoverTimeout = null;

  function removeTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }
  }

  /**
   * Parse shipment detail data from a row.
   * Amazon's shipping queue stores data in various cells / data attributes.
   */
  function extractShipmentData(row) {
    const cells = row.querySelectorAll('td');
    const data = {
      name: '',
      shipmentId: '',
      status: '',
      skus: [],
      quantityShipped: '',
      quantityReceived: '',
      created: '',
      trackingNumbers: [],
      estimatedArrival: '',
      carrier: ''
    };

    // Shipment name — usually in the first or second cell, often as a link
    const nameLink = row.querySelector('a[href*="shipment"]') || row.querySelector('a');
    if (nameLink) {
      data.name = nameLink.textContent.trim();
      const href = nameLink.getAttribute('href') || '';
      const idMatch = href.match(/shipmentId=([A-Z0-9]+)/i) || href.match(/([A-Z]{3}[A-Z0-9]{6,})/);
      if (idMatch) data.shipmentId = idMatch[1];
    }

    // Walk cells and look for recognizable content
    cells.forEach(cell => {
      const text = cell.textContent.trim();
      const lower = text.toLowerCase();

      // Status cell (common statuses)
      if (/^(working|ready to ship|shipped|in transit|delivered|receiving|closed|checked.in|reconcil)/i.test(text)) {
        data.status = text;
      }

      // Dates (MM/DD/YYYY or YYYY-MM-DD patterns)
      if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text) || /\d{4}-\d{2}-\d{2}/.test(text)) {
        if (!data.created) data.created = text;
        else if (!data.estimatedArrival) data.estimatedArrival = text;
      }

      // Quantity — cells with just a number
      if (/^\d+$/.test(text) && parseInt(text) > 0) {
        if (!data.quantityShipped) data.quantityShipped = text;
        else if (!data.quantityReceived) data.quantityReceived = text;
      }
    });

    // Tracking — look in data attributes or nested elements
    const trackingEls = row.querySelectorAll('[data-tracking], .tracking-number, [data-testid*="tracking"]');
    trackingEls.forEach(el => {
      const val = el.dataset.tracking || el.textContent.trim();
      if (val) data.trackingNumbers.push(val);
    });

    // Carrier
    const carrierEl = row.querySelector('[data-carrier], .carrier-name');
    if (carrierEl) data.carrier = carrierEl.dataset.carrier || carrierEl.textContent.trim();

    // SKUs — stored in data attributes or sub-rows
    const skuEls = row.querySelectorAll('[data-sku], [data-msku], .sku-cell');
    skuEls.forEach(el => {
      data.skus.push(el.dataset.sku || el.dataset.msku || el.textContent.trim());
    });

    // Also try to read from a data attribute on the row itself
    if (row.dataset.shipmentId) data.shipmentId = row.dataset.shipmentId;
    if (row.dataset.status) data.status = row.dataset.status;

    return data;
  }

  function buildTooltipHTML(data) {
    const sections = [];

    // Header
    sections.push(`<div class="sd-tip-header">${data.name || 'Shipment'}</div>`);
    if (data.shipmentId) {
      sections.push(`<div class="sd-tip-id">${data.shipmentId}</div>`);
    }

    // Status
    if (data.status) {
      sections.push(`<div class="sd-tip-row"><span class="sd-tip-label">Status:</span> <span class="sd-tip-value">${data.status}</span></div>`);
    }

    // Quantities
    if (data.quantityShipped) {
      let qtyHTML = `<span class="sd-tip-label">Shipped:</span> <span class="sd-tip-value">${data.quantityShipped}</span>`;
      if (data.quantityReceived) {
        const shipped = parseInt(data.quantityShipped);
        const received = parseInt(data.quantityReceived);
        const mismatch = shipped !== received;
        qtyHTML += `&nbsp;&nbsp;<span class="sd-tip-label">Received:</span> <span class="sd-tip-value${mismatch ? ' sd-tip-mismatch' : ''}">${data.quantityReceived}</span>`;
        if (mismatch) {
          const diff = received - shipped;
          qtyHTML += ` <span class="sd-tip-mismatch">(${diff > 0 ? '+' : ''}${diff})</span>`;
        }
      }
      sections.push(`<div class="sd-tip-row">${qtyHTML}</div>`);
    }

    // SKUs
    if (data.skus.length > 0) {
      const skuList = data.skus.map(s => `<div class="sd-tip-sku">${s}</div>`).join('');
      sections.push(`<div class="sd-tip-row"><span class="sd-tip-label">Contents:</span></div><div class="sd-tip-sku-list">${skuList}</div>`);
    }

    // Tracking
    if (data.trackingNumbers.length > 0) {
      const trackList = data.trackingNumbers.map(t => `<div class="sd-tip-tracking">${t}</div>`).join('');
      sections.push(`<div class="sd-tip-row"><span class="sd-tip-label">Tracking:</span></div>${trackList}`);
    }

    if (data.carrier) {
      sections.push(`<div class="sd-tip-row"><span class="sd-tip-label">Carrier:</span> <span class="sd-tip-value">${data.carrier}</span></div>`);
    }

    // Dates
    if (data.created) {
      sections.push(`<div class="sd-tip-row"><span class="sd-tip-label">Created:</span> <span class="sd-tip-value">${data.created}</span></div>`);
    }
    if (data.estimatedArrival) {
      sections.push(`<div class="sd-tip-row"><span class="sd-tip-label">Expected:</span> <span class="sd-tip-value">${data.estimatedArrival}</span></div>`);
    }

    return sections.join('');
  }

  function showTooltip(row, nameEl) {
    removeTooltip();

    const data = extractShipmentData(row);
    const tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.innerHTML = buildTooltipHTML(data);

    document.body.appendChild(tooltip);
    activeTooltip = tooltip;

    // Position near the hovered element
    const rect = nameEl.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;

    // Keep it on screen
    if (left + tooltipRect.width > window.innerWidth - 16) {
      left = window.innerWidth - tooltipRect.width - 16;
    }
    if (top + tooltipRect.height > window.innerHeight + window.scrollY - 16) {
      top = rect.top + window.scrollY - tooltipRect.height - 8;
    }

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function attachHoverListeners() {
    const rows = getShipmentRows();
    rows.forEach(row => {
      if (row.querySelector('th')) return;
      if (row.dataset.sdHover) return; // already attached
      row.dataset.sdHover = '1';

      // Find the shipment name element (first link or first cell)
      const nameEl = row.querySelector('a[href*="shipment"]') || row.querySelector('a') || row.querySelector('td');
      if (!nameEl) return;

      nameEl.classList.add('sd-shipment-name-hover');

      nameEl.addEventListener('mouseenter', () => {
        hoverTimeout = setTimeout(() => showTooltip(row, nameEl), 200);
      });

      nameEl.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimeout);
        // Small delay so user can move mouse to tooltip
        setTimeout(removeTooltip, 150);
      });
    });
  }

  // Keep tooltip alive when mouse moves onto it
  document.addEventListener('mouseenter', (e) => {
    if (e.target.id === TOOLTIP_ID || e.target.closest('#' + TOOLTIP_ID)) {
      clearTimeout(hoverTimeout);
    }
  }, true);
  document.addEventListener('mouseleave', (e) => {
    if (e.target.id === TOOLTIP_ID || e.target.closest('#' + TOOLTIP_ID)) {
      setTimeout(removeTooltip, 150);
    }
  }, true);

  // ============================================================
  // 3. RED HIGHLIGHT — UNRECONCILED SHIPMENTS
  // ============================================================

  function highlightUnreconciled() {
    const rows = getShipmentRows();
    rows.forEach(row => {
      if (row.querySelector('th')) return;

      row.classList.remove('sd-shipment-unreconciled');

      const cells = row.querySelectorAll('td');
      const numbers = [];
      cells.forEach(cell => {
        const text = cell.textContent.trim();
        if (/^\d+$/.test(text)) numbers.push(parseInt(text));
      });

      // If we found at least two numeric columns, compare shipped vs received.
      // The typical layout has shipped quantity followed by received quantity.
      if (numbers.length >= 2) {
        const shipped = numbers[0];
        const received = numbers[1];
        if (shipped !== received && received > 0) {
          row.classList.add('sd-shipment-unreconciled');
        }
      }

      // Also flag rows whose status text mentions reconciliation issues
      const text = row.textContent.toLowerCase();
      if (
        text.includes('problem') ||
        text.includes('mismatch') ||
        text.includes('discrepancy') ||
        (text.includes('reconcil') && !text.includes('reconciled'))
      ) {
        row.classList.add('sd-shipment-unreconciled');
      }
    });
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isShippingQueuePage() {
    const url = window.location.href;
    return /\/gp\/ssof\/shipping-queue/.test(url) || /fbashipment/.test(url);
  }

  async function init() {
    if (!isShippingQueuePage()) return;

    try {
      // Wait for the shipment table to render (Amazon loads it dynamically)
      await waitForElement(
        '.shipment-list-table, #fbaShipmentTable, [data-testid="shipment-list"], table',
        15000
      );
    } catch {
      // Table never appeared — may be an empty page or different layout
      return;
    }

    // Small delay for Amazon's JS to finish rendering rows
    setTimeout(() => {
      createToggle();
      applyFilter();
      attachHoverListeners();
      highlightUnreconciled();

      // Re-apply when Amazon dynamically updates the table (e.g. pagination, AJAX)
      const observer = new MutationObserver(() => {
        applyFilter();
        attachHoverListeners();
        highlightUnreconciled();
      });
      const table = document.querySelector(
        '.shipment-list-table, #fbaShipmentTable, [data-testid="shipment-list"], table'
      );
      if (table) {
        observer.observe(table, { childList: true, subtree: true });
      }
    }, 500);
  }

  init();
})();
