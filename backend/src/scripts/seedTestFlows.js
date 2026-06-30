/**
 * Dev-only seed script — Creates test business + chatbot flows with proper node-graph format.
 *
 * Usage: node src/scripts/seedTestFlows.js
 *
 * This is NOT run automatically on server start.
 * Run manually when you need test data for webhook development.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

async function seed() {
  await connectDB();

  const User = require('../models/User');
  const Business = require('../models/Business');
  const WhatsAppConfig = require('../models/WhatsAppConfig');
  const ChatbotFlow = require('../models/ChatbotFlow');

  const testPhoneId = process.env.PHONE_NUMBER_ID || '1082933148246856';
  const testToken = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || 'your-token-here';

  console.log('\n══════════════════════════════════════════');
  console.log('  SEEDING TEST DATA (Node-Graph Format)');
  console.log('══════════════════════════════════════════');
  console.log(`  Phone Number ID: ${testPhoneId}`);

  try {
    // Check if already seeded
    const existingConfig = await WhatsAppConfig.findOne({ phoneNumberId: testPhoneId });
    if (existingConfig) {
      console.log('\n  ⚠ WhatsAppConfig already exists for this phoneNumberId.');
      console.log('  Skipping seed. Delete existing data first if you want to re-seed.');
      console.log('══════════════════════════════════════════\n');
      process.exit(0);
    }

    // 1. Create test user
    let user = await User.findOne({ email: 'webhooktest@example.com' });
    if (!user) {
      user = await User.create({
        firstName: 'Webhook',
        lastName: 'Test',
        email: 'webhooktest@example.com',
        password: 'password123',
        role: 'owner',
      });
      console.log('  ✓ User created');
    } else {
      console.log('  ✓ User exists');
    }

    // 2. Create business
    const business = await Business.create({
      ownerId: user._id,
      businessName: 'Kalki Sales and Service',
      ownerName: 'Webhook Test',
      businessCategory: 'IT Services',
      whatsappNumber: '1234567890',
      usageType: 'services',
    });
    console.log(`  ✓ Business created: ${business.businessName}`);

    // 3. Create WhatsApp config
    await WhatsAppConfig.create({
      ownerId: user._id,
      businessId: business._id,
      phoneNumberId: testPhoneId,
      accessToken: testToken,
      chatbotEnabled: true,
    });
    console.log('  ✓ WhatsAppConfig created');

    // 4. Create flow: Welcome Flow (with Button Message node)
    // This is the main flow — triggered by "hi", "hello", "hey"
    // Contains a Button Message that links to sub-messages
    await ChatbotFlow.create({
      businessId: business._id,
      ownerId: user._id,
      flowName: 'Welcome Flow',
      status: 'active',
      triggerKeywords: ['hi', 'hello', 'hey'],
      triggerType: 'keywords',
      nodes: [
        {
          id: 1001,
          type: 'Button Message',
          text: 'Welcome to Kalki Sales and Service! 🙏\n\nHow can we help you today?',
          buttons: [
            { id: 2001, text: 'AC Service', nextMessageId: 1002 },
            { id: 2002, text: 'Fridge Service', nextMessageId: 1003 },
          ],
        },
        {
          id: 1002,
          type: 'Text',
          text: '❄ AC Repair & Service\n\nOur AC repair starts at ₹500.\nWe service all brands — Window, Split, Inverter.\n\nPlease share your address and preferred time, we will schedule a visit.',
        },
        {
          id: 1003,
          type: 'Text',
          text: '🧊 Fridge Repair & Service\n\nOur Fridge repair starts at ₹400.\nWe handle all types — Single Door, Double Door, Side-by-Side.\n\nPlease share your address and preferred time, we will schedule a visit.',
        },
      ],
      edges: [],
    });
    console.log('  ✓ Welcome Flow created (Button Message → AC/Fridge text nodes)');

    // 5. Create fallback flow
    await ChatbotFlow.create({
      businessId: business._id,
      ownerId: user._id,
      flowName: 'Fallback Flow',
      status: 'active',
      triggerType: 'any',
      triggerKeywords: [],
      nodes: [
        {
          id: 3001,
          type: 'Text',
          text: 'Sorry, we didn\'t understand your message. 🤔\n\nPlease reply with "hi" to see our services.',
        },
      ],
      edges: [],
    });
    console.log('  ✓ Fallback Flow created');

    console.log('\n  ✅ All test data seeded successfully!');
    console.log('  Send "Hi" to your WhatsApp number to test.');
    console.log('══════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n  ✗ Seed failed:', err.message);
    console.error(err);
  }

  process.exit(0);
}

seed();
