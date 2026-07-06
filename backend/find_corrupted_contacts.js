const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Contact = require('./src/models/Contact');
  const Message = require('./src/models/Message');

  const corrupted = await Contact.find({
     name: { $in: ['YES', 'NO', 'yes', 'no', 'Yes', 'No'] }
  });

  console.log('Corrupted Contacts Found:', corrupted.length);
  for (const c of corrupted) {
      console.log('---');
      console.log('Contact ID:', c._id, '| Phone:', c.phone, '| Current Name:', c.name);
      
      // Attempt to recover real name from Message collection
      // Usually, the first message in the conversation from this user is their name, but since the flow asks it, 
      // it might be their second or third message. 
      // We'll just fetch all text messages they sent and list them.
      // Need to find the Conversation first. Let's try to find their conversation.
      const Conversation = require('./src/models/Conversation');
      const conv = await Conversation.findOne({ participantPhone: c.phone });
      
      if (conv) {
         const msgs = await Message.find({ conversationId: conv._id, direction: 'incoming', type: 'text' }).sort({ timestamp: 1 });
         console.log('  Incoming Messages:', msgs.map(m => m.text.body || m.content).join(' -> '));
      }
  }
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
