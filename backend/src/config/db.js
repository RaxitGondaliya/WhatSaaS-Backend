const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;

    // Guard: refuse to start without MONGO_URI
    if (!mongoUri) {
      console.error('✗ MONGO_URI is not set! Refusing to start.');
      process.exit(1);
    }

    // Warn if pointing to localhost in production
    if (mongoUri.includes('localhost') || mongoUri.includes('127.0.0.1')) {
      console.warn('⚠ WARNING: MONGO_URI points to localhost!');
    }

    // Log database name from URI (mask credentials)
    const uriDbName = mongoUri.split('?')[0].split('/').pop();
    console.log(`✓ MONGO_URI database name: ${uriDbName}`);

    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      family: 4,
    });

    console.log('MongoDB connected successfully');
    console.log(`✓ Database: ${conn.connection.name} @ ${conn.connection.host}`);
    console.log(`✓ Ready State: ${conn.connection.readyState}`);

    // AUTO-FIX: Drop the corrupted username_1 index if it exists
    // The old schema had username: { unique: true, sparse: true, default: null }
    // which caused MongoDB to index explicit null values and block all new signups.
    // Dropping the index lets Mongoose recreate it correctly on next operation.
    try {
      const usersCollection = conn.connection.db.collection('users');
      const indexes = await usersCollection.indexes();
      const usernameIndex = indexes.find(idx => idx.name === 'username_1');

      if (usernameIndex) {
        console.log('⚠ Found corrupted username_1 index, dropping it...');
        await usersCollection.dropIndex('username_1');
        console.log('✓ Dropped username_1 index successfully. It will be recreated correctly.');
      } else {
        console.log('✓ No corrupted username_1 index found.');
      }
    } catch (indexError) {
      // Don't crash the server if index cleanup fails
      console.warn('⚠ Could not check/drop username index:', indexError.message);
    }

    return conn;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
