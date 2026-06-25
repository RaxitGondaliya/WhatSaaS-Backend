const Business = require('../models/Business');
const WhatsAppConfig = require('../models/WhatsAppConfig');
const User = require('../models/User');
const ChatbotFlow = require('../models/ChatbotFlow');

class BusinessService {
  /**
   * Find a Business and its associated WhatsAppConfig by phone_number_id.
   * Auto-creates a test business for development if not found.
   * @param {string} phoneNumberId - The Meta WhatsApp Phone Number ID.
   * @returns {Object} { business, whatsappConfig } or null
   */
  async getBusinessByPhoneId(phoneNumberId) {
    try {
      let config = await WhatsAppConfig.findOne({ phoneNumberId });
      let business = config ? await Business.findById(config.businessId) : null;

      // Auto-Create Test SaaS Client if it doesn't exist
      if (!config || !business) {
        console.log(`\n[Info] Auto-creating SaaS client for phoneNumberId: ${phoneNumberId}`);
        
        try {
          const testEmail = `testclient_${phoneNumberId}@whatsaas.local`;
          let user = await User.findOne({ email: testEmail });
          if (!user) {
            user = await User.create({
              fullName: 'WhatsApp Test Client',
              email: testEmail,
              password: 'password123',
              role: 'owner',
            });
            console.log(`✓ SaaS client created (User)`);
          }

          business = await Business.create({
            ownerId: user._id,
            businessName: 'Auto-Created Test Business',
            ownerName: 'WhatsApp Test Client',
            businessCategory: 'IT Services',
            whatsappNumber: '1234567890',
            usageType: 'services'
          });
          console.log(`✓ business created`);

          config = await WhatsAppConfig.create({
            ownerId: user._id,
            businessId: business._id,
            phoneNumberId: phoneNumberId,
            accessToken: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || 'dummy-token',
            chatbotEnabled: true,
          });
          console.log(`✓ WhatsApp config created`);

          // Seed basic dynamic flows
          await ChatbotFlow.create([
            {
              businessId: business._id,
              ownerId: user._id,
              flowName: 'Welcome Flow',
              status: 'active',
              triggerKeywords: ['hi', 'hello', 'hey'],
              replyText: 'Welcome to Kalki Sales and Service. Tamare su service ni jarur che?',
              buttons: [{ text: 'AC' }, { text: 'Fridge' }]
            },
            {
              businessId: business._id,
              ownerId: user._id,
              flowName: 'AC Service',
              status: 'active',
              triggerKeywords: ['ac', 'AC'],
              replyText: 'Our AC repair service starts at 500rs. When can we visit?'
            },
            {
              businessId: business._id,
              ownerId: user._id,
              flowName: 'Fridge Service',
              status: 'active',
              triggerKeywords: ['fridge', 'Fridge'],
              replyText: 'Our Fridge repair service starts at 400rs. When can we visit?'
            },
            {
              businessId: business._id,
              ownerId: user._id,
              flowName: 'Fallback Flow',
              status: 'active',
              isFallback: true,
              replyText: 'Sorry, we did not understand. Please reply with "hi" to see options.'
            }
          ]);
          
          console.log(`✓ chatbot flow created`);

          // Re-fetch to ensure DB integrity
          config = await WhatsAppConfig.findOne({ phoneNumberId });
          business = await Business.findById(config.businessId);

          if (!business) {
            throw new Error("Failed to re-fetch auto-created business");
          }

          console.log(`✓ webhook processing started`);
        } catch (err) {
          console.error('\n[Error] Auto-creation failed:', err);
          return null; // Gracefully fail if DB setup crashes
        }
      }

      console.log(`Loaded business successfully: ${business.businessName}`);
      return { business, whatsappConfig: config };
    } catch (error) {
      console.error('\n[Error] Error fetching business by phone ID:', error);
      return null;
    }
  }
}

module.exports = new BusinessService();
