class ConnectionManager {
    constructor() {
        // Maps roomCode -> WebSocket (Host)
        this.hosts = new Map();
        
        // Maps roomCode -> Map(playerId -> WebSocket)
        this.players = new Map();
    }

    addHost(roomCode, ws) {
        this.hosts.set(roomCode, ws);
        console.log(`[Manager] Host registered for room: ${roomCode}`);
    }

    addPlayer(roomCode, playerId, ws) {
        if (!this.players.has(roomCode)) {
            this.players.set(roomCode, new Map());
        }
        this.players.get(roomCode).set(playerId, ws);
        console.log(`[Manager] Player ${playerId} joined room: ${roomCode}`);
    }

    removeHost(roomCode) {
        if (this.hosts.has(roomCode)) {
            this.hosts.delete(roomCode);
            console.log(`[Manager] Host removed for room: ${roomCode}`);
        }
    }

    removePlayer(roomCode, playerId) {
        if (this.players.has(roomCode)) {
            const roomPlayers = this.players.get(roomCode);
            roomPlayers.delete(playerId);
            console.log(`[Manager] Player ${playerId} left room: ${roomCode}`);
            
            if (roomPlayers.size === 0) {
                this.players.delete(roomCode);
            }
        }
    }

    sendToHost(roomCode, message) {
        const hostWs = this.hosts.get(roomCode);
        if (hostWs && hostWs.readyState === WebSocket.OPEN) {
            hostWs.send(JSON.stringify(message));
        }
    }

    broadcastToRoom(roomCode, message) {
        const roomPlayers = this.players.get(roomCode);
        if (roomPlayers) {
            const dataStr = JSON.stringify(message);
            for (const [playerId, ws] of roomPlayers.entries()) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(dataStr);
                }
            }
        }
    }
}

module.exports = ConnectionManager;
