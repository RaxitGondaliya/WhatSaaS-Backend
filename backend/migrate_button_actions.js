const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const ChatbotFlow = require('./src/models/ChatbotFlow');
  let updatedCount = 0;
  
  // Find all flows
  const flows = await ChatbotFlow.find({});
  
  for (const flow of flows) {
     let changed = false;
     
     if (flow.nodes && Array.isArray(flow.nodes)) {
       for (const node of flow.nodes) {
          const buttons = node.buttons || (node.data && node.data.buttons) || [];
          
          for (const btn of buttons) {
             // You can change this condition to match specific button text 
             // that represents your booking confirmation (e.g. "YES", "CONFIRM").
             if (btn.text && btn.text.toUpperCase().trim() === 'YES') {
                if (btn.action !== 'submit_request') {
                   btn.action = 'submit_request';
                   changed = true;
                   console.log(`Updated button '${btn.text}' in node '${node.id}' of flow '${flow.flowName}' to have action: submit_request`);
                }
             }
          }
       }
     }
     
     if (changed) {
        flow.markModified('nodes');
        await flow.save();
        updatedCount++;
     }
  }
  
  console.log(`\nData migration completed. Flows updated: ${updatedCount}`);
  console.log(`If you need to update other buttons manually, you can edit this script's text matching logic (line 17), or just use the UI's 'Button Action' dropdown.`);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
