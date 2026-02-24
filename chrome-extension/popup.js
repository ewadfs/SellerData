/**
 * Datarova Bulk Report Downloader - Popup Script
 *
 * Two-phase workflow:
 *   1. Export Daily Ranks for selected projects (navigates to each project)
 *   2. Download the generated reports from /download-report page
 */

// DOM elements
var marketplaceFilter = document.getElementById('marketplace-filter');
var projectsLoading = document.getElementById('projects-loading');
var projectsList = document.getElementById('projects-list');
var noProjects = document.getElementById('no-projects');
var projectCount = document.getElementById('project-count');
var notOnDatarova = document.getElementById('not-on-datarova');
var mainControls = document.getElementById('main-controls');
var btnExport = document.getElementById('btn-export');
var btnCancel = document.getElementById('btn-cancel');
var btnText = document.getElementById('btn-text');
var btnSpinner = document.getElementById('btn-spinner');
var progressSection = document.getElementById('progress-section');
var progressBar = document.getElementById('progress-bar');
var progressText = document.getElementById('progress-text');
var downloadLog = document.getElementById('download-log');
var phaseLabel = document.getElementById('phase-label');

var allProjects = [];
var activeTabId = null;
var activeTabUrl = null;
var isExporting = false;

// ── Initialization ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function () {
  setupEventListeners();
  await checkActiveTab();
});

function setupEventListeners() {
  marketplaceFilter.addEventListener('change', filterProjects);

  document.getElementById('select-all-projects').addEventListener('click', function () {
    toggleAllVisible(true);
  });
  document.getElementById('deselect-all-projects').addEventListener('click', function () {
    toggleAllVisible(false);
  });

  btnExport.addEventListener('click', startBulkExport);
  btnCancel.addEventListener('click', requestCancel);

  // Listen for progress updates from the background script
  chrome.runtime.onMessage.addListener(function (message) {
    if (message.action === 'exportProgress') {
      onExportProgress(message);
    }
    if (message.action === 'phaseChange') {
      onPhaseChange(message);
    }
  });
}

// ── Tab Detection ───────────────────────────────────────────────────────────

async function checkActiveTab() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes('datarova.com')) {
      notOnDatarova.classList.remove('hidden');
      mainControls.classList.add('hidden');
      return;
    }
    activeTabId = tab.id;
    activeTabUrl = tab.url;
    await detectProjects(tab.id);
  } catch (err) {
    console.error('Tab check failed:', err);
    showProjectsError();
  }
}

async function detectProjects(tabId) {
  var MAX_RETRIES = 4;
  var RETRY_DELAY_MS = 1500;

  for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Always try to inject the content script (it handles duplicates gracefully)
      if (attempt > 0) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
          });
          await new Promise(function (r) { setTimeout(r, 500); });
        } catch (e) {
          console.warn('Script injection attempt ' + (attempt + 1) + ':', e.message);
        }
      }

      var response = await chrome.tabs.sendMessage(tabId, { action: 'getProjects' });
      console.log('Detection attempt ' + (attempt + 1) + ' response:', response);

      if (response && response.projects && response.projects.length > 0) {
        allProjects = response.projects;
        populateMarketplaceFilter();
        renderProjects(allProjects);
        return;
      }

      if (attempt < MAX_RETRIES - 1) {
        projectsLoading.textContent = 'Scanning for projects (attempt ' + (attempt + 2) + '/' + MAX_RETRIES + ')...';
        await new Promise(function (r) { setTimeout(r, RETRY_DELAY_MS); });
      }
    } catch (err) {
      console.warn('Detection attempt ' + (attempt + 1) + ' failed:', err.message);

      // On first failure, immediately inject and retry without waiting
      if (attempt === 0) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
          });
          await new Promise(function (r) { setTimeout(r, 800); });
        } catch (e) {
          console.warn('Script injection failed:', e.message);
        }
      } else if (attempt < MAX_RETRIES - 1) {
        await new Promise(function (r) { setTimeout(r, RETRY_DELAY_MS); });
      }
    }
  }

  showProjectsError();
}

// ── Marketplace Filter ──────────────────────────────────────────────────────

function populateMarketplaceFilter() {
  var marketplaces = new Set(allProjects.map(function (p) { return p.marketplace; }));
  var sorted = Array.from(marketplaces).sort();

  marketplaceFilter.innerHTML = '<option value="all">All Marketplaces (' + allProjects.length + ')</option>';

  sorted.forEach(function (mp) {
    var count = allProjects.filter(function (p) { return p.marketplace === mp; }).length;
    var option = document.createElement('option');
    option.value = mp;
    option.textContent = mp + ' (' + count + ')';
    marketplaceFilter.appendChild(option);
  });
}

function filterProjects() {
  var selected = marketplaceFilter.value;
  var filtered = selected === 'all'
    ? allProjects
    : allProjects.filter(function (p) { return p.marketplace === selected; });
  renderProjects(filtered);
}

// ── Project Rendering ───────────────────────────────────────────────────────

function renderProjects(projects) {
  projectsLoading.classList.add('hidden');
  noProjects.classList.add('hidden');
  projectsList.classList.remove('hidden');
  projectsList.innerHTML = '';
  projectCount.textContent = projects.length;

  if (projects.length === 0) {
    projectsList.classList.add('hidden');
    noProjects.classList.remove('hidden');
    return;
  }

  projects.forEach(function (project) {
    var label = document.createElement('label');
    label.className = 'checkbox-item';
    label.dataset.marketplace = project.marketplace;
    label.innerHTML =
      '<input type="checkbox" value="' + escapeHtml(project.id) + '" ' +
      'data-asin="' + escapeHtml(project.asin || '') + '" ' +
      'data-name="' + escapeHtml(project.name) + '" ' +
      'data-marketplace="' + escapeHtml(project.marketplace) + '" checked>' +
      '<span class="project-name">' + escapeHtml(project.name) + '</span>' +
      '<span class="project-meta">' + escapeHtml(project.marketplace) +
      (project.asin ? ' / ' + escapeHtml(project.asin) : '') + '</span>';
    projectsList.appendChild(label);
  });
}

function showProjectsError() {
  projectsLoading.classList.add('hidden');
  noProjects.classList.remove('hidden');
}

// ── Bulk Export ──────────────────────────────────────────────────────────────

async function startBulkExport() {
  var checkboxes = projectsList.querySelectorAll('input[type="checkbox"]:checked');
  var selectedProjects = Array.from(checkboxes).map(function (cb) {
    return {
      id: cb.value,
      asin: cb.dataset.asin,
      name: cb.dataset.name,
      marketplace: cb.dataset.marketplace,
    };
  });

  if (selectedProjects.length === 0) {
    alert('Please select at least one project.');
    return;
  }

  // Begin export
  isExporting = true;
  btnExport.disabled = true;
  btnText.textContent = 'Exporting...';
  btnSpinner.classList.remove('hidden');
  btnCancel.classList.remove('hidden');
  progressSection.classList.remove('hidden');
  downloadLog.innerHTML = '';

  setPhaseLabel('Phase 1/2: Exporting');
  updateProgress(0, selectedProjects.length, 'Starting bulk export...');
  addLogEntry('Exporting Daily Ranks for ' + selectedProjects.length + ' project(s)', 'info');

  try {
    var response = await new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: 'bulkExport',
          projects: selectedProjects,
          tabId: activeTabId,
          returnUrl: activeTabUrl,
        },
        function (resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(resp);
          }
        }
      );
    });

    if (response && response.success) {
      var succeeded = response.results.filter(function (r) { return r.success; }).length;
      var failed = response.results.filter(function (r) { return !r.success; }).length;
      addLogEntry(
        'Done! ' + succeeded + ' exported, ' + failed + ' failed',
        failed > 0 ? 'error' : 'success'
      );
    } else {
      addLogEntry('Export failed: ' + (response?.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    addLogEntry('Export error: ' + err.message, 'error');
  }

  finishExport();
}

function requestCancel() {
  btnCancel.disabled = true;
  addLogEntry('Cancellation requested...', 'info');
}

function finishExport() {
  isExporting = false;
  btnExport.disabled = false;
  btnText.textContent = 'Export Daily Ranks';
  btnSpinner.classList.add('hidden');
  btnCancel.classList.add('hidden');
  btnCancel.disabled = false;
  setPhaseLabel('');
}

// ── Progress Handling ───────────────────────────────────────────────────────

function onPhaseChange(message) {
  if (message.phase === 'export') {
    setPhaseLabel('Phase 1/2: Exporting');
    updateProgress(0, message.total, 'Exporting reports...');
  } else if (message.phase === 'download') {
    setPhaseLabel('Phase 2/2: Downloading');
    updateProgress(0, message.total, 'Navigating to downloads...');
    addLogEntry('Navigating to download page...', 'info');
  }
}

function onExportProgress(message) {
  var projectName = message.projectName;
  var success = message.success;
  var error = message.error;
  var completed = message.completed;
  var total = message.total;
  var phase = message.phase || 'export';

  if (phase === 'export') {
    if (success) {
      addLogEntry(projectName + ': Exported', 'success');
    } else {
      addLogEntry(projectName + ': Failed - ' + (error || 'Unknown'), 'error');
    }
    updateProgress(completed, total,
      success ? ('Exported ' + projectName) : ('Failed: ' + projectName));
  } else if (phase === 'download') {
    if (success) {
      addLogEntry(projectName, 'success');
    } else {
      addLogEntry(projectName + ' - ' + (error || 'Unknown'), 'error');
    }
    updateProgress(completed, total, projectName);
  }
}

// ── UI Helpers ──────────────────────────────────────────────────────────────

function setPhaseLabel(text) {
  if (phaseLabel) {
    phaseLabel.textContent = text;
    phaseLabel.classList.toggle('hidden', !text);
  }
}

function updateProgress(completed, total, message) {
  var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  progressBar.style.width = pct + '%';
  progressText.textContent = message + ' (' + completed + '/' + total + ')';
}

function addLogEntry(message, type) {
  var entry = document.createElement('div');
  entry.className = 'log-entry log-' + type;
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
  downloadLog.appendChild(entry);
  downloadLog.scrollTop = downloadLog.scrollHeight;
}

function toggleAllVisible(checked) {
  projectsList.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    cb.checked = checked;
  });
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
