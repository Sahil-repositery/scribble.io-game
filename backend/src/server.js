require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const connectDB = require("./db");
const User = require("./models/User");
const GameHistory = require("./models/GameHistory");
const RoomManager = require("./roomManager");

const app = express();
app.use(cors());
app.use(express.json()); // Enable parsing JSON bodies

// Connect to MongoDB Atlas
connectDB();

const JWT_SECRET = process.env.JWT_SECRET || "skribbl_secret_key_123";

// Helper to verify JWT token
const verifyToken = (token) => {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for production compatibility
    methods: ["GET", "POST"]
  },
});

const roomManager = new RoomManager();
const socketRoomMap = {}; // Maps socket.id -> roomId

// Auth: User Registration
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, avatar } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const existingUser = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, "i") } });
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      password: hashedPassword,
      avatar: avatar || "🦊"
    });

    await user.save();

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        totalScore: user.totalScore,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon
      }
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Auth: User Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        totalScore: user.totalScore,
        gamesPlayed: user.gamesPlayed,
        gamesWon: user.gamesWon
      }
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Auth: Fetch Current User Stats
app.get("/api/auth/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Me Route Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Stats: Global Leaderboard
app.get("/api/leaderboard", async (req, res) => {
  try {
    const topUsers = await User.find()
      .sort({ totalScore: -1 })
      .limit(10)
      .select("username avatar totalScore gamesPlayed gamesWon");
    res.json(topUsers);
  } catch (error) {
    console.error("Leaderboard Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/", (req, res) => {
  res.send("Skribbl.io Clone Backend Running");
});

app.get("/rooms", (req, res) => {
  // Debug endpoint to see active rooms
  const list = Object.values(roomManager.rooms).map(r => ({
    roomId: r.roomId,
    players: r.players.length,
    phase: r.game ? r.game.phase : "LOBBY",
    isPrivate: r.isPrivate
  }));
  res.json(list);
});

io.on("connection", (socket) => {
  console.log("User Connected:", socket.id);

  // Helper to leave current room if any
  const leaveCurrentRoom = () => {
    const roomId = socketRoomMap[socket.id];
    if (roomId) {
      const room = roomManager.getRoom(roomId);
      if (room) {
        const player = room.removePlayer(socket.id);
        if (player) {
          console.log(`Player ${player.name} left room ${roomId}`);
          room.addSystemMessage(`${player.name} left the room.`);
          room.broadcastGameState(io);
        }
        roomManager.cleanupRoom(roomId);
      }
      socket.leave(roomId);
      delete socketRoomMap[socket.id];
    }
  };

  // 1. Create Room
  socket.on("create_room", async ({ playerName, avatar, isPrivate, token }) => {
    leaveCurrentRoom();

    let isRegistered = false;
    let userId = null;
    let name = playerName;
    let userAvatar = avatar;

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await User.findById(decoded.id);
        if (user) {
          isRegistered = true;
          userId = user._id.toString();
          name = user.username;
          userAvatar = user.avatar;
        }
      }
    }

    const room = roomManager.createRoom(socket.id, !!isPrivate);
    room.setIoInstance(io);
    
    const player = room.addPlayer(socket.id, name, userAvatar, true, isRegistered, userId);
    if (!player) {
      socket.emit("join_error", "Failed to join room");
      return;
    }

    socketRoomMap[socket.id] = room.roomId;
    socket.join(room.roomId);
    
    console.log(`Room Created: ${room.roomId} by host: ${name}`);
    
    socket.emit("room_joined", { roomId: room.roomId, isHost: true });
    room.addSystemMessage(`${name} joined the lobby.`);
    room.broadcastGameState(io);
  });

  // 2. Join Room (Private/Code-based)
  socket.on("join_room", async ({ roomId, playerName, avatar, token }) => {
    const currentRoomId = socketRoomMap[socket.id];
    if (currentRoomId && currentRoomId.trim().toUpperCase() === roomId.trim().toUpperCase()) {
      const room = roomManager.getRoom(roomId);
      if (room) {
        socket.emit("room_joined", { roomId: room.roomId, isHost: room.hostId === socket.id });
        room.broadcastGameState(io);
        return;
      }
    }

    leaveCurrentRoom();

    let isRegistered = false;
    let userId = null;
    let name = playerName;
    let userAvatar = avatar;

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await User.findById(decoded.id);
        if (user) {
          isRegistered = true;
          userId = user._id.toString();
          name = user.username;
          userAvatar = user.avatar;
        }
      }
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit("join_error", "Room not found");
      return;
    }

    const player = room.addPlayer(socket.id, name, userAvatar, false, isRegistered, userId);
    if (!player) {
      socket.emit("join_error", "Room is full");
      return;
    }

    socketRoomMap[socket.id] = room.roomId;
    socket.join(room.roomId);

    console.log(`Player ${name} joined room ${room.roomId}`);
    
    socket.emit("room_joined", { roomId: room.roomId, isHost: false });
    
    // Sync current drawing history with newly joined player
    if (room.canvasHistory.length > 0) {
      socket.emit("draw_undo", room.canvasHistory);
    }
    
    room.addSystemMessage(`${name} joined the lobby.`);
    room.broadcastGameState(io);
  });

  // 3. Join Public Room
  socket.on("join_public_room", async ({ playerName, avatar, token }) => {
    leaveCurrentRoom();

    let isRegistered = false;
    let userId = null;
    let name = playerName;
    let userAvatar = avatar;

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await User.findById(decoded.id);
        if (user) {
          isRegistered = true;
          userId = user._id.toString();
          name = user.username;
          userAvatar = user.avatar;
        }
      }
    }

    let room = roomManager.findRandomPublicRoom();
    let isHost = false;

    if (!room) {
      // Create a new public room if none is available
      room = roomManager.createRoom(socket.id, false);
      room.setIoInstance(io);
      isHost = true;
    }

    const player = room.addPlayer(socket.id, name, userAvatar, isHost, isRegistered, userId);
    if (!player) {
      socket.emit("join_error", "Failed to join public room");
      return;
    }

    socketRoomMap[socket.id] = room.roomId;
    socket.join(room.roomId);

    console.log(`Player ${name} joined public room ${room.roomId}`);
    
    socket.emit("room_joined", { roomId: room.roomId, isHost });
    
    if (room.canvasHistory.length > 0) {
      socket.emit("draw_undo", room.canvasHistory);
    }
    
    room.addSystemMessage(`${name} joined the lobby.`);
    room.broadcastGameState(io);
  });

  // 4. Update Room Settings
  socket.on("update_settings", ({ settings }) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;

    const room = roomManager.getRoom(roomId);
    if (room && room.hostId === socket.id) {
      room.updateSettings(settings);
      room.addSystemMessage("Lobby settings updated by host.");
      room.broadcastGameState(io);
    }
  });

  // 5. Start Game
  socket.on("start_game", () => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;

    const room = roomManager.getRoom(roomId);
    if (room && room.hostId === socket.id) {
      try {
        room.startGame();
        room.addSystemMessage("Game started! Get ready!");
        room.broadcastGameState(io);
      } catch (err) {
        socket.emit("game_error", err.message);
      }
    }
  });

  // 6. Drawer Choose Word
  socket.on("word_chosen", ({ word }) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;

    const room = roomManager.getRoom(roomId);
    if (room && room.game && room.game.drawerId === socket.id && room.game.phase === "SELECTING_WORD") {
      room.game.selectWord(word);
      room.broadcastGameState(io);
      room.addSystemMessage(`${room.players.find(p => p.socketId === socket.id).name} is drawing now!`);
    }
  });

  // 7. Chat Guess
  socket.on("guess", ({ text }) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;

    const room = roomManager.getRoom(roomId);
    if (room) {
      room.handleGuess(socket.id, text, io);
    }
  });

  // 8. General Chat Message
  socket.on("chat", ({ text }) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;

    const room = roomManager.getRoom(roomId);
    if (room) {
      room.handleChat(socket.id, text, io);
    }
  });

  // 9. Canvas Events
  socket.on("draw_start", (data) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room) {
      room.handleDrawStart(socket.id, data, io);
    }
  });

  socket.on("draw_move", (data) => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room) {
      room.handleDrawMove(socket.id, data, io);
    }
  });

  socket.on("draw_end", () => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room) {
      room.handleDrawEnd(socket.id, io);
    }
  });

  socket.on("draw_undo", () => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room) {
      room.handleUndo(socket.id, io);
    }
  });

  socket.on("canvas_clear", () => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room) {
      room.handleClear(socket.id, io);
    }
  });

  socket.on("back_to_lobby", () => {
    const roomId = socketRoomMap[socket.id];
    if (!roomId) return;
    const room = roomManager.getRoom(roomId);
    if (room && room.hostId === socket.id) {
      if (room.game) {
        room.game.destroy();
        room.game = null;
      }
      room.canvasHistory = [];
      room.chatHistory = [];
      room.addSystemMessage("Returned to lobby.");
      room.broadcastGameState(io);
    }
  });

  // 10. Disconnect
  socket.on("disconnect", () => {
    console.log("User Disconnected:", socket.id);
    leaveCurrentRoom();
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
