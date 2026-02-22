/**
 * ASDN Order History Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/asdn/order-history
 *          (Send to Amazon / Amazon Supply Chain order history)
 *
 * Features:
 *   1. Failed Shipment Highlighting — any shipment with a failed / error /
 *      cancelled status from the last 30-45 days is highlighted in red
 *      and floated above all other data.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const BANNER_ID = 'sd-asdn-failed-banner';

  // How far back to look for failed shipments (in days)
  const LOOKBACK_DAYS = 45;

  // Status keywords that indicate a failed / problematic shipment
  const FAILED_KEYWORDS = [
    'failed',
    'error',
    'cancelled',
    'canceled',
    'rejected',
    'expired',
    'problem',
    'unable',
    'voided',
    'deleted',
    'closed'
  ];

  // Statuses that are clearly NOT failed (to avoid false positives on
  // partial text matches like "closed" inside "disclosed")
  const OK_STATUSES = [
    'delivered',
    'completed',
    'checked in',
    'receiving',
    'in transit',
    'ready to ship',
    'working',
    'shipped',
    'created'
  ];

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
   * Parse a date string from the page. Amazon uses various formats:
   *   "Feb 22, 2026", "2026-02-22", "02/22/2026", "22/02/2026"
   */
  function parseDate(text) {
    if (!text) return null;
    const cleaned = text.trim();

    // ISO: 2026-02-22
    const iso = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));

    // US: 02/22/2026 or 2/22/2026
    const usDate = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usDate) return new Date(parseInt(usDate[3]), parseInt(usDate[1]) - 1, parseInt(usDate[2]));

    // Named month: Feb 22, 2026 or February 22, 2026
    const named = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (named) {
      const d = new Date(`${named[1]} ${named[2]}, ${named[3]}`);
      if (!isNaN(d.getTime())) return d;
    }

    // Fallback: let JS try
    const fallback = new Date(cleaned);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  /**
   * Check if a date is within the lookback window.
   */
  function isWithinLookback(date) {
    if (!date) return true; // If we can't parse the date, include it to be safe
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
    return date >= cutoff;
  }

  // ============================================================
  // ROW DISCOVERY
  // ============================================================

  /**
   * Get all order/shipment rows from the ASDN order history page.
   * The page may use tables, cards, or list layouts.
   */
  function getOrderRows() {
    const selectors = [
      // Table-based layouts
      '[data-testid="order-row"]',
      '[data-testid="shipment-row"]',
      '[data-testid="order-history-row"]',
      'table tbody tr',
      '.a-table tbody tr',
      // Card-based layouts
      '[class*="order-card"]',
      '[class*="OrderCard"]',
      '[class*="shipment-card"]',
      '[class*="ShipmentCard"]',
      '[class*="order-row"]',
      '[class*="OrderRow"]',
      // List-based layouts
      '[data-testid*="order-list"] > div',
      '[data-testid*="shipment-list"] > div',
      '.order-history-item',
      // Generic: rows inside the main content area
      '[class*="kat-row"]',
      'kat-table-row',
      '[role="row"]'
    ];

    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      const filtered = Array.from(rows).filter(r =>
        !r.querySelector('th') && r.textContent.trim().length > 10
      );
      if (filtered.length > 0) return filtered;
    }

    return [];
  }

  /**
   * Determine if a row represents a failed shipment.
   */
  function isFailedShipment(row) {
    const text = (row.textContent || '').toLowerCase();
    const html = (row.innerHTML || '').toLowerCase();

    // First check if it has an explicit OK status — skip if so
    for (const ok of OK_STATUSES) {
      // Match as a standalone status (not part of another word)
      const regex = new RegExp('\\b' + ok.replace(/\s+/g, '\\s+') + '\\b');
      if (regex.test(text)) return false;
    }

    // Check for failed keywords
    for (const kw of FAILED_KEYWORDS) {
      if (text.includes(kw)) return true;
    }

    // Check data attributes and CSS classes for failure indicators
    if (html.includes('status-failed') || html.includes('status-error') ||
        html.includes('status-cancelled') || html.includes('status-canceled') ||
        html.includes('status-rejected') || html.includes('status-expired')) {
      return true;
    }

    // Check for status badges / icons
    if (row.querySelector(
      '[data-status*="fail"], [data-status*="error"], [data-status*="cancel"], ' +
      '[data-status*="reject"], [data-status*="expired"], [data-status*="problem"], ' +
      '[class*="fail"], [class*="error"], [class*="cancel"], [class*="reject"]'
    )) {
      return true;
    }

    // Check for red/warning colored status text (Amazon often uses inline styles)
    const statusEls = row.querySelectorAll(
      '[class*="status"], [class*="Status"], [data-testid*="status"], .a-color-error, .a-color-warning'
    );
    for (const el of statusEls) {
      const statusText = el.textContent.toLowerCase().trim();
      for (const kw of FAILED_KEYWORDS) {
        if (statusText.includes(kw)) return true;
      }
    }

    return false;
  }

  /**
   * Extract a date from a row (creation date, last update, etc.).
   * Returns the most recent date found.
   */
  function extractRowDate(row) {
    const cells = row.querySelectorAll('td, [class*="date"], [class*="Date"], [data-testid*="date"], time');
    let latestDate = null;

    for (const cell of cells) {
      // Check <time> elements first (semantic)
      const timeEl = cell.tagName === 'TIME' ? cell : cell.querySelector('time');
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime') || timeEl.textContent;
        const parsed = parseDate(dt);
        if (parsed && (!latestDate || parsed > latestDate)) {
          latestDate = parsed;
        }
      }

      // Check cell text for date patterns
      const text = cell.textContent.trim();
      const datePatterns = [
        /\d{4}-\d{1,2}-\d{1,2}/,
        /\d{1,2}\/\d{1,2}\/\d{4}/,
        /[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/
      ];

      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
          const parsed = parseDate(match[0]);
          if (parsed && (!latestDate || parsed > latestDate)) {
            latestDate = parsed;
          }
        }
      }
    }

    // Also check data attributes on the row itself
    const dateAttrs = ['data-date', 'data-created', 'data-updated', 'data-creation-date'];
    for (const attr of dateAttrs) {
      const val = row.getAttribute(attr);
      if (val) {
        const parsed = parseDate(val);
        if (parsed && (!latestDate || parsed > latestDate)) {
          latestDate = parsed;
        }
      }
    }

    return latestDate;
  }

  // ============================================================
  // HIGHLIGHTING + SUMMARY BANNER
  // ============================================================

  /**
   * Scan all rows, highlight failed ones, and move them to the top
   * via a summary banner.
   */
  function highlightFailedShipments() {
    const rows = getOrderRows();
    const failedRows = [];

    rows.forEach(row => {
      row.classList.remove('sd-asdn-failed');

      const rowDate = extractRowDate(row);
      const withinWindow = isWithinLookback(rowDate);

      if (withinWindow && isFailedShipment(row)) {
        row.classList.add('sd-asdn-failed');
        failedRows.push({
          element: row,
          date: rowDate,
          text: extractRowSummary(row)
        });
      }
    });

    // Build / update the summary banner above the data
    updateFailedBanner(failedRows);

    return failedRows.length;
  }

  /**
   * Extract a short summary from a row for the banner.
   */
  function extractRowSummary(row) {
    // Try to find shipment name / ID
    const nameEl = row.querySelector(
      'a[href*="shipment"], a[href*="order"], a[href*="asdn"], ' +
      '[data-testid*="name"], [data-testid*="id"], ' +
      '[class*="name"], [class*="Name"], [class*="title"], [class*="Title"]'
    );
    if (nameEl) return nameEl.textContent.trim().substring(0, 80);

    // First link text
    const firstLink = row.querySelector('a');
    if (firstLink) return firstLink.textContent.trim().substring(0, 80);

    // First cell text
    const firstCell = row.querySelector('td');
    if (firstCell) return firstCell.textContent.trim().substring(0, 80);

    return row.textContent.trim().substring(0, 80);
  }

  /**
   * Extract the status text from a row.
   */
  function extractRowStatus(row) {
    const statusEl = row.querySelector(
      '[class*="status"], [class*="Status"], [data-testid*="status"], ' +
      '.a-color-error, .a-color-warning'
    );
    if (statusEl) return statusEl.textContent.trim();

    // Fallback: search row text for a failed keyword
    const text = row.textContent.toLowerCase();
    for (const kw of FAILED_KEYWORDS) {
      if (text.includes(kw)) {
        // Capitalize first letter
        return kw.charAt(0).toUpperCase() + kw.slice(1);
      }
    }
    return 'Failed';
  }

  /**
   * Create or update the failed-shipments summary banner at the top of the page.
   */
  function updateFailedBanner(failedRows) {
    let banner = document.getElementById(BANNER_ID);

    if (failedRows.length === 0) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;

      // Insert at the top of the main content, above any tables/lists
      const anchor = document.querySelector(
        '#sc-content-container, .content-container, main, #content, [role="main"]'
      );
      if (anchor) {
        anchor.insertBefore(banner, anchor.firstChild);
      } else {
        document.body.prepend(banner);
      }
    }

    // Build the banner content
    const itemsHTML = failedRows.map((item, i) => {
      const status = extractRowStatus(item.element);
      const dateStr = item.date ? item.date.toLocaleDateString() : 'Unknown date';
      return `
        <div class="sd-asdn-failed-item" data-index="${i}">
          <span class="sd-asdn-failed-item-status">${status}</span>
          <span class="sd-asdn-failed-item-name">${item.text}</span>
          <span class="sd-asdn-failed-item-date">${dateStr}</span>
          <button class="sd-asdn-failed-item-goto" data-index="${i}" title="Scroll to this shipment">View</button>
        </div>
      `;
    }).join('');

    banner.innerHTML = `
      <div class="sd-asdn-failed-header">
        <span class="sd-asdn-failed-icon">!</span>
        <span class="sd-asdn-failed-title">
          ${failedRows.length} Failed Shipment${failedRows.length !== 1 ? 's' : ''}
          <span class="sd-asdn-failed-subtitle">(last ${LOOKBACK_DAYS} days)</span>
        </span>
      </div>
      <div class="sd-asdn-failed-list">
        ${itemsHTML}
      </div>
    `;

    // Attach click handlers to "View" buttons
    banner.querySelectorAll('.sd-asdn-failed-item-goto').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        if (failedRows[idx]) {
          const row = failedRows[idx].element;
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Flash the row for emphasis
          row.classList.add('sd-asdn-failed-flash');
          setTimeout(() => row.classList.remove('sd-asdn-failed-flash'), 2000);
        }
      });
    });
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isASDNOrderHistoryPage() {
    const url = window.location.href;
    return /\/asdn\/order-history/.test(url) || /\/asdn\//.test(url);
  }

  async function init() {
    if (!isASDNOrderHistoryPage()) return;

    // Wait for the order history content to render
    try {
      await waitForElement(
        'table, [data-testid*="order"], [data-testid*="shipment"], [class*="order"], ' +
        '[class*="Order"], [role="table"], [role="grid"], kat-table',
        20000
      );
    } catch {
      // Content may use a different layout — still attempt
    }

    // Give React/AJAX a moment to finish
    await sleep(1200);

    const failedCount = highlightFailedShipments();
    console.log(`[SellerData] ASDN order history: ${failedCount} failed shipment(s) highlighted`);

    // Re-scan when Amazon dynamically updates the page (pagination, filters, AJAX)
    const observer = new MutationObserver(() => {
      highlightFailedShipments();
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  init();
})();
