const ChatbotFlow = require('../models/ChatbotFlow');

class ChatbotEngineService {
  async processMessage(messageText, triggerId, business, conversation, chatSession, profileName = '') {
    try {
      console.log("DEBUG: Processing message from:", conversation?.phoneNumber || 'Unknown', "Body:", messageText, "Business:", business._id);

      const cleanText = messageText.trim().toLowerCase();
      let flow = null;
      let matchReason = '';
      let targetNode = null;
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
               // We will signal whatsappService to delete old session and start fresh
               chatSession = null;
            }
         }
      }

      const activeFlows = await ChatbotFlow.find({ businessId: business._id, status: 'active' });

      // We will perform Global Keyword matching ONLY if there's no active session
      let globalKeywordFlow = null;

      // 1. Session & Input Node Check (Dynamic)
      let isWaitingForInput = false;
      let sessionFlow = null;
      let currentNode = null;

      if (chatSession && chatSession.currentNodeId) {
        sessionFlow = await ChatbotFlow.findById(chatSession.currentFlowId);
        if (sessionFlow && sessionFlow.nodes) {
          // IMPORTANT: Fallback ids to ensure missing db ids map properly
          let nodeMap = {};
          sessionFlow.nodes.forEach((n, i) => { 
             if (!n.id) n.id = `fallback_node_${i}`; 
             nodeMap[n.id] = n;
          });
          
          currentNode = nodeMap[chatSession.currentNodeId];
          const hasButtons = (currentNode?.data?.buttons || currentNode?.buttons || []).length > 0;
          const isTextNode = currentNode?.type === 'Text' || currentNode?.type === 'Input' || currentNode?.type === 'Ask Question' || currentNode?.is_ask_question || currentNode?.variable || currentNode?.data?.variable;
          
          if (hasButtons) {
             isWaitingForInput = 'button';
          } else if (isTextNode) {
             isWaitingForInput = 'text';
          }
          
          console.log(`[DEBUG] Active Node Type: ${currentNode?.type || 'Unknown'}`);
          console.log(`[DEBUG] Validation Mode: ${isWaitingForInput}`);
          console.log(`[DEBUG] Free Text Allowed: ${isWaitingForInput === 'text'}`);
          console.log(`[DEBUG] Button Validation Enabled: ${isWaitingForInput === 'button'}`);
        }
      }

      // Helper function for dynamic variable interpolation {{variable}}
      const interpolate = (data, vars) => {
         const sessionVars = vars || {};
          const replaceVars = (str) => {
             if (!str) return str;
             return str.replace(/\{{1,2}([^}]+)\}{1,2}/g, (match, key) => {
                let k = key.trim();
                if (k === 'previous_button') {
                   k = '__previous_button_selection';
                   console.log(`[DEBUG] Interpolated Previous Button: ${sessionVars[k] || '""'}`);
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

      // 2. Dynamic Routing (Button Click or Text Input in Active Session)
      if (chatSession && currentNode) {
         console.log("Loaded Existing Session:", chatSession);
         console.log("Current Node ID:", chatSession.currentNodeId);
         console.log("Current Node:", currentNode);
         let matchedNextNodeId = null;
         let isValidSessionAction = false;
         
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

         const currentIndex = sessionFlow.nodes.findIndex(n => String(n.id) === String(chatSession.currentNodeId));

         // 11. CUSTOMER NAME FIX: Priority -> profileName -> session -> empty string
         const actualCustomerName = profileName || chatSession.variables?.customer_name || '';
         sessionAction.variables.customer_name = actualCustomerName;

         let varName = currentNode.variable || currentNode.data?.variable || chatSession.targetVariable || 'answer';
         
         const upperText = messageText.toUpperCase().trim();
         // Removed the explicit YES/NO/AC/FRIDGE hardcode to fully support DB-driven routing

         // A) Button Reply Handling
         if (triggerId || (isWaitingForInput === 'button')) {
            console.log("DEBUG: Looking for button with ID or text:", triggerId, messageText);
            const nodeButtons = currentNode.data?.buttons || currentNode.buttons || [];
            
             const { resolveButtonClickRoute } = require('./buttonRouting');
             
             let clickedButton = null;
             
             if (triggerId) {
                const routeResult = resolveButtonClickRoute(triggerId, currentNode, sessionFlow, business._id);
                if (routeResult) {
                   clickedButton = routeResult.matchedButton;
                   matchedNextNodeId = routeResult.targetNodeId;
                   isValidSessionAction = !!matchedNextNodeId;
                   console.log(`[DEBUG] Button Route Resolved via: ${routeResult.routeType} to target ${matchedNextNodeId}`);
                }
             }
             
             // If triggerId didn't match anything, or we only had text and it was waiting for a button
             if (!clickedButton && !matchedNextNodeId) {
                // Fallback to text matching for buttons (legacy behavior for when user types the button text)
                clickedButton = nodeButtons.find(b => b.text === messageText);
                if (clickedButton) {
                   if (clickedButton.nextMessageId && String(clickedButton.nextMessageId).trim() !== '') {
                      matchedNextNodeId = clickedButton.nextMessageId;
                   } else if (currentNode.nextMessageId && String(currentNode.nextMessageId).trim() !== '') {
                      matchedNextNodeId = currentNode.nextMessageId;
                   } else {
                      // Legacy sequential fallback ONLY for text-typed buttons (to not break old logic if any)
                      isValidSessionAction = true;
                   }
                   if (matchedNextNodeId) isValidSessionAction = true;
                }
             }
             
             if (clickedButton) {
                console.log(`DEBUG: Button matched: ${clickedButton.text}`);
                
                // Safe merge variables
                sessionAction.variables = { 
                   ...sessionAction.variables, 
                   [varName]: clickedButton.text,
                   __previous_button_selection: clickedButton.text 
                };
                console.log(`[DEBUG] Previous Button Selection Saved: ${clickedButton.text}`);
                
                if (clickedButton.action === 'submit_request') {
                   sessionAction.type = 'complete';
                   isValidSessionAction = true;
                } else if (clickedButton.action === 'cancel_request') {
                   sessionAction.type = 'cancel';
                   isValidSessionAction = true;
                }

                console.log(`[DEBUG] Clicked Button: ${clickedButton.text}`);
                console.log(`[DEBUG] Button nextMessageId: ${matchedNextNodeId || 'None'}`);
            } else if (isWaitingForInput === 'button') {
               // Prevent invalid input when waiting for button
               return interpolate({
                  type: 'Text',
                  text: 'Please select a valid option from the buttons above.',
                  sessionAction: { type: 'update', variables: chatSession.variables }
               }, chatSession.variables);
            }
         }
         // B) Text Input Handling
         else if ((isWaitingForInput === 'text' || isWaitingForInput === true) && messageText.trim() !== '') {
            console.log(`[Session Intercept] User text input captured for node: ${chatSession.currentNodeId}`);
            
            const saveVar = currentNode.variable || currentNode.data?.variable || chatSession.targetVariable || 'answer';
            
            // Safe merge variables
            sessionAction.variables = { ...sessionAction.variables, [saveVar]: messageText };
            
            if (currentNode.nextMessageId) {
               matchedNextNodeId = currentNode.nextMessageId;
               isValidSessionAction = true;
            } else {
               isValidSessionAction = true; // Fallback to index + 1
            }
         }

         // C) Proceed to Next Node if valid
         if (isValidSessionAction) {
            
            if (!matchedNextNodeId) {
                // Progression fix: currentNodeIndex + 1
                if (currentIndex >= 0 && currentIndex < sessionFlow.nodes.length - 1) {
                    matchedNextNodeId = sessionFlow.nodes[currentIndex + 1].id;
                }
            }

            if (matchedNextNodeId) {
                targetNode = sessionFlow.nodes.find(n => String(n.id) === String(matchedNextNodeId));
            }

            // End node support
            if (targetNode && targetNode.type === 'end') {
                console.log("[DEBUG] Reached an explicit 'end' node.");
                if (sessionAction.type !== 'complete' && sessionAction.type !== 'cancel') {
                   sessionAction.type = 'cancel'; // Default to cancel to just end session cleanly
                }
                const nodeText = targetNode.data?.text || targetNode.text || targetNode.data?.message || '';
                return interpolate({ type: 'Complete', text: nodeText, sessionAction }, sessionAction.variables);
            }

            // G) Flow Completion Check
            if (!targetNode && matchedNextNodeId == null && currentIndex === sessionFlow.nodes.length - 1) {
                console.log("[DEBUG] Reached the end of the flow sequentially.");
                if (sessionAction.type !== 'complete' && sessionAction.type !== 'cancel') {
                   sessionAction.type = 'cancel'; // Default to cancel for sequential completion to prevent auto-request creation
                }
                return { type: 'NoReply', sessionAction };
            }
            
             if (targetNode) {
                sessionAction.currentNodeId = targetNode.id || targetNode._id;
                sessionAction.targetVariable = targetNode.variable || targetNode.data?.variable || 'answer';

                console.log("Next Node:", targetNode);
               console.log("Saved Variables:", sessionAction.variables);

               const nodeText = targetNode.data?.text || targetNode.text || targetNode.data?.message || '';
               const nodeButtons = targetNode.data?.buttons || targetNode.buttons || [];
               
               const hasNextButtons = nodeButtons.length > 0;
               const isNextTextNode = targetNode.type === 'Text' || targetNode.type === 'Input' || targetNode.type === 'Ask Question' || targetNode.is_ask_question || targetNode.variable || targetNode.data?.variable;
               
               if (hasNextButtons) {
                  sessionAction.waitingFor = 'button';
               } else if (isNextTextNode) {
                  sessionAction.waitingFor = 'text';
               } else {
                  sessionAction.waitingFor = '';
               }

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
      if (!triggerId) {
        globalKeywordFlow = activeFlows.find(f => {
           const isKeyword = String(f.triggerType).toLowerCase() === 'keywords' || String(f.triggerType).toLowerCase() === 'both';
           return isKeyword && (f.triggerKeywords || []).map(k => k.toLowerCase().trim()).includes(cleanText);
        });
      }
      
      if (globalKeywordFlow) {
        flow = globalKeywordFlow;
        matchReason = 'keyword';
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
            const isAsk = targetNode.type === 'Ask Question' || targetNode.is_ask_question || targetNode.data?.is_ask_question || targetNode.variable || targetNode.data?.variable || (targetNode.type === 'Text' && !hasButtons);
            if (isAsk || hasButtons) {
              sessionAction = {
                type: 'create',
                flowId: flow._id,
                currentNodeId: currentNodeId,
                waitingFor: hasButtons ? 'button' : 'text',
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
