const mongoose = require('mongoose');
const BroadcastCampaign = require('../models/BroadcastCampaign');
const broadcastCampaignController = require('../controllers/broadcastCampaignController');

const processScheduledCampaigns = async () => {
  try {
    const now = new Date();
    
    // Find due campaigns
    const dueCampaigns = await BroadcastCampaign.find({
      status: 'scheduled',
      scheduleAt: { $lte: now }
    });

    for (const campaign of dueCampaigns) {
      // Atomically update status to processing to prevent duplicate execution
      const lockedCampaign = await BroadcastCampaign.findOneAndUpdate(
        { _id: campaign._id, status: 'scheduled' },
        { $set: { status: 'processing' } },
        { new: true }
      );

      if (!lockedCampaign) {
        // Someone else already picked it up
        continue;
      }

      console.log(`\n======================================================`);
      console.log(`[Scheduler] Starting execution for scheduled campaign`);
      console.log(`======================================================`);

      try {
        // Mock Express req/res to seamlessly reuse the exact identical existing logic
        // This ensures no dependency on login, dashboard, or frontend polling.
        const mockReq = {
          user: { id: lockedCampaign.ownerId.toString() },
          params: { id: lockedCampaign._id.toString() }
        };

        let responseData = null;
        let statusCode = 200;

        const mockRes = {
          status: function(code) {
            statusCode = code;
            return this;
          },
          json: function(data) {
            responseData = data;
            return this;
          }
        };

        const mockNext = (error) => {
          throw error;
        };

        // Execution logic completely reused
        await broadcastCampaignController.sendCampaign(mockReq, mockRes, mockNext);

        // Required Logging Format
        console.log(`\n--- SCHEDULED BROADCAST EXECUTION LOG ---`);
        console.log(`Broadcast ID: ${lockedCampaign._id}`);
        console.log(`Campaign Name: ${lockedCampaign.campaignName}`);
        console.log(`Scheduled Time: ${lockedCampaign.scheduleAt}`);
        console.log(`Actual Execution Time: ${new Date()}`);
        console.log(`Recipients: ${responseData?.statistics?.totalRecipients || 0}`);
        
        const sent = responseData?.statistics?.sent || 0;
        const failed = responseData?.statistics?.failed || 0;
        console.log(`Success/Failure: ${sent} Sent, ${failed} Failed`);

        if (responseData?.errors && responseData.errors.length > 0) {
          console.log(`Meta Response (Errors):`, JSON.stringify(responseData.errors, null, 2));
        } else {
          console.log(`Meta Response: All successful.`);
        }
        console.log(`-----------------------------------------\n`);

        // If controller explicitly failed the campaign logic (e.g. no WhatsApp config)
        if (statusCode !== 200 && statusCode !== 201) {
          console.error(`[Scheduler] Campaign ${lockedCampaign._id} rejected by controller with status ${statusCode}:`, JSON.stringify(responseData));
          lockedCampaign.status = 'failed';
          lockedCampaign.failureReason = responseData ? (responseData.message || JSON.stringify(responseData)) : 'Unknown API Error';
          await lockedCampaign.save();
        }

      } catch (error) {
        console.error(`[Scheduler] Exception processing campaign ${lockedCampaign._id}:`, error);
        
        console.log(`\n--- SCHEDULED BROADCAST EXECUTION LOG ---`);
        console.log(`Broadcast ID: ${lockedCampaign._id}`);
        console.log(`Campaign Name: ${lockedCampaign.campaignName}`);
        console.log(`Scheduled Time: ${lockedCampaign.scheduleAt}`);
        console.log(`Actual Execution Time: ${new Date()}`);
        console.log(`Success/Failure: Exception Occurred`);
        console.log(`Meta Response: ${error.message}`);
        console.log(`-----------------------------------------\n`);
        
        lockedCampaign.status = 'failed';
        lockedCampaign.failureReason = error.message;
        await lockedCampaign.save();
      }
    }
  } catch (error) {
    console.error(`[Scheduler] Error in scheduler loop:`, error.message);
  }
};

const startScheduler = () => {
  // Run every 60 seconds continuously
  setInterval(processScheduledCampaigns, 60000);
  
  // Run first check shortly after server boot
  setTimeout(processScheduledCampaigns, 5000);
  
  console.log('[Scheduler] Broadcast campaign scheduler started (Polling every 1 minute).');
};

module.exports = { startScheduler };
