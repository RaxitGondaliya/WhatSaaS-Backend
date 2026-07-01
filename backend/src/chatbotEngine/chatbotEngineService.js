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

      // PRIORITY 1: New Flow Trigger (Keyword / Any / Button)
      if (triggerId) {
        flow = await ChatbotFlow.findOne({
          businessId: business._id,
          status: 'active',
          'nodes.triggerType': 'button_click',
          'nodes.triggerId': String(triggerId).trim()
        });
        if (flow) {
          matchReason = 'button_click';
        } else {
          console.log(`[DEBUG] No matching button flow found for triggerId: ${triggerId}. Halting fallback.`);
          return null;
        }
      } else {
        flow = await ChatbotFlow.findOne({
          businessId: business._id,
          status: 'active',
          triggerKeywords: { $in: [lowerText] }
        });
        if (flow) matchReason = 'keyword';

        if (!flow) {
          flow = await ChatbotFlow.findOne({
            businessId: business._id,
            status: 'active',
            triggerType: { $in: ['any', 'both'] }
          });
          if (flow) matchReason = 'any/both';
        }
      }

      if (flow && chatSession) {
        // If a new explicit trigger matches, delete the existing session to ensure a fresh start
        sessionAction = { type: 'delete' };
      }

      // PRIORITY 2: Session Continuity (If no new flow is triggered)
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
               } else {
                  sessionAction.type = 'delete';
               }
            } else {
               sessionAction.type = 'delete';
            }
          }
        }
        
        if (targetNode) {
          flow = sessionFlow;
          matchReason = 'session_continuation';
        } else {
          console.log(`[DEBUG] Session reached end of flow or invalid state. Clearing session.`);
          return { type: 'NoReply', sessionAction: sessionAction || { type: 'delete' } };
        }
      }

      // PRIORITY 3: Fallback (If no trigger and no session)
      if (!flow) {
        flow = await ChatbotFlow.findOne({
          businessId: business._id,
          status: 'active',
          isFallback: true
        });
        if (flow) matchReason = 'fallback';
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
