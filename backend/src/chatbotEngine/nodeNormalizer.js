/**
 * Node Normalizer — Converts raw DB flow nodes into a canonical format
 * so the engine never has to deal with inconsistent node structures.
 *
 * Canonical Node Shape:
 * {
 *   id: string,
 *   type: 'text' | 'button' | 'input' | 'end',
 *   text: string,
 *   variable: string|null,
 *   buttons: [{ id, buttonId, text, nextNodeId, action }],
 *   nextNodeId: string|null,
 *   waitingFor: 'button' | 'text' | null,
 *   raw: Object  // original node for reference
 * }
 */

/**
 * Normalize a single node from the raw DB format into a canonical shape.
 * @param {Object} rawNode - The raw node from the database
 * @param {number} index - The index of the node in the flow's node array
 * @param {Array} allNodes - The full array of nodes (for sequential fallback)
 * @returns {Object} Normalized node
 */
function normalizeNode(rawNode, index, allNodes) {
  const data = rawNode.data || {};

  // 1. Resolve ID
  const id = rawNode.id || data.id || `fallback_node_${index}`;

  // 2. Resolve text content
  const text = data.text || rawNode.text || data.message || rawNode.message || '';

  // 3. Resolve variable name (unique per node)
  const variable = data.variable || rawNode.variable || null;

  // 4. Resolve buttons — merge from both locations and normalize each
  const rawButtons = data.buttons || rawNode.buttons || [];
  const buttons = rawButtons.map((btn, btnIndex) => {
    const buttonId = btn.buttonId || btn.id || `btn_${id}_${btnIndex}_${Date.now()}`;
    return {
      id: btn.id || buttonId,
      buttonId: buttonId,
      text: (btn.text || btn.label || `Option ${btnIndex + 1}`).trim(),
      nextNodeId: btn.nextMessageId || btn.nextNodeId || '',
      action: btn.action || 'none'
    };
  });

  // 5. Resolve nextNodeId for text/input nodes
  const nextNodeId = data.nextMessageId || rawNode.nextMessageId || '';

  // 6. Determine canonical type
  const rawType = (data.type || rawNode.type || '').toLowerCase();
  let type;
  if (rawType === 'end') {
    type = 'end';
  } else if (buttons.length > 0 || rawType === 'button message' || rawType === 'button') {
    type = 'button';
  } else if (rawType === 'input' || rawType === 'ask question' || rawType === 'ask question / collect answer' || rawNode.is_ask_question || data.is_ask_question) {
    type = 'input';
  } else {
    type = 'text';
  }

  // 7. Determine what we're waiting for
  let waitingFor = null;
  if (type === 'button') {
    waitingFor = 'button';
  } else if (type === 'text' || type === 'input') {
    // Only wait for text if there's a variable to store it in
    if (variable) {
      waitingFor = 'text';
    }
  }

  return {
    id,
    type,
    text,
    variable,
    buttons,
    nextNodeId,
    waitingFor,
    raw: rawNode
  };
}

/**
 * Normalize an entire flow's nodes into canonical format.
 * Also builds a fast lookup map by node ID.
 * @param {Object} flow - The raw flow document from the database
 * @returns {{ nodes: Array, nodeMap: Object, startNodeId: string|null }}
 */
function normalizeFlow(flow) {
  if (!flow || !flow.nodes || flow.nodes.length === 0) {
    return { nodes: [], nodeMap: {}, startNodeId: null };
  }

  const nodes = flow.nodes.map((n, i) => normalizeNode(n, i, flow.nodes));

  // Build fast lookup map
  const nodeMap = {};
  for (const node of nodes) {
    nodeMap[node.id] = node;
  }

  // Determine start node: the node with no incoming edges
  let startNodeId = null;
  if (flow.edges && flow.edges.length > 0) {
    const targetIds = new Set(flow.edges.map(e => String(e.target)));
    const startNode = nodes.find(n => !targetIds.has(String(n.id)));
    if (startNode) startNodeId = startNode.id;
  }
  // Fallback: first node
  if (!startNodeId && nodes.length > 0) {
    startNodeId = nodes[0].id;
  }

  return { nodes, nodeMap, startNodeId };
}

/**
 * Find a button in a normalized node by its payload ID or text.
 * Priority: exact buttonId match > case-insensitive trimmed text match.
 * @param {Object} node - Normalized node
 * @param {string|null} triggerId - The payload ID from WhatsApp
 * @param {string} messageText - The raw message text from the user
 * @returns {Object|null} The matched button, or null
 */
function findButton(node, triggerId, messageText) {
  if (!node || !node.buttons || node.buttons.length === 0) return null;

  // Priority 1: Exact payload match
  if (triggerId) {
    const cleanTrigger = String(triggerId).trim();
    const match = node.buttons.find(b => String(b.buttonId).trim() === cleanTrigger);
    if (match) return match;

    // Also try matching against internal id
    const idMatch = node.buttons.find(b => String(b.id).trim() === cleanTrigger);
    if (idMatch) return idMatch;
  }

  // Priority 2: Case-insensitive trimmed text match
  if (messageText) {
    const cleanText = messageText.trim().toLowerCase();
    const textMatch = node.buttons.find(b => b.text.trim().toLowerCase() === cleanText);
    if (textMatch) return textMatch;
  }

  return null;
}

/**
 * Resolve the next node ID to navigate to after a user interaction.
 * @param {Object} currentNode - The current normalized node
 * @param {Object|null} clickedButton - The clicked button (if any)
 * @param {Array} allNodes - The full normalized nodes array
 * @returns {string|null} The next node ID, or null if flow is complete
 */
function resolveNextNodeId(currentNode, clickedButton, allNodes) {
  // Priority 1: Button's explicit routing
  if (clickedButton && clickedButton.nextNodeId) {
    return clickedButton.nextNodeId;
  }

  // Priority 2: Node-level explicit routing
  if (currentNode.nextNodeId) {
    return currentNode.nextNodeId;
  }

  // Priority 3: Sequential fallback (next node in array)
  const currentIndex = allNodes.findIndex(n => n.id === currentNode.id);
  if (currentIndex >= 0 && currentIndex < allNodes.length - 1) {
    console.warn(`[NodeNormalizer] Using sequential fallback for node ${currentNode.id}. Consider setting explicit nextNodeId.`);
    return allNodes[currentIndex + 1].id;
  }

  return null; // End of flow
}

module.exports = {
  normalizeNode,
  normalizeFlow,
  findButton,
  resolveNextNodeId
};
