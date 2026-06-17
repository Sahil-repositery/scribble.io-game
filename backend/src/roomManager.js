const Room = require("./room");

class RoomManager {
  constructor() {
    this.rooms = {};
  }

  generateRoomCode() {
    let code;
    do {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (this.rooms[code]);
    return code;
  }

  createRoom(hostId, isPrivate = false) {
    const roomId = this.generateRoomCode();
    const room = new Room(roomId, hostId, isPrivate);
    this.rooms[roomId] = room;
    return room;
  }

  getRoom(roomId) {
    if (!roomId) return null;
    const cleanId = roomId.trim().toUpperCase();
    return this.rooms[cleanId] || null;
  }

  findRandomPublicRoom() {
    // Find an open room that:
    // - Is not private
    // - Is not currently playing a game (game === null or phase === 'LOBBY')
    // - Has space for at least 1 more player
    const availableRooms = Object.values(this.rooms).filter(room => {
      return (
        !room.isPrivate &&
        (!room.game || room.game.phase === "LOBBY") &&
        room.players.length < room.settings.maxPlayers
      );
    });

    if (availableRooms.length === 0) return null;
    
    // Return a random available room
    return availableRooms[Math.floor(Math.random() * availableRooms.length)];
  }

  removeRoom(roomId) {
    if (this.rooms[roomId]) {
      if (this.rooms[roomId].game) {
        this.rooms[roomId].game.destroy();
      }
      delete this.rooms[roomId];
      return true;
    }
    return false;
  }

  cleanupRoom(roomId) {
    const room = this.rooms[roomId];
    if (room && room.players.length === 0) {
      this.removeRoom(roomId);
      console.log(`Cleaned up empty room: ${roomId}`);
    }
  }
}

module.exports = RoomManager;
