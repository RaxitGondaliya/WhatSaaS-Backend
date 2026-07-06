/**
 * Resolves the next node to route to when a button is clicked.
 * Supports any number of buttons per node.
 * @param {string} triggerId - The exact button payload (buttonId) received from WhatsApp.
 * @param {Object} currentNode - The current node in the flow the user is on.
 * @param {Object} flow - The complete flow document containing all nodes.
 * @param {string} businessId - The tenant's business ID for logging.
 * @returns {Object|null} Result object containing matchedButton, targetNodeId, and routeType.
 */
function resolveButtonClickRoute(triggerId, currentNode, flow, businessId) {
  if (!triggerId || !currentNode || !flow || !flow.nodes) return null;

  const nodeButtons = currentNode.data?.buttons || currentNode.buttons || [];
  
  // Step 4: Iterate through all buttons (no assumption about array length)
  // and find the one whose buttonId exactly equals the incoming payload.
  let matchedButton = null;
  for (const btn of nodeButtons) {
    if (btn.buttonId === triggerId) {
      matchedButton = btn;
      break;
    }
  }

  // Fallback to exact match on internal id if buttonId wasn't set, as some 
  // older flows might have the payload stored in id.
  if (!matchedButton) {
    for (const btn of nodeButtons) {
      if (btn.id === triggerId) {
        matchedButton = btn;
        break;
      }
    }
  }

  if (matchedButton) {
    // Step 5a: If nextMessageId is non-empty, route directly to the node with that id.
    // This is the primary fast path (O(1)).
    if (matchedButton.nextMessageId && String(matchedButton.nextMessageId).trim() !== '') {
      return {
        matchedButton,
        targetNodeId: matchedButton.nextMessageId,
        routeType: 'direct_next_message'
      };
    }

    // Step 5b: If nextMessageId is empty/null, as a fallback, search the ENTIRE flow's 
    // node list for a node where triggerType === 'button_click' AND triggerId === incoming buttonId.
    const searchId = String(triggerId).trim();
    const foundTriggerNode = flow.nodes.find(n => {
      const isTrigger = n.triggerType === 'button_click' || n.data?.triggerType === 'button_click';
      const nodeTriggerId = n.triggerId || n.data?.triggerId;
      return isTrigger && String(nodeTriggerId).trim() === searchId;
    });

    if (foundTriggerNode) {
      return {
        matchedButton,
        targetNodeId: foundTriggerNode.id || foundTriggerNode._id,
        routeType: 'flow_scan_fallback'
      };
    }
  }

  // Step 6: If no match is found after 5a and 5b, route to the flow's designated fallback node.
  // Log a warning including the flow id, current node id, and the unmatched buttonId.
  console.warn(`[Button Routing Warning] Flow: ${flow._id || flow.id}, Tenant: ${businessId}, Node: ${currentNode.id || currentNode._id}, Unmatched buttonId: ${triggerId}`);

  const fallbackNode = flow.nodes.find(n => n.triggerType === 'default' || n.data?.triggerType === 'default');
  
  if (fallbackNode) {
    return {
      matchedButton, // could be null if no button was matched
      targetNodeId: fallbackNode.id || fallbackNode._id,
      routeType: 'global_fallback'
    };
  }

  // If even a global fallback node isn't defined, return null to let the engine handle it.
  return null;
}

module.exports = {
  resolveButtonClickRoute
};
