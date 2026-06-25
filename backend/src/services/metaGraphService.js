const axios = require('axios');

class MetaGraphService {
  constructor() {
    this.baseUrl = 'https://graph.facebook.com/v22.0';
  }

  /**
   * Exchanges a short-lived access token for a long-lived one.
   * @param {string} shortLivedToken 
   * @returns {string|null} Long-lived token or null
   */
  async getLongLivedToken(shortLivedToken) {
    try {
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;

      if (!appId || !appSecret) {
        console.warn('[MetaGraphService] Missing META_APP_ID or META_APP_SECRET. Using short-lived token as fallback.');
        return shortLivedToken; // Fallback if missing credentials
      }

      const response = await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLivedToken,
        },
      });

      return response.data.access_token;
    } catch (error) {
      console.error('[MetaGraphService] Error exchanging token:', error.response?.data || error.message);
      return shortLivedToken; // Fallback to provided token on failure
    }
  }

  /**
   * Fetches the user's WhatsApp Business Accounts (WABAs) and their phone numbers.
   * In a real Embedded Signup flow, you often get a code that exchanges for an access token,
   * then query the user's businesses.
   * @param {string} accessToken 
   */
  async getWhatsAppBusinessDetails(accessToken) {
    try {
      // 1. Get the user's connected businesses
      const meResponse = await axios.get(`${this.baseUrl}/me/businesses`, {
        params: { access_token: accessToken }
      });

      const businesses = meResponse.data.data;
      if (!businesses || businesses.length === 0) {
        return null;
      }

      // For simplicity, we grab the first business manager they granted access to
      const businessManagerId = businesses[0].id;

      // 2. Get the WhatsApp Business Accounts (WABAs) linked to this business manager
      const wabaResponse = await axios.get(`${this.baseUrl}/${businessManagerId}/owned_whatsapp_business_accounts`, {
        params: { access_token: accessToken }
      });

      const wabas = wabaResponse.data.data;
      if (!wabas || wabas.length === 0) {
        return null;
      }

      const wabaId = wabas[0].id;

      // 3. Get the phone numbers linked to this WABA
      const phoneResponse = await axios.get(`${this.baseUrl}/${wabaId}/phone_numbers`, {
        params: { access_token: accessToken }
      });

      const phones = phoneResponse.data.data;
      if (!phones || phones.length === 0) {
        return null;
      }

      const phoneNumber = phones[0]; // Take the first phone number

      return {
        wabaId: wabaId,
        phoneNumberId: phoneNumber.id,
        displayPhoneNumber: phoneNumber.display_phone_number,
        metaAccountId: businessManagerId
      };

    } catch (error) {
      console.error('[MetaGraphService] Error fetching WABA details:', error.response?.data || error.message);
      return null;
    }
  }
}

module.exports = new MetaGraphService();
