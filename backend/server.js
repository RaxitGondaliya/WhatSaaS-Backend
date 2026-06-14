require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');
const emailConfig = require('./src/config/email'); // Initialize email config on startup

const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Start Server
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV}`);
  console.log(`✓ API Health Check: http://localhost:${PORT}/api/health`);
  console.log(`${'='.repeat(50)}\n`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`✗ Unhandled Rejection: ${err.message}`);
  process.exit(1);
});
