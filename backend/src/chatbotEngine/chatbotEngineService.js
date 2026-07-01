const ChatbotFlow = require('../models/ChatbotFlow');

class ChatbotEngineService {
  async processMessage(messageText, triggerId, business, conversation, chatSession) {
    try {
      console.log("DEBUG: Processing message from:", conversation?.phoneNumber || 'Unknown', "Body:", messageText, "Business:", business._id);

      const cleanText = messageText.trim().toLowerCase();
      let flow = null;
      let matchReason = '';
      let targetNode = null;
      let sessionAction = null;

      const activeFlows = await ChatbotFlow.find({ businessId: business._id, status: 'active' });

      // Check if the user explicitly typed a global trigger keyword (this overrides active sessions)
      let globalKeywordFlow = null;
      if (!triggerId) {
        globalKeywordFlow = activeFlows.find(f => {
           const isKeyword = String(f.triggerType).toLowerCase() === 'keywords' || String(f.triggerType).toLowerCase() === 'both';
           return isKeyword && (f.triggerKeywords || []).map(k => k.toLowerCase().trim()).includes(cleanText);
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

      // 2. Dynamic Routing (Button Click or Text Input in Active Session)
      if (chatSession && currentNode && !globalKeywordFlow) {
         let matchedNextNodeId = null;
         let isValidSessionAction = false;
         
         sessionAction = {
            type: 'update',
            variables: { ...(chatSession.variables || {}) }
         };

         // A) Button Reply Handling
         if (triggerId) {
            console.log("DEBUG: Looking for button with ID:", triggerId);
            const nodeButtons = currentNode.data?.buttons || currentNode.buttons || [];
            const clickedButton = nodeButtons.find(b => String(b.id) === String(triggerId).trim());
            
            if (clickedButton && clickedButton.nextMessageId) {
               console.log("DEBUG: Button matched. Next node:", clickedButton.nextMessageId);
               matchedNextNodeId = clickedButton.nextMessageId;
               isValidSessionAction = true;
            } else if (currentNode.nextMessageId) {
               console.log("DEBUG: Button has no nextMessageId. Using node's default transition.");
               matchedNextNodeId = currentNode.nextMessageId;
               isValidSessionAction = true;
            }
         }
         // B) Text Input Handling
         else if (isWaitingForInput) {
            console.log(`[Session Intercept] User text input captured for node: ${chatSession.currentNodeId}`);
            const varName = currentNode.variable || currentNode.data?.variable || 'answer';
            sessionAction.variables[varName] = messageText;
            
            if (currentNode.nextMessageId) {
               matchedNextNodeId = currentNode.nextMessageId;
               isValidSessionAction = true;
            }
         }

         // C) Proceed to Next Node if valid
         if (isValidSessionAction && matchedNextNodeId) {
            targetNode = sessionFlow.nodes.find(n => String(n.id) === String(matchedNextNodeId));
            
            if (targetNode) {
               sessionAction.currentNodeId = matchedNextNodeId;

               console.log("DEBUG: Loading node content:", targetNode.data?.text || targetNode.text);
               const nodeText = targetNode.data?.text || targetNode.text || targetNode.data?.message || '';
               const nodeButtons = targetNode.data?.buttons || targetNode.buttons || [];

               let replyData = {
                 type: targetNode.type || 'Text',
                 text: nodeText,
                 buttons: nodeButtons
               };

               const hasButtons = nodeButtons.length > 0;
               const isAsk = targetNode.type === 'Ask Question' || targetNode.is_ask_question || targetNode.data?.is_ask_question || targetNode.variable || targetNode.data?.variable;
               if (!(isAsk || hasButtons)) {
                 sessionAction.type = 'delete';
               }

               replyData.sessionAction = sessionAction;
               console.log(`[Dynamic Routing] Proceeding to next message: ${targetNode.id}`);
               return interpolate(replyData, sessionAction.variables);
            } else {
               console.error(`[Error] Target node ${matchedNextNodeId} not found. Path is broken.`);
               sessionAction.type = 'delete';
               return { type: 'Text', text: 'Something went wrong processing your request. Please try again.', sessionAction };
            }
         }

         // If it's a random message in a non-input node, let it fall through to New Flow Routing.
         // Otherwise, if it was an invalid button or input without a path, end the session.
         if (triggerId || isWaitingForInput) {
            console.log(`[DEBUG] Flow ended or invalid state. Clearing session.`);
            return { type: 'NoReply', sessionAction: { type: 'delete' } };
         }
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
        flow = activeFlows.find(f => f.nodes && f.nodes.some(n => n.triggerType === 'button_click' && n.triggerId === String(triggerId).trim()));
        if (flow) {
          matchReason = 'button_click';
        } else {
          console.log(`[DEBUG] No matching flow for button ID: ${triggerId}.`);
          return null;
        }
      }

      if (!flow && !triggerId) {
        flow = activeFlows.find(f => String(f.triggerType).toLowerCase() === 'any' || String(f.triggerType).toLowerCase() === 'both');
        if (flow) {
          matchReason = 'any/both';
        } else {
          flow = activeFlows.find(f => f.isFallback === true);
          if (flow) matchReason = 'fallback_explicit';
        }
      }

      if (!flow) {
         console.log("DEBUG: No flow found for business:", business._id, "and keyword:", messageText);
      }

      // 4. Construct the initial response from the flow
      if (flow) {
        console.log(`\nMatched flow: ${flow.flowName || flow._id} by ${matchReason}`);
        console.log("DEBUG: Flow keywords in DB:", flow.triggerKeywords);
        
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
             // START NODE SELECTION
             // The start node is the node that has NO incoming edges (no edge where edge.target === node.id).
             if (flow.edges && flow.edges.length > 0) {
                const targetIds = new Set(flow.edges.map(e => String(e.target)));
                targetNode = flow.nodes.find(n => !targetIds.has(String(n.id)));
             }
             // Fallback if no edges or manual list: just pick the first node
             if (!targetNode) {
                targetNode = flow.nodes[0];
             }
          }

          if (targetNode) {
            console.log("DEBUG: Loading node content:", targetNode.data?.text || targetNode.text);
            const nodeText = targetNode.data?.text || targetNode.text || targetNode.data?.message || '';
            const nodeButtons = targetNode.data?.buttons || targetNode.buttons || [];

            replyData = {
              type: targetNode.type || 'Text',
              text: nodeText,
              buttons: nodeButtons
            };

            const hasButtons = nodeButtons.length > 0;
            // Initiate session if the node needs user input or button response
            const isAsk = targetNode.type === 'Ask Question' || targetNode.is_ask_question || targetNode.data?.is_ask_question || targetNode.variable || targetNode.data?.variable;
            if (isAsk || hasButtons) {
              sessionAction = {
                type: 'create',
                flowId: flow._id,
                currentNodeId: targetNode.id,
                isWaitingForInput: Boolean(isAsk),
                targetVariable: targetNode.variable || targetNode.data?.variable || 'answer',
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
