import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { socket } from "../socket";
import { Users, Copy, Check, Play, Send, Settings, MessageSquare, ArrowLeft } from "lucide-react";

function Lobby() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const roomId = searchParams.get("room") || "";

  const playerName = sessionStorage.getItem("playerName");
  const playerAvatar = sessionStorage.getItem("playerAvatar");

  const [players, setPlayers] = useState([]);
  const [settings, setSettings] = useState({
    maxPlayers: 10,
    rounds: 3,
    drawTime: 60,
    wordCount: 3,
    hintsCount: 2,
    wordMode: "normal",
  });
  const [isPrivate, setIsPrivate] = useState(false);
  const [hostId, setHostId] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [typedMessage, setTypedMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const isHost = socket.id === hostId;
  const chatContainerRef = useRef(null);

  // 1. Join Room if loaded directly or refreshed
  useEffect(() => {
    if (!playerName) {
      // Redirect to home and pass room code
      navigate(`/?room=${roomId}`);
      return;
    }

    // Sync current room state on mount
    const token = localStorage.getItem("authToken");
    socket.emit("join_room", {
      roomId,
      playerName,
      avatar: playerAvatar,
      token
    });

    // Socket listeners
    socket.on("game_state", (roomState) => {
      setPlayers(roomState.players);
      setSettings(roomState.settings);
      setIsPrivate(roomState.isPrivate);
      setHostId(roomState.hostId);
      setChatMessages(roomState.chatHistory || []);

      // If game has started, navigate to Game page!
      if (roomState.game && roomState.game.phase !== "LOBBY") {
        navigate(`/game?room=${roomId}`);
      }
    });

    socket.on("chat_message", (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    });

    socket.on("game_error", (errorMsg) => {
      alert(`Game Error: ${errorMsg}`);
    });

    return () => {
      socket.off("game_state");
      socket.off("chat_message");
      socket.off("game_error");
    };
  }, [roomId, playerName, playerAvatar, navigate, location.state]);

  // Scroll to bottom of chat when new message arrives
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleCopyLink = () => {
    const inviteLink = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSettingChange = (name, value) => {
    if (!isHost) return;
    const updatedSettings = {
      ...settings,
      [name]: typeof value === "number" ? parseInt(value) : value,
    };
    setSettings(updatedSettings);
    socket.emit("update_settings", { settings: updatedSettings });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!typedMessage.trim()) return;
    socket.emit("chat", { text: typedMessage.trim() });
    setTypedMessage("");
  };

  const handleStartGame = () => {
    if (!isHost) return;
    if (players.length < 2) {
      alert("Need at least 2 players to start the game!");
      return;
    }
    socket.emit("start_game");
  };

  const handleLeaveRoom = () => {
    navigate("/");
    // Socket disconnection will be handled by the backend automatically when we navigate/disconnect,
    // or we can refresh the page / let the connection handle it on disconnect.
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col p-4 md:p-8 relative overflow-y-auto">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-blue-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-indigo-900/10 blur-[120px] pointer-events-none" />

      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-3xl p-6 mb-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={handleLeaveRoom}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-slate-400 hover:text-white"
              title="Leave Room"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-black bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                  Lobby
                </h1>
                <span className="bg-slate-800 px-3 py-1 rounded-full text-xs font-semibold text-slate-400 border border-slate-750">
                  {isPrivate ? "Private" : "Public"}
                </span>
              </div>
              <p className="text-slate-400 text-sm mt-1">
                Waiting for the host to start the game
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 p-2.5 rounded-2xl w-full md:w-auto justify-between md:justify-start">
            <div className="px-3">
              <span className="text-xs text-slate-500 uppercase block font-semibold">Room Code</span>
              <span className="font-mono text-lg font-bold text-indigo-400 tracking-wider">
                {roomId}
              </span>
            </div>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 px-4 py-2 rounded-xl transition font-medium text-sm text-white shadow-md shadow-indigo-600/10 h-10"
            >
              {copied ? (
                <>
                  <Check size={16} />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={16} />
                  <span>Copy Link</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-stretch">
          
          {/* Players Panel (Left) */}
          <div className="lg:col-span-4 bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl flex flex-col h-[500px] lg:h-auto">
            <div className="flex items-center gap-2.5 mb-5 pb-3 border-b border-slate-800">
              <Users className="text-indigo-400" size={20} />
              <h2 className="text-xl font-bold text-slate-200">
                Players ({players.length}/{settings.maxPlayers})
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {players.map((player) => (
                <div
                  key={player.socketId}
                  className={`flex items-center justify-between bg-slate-950/50 border rounded-2xl px-4 py-3.5 transition ${
                    player.socketId === socket.id
                      ? "border-indigo-500/40 bg-indigo-950/10"
                      : "border-slate-850"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl select-none">{player.avatar}</span>
                    <div>
                      <span className="font-semibold text-slate-200 block text-sm">
                        {player.name}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">
                        {player.socketId === socket.id ? "You" : "Player"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {player.isHost && (
                      <span className="bg-yellow-500/15 border border-yellow-500/30 text-yellow-500 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                        👑 Host
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isHost ? (
              <button
                onClick={handleStartGame}
                className="mt-6 w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:from-blue-700 active:to-indigo-700 text-white py-4 rounded-2xl font-extrabold text-lg flex items-center justify-center gap-2 transition shadow-lg shadow-indigo-600/10 cursor-pointer"
              >
                <Play size={20} fill="white" />
                Start Game
              </button>
            ) : (
              <div className="mt-6 text-center text-sm text-slate-400 bg-slate-950/40 border border-slate-850 py-3.5 rounded-2xl font-medium animate-pulse">
                Waiting for host to start...
              </div>
            )}
          </div>

          {/* Settings Panel (Center) */}
          <div className="lg:col-span-4 bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl flex flex-col h-auto">
            <div className="flex items-center gap-2.5 mb-5 pb-3 border-b border-slate-800">
              <Settings className="text-indigo-400" size={20} />
              <h2 className="text-xl font-bold text-slate-200">Room Settings</h2>
            </div>

            <div className="space-y-4 flex-1">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Rounds
                </label>
                <select
                  disabled={!isHost}
                  value={settings.rounds}
                  onChange={(e) => handleSettingChange("rounds", parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none focus:border-indigo-500 disabled:opacity-60 transition"
                >
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
                    <option key={r} value={r}>
                      {r} Rounds
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Draw Time
                </label>
                <select
                  disabled={!isHost}
                  value={settings.drawTime}
                  onChange={(e) => handleSettingChange("drawTime", parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none focus:border-indigo-500 disabled:opacity-60 transition"
                >
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((t) => (
                    <option key={t} value={t}>
                      {t} Seconds
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Word Options
                </label>
                <select
                  disabled={!isHost}
                  value={settings.wordCount}
                  onChange={(e) => handleSettingChange("wordCount", parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none focus:border-indigo-500 disabled:opacity-60 transition"
                >
                  {[1, 2, 3, 4, 5].map((w) => (
                    <option key={w} value={w}>
                      {w} Words Choice
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Max Hints
                </label>
                <select
                  disabled={!isHost}
                  value={settings.hintsCount}
                  onChange={(e) => handleSettingChange("hintsCount", parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none focus:border-indigo-500 disabled:opacity-60 transition"
                >
                  {[0, 1, 2, 3, 4, 5].map((h) => (
                    <option key={h} value={h}>
                      {h === 0 ? "No Hints" : `${h} Hints`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Max Players
                </label>
                <select
                  disabled={!isHost}
                  value={settings.maxPlayers}
                  onChange={(e) => handleSettingChange("maxPlayers", parseInt(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none focus:border-indigo-500 disabled:opacity-60 transition"
                >
                  {[2, 3, 4, 5, 8, 10, 15, 20].map((p) => (
                    <option key={p} value={p}>
                      {p} Players Max
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Lobby Chat (Right) */}
          <div className="lg:col-span-4 bg-slate-900/60 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl flex flex-col h-[450px] lg:h-auto">
            <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-slate-800">
              <MessageSquare className="text-indigo-400" size={20} />
              <h2 className="text-xl font-bold text-slate-200">Lobby Chat</h2>
            </div>

            <div ref={chatContainerRef} className="flex-1 overflow-y-auto space-y-2 pr-1 mb-4">
              {chatMessages.length === 0 ? (
                <div className="text-slate-600 text-sm text-center mt-8 font-medium">
                  No chat messages yet. Say hello!
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-2.5 rounded-xl text-sm ${
                      msg.type === "system"
                        ? "bg-slate-950/80 border border-slate-850 text-indigo-400 font-semibold"
                        : "bg-slate-950/30 border border-slate-900 text-slate-350"
                    }`}
                  >
                    {msg.type !== "system" && (
                      <span className="font-bold text-slate-200 mr-1.5 inline-flex items-center gap-1">
                        <span>{msg.senderAvatar}</span>
                        <span>{msg.sender}:</span>
                      </span>
                    )}
                    <span>{msg.text}</span>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                placeholder="Type a message..."
                value={typedMessage}
                onChange={(e) => setTypedMessage(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 transition font-medium"
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 p-2.5 rounded-xl text-white transition flex items-center justify-center h-10 w-10 shrink-0"
              >
                <Send size={16} />
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}

export default Lobby;