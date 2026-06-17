import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_WS_URL || (
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000"
    : window.location.origin
);

export const socket = io(SOCKET_URL, {
  autoConnect: true,
});