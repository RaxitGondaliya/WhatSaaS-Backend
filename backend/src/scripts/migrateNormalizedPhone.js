require('dotenv').config({ path: '../../.env' }); // Adjust path based on execution location
const mongoose = require('mongoose');
const Contact = require('../models/Contact');
const { normalizePhone } = require('../utils/phoneUtils');

const migrate = async () => {
  try {
    // Depending on where this is run from, might need to adjust ENV variables.
    // If running from src/scripts: process.env.MONGODB_URI should be available if .env is at root
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot';
    await mongoose.connect(uri);
    console.log('Connected to DB');

    // Find all active contacts, sorted by oldest first
    const contacts = await Contact.find({ isDeleted: false }).sort({ createdAt: 1 });
    console.log(`Found ${contacts.length} active contacts`);

    let updatedCount = 0;
    let softDeletedCount = 0;

    // Track uniqueness per scope
    const seen = new Set();

    for (const contact of contacts) {
      const normalizedPhone = normalizePhone(contact.phone);
      const businessIdStr = contact.businessId ? contact.businessId.toString() : 'null';
      const ownerIdStr = contact.ownerId.toString();
      
      const scopeKey = `${ownerIdStr}_${businessIdStr}_${normalizedPhone}`;

      if (seen.has(scopeKey)) {
        contact.isDeleted = true;
        contact.status = 'inactive';
        contact.notes = (contact.notes ? contact.notes + '\n' : '') + '[System]: Soft-deleted due to duplicate normalized phone number.';
        await contact.save();
        softDeletedCount++;
        console.log(`Soft deleted duplicate contact ID: ${contact._id} (${contact.phone})`);
      } else {
        seen.add(scopeKey);
        contact.normalizedPhone = normalizedPhone;
        await contact.save();
        updatedCount++;
      }
    }

    console.log(`Migration complete. Updated: ${updatedCount}, Soft-deleted duplicates: ${softDeletedCount}`);
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};

migrate();
