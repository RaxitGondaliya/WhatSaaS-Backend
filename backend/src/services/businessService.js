const Business = require('../models/Business');
const WhatsAppConfig = require('../models/WhatsAppConfig');

class BusinessService {
  /**
   * Find a Business and its associated WhatsAppConfig by phone_number_id.
   * @param {string} phoneNumberId - The Meta WhatsApp Phone Number ID.
   * @returns {Object} { business, whatsappConfig } or null
   */
  async getBusinessByPhoneId(phoneNumberId) {
    try {
      const config = await WhatsAppConfig.findOne({ phoneNumberId });
      if (!config) return null;

      const business = await Business.findById(config.businessId);
      if (!business) return null;

      return { business, whatsappConfig: config };
    } catch (error) {
      console.error('Error fetching business by phone ID:', error);
      return null;
    }
  }
}

module.exports = new BusinessService();
