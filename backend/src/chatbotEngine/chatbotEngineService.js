const ChatbotFlow = require('../models/ChatbotFlow');

class ChatbotEngineService {
  async processMessage(messageText, triggerId, business, conversation, chatSession) {
    try {
      console.log("DEBUG: Processing message from:", conversation?.phoneNumber || 'Unknown', "Body:", messageText, "Business:", business._id);

      const lowerText = messageText.trim().toLowerCase();
      let flow = null;
      let matchReason = '';
      let targetNode = null;
      let sessionAction = null;

      // Check if the user explicitly typed a global trigger keyword (this overrides active sessions)
      let globalKeywordFlow = null;
      if (!triggerId) {
        globalKeywordFlow = await ChatbotFlow.findOne({ 
           businessId: business._id, 
           status: 'active', 
           triggerKeywords: { $in: [lowerText] } 
        });
      }

      // 1. Session & Input Node Check (Dynamic)
      let isWaitingForInput = false;
      let sessionFlow = null;
      let currentNode = null;

      if (chatSession && chatSession.currentNodeId) {
        sessionFlow = await ChatbotFlow.findById(chatSession.currentFlowId);
        if (sessionFlow && sessionFlow.nodes) {
          currentNode = sessionFlow.nodes.find(n => String(n.id) === String(chatSession.currentNodeId));
          if (currentNode && (currentNode.type === 'Ask Question' || currentNode.is_ask_question || currentNode.variable)) {
            isWaitingForInput = true;
          }
        }
      }

      // Helper function for dynamic variable interpolation {{variable}}
      const interpolate = (data, vars) => {
         const sessionVars = vars || {};
         const replaceVars = (str) => {
            if (!str) return str;
            return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
               const k = key.trim();
               return sessionVars[k] !== undefined ? sessionVars[k] : match;
            });
         };
         
         if (data.text) data.text = replaceVars(data.text);
         if (data.caption) data.caption = replaceVars(data.caption);
         if (data.buttons && Array.isArray(data.buttons)) {
            data.buttons = data.buttons.map(b => ({ ...b, text: replaceVars(b.text) }));
         }
         return data;
      };

      // 2. Text Input Capture (Manual List Flow)
      if (chatSession && isWaitingForInput && !globalKeywordFlow && !triggerId) {
        console.log(`[Session Intercept] User is in an active session waiting for input on node: ${chatSession.currentNodeId}`);
        const varName = currentNode.variable || 'answer';

        sessionAction = {
          type: 'update',
          variables: { ...(chatSession.variables || {}) }
        };
        sessionAction.variables[varName] = messageText;

        // Manual List routing strictly uses nextMessageId
        const nextNodeId = currentNode.nextMessageId;

        if (nextNodeId) {
          targetNode = sessionFlow.nodes.find(n => String(n.id) === String(nextNodeId));
          if (targetNode) {
            sessionAction.currentNodeId = nextNodeId;

            let replyData = {
              type: targetNode.type || 'Text',
              text: targetNode.text || '',
              buttons: targetNode.buttons || []
            };

            const hasButtons = targetNode.buttons && targetNode.buttons.length > 0;
            if (!(targetNode.type === 'Ask Question' || targetNode.is_ask_question || targetNode.variable || hasButtons)) {
              sessionAction.type = 'delete';
            }

            replyData.sessionAction = sessionAction;
            console.log(`[Session Continuity] Proceeding to next message: ${targetNode.id}`);
            return interpolate(replyData, sessionAction.variables);
          }
        }

        console.log(`[DEBUG] Flow ended or invalid state. Clearing session.`);
        return { type: 'NoReply', sessionAction: { type: 'delete' } };
      }

      // 3. New Flow Routing (Keywords or Buttons)
      
      // If there's a global keyword override, it takes absolute precedence
      if (globalKeywordFlow) {
        flow = globalKeywordFlow;
        matchReason = 'keyword';
        // Force clear any active session because a global trigger was hit
        if (chatSession) {
           sessionAction = { type: 'delete' };
           console.log(`[DEBUG] Global trigger found for "${messageText}". Clearing existing session.`);
        }
      } else if (triggerId) {
        flow = await ChatbotFlow.findOne({
           businessId: business._id,
           status: 'active',
           'nodes.triggerType': 'button_click',
           'nodes.triggerId': String(triggerId).trim()
        });
        if (flow) {
          matchReason = 'button_click';
        } else {
          console.log(`[DEBUG] No matching flow for button ID: ${triggerId}.`);
          return null;
        }
      }

      if (!flow) {
        flow = await ChatbotFlow.findOne({ businessId: business._id, status: 'active', triggerType: { $in: ['any', 'both'] } });
        if (flow) {
          matchReason = 'any/both';
        } else {
          flow = await ChatbotFlow.findOne({ businessId: business._id, status: 'active', isFallback: true });
          if (flow) matchReason = 'fallback_explicit';
          else {
            flow = await ChatbotFlow.findOne({ businessId: business._id, status: 'active', triggerType: 'any' });
            if (flow) matchReason = 'fallback_any';
          }
        }
      }

      if (!flow) {
         console.log("DEBUG: No flow found for business:", business._id, "and keyword:", messageText);
      }

      // 4. Construct the initial response from the flow
      if (flow) {
        console.log(`\nMatched flow: ${flow.flowName || flow._id} by ${matchReason}`);
        
        let replyData = null;
        
        // Handle flows with no node structures
        if (flow.replyText && (!flow.nodes || flow.nodes.length === 0)) {
          replyData = {
            type: 'Text',
            text: flow.replyText,
            buttons: flow.buttons || []
          };
          if (sessionAction && sessionAction.type === 'update') sessionAction.type = 'delete';
        } else if (flow.nodes && flow.nodes.length > 0) {
          
          if (triggerId) {
            targetNode = flow.nodes.find(n => n.triggerType === 'button_click' && n.triggerId === String(triggerId).trim());
          }
          if (!targetNode) {
             // Default to the first message in the list
            targetNode = flow.nodes.find(n => n.text || (n.buttons && n.buttons.length > 0));
          }

          if (targetNode) {
            replyData = {
              type: targetNode.type || 'Text',
              text: targetNode.text || '',
              buttons: targetNode.buttons || []
            };

            const hasButtons = targetNode.buttons && targetNode.buttons.length > 0;
            // Initiate session if the node needs user input or button response
            if (targetNode.type === 'Ask Question' || targetNode.is_ask_question || targetNode.variable || hasButtons) {
              sessionAction = {
                type: 'create',
                flowId: flow._id,
                currentNodeId: targetNode.id,
                isWaitingForInput: Boolean(targetNode.is_ask_question || targetNode.variable),
                targetVariable: targetNode.variable || 'answer',
                variables: chatSession ? chatSession.variables : {}
              };
            }
          }
        }

        if (replyData) {
          replyData.sessionAction = sessionAction;
          return interpolate(replyData, sessionAction && sessionAction.variables ? sessionAction.variables : (chatSession ? chatSession.variables : {}));
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
