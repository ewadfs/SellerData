/**
 * Background service worker for SellerData Chrome Extension.
 * Orchestrates workflows and handles AI message generation.
 */

importScripts('lib/utils.js');

// ============================================================
// AI MESSAGE GENERATION
// ============================================================

async function generateAIResponse(apiKey, customerMessage, tone, sellerName, context) {
  const systemPrompt = `You are a customer service assistant for "${sellerName}", an Amazon seller.
Generate a response to the customer's message below.

Guidelines:
- Tone: ${tone}
- Be helpful and solution-oriented
- Follow Amazon's communication policies (no links to external sites, no promotional content)
- Never ask the customer to leave a review or modify a review
- Keep the response concise but thorough
- Address the customer's specific concern directly
- If the issue involves a defect or damage, express empathy and offer a resolution
- Sign off with the seller name
${context ? `\nAdditional context: ${context}` : ''}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Customer message:\n\n${customerMessage}` }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API request failed (${response.status})`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// ============================================================
// WORKFLOW ORCHESTRATION
// ============================================================

/**
 * Execute automatic workflow steps (like navigation).
 * Called when a step with location='auto' is reached.
 */
async function executeAutoStep(workflow, stepDef) {
  if (stepDef.action === 'navigateToOrder') {
    const orderId = workflow.data.orderId;
    const baseUrl = workflow.data.baseUrl || 'https://sellercentral.amazon.com';
    const url = `${baseUrl}/orders-v3/order/${orderId}`;

    // Navigate the current tab to the order page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.tabs.update(tab.id, { url });
    }

    // Advance to next step (the content script will pick it up on the order page)
    return await advanceWorkflow();
  }
  return workflow;
}

/**
 * When a tab finishes loading, check if there's a workflow step waiting
 * for this page type and tell the content script to execute it.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const workflow = await getActiveWorkflow();
  if (!workflow) return;

  const stepDef = getCurrentStepDef(workflow);
  if (!stepDef || stepDef.location !== 'page') return;

  const pageType = detectPageType(tab.url);

  // If we're on the right type of page for this step, execute the action
  if (pageType === stepDef.pageType) {
    // Give the page a moment to fully render
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        action: 'executeWorkflowStep',
        workflow,
        stepDef
      }).catch(() => {
        // Content script may not be ready yet
      });
    }, 1000);
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // --- AI generation ---
  if (request.action === 'generateResponse') {
    const { apiKey, customerMessage, tone, sellerName, context } = request;
    generateAIResponse(apiKey, customerMessage, tone, sellerName, context)
      .then((response) => sendResponse({ success: true, response }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // --- Start a new workflow ---
  if (request.action === 'startWorkflow') {
    const { type, data } = request;
    const workflow = {
      type,
      currentStep: 0,
      data,
      startedAt: Date.now()
    };
    setActiveWorkflow(workflow).then(() => {
      sendResponse({ success: true, workflow });
    });
    return true;
  }

  // --- Get current workflow state ---
  if (request.action === 'getWorkflow') {
    getActiveWorkflow().then((workflow) => {
      const stepDef = getCurrentStepDef(workflow);
      sendResponse({ workflow, stepDef });
    });
    return true;
  }

  // --- Advance to next step ---
  if (request.action === 'advanceWorkflow') {
    (async () => {
      let workflow = await advanceWorkflow();
      if (!workflow) {
        sendResponse({ workflow: null, stepDef: null, completed: true });
        return;
      }

      let stepDef = getCurrentStepDef(workflow);

      // Handle auto steps (like navigation)
      while (stepDef && stepDef.location === 'auto') {
        workflow = await executeAutoStep(workflow, stepDef);
        if (!workflow) {
          sendResponse({ workflow: null, stepDef: null, completed: true });
          return;
        }
        stepDef = getCurrentStepDef(workflow);
      }

      sendResponse({ workflow, stepDef, completed: false });
    })();
    return true;
  }

  // --- Update workflow data (e.g., edited email body) ---
  if (request.action === 'updateWorkflowData') {
    (async () => {
      const workflow = await getActiveWorkflow();
      if (workflow) {
        Object.assign(workflow.data, request.data);
        await setActiveWorkflow(workflow);
        sendResponse({ success: true, workflow });
      } else {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  // --- Cancel workflow ---
  if (request.action === 'cancelWorkflow') {
    clearActiveWorkflow().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // --- Step completed by content script (user clicked button on page) ---
  if (request.action === 'stepCompletedOnPage') {
    (async () => {
      let workflow = await advanceWorkflow();
      if (!workflow) {
        sendResponse({ workflow: null, stepDef: null, completed: true });
        return;
      }

      let stepDef = getCurrentStepDef(workflow);

      // Handle auto steps
      while (stepDef && stepDef.location === 'auto') {
        workflow = await executeAutoStep(workflow, stepDef);
        if (!workflow) {
          sendResponse({ workflow: null, stepDef: null, completed: true });
          return;
        }
        stepDef = getCurrentStepDef(workflow);
      }

      sendResponse({ workflow, stepDef, completed: false });
    })();
    return true;
  }
});
