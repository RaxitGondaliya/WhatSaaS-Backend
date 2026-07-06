require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Contact = require('./src/models/Contact');
  const result = await Contact.updateMany(
    { name: { $in: ['YES', 'NO', 'yes', 'no', 'Yes', 'No', 'CONFIRM', 'CANCEL'] } },
    { $set: { name: 'WhatsApp Customer' } }
  );
  console.log('Fixed', result.modifiedCount, 'corrupted contact(s)');
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
