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
   * Scan the page for project listings. Datarova typically shows projects
   * in sidebar navigation or dropdown menus.
   */
  function detectProjects() {
    const projects = [];

    // Strategy 1: Look for project items in sidebar/nav
    const projectElements = document.querySelectorAll(
      '[data-project-id], .project-item, .project-link, [href*="/project/"]'
    );
    projectElements.forEach((el) => {
      const id = el.dataset?.projectId || extractProjectIdFromHref(el.href);
      const name = el.textContent?.trim() || `Project ${id}`;
      if (id && !projects.some((p) => p.id === id)) {
        projects.push({ id, name });
      }
    });

    // Strategy 2: Look for project selector dropdowns
    const selectors = document.querySelectorAll(
      'select[name*="project"], #project-select, .project-selector select'
    );
    selectors.forEach((select) => {
      Array.from(select.options).forEach((option) => {
        if (option.value && option.value !== '' && option.value !== 'all') {
          const id = option.value;
          const name = option.textContent?.trim() || `Project ${id}`;
          if (!projects.some((p) => p.id === id)) {
            projects.push({ id, name });
          }
        }
      });
    });

    // Strategy 3: Parse project data from embedded JSON/scripts
    const scripts = document.querySelectorAll('script:not([src])');
    scripts.forEach((script) => {
      try {
        const content = script.textContent;
        const projectMatch = content.match(/projects\s*[:=]\s*(\[[\s\S]*?\])/);
        if (projectMatch) {
          const parsed = JSON.parse(projectMatch[1]);
          parsed.forEach((p) => {
            const id = String(p.id || p.project_id);
            const name = p.name || p.title || `Project ${id}`;
            if (id && !projects.some((proj) => proj.id === id)) {
              projects.push({ id, name });
            }
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    return projects;
  }

  function extractProjectIdFromHref(href) {
    if (!href) return null;
    const match = href.match(/\/project\/(\w+)/);
    return match ? match[1] : null;
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
