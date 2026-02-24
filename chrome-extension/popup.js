/**
 * Datarova Bulk Report Downloader - Popup Script
 *
 * Simplified workflow: detect projects from the Datarova projects page,
 * filter by marketplace, and bulk export Daily Ranks with one button.
 */

// DOM elements
const marketplaceFilter = document.getElementById('marketplace-filter');
const projectsLoading = document.getElementById('projects-loading');
const projectsList = document.getElementById('projects-list');
const noProjects = document.getElementById('no-projects');
const projectCount = document.getElementById('project-count');
const notOnDatarova = document.getElementById('not-on-datarova');
const mainControls = document.getElementById('main-controls');
const btnExport = document.getElementById('btn-export');
const btnCancel = document.getElementById('btn-cancel');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const downloadLog = document.getElementById('download-log');

let allProjects = []; // All detected projects
let activeTabId = null;
let activeTabUrl = null;
let isExporting = false;

// ── Initialization ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkActiveTab();
});

function setupEventListeners() {
  // Marketplace filter
  marketplaceFilter.addEventListener('change', filterProjects);

  // Select/deselect all
  document.getElementById('select-all-projects').addEventListener('click', () => {
    toggleAllVisible(true);
  });
  document.getElementById('deselect-all-projects').addEventListener('click', () => {
    toggleAllVisible(false);
  });

  // Export button
  btnExport.addEventListener('click', startBulkExport);
  btnCancel.addEventListener('click', requestCancel);

  // Listen for progress updates from the background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'exportProgress') {
      onExportProgress(message);
    }
  });
}

// ── Tab Detection ───────────────────────────────────────────────────────────

async function checkActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
  const MAX_RETRIES = 4;
  const RETRY_DELAY_MS = 1500;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // On second attempt, try injecting the content script
      if (attempt === 1) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          });
          await new Promise((r) => setTimeout(r, 500));
        } catch (e) {
          // May already be loaded
        }
      }

      const response = await chrome.tabs.sendMessage(tabId, { action: 'getProjects' });
      if (response && response.projects && response.projects.length > 0) {
        allProjects = response.projects;
        populateMarketplaceFilter();
        renderProjects(allProjects);
        return;
      }

      if (attempt < MAX_RETRIES - 1) {
        projectsLoading.textContent = 'Scanning for projects (attempt ' + (attempt + 2) + '/' + MAX_RETRIES + ')...';
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    } catch (err) {
      console.warn('Detection attempt ' + (attempt + 1) + ' failed:', err);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  showProjectsError();
}

// ── Marketplace Filter ──────────────────────────────────────────────────────

function populateMarketplaceFilter() {
  // Collect unique marketplaces from detected projects
  const marketplaces = new Set(allProjects.map((p) => p.marketplace));
  const sorted = Array.from(marketplaces).sort();

  // Reset to just "All"
  marketplaceFilter.innerHTML = '<option value="all">All Marketplaces (' + allProjects.length + ')</option>';

  sorted.forEach((mp) => {
    const count = allProjects.filter((p) => p.marketplace === mp).length;
    const option = document.createElement('option');
    option.value = mp;
    option.textContent = mp + ' (' + count + ')';
    marketplaceFilter.appendChild(option);
  });
}

function filterProjects() {
  const selected = marketplaceFilter.value;
  const filtered = selected === 'all'
    ? allProjects
    : allProjects.filter((p) => p.marketplace === selected);
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

  projects.forEach((project) => {
    const label = document.createElement('label');
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
  const checkboxes = projectsList.querySelectorAll('input[type="checkbox"]:checked');
  const selectedProjects = Array.from(checkboxes).map((cb) => ({
    id: cb.value,
    asin: cb.dataset.asin,
    name: cb.dataset.name,
    marketplace: cb.dataset.marketplace,
  }));

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
  updateProgress(0, selectedProjects.length, 'Starting bulk export...');

  addLogEntry('Exporting Daily Ranks for ' + selectedProjects.length + ' project(s)', 'info');

  // Send the bulk export request to the background script
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'bulkExport',
          projects: selectedProjects,
          tabId: activeTabId,
          returnUrl: activeTabUrl,
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(resp);
          }
        }
      );
    });

    if (response && response.success) {
      const succeeded = response.results.filter((r) => r.success).length;
      const failed = response.results.filter((r) => !r.success).length;
      addLogEntry(
        'Complete: ' + succeeded + ' succeeded, ' + failed + ' failed',
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
  // Note: cancel is best-effort since the background script is driving navigation
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
}

// ── Progress Handling ───────────────────────────────────────────────────────

function onExportProgress(message) {
  const { projectName, success, error, completed, total } = message;

  if (success) {
    addLogEntry(projectName + ': Exported', 'success');
  } else {
    addLogEntry(projectName + ': Failed - ' + (error || 'Unknown'), 'error');
  }

  updateProgress(completed, total,
    success ? ('Exported ' + projectName) : ('Failed: ' + projectName));
}

// ── UI Helpers ──────────────────────────────────────────────────────────────

function updateProgress(completed, total, message) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  progressBar.style.width = pct + '%';
  progressText.textContent = message + ' (' + completed + '/' + total + ')';
}

function addLogEntry(message, type) {
  const entry = document.createElement('div');
  entry.className = 'log-entry log-' + type;
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
  downloadLog.appendChild(entry);
  downloadLog.scrollTop = downloadLog.scrollHeight;
}

function toggleAllVisible(checked) {
  projectsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = checked;
  });
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
