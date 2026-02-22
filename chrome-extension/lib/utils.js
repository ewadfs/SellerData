/**
 * Shared utilities for the SellerData Chrome Extension.
 * Includes templates, workflow definitions, and storage helpers.
 */

// ============================================================
// MESSAGE TEMPLATES
// ============================================================

const TEMPLATES = {
  apology: `Dear Customer,

I sincerely apologize for the inconvenience you've experienced. We take your satisfaction very seriously and want to make this right.

Please let us know how we can best resolve this for you, and we'll take immediate action.

Best regards,
{{sellerName}}`,

  shipping_delay: `Dear Customer,

Thank you for reaching out. I understand your concern about the shipping delay, and I apologize for the inconvenience.

I've looked into your order and can confirm it is on its way. Due to unexpected logistics delays, delivery may take a few extra days. We're actively monitoring the shipment.

If you have any further questions, please don't hesitate to reach out.

Best regards,
{{sellerName}}`,

  return_instructions: `Dear Customer,

Thank you for contacting us. I'm happy to help you with the return process.

To initiate a return:
1. Go to "Your Orders" in your Amazon account
2. Select the order you'd like to return
3. Choose a reason for the return
4. Select your preferred return method
5. Print the return label and ship the item back

Once we receive the returned item, your refund will be processed within 3-5 business days.

If you need any additional assistance, please let us know.

Best regards,
{{sellerName}}`,

  thank_you: `Dear Customer,

Thank you so much for your purchase and for taking the time to reach out! We truly appreciate your business.

If there's anything else we can help you with, please don't hesitate to ask.

Best regards,
{{sellerName}}`,

  refund_confirmation: `Dear Customer,

I'm writing to confirm that we've initiated a refund of {{amount}} for your order {{orderId}}.

Reason: {{reason}}

The refund should appear in your account within 3-5 business days, depending on your payment method.

We apologize for any inconvenience and appreciate your patience.

Best regards,
{{sellerName}}`,

  replacement_confirmation: `Dear Customer,

I'm writing to confirm that we're sending a replacement for your order {{orderId}}.

Reason: {{reason}}

The new item will be shipped as soon as possible, and you'll receive a shipping confirmation with tracking information.

You do not need to return the original item.

We apologize for the inconvenience and appreciate your understanding.

Best regards,
{{sellerName}}`
};

const REASON_LABELS = {
  customer_request: 'Customer Request',
  damaged: 'Item Damaged',
  wrong_item: 'Wrong Item Sent',
  not_received: 'Not Received',
  defective: 'Defective Product',
  missing_parts: 'Missing Parts',
  other: 'Other'
};

// ============================================================
// WORKFLOW DEFINITIONS
// ============================================================

/**
 * Workflow types and their step sequences.
 *
 * Each workflow is an ordered list of steps. The content script and popup
 * coordinate to guide the user through each step. The user performs the
 * final action (clicking Send, clicking Confirm) at each step.
 */

const WORKFLOW_STEPS = {
  refund: [
    {
      id: 'gather_info',
      title: 'Refund Details',
      description: 'Enter the order and refund information.',
      location: 'popup'
    },
    {
      id: 'compose_email',
      title: 'Compose Customer Email',
      description: 'Review the refund notification email. Edit if needed, then click "Fill Reply & Continue".',
      location: 'popup'
    },
    {
      id: 'send_email',
      title: 'Send Customer Email',
      description: 'The message has been filled into the reply box. Review it and click Send.',
      location: 'page',
      pageType: 'messaging',
      action: 'fillReplyAndHighlightSend'
    },
    {
      id: 'navigate_to_order',
      title: 'Go to Order Page',
      description: 'Opening the order page to process the refund...',
      location: 'auto',
      action: 'navigateToOrder'
    },
    {
      id: 'click_refund',
      title: 'Start Refund',
      description: 'Click the highlighted "Refund Order" button on the order page.',
      location: 'page',
      pageType: 'order',
      action: 'highlightRefundButton'
    },
    {
      id: 'fill_refund_form',
      title: 'Review Refund Form',
      description: 'Refund details have been pre-filled. Review the amount and reason, then click "Submit Refund".',
      location: 'page',
      pageType: 'refund_form',
      action: 'fillRefundForm'
    },
    {
      id: 'complete',
      title: 'Refund Complete',
      description: 'The refund has been submitted successfully!',
      location: 'popup'
    }
  ],

  replacement: [
    {
      id: 'gather_info',
      title: 'Replacement Details',
      description: 'Enter the order and replacement information.',
      location: 'popup'
    },
    {
      id: 'compose_email',
      title: 'Compose Customer Email',
      description: 'Review the replacement notification email. Edit if needed, then click "Fill Reply & Continue".',
      location: 'popup'
    },
    {
      id: 'send_email',
      title: 'Send Customer Email',
      description: 'The message has been filled into the reply box. Review it and click Send.',
      location: 'page',
      pageType: 'messaging',
      action: 'fillReplyAndHighlightSend'
    },
    {
      id: 'navigate_to_order',
      title: 'Go to Order Page',
      description: 'Opening the order page to process the replacement...',
      location: 'auto',
      action: 'navigateToOrder'
    },
    {
      id: 'click_replacement',
      title: 'Start Replacement',
      description: 'Click the highlighted "Create replacement order" button.',
      location: 'page',
      pageType: 'order',
      action: 'highlightReplacementButton'
    },
    {
      id: 'confirm_replacement',
      title: 'Confirm Replacement',
      description: 'Replacement details have been pre-filled. Review and click "Submit" to confirm.',
      location: 'page',
      pageType: 'replacement_form',
      action: 'fillReplacementForm'
    },
    {
      id: 'complete',
      title: 'Replacement Complete',
      description: 'The replacement order has been created successfully!',
      location: 'popup'
    }
  ]
};

// ============================================================
// WORKFLOW STATE MANAGEMENT
// ============================================================

/**
 * Active workflow state stored in chrome.storage.local under key 'activeWorkflow'.
 * Shape:
 * {
 *   type: 'refund' | 'replacement',
 *   currentStep: 0,                   // index into WORKFLOW_STEPS[type]
 *   data: {                            // user-provided data for this workflow
 *     orderId, amount, reason, asin,
 *     emailBody, sellerName, ...
 *   },
 *   startedAt: timestamp
 * }
 *
 * null means no workflow is active.
 */

function getActiveWorkflow() {
  return new Promise((resolve) => {
    chrome.storage.local.get('activeWorkflow', (result) => {
      resolve(result.activeWorkflow || null);
    });
  });
}

function setActiveWorkflow(workflow) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ activeWorkflow: workflow }, resolve);
  });
}

function clearActiveWorkflow() {
  return new Promise((resolve) => {
    chrome.storage.local.remove('activeWorkflow', resolve);
  });
}

/**
 * Advance the workflow to the next step.
 * Returns the updated workflow or null if completed.
 */
async function advanceWorkflow() {
  const wf = await getActiveWorkflow();
  if (!wf) return null;

  const steps = WORKFLOW_STEPS[wf.type];
  const nextStep = wf.currentStep + 1;

  if (nextStep >= steps.length) {
    await clearActiveWorkflow();
    return null;
  }

  wf.currentStep = nextStep;
  await setActiveWorkflow(wf);
  return wf;
}

/**
 * Get the current step definition for the active workflow.
 */
function getCurrentStepDef(workflow) {
  if (!workflow) return null;
  const steps = WORKFLOW_STEPS[workflow.type];
  return steps[workflow.currentStep] || null;
}

// ============================================================
// SETTINGS
// ============================================================

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['apiKey', 'sellerName', 'tone'],
      (result) => {
        resolve({
          apiKey: result.apiKey || '',
          sellerName: result.sellerName || 'Our Store',
          tone: result.tone || 'professional'
        });
      }
    );
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}

// ============================================================
// HELPERS
// ============================================================

function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return result;
}

/**
 * Detect what type of Seller Central page we're on based on the URL.
 */
function detectPageType(url) {
  if (!url) return 'unknown';
  if (/\/(messaging|buyer-messages|communication-manager)/.test(url)) return 'messaging';
  if (/\/orders-v3\/order\/.*\/refund/.test(url)) return 'refund_form';
  if (/\/orders-v3\/order\/.*\/replacement/.test(url)) return 'replacement_form';
  if (/\/orders-v3\/order\//.test(url)) return 'order';
  if (/\/gp\/ssof\/shipping-queue/.test(url) || /fbashipment/.test(url)) return 'shipping_queue';
  if (/\/merchandising-new/.test(url) || /\/deals\/create/.test(url)) return 'deals';
  if (/\/payments\/dashboard/.test(url) || /\/payments\/event\/view/.test(url)) return 'payments_dashboard';
  if (/sellercentral\.amazon\.[^/]+\/home\b/.test(url) || /sellercentral\.amazon\.[^/]+\/?$/.test(url)) return 'home';
  if (/sellercentral\.amazon\./.test(url)) return 'seller_central';
  return 'unknown';
}
