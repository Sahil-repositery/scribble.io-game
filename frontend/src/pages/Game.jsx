import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { socket } from "../socket";
import { Trophy, Clock, Send, Palette, Trash2, Undo, CheckCircle, Sparkles, Smile } from "lucide-react";

const COLORS = [
  "#000000", "#FF0000", "#0000FF", "#00FF00", 
  "#FFFF00", "#FFA500", "#800080", "#A52A2A", 
  "#FFFFFF" // Eraser can be represented by drawing white
];

function Game() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const roomId = searchParams.get("room") || "";

  const playerName = sessionStorage.getItem("playerName");
  const playerAvatar = sessionStorage.getItem("playerAvatar");

  // Game Room States
  const [players, setPlayers] = useState([]);
  const [gameState, setGameState] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [typedGuess, setTypedGuess] = useState("");
  const [hasGuessedCorrectly, setHasGuessedCorrectly] = useState(false);

  // Brush settings
  const [brushColor, setBrushColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(5);
  const [isEraser, setIsEraser] = useState(false);

  // References
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const chatContainerRef = useRef(null);

  // Determine helper flags
  const isDrawer = gameState?.drawerId === socket.id;
  const isSelectingWord = gameState?.phase === "SELECTING_WORD";
  const isDrawingPhase = gameState?.phase === "DRAWING";
  const isRoundEnd = gameState?.phase === "ROUND_END";
  const isGameOver = gameState?.phase === "GAME_OVER";

  // Redirect to home if credentials are missing
  useEffect(() => {
    if (!playerName) {
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

    // Socket Event Listeners
    socket.on("game_state", (roomState) => {
      setPlayers(roomState.players);
      setGameState(roomState.game);
      setChatMessages(roomState.chatHistory || []);

      // If game has returned to lobby phase, navigate back to Lobby page
      if (!roomState.game || roomState.game.phase === "LOBBY") {
        navigate(`/lobby?room=${roomId}`);
        return;
      }

      // Check if current player has guessed correctly
      const localPlayer = roomState.players.find(p => p.socketId === socket.id);
      if (localPlayer) {
        setHasGuessedCorrectly(localPlayer.hasGuessed);
      }
    });

    socket.on("chat_message", (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    });

    socket.on("guess_result", ({ correct }) => {
      if (correct) {
        setHasGuessedCorrectly(true);
      }
    });

    // Canvas sync events
    socket.on("draw_start", (data) => {
      if (isDrawer) return; // Already drawn locally
      drawStartRemote(data);
    });

    socket.on("draw_move", (data) => {
      if (isDrawer) return; // Already drawn locally
      drawMoveRemote(data);
    });

    socket.on("draw_end", ({ socketId }) => {
      if (isDrawer) return;
      drawEndRemote();
    });

    socket.on("draw_undo", (canvasHistory) => {
      redrawCanvasHistory(canvasHistory);
    });

    socket.on("canvas_clear", () => {
      clearLocalCanvas();
    });

    return () => {
      socket.off("game_state");
      socket.off("chat_message");
      socket.off("guess_result");
      socket.off("draw_start");
      socket.off("draw_move");
      socket.off("draw_end");
      socket.off("draw_undo");
      socket.off("canvas_clear");
    };
  }, [roomId, playerName, isDrawer, navigate]);

  // Scroll to bottom of chat when messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Ensure canvas clears on next round start
  useEffect(() => {
    if (isDrawingPhase) {
      clearLocalCanvas();
      setHasGuessedCorrectly(false);
    }
  }, [isDrawingPhase, gameState?.drawerId]);

  // Canvas Drawing Logic
  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Support mouse or touch
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const handleMouseDown = (e) => {
    if (!isDrawer || !isDrawingPhase) return;
    isDrawingRef.current = true;
    const { x, y } = getCoordinates(e);
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = isEraser ? "#FFFFFF" : brushColor;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(x, y);

    socket.emit("draw_start", {
      x: x / canvas.width,
      y: y / canvas.height,
      color: isEraser ? "#FFFFFF" : brushColor,
      size: brushSize,
      isEraser
    });
  };

  const handleMouseMove = (e) => {
    if (!isDrawer || !isDrawingPhase || !isDrawingRef.current) return;
    const { x, y } = getCoordinates(e);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();

    socket.emit("draw_move", {
      x: x / canvas.width,
      y: y / canvas.height
    });
  };

  const handleMouseUp = () => {
    if (!isDrawer || !isDrawingPhase || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.closePath();

    socket.emit("draw_end");
  };

  // Touch handlers for mobile
  const handleTouchStart = (e) => {
    e.preventDefault();
    handleMouseDown(e);
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    handleMouseMove(e);
  };

  // Remote Drawing
  const drawStartRemote = (data) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    const x = data.x * canvas.width;
    const y = data.y * canvas.height;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const drawMoveRemote = (data) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    const x = data.x * canvas.width;
    const y = data.y * canvas.height;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const drawEndRemote = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.closePath();
  };

  const redrawCanvasHistory = (canvasHistory) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all strokes
    canvasHistory.forEach((stroke) => {
      if (stroke.points.length === 0) return;

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();

      const start = stroke.points[0];
      ctx.moveTo(start.x * canvas.width, start.y * canvas.height);

      for (let i = 1; i < stroke.points.length; i++) {
        const pt = stroke.points[i];
        ctx.lineTo(pt.x * canvas.width, pt.y * canvas.height);
      }

      ctx.stroke();
      ctx.closePath();
    });
  };

  const clearLocalCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const emitUndo = () => {
    if (!isDrawer || !isDrawingPhase) return;
    socket.emit("draw_undo");
  };

  const emitClear = () => {
    if (!isDrawer || !isDrawingPhase) return;
    socket.emit("canvas_clear");
  };

  // Game UI Actions
  const handleSelectWord = (word) => {
    socket.emit("word_chosen", { word });
  };

  const handleSendGuess = (e) => {
    e.preventDefault();
    if (!typedGuess.trim()) return;
    
    socket.emit("guess", { text: typedGuess.trim() });
    setTypedGuess("");
  };

  const handleBackToLobby = () => {
    socket.emit("back_to_lobby");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col p-4 md:p-6 relative overflow-y-auto">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-blue-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col z-10">
        
        {/* Game Stats Header Bar */}
        <div className="grid grid-cols-12 gap-4 items-center bg-slate-900/60 border border-slate-800 rounded-3xl p-4 md:p-5 mb-5 backdrop-blur-xl">
          <div className="col-span-4 flex items-center gap-3">
            <span className="text-3xl font-black bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Scribble.io
            </span>
            <div className="bg-slate-800 px-3 py-1 rounded-full text-xs font-semibold text-slate-400 border border-slate-750 shrink-0">
              Round {gameState?.currentRound || 1} / {gameState?.maxRounds || 3}
            </div>
          </div>

          <div className="col-span-5 flex justify-center text-center">
            {/* Blanks or Hints */}
            {isDrawingPhase && (
              <div className="bg-slate-950/80 px-6 py-2.5 rounded-2xl border border-slate-850 flex items-center justify-center gap-2">
                {isDrawer ? (
                  <div>
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-0.5">Your Word</span>
                    <span className="text-lg font-black text-emerald-400 tracking-wider">
                      {gameState?.currentWord.toUpperCase()}
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-1">Guess This Word</span>
                    <span className="text-2xl font-black text-indigo-300 tracking-[8px] font-mono leading-none select-none pl-2 block">
                      {gameState?.hintString.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="col-span-3 flex justify-end">
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-4 py-2.5 rounded-2xl text-red-400 shrink-0">
              <Clock size={18} className="animate-pulse" />
              <span className="font-extrabold text-base tracking-wider w-8 text-center">
                {gameState?.timeLeft}s
              </span>
            </div>
          </div>
        </div>

        {/* Main Interface Grid */}
        <div className="grid grid-cols-12 gap-5 flex-1 items-stretch">
          
          {/* Leaderboard Panel (Left) */}
          <div className="col-span-12 md:col-span-3 bg-slate-900/60 border border-slate-800 rounded-3xl p-5 backdrop-blur-xl flex flex-col h-[220px] md:h-auto order-2 md:order-1">
            <div className="flex items-center gap-2.5 mb-4 pb-2.5 border-b border-slate-800 shrink-0">
              <Trophy className="text-yellow-500" size={18} />
              <h2 className="text-lg font-bold text-slate-200">Leaderboard</h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {[...players]
                .sort((a, b) => b.score - a.score)
                .map((player, index) => {
                  const isCurrentDrawer = player.socketId === gameState?.drawerId;
                  const isLocal = player.socketId === socket.id;

                  return (
                    <div
                      key={player.socketId}
                      className={`flex items-center justify-between border rounded-2xl px-3.5 py-2.5 transition ${
                        player.hasGuessed
                          ? "border-emerald-500/40 bg-emerald-950/10"
                          : isCurrentDrawer
                          ? "border-amber-500/40 bg-amber-950/10"
                          : isLocal
                          ? "border-indigo-500/40 bg-indigo-950/10"
                          : "border-slate-850 bg-slate-950/30"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <span className="text-xl shrink-0 select-none">{player.avatar}</span>
                        <div className="truncate">
                          <span className="font-semibold text-sm text-slate-200 block truncate">
                            {player.name}
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            {isCurrentDrawer ? "✍️ Drawing" : player.hasGuessed ? "✅ Guessed" : "Guessing"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-black text-indigo-400">
                          {player.score}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Canvas Draw Panel (Center) */}
          <div className="col-span-12 md:col-span-6 flex flex-col order-1 md:order-2">
            <div className="flex-1 bg-white border border-slate-850 rounded-3xl overflow-hidden relative shadow-2xl flex items-center justify-center min-h-[350px] md:min-h-[450px]">
              
              <canvas
                ref={canvasRef}
                width={800}
                height={500}
                className={`w-full h-full object-contain bg-white rounded-2xl select-none ${
                  isDrawer && isDrawingPhase ? "cursor-crosshair" : "pointer-events-none"
                }`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleMouseUp}
              />

              {/* OVERLAYS BASED ON GAME PHASE */}

              {/* 1. SELECTING WORD PHASE */}
              {isSelectingWord && (
                <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 backdrop-blur-md z-20">
                  {isDrawer ? (
                    <div className="text-center max-w-md animate-fade-in">
                      <div className="inline-flex p-3 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-2xl mb-4">
                        <Palette size={28} />
                      </div>
                      <h3 className="text-2xl font-black mb-1">Your Turn to Draw!</h3>
                      <p className="text-slate-400 text-sm mb-6">Choose a word to start drawing:</p>
                      
                      <div className="flex flex-col gap-3">
                        {gameState?.wordOptions.map((word) => (
                          <button
                            key={word}
                            onClick={() => handleSelectWord(word)}
                            className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-extrabold py-3.5 px-6 rounded-2xl transition shadow-lg shadow-indigo-600/10 tracking-wide hover:scale-102"
                          >
                            {word.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center text-2xl mb-4 mx-auto animate-bounce">
                        💭
                      </div>
                      <h3 className="text-xl font-bold mb-1">Word Selection</h3>
                      <p className="text-slate-400 text-sm">
                        Waiting for <span className="text-indigo-400 font-extrabold">{gameState?.drawerName}</span> to select a word...
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 2. ROUND END PHASE */}
              {isRoundEnd && (
                <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 backdrop-blur-md z-20 animate-fade-in">
                  <div className="inline-flex p-3.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-2xl mb-4">
                    <CheckCircle size={32} />
                  </div>
                  <h3 className="text-3xl font-black mb-1 text-slate-100">Round Over!</h3>
                  <p className="text-slate-400 text-sm mb-2">The secret word was:</p>
                  <span className="bg-slate-900 border border-slate-800 text-2xl font-black text-emerald-400 px-6 py-2 rounded-2xl tracking-widest mb-8 uppercase">
                    {gameState?.currentWord}
                  </span>

                  <div className="w-full max-w-sm bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Round Scoreboard</h4>
                    {players
                      .filter(p => p.scoreGainedThisRound > 0 || p.socketId === gameState?.drawerId)
                      .map((player) => (
                        <div key={player.socketId} className="flex justify-between items-center text-sm">
                          <span className="flex items-center gap-1.5 font-medium text-slate-300">
                            <span>{player.avatar}</span>
                            <span>{player.name}</span>
                          </span>
                          <span className="font-extrabold text-emerald-400">
                            +{player.scoreGainedThisRound} pts
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 3. GAME OVER / LEADERBOARD END SCREEN */}
              {isGameOver && (
                <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 backdrop-blur-md z-20 overflow-y-auto">
                  <div className="inline-flex p-3 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full mb-4 animate-pulse">
                    <Sparkles size={36} />
                  </div>
                  <h3 className="text-4xl font-black bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 bg-clip-text text-transparent mb-1">
                    Game Over!
                  </h3>
                  <p className="text-slate-400 text-sm mb-6">Final Leaderboard Standings</p>

                  <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-3xl p-5 mb-6 space-y-3 shadow-inner">
                    {players
                      .sort((a, b) => b.score - a.score)
                      .map((player, idx) => (
                        <div
                          key={player.socketId}
                          className="flex items-center justify-between border border-slate-850 bg-slate-950/40 p-3 rounded-2xl text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-black text-slate-500 w-5">
                              {idx === 0 ? "🏆" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
                            </span>
                            <span className="text-xl select-none">{player.avatar}</span>
                            <span className="font-bold text-slate-200">{player.name}</span>
                          </div>
                          <span className="font-black text-indigo-400 text-base">{player.score} pts</span>
                        </div>
                      ))}
                  </div>

                  {players.find(p => p.socketId === socket.id)?.isHost ? (
                    <button
                      onClick={handleBackToLobby}
                      className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-extrabold py-3 px-8 rounded-2xl transition tracking-wide text-sm shadow-md shadow-indigo-600/10 cursor-pointer"
                    >
                      Return to Lobby
                    </button>
                  ) : (
                    <div className="text-slate-500 text-xs font-semibold animate-pulse">
                      Waiting for host to return to lobby...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Drawer Tools Bar */}
            {isDrawer && isDrawingPhase && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-3xl mt-4 p-4 flex flex-col md:flex-row items-center gap-4 backdrop-blur-xl shrink-0">
                {/* Colors Select */}
                <div className="flex flex-wrap gap-2.5 items-center justify-center">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        setBrushColor(color);
                        setIsEraser(color === "#FFFFFF");
                      }}
                      className={`w-7 h-7 rounded-xl transition border transform hover:scale-110 ${
                        brushColor === color && !isEraser
                          ? "ring-2 ring-indigo-500 border-white scale-110"
                          : "border-slate-850"
                      }`}
                      style={{ backgroundColor: color }}
                      title={color === "#FFFFFF" ? "Eraser" : color}
                    />
                  ))}
                  
                  {/* Separate Eraser Button */}
                  <button
                    onClick={() => {
                      setIsEraser(true);
                      setBrushColor("#FFFFFF");
                    }}
                    className={`px-3 py-1 bg-slate-800 hover:bg-slate-700 border text-xs font-bold rounded-xl transition ${
                      isEraser ? "border-indigo-500 text-indigo-400 ring-1 ring-indigo-500" : "border-slate-700 text-slate-400"
                    }`}
                  >
                    Eraser
                  </button>
                </div>

                {/* Size Controls */}
                <div className="flex items-center gap-3 w-full md:w-auto md:ml-auto">
                  <span className="text-xs font-bold text-slate-400 shrink-0">Size:</span>
                  <input
                    type="range"
                    min={2}
                    max={40}
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="w-full md:w-28 accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-indigo-400 w-5 text-right shrink-0">{brushSize}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
                  <button
                    onClick={emitUndo}
                    className="bg-slate-850 hover:bg-slate-800 border border-slate-750 p-2.5 rounded-xl transition text-slate-400 hover:text-white"
                    title="Undo Stroke"
                  >
                    <Undo size={16} />
                  </button>
                  <button
                    onClick={emitClear}
                    className="bg-red-950/20 hover:bg-red-950/40 border border-red-500/25 p-2.5 rounded-xl transition text-red-400 hover:text-red-300"
                    title="Clear Canvas"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )}
            
            {!isDrawer && isDrawingPhase && (
              <div className="bg-slate-900/40 border border-slate-850/60 rounded-2xl mt-4 p-3 text-center text-xs text-slate-400 font-semibold animate-pulse">
                ✏️ <span className="text-indigo-400 font-bold">{gameState?.drawerName}</span> is drawing. Keep guessing in chat!
              </div>
            )}
          </div>

          {/* Chat & Guessing Panel (Right) */}
          <div className="col-span-12 md:col-span-3 bg-slate-900/60 border border-slate-800 rounded-3xl p-5 backdrop-blur-xl flex flex-col h-[400px] md:h-auto order-3">
            <div className="flex items-center gap-2 mb-4 pb-2.5 border-b border-slate-800 shrink-0">
              <Smile className="text-indigo-400" size={18} />
              <h2 className="text-lg font-bold text-slate-200">Guesses & Chat</h2>
            </div>

            <div ref={chatContainerRef} className="flex-1 overflow-y-auto space-y-2 pr-1 mb-4">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-2.5 rounded-xl text-xs ${
                    msg.type === "correct"
                      ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-bold"
                      : msg.type === "close"
                      ? "bg-amber-500/10 border border-amber-500/25 text-amber-400 font-semibold"
                      : msg.type === "system"
                      ? "bg-slate-950 border border-slate-850 text-indigo-400 font-semibold"
                      : "bg-slate-950/40 border border-slate-900 text-slate-350"
                  }`}
                >
                  {msg.type !== "correct" && msg.type !== "close" && msg.type !== "system" && (
                    <span className="font-bold text-slate-200 mr-1.5 inline-flex items-center gap-0.5">
                      <span>{msg.senderAvatar}</span>
                      <span>{msg.sender}:</span>
                    </span>
                  )}
                  <span>{msg.text}</span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendGuess} className="flex gap-2 shrink-0">
              <input
                disabled={isDrawer || hasGuessedCorrectly || !isDrawingPhase}
                type="text"
                placeholder={
                  isDrawer
                    ? "Drawer cannot guess..."
                    : hasGuessedCorrectly
                    ? "Correct! Waiting for others..."
                    : !isDrawingPhase
                    ? "Round transitions..."
                    : "Type your guess here..."
                }
                value={typedGuess}
                onChange={(e) => setTypedGuess(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs outline-none focus:border-indigo-500 transition font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                disabled={isDrawer || hasGuessedCorrectly || !isDrawingPhase}
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-slate-800 p-2.5 rounded-xl text-white transition flex items-center justify-center h-9 w-9 shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Send size={14} />
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}

export default Game;