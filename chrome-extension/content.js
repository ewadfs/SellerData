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

  // Guard against double-injection (manifest + scripting.executeScript)
  if (window.__datarova_bulk_loaded) return;
  window.__datarova_bulk_loaded = true;

  // ── Project Detection (runs on /projects page) ───────────────────────────

  function detectProjects() {
    var projects = [];
    var seen = new Set();

    document.querySelectorAll('a[href*="/projects/"]').forEach(function (a) {
      try {
        var href = a.href || '';
        var match = href.match(/\/projects\/(\d+)(?:\/\w+\/([A-Z0-9]{10}))?/);
        if (!match) return;

        var projectId = match[1];
        if (seen.has(projectId)) return;
        seen.add(projectId);

        var asin = match[2] || extractAsinFromText(a);
        var card = findCardContainer(a);
        var name = extractNameFromCard(card, asin);

        // Marketplace detection is wrapped separately so it can never
        // crash the overall project detection
        var marketplace = null;
        try {
          marketplace = extractMarketplace(card);
        } catch (e) {
          console.warn('[Datarova Bulk] marketplace detection error:', e);
        }

        projects.push({
          id: projectId,
          name: name || 'Project ' + projectId,
          asin: asin || '',
          marketplace: marketplace || 'US',
        });
      } catch (err) {
        console.error('[Datarova Bulk] error detecting project from link:', err);
      }
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
    for (var i = 0; i < headings.length; i++) {
      var t = (headings[i].textContent || '').trim();
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

  // ── Marketplace Detection ────────────────────────────────────────────────
  //
  // Multi-strategy approach. Each strategy is isolated so a failure in one
  // does not prevent the others from running.

  var CODE_MAP = {
    'us': 'US', 'ca': 'CA', 'mx': 'MX', 'uk': 'UK', 'gb': 'UK',
    'de': 'DE', 'fr': 'FR', 'it': 'IT', 'es': 'ES', 'jp': 'JP',
    'au': 'AU', 'in': 'IN', 'br': 'BR', 'nl': 'NL', 'se': 'SE',
    'pl': 'PL', 'sg': 'SG', 'ae': 'AE', 'sa': 'SA',
  };

  var COUNTRY_NAMES = {
    'united states': 'US', 'usa': 'US', 'america': 'US',
    'canada': 'CA', 'mexico': 'MX',
    'united kingdom': 'UK', 'great britain': 'UK',
    'germany': 'DE', 'france': 'FR', 'italy': 'IT', 'spain': 'ES',
    'japan': 'JP', 'australia': 'AU', 'india': 'IN',
  };

  function extractMarketplace(card) {
    if (!card) return null;
    var result;

    // Strategy 1: Small flag images — check src filename and alt/title
    result = strategyFlagImages(card);
    if (result) return result;

    // Strategy 2: Elements with flag/country classes or data attributes
    result = strategyClassesAndAttrs(card);
    if (result) return result;

    // Strategy 3: Flag emojis in text
    result = strategyFlagEmojis(card);
    if (result) return result;

    return null;
  }

  function strategyFlagImages(card) {
    var imgs = card.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];

      // Skip product photos (large images). Flags are tiny icons.
      try {
        var w = img.getBoundingClientRect().width;
        if (w > 60) continue;
      } catch (e) { /* ignore */ }

      // Check src URL for country code in filename
      var src = (img.src || '').toLowerCase();
      var urlPath = src.split('?')[0].split('#')[0];
      var segments = urlPath.split('/');
      var filename = segments[segments.length - 1] || '';
      var nameOnly = filename.replace(/\.[^.]+$/, '');

      // Exact 2-letter filename: "us.svg", "ca.png"
      if (nameOnly.length === 2 && CODE_MAP[nameOnly]) {
        return CODE_MAP[nameOnly];
      }

      // Filename with prefix/suffix: "flag-us", "us-flag", "flag_ca"
      var fnMatch = nameOnly.match(/(?:^|[-_])([a-z]{2})(?:[-_]|$)/);
      if (fnMatch && CODE_MAP[fnMatch[1]]) {
        return CODE_MAP[fnMatch[1]];
      }

      // Check path segments: /flags/us/flag.svg
      for (var s = Math.max(1, segments.length - 4); s < segments.length - 1; s++) {
        var seg = segments[s];
        if (seg.length === 2 && CODE_MAP[seg]) {
          return CODE_MAP[seg];
        }
      }

      // Check alt and title attributes
      var alt = (img.alt || '').toLowerCase().trim();
      var title = (img.title || '').toLowerCase().trim();

      for (var a = 0; a < 2; a++) {
        var attr = a === 0 ? alt : title;
        if (!attr) continue;
        if (attr.length === 2 && CODE_MAP[attr]) return CODE_MAP[attr];
        var resolved = resolveCountryName(attr);
        if (resolved) return resolved;
      }

      // Fallback: original simple pattern matching on full src + alt
      var combined = src + ' ' + alt;
      var patterns = [
        ['/us', 'US'], ['_us', 'US'],
        ['/ca', 'CA'], ['_ca', 'CA'],
        ['/mx', 'MX'], ['_mx', 'MX'],
        ['/uk', 'UK'], ['_uk', 'UK'], ['/gb', 'UK'], ['_gb', 'UK'],
        ['/de', 'DE'], ['_de', 'DE'],
        ['/fr', 'FR'], ['_fr', 'FR'],
        ['/it', 'IT'], ['_it', 'IT'],
        ['/es', 'ES'], ['_es', 'ES'],
        ['/jp', 'JP'], ['_jp', 'JP'],
        ['/au', 'AU'], ['_au', 'AU'],
        ['/in', 'IN'], ['_in', 'IN'],
      ];
      for (var p = 0; p < patterns.length; p++) {
        if (combined.includes(patterns[p][0])) return patterns[p][1];
      }
    }
    return null;
  }

  function strategyClassesAndAttrs(card) {
    // Check elements with known flag/country attributes or classes
    var els;
    try {
      els = card.querySelectorAll(
        '[class*="flag"], [class*="country"], [class*="marketplace"], ' +
        '[data-country], [data-marketplace]'
      );
    } catch (e) {
      return null;
    }

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var className = '';
      try { className = (typeof el.className === 'string' ? el.className : '').toLowerCase(); } catch (e) {}

      var dataVal = '';
      try { dataVal = (el.getAttribute('data-country') || el.getAttribute('data-marketplace') || '').toLowerCase(); } catch (e) {}

      var combined = className + ' ' + dataVal;

      var classMatch = combined.match(/(?:flag|country|marketplace)[-_]?([a-z]{2})\b/);
      if (classMatch && CODE_MAP[classMatch[1]]) {
        return CODE_MAP[classMatch[1]];
      }

      if (dataVal.length === 2 && CODE_MAP[dataVal]) return CODE_MAP[dataVal];
      var resolved = resolveCountryName(dataVal);
      if (resolved) return resolved;
    }

    return null;
  }

  function strategyFlagEmojis(card) {
    var text = card.textContent || '';
    // Each flag emoji is two regional indicator symbols
    var flags = [
      ['\u{1F1FA}\u{1F1F8}', 'US'], ['\u{1F1E8}\u{1F1E6}', 'CA'],
      ['\u{1F1F2}\u{1F1FD}', 'MX'], ['\u{1F1EC}\u{1F1E7}', 'UK'],
      ['\u{1F1E9}\u{1F1EA}', 'DE'], ['\u{1F1EB}\u{1F1F7}', 'FR'],
      ['\u{1F1EE}\u{1F1F9}', 'IT'], ['\u{1F1EA}\u{1F1F8}', 'ES'],
      ['\u{1F1EF}\u{1F1F5}', 'JP'], ['\u{1F1E6}\u{1F1FA}', 'AU'],
      ['\u{1F1EE}\u{1F1F3}', 'IN'],
    ];
    for (var i = 0; i < flags.length; i++) {
      if (text.includes(flags[i][0])) return flags[i][1];
    }
    return null;
  }

  function resolveCountryName(str) {
    if (!str) return null;
    for (var name in COUNTRY_NAMES) {
      if (str.includes(name)) return COUNTRY_NAMES[name];
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
    for (var i = 0; i < menuItems.length; i++) {
      var text = (menuItems[i].textContent || '').trim().toLowerCase();
      if (text.includes('daily') && text.includes('rank')) {
        dailyRanksItem = menuItems[i];
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

  async function downloadReadyReports(count) {
    var table = await waitForElement('table.MuiTable-root, table', 8000);
    if (!table) {
      throw new Error('Download report table not found');
    }

    var rows = table.querySelectorAll('tbody tr[id^="body-row-"]');
    if (rows.length === 0) {
      rows = table.querySelectorAll('tbody tr');
    }
    if (rows.length === 0) {
      throw new Error('No report rows found');
    }

    // Take top N rows (most recent), reverse to download oldest first
    var targetRows = Array.from(rows).slice(0, count || rows.length);
    targetRows.reverse();

    var downloaded = 0;
    var skipped = 0;

    for (var i = 0; i < targetRows.length; i++) {
      var row = targetRows[i];

      if (!isRowReady(row)) {
        skipped++;
        continue;
      }

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

  function findDownloadButton(row) {
    var cells = row.querySelectorAll('td');
    if (cells.length === 0) return null;

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

    // Method 2: First button in actions cell = download
    if (allBtns.length >= 1) {
      return allBtns[0];
    }

    // Method 3: Check second-to-last cell
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
    var search = searchText.toLowerCase();
    for (var i = 0; i < candidates.length; i++) {
      var text = (candidates[i].textContent || '').trim().toLowerCase();
      if (text.includes(search)) {
        return candidates[i];
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
      try {
        var projects = detectProjects();
        sendResponse({ projects: projects });
      } catch (err) {
        console.error('[Datarova Bulk] detectProjects failed:', err);
        sendResponse({ projects: [] });
      }
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
