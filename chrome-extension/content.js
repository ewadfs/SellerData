/**
 * Content script for Amazon Seller Central.
 * Runs on ALL Seller Central pages to support workflow automation.
 *
 * Responsibilities:
 *   - Extract page data (customer messages, order IDs)
 *   - Fill reply textareas and highlight Send buttons
 *   - Highlight action buttons on order pages (Refund, Replacement)
 *   - Pre-fill refund/replacement forms
 *   - Show a persistent step-indicator overlay during active workflows
 */

(function () {
  'use strict';

  const OVERLAY_ID = 'sellerdata-workflow-overlay';
  const HIGHLIGHT_CLASS = 'sellerdata-highlight-pulse';

  // ============================================================
  // PAGE DATA EXTRACTION
  // ============================================================

  function extractCustomerMessage() {
    const selectors = [
      '.message-body',
      '.buyer-message-text',
      '[data-test-id="message-body"]',
      '.comm-mgr-message-content',
      '.message-text-content',
      '.message-content-body'
    ];
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        return elements[elements.length - 1].innerText.trim();
      }
    }
    return '';
  }

  function extractOrderId() {
    const selectors = [
      '[data-test-id="order-id"]',
      '.order-id-value',
      '.comm-mgr-order-id',
      'span[data-test-id="order-id-value"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.innerText.trim();
    }
    // Fallback: regex on the URL or page text
    const urlMatch = window.location.href.match(/order\/(\d{3}-\d{7}-\d{7})/);
    if (urlMatch) return urlMatch[1];
    const pageMatch = document.body.innerText.match(/\b(\d{3}-\d{7}-\d{7})\b/);
    return pageMatch ? pageMatch[1] : '';
  }

  function extractBuyerName() {
    const selectors = [
      '.buyer-name',
      '[data-test-id="buyer-name"]',
      '.comm-mgr-buyer-name'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.innerText.trim();
    }
    return '';
  }

  // ============================================================
  // REPLY TEXTAREA INTERACTION
  // ============================================================

  function findReplyTextarea() {
    const selectors = [
      '#message-text-area',
      'textarea[name="message"]',
      '.message-textarea',
      '[data-test-id="reply-textarea"]',
      'textarea.kat-textarea',
      'textarea[placeholder*="message"]',
      'textarea[placeholder*="Message"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.offsetHeight > 0 && ta.offsetWidth > 0) return ta;
    }
    return null;
  }

  function insertIntoReply(text) {
    const textarea = findReplyTextarea();
    if (!textarea) return false;

    textarea.focus();
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // For React-based UIs, also set via nativeInputValueSetter
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    return true;
  }

  function findSendButton() {
    const selectors = [
      'button[data-test-id="send-message-button"]',
      'input[type="submit"][value*="Send"]',
      'button.send-message-button',
      'button[name="send"]',
      'kat-button[label*="Send"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Fallback: look for buttons with "Send" text
    const buttons = document.querySelectorAll('button, input[type="submit"], kat-button');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || btn.getAttribute('label') || '').trim();
      if (/^send/i.test(text)) return btn;
    }
    return null;
  }

  // ============================================================
  // ELEMENT HIGHLIGHTING
  // ============================================================

  function highlightElement(el, label) {
    if (!el) return;

    el.classList.add(HIGHLIGHT_CLASS);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add a tooltip arrow pointing to the element
    const tooltip = document.createElement('div');
    tooltip.className = 'sellerdata-tooltip';
    tooltip.textContent = label || 'Click here';
    el.style.position = el.style.position || 'relative';
    el.parentElement.style.position = el.parentElement.style.position || 'relative';
    el.parentElement.insertBefore(tooltip, el);

    // Position tooltip above the element
    const rect = el.getBoundingClientRect();
    tooltip.style.position = 'absolute';
    tooltip.style.left = `${el.offsetLeft}px`;
    tooltip.style.top = `${el.offsetTop - 36}px`;
    tooltip.style.zIndex = '100000';

    return () => {
      el.classList.remove(HIGHLIGHT_CLASS);
      tooltip.remove();
    };
  }

  function clearHighlights() {
    document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(el => {
      el.classList.remove(HIGHLIGHT_CLASS);
    });
    document.querySelectorAll('.sellerdata-tooltip').forEach(el => el.remove());
  }

  // ============================================================
  // ORDER PAGE HELPERS
  // ============================================================

  function findRefundButton() {
    const selectors = [
      'button[data-test-id="refund-order-button"]',
      'a[href*="refund"]',
      'button[name="refund"]',
      'kat-button[label*="Refund"]',
      'span.action-button-text'
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.textContent || el.getAttribute('label') || '').toLowerCase();
        if (text.includes('refund')) return el;
      }
    }
    // Broad search for any clickable element with "refund" text
    const allClickables = document.querySelectorAll('a, button, kat-button, [role="button"]');
    for (const el of allClickables) {
      const text = (el.textContent || '').toLowerCase();
      if (text.includes('refund order') || text.includes('issue refund')) return el;
    }
    return null;
  }

  function findReplacementButton() {
    const selectors = [
      'button[data-test-id="replacement-order-button"]',
      'a[href*="replacement"]',
      'kat-button[label*="Replacement"]'
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.textContent || el.getAttribute('label') || '').toLowerCase();
        if (text.includes('replacement')) return el;
      }
    }
    const allClickables = document.querySelectorAll('a, button, kat-button, [role="button"]');
    for (const el of allClickables) {
      const text = (el.textContent || '').toLowerCase();
      if (text.includes('replacement') || text.includes('replace')) return el;
    }
    return null;
  }

  // ============================================================
  // REFUND / REPLACEMENT FORM HELPERS
  // ============================================================

  function fillRefundFormFields(data) {
    let filled = false;

    // Try to fill refund amount
    if (data.amount) {
      const amountInputs = document.querySelectorAll(
        'input[name*="amount"], input[data-test-id*="refund-amount"], input[type="number"], input[placeholder*="amount"]'
      );
      for (const input of amountInputs) {
        input.focus();
        input.value = data.amount;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        filled = true;
        break;
      }
    }

    // Try to select refund reason
    if (data.reason) {
      const reasonSelects = document.querySelectorAll(
        'select[name*="reason"], select[data-test-id*="reason"], kat-dropdown[name*="reason"]'
      );
      const reasonMap = {
        customer_request: ['customer', 'buyer', 'request'],
        damaged: ['damage', 'damaged'],
        wrong_item: ['wrong', 'incorrect'],
        not_received: ['not received', 'missing', 'lost'],
        defective: ['defect', 'defective', 'faulty'],
        other: ['other']
      };
      const keywords = reasonMap[data.reason] || [data.reason];

      for (const select of reasonSelects) {
        const options = select.querySelectorAll('option');
        for (const opt of options) {
          const text = opt.textContent.toLowerCase();
          if (keywords.some(kw => text.includes(kw))) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            filled = true;
            break;
          }
        }
      }
    }

    return filled;
  }

  function findSubmitRefundButton() {
    const allClickables = document.querySelectorAll('button, input[type="submit"], kat-button, [role="button"]');
    for (const el of allClickables) {
      const text = (el.textContent || el.value || el.getAttribute('label') || '').toLowerCase();
      if (text.includes('submit refund') || text.includes('issue refund') || text.includes('confirm refund')) {
        return el;
      }
    }
    // Fallback: primary submit button
    for (const el of allClickables) {
      const text = (el.textContent || el.value || el.getAttribute('label') || '').toLowerCase();
      if (text.includes('submit') || text.includes('confirm')) {
        return el;
      }
    }
    return null;
  }

  function findSubmitReplacementButton() {
    const allClickables = document.querySelectorAll('button, input[type="submit"], kat-button, [role="button"]');
    for (const el of allClickables) {
      const text = (el.textContent || el.value || el.getAttribute('label') || '').toLowerCase();
      if (text.includes('submit replacement') || text.includes('create replacement') || text.includes('confirm replacement')) {
        return el;
      }
    }
    for (const el of allClickables) {
      const text = (el.textContent || el.value || el.getAttribute('label') || '').toLowerCase();
      if (text.includes('submit') || text.includes('confirm') || text.includes('place order')) {
        return el;
      }
    }
    return null;
  }

  // ============================================================
  // WORKFLOW STEP OVERLAY
  // ============================================================

  function showStepOverlay(workflow, stepDef) {
    removeStepOverlay();

    const steps = WORKFLOW_STEPS[workflow.type];
    const totalSteps = steps.length;
    const currentIdx = workflow.currentStep;
    const workflowLabel = workflow.type === 'refund' ? 'Refund' : 'Replacement';

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div class="sellerdata-overlay-inner">
        <div class="sellerdata-overlay-header">
          <span class="sellerdata-overlay-logo">SellerData</span>
          <span class="sellerdata-overlay-title">${workflowLabel} Workflow</span>
          <button class="sellerdata-overlay-close" id="sellerdata-overlay-close">&times;</button>
        </div>
        <div class="sellerdata-overlay-progress">
          ${steps.map((s, i) => `
            <div class="sellerdata-step-dot ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'active' : ''}">
              ${i < currentIdx ? '&#10003;' : i + 1}
            </div>
          `).join('<div class="sellerdata-step-line"></div>')}
        </div>
        <div class="sellerdata-overlay-step">
          <div class="sellerdata-step-title">Step ${currentIdx + 1} of ${totalSteps}: ${stepDef.title}</div>
          <div class="sellerdata-step-desc">${stepDef.description}</div>
        </div>
        <div class="sellerdata-overlay-actions">
          <button class="sellerdata-btn-cancel" id="sellerdata-cancel-workflow">Cancel Workflow</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('sellerdata-overlay-close').addEventListener('click', () => {
      overlay.classList.add('sellerdata-overlay-minimized');
    });

    document.getElementById('sellerdata-cancel-workflow').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'cancelWorkflow' }, () => {
        removeStepOverlay();
        clearHighlights();
      });
    });
  }

  function removeStepOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  // ============================================================
  // WORKFLOW STEP EXECUTION
  // ============================================================

  /**
   * Watch for user clicking a highlighted button and auto-advance the workflow.
   */
  function watchForClick(element, callback) {
    if (!element) return;

    const handler = () => {
      element.removeEventListener('click', handler);
      // Small delay to let the page action complete
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'stepCompletedOnPage' }, (result) => {
          if (result && result.stepDef) {
            showStepOverlay(result.workflow, result.stepDef);
          } else {
            removeStepOverlay();
            clearHighlights();
          }
          if (callback) callback(result);
        });
      }, 500);
    };
    element.addEventListener('click', handler);
  }

  function executeStep(workflow, stepDef) {
    showStepOverlay(workflow, stepDef);
    clearHighlights();

    switch (stepDef.action) {
      case 'fillReplyAndHighlightSend': {
        const emailBody = workflow.data.emailBody;
        if (emailBody) {
          insertIntoReply(emailBody);
        }
        const sendBtn = findSendButton();
        if (sendBtn) {
          highlightElement(sendBtn, 'Click Send to continue');
          watchForClick(sendBtn);
        }
        break;
      }

      case 'highlightRefundButton': {
        const btn = findRefundButton();
        if (btn) {
          highlightElement(btn, 'Click to start refund');
          watchForClick(btn);
        }
        break;
      }

      case 'highlightReplacementButton': {
        const btn = findReplacementButton();
        if (btn) {
          highlightElement(btn, 'Click to start replacement');
          watchForClick(btn);
        }
        break;
      }

      case 'fillRefundForm': {
        fillRefundFormFields(workflow.data);
        const submitBtn = findSubmitRefundButton();
        if (submitBtn) {
          highlightElement(submitBtn, 'Review & click to submit refund');
          watchForClick(submitBtn);
        }
        break;
      }

      case 'fillReplacementForm': {
        // Replacement forms have fewer fields to fill
        const submitBtn = findSubmitReplacementButton();
        if (submitBtn) {
          highlightElement(submitBtn, 'Review & click to confirm');
          watchForClick(submitBtn);
        }
        break;
      }
    }
  }

  // ============================================================
  // MESSAGE LISTENERS
  // ============================================================

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getPageInfo') {
      sendResponse({
        isMessagingPage: detectPageType(window.location.href) === 'messaging',
        pageType: detectPageType(window.location.href),
        customerMessage: extractCustomerMessage(),
        orderId: extractOrderId(),
        buyerName: extractBuyerName()
      });
      return false;
    }

    if (request.action === 'insertReply') {
      const success = insertIntoReply(request.text);
      sendResponse({ success });
      return false;
    }

    if (request.action === 'executeWorkflowStep') {
      executeStep(request.workflow, request.stepDef);
      sendResponse({ success: true });
      return false;
    }

    if (request.action === 'fillReplyForWorkflow') {
      const success = insertIntoReply(request.text);
      if (success) {
        const sendBtn = findSendButton();
        if (sendBtn) {
          highlightElement(sendBtn, 'Click Send to continue');
          watchForClick(sendBtn);
        }
      }
      sendResponse({ success });
      return false;
    }
  });

  // ============================================================
  // ON LOAD: CHECK FOR ACTIVE WORKFLOW
  // ============================================================

  async function checkActiveWorkflow() {
    const workflow = await getActiveWorkflow();
    if (!workflow) return;

    const stepDef = getCurrentStepDef(workflow);
    if (!stepDef || stepDef.location !== 'page') return;

    const pageType = detectPageType(window.location.href);
    if (pageType === stepDef.pageType) {
      // We're on the right page for this step - execute it
      setTimeout(() => executeStep(workflow, stepDef), 800);
    }
  }

  checkActiveWorkflow();
})();
