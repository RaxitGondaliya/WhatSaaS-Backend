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
      // Atomically update status to processing to prevent double-sends in parallel environments
      const lockedCampaign = await BroadcastCampaign.findOneAndUpdate(
        { _id: campaign._id, status: 'scheduled' },
        { $set: { status: 'processing' } },
        { new: true }
      );

      if (!lockedCampaign) {
        // Someone else already picked it up
        continue;
      }

      console.log(`\n[Scheduler] Picked up scheduled campaign: ${lockedCampaign.campaignName} (${lockedCampaign._id})`);

      try {
        // Mock Express req/res to seamlessly reuse the exact identical existing logic
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

        await broadcastCampaignController.sendCampaign(mockReq, mockRes, mockNext);

        if (statusCode !== 200 && statusCode !== 201) {
          console.error(`[Scheduler] Campaign ${lockedCampaign._id} rejected by controller with status ${statusCode}:`, JSON.stringify(responseData));
          lockedCampaign.status = 'failed';
          lockedCampaign.failureReason = responseData ? (responseData.message || JSON.stringify(responseData)) : 'Unknown API Error';
          await lockedCampaign.save();
        } else {
          console.log(`[Scheduler] Campaign ${lockedCampaign._id} processed successfully.`);
        }

      } catch (error) {
        console.error(`[Scheduler] Exception processing campaign ${lockedCampaign._id}:`, error);
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
  // Run every 60 seconds
  setInterval(processScheduledCampaigns, 60000);
  
  // Run first check after 5 seconds of boot
  setTimeout(processScheduledCampaigns, 5000);
  
  console.log('[Scheduler] Broadcast campaign scheduler started (Polling every 1 minute).');
};

module.exports = { startScheduler };
