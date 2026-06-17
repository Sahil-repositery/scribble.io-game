const mongoose = require("mongoose");

const gameHistorySchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  settings: {
    rounds: { type: Number },
    drawTime: { type: Number }
  },
  players: [
    {
      name: { type: String, required: true },
      avatar: { type: String },
      score: { type: Number, required: true },
      isHost: { type: Boolean, default: false },
      isRegistered: { type: Boolean, default: false }
    }
  ],
  winner: {
    name: { type: String },
    score: { type: Number }
  }
});

module.exports = mongoose.model("GameHistory", gameHistorySchema);
