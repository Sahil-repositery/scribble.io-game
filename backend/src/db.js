const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const connString = process.env.MONGODB_URI;
    if (!connString) {
      console.error("MONGODB_URI environment variable is missing in .env");
      process.exit(1);
    }
    
    // Connect to MongoDB
    await mongoose.connect(connString);
    console.log("MongoDB Connected Successfully!");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
