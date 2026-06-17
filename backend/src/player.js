class Player {
  constructor(socketId, name, avatar = "🐱", isHost = false) {
    this.socketId = socketId;
    this.name = name;
    this.avatar = avatar;
    this.score = 0;
    this.isHost = isHost;
    this.isReady = false;
    this.hasGuessed = false;
    this.lastGuessTime = 0;
    this.scoreGainedThisRound = 0;
    this.isRegistered = false;
    this.userId = null;
  }

  resetRoundState() {
    this.hasGuessed = false;
    this.lastGuessTime = 0;
    this.scoreGainedThisRound = 0;
  }

  addScore(points) {
    this.score += points;
    this.scoreGainedThisRound = points;
  }

  toJSON() {
    return {
      socketId: this.socketId,
      name: this.name,
      avatar: this.avatar,
      score: this.score,
      isHost: this.isHost,
      isReady: this.isReady,
      hasGuessed: this.hasGuessed,
      scoreGainedThisRound: this.scoreGainedThisRound,
      isRegistered: this.isRegistered,
      userId: this.userId
    };
  }
}

module.exports = Player;
