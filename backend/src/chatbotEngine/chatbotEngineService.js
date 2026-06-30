const ChatbotFlow = require('../models/ChatbotFlow');

class ChatbotEngineService {
  /**
   * Process an incoming message and generate the next step in the flow.
   * @param {string} messageText - The user's input text or button reply.
   * @param {Object} business - The matched Business object.
   * @param {Object} conversation - The conversation state object.
   * @returns {Object|null} The reply object containing { text, buttons } or null
   */
  async processMessage(messageText, business, conversation) {
    try {
      const lowerText = messageText.trim().toLowerCase();

      // 1. Prioritize keyword matching to allow users to jump flows at any time
      let flow = await ChatbotFlow.findOne({
        businessId: business._id,
        status: 'active',
        triggerKeywords: { $in: [lowerText] }
      });

      // 2. If no keyword match, check if we need to progress the current flow state.
      // (For this version, keyword/button ID matching handles progression seamlessly).

      // 3. Fallback logic if no dynamic flow matches
      if (!flow) {
        flow = await ChatbotFlow.findOne({
          businessId: business._id,
          status: 'active',
          isFallback: true
        });
      }

      // 4. Construct the response from the found flow
      if (flow) {
        console.log(`Flow loaded: ${flow.flowName || (flow.isFallback ? 'Fallback Flow' : 'Dynamic Flow')}`);
        
        let replyData = null;
        if (flow.replyText) {
          replyData = {
            type: 'Text',
            text: flow.replyText,
            buttons: flow.buttons || []
          };
        } else if (flow.nodes && flow.nodes.length > 0) {
          for (const node of flow.nodes) {
            if (node.text || (node.buttons && node.buttons.length > 0)) {
              console.log(`\n[DEBUG] loaded node:`, JSON.stringify({ id: node.id, type: node.type, text: node.text }));
              console.log(`[DEBUG] loaded buttons:`, JSON.stringify(node.buttons || []));
              
              replyData = { 
                type: node.type || 'Text',
                text: node.text || '', 
                buttons: node.buttons || [] 
              };
              break;
            }
          }
        }

        if (replyData) {
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
