require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');
const emailConfig = require('./src/config/email'); // Initialize email config on startup

const PORT = process.env.PORT || 5000;

// Auto-seed test data for webhook development
const setupWebhookTestBusiness = async () => {
  try {
    const Business = require('./src/models/Business');
    const User = require('./src/models/User');
    const ChatbotFlow = require('./src/models/ChatbotFlow');
    const WhatsAppConfig = require('./src/models/WhatsAppConfig');

    const testPhoneId = '1082933148246856';
    const existingConfig = await WhatsAppConfig.findOne({ phoneNumberId: testPhoneId });

    if (!existingConfig) {
      console.log(`\n--- Seeding Test Business Data for Webhook ---`);
      
      // Find or create dummy user
      let user = await User.findOne({ email: 'webhooktest@example.com' });
      if (!user) {
        // Need to require bcrypt if User model expects hashed password or has pre-save hooks. 
        // Assuming User schema has a pre-save hook, 'password123' will be hashed.
        user = await User.create({
          firstName: 'Webhook',
          lastName: 'Test',
          email: 'webhooktest@example.com',
          password: 'password123', 
          role: 'owner',
        });
      }

      const newBusiness = await Business.create({
        ownerId: user._id,
        businessName: 'Kalki Sales and Service (Test)',
        ownerName: 'Webhook Test',
        businessCategory: 'IT Services',
        whatsappNumber: '1234567890',
        usageType: 'services'
      });

      console.log(`✓ Created test Business: ${newBusiness.businessName}`);

      const WhatsAppConfig = require('./src/models/WhatsAppConfig');
      await WhatsAppConfig.create({
        businessId: newBusiness._id,
        phoneNumberId: testPhoneId,
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN || 'your-meta-access-token-here',
        chatbotEnabled: true,
      });

      console.log(`✓ Created test WhatsAppConfig for multi-tenant isolation`);

      // Seed dummy flows to match the required test scenario
      await ChatbotFlow.create([
        {
          businessId: newBusiness._id,
          ownerId: user._id,
          flowName: 'Welcome Flow',
          status: 'active',
          triggerKeywords: ['hi', 'hello', 'hey'],
          replyText: 'Welcome to Kalki Sales and Service. Tamare su service ni jarur che?',
          buttons: [{ text: 'AC' }, { text: 'Fridge' }]
        },
        {
          businessId: newBusiness._id,
          ownerId: user._id,
          flowName: 'AC Service',
          status: 'active',
          triggerKeywords: ['ac', 'AC'],
          replyText: 'Our AC repair service starts at 500rs. When can we visit?'
        },
        {
          businessId: newBusiness._id,
          ownerId: user._id,
          flowName: 'Fridge Service',
          status: 'active',
          triggerKeywords: ['fridge', 'Fridge'],
          replyText: 'Our Fridge repair service starts at 400rs. When can we visit?'
        },
        {
          businessId: newBusiness._id,
          ownerId: user._id,
          flowName: 'Fallback Flow',
          status: 'active',
          isFallback: true,
          replyText: 'Sorry, we did not understand. Please reply with "hi" to see options.'
        }
      ]);
      console.log(`✓ Seeded dynamic ChatbotFlows (hi, ac, fridge)`);
      console.log(`----------------------------------------------\n`);
    }
  } catch (err) {
    console.error('Failed to seed webhook test data:', err.message);
  }
};

// Connect to MongoDB and then Start Server
connectDB().then(async () => {
  await setupWebhookTestBusiness();
  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV}`);
    console.log(`✓ API Health Check: http://localhost:${PORT}/api/health`);
    console.log(`${'='.repeat(50)}\n`);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`✗ Unhandled Rejection: ${err.message}`);
  process.exit(1);
});
