/**
 * Export Anything — Universal CSV Export for SellerData.
 *
 * Runs on: All Seller Central pages.
 *
 * Features:
 *   1. Table Detection — finds all data tables on the page.
 *   2. Existing Export Check — skips tables that already have a
 *      download/export button nearby (e.g. Business Reports).
 *   3. CSV Export Button — injects a small "Export CSV" button above
 *      each qualifying table.
 *   4. Smart Column Naming — uses <th> text or aria-labels for headers,
 *      falls back to "Column 1", "Column 2", etc.
 *   5. Pagination Awareness — exports what's currently visible. If the
 *      page has a "Show All" or "Show 100" option, clicks it first.
 *   6. Filename — auto-generates based on page path + date.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const BTN_CLASS = 'sd-export-btn';
  const PROCESSED_ATTR = 'data-sd-export';

  // Selectors for existing export/download buttons (skip these tables)
  const EXISTING_EXPORT_SELECTORS = [
    'button[class*="download"]', 'button[class*="Download"]',
    'button[class*="export"]', 'button[class*="Export"]',
    'a[class*="download"]', 'a[class*="Download"]',
    'a[class*="export"]', 'a[class*="Export"]',
    '[data-testid*="download"]', '[data-testid*="export"]',
    'kat-button[label*="ownload"]', 'kat-button[label*="xport"]'
  ];

  // Tables injected by SellerData itself (skip these)
  const SELLERDATA_IDS = [
    'sd-exp-panel', 'sd-coupons-panel', 'sd-removal-panel',
    'sd-shipment-recon-banner', 'sd-ba-panel', 'sd-filters-widget'
  ];

  // Minimum rows to consider a table exportable
  const MIN_ROWS = 2;

  // ============================================================
  // HELPERS
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Escape a value for CSV (RFC 4180).
   */
  function csvEscape(val) {
    const str = String(val || '').trim();
    // Remove excessive whitespace / newlines within cells
    const cleaned = str.replace(/\s+/g, ' ');
    if (cleaned.includes(',') || cleaned.includes('"') || cleaned.includes('\n')) {
      return '"' + cleaned.replace(/"/g, '""') + '"';
    }
    return cleaned;
  }

  /**
   * Generate a filename based on current page and date.
   */
  function generateFilename() {
    const path = window.location.pathname;
    // Extract meaningful slug from path
    const segments = path.split('/').filter(Boolean);
    const slug = segments.slice(0, 3).join('-').replace(/[^a-zA-Z0-9-]/g, '') || 'seller-central';
    const date = new Date().toISOString().split('T')[0];
    return `${slug}_${date}.csv`;
  }

  /**
   * Trigger a file download in the browser.
   */
  function downloadCSV(csvContent, filename) {
    const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ============================================================
  // TABLE DISCOVERY
  // ============================================================

  /**
   * Find all exportable tables on the page.
   * Skips tables that already have export buttons or are SellerData panels.
   */
  function findExportableTables() {
    const tables = [];

    // Standard HTML tables
    document.querySelectorAll('table').forEach(table => {
      if (isExportable(table)) tables.push(table);
    });

    // Kat tables (Amazon's web component)
    document.querySelectorAll('kat-table').forEach(table => {
      if (isExportable(table)) tables.push(table);
    });

    // Div-based tables with role="table" or role="grid"
    document.querySelectorAll('[role="table"], [role="grid"]').forEach(table => {
      if (table.tagName !== 'TABLE' && isExportable(table)) tables.push(table);
    });

    return tables;
  }

  function isExportable(table) {
    // Already processed
    if (table.getAttribute(PROCESSED_ATTR)) return false;

    // Inside a SellerData panel
    for (const id of SELLERDATA_IDS) {
      if (table.closest('#' + id)) return false;
    }

    // Too small
    const rows = getDataRows(table);
    if (rows.length < MIN_ROWS) return false;

    // Check if table or its container already has an export button
    const container = table.closest(
      '.a-box, .a-section, [class*="card"], [class*="Card"], ' +
      '[class*="panel"], [class*="Panel"], section, article'
    ) || table.parentElement;

    if (container) {
      for (const sel of EXISTING_EXPORT_SELECTORS) {
        if (container.querySelector(sel)) return false;
      }
    }

    // Check buttons near the table (within 200px up)
    let sibling = table.previousElementSibling;
    let checked = 0;
    while (sibling && checked < 3) {
      const text = (sibling.textContent || '').toLowerCase();
      if (/download|export|generate report/.test(text)) return false;
      sibling = sibling.previousElementSibling;
      checked++;
    }

    return true;
  }

  // ============================================================
  // TABLE DATA EXTRACTION
  // ============================================================

  /**
   * Extract headers from a table.
   */
  function getHeaders(table) {
    const headers = [];

    // Standard <th> elements
    const thCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
    if (thCells.length > 0) {
      thCells.forEach(th => {
        headers.push(getCleanText(th));
      });
      return headers;
    }

    // Column headers via role
    const colHeaders = table.querySelectorAll('[role="columnheader"]');
    if (colHeaders.length > 0) {
      colHeaders.forEach(h => headers.push(getCleanText(h)));
      return headers;
    }

    // Kat table headers
    const katHeaders = table.querySelectorAll('kat-table-header-column, kat-table-header-cell');
    if (katHeaders.length > 0) {
      katHeaders.forEach(h => headers.push(h.getAttribute('label') || getCleanText(h)));
      return headers;
    }

    // Fallback: first row if it looks like a header
    const firstRow = table.querySelector('tr, [role="row"]');
    if (firstRow) {
      const cells = firstRow.querySelectorAll('td, th, [role="cell"], [role="columnheader"]');
      const allText = Array.from(cells).every(c => {
        const text = c.textContent.trim();
        return text.length > 0 && text.length < 80 && !/^\d+$/.test(text);
      });
      if (allText && cells.length > 1) {
        cells.forEach(c => headers.push(getCleanText(c)));
      }
    }

    return headers;
  }

  /**
   * Get data rows (excluding header rows).
   */
  function getDataRows(table) {
    // Standard tbody rows
    let rows = table.querySelectorAll('tbody tr');
    if (rows.length > 0) {
      return Array.from(rows).filter(r =>
        !r.querySelector('th') && r.textContent.trim().length > 0
      );
    }

    // All rows, skip first if it's a header
    rows = table.querySelectorAll('tr');
    if (rows.length > 0) {
      return Array.from(rows).filter(r =>
        !r.querySelector('th') && r.textContent.trim().length > 0
      );
    }

    // Role-based rows
    rows = table.querySelectorAll('[role="row"]');
    if (rows.length > 0) {
      return Array.from(rows).filter(r => {
        // Skip header rows
        if (r.querySelector('[role="columnheader"]')) return false;
        if (r.closest('thead, [role="rowgroup"]:first-child')) return false;
        return r.textContent.trim().length > 0;
      });
    }

    // Kat table rows
    rows = table.querySelectorAll('kat-table-row');
    return Array.from(rows);
  }

  /**
   * Extract cell values from a row.
   */
  function getRowCells(row) {
    const cells = [];

    // Standard td elements
    let tdCells = row.querySelectorAll('td');
    if (tdCells.length === 0) {
      tdCells = row.querySelectorAll('[role="cell"], [role="gridcell"], kat-table-cell');
    }

    tdCells.forEach(cell => {
      cells.push(getCellValue(cell));
    });

    return cells;
  }

  /**
   * Extract a clean text value from a cell.
   * Prefers input/select values, then link text, then plain text.
   */
  function getCellValue(cell) {
    // If cell contains an input, use its value
    const input = cell.querySelector('input, select, textarea');
    if (input) {
      if (input.type === 'checkbox') return input.checked ? 'Yes' : 'No';
      if (input.value.trim()) return input.value.trim();
    }

    // If cell has a link, prefer the link text
    const link = cell.querySelector('a');
    if (link && link.textContent.trim()) {
      return link.textContent.trim();
    }

    // If cell has an image, use alt text or src filename
    const img = cell.querySelector('img');
    if (img && !cell.textContent.trim()) {
      return img.alt || img.src.split('/').pop().split('?')[0] || '[image]';
    }

    return getCleanText(cell);
  }

  /**
   * Get clean text from an element, stripping excess whitespace.
   */
  function getCleanText(el) {
    // Clone to avoid modifying the DOM
    const clone = el.cloneNode(true);

    // Remove hidden elements and SellerData injections
    clone.querySelectorAll('[style*="display: none"], [style*="display:none"], .hidden, .sd-export-btn').forEach(
      hidden => hidden.remove()
    );

    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // ============================================================
  // CSV GENERATION
  // ============================================================

  function tableToCSV(table) {
    const headers = getHeaders(table);
    const rows = getDataRows(table);

    const csvRows = [];

    // Header row
    if (headers.length > 0) {
      csvRows.push(headers.map(csvEscape).join(','));
    } else {
      // Generate column numbers if no headers found
      if (rows.length > 0) {
        const colCount = getRowCells(rows[0]).length;
        const autoHeaders = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
        csvRows.push(autoHeaders.map(csvEscape).join(','));
      }
    }

    // Data rows
    for (const row of rows) {
      const cells = getRowCells(row);
      if (cells.length > 0 && cells.some(c => c.length > 0)) {
        csvRows.push(cells.map(csvEscape).join(','));
      }
    }

    return csvRows.join('\n');
  }

  // ============================================================
  // PAGINATION: TRY TO SHOW ALL
  // ============================================================

  /**
   * Attempt to expand the table to show all rows before exporting.
   * Returns true if a "show all" action was taken (caller should wait).
   */
  async function tryShowAll(table) {
    // Look for "Show All", "View All", "100 per page" etc near the table
    const container = table.closest(
      '.a-box, .a-section, [class*="card"], [class*="Card"], section, article'
    ) || table.parentElement;

    if (!container) return false;

    // Strategy 1: "Show all" or "View all" link/button
    const allBtns = container.querySelectorAll('a, button, [role="button"], select, kat-dropdown');
    for (const btn of allBtns) {
      const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase();
      if (/show\s*all|view\s*all|display\s*all/.test(text)) {
        btn.click();
        await sleep(2000);
        return true;
      }
    }

    // Strategy 2: Page size dropdown — select the largest option
    const pageSizeSelects = container.querySelectorAll('select');
    for (const select of pageSizeSelects) {
      const options = select.querySelectorAll('option');
      const optTexts = Array.from(options).map(o => ({
        el: o,
        text: o.textContent.toLowerCase(),
        val: parseInt(o.value) || 0
      }));

      // Check if this looks like a page size selector
      const hasNumbers = optTexts.some(o => o.val >= 10 && o.val <= 500);
      const hasAll = optTexts.some(o => /all/.test(o.text));

      if (hasNumbers || hasAll) {
        // Select "All" or the largest number
        const allOpt = optTexts.find(o => /all/.test(o.text));
        if (allOpt) {
          select.value = allOpt.el.value;
        } else {
          const largest = optTexts.reduce((max, o) => o.val > max.val ? o : max, optTexts[0]);
          if (largest && largest.val > parseInt(select.value)) {
            select.value = largest.el.value;
          } else {
            return false;
          }
        }
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(2000);
        return true;
      }
    }

    return false;
  }

  // ============================================================
  // UI: EXPORT BUTTON INJECTION
  // ============================================================

  function injectExportButton(table) {
    if (table.getAttribute(PROCESSED_ATTR)) return;
    table.setAttribute(PROCESSED_ATTR, '1');

    const btn = document.createElement('button');
    btn.className = BTN_CLASS;
    btn.innerHTML = '<span class="sd-export-icon">&#8681;</span> Export CSV';
    btn.title = 'Download this table as a CSV file (SellerData)';

    let exporting = false;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (exporting) return;
      exporting = true;
      btn.disabled = true;
      btn.innerHTML = '<span class="sd-export-icon">&#8987;</span> Exporting...';

      try {
        // Try to show all rows first
        const expanded = await tryShowAll(table);
        if (expanded) {
          // Wait for new rows to render
          await sleep(1500);
        }

        const csv = tableToCSV(table);
        const rowCount = csv.split('\n').length - 1; // minus header

        if (rowCount === 0) {
          btn.innerHTML = '<span class="sd-export-icon">&#9888;</span> No data';
          setTimeout(() => {
            btn.innerHTML = '<span class="sd-export-icon">&#8681;</span> Export CSV';
            btn.disabled = false;
          }, 2000);
          exporting = false;
          return;
        }

        const filename = generateFilename();
        downloadCSV(csv, filename);

        btn.innerHTML = `<span class="sd-export-icon">&#10003;</span> ${rowCount} rows`;
        setTimeout(() => {
          btn.innerHTML = '<span class="sd-export-icon">&#8681;</span> Export CSV';
          btn.disabled = false;
        }, 3000);
      } catch (err) {
        console.error('[SellerData] Export error:', err);
        btn.innerHTML = '<span class="sd-export-icon">&#9888;</span> Error';
        setTimeout(() => {
          btn.innerHTML = '<span class="sd-export-icon">&#8681;</span> Export CSV';
          btn.disabled = false;
        }, 2000);
      }

      exporting = false;
    });

    // Insert before the table
    if (table.parentElement) {
      table.parentElement.insertBefore(btn, table);
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function processPage() {
    const tables = findExportableTables();
    tables.forEach(injectExportButton);
  }

  function isSupportedPage() {
    return /sellercentral\.amazon\./.test(window.location.href);
  }

  async function init() {
    if (!isSupportedPage()) return;

    // Wait for page to fully render
    await sleep(2500);

    processPage();

    // Re-process when page content changes (pagination, AJAX, tab switches)
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processPage, 1500);
    });

    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });

    console.log('[SellerData] Export Anything loaded');
  }

  init();
})();
