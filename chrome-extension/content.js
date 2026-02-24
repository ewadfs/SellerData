/**
 * Datarova Bulk Report Downloader - Content Script
 *
 * Runs on datarova.com pages. Detects available projects and marketplaces
 * from the page DOM, and handles triggering downloads via the site's UI.
 */

(function () {
  'use strict';

  // ── Project Detection ───────────────────────────────────────────────────

  /**
   * Scan the page for project listings using multiple broad strategies
   * to handle various DOM structures and SPA frameworks.
   */
  function detectProjects() {
    const projects = [];
    const seen = new Set();

    function addProject(id, name) {
      if (!id || seen.has(id)) return;
      // Skip non-project path segments
      if (['new', 'create', 'edit', 'settings', 'delete'].includes(id)) return;
      seen.add(id);
      projects.push({ id, name: name || `Project ${id}` });
    }

    // Strategy 1: Find <a> links pointing to project pages
    // Matches /projects/<id>, /project/<id>, ?project=<id>
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href || a.getAttribute('href') || '';

      // Match /projects/<id> or /project/<id>
      let match = href.match(/\/projects?\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const name = a.textContent?.trim().split('\n')[0]?.trim() || '';
        addProject(match[1], name);
        return;
      }

      // Match ?project=<id> or &project_id=<id>
      match = href.match(/[?&]project[_-]?(?:id)?=([a-zA-Z0-9_-]+)/);
      if (match) {
        const name = a.textContent?.trim().split('\n')[0]?.trim() || '';
        addProject(match[1], name);
      }
    });

    // Strategy 2: Look for data attributes containing project IDs
    document.querySelectorAll(
      '[data-project-id], [data-project], [data-id], [data-row-key]'
    ).forEach((el) => {
      const id = el.dataset.projectId || el.dataset.project || el.dataset.id || el.dataset.rowKey;
      const name = el.querySelector('a, [class*="name"], [class*="title"], h2, h3, h4')
        ?.textContent?.trim() || el.textContent?.trim().split('\n')[0]?.trim() || '';
      addProject(id, name);
    });

    // Strategy 3: Scan table rows on project-related pages
    if (window.location.pathname.includes('project') || window.location.href.includes('project')) {
      document.querySelectorAll('table tbody tr, [role="row"], [class*="row"]').forEach((row) => {
        const link = row.querySelector('a[href]');
        if (link) {
          const href = link.href || '';
          const match = href.match(/\/projects?\/([a-zA-Z0-9_-]+)/);
          if (match) {
            const name = link.textContent?.trim() ||
              row.querySelector('td:first-child, [class*="name"]')?.textContent?.trim() || '';
            addProject(match[1], name);
          }
        }
      });

      // Also look for card/grid/list layouts
      document.querySelectorAll(
        '[class*="project"], [class*="card"], [class*="list-item"], [class*="item"]'
      ).forEach((el) => {
        const link = el.querySelector('a[href]');
        if (link) {
          const href = link.href || '';
          const match = href.match(/\/projects?\/([a-zA-Z0-9_-]+)/);
          if (match) {
            const name = link.textContent?.trim() ||
              el.querySelector('h2, h3, h4, [class*="name"], [class*="title"]')?.textContent?.trim() || '';
            addProject(match[1], name);
          }
        }
      });
    }

    // Strategy 4: Look for project selector dropdowns
    document.querySelectorAll(
      'select[name*="project"], #project-select, .project-selector select, select'
    ).forEach((select) => {
      Array.from(select.options).forEach((option) => {
        if (option.value && option.value !== '' && option.value !== 'all') {
          const text = option.textContent?.trim() || '';
          // Only add if option looks like a project (has meaningful text)
          if (text && text.length > 1) {
            addProject(option.value, text);
          }
        }
      });
    });

    // Strategy 5: Check Next.js / Nuxt / framework state
    try {
      const stateObjects = [window.__NEXT_DATA__, window.__NUXT__, window.__APP_DATA__];
      stateObjects.forEach((state) => {
        if (state) findProjectsInObject(state, addProject);
      });
    } catch (e) {
      // Ignore errors accessing window properties
    }

    // Strategy 6: Parse embedded JSON/scripts for project arrays
    document.querySelectorAll('script:not([src])').forEach((script) => {
      try {
        const content = script.textContent;
        const patterns = [
          /projects\s*[:=]\s*(\[[\s\S]*?\])/,
          /projectList\s*[:=]\s*(\[[\s\S]*?\])/,
          /"projects"\s*:\s*(\[[\s\S]*?\])/,
        ];
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            const parsed = JSON.parse(match[1]);
            parsed.forEach((p) => {
              addProject(
                String(p.id || p.project_id || p._id || ''),
                p.name || p.title || ''
              );
            });
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    return projects;
  }

  /**
   * Recursively search an object tree for arrays of project-like objects.
   */
  function findProjectsInObject(obj, addProject, depth) {
    if (depth === void 0) depth = 0;
    if (depth > 8 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (item && typeof item === 'object' &&
            (item.id || item.project_id || item._id) &&
            (item.name || item.title || item.project_name)) {
          addProject(
            String(item.id || item.project_id || item._id),
            item.name || item.title || item.project_name
          );
        }
      });
    }
    try {
      Object.values(obj).forEach((v) => findProjectsInObject(v, addProject, depth + 1));
    } catch (e) {
      // Ignore circular reference or access errors
    }
  }

  // ── Download Triggering ─────────────────────────────────────────────────

  /**
   * Trigger a report download by interacting with the Datarova page UI.
   * This function navigates to the appropriate tool page, sets filters,
   * and triggers the export/download.
   */
  async function triggerDownload(params) {
    const { reportType, marketplace, projectId, format, dateRange } = params;

    // Build the target URL for the report
    const baseUrl = buildReportUrl(reportType, marketplace, projectId);

    // Navigate to the report page if needed
    if (window.location.href !== baseUrl) {
      window.location.href = baseUrl;
      // Wait for page load
      await waitForPageLoad();
    }

    // Wait for data table to render
    await waitForElement('[class*="table"], [class*="data"], [class*="grid"]', 10000);

    // Set date range if applicable
    await setDateRange(dateRange);

    // Trigger the download/export button
    const downloaded = await clickDownloadButton(format);

    return downloaded;
  }

  function buildReportUrl(reportType, marketplace, projectId) {
    const toolPaths = {
      'keyword-spy': '/keyword-spy',
      'asin-insights': '/asin-insights',
      'keyword-monitor': '/keyword-monitor',
      'keyword-tracker': '/keyword-tracker',
      'competitor-tracking': '/competitor-tracking',
      'trends': '/trends',
    };

    let url = `https://datarova.com${toolPaths[reportType] || '/keyword-spy'}`;
    const queryParams = [];

    if (marketplace) queryParams.push(`marketplace=${marketplace}`);
    if (projectId) queryParams.push(`project=${projectId}`);

    if (queryParams.length > 0) {
      url += `?${queryParams.join('&')}`;
    }

    return url;
  }

  async function setDateRange(dateRange) {
    if (!dateRange) return;

    const dateSelector = document.querySelector(
      '[class*="date-range"], [class*="dateRange"], input[type="date"], .date-picker'
    );

    if (dateSelector) {
      if (dateRange.type === 'custom' && dateRange.start && dateRange.end) {
        // Try to set custom date inputs
        const startInput = document.querySelector('input[name*="start"], input[placeholder*="Start"]');
        const endInput = document.querySelector('input[name*="end"], input[placeholder*="End"]');
        if (startInput) setNativeValue(startInput, dateRange.start);
        if (endInput) setNativeValue(endInput, dateRange.end);
      } else if (dateRange.type === 'relative') {
        // Try to find and click the appropriate preset button
        const presetButtons = document.querySelectorAll('[class*="preset"], [class*="range-option"] button');
        const daysLabel = getDaysLabel(dateRange.days);
        for (const btn of presetButtons) {
          if (btn.textContent.toLowerCase().includes(daysLabel)) {
            btn.click();
            await sleep(500);
            break;
          }
        }
      }
    }
  }

  function getDaysLabel(days) {
    switch (days) {
      case 30: return '30';
      case 90: return '90';
      case 180: return '6 month';
      case 365: return '12 month';
      default: return String(days);
    }
  }

  async function clickDownloadButton(format) {
    // Look for download/export buttons
    const downloadBtn = document.querySelector(
      'button[class*="download"], button[class*="export"], ' +
      'a[class*="download"], a[class*="export"], ' +
      '[data-action="download"], [data-action="export"], ' +
      'button[title*="Download"], button[title*="Export"]'
    );

    if (!downloadBtn) {
      throw new Error('Download button not found on page');
    }

    // If there's a format selector, try to set it
    if (format) {
      const formatSelector = document.querySelector(
        'select[name*="format"], [class*="format-selector"]'
      );
      if (formatSelector) {
        setNativeValue(formatSelector, format);
        await sleep(300);
      }
    }

    downloadBtn.click();

    // Wait for download to start
    await sleep(2000);
    return true;
  }

  // ── Utility Functions ───────────────────────────────────────────────────

  function setNativeValue(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function waitForPageLoad() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve, { once: true });
      }
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Message Handling ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getProjects') {
      const projects = detectProjects();
      sendResponse({ projects });
      return true;
    }

    if (message.action === 'triggerDownload') {
      triggerDownload(message.params)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async response
    }

    return false;
  });
})();
