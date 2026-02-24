/**
 * Datarova Bulk Report Downloader - Content Script
 *
 * Runs on app.datarova.com pages:
 *   /projects       → detects project cards (name, ASIN, marketplace)
 *   /projects/*/ranks/* → triggers Export > Daily Ranks
 *   /download-report → clicks download buttons on Ready rows
 */

(function () {
  'use strict';

  // Country code lookup used by marketplace detection
  var CODE_MAP = {
    us: 'US', ca: 'CA', mx: 'MX', uk: 'UK', gb: 'UK',
    de: 'DE', fr: 'FR', it: 'IT', es: 'ES', jp: 'JP',
    au: 'AU', 'in': 'IN', br: 'BR', nl: 'NL', se: 'SE',
    pl: 'PL', sg: 'SG', ae: 'AE', sa: 'SA', eg: 'EG', tr: 'TR', be: 'BE',
  };

  var COUNTRY_NAMES = {
    'united states': 'US', 'usa': 'US', 'america': 'US',
    'canada': 'CA', 'mexico': 'MX',
    'united kingdom': 'UK', 'great britain': 'UK', 'britain': 'UK',
    'germany': 'DE', 'france': 'FR', 'italy': 'IT', 'spain': 'ES',
    'japan': 'JP', 'australia': 'AU', 'india': 'IN', 'brazil': 'BR',
    'netherlands': 'NL', 'sweden': 'SE', 'poland': 'PL',
    'singapore': 'SG', 'saudi arabia': 'SA', 'egypt': 'EG', 'turkey': 'TR',
    'belgium': 'BE', 'uae': 'AE',
  };

  // ── Project Detection (runs on /projects page) ───────────────────────────

  function detectProjects() {
    var projects = [];
    var seen = new Set();

    document.querySelectorAll('a[href*="/projects/"]').forEach(function (a) {
      var href = a.href || '';
      var match = href.match(/\/projects\/(\d+)(?:\/\w+\/([A-Z0-9]{10}))?/);
      if (!match) return;

      var projectId = match[1];
      if (seen.has(projectId)) return;
      seen.add(projectId);

      var asin = match[2] || extractAsinFromText(a);
      var card = findCardContainer(a, projectId);
      var name = extractNameFromCard(card, asin);
      var marketplace = extractMarketplace(card);

      projects.push({
        id: projectId,
        name: name || 'Project ' + projectId,
        asin: asin || '',
        marketplace: marketplace || 'US',
      });
    });

    return projects;
  }

  function findCardContainer(el) {
    var current = el;
    for (var i = 0; i < 10 && current.parentElement; i++) {
      current = current.parentElement;
      var text = current.textContent || '';
      if (current.querySelector('img') &&
          (text.includes('Keyword') || text.includes('ASIN'))) {
        var links = current.querySelectorAll('a[href*="/projects/"]');
        var uniqueIds = new Set();
        links.forEach(function (l) {
          var m = (l.href || '').match(/\/projects\/(\d+)/);
          if (m) uniqueIds.add(m[1]);
        });
        if (uniqueIds.size <= 1) return current;
      }
    }
    return el.parentElement || el;
  }

  function extractNameFromCard(card, asin) {
    if (!card) return '';

    if (asin) {
      var fullText = card.textContent || '';
      var idx = fullText.indexOf(asin);
      if (idx > 0) {
        var name = fullText.substring(0, idx)
          .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
          .replace(/\s+/g, ' ')
          .trim();
        name = name.replace(/[^a-zA-Z0-9)]+$/, '').trim();
        if (name.length > 1) return name;
      }
    }

    var headings = card.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var h of headings) {
      var t = (h.textContent || '').trim();
      if (t.length > 1 && !/^B0[A-Z0-9]{8}$/.test(t)) return t;
    }

    var walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var txt = walker.currentNode.textContent.trim();
      if (txt.length > 2 &&
          !/^B0[A-Z0-9]{8}/.test(txt) &&
          !/^\d+\s*(ASIN|Keyword)/i.test(txt) &&
          !/^(Export|Delete|Edit|Settings)/i.test(txt)) {
        return txt;
      }
    }

    return '';
  }

  function extractAsinFromText(el) {
    var text = (el.textContent || '') + ' ' + (el.href || '');
    var match = text.match(/\b(B0[A-Z0-9]{8})\b/);
    return match ? match[1] : null;
  }

  // ── Marketplace Detection (robust multi-strategy) ────────────────────────

  function extractMarketplace(card) {
    if (!card) return null;

    // Strategy 1: Check all small images for country codes in src/alt/title
    var imgs = card.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      // Skip large images (product photos are big, flags are small icons)
      var rect = img.getBoundingClientRect();
      if (rect.width > 60 || rect.height > 60) continue;
      if (img.naturalWidth > 100 || img.naturalHeight > 100) continue;

      var code = getCountryFromImage(img);
      if (code) return code;
    }

    // Strategy 2: Check SVGs (inline flag icons)
    var svgs = card.querySelectorAll('svg');
    for (var s = 0; s < svgs.length; s++) {
      var parent = svgs[s].closest('[title], [aria-label], [data-country]');
      if (parent) {
        var label = (parent.title || parent.getAttribute('aria-label') ||
                     parent.dataset.country || '').toLowerCase();
        var resolved = resolveCountryCode(label);
        if (resolved) return resolved;
      }
    }

    // Strategy 3: Check elements with flag/country/marketplace CSS classes or data attrs
    var flagEls = card.querySelectorAll(
      '[class*="flag"], [class*="country"], [class*="marketplace"], ' +
      '[data-country], [data-marketplace], [title]'
    );
    for (var f = 0; f < flagEls.length; f++) {
      var el = flagEls[f];
      var className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      var dataVal = (el.dataset.country || el.dataset.marketplace || '').toLowerCase();
      var titleVal = (el.title || '').toLowerCase();
      var combined = className + ' ' + dataVal + ' ' + titleVal;

      // Check for 2-letter codes in class names like "flag-us", "flag-ca"
      var classMatch = combined.match(/(?:flag|country|marketplace)[-_]?([a-z]{2})\b/);
      if (classMatch && CODE_MAP[classMatch[1]]) {
        return CODE_MAP[classMatch[1]];
      }

      var r = resolveCountryCode(dataVal) || resolveCountryCode(titleVal);
      if (r) return r;
    }

    // Strategy 4: Flag emojis
    var text = card.textContent || '';
    var flagEmojiMap = {
      '\u{1F1FA}\u{1F1F8}': 'US', '\u{1F1E8}\u{1F1E6}': 'CA',
      '\u{1F1F2}\u{1F1FD}': 'MX', '\u{1F1EC}\u{1F1E7}': 'UK',
      '\u{1F1E9}\u{1F1EA}': 'DE', '\u{1F1EB}\u{1F1F7}': 'FR',
      '\u{1F1EE}\u{1F1F9}': 'IT', '\u{1F1EA}\u{1F1F8}': 'ES',
      '\u{1F1EF}\u{1F1F5}': 'JP', '\u{1F1E6}\u{1F1FA}': 'AU',
      '\u{1F1EE}\u{1F1F3}': 'IN',
    };
    for (var emoji in flagEmojiMap) {
      if (text.includes(emoji)) return flagEmojiMap[emoji];
    }

    return null;
  }

  /**
   * Extract a country code from an <img> element by inspecting its
   * src URL path segments, filename, alt text, and title attribute.
   */
  function getCountryFromImage(img) {
    var src = img.src || '';
    var attrs = [img.alt, img.title, img.getAttribute('aria-label')];

    // Check the URL: extract filename and last few path segments
    var urlPath = src.split('?')[0].split('#')[0].toLowerCase();
    var segments = urlPath.split('/');

    // Check filename first (e.g., "us.svg", "ca.png", "gb-flag.svg")
    var filename = segments[segments.length - 1] || '';
    var nameOnly = filename.replace(/\.[^.]+$/, ''); // strip extension

    // Exact 2-letter filename match (most common flag URL pattern)
    if (nameOnly.length === 2 && CODE_MAP[nameOnly]) {
      return CODE_MAP[nameOnly];
    }

    // Filename with prefix/suffix like "flag-us", "us-flag", "flag_ca"
    var fnMatch = nameOnly.match(/(?:^|[-_])([a-z]{2})(?:[-_]|$)/);
    if (fnMatch && CODE_MAP[fnMatch[1]]) {
      return CODE_MAP[fnMatch[1]];
    }

    // Check last 4 path segments for standalone 2-letter country codes
    // e.g., /flags/us/flag.svg → segment "us" matches
    for (var i = Math.max(1, segments.length - 4); i < segments.length - 1; i++) {
      var seg = segments[i];
      if (seg.length === 2 && CODE_MAP[seg]) {
        return CODE_MAP[seg];
      }
    }

    // Check alt, title, aria-label attributes
    for (var a = 0; a < attrs.length; a++) {
      if (!attrs[a]) continue;
      var val = attrs[a].toLowerCase().trim();

      // Exact 2-letter code match
      if (val.length === 2 && CODE_MAP[val]) {
        return CODE_MAP[val];
      }
      // Check for country names
      var resolved = resolveCountryCode(val);
      if (resolved) return resolved;
    }

    return null;
  }

  /**
   * Resolve a string to a marketplace code by checking for known
   * 2-letter codes and country names.
   */
  function resolveCountryCode(str) {
    if (!str) return null;
    var lc = str.toLowerCase().trim();
    if (lc.length === 2 && CODE_MAP[lc]) return CODE_MAP[lc];
    for (var name in COUNTRY_NAMES) {
      if (lc.includes(name)) return COUNTRY_NAMES[name];
    }
    return null;
  }

  // ── Export Triggering (runs on /projects/<id>/ranks/<asin> page) ──────────

  async function triggerExport() {
    var exportBtn = findButtonByText('export');
    if (!exportBtn) {
      throw new Error('Export button not found on page');
    }

    exportBtn.click();
    await sleep(800);

    var menu = await waitForElement(
      '[role="menu"], [role="presentation"] ul, ' +
      '.MuiMenu-list, .MuiPopover-paper, .MuiPaper-root ul',
      5000
    );

    if (!menu) {
      throw new Error('Export menu did not open');
    }

    await sleep(300);

    var menuItems = document.querySelectorAll(
      '[role="menuitem"], .MuiMenuItem-root, ' +
      '.MuiListItem-root, [role="presentation"] li'
    );

    var dailyRanksItem = null;
    for (var item of menuItems) {
      var text = (item.textContent || '').trim().toLowerCase();
      if (text.includes('daily') && text.includes('rank')) {
        dailyRanksItem = item;
        break;
      }
    }

    if (!dailyRanksItem) {
      document.body.click();
      throw new Error('Daily Ranks option not found in export menu');
    }

    dailyRanksItem.click();
    await sleep(3000);
    return true;
  }

  // ── Download Page Handling (runs on /download-report page) ────────────────

  /**
   * Click download buttons for the top N "Ready" reports on the download page.
   * Processes from bottom to top (oldest first → most likely to be ready).
   *
   * The MUI table structure:
   *   table.MuiTable-root > tbody > tr#body-row-N > td cells
   * The last td in each row contains the action buttons (download + delete).
   * Download button is the first clickable element; delete is the second.
   */
  async function downloadReadyReports(count) {
    // Wait for the MUI table to be present
    var table = await waitForElement('table.MuiTable-root, table', 8000);
    if (!table) {
      throw new Error('Download report table not found');
    }

    var rows = table.querySelectorAll('tbody tr[id^="body-row-"]');
    if (rows.length === 0) {
      // Fallback: try any tbody tr
      rows = table.querySelectorAll('tbody tr');
    }
    if (rows.length === 0) {
      throw new Error('No report rows found');
    }

    // Take the top N rows (most recent exports) and reverse so we
    // start from the oldest (most time to generate → most likely ready)
    var targetRows = Array.from(rows).slice(0, count || rows.length);
    targetRows.reverse();

    var downloaded = 0;
    var skipped = 0;

    for (var i = 0; i < targetRows.length; i++) {
      var row = targetRows[i];

      // Check if this row's status is "Ready"
      if (!isRowReady(row)) {
        skipped++;
        continue;
      }

      // Find the download button in the action cell (last td)
      var downloadBtn = findDownloadButton(row);
      if (!downloadBtn) {
        skipped++;
        continue;
      }

      downloadBtn.click();
      downloaded++;
      await sleep(1500);
    }

    return { downloaded: downloaded, skipped: skipped, total: targetRows.length };
  }

  /**
   * Check whether a table row's status column contains "Ready".
   */
  function isRowReady(row) {
    var cells = row.querySelectorAll('td');
    for (var c = 0; c < cells.length; c++) {
      var text = (cells[c].textContent || '').trim().toLowerCase();
      if (text === 'ready' || text.includes('ready')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the download button inside a report row.
   * Strategy: look in the last td for the first clickable element that
   * isn't a delete button. Falls back to positional detection.
   */
  function findDownloadButton(row) {
    var cells = row.querySelectorAll('td');
    if (cells.length === 0) return null;

    // The actions are in the last cell (or last two cells)
    var lastCell = cells[cells.length - 1];

    // Method 1: aria-label / title check
    var allBtns = lastCell.querySelectorAll(
      'button, [role="button"], .MuiIconButton-root, a'
    );
    for (var b = 0; b < allBtns.length; b++) {
      var label = (
        allBtns[b].getAttribute('aria-label') ||
        allBtns[b].title || ''
      ).toLowerCase();
      if (label.includes('download') || label.includes('export') || label.includes('save')) {
        return allBtns[b];
      }
    }

    // Method 2: First button in the actions cell is download (before delete)
    if (allBtns.length >= 1) {
      return allBtns[0];
    }

    // Method 3: Check second-to-last cell (download and delete might be separate columns)
    if (cells.length >= 2) {
      var secondLast = cells[cells.length - 2];
      var btns2 = secondLast.querySelectorAll(
        'button, [role="button"], .MuiIconButton-root, a'
      );
      if (btns2.length >= 1) return btns2[0];
    }

    return null;
  }

  // ── Utility Functions ───────────────────────────────────────────────────

  function findButtonByText(searchText) {
    var candidates = document.querySelectorAll(
      'button, [role="button"], a.MuiButtonBase-root, .MuiButton-root'
    );
    for (var btn of candidates) {
      var text = (btn.textContent || '').trim().toLowerCase();
      if (text.includes(searchText.toLowerCase())) {
        return btn;
      }
    }
    return null;
  }

  function waitForElement(selector, timeout) {
    if (timeout === undefined) timeout = 5000;
    return new Promise(function (resolve) {
      var el = document.querySelector(selector);
      if (el) return resolve(el);

      var observer = new MutationObserver(function () {
        var found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(function () {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ── Message Handling ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'getProjects') {
      sendResponse({ projects: detectProjects() });
      return true;
    }

    if (message.action === 'triggerExport') {
      triggerExport()
        .then(function () { sendResponse({ success: true }); })
        .catch(function (err) { sendResponse({ success: false, error: err.message }); });
      return true;
    }

    if (message.action === 'downloadReports') {
      downloadReadyReports(message.count)
        .then(function (result) { sendResponse({ success: true, result: result }); })
        .catch(function (err) { sendResponse({ success: false, error: err.message }); });
      return true;
    }

    return false;
  });
})();
