const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

// Middleware - Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global Request Logger Middleware (DEBUG: Webhook Issue)
app.use((req, res, next) => {
  console.log(`[GLOBAL LOG] ${req.method} ${req.originalUrl}`);
  next();
});

// Enable trust proxy for Render deployment (important for HTTPS/cookies)
app.set('trust proxy', 1);

// Middleware - CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : null
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g., Postman, server-to-server)
    if (!origin) return callback(null, true);

    // Remove trailing slash from incoming origin if exists for safe matching
    const cleanOrigin = origin.replace(/\/$/, '');
    
    if (allowedOrigins.includes(cleanOrigin) || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // If we're on Render and struggling with CORS, we can log it here to help debug
    console.warn(`[CORS Blocked] Origin: ${origin}`);
    // Instead of throwing an error which might crash unhandled, return false
    return callback(null, false);
  },
  credentials: true,
}));

// Health Check Route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Backend is running',
    database: mongoose.connection.name,
    host: mongoose.connection.host,
    readyState: mongoose.connection.readyState,
  });
});

// Debug Endpoint - Returns actual DB connection details
app.get('/api/debug/db', async (req, res) => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    // Count users to verify
    const userCount = await mongoose.connection.db.collection('users').countDocuments();

    res.status(200).json({
      success: true,
      database: mongoose.connection.name,
      host: mongoose.connection.host,
      readyState: mongoose.connection.readyState,
      collections: collectionNames,
      userCount: userCount,
      mongoUriDatabase: (process.env.MONGO_URI || '').split('?')[0].split('/').pop(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
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
const chatbotSettingsRoutes = require('./routes/chatbotSettingsRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const metaRoutes = require('./routes/metaRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

app.use('/api/auth', authRoutes);
app.use('/api', authRoutes); // Fallback alias for /api/signup and /api/login

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
app.use('/api/webhook', webhookRoutes);
app.use('/api/chatbot-settings', chatbotSettingsRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/upload', uploadRoutes);

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
