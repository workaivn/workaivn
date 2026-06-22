const userSockets = new Map();
let socketServer = null;

export function configureRealtime(io) {
  socketServer = io;

  io.on("connection", socket => {
    socket.on("auth", userId => {
      userSockets.set(String(userId), socket.id);
    });

    socket.on("disconnect", () => {
      for (const [userId, socketId] of userSockets.entries()) {
        if (socketId === socket.id) userSockets.delete(userId);
      }
    });
  });
}

export function emitPaymentSuccess(userId) {
  const socketId = userSockets.get(String(userId));
  if (socketServer && socketId) {
    socketServer.to(socketId).emit("payment_success");
  }
}
