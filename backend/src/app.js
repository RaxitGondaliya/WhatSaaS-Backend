const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware - Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware - CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'development' ? '*' : process.env.FRONTEND_URL,
  credentials: true,
}));

// Health Check Route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Backend is running',
    database: 'chatbot_saas',
  });
});

// Routes
const authRoutes = require('./routes/authRoutes');
const businessRoutes = require('./routes/businessRoutes');
const teamRoutes = require('./routes/teamRoutes');
const contactRoutes = require('./routes/contactRoutes');
const requestRoutes = require('./routes/requestRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const chatbotFlowRoutes = require('./routes/chatbotFlowRoutes');
const broadcastCampaignRoutes = require('./routes/broadcastCampaignRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/team-members', teamRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chatbot-flows', chatbotFlowRoutes);
app.use('/api/broadcast-campaigns', broadcastCampaignRoutes);
app.use('/webhook', webhookRoutes);

// 404 - Not Found Middleware
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
  });
});

// Error Handling Middleware (must be last)
const errorMiddleware = require('./middleware/errorMiddleware');
app.use(errorMiddleware);

module.exports = app;
