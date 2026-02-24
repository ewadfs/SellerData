// Datarova Bulk Report Downloader - Background Service Worker
//
// Two-phase bulk workflow:
//   Phase 1 (Export): Navigate to each project's ranks page and trigger
//                     Export > Daily Ranks.
//   Phase 2 (Download): Navigate to /download-report, poll until reports
//                        are ready, then click download buttons.

const EXPORT_DELAY_MS = 3000;
const PAGE_LOAD_WAIT_MS = 3000;
const CONTENT_SCRIPT_TIMEOUT_MS = 15000;
const REPORT_POLL_INTERVAL_MS = 6000;
const REPORT_POLL_MAX_MS = 120000; // 2 minutes

// ── Message Handling ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'bulkExport') {
    console.log('[Datarova BG] Received bulkExport for', message.projects.length, 'projects');
    handleBulkExport(message.projects, message.tabId, message.returnUrl)
      .then((results) => sendResponse({ success: true, results }))
      .catch((err) => {
        console.error('[Datarova BG] bulkExport failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep message channel open for async response
  }
  return false;
});

// ── Bulk Export + Download Orchestrator ──────────────────────────────────

async function handleBulkExport(projects, tabId, returnUrl) {
  console.log('[Datarova BG] === Phase 1: Export Daily Ranks ===');
  console.log('[Datarova BG] Projects:', JSON.stringify(projects.map(p => p.name)));

  const results = [];
  const exportCount = projects.length;

  reportPhase('export', 0, exportCount);

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    console.log('[Datarova BG] --- Project ' + (i + 1) + '/' + exportCount + ': ' + project.name + ' ---');

    try {
      const url = buildRanksUrl(returnUrl, project.id, project.asin);
      console.log('[Datarova BG] Navigating to:', url);

      await navigateTab(tabId, url);
      console.log('[Datarova BG] Navigation complete');

      await sleep(PAGE_LOAD_WAIT_MS);
      console.log('[Datarova BG] Waiting for content script...');

      await waitForContentScript(tabId);
      console.log('[Datarova BG] Content script ready, sending triggerExport');

      const response = await sendMessageToTab(tabId, { action: 'triggerExport' });
      console.log('[Datarova BG] triggerExport response:', JSON.stringify(response));

      if (response && response.success) {
        results.push({ id: project.id, name: project.name, asin: project.asin, success: true });
        reportProgress('export', project.name, true, null, i + 1, exportCount);
      } else {
        const error = response?.error || 'Export failed';
        results.push({ id: project.id, name: project.name, asin: project.asin, success: false, error });
        reportProgress('export', project.name, false, error, i + 1, exportCount);
      }
    } catch (err) {
      console.error('[Datarova BG] Project error:', err.message);
      results.push({ id: project.id, name: project.name, asin: project.asin, success: false, error: err.message });
      reportProgress('export', project.name, false, err.message, i + 1, exportCount);
    }

    if (i < projects.length - 1) {
      await sleep(EXPORT_DELAY_MS);
    }
  }

  // ── Phase 2: Download ──
  const successfulExports = results.filter((r) => r.success);
  const successCount = successfulExports.length;
  const exportedProjects = successfulExports.map((r) => ({
    name: r.name,
    asin: r.asin || '',
  }));
  console.log('[Datarova BG] === Phase 2: Download (' + successCount + ' successful exports) ===');
  console.log('[Datarova BG] Exported projects:', JSON.stringify(exportedProjects));

  if (successCount > 0) {
    reportPhase('download', 0, successCount);

    try {
      await downloadWithPolling(tabId, returnUrl, successCount, exportedProjects);
    } catch (err) {
      console.error('[Datarova BG] Download phase error:', err.message);
      reportProgress('download', 'Download error', false, err.message, 0, successCount);
    }
  } else {
    console.log('[Datarova BG] No successful exports, skipping download phase');
  }

  // ── Return to projects page ──
  if (returnUrl) {
    console.log('[Datarova BG] Navigating back to:', returnUrl);
    try { await navigateTab(tabId, returnUrl); } catch (e) { /* best effort */ }
  }

  console.log('[Datarova BG] === Bulk export complete ===');
  return results;
}

// ── Phase 2: Download with Polling ──────────────────────────────────────

async function downloadWithPolling(tabId, returnUrl, expectedCount, exportedProjects) {
  const startTime = Date.now();

  // Navigate to the download page via SPA routing (avoids 404 on full page load)
  await navigateToDownloadPage(tabId, returnUrl);

  for (let attempt = 0; Date.now() - startTime < REPORT_POLL_MAX_MS; attempt++) {
    console.log('[Datarova BG] Download poll attempt', attempt + 1);

    // Check report status (filtered by exported projects)
    const status = await sendMessageToTab(tabId, {
      action: 'checkReportStatus',
      count: expectedCount,
      exportedProjects: exportedProjects,
    });
    console.log('[Datarova BG] Report status:', JSON.stringify(status));

    if (!status) {
      console.warn('[Datarova BG] No status response, retrying...');
      await sleep(REPORT_POLL_INTERVAL_MS);
      // Re-navigate on failure
      await navigateToDownloadPage(tabId, returnUrl);
      continue;
    }

    const readyCount = status.readyCount || 0;
    const pendingCount = status.pendingCount || 0;

    // If we have ready reports and either all are ready or none are pending
    if (readyCount > 0 && (readyCount >= expectedCount || pendingCount === 0)) {
      console.log('[Datarova BG] ' + readyCount + ' reports ready, downloading...');
      const dlResp = await sendMessageToTab(tabId, {
        action: 'downloadReports',
        count: expectedCount,
        exportedProjects: exportedProjects,
      });
      console.log('[Datarova BG] Download response:', JSON.stringify(dlResp));

      if (dlResp && dlResp.success) {
        const r = dlResp.result;
        reportProgress('download',
          'Downloaded ' + r.downloaded + ' of ' + r.matched + ' matched reports',
          true, null, r.downloaded, expectedCount);
      } else {
        reportProgress('download', 'Download failed',
          false, dlResp?.error || 'Unknown', 0, expectedCount);
      }
      return;
    }

    // Reports still generating, wait and retry
    reportProgress('download',
      'Waiting for reports (' + readyCount + '/' + expectedCount + ' ready)',
      true, null, readyCount, expectedCount);

    console.log('[Datarova BG] Not ready yet (ready=' + readyCount +
      ' pending=' + pendingCount + '), waiting ' + (REPORT_POLL_INTERVAL_MS / 1000) + 's...');
    await sleep(REPORT_POLL_INTERVAL_MS);

    // Refresh the page for the next poll (SPA re-navigation)
    await navigateToDownloadPage(tabId, returnUrl);
  }

  // Timeout: try to download whatever is ready
  console.log('[Datarova BG] Poll timeout reached, downloading whatever is ready');
  const dlResp = await sendMessageToTab(tabId, {
    action: 'downloadReports',
    count: expectedCount,
    exportedProjects: exportedProjects,
  });

  if (dlResp && dlResp.success && dlResp.result.downloaded > 0) {
    reportProgress('download',
      'Downloaded ' + dlResp.result.downloaded + ' (timeout, some may not be ready)',
      true, null, dlResp.result.downloaded, expectedCount);
  } else {
    reportProgress('download',
      'Reports not ready after ' + (REPORT_POLL_MAX_MS / 1000) + 's',
      false, 'Timeout waiting for reports', 0, expectedCount);
  }
}

// Navigate to the download page using SPA routing (content script clicks
// the in-app link). Falls back to full page load if SPA nav fails.
async function navigateToDownloadPage(tabId, returnUrl) {
  try {
    await waitForContentScript(tabId);
    const resp = await sendMessageToTab(tabId, { action: 'navigateToDownloads' });
    if (resp && resp.success) {
      console.log('[Datarova BG] SPA navigation to download page succeeded');
      await sleep(PAGE_LOAD_WAIT_MS);
      return;
    }
  } catch (e) {
    console.warn('[Datarova BG] SPA navigation failed:', e.message);
  }

  // Fallback: full page navigation (may 404 on some SPAs)
  console.log('[Datarova BG] Falling back to full page navigation');
  const downloadUrl = buildDownloadUrl(returnUrl);
  await navigateTab(tabId, downloadUrl);
  await sleep(PAGE_LOAD_WAIT_MS);
  await waitForContentScript(tabId);
}

// ── Content Script Readiness ────────────────────────────────────────────

async function waitForContentScript(tabId) {
  const startTime = Date.now();
  while (Date.now() - startTime < CONTENT_SCRIPT_TIMEOUT_MS) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (resp && resp.pong) return true;
    } catch (e) {
      // Content script not ready yet
    }
    await sleep(500);
  }

  // Last resort: manually inject
  console.log('[Datarova BG] Content script not responsive, injecting manually...');
  await injectContentScript(tabId);
  await sleep(1000);

  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (resp && resp.pong) return true;
  } catch (e) {
    // still not responsive
  }

  throw new Error('Content script not responsive after ' + (CONTENT_SCRIPT_TIMEOUT_MS / 1000) + 's');
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildRanksUrl(returnUrl, projectId, asin) {
  const origin = getOrigin(returnUrl);
  let url = `${origin}/projects/${projectId}`;
  if (asin) url += `/ranks/${asin}`;
  return url;
}

function buildDownloadUrl(returnUrl) {
  return getOrigin(returnUrl) + '/download-report';
}

function getOrigin(returnUrl) {
  try { return new URL(returnUrl).origin; } catch (e) { return 'https://app.datarova.com'; }
}

function navigateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Navigation timeout'));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url });
  });
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (e) {
    console.warn('[Datarova BG] Script injection error:', e.message);
  }
}

async function sendMessageToTab(tabId, message) {
  const MAX_RETRIES = 3;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      console.warn('[Datarova BG] sendMessage attempt', i + 1, 'failed:', err.message);
      if (i < MAX_RETRIES - 1) {
        await sleep(1000);
        // Re-inject on retry
        await injectContentScript(tabId);
        await sleep(500);
      } else {
        throw err;
      }
    }
  }
}

function reportPhase(phase, completed, total) {
  console.log('[Datarova BG] Phase:', phase, '(' + completed + '/' + total + ')');
  chrome.runtime.sendMessage({
    action: 'phaseChange',
    phase,
    completed,
    total,
  }).catch(() => {}); // popup may be closed
}

function reportProgress(phase, projectName, success, error, completed, total) {
  console.log('[Datarova BG] Progress:', phase, '-', projectName,
    success ? '(ok)' : '(FAIL: ' + error + ')',
    completed + '/' + total);
  chrome.runtime.sendMessage({
    action: 'exportProgress',
    phase,
    projectName,
    success,
    error,
    completed,
    total,
  }).catch(() => {}); // popup may be closed
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Extension Install Handler ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Datarova BG] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[Datarova BG] Extension updated to v' + chrome.runtime.getManifest().version);
  }
});

console.log('[Datarova BG] Service worker started');
