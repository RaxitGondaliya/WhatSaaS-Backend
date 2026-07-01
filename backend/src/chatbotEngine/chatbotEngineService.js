const ChatbotFlow = require('../models/ChatbotFlow');

class ChatbotEngineService {
  /**
   * Process an incoming message and generate the next step in the flow.
   * @param {string} messageText - The user's input text or button reply.
   * @param {Object} business - The matched Business object.
   * @param {Object} conversation - The conversation state object.
   * @returns {Object|null} The reply object containing { text, buttons } or null
   */
  async processMessage(messageText, triggerId, business, conversation, chatSession) {
    try {
      const lowerText = messageText.trim().toLowerCase();
      let flow = null;
      let matchReason = '';
      let targetNode = null;
      let sessionAction = null;

      console.log(`Searching for flow. Message: ${messageText}`);
      const activeFlows = await ChatbotFlow.find({ businessId: business._id, status: 'active' });

      // 1. Check for Explicit Triggers (Button / Keyword)
      if (triggerId) {
        flow = activeFlows.find(f => f.nodes && f.nodes.some(n => n.triggerType === 'button_click' && n.triggerId === String(triggerId).trim()));
        if (flow) {
          matchReason = 'button_click';
        } else {
          console.log(`[DEBUG] No matching button flow found for triggerId: ${triggerId}. Halting fallback.`);
          return null;
        }
      } else {
        // Check keywords
        flow = activeFlows.find(f => f.triggerKeywords && f.triggerKeywords.some(k => k.trim().toLowerCase() === lowerText));
        if (flow) matchReason = 'keyword';
      }

      // If an explicit trigger matched, we break out of any active session
      if (flow && chatSession) {
        sessionAction = { type: 'delete' };
      }

      // 2. Session Continuity
      if (!flow && chatSession && chatSession.currentNodeId) {
        const sessionFlow = await ChatbotFlow.findById(chatSession.currentFlowId);
        if (sessionFlow && sessionFlow.nodes) {
          const currentNode = sessionFlow.nodes.find(n => String(n.id) === String(chatSession.currentNodeId));
          if (currentNode && (currentNode.type === 'Ask Question' || currentNode.variable)) {
            const varName = currentNode.variable || 'answer';
            
            sessionAction = { type: 'update', variables: { ...(chatSession.variables || {}) } };
            sessionAction.variables[varName] = messageText;

            let nextNodeId = currentNode.nextMessageId;
            if (!nextNodeId && sessionFlow.edges) {
               const edge = sessionFlow.edges.find(e => String(e.source) === String(currentNode.id));
               if (edge) nextNodeId = edge.target;
            }

            if (nextNodeId) {
               targetNode = sessionFlow.nodes.find(n => String(n.id) === String(nextNodeId));
               if (targetNode) {
                  sessionAction.currentNodeId = nextNodeId;
                  
                  let replyData = { 
                    type: targetNode.type || 'Text',
                    text: targetNode.text || '', 
                    buttons: targetNode.buttons || [] 
                  };

                  if (targetNode.type !== 'Ask Question' && !targetNode.variable) {
                    sessionAction.type = 'delete';
                  }

                  replyData.sessionAction = sessionAction;
                  console.log(`[Session Continuity] Proceeding to next node: ${targetNode.id}`);
                  return replyData;
               }
            }
          }
        }
        
        console.log(`[DEBUG] Session reached end of flow or invalid state. Clearing session.`);
        return { type: 'NoReply', sessionAction: { type: 'delete' } };
      }

      // 3. Fallback ('any', 'both', or explicit fallback)
      if (!flow) {
        flow = activeFlows.find(f => f.triggerType === 'any' || f.triggerType === 'both');
        if (flow) {
           matchReason = 'any/both';
        } else {
           flow = activeFlows.find(f => f.isFallback === true);
           if (flow) matchReason = 'fallback_explicit';
           else {
              flow = activeFlows.find(f => f.triggerType === 'any');
              if (flow) matchReason = 'fallback_any';
           }
        }
      }

      // 4. Construct the response from the found flow
      if (flow) {
        console.log(`\nMatched flow: ${flow.flowName || flow._id}`);
        console.log(`triggerType: ${flow.triggerType}`);
        console.log(`triggerKeywords: ${JSON.stringify(flow.triggerKeywords || [])}`);
        console.log(`matched flow id: ${flow._id}`);
        console.log(`reason flow matched: ${matchReason}`);
        console.log(`Generating WhatsApp reply...`);
        
        let replyData = null;
        if (flow.replyText && (!flow.nodes || flow.nodes.length === 0)) {
          replyData = {
            type: 'Text',
            text: flow.replyText,
            buttons: flow.buttons || []
          };
          if (sessionAction && sessionAction.type === 'update') sessionAction.type = 'delete';
        } else if (flow.nodes && flow.nodes.length > 0) {
          if (!targetNode) {
            if (triggerId) {
              targetNode = flow.nodes.find(n => n.triggerType === 'button_click' && n.triggerId === String(triggerId).trim());
            }
            if (!targetNode) {
              targetNode = flow.nodes.find(n => n.text || (n.buttons && n.buttons.length > 0));
            }
          }

          if (targetNode) {
            console.log(`\n[DEBUG] loaded node:`, JSON.stringify({ id: targetNode.id, type: targetNode.type, text: targetNode.text }));
            console.log(`[DEBUG] loaded buttons:`, JSON.stringify(targetNode.buttons || []));
            
            replyData = { 
              type: targetNode.type || 'Text',
              text: targetNode.text || '', 
              buttons: targetNode.buttons || [] 
            };

            // Session check for Ask Question nodes
            if (targetNode.type === 'Ask Question' || targetNode.variable) {
              if (!sessionAction || sessionAction.type === 'delete') {
                 sessionAction = { type: 'create', flowId: flow._id, currentNodeId: targetNode.id };
              }
            } else {
              if (sessionAction && sessionAction.type === 'update') {
                 sessionAction.type = 'delete'; // Completed the multi-step flow questions
              }
            }
          }
        }

        if (replyData) {
          replyData.sessionAction = sessionAction;
          console.log(`Reply generated: type="${replyData.type}", text="${(replyData.text || '').substring(0, 30)}...", buttons=${replyData.buttons.length}`);
          return replyData;
        }
      }

      return null;
    } catch (error) {
      console.error('Error fetching chatbot flow from DB:', error);
      return null;
    }
  }
}

module.exports = new ChatbotEngineService();
