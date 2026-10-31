export function connectMarketSocket(onMessage, { onStatus = () => {} } = {}) {
  let socket;
  let retryDelay = 1000;
  let reconnectTimer;
  let stopped = false;

  function connect() {
    onStatus("connecting");
    const socketUrl = new URL(window.location.href);
    socketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.pathname = "/";
    socketUrl.search = "";
    socketUrl.hash = "";
    socket = new WebSocket(socketUrl.toString());

    socket.addEventListener("open", () => {
      retryDelay = 1000;
      console.log("WebSocket connected");
      onStatus("connected");
    });

    socket.addEventListener("message", (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Invalid WebSocket market message:", error);
      }
    });

    socket.addEventListener("close", () => {
      if (stopped) return;
      console.log(`WebSocket disconnected; reconnecting in ${retryDelay / 1000}s`);
      onStatus("reconnecting", { retryDelay });
      reconnectTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    });

    socket.addEventListener("error", () => {
      console.error("WebSocket connection error");
      onStatus("unavailable");
    });
  }

  connect();
  window.addEventListener("pagehide", () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    socket?.close();
  }, { once: true });

  return {
    close() {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
