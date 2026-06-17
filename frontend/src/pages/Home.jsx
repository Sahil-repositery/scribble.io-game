import "../App.css";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { socket } from "../socket";
import { Sparkles, Users, Lock, Unlock, Trophy, LogIn, UserPlus, LogOut, User, ShieldCheck } from "lucide-react";

const AVATARS = [
  "🦊", "🐯", "🦁", "🐱", "🐶", "🐼", "🐨", "🐻", 
  "🐙", "🐸", "🐵", "🦄", "🦖", "🐧", "🐝", "🦉"
];

const API_URL = import.meta.env.VITE_API_URL || (
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000"
    : window.location.origin
);

function Home() {
  const [playerName, setPlayerName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [roomCode, setRoomCode] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Tabs & Auth state
  const [activeTab, setActiveTab] = useState("play"); // play, leaderboard
  const [isAuthMode, setIsAuthMode] = useState(false);
  const [authType, setAuthType] = useState("login"); // login, register
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // DB States
  const [user, setUser] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  useEffect(() => {
    // 1. Read room parameter from URL if any (for invite links)
    const codeParam = searchParams.get("room");
    if (codeParam) {
      setRoomCode(codeParam.toUpperCase());
    }

    // 2. Fetch authenticated user profile on mount if token exists
    const token = localStorage.getItem("authToken");
    if (token) {
      fetchUserProfile(token);
    } else {
      // Check if name was previously saved for guests
      const savedName = sessionStorage.getItem("playerName");
      if (savedName) setPlayerName(savedName);
      const savedAvatar = sessionStorage.getItem("playerAvatar");
      if (savedAvatar) setSelectedAvatar(savedAvatar);
    }

    // Socket Event Listeners
    socket.on("room_joined", ({ roomId, isHost }) => {
      // Save name and avatar to session storage
      sessionStorage.setItem("playerName", playerName.trim());
      sessionStorage.setItem("playerAvatar", selectedAvatar);
      
      // Navigate to Lobby
      navigate(`/lobby?room=${roomId}`, { 
        state: { isHost } 
      });
    });

    socket.on("join_error", (errorMsg) => {
      alert(`Join Error: ${errorMsg}`);
    });

    return () => {
      socket.off("room_joined");
      socket.off("join_error");
    };
  }, [playerName, selectedAvatar, navigate, searchParams]);

  // Fetch Leaderboard when tab changes
  useEffect(() => {
    if (activeTab === "leaderboard") {
      fetchLeaderboard();
    }
  }, [activeTab]);

  const fetchUserProfile = async (token) => {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data);
        setPlayerName(data.username);
        setSelectedAvatar(data.avatar);
      } else {
        // Token expired/invalid
        localStorage.removeItem("authToken");
      }
    } catch (err) {
      console.error("Failed to fetch user profile:", err);
    }
  };

  const fetchLeaderboard = async () => {
    setLoadingLeaderboard(true);
    try {
      const res = await fetch(`${API_URL}/api/leaderboard`);
      const data = await res.json();
      if (res.ok) {
        setLeaderboard(data);
      }
    } catch (err) {
      console.error("Failed to fetch leaderboard:", err);
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    if (!authUsername.trim() || !authPassword.trim()) {
      setAuthError("All fields are required");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Login failed");
        return;
      }
      localStorage.setItem("authToken", data.token);
      setUser(data.user);
      setPlayerName(data.user.username);
      setSelectedAvatar(data.user.avatar);
      setIsAuthMode(false);
      setAuthUsername("");
      setAuthPassword("");
    } catch (err) {
      setAuthError("Network error. Please try again.");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError("");
    if (!authUsername.trim() || !authPassword.trim()) {
      setAuthError("All fields are required");
      return;
    }
    if (authUsername.trim().length < 3) {
      setAuthError("Username must be at least 3 characters");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: authUsername.trim(),
          password: authPassword,
          avatar: selectedAvatar
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Registration failed");
        return;
      }
      localStorage.setItem("authToken", data.token);
      setUser(data.user);
      setPlayerName(data.user.username);
      setIsAuthMode(false);
      setAuthUsername("");
      setAuthPassword("");
    } catch (err) {
      setAuthError("Network error. Please try again.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("authToken");
    setUser(null);
    setPlayerName("");
    setSelectedAvatar(AVATARS[0]);
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      alert("Please enter your name");
      return;
    }
    const token = localStorage.getItem("authToken");
    socket.emit("create_room", {
      playerName: playerName.trim(),
      avatar: selectedAvatar,
      isPrivate,
      token
    });
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      alert("Please enter your name");
      return;
    }
    if (!roomCode.trim()) {
      alert("Please enter room code");
      return;
    }
    const token = localStorage.getItem("authToken");
    socket.emit("join_room", {
      roomId: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
      avatar: selectedAvatar,
      token
    });
  };

  const handleJoinPublic = () => {
    if (!playerName.trim()) {
      alert("Please enter your name");
      return;
    }
    const token = localStorage.getItem("authToken");
    socket.emit("join_public_room", {
      playerName: playerName.trim(),
      avatar: selectedAvatar,
      token
    });
  };

  const handleRandomAvatar = () => {
    const randomAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    setSelectedAvatar(randomAvatar);
  };

  const winRate = user && user.gamesPlayed > 0 
    ? Math.round((user.gamesWon / user.gamesPlayed) * 100) 
    : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-start px-4 py-8 relative overflow-y-auto">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-blue-900/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-indigo-900/20 blur-[120px] pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-lg bg-slate-900/70 border border-slate-800 rounded-3xl shadow-2xl p-6 md:p-8 backdrop-blur-xl relative z-10 my-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 text-blue-400 border border-blue-500/30 px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider mb-3">
            <Sparkles size={14} className="animate-pulse" />
            Online Multiplayer Drawing
          </div>
          <h1 className="text-5xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Scribble.io
          </h1>
          <p className="text-slate-400 mt-2 font-medium">Draw • Guess • Win with Friends</p>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 mb-6 p-1 bg-slate-950/60 rounded-2xl">
          <button
            onClick={() => { setActiveTab("play"); setIsAuthMode(false); }}
            className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition flex items-center justify-center gap-2 ${
              activeTab === "play" && !isAuthMode
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Play Game
          </button>
          <button
            onClick={() => { setActiveTab("leaderboard"); setIsAuthMode(false); }}
            className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition flex items-center justify-center gap-2 ${
              activeTab === "leaderboard"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Trophy size={16} />
            Leaderboard
          </button>
        </div>

        {/* 1. PLAY TAB */}
        {activeTab === "play" && (
          <>
            {isAuthMode ? (
              /* Auth Form Card */
              <div className="bg-slate-950/50 border border-slate-850 p-6 rounded-2xl mb-6 animate-fade-in">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                    {authType === "login" ? <LogIn size={18} /> : <UserPlus size={18} />}
                    {authType === "login" ? "Account Login" : "Create Account"}
                  </h3>
                  <button
                    onClick={() => setIsAuthMode(false)}
                    className="text-xs text-slate-400 hover:text-white border border-slate-800 px-2.5 py-1 rounded-lg hover:bg-slate-900 transition"
                  >
                    Cancel
                  </button>
                </div>

                <form onSubmit={authType === "login" ? handleLogin : handleRegister} className="space-y-4">
                  {authError && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs py-2 px-3.5 rounded-xl font-medium">
                      {authError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      placeholder="Enter username"
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4.5 py-2.5 outline-none focus:border-indigo-500 transition text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      placeholder="Enter password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4.5 py-2.5 outline-none focus:border-indigo-500 transition text-sm"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl transition text-sm mt-2 flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/15"
                  >
                    {authType === "login" ? "Login" : "Sign Up"}
                  </button>
                </form>

                <div className="mt-4 text-center text-xs text-slate-400">
                  {authType === "login" ? (
                    <>
                      Don't have an account?{" "}
                      <button
                        onClick={() => { setAuthType("register"); setAuthError(""); }}
                        className="text-indigo-400 hover:underline font-semibold"
                      >
                        Sign up here
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <button
                        onClick={() => { setAuthType("login"); setAuthError(""); }}
                        className="text-indigo-400 hover:underline font-semibold"
                      >
                        Login here
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* Profile Card or Auth Invitation Banner */
              <>
                {user ? (
                  <div className="bg-gradient-to-r from-slate-900 to-indigo-950/20 border border-slate-800 p-4 rounded-2xl mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <span className="text-4xl select-none">{user.avatar}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-extrabold text-slate-100">{user.username}</h3>
                          <ShieldCheck size={15} className="text-blue-400" title="Registered User" />
                        </div>
                        <span className="text-[10px] text-indigo-300 font-bold bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider block w-max mt-0.5">
                          Verified Profile
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 text-center flex-1 md:flex-none border-t md:border-t-0 md:border-l border-slate-800/80 pt-3.5 md:pt-0 md:pl-5">
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase block leading-none">Total Pts</span>
                        <span className="font-extrabold text-indigo-400 text-sm">{user.totalScore}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase block leading-none">Played</span>
                        <span className="font-extrabold text-slate-300 text-sm">{user.gamesPlayed}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase block leading-none">Win %</span>
                        <span className="font-extrabold text-emerald-400 text-sm">{winRate}%</span>
                      </div>
                    </div>

                    <button
                      onClick={handleLogout}
                      className="text-slate-400 hover:text-red-400 transition hover:bg-red-500/10 p-2 rounded-xl border border-transparent hover:border-red-500/20"
                      title="Log Out"
                    >
                      <LogOut size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="bg-slate-950/50 border border-slate-850 p-4 rounded-2xl mb-6 flex items-center justify-between gap-4">
                    <div>
                      <h4 className="text-xs font-bold text-slate-300">Save Your Progress!</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">Log in to track stats and appear on the Leaderboard.</p>
                    </div>
                    <button
                      onClick={() => { setIsAuthMode(true); setAuthType("login"); setAuthError(""); }}
                      className="bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-400 hover:text-white px-3 py-1.5 rounded-xl transition text-xs font-bold shrink-0 flex items-center gap-1"
                    >
                      <LogIn size={12} />
                      Log In
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Character Info */}
            <div className="space-y-5 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Choose Avatar
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 bg-slate-800 border-2 border-indigo-500/50 rounded-2xl flex items-center justify-center text-4xl shadow-inner shadow-black/40 relative group shrink-0">
                    <span className="scale-110 select-none">{selectedAvatar}</span>
                    {!user && (
                      <button
                        type="button"
                        onClick={handleRandomAvatar}
                        className="absolute bottom-1 right-1 bg-slate-900 hover:bg-slate-700 p-1 rounded-md text-[10px] border border-slate-700 transition"
                        title="Randomize Avatar"
                      >
                        🎲
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-8 gap-1.5 flex-1 bg-slate-950/50 border border-slate-850 p-2.5 rounded-2xl">
                    {AVATARS.map((avatar) => (
                      <button
                        key={avatar}
                        type="button"
                        disabled={!!user}
                        onClick={() => setSelectedAvatar(avatar)}
                        className={`text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:scale-100 transition transform hover:scale-110 ${
                          selectedAvatar === avatar ? "bg-indigo-600/35 border border-indigo-500" : "border border-transparent"
                        }`}
                      >
                        {avatar}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Your Name
                </label>
                <input
                  type="text"
                  disabled={!!user}
                  placeholder="Enter guest name..."
                  value={playerName}
                  maxLength={15}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 transition text-base placeholder:text-slate-650 font-medium"
                />
              </div>
            </div>

            {/* Game Mode Layout */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Create Room Block */}
                <div className="bg-slate-950/50 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between">
                  <div className="mb-4">
                    <h3 className="font-bold text-slate-200 text-sm">Start Room</h3>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">Host a private or public game room.</p>
                  </div>
                  
                  <div className="space-y-3 mt-auto">
                    <button
                      onClick={() => setIsPrivate(!isPrivate)}
                      className="w-full flex items-center justify-between text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-lg py-1.5 px-3 hover:text-white transition"
                    >
                      <span className="flex items-center gap-1.5">
                        {isPrivate ? <Lock size={12} className="text-yellow-500" /> : <Unlock size={12} className="text-green-500" />}
                        {isPrivate ? "Private Room" : "Public Room"}
                      </span>
                      <span className="text-[10px] opacity-65">Toggle</span>
                    </button>
                    
                    <button
                      onClick={handleCreateRoom}
                      className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition text-sm flex items-center justify-center gap-1.5"
                    >
                      Create
                    </button>
                  </div>
                </div>

                {/* Join Room Block */}
                <div className="bg-slate-950/50 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between">
                  <div className="mb-3">
                    <h3 className="font-bold text-slate-200 text-sm">Enter Code</h3>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">Join an existing room code.</p>
                  </div>

                  <div className="mt-auto">
                    <input
                      type="text"
                      placeholder="Code e.g. X1Y2Z3"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-center text-sm mb-3 outline-none focus:border-green-500 font-bold tracking-wider placeholder:text-slate-600 placeholder:font-normal uppercase"
                    />

                    <button
                      onClick={handleJoinRoom}
                      className="w-full bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold py-2.5 rounded-xl transition text-sm flex items-center justify-center gap-1.5"
                    >
                      Join Game
                    </button>
                  </div>
                </div>
              </div>

              <div className="text-center text-xs text-slate-500 flex items-center justify-center gap-2 py-1">
                <span className="h-px bg-slate-800 flex-1"></span>
                <span>OR QUICK PLAY</span>
                <span className="h-px bg-slate-800 flex-1"></span>
              </div>

              <button
                onClick={handleJoinPublic}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-extrabold py-3.5 rounded-xl transition shadow-lg shadow-indigo-600/20 text-base flex items-center justify-center gap-2"
              >
                <Users size={18} />
                Join Public Game
              </button>
            </div>
          </>
        )}

        {/* 2. LEADERBOARD TAB */}
        {activeTab === "leaderboard" && (
          <div className="space-y-4 animate-fade-in">
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-2">
              <Trophy size={20} className="text-yellow-500" />
              Global High Scores
            </h3>

            {loadingLeaderboard ? (
              <div className="text-center py-12 text-slate-500 text-sm font-semibold animate-pulse">
                Fetching leaderboard data...
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-12 text-slate-650 text-sm font-medium">
                No high scores recorded yet. Be the first to win!
              </div>
            ) : (
              <div className="bg-slate-950/50 border border-slate-850 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-800/80 text-slate-400 font-semibold text-xs uppercase tracking-wider">
                      <th className="py-3 px-4 w-16 text-center">Rank</th>
                      <th className="py-3 px-4">Player</th>
                      <th className="py-3 px-4 text-center">Won</th>
                      <th className="py-3 px-4 text-right">Lifetime Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850/60">
                    {leaderboard.map((player, index) => (
                      <tr 
                        key={player._id} 
                        className={`hover:bg-slate-900/30 transition ${
                          user && user.username === player.username ? "bg-indigo-950/10 border-l-2 border-l-indigo-500" : ""
                        }`}
                      >
                        <td className="py-3 px-4 text-center font-extrabold text-slate-500">
                          {index === 0 ? "👑" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
                        </td>
                        <td className="py-3 px-4 flex items-center gap-2 font-semibold text-slate-200">
                          <span className="text-xl select-none">{player.avatar}</span>
                          <span className="truncate max-w-[120px]">{player.username}</span>
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-slate-400">
                          {player.gamesWon}
                        </td>
                        <td className="py-3 px-4 text-right font-black text-indigo-400">
                          {player.totalScore.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              onClick={() => setActiveTab("play")}
              className="w-full mt-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 rounded-xl transition text-sm text-center"
            >
              Back to Home
            </button>
          </div>
        )}
      </div>

      <div className="mt-8 text-center text-xs text-slate-600 relative z-10">
        Skribbl.io Clone &copy; {new Date().getFullYear()} • Works in Real-time
      </div>
    </div>
  );
}

export default Home;