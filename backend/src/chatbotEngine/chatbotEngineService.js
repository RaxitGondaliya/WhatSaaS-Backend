const ChatbotFlow = require('../models/ChatbotFlow');
const { normalizeFlow, findButton, resolveNextNodeId } = require('./nodeNormalizer');

class ChatbotEngineService {
  async processMessage(messageText, triggerId, business, conversation, chatSession, profileName = '') {
    try {
      console.log("DEBUG: Processing message from:", conversation?.phoneNumber || 'Unknown', "Body:", messageText, "Business:", business._id);

      const cleanText = messageText.trim().toLowerCase();
      let sessionAction = null;

      // 0. Global Control Keywords Intercept
      const globalCommands = ['stop', 'cancel', 'restart', 'menu', 'hi', 'hii'];
      if (globalCommands.includes(cleanText)) {
         if (['stop', 'cancel'].includes(cleanText)) {
            console.log(`[Global Command] ${cleanText} triggered. Cancelling session.`);
            return {
               type: 'Text',
               text: 'Conversation cancelled.',
               sessionAction: chatSession ? { type: 'delete' } : null
            };
         } else if (['restart', 'menu', 'hi', 'hii'].includes(cleanText)) {
            console.log(`[Global Command] ${cleanText} triggered. Restarting flow.`);
            if (chatSession) {
               chatSession = null;
            }
         }
      }

      const activeFlows = await ChatbotFlow.find({ businessId: business._id, status: 'active' });

      // Helper function for dynamic variable interpolation {{variable}}
      const interpolate = (data, vars) => {
         const sessionVars = vars || {};
          const replaceVars = (str) => {
             if (!str) return str;
             return str.replace(/\{{1,2}([^}]+)\}{1,2}/g, (match, key) => {
                let k = key.trim();
                if (k === 'previous_button') {
                   k = '__previous_button_selection';
                }
                return sessionVars[k] !== undefined ? sessionVars[k] : '';
             });
          };
         
         if (data.text) data.text = replaceVars(data.text);
         if (data.caption) data.caption = replaceVars(data.caption);
         if (data.buttons && Array.isArray(data.buttons)) {
            data.buttons = data.buttons.map(b => ({ ...b, text: replaceVars(b.text) }));
         }
         return data;
      };

      // =========================================================
      // 1. ACTIVE SESSION HANDLING
      // =========================================================
      if (chatSession && chatSession.currentNodeId) {
        const sessionFlow = await ChatbotFlow.findById(chatSession.currentFlowId);
        if (!sessionFlow || !sessionFlow.nodes) {
          return { type: 'Text', text: 'Something went wrong. Please try again.', sessionAction: { type: 'delete' } };
        }

        // Normalize the entire flow once
        const { nodes, nodeMap } = normalizeFlow(sessionFlow);
        const currentNode = nodeMap[chatSession.currentNodeId];

        if (!currentNode) {
          console.error(`[Error] Current node ${chatSession.currentNodeId} not found in flow.`);
          return { type: 'Text', text: 'Something went wrong. Please try again.', sessionAction: { type: 'delete' } };
        }

        console.log(`[Session] Active session on node: ${currentNode.id} (type: ${currentNode.type}, waitingFor: ${currentNode.waitingFor})`);

        // Step count guard against infinite loops
        const stepCount = (chatSession.stepCount || 0) + 1;
        if (stepCount > 50) {
          console.error(`[Error] Infinite loop detected for session ${chatSession._id}. Terminating.`);
          return { type: 'Text', text: 'Conversation ended due to unexpected loop.', sessionAction: { type: 'delete' } };
        }

        sessionAction = {
          type: 'update',
          variables: { ...(chatSession.variables || {}) },
          stepCount
        };

        let clickedButton = null;
        let nextNodeId = null;
        let isValid = false;

        // A) BUTTON CLICK HANDLING
        if (currentNode.waitingFor === 'button') {
          clickedButton = findButton(currentNode, triggerId, messageText);

          if (clickedButton) {
            console.log(`[Session] Button matched: "${clickedButton.text}" (buttonId: ${clickedButton.buttonId})`);
            
            // Store the button selection
            const varName = currentNode.variable || `button_selection_${currentNode.id}`;
            const prevSelections = Array.isArray(sessionAction.variables.__button_selections) 
               ? sessionAction.variables.__button_selections : [];

            sessionAction.variables[varName] = clickedButton.text;
            sessionAction.variables.__previous_button_selection = clickedButton.text;
            sessionAction.variables.__button_selections = [...prevSelections, clickedButton.text];

            // Check for special actions
            if (clickedButton.action === 'submit_request') {
              sessionAction.type = 'complete';
            } else if (clickedButton.action === 'cancel_request') {
              sessionAction.type = 'cancel';
            }

            // Resolve next node
            nextNodeId = resolveNextNodeId(currentNode, clickedButton, nodes);
            isValid = true;
          } else {
            // Invalid button input — resend current node with error
            console.log(`[Session] Invalid input for button node. Resending.`);
            const rawButtons = currentNode.raw?.data?.buttons || currentNode.raw?.buttons || currentNode.buttons;
            return interpolate({
              type: 'Text',
              text: 'Please select a valid option from the buttons above.',
              buttons: rawButtons,
              sessionAction: { type: 'update', variables: chatSession.variables }
            }, chatSession.variables);
          }
        }
        // B) TEXT INPUT HANDLING
        else if (currentNode.waitingFor === 'text' && messageText.trim() !== '') {
          console.log(`[Session] Text input captured for node: ${currentNode.id}`);
          
          const varName = currentNode.variable || `text_input_${currentNode.id}`;
          sessionAction.variables[varName] = messageText;

          nextNodeId = resolveNextNodeId(currentNode, null, nodes);
          isValid = true;
        }
        // C) Unexpected state — node doesn't expect input
        else {
          // Auto-advance if node doesn't wait for input (e.g., display-only text node)
          nextNodeId = resolveNextNodeId(currentNode, null, nodes);
          if (nextNodeId) {
            isValid = true;
          }
        }

        // D) NAVIGATE TO NEXT NODE
        if (isValid) {
          // Check for flow completion (special actions)
          if (sessionAction.type === 'complete' || sessionAction.type === 'cancel') {
            const targetNode = nextNodeId ? nodeMap[nextNodeId] : null;
            const completeText = targetNode ? (targetNode.text || '') : '';
            return interpolate({ 
              type: 'Complete', 
              text: completeText, 
              sessionAction 
            }, sessionAction.variables);
          }

          if (!nextNodeId) {
            // End of flow (no more nodes)
            console.log("[Session] Reached end of flow.");
            sessionAction.type = 'cancel';
            return { type: 'NoReply', sessionAction };
          }

          const targetNode = nodeMap[nextNodeId];
          if (!targetNode) {
            console.error(`[Error] Target node ${nextNodeId} not found. Broken path.`);
            sessionAction.type = 'delete';
            return { type: 'Text', text: 'Something went wrong processing your request. Please try again.', sessionAction };
          }

          // Handle end nodes
          if (targetNode.type === 'end') {
            console.log("[Session] Reached explicit 'end' node.");
            if (sessionAction.type !== 'complete' && sessionAction.type !== 'cancel') {
              sessionAction.type = 'cancel';
            }
            return interpolate({ type: 'Complete', text: targetNode.text || '', sessionAction }, sessionAction.variables);
          }

          // Update session to point to next node
          sessionAction.currentNodeId = targetNode.id;
          sessionAction.targetVariable = targetNode.variable || 'answer';
          sessionAction.waitingFor = targetNode.waitingFor || '';

          console.log(`[Session] → Next node: ${targetNode.id} (type: ${targetNode.type}, waitingFor: ${targetNode.waitingFor})`);

          // Build reply from the raw node data (so WhatsApp gets original button format)
          const rawTarget = targetNode.raw || {};
          const rawData = rawTarget.data || rawTarget;
          const replyButtons = rawData.buttons || rawTarget.buttons || [];
          
          const replyData = {
            type: rawTarget.type || rawData.type || targetNode.type || 'Text',
            text: targetNode.text,
            caption: targetNode.caption || rawTarget.caption || rawData.caption,
            imageUrl: targetNode.imageUrl || rawTarget.imageUrl || rawData.imageUrl,
            buttons: replyButtons,
            sessionAction
          };

          return interpolate(replyData, sessionAction.variables);
        }

        // Fallback: invalid input that wasn't caught above
        if (!isValid) {
          console.log(`[Session] Unhandled input. Repeating current node.`);
          const rawButtons = currentNode.raw?.data?.buttons || currentNode.raw?.buttons || [];
          return interpolate({
            type: currentNode.raw?.type || currentNode.raw?.data?.type || 'Text',
            text: "Please provide a valid response.\n\n" + currentNode.text,
            buttons: rawButtons,
            sessionAction: { type: 'update', variables: chatSession.variables }
          }, chatSession.variables);
        }
      }

      // =========================================================
      // 2. NEW FLOW MATCHING (No active session)
      // =========================================================
      let flow = null;
      let matchReason = '';

      // 2a. Keyword matching
      if (!triggerId) {
        flow = activeFlows.find(f => {
          const isKeyword = ['keywords', 'keyword', 'both'].includes(String(f.triggerType).toLowerCase());
          return isKeyword && (f.triggerKeywords || []).map(k => k.toLowerCase().trim()).includes(cleanText);
        });
        if (flow) matchReason = 'keyword';
      }

      // 2b. Button click trigger (cross-flow)
      if (!flow && triggerId) {
        const cleanTrigger = String(triggerId).trim();
        flow = activeFlows.find(f => f.nodes && f.nodes.some(n => {
          const tt = n.triggerType || (n.data && n.data.triggerType);
          const ti = n.triggerId || (n.data && n.data.triggerId);
          return tt === 'button_click' && String(ti).trim() === cleanTrigger;
        }));
        if (flow) {
          matchReason = 'button_click';
        } else {
          console.log(`[DEBUG] No matching flow for button ID: ${triggerId}.`);
          return null;
        }
      }

      // 2c. "Any" or "both" trigger type
      if (!flow && !triggerId) {
        flow = activeFlows.find(f => ['any', 'both'].includes(String(f.triggerType).toLowerCase()));
        if (flow) {
          matchReason = 'any/both';
        } else {
          flow = activeFlows.find(f => f.isFallback === true);
          if (flow) matchReason = 'fallback_explicit';
        }
      }

      if (!flow) {
        console.log("DEBUG: No flow found for business:", business._id, "and keyword:", messageText);
        return null;
      }

      // =========================================================
      // 3. START FLOW
      // =========================================================
      console.log(`\nMatched flow: ${flow.flowName || flow._id} by ${matchReason}`);

      // Handle flows with no node structures (simple reply-text flows)
      if (flow.replyText && (!flow.nodes || flow.nodes.length === 0)) {
        return interpolate({
          type: 'Text',
          text: flow.replyText,
          buttons: flow.buttons || [],
          sessionAction: chatSession ? { type: 'delete' } : null
        }, {});
      }

      if (!flow.nodes || flow.nodes.length === 0) {
        return null;
      }

      // Normalize the flow
      const { nodes, nodeMap, startNodeId } = normalizeFlow(flow);
      
      // Find the target node (start node, or triggered node)
      let targetNode = null;

      if (triggerId) {
        const cleanTrigger = String(triggerId).trim();
        targetNode = nodes.find(n => {
          const raw = n.raw || {};
          const rawData = raw.data || {};
          const tt = rawData.triggerType || raw.triggerType;
          const ti = rawData.triggerId || raw.triggerId;
          return tt === 'button_click' && String(ti).trim() === cleanTrigger;
        });
      }

      if (!targetNode && startNodeId) {
        targetNode = nodeMap[startNodeId];
      }

      if (!targetNode) {
        console.error("[Error] Could not find start node for flow:", flow._id);
        return null;
      }

      console.log(`[Flow Start] Starting at node: ${targetNode.id} (type: ${targetNode.type})`);

      // Build the initial reply
      const rawTarget = targetNode.raw || {};
      const rawData = rawTarget.data || rawTarget;
      const replyButtons = rawData.buttons || rawTarget.buttons || [];

      const replyData = {
        type: rawTarget.type || rawData.type || targetNode.type || 'Text',
        text: targetNode.text,
        caption: targetNode.caption || rawTarget.caption || rawData.caption,
        imageUrl: targetNode.imageUrl || rawTarget.imageUrl || rawData.imageUrl,
        buttons: replyButtons
      };

      // Create session if this node expects input
      if (targetNode.waitingFor || replyButtons.length > 0) {
        sessionAction = {
          type: 'create',
          flowId: flow._id,
          currentNodeId: targetNode.id,
          waitingFor: targetNode.waitingFor || (replyButtons.length > 0 ? 'button' : 'text'),
          targetVariable: targetNode.variable || 'answer',
          variables: chatSession ? chatSession.variables : {}
        };
      }

      replyData.sessionAction = sessionAction;
      return interpolate(replyData, sessionAction && sessionAction.variables ? sessionAction.variables : (chatSession ? chatSession.variables : {}));

    } catch (error) {
      console.error('Error in chatbot engine:', error);
      return null;
    }
  }
}

module.exports = new ChatbotEngineService();
