const ChatbotFlow = require('../models/ChatbotFlow');
const User = require('../models/User');

const VALID_STATUSES = ['draft', 'active', 'inactive'];
const VALID_TRIGGER_TYPES = ['keywords', 'any', 'both'];

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const normalizeStringArray = (value) => {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return list
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeTriggerKeywords = (value) => {
  const seen = new Set();

  return normalizeStringArray(value).filter((keyword) => {
    const key = keyword.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const normalizeTriggerType = (value) => {
  const normalized = normalizeText(value);
  return normalized || 'keywords';
};

const validateTriggerType = (triggerType) => {
  if (triggerType === undefined) {
    return null;
  }

  return VALID_TRIGGER_TYPES.includes(triggerType)
    ? null
    : 'Trigger type must be keywords, any, or both';
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeObject = (value) => {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }

  return value;
};

const getFlowScope = async (userId) => {
  const currentUser = await User.findById(userId);

  if (!currentUser) {
    return { errorStatus: 404, errorMessage: 'User not found' };
  }

  if (!currentUser.businessId) {
    return {
      currentUser,
      businessId: null,
      ownerId: currentUser._id,
    };
  }

  const owner = currentUser.role === 'owner'
    ? currentUser
    : await User.findOne({ businessId: currentUser.businessId, role: 'owner' });

  return {
    currentUser,
    businessId: currentUser.businessId,
    ownerId: owner?._id || currentUser._id,
  };
};

const sendScopeError = (res, scope) => {
  if (!scope.errorStatus) {
    return false;
  }

  res.status(scope.errorStatus).json({
    success: false,
    message: scope.errorMessage,
  });
  return true;
};

const buildScopedQuery = (scope, extra = {}) => ({
  ownerId: scope.ownerId,
  businessId: scope.businessId,
  ...extra,
});

const formatFlow = (flow) => {
  const flowObj = flow.toObject ? flow.toObject() : flow;
  
  const nodes = (flowObj.nodes || []).map(node => {
    if (!node) return null;
    if (!node.position) {
      node.position = { x: 0, y: 0 };
    }
    return node;
  }).filter(Boolean);

  return {
    _id: flowObj._id,
    businessId: flowObj.businessId,
    ownerId: flowObj.ownerId,
    flowName: flowObj.flowName,
    description: flowObj.description,
    triggerKeywords: flowObj.triggerKeywords,
    triggerType: flowObj.triggerType,
    status: flowObj.status,
    nodes: nodes,
    edges: flowObj.edges,
    settings: flowObj.settings,
    createdBy: flowObj.createdBy,
    updatedBy: flowObj.updatedBy,
    createdAt: flowObj.createdAt,
    updatedAt: flowObj.updatedAt,
  };
};

const deactivateOtherFlows = async (scope, flowId) => {
  await ChatbotFlow.updateMany(
    buildScopedQuery(scope, {
      _id: { $ne: flowId },
    }),
    { $set: { status: 'inactive' } }
  );
};

const validateStatus = (status) => {
  if (status === undefined) {
    return null;
  }

  return VALID_STATUSES.includes(status) ? null : 'Status must be draft, active, or inactive';
};

/**
 * GET /api/chatbot-flows
 * Return all flows for current owner/business scope.
 */
exports.getFlows = async (req, res, next) => {
  try {
    const scope = await getFlowScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const flows = await ChatbotFlow.find(buildScopedQuery(scope)).sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      count: flows.length,
      flows: flows.map(formatFlow),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/chatbot-flows
 * Create a chatbot builder flow.
 */
exports.createFlow = async (req, res, next) => {
  try {
    const scope = await getFlowScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const {
      flowName,
      description = '',
      triggerKeywords = [],
      triggerType = 'keywords',
      status = 'draft',
      nodes = [],
      edges = [],
      settings = {},
    } = req.body;
    const normalizedStatus = normalizeText(status) || 'draft';
    const normalizedTriggerType = normalizeTriggerType(triggerType);

    if (!normalizeOptionalString(flowName)) {
      return res.status(400).json({
        success: false,
        message: 'Flow name is required',
      });
    }

    const statusError = validateStatus(normalizedStatus);
    if (statusError) {
      return res.status(400).json({
        success: false,
        message: statusError,
      });
    }

    const triggerTypeError = validateTriggerType(normalizedTriggerType);
    if (triggerTypeError) {
      return res.status(400).json({
        success: false,
        message: triggerTypeError,
      });
    }

    const flow = await ChatbotFlow.create({
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      flowName,
      description,
      triggerKeywords: normalizeTriggerKeywords(triggerKeywords),
      triggerType: normalizedTriggerType,
      status: normalizedStatus,
      nodes: normalizeArray(nodes).map((n, i) => {
        if (!n.id) n.id = `node_${i}`;
        return n;
      }),
      edges: normalizeArray(edges),
      settings: normalizeObject(settings),
      createdBy: scope.currentUser._id,
      updatedBy: scope.currentUser._id,
    });

    if (flow.status === 'active') {
      await deactivateOtherFlows(scope, flow._id);
    }

    res.status(201).json({
      success: true,
      message: 'Chatbot flow created successfully',
      flow: formatFlow(flow),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/chatbot-flows/:id
 * Return one flow.
 */
exports.getFlow = async (req, res, next) => {
  try {
    const scope = await getFlowScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const flow = await ChatbotFlow.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!flow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found',
      });
    }

    const formattedFlow = formatFlow(flow);
    console.log(`[getFlow] DB nodes count: ${flow.nodes ? flow.nodes.length : 0}`);
    console.log(`[getFlow] API response nodes count: ${formattedFlow.nodes ? formattedFlow.nodes.length : 0}`);

    res.status(200).json({
      success: true,
      flow: formattedFlow,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/chatbot-flows/:id
 * Update full flow.
 */
exports.updateFlow = async (req, res, next) => {
  try {
    const scope = await getFlowScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const flow = await ChatbotFlow.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!flow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found',
      });
    }

    const updates = {};
    const editableFields = [
      'flowName',
      'description',
      'triggerKeywords',
      'triggerType',
      'status',
      'nodes',
      'edges',
      'settings',
    ];

    editableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (updates.status !== undefined) {
      updates.status = normalizeText(updates.status);
      const statusError = validateStatus(updates.status);

      if (statusError) {
        return res.status(400).json({
          success: false,
          message: statusError,
        });
      }
    }

    if (updates.triggerType !== undefined) {
      updates.triggerType = normalizeTriggerType(updates.triggerType);
      const triggerTypeError = validateTriggerType(updates.triggerType);

      if (triggerTypeError) {
        return res.status(400).json({
          success: false,
          message: triggerTypeError,
        });
      }
    }

    if (updates.flowName !== undefined && !normalizeOptionalString(updates.flowName)) {
      return res.status(400).json({
        success: false,
        message: 'Flow name is required',
      });
    }

    if (updates.triggerKeywords !== undefined) {
      updates.triggerKeywords = normalizeTriggerKeywords(updates.triggerKeywords);
    }

    if (updates.nodes !== undefined) {
      let hasSubmitRequestAction = false;
      
      // Validate that button_click nodes reference a valid buttonId in the flow
      for (const node of updates.nodes) {
        if (node.triggerType === 'button_click' || (node.data && node.data.triggerType === 'button_click')) {
          const triggerId = node.triggerId || (node.data && node.data.triggerId);
          let matchFound = false;
          for (const searchNode of updates.nodes) {
            const buttons = searchNode.buttons || (searchNode.data && searchNode.data.buttons);
            if (buttons && Array.isArray(buttons)) {
              if (buttons.some(b => b.buttonId === triggerId || b.id === triggerId)) {
                matchFound = true;
              }
              if (buttons.some(b => b.action === 'submit_request')) {
                hasSubmitRequestAction = true;
              }
            }
          }
          if (!matchFound) {
            return res.status(400).json({
              success: false,
              message: `Validation Error: Node '${node.id}' uses a button_click trigger but its triggerId '${triggerId}' does not match any buttonId in this flow.`,
            });
          }
        }
        
        // Also check nodes that might not be button_click triggers but have buttons
        const nodeButtons = node.buttons || (node.data && node.data.buttons);
        if (nodeButtons && Array.isArray(nodeButtons)) {
          if (nodeButtons.some(b => b.action === 'submit_request')) {
            hasSubmitRequestAction = true;
          }
        }
      }

      if (!hasSubmitRequestAction) {
        console.warn(`[Flow Publishing Warning] Flow '${updates.flowName || flow.flowName}' was saved without any 'submit_request' buttons. It will not generate booking requests on completion.`);
      }

      updates.nodes = normalizeArray(updates.nodes).map((n, i) => {
        if (!n.id) n.id = `node_${i}`;
        return n;
      });
    }

    if (updates.edges !== undefined) {
      updates.edges = normalizeArray(updates.edges);
    }

    if (updates.settings !== undefined) {
      updates.settings = normalizeObject(updates.settings);
    }

    Object.assign(flow, updates);
    flow.updatedBy = scope.currentUser._id;

    if (flow.status === 'active') {
      await deactivateOtherFlows(scope, flow._id);
    }

    await flow.save();

    res.status(200).json({
      success: true,
      message: 'Chatbot flow updated successfully',
      flow: formatFlow(flow),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/chatbot-flows/:id/activate
 * Activate one flow and deactivate all other flows in the same scope.
 */
exports.activateFlow = async (req, res, next) => {
  try {
    const scope = await getFlowScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const flow = await ChatbotFlow.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!flow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found',
      });
    }

    const inactiveResult = await ChatbotFlow.updateMany(buildScopedQuery(scope), {
      $set: {
        status: 'inactive',
        updatedBy: scope.currentUser._id,
      },
    });

    const activatedFlow = await ChatbotFlow.findOneAndUpdate(
      buildScopedQuery(scope, { _id: req.params.id }),
      {
        $set: {
          status: 'active',
          updatedBy: scope.currentUser._id,
        },
      },
      { new: true, runValidators: true }
    );

    const flows = await ChatbotFlow.find(buildScopedQuery(scope)).sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      message: 'Chat flow activated',
      flow: formatFlow(activatedFlow),
      flows: flows.map(formatFlow),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/chatbot-flows/:id
 * Delete a flow.
 */
exports.deleteFlow = async (req, res, next) => {
  try {
    const scope = await getFlowScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const flow = await ChatbotFlow.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!flow) {
      return res.status(404).json({
        success: false,
        message: 'Chatbot flow not found',
      });
    }

    await flow.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Chatbot flow deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/chatbot-flows/:flowId/nodes/:nodeId
 * Delete a specific node from a flow and its connected edges.
 */
exports.deleteNode = async (req, res) => {
    const { flowId, nodeId } = req.params;
    try {
        const numericNodeId = !isNaN(nodeId) ? Number(nodeId) : nodeId;
        const updatedFlow = await ChatbotFlow.findByIdAndUpdate(
            flowId,
            { 
                $pull: { 
                    nodes: { id: { $in: [nodeId, numericNodeId] } },
                    messages: { id: { $in: [nodeId, numericNodeId] } },
                    edges: { $or: [{ source: nodeId }, { target: nodeId }, { source: numericNodeId }, { target: numericNodeId }] } 
                } 
            },
            { new: true }
        );
        if (!updatedFlow) return res.status(404).json({ message: "Flow not found" });
        res.status(200).json(updatedFlow);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /api/chatbot-flows/:flowId/nodes
 * Add a new node to the flow, updating if it already exists.
 */
exports.addNode = async (req, res, next) => {
    try {
        const { flowId } = req.params;
        const newNode = req.body;
        
        if (!newNode.id) {
           newNode.id = `node_${Date.now()}`;
        }
        
        const scope = await getFlowScope(req.user.id);
        if (sendScopeError(res, scope)) return;

        const flow = await ChatbotFlow.findOne(buildScopedQuery(scope, { _id: flowId }));
        if (!flow) {
            return res.status(404).json({ success: false, message: 'Chatbot flow not found' });
        }
        
        const exists = flow.nodes.find(n => String(n.id) === String(newNode.id));
        
        let updatedFlow;
        if (exists) {
            updatedFlow = await ChatbotFlow.findOneAndUpdate(
                buildScopedQuery(scope, { _id: flowId, 'nodes.id': newNode.id }),
                { $set: { 'nodes.$': newNode } },
                { new: true }
            );
        } else {
            updatedFlow = await ChatbotFlow.findOneAndUpdate(
                buildScopedQuery(scope, { _id: flowId }),
                { $push: { nodes: newNode } },
                { new: true }
            );
        }

        res.status(200).json({
            success: true,
            flow: formatFlow(updatedFlow)
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/chatbot-flows/:flowId/deduplicate
 * Temporary endpoint to deduplicate nodes in a flow.
 */
exports.deduplicateNodes = async (req, res) => {
    try {
        const { flowId } = req.params;
        const flow = await ChatbotFlow.findById(flowId);
        
        if (!flow) {
            return res.status(404).json({ success: false, message: 'Chatbot flow not found' });
        }
        
        if (!flow.nodes || flow.nodes.length === 0) {
            return res.status(200).json({ success: true, message: 'No nodes to deduplicate', flow: formatFlow(flow) });
        }
        
        const uniqueNodes = Array.from(new Map(flow.nodes.map(node => [node.id, node])).values());
        const removedCount = flow.nodes.length - uniqueNodes.length;
        
        const updatedFlow = await ChatbotFlow.findByIdAndUpdate(
            flowId, 
            { $set: { nodes: uniqueNodes } },
            { new: true }
        );
        
        res.status(200).json({
            success: true,
            message: `Successfully removed ${removedCount} duplicate nodes.`,
            flow: formatFlow(updatedFlow)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
