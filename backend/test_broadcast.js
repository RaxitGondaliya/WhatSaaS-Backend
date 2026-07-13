require('dotenv').config();
const mongoose = require('mongoose');
const BroadcastCampaign = require('./src/models/BroadcastCampaign');
const Contact = require('./src/models/Contact');
const WhatsAppConfig = require('./src/models/WhatsAppConfig');
const User = require('./src/models/User');
const broadcastCampaignController = require('./src/controllers/broadcastCampaignController');

async function runTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const campaigns = await BroadcastCampaign.find({}).sort({ createdAt: -1 }).limit(5);
  console.log('Recent campaigns:', campaigns.map(c => ({ id: c._id, name: c.campaignName, status: c.status })));
  
  if (campaigns.length > 0) {
    const campaign = campaigns[0];
    console.log(`Testing with campaign ${campaign._id}`);
    
    // We need to set it to draft to allow sending again if it was sent/cancelled
    campaign.status = 'draft';
    await campaign.save();
    
    const mockReq = {
      user: { id: campaign.ownerId.toString() },
      params: { id: campaign._id.toString() }
    };
    
    const mockRes = {
      status: (code) => {
        console.log('Status set to:', code);
        return {
          json: (data) => console.log('Response JSON:', JSON.stringify(data, null, 2))
        };
      }
    };
    
    const mockNext = (err) => console.error('Next called with error:', err);
    
    await broadcastCampaignController.sendCampaign(mockReq, mockRes, mockNext);
  } else {
    console.log("No campaigns found to test.");
  }

  process.exit(0);
}

runTest();
