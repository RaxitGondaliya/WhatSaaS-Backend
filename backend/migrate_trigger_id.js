const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const ChatbotFlow = require('./src/models/ChatbotFlow');
  let updatedCount = 0;
  
  // Find flows that contain a button_click node
  const flows = await ChatbotFlow.find({
     $or: [
        { 'nodes.triggerType': 'button_click' },
        { 'nodes.data.triggerType': 'button_click' }
     ]
  });
  
  for (const flow of flows) {
     let changed = false;
     for (const node of flow.nodes) {
        const isTrigger = node.triggerType === 'button_click' || (node.data && node.data.triggerType === 'button_click');
        if (isTrigger) {
           const triggerId = node.triggerId || (node.data && node.data.triggerId);
           // Find parent button
           let parentButton = null;
           for (const searchNode of flow.nodes) {
              const buttons = searchNode.buttons || (searchNode.data && searchNode.data.buttons) || [];
              const btn = buttons.find(b => b.id === triggerId || b.buttonId === triggerId);
              if (btn) {
                 parentButton = btn;
                 break;
              }
           }
           
           if (parentButton && parentButton.buttonId && parentButton.buttonId !== triggerId) {
              // Fix the triggerId to be buttonId
              if (node.triggerId === triggerId) {
                 node.triggerId = parentButton.buttonId;
              }
              if (node.data && node.data.triggerId === triggerId) {
                 node.data.triggerId = parentButton.buttonId;
              }
              changed = true;
              console.log('Fixed triggerId in node', node.id, 'from', triggerId, 'to', parentButton.buttonId);
           }
        }
     }
     if (changed) {
        flow.markModified('nodes');
        await flow.save();
        updatedCount++;
     }
  }
  console.log('Data fix completed. Flows updated:', updatedCount);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
