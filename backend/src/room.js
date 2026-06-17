const Player = require("./player");
const Game = require("./game");
const User = require("./models/User");
const GameHistory = require("./models/GameHistory");

class Room {
  constructor(roomId, hostId, isPrivate = false) {
    this.roomId = roomId;
    this.hostId = hostId;
    this.isPrivate = isPrivate;
    this.players = []; // Array of Player instances
    this.canvasHistory = []; // Array of stroke objects for late-joining and undo support
    this.chatHistory = []; // General and guessing chat history
    this.game = null; // Active Game instance

    this.settings = {
      maxPlayers: 10,
      rounds: 3,
      drawTime: 60,
      wordCount: 3,
      hintsCount: 2,
      wordMode: "normal", // normal, hidden, combination
    };

    // Keep track of the active stroke being received
    this.activeStrokes = {}; // Maps socket.id -> stroke object
  }

  addPlayer(socketId, name, avatar, isHost = false, isRegistered = false, userId = null) {
    // Check if room is full
    if (this.players.length >= this.settings.maxPlayers) {
      return null;
    }

    const player = new Player(socketId, name, avatar, isHost);
    player.isRegistered = isRegistered;
    player.userId = userId;
    this.players.push(player);
    return player;
  }

  removePlayer(socketId) {
    const playerIndex = this.players.findIndex(p => p.socketId === socketId);
    if (playerIndex === -1) return null;

    const removedPlayer = this.players[playerIndex];
    this.players.splice(playerIndex, 1);

    // If host leaves, assign a new host
    if (removedPlayer.isHost && this.players.length > 0) {
      this.players[0].isHost = true;
      this.hostId = this.players[0].socketId;
    }

    // Handle mid-game disconnects
    if (this.game) {
      const activePlayersCount = this.players.filter(p => p.socketId).length;
      if (activePlayersCount < 2) {
        // Stop game if not enough players
        this.game.destroy();
        this.game = null;
      } else if (this.game.drawerId === socketId) {
        // If drawer leaves, advance turn
        this.game.nextTurn();
      }
    }

    return removedPlayer;
  }

  updateSettings(newSettings) {
    this.settings = {
      ...this.settings,
      ...newSettings,
    };
  }

  startGame() {
    if (this.players.length < 2) {
      throw new Error("Need at least 2 players to start!");
    }

    // Reset all player total scores to 0
    this.players.forEach(p => {
      p.score = 0;
      p.resetRoundState();
    });

    this.canvasHistory = [];
    this.chatHistory = [];

    this.game = new Game(
      this.players,
      this.settings,
      () => this.broadcastGameState(),
      () => this.onRoundEnd(),
      () => this.onGameOver()
    );
    this.game.start();
  }

  onRoundEnd() {
    this.canvasHistory = []; // Clear canvas for next round
    this.broadcast("canvas_clear");
    this.broadcastGameState();
    
    // Broadcast system message about the correct word
    this.addSystemMessage(`Round over! The word was: "${this.game.currentWord.toUpperCase()}"`);
  }

  async saveGameResults() {
    try {
      if (this.players.length === 0) return;

      const sorted = [...this.players].sort((a, b) => b.score - a.score);
      const winner = sorted[0];

      // Save GameHistory to MongoDB
      const history = new GameHistory({
        roomId: this.roomId,
        settings: {
          rounds: this.settings.rounds,
          drawTime: this.settings.drawTime
        },
        players: this.players.map(p => ({
          name: p.name,
          avatar: p.avatar,
          score: p.score,
          isHost: p.isHost,
          isRegistered: p.isRegistered
        })),
        winner: winner ? { name: winner.name, score: winner.score } : null
      });
      await history.save();
      console.log(`Game history saved for room: ${this.roomId}`);

      // Update registered users lifetime stats
      for (const player of this.players) {
        if (player.isRegistered && player.userId) {
          const isWinner = winner && (player.name === winner.name || (player.score === winner.score && winner.score > 0));
          
          await User.findByIdAndUpdate(player.userId, {
            $inc: {
              gamesPlayed: 1,
              totalScore: player.score,
              gamesWon: isWinner ? 1 : 0
            }
          });
          console.log(`Stats updated for registered user: ${player.name}`);
        }
      }
    } catch (err) {
      console.error("Error saving game results to database:", err);
    }
  }

  onGameOver() {
    this.broadcastGameState();
    
    // Sort players to find the winner
    const sorted = [...this.players].sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    
    this.addSystemMessage(`Game over! ${winner ? winner.name : "No one"} wins with ${winner ? winner.score : 0} points!`);
    
    // Save to Database
    this.saveGameResults();
  }

  handleGuess(socketId, text, io) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return;

    if (!this.game || this.game.phase !== "DRAWING") {
      this.handleChat(socketId, text, io);
      return;
    }

    // Check guess
    const result = this.game.handleGuess(socketId, text);

    if (result.isCorrect) {
      // Add custom green system message
      const msg = {
        id: Math.random().toString(36).substring(7),
        type: "correct",
        sender: "System",
        text: `${player.name} guessed the word! (+${result.score} pts)`,
        timestamp: Date.now(),
      };
      this.chatHistory.push(msg);
      
      // Send correct guess notification to socket
      io.to(this.roomId).emit("chat_message", msg);
      
      // Let the player who guessed know they got it
      io.to(socketId).emit("guess_result", { correct: true, points: result.score });
      
      // Force update of state to reflect scoring changes
      this.broadcastGameState(io);
    } else {
      if (result.isClose) {
        // Send a private tip to the guesser that they are close
        io.to(socketId).emit("chat_message", {
          id: Math.random().toString(36).substring(7),
          type: "close",
          sender: "System",
          text: `"${text}" is very close!`,
          timestamp: Date.now(),
        });
      }
      
      // Normal chat guess (visible to others)
      this.handleChat(socketId, text, io);
    }
  }

  handleChat(socketId, text, io) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return;

    // Normal chat message
    const msg = {
      id: Math.random().toString(36).substring(7),
      type: "user",
      senderId: socketId,
      sender: player.name,
      senderAvatar: player.avatar,
      text: text,
      timestamp: Date.now(),
    };
    this.chatHistory.push(msg);
    io.to(this.roomId).emit("chat_message", msg);
  }

  addSystemMessage(text) {
    const msg = {
      id: Math.random().toString(36).substring(7),
      type: "system",
      sender: "System",
      text: text,
      timestamp: Date.now(),
    };
    this.chatHistory.push(msg);
    this.ioInstance && this.ioInstance.to(this.roomId).emit("chat_message", msg);
  }

  setIoInstance(io) {
    this.ioInstance = io;
  }

  // Drawing canvas methods
  handleDrawStart(socketId, data, io) {
    if (!this.game || this.game.phase !== "DRAWING" || this.game.drawerId !== socketId) return;

    const stroke = {
      color: data.color || "#000000",
      size: data.size || 5,
      isEraser: !!data.isEraser,
      points: [{ x: data.x, y: data.y }]
    };
    this.activeStrokes[socketId] = stroke;

    // Broadcast stroke start to others
    io.to(this.roomId).emit("draw_start", {
      socketId,
      color: stroke.color,
      size: stroke.size,
      isEraser: stroke.isEraser,
      x: data.x,
      y: data.y
    });
  }

  handleDrawMove(socketId, data, io) {
    if (!this.game || this.game.phase !== "DRAWING" || this.game.drawerId !== socketId) return;

    const stroke = this.activeStrokes[socketId];
    if (!stroke) return;

    stroke.points.push({ x: data.x, y: data.y });

    // Broadcast movement to others
    io.to(this.roomId).emit("draw_move", {
      socketId,
      x: data.x,
      y: data.y
    });
  }

  handleDrawEnd(socketId, io) {
    if (!this.game || this.game.phase !== "DRAWING" || this.game.drawerId !== socketId) return;

    const stroke = this.activeStrokes[socketId];
    if (stroke) {
      this.canvasHistory.push(stroke);
      delete this.activeStrokes[socketId];
    }

    // Broadcast completion to others
    io.to(this.roomId).emit("draw_end", { socketId });
  }

  handleUndo(socketId, io) {
    if (!this.game || this.game.phase !== "DRAWING" || this.game.drawerId !== socketId) return;

    if (this.canvasHistory.length > 0) {
      this.canvasHistory.pop();
      // Broadcast whole canvas redrawing commands or sync event
      io.to(this.roomId).emit("draw_undo", this.canvasHistory);
    }
  }

  handleClear(socketId, io) {
    if (!this.game || this.game.phase !== "DRAWING" || this.game.drawerId !== socketId) return;

    this.canvasHistory = [];
    io.to(this.roomId).emit("canvas_clear");
  }

  broadcastGameState(io = this.ioInstance) {
    if (!io) return;

    // Send drawer-specific data privately to drawer, masked to others
    this.players.forEach(player => {
      if (!player.socketId) return;

      const isDrawer = this.game && this.game.drawerId === player.socketId;
      const statePayload = this.game ? this.game.getState(!isDrawer) : null;

      io.to(player.socketId).emit("game_state", {
        roomId: this.roomId,
        settings: this.settings,
        isPrivate: this.isPrivate,
        hostId: this.hostId,
        players: this.players.map(p => p.toJSON()),
        game: statePayload,
        chatHistory: this.chatHistory,
      });
    });
  }

  broadcast(event, payload, io = this.ioInstance) {
    if (!io) return;
    io.to(this.roomId).emit(event, payload);
  }
}

module.exports = Room;
