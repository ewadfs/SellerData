/**
 * Popup script for SellerData Chrome Extension.
 * Handles the main UI, AI generation, and multi-step workflow wizards.
 */

(function () {
  'use strict';

  // ============================================================
  // DOM REFERENCES
  // ============================================================

  const mainSection = document.getElementById('main-section');
  const settingsSection = document.getElementById('settings-section');
  const workflowSection = document.getElementById('workflow-section');

  const settingsBtn = document.getElementById('settings-btn');
  const backBtn = document.getElementById('back-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const settingsStatus = document.getElementById('settings-status');

  const apiKeyInput = document.getElementById('api-key-input');
  const sellerNameInput = document.getElementById('seller-name-input');
  const toneSelect = document.getElementById('tone-select');

  const pageStatus = document.getElementById('page-status');
  const customerMessageEl = document.getElementById('customer-message');
  const aiResponseEl = document.getElementById('ai-response');

  const generateBtn = document.getElementById('generate-btn');
  const copyBtn = document.getElementById('copy-btn');
  const insertBtn = document.getElementById('insert-btn');
  const regenerateBtn = document.getElementById('regenerate-btn');

  let currentSettings = {};
  let detectedPageInfo = null;

  // ============================================================
  // SECTION NAVIGATION
  // ============================================================

  function showSection(section) {
    [mainSection, settingsSection, workflowSection].forEach(
      (s) => s.classList.add('hidden')
    );
    section.classList.remove('hidden');
  }

  function hideAllWfSteps() {
    document.querySelectorAll('.wf-step').forEach(s => s.classList.add('hidden'));
  }

  function showWfStep(id) {
    hideAllWfSteps();
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  settingsBtn.addEventListener('click', () => showSection(settingsSection));
  backBtn.addEventListener('click', () => showSection(mainSection));

  // ============================================================
  // SETTINGS
  // ============================================================

  async function initSettings() {
    currentSettings = await loadSettings();
    apiKeyInput.value = currentSettings.apiKey;
    sellerNameInput.value = currentSettings.sellerName;
    toneSelect.value = currentSettings.tone;
  }

  saveSettingsBtn.addEventListener('click', async () => {
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      sellerName: sellerNameInput.value.trim() || 'Our Store',
      tone: toneSelect.value
    };
    await saveSettings(settings);
    currentSettings = settings;
    settingsStatus.textContent = 'Settings saved!';
    setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
  });

  // ============================================================
  // PAGE DETECTION
  // ============================================================

  async function detectPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      const url = tab.url || '';
      const isSellerCentral = url.includes('sellercentral.amazon.');

      if (isSellerCentral) {
        pageStatus.textContent = 'Connected to Seller Central';
        pageStatus.classList.add('active');

        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
          detectedPageInfo = response;
          if (response && response.customerMessage) {
            customerMessageEl.value = response.customerMessage;
          }
          if (response && response.orderId) {
            // Pre-fill workflow forms
            document.getElementById('wf-refund-order-id').value = response.orderId;
            document.getElementById('wf-replace-order-id').value = response.orderId;
          }
        } catch {
          // Content script not loaded on this page
        }
      } else {
        pageStatus.textContent = 'Not on Seller Central';
        pageStatus.classList.remove('active');
      }
    } catch {
      // Tab not accessible
    }
  }

  // ============================================================
  // AI RESPONSE GENERATION (standalone, not workflow)
  // ============================================================

  async function generateResponse() {
    const message = customerMessageEl.value.trim();
    if (!message) {
      aiResponseEl.value = 'Please enter or paste a customer message first.';
      return;
    }
    if (!currentSettings.apiKey) {
      aiResponseEl.value = 'Please set your OpenAI API key in Settings.';
      showSection(settingsSection);
      return;
    }

    generateBtn.disabled = true;
    generateBtn.classList.add('loading');
    generateBtn.textContent = 'Generating...';
    aiResponseEl.value = '';

    chrome.runtime.sendMessage({
      action: 'generateResponse',
      apiKey: currentSettings.apiKey,
      customerMessage: message,
      tone: currentSettings.tone,
      sellerName: currentSettings.sellerName
    }, (response) => {
      generateBtn.disabled = false;
      generateBtn.classList.remove('loading');
      generateBtn.textContent = 'Generate AI Response';

      if (response && response.success) {
        aiResponseEl.value = response.response;
        copyBtn.disabled = false;
        insertBtn.disabled = false;
        regenerateBtn.disabled = false;
      } else {
        aiResponseEl.value = `Error: ${response?.error || 'Failed to generate response. Check your API key.'}`;
      }
    });
  }

  generateBtn.addEventListener('click', generateResponse);
  regenerateBtn.addEventListener('click', generateResponse);

  // ============================================================
  // COPY & INSERT (standalone)
  // ============================================================

  copyBtn.addEventListener('click', async () => {
    const text = aiResponseEl.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    } catch {
      aiResponseEl.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    }
  });

  insertBtn.addEventListener('click', async () => {
    const text = aiResponseEl.value;
    if (!text) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'insertReply', text });
      insertBtn.textContent = (response && response.success) ? 'Inserted!' : 'Failed';
      setTimeout(() => { insertBtn.textContent = 'Insert into Reply'; }, 1500);
    } catch {
      insertBtn.textContent = 'Not on messaging page';
      setTimeout(() => { insertBtn.textContent = 'Insert into Reply'; }, 2000);
    }
  });

  // ============================================================
  // QUICK TEMPLATES
  // ============================================================

  document.querySelectorAll('.template-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const templateKey = btn.dataset.template;
      const template = TEMPLATES[templateKey];
      if (template) {
        aiResponseEl.value = fillTemplate(template, { sellerName: currentSettings.sellerName });
        copyBtn.disabled = false;
        insertBtn.disabled = false;
        regenerateBtn.disabled = false;
      }
    });
  });

  // ============================================================
  // WORKFLOW: PROGRESS BAR RENDERER
  // ============================================================

  function renderProgressBar(workflowType, currentStep) {
    const steps = WORKFLOW_STEPS[workflowType];
    const progressEl = document.getElementById('wf-progress');
    let html = '';

    steps.forEach((step, i) => {
      const state = i < currentStep ? 'done' : (i === currentStep ? 'active' : '');
      const label = i < currentStep ? '&#10003;' : (i + 1);
      html += `<div class="wf-dot ${state}" title="${step.title}">${label}</div>`;
      if (i < steps.length - 1) {
        html += `<div class="wf-line ${i < currentStep ? 'done' : ''}"></div>`;
      }
    });

    progressEl.innerHTML = html;
  }

  // ============================================================
  // WORKFLOW: START
  // ============================================================

  document.getElementById('start-refund-workflow').addEventListener('click', () => {
    startWorkflow('refund');
  });

  document.getElementById('start-replacement-workflow').addEventListener('click', () => {
    startWorkflow('replacement');
  });

  function startWorkflow(type) {
    // Detect base URL from current tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || '';
      const baseUrlMatch = url.match(/(https:\/\/sellercentral\.amazon\.[^/]+)/);
      const baseUrl = baseUrlMatch ? baseUrlMatch[1] : 'https://sellercentral.amazon.com';

      const data = { baseUrl, sellerName: currentSettings.sellerName };

      chrome.runtime.sendMessage({
        action: 'startWorkflow',
        type,
        data
      }, (result) => {
        if (result && result.success) {
          showSection(workflowSection);
          renderWorkflowUI(result.workflow);
        }
      });
    });
  }

  // ============================================================
  // WORKFLOW: RENDER CURRENT STEP IN POPUP
  // ============================================================

  function renderWorkflowUI(workflow) {
    if (!workflow) {
      showSection(mainSection);
      return;
    }

    const stepDef = getCurrentStepDef(workflow);
    if (!stepDef) {
      showSection(mainSection);
      return;
    }

    showSection(workflowSection);
    renderProgressBar(workflow.type, workflow.currentStep);

    // Determine which popup panel to show
    switch (stepDef.id) {
      case 'gather_info':
        if (workflow.type === 'refund') {
          showWfStep('wf-step-gather-refund');
          // Pre-fill from detected page info
          if (detectedPageInfo?.orderId) {
            document.getElementById('wf-refund-order-id').value =
              document.getElementById('wf-refund-order-id').value || detectedPageInfo.orderId;
          }
        } else {
          showWfStep('wf-step-gather-replacement');
          if (detectedPageInfo?.orderId) {
            document.getElementById('wf-replace-order-id').value =
              document.getElementById('wf-replace-order-id').value || detectedPageInfo.orderId;
          }
        }
        break;

      case 'compose_email':
        showWfStep('wf-step-compose');
        document.getElementById('wf-compose-title').textContent =
          `Step ${workflow.currentStep + 1}: Compose Customer Email`;
        // Generate the email template
        generateEmailForWorkflow(workflow);
        break;

      case 'send_email':
      case 'click_refund':
      case 'click_replacement':
      case 'fill_refund_form':
      case 'confirm_replacement':
        showWfStep('wf-step-page-action');
        document.getElementById('wf-page-title').textContent =
          `Step ${workflow.currentStep + 1}: ${stepDef.title}`;
        document.getElementById('wf-page-desc').textContent = stepDef.description;
        break;

      case 'navigate_to_order':
        // This is auto-handled, but show a brief "navigating" state
        showWfStep('wf-step-page-action');
        document.getElementById('wf-page-title').textContent = stepDef.title;
        document.getElementById('wf-page-desc').textContent = stepDef.description;
        break;

      case 'complete':
        showWfStep('wf-step-complete');
        const typeLabel = workflow.type === 'refund' ? 'Refund' : 'Replacement';
        document.getElementById('wf-complete-title').textContent = `${typeLabel} Complete!`;
        document.getElementById('wf-complete-desc').textContent =
          `The ${typeLabel.toLowerCase()} process has been completed. The customer has been notified and the ${typeLabel.toLowerCase()} has been submitted.`;
        break;

      default:
        showWfStep('wf-step-page-action');
        document.getElementById('wf-page-title').textContent = stepDef.title;
        document.getElementById('wf-page-desc').textContent = stepDef.description;
    }
  }

  // ============================================================
  // WORKFLOW: EMAIL GENERATION
  // ============================================================

  function generateEmailForWorkflow(workflow) {
    const emailBodyEl = document.getElementById('wf-email-body');
    const data = workflow.data;

    if (workflow.type === 'refund') {
      const template = TEMPLATES.refund_confirmation;
      emailBodyEl.value = fillTemplate(template, {
        sellerName: data.sellerName || currentSettings.sellerName,
        orderId: data.orderId || '[Order ID]',
        amount: data.amount ? `$${parseFloat(data.amount).toFixed(2)}` : '[Amount]',
        reason: REASON_LABELS[data.reason] || data.reason || '[Reason]'
      });
    } else {
      const template = TEMPLATES.replacement_confirmation;
      emailBodyEl.value = fillTemplate(template, {
        sellerName: data.sellerName || currentSettings.sellerName,
        orderId: data.orderId || '[Order ID]',
        reason: REASON_LABELS[data.reason] || data.reason || '[Reason]'
      });
    }
  }

  // ============================================================
  // WORKFLOW: STEP HANDLERS
  // ============================================================

  // --- Step 1: Gather Info -> Next ---

  document.getElementById('wf-refund-next').addEventListener('click', () => {
    const orderId = document.getElementById('wf-refund-order-id').value.trim();
    const amount = document.getElementById('wf-refund-amount').value;
    const reason = document.getElementById('wf-refund-reason').value;

    if (!orderId) {
      alert('Please enter an Order ID.');
      return;
    }

    // Update workflow data and advance
    chrome.runtime.sendMessage({
      action: 'updateWorkflowData',
      data: { orderId, amount, reason }
    }, () => {
      chrome.runtime.sendMessage({ action: 'advanceWorkflow' }, (result) => {
        if (result) renderWorkflowUI(result.workflow);
      });
    });
  });

  document.getElementById('wf-replace-next').addEventListener('click', () => {
    const orderId = document.getElementById('wf-replace-order-id').value.trim();
    const asin = document.getElementById('wf-replace-asin').value.trim();
    const reason = document.getElementById('wf-replace-reason').value;

    if (!orderId) {
      alert('Please enter an Order ID.');
      return;
    }

    chrome.runtime.sendMessage({
      action: 'updateWorkflowData',
      data: { orderId, asin, reason }
    }, () => {
      chrome.runtime.sendMessage({ action: 'advanceWorkflow' }, (result) => {
        if (result) renderWorkflowUI(result.workflow);
      });
    });
  });

  // --- Step 2: Compose Email -> Fill Reply & Continue ---

  document.getElementById('wf-compose-fill').addEventListener('click', async () => {
    const emailBody = document.getElementById('wf-email-body').value.trim();
    if (!emailBody) {
      alert('Email body is empty.');
      return;
    }

    // Save email body to workflow data
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'updateWorkflowData',
        data: { emailBody }
      }, resolve);
    });

    // Send to content script to fill the reply textarea
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'fillReplyForWorkflow',
          text: emailBody
        });
      }
    } catch {
      // Content script may not be on messaging page
    }

    // Advance workflow to "send_email" step
    chrome.runtime.sendMessage({ action: 'advanceWorkflow' }, (result) => {
      if (result) renderWorkflowUI(result.workflow);
    });
  });

  // --- Step 2: Regenerate with AI ---

  document.getElementById('wf-compose-ai').addEventListener('click', async () => {
    if (!currentSettings.apiKey) {
      alert('Please set your OpenAI API key in Settings first.');
      return;
    }

    const btn = document.getElementById('wf-compose-ai');
    btn.disabled = true;
    btn.textContent = 'Generating...';

    const wfResult = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getWorkflow' }, resolve);
    });

    const workflow = wfResult?.workflow;
    if (!workflow) return;

    const customerMsg = customerMessageEl.value.trim() || detectedPageInfo?.customerMessage || '';
    const typeLabel = workflow.type === 'refund' ? 'refund' : 'replacement';
    const context = `This is a ${typeLabel} notification. Order ID: ${workflow.data.orderId || 'unknown'}. ${
      workflow.data.amount ? `Refund amount: $${workflow.data.amount}. ` : ''
    }Reason: ${REASON_LABELS[workflow.data.reason] || workflow.data.reason || 'unspecified'}.`;

    chrome.runtime.sendMessage({
      action: 'generateResponse',
      apiKey: currentSettings.apiKey,
      customerMessage: customerMsg || `The customer needs a ${typeLabel} for their order.`,
      tone: currentSettings.tone,
      sellerName: currentSettings.sellerName,
      context
    }, (response) => {
      btn.disabled = false;
      btn.textContent = 'Regenerate with AI';

      if (response && response.success) {
        document.getElementById('wf-email-body').value = response.response;
      } else {
        alert(`AI generation failed: ${response?.error || 'Unknown error'}`);
      }
    });
  });

  // --- Skip step (for page actions the user wants to skip) ---

  document.getElementById('wf-skip-step').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'advanceWorkflow' }, (result) => {
      if (result) renderWorkflowUI(result.workflow);
    });
  });

  // --- Done (complete step) ---

  document.getElementById('wf-done').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'cancelWorkflow' }, () => {
      showSection(mainSection);
    });
  });

  // --- Cancel buttons ---

  document.querySelectorAll('.wf-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'cancelWorkflow' }, () => {
        showSection(mainSection);
      });
    });
  });

  // ============================================================
  // INIT: CHECK FOR ACTIVE WORKFLOW ON POPUP OPEN
  // ============================================================

  async function init() {
    await initSettings();
    await detectPage();

    // Check if there's an active workflow
    chrome.runtime.sendMessage({ action: 'getWorkflow' }, (result) => {
      if (result && result.workflow) {
        renderWorkflowUI(result.workflow);
      }
    });
  }

  init();

  // ============================================================
  // LISTEN FOR WORKFLOW UPDATES FROM BACKGROUND
  // ============================================================

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.activeWorkflow) {
      const workflow = changes.activeWorkflow.newValue;
      if (workflow) {
        renderWorkflowUI(workflow);
      } else {
        // Workflow cleared (completed or cancelled)
        // Only switch to main if we're currently in workflow view
        if (!workflowSection.classList.contains('hidden')) {
          showSection(mainSection);
        }
      }
    }
  });
})();
