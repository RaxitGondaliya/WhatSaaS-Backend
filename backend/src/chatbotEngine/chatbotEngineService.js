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

         if (profileName && !sessionAction.variables.customer_name) {
             sessionAction.variables.customer_name = profileName;
         }

         const varName = currentNode.variable || currentNode.data?.variable || 'answer';

         // A) Button Reply Handling
         if (triggerId) {
            console.log("DEBUG: Looking for button with ID or text:", triggerId, messageText);
            const nodeButtons = currentNode.data?.buttons || currentNode.buttons || [];
            const clickedButton = nodeButtons.find(b => 
               String(b.buttonId || b.id) === String(triggerId).trim() || b.text === messageText
            );
            
            if (clickedButton) {
               console.log(`DEBUG: Button matched: ${clickedButton.text}`);
               console.log("Clicked Button ID:", clickedButton.buttonId || clickedButton.id);
               
               sessionAction.variables[varName] = clickedButton.text;
               
               // 5. Match using clickedButtonId === node.data.triggerId
               const nextNodeByTrigger = sessionFlow.nodes.find(n => {
                   const nTriggerId = n.triggerId || n.data?.triggerId;
                   return nTriggerId && String(nTriggerId) === String(clickedButton.buttonId || clickedButton.id);
               });

               if (nextNodeByTrigger) {
                  matchedNextNodeId = nextNodeByTrigger.id || nextNodeByTrigger._id;
                  console.log("Next Node Trigger ID:", nextNodeByTrigger.triggerId || nextNodeByTrigger.data?.triggerId);
                  isValidSessionAction = true;
               } else if (clickedButton.nextMessageId) {
                  matchedNextNodeId = clickedButton.nextMessageId;
                  isValidSessionAction = true;
               } else if (currentNode.nextMessageId) {
                  matchedNextNodeId = currentNode.nextMessageId;
                  isValidSessionAction = true;
               } else {
                  isValidSessionAction = true; // Fallback to index + 1
               }
            }
         }
         // B) Text Input Handling
         else if (isWaitingForInput) {
            console.log(`[Session Intercept] User text input captured for node: ${chatSession.currentNodeId}`);
            sessionAction.variables[varName] = messageText;
            
            if (currentNode.nextMessageId) {
               matchedNextNodeId = currentNode.nextMessageId;
               isValidSessionAction = true;
            } else {
               isValidSessionAction = true; // Fallback to index + 1
            }
         }

         // C) Proceed to Next Node if valid
         if (isValidSessionAction) {
            const currentIndex = sessionFlow.nodes.findIndex(n => String(n.id) === String(chatSession.currentNodeId));
            
            if (!matchedNextNodeId) {
                // Progression fix: currentNodeIndex + 1
                if (currentIndex >= 0 && currentIndex < sessionFlow.nodes.length - 1) {
                    matchedNextNodeId = sessionFlow.nodes[currentIndex + 1].id;
                }
            }

            if (matchedNextNodeId) {
                targetNode = sessionFlow.nodes.find(n => String(n.id) === String(matchedNextNodeId));
            }

            // G) Flow Completion Check
            if (!targetNode && matchedNextNodeId == null && currentIndex === sessionFlow.nodes.length - 1) {
                console.log("[DEBUG] Reached the end of the flow. Completing session.");
                sessionAction.type = 'complete';
                return { type: 'Complete', text: 'Tamari service request successfully submit thai gai 6e.\nAmari team tunk samay ma contact karse.', sessionAction };
            }
            
            if (targetNode) {
               sessionAction.currentNodeId = targetNode.id || targetNode._id;

               console.log("Existing Session:", chatSession);
               console.log("Current Node:", currentNode);
               console.log("Next Node:", targetNode);
               console.log("Saved Variables:", sessionAction.variables);

               const nodeText = targetNode.data?.text || targetNode.text || targetNode.data?.message || '';
               const nodeButtons = targetNode.data?.buttons || targetNode.buttons || [];

               let replyData = {
                 type: targetNode.type || 'Text',
                 text: nodeText,
                 buttons: nodeButtons
               };

               replyData.sessionAction = sessionAction;
               console.log(`[Dynamic Routing] Proceeding to next message: ${targetNode.id}`);
               return interpolate(replyData, sessionAction.variables);
            } else {
               console.error(`[Error] Target node not found. Path is broken.`);
               sessionAction.type = 'delete';
               return { type: 'Text', text: 'Something went wrong processing your request. Please try again.', sessionAction };
            }
         }

         // If we reach here, it means we have an active session but the input didn't match the expected button/text
         if (chatSession && !isValidSessionAction) {
             console.log(`[DEBUG] Invalid input for current session. Repeating current node.`);
             const nodeText = currentNode.data?.text || currentNode.text || currentNode.data?.message || '';
             const nodeButtons = currentNode.data?.buttons || currentNode.buttons || [];
             return interpolate({
                 type: currentNode.type || 'Text',
                 text: "Please provide a valid response.\n\n" + nodeText,
                 buttons: nodeButtons,
                 sessionAction: { type: 'update', variables: chatSession.variables }
             }, chatSession.variables);
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
        const cleanTrigger = String(triggerId).trim();
        flow = activeFlows.find(f => f.nodes && f.nodes.some(n => 
           n.triggerType === 'button_click' && 
           (n.triggerId === cleanTrigger || n.data?.triggerId === cleanTrigger)
        ));
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
            const cleanTrigger = String(triggerId).trim();
            targetNode = flow.nodes.find(n => 
               n.triggerType === 'button_click' && 
               (n.triggerId === cleanTrigger || n.data?.triggerId === cleanTrigger)
            );
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

            let currentNodeId = targetNode.id || targetNode._id;
            if (!currentNodeId) {
               // Generate stable unique id if frontend nodes do not contain id
               const nodeIndex = flow.nodes.findIndex(n => n === targetNode);
               currentNodeId = nodeIndex >= 0 ? `fallback_node_${nodeIndex}` : null;
            }

            if (!currentNodeId) {
               throw new Error("Flow node id missing");
            }

            console.log("Flow Nodes:", flow.nodes);
            console.log("First Node:", targetNode);
            console.log("Current Node ID:", currentNodeId);

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
                currentNodeId: currentNodeId,
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
