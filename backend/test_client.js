const WebSocket = require('ws');

// Grab roomCode and playerId from command-line arguments, with sensible defaults
// Usage: node test_client.js <roomCode> <playerId>
// Example: node test_client.js ABCD Kingsley
const roomCode = process.argv[2] || 'TEST';
const playerId = process.argv[3] || 'Anonymous';

console.log(`[Test Client] Attempting to connect to Room [${roomCode}] as Player [${playerId}]...\n`);

const ws = new WebSocket(`ws://localhost:8080/player?room=${roomCode}&playerId=${encodeURIComponent(playerId)}`);

ws.on('open', () => {
    console.log(`[Test Client] Successfully connected to server as ${playerId} in room ${roomCode}.`);
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        console.log(`[Test Client] Received message from server:`, msg);
    } catch (err) {
        console.error('[Test Client] Failed to parse incoming message:', err);
    }
});

ws.on('close', () => {
    console.log('[Test Client] Connection closed by server.');
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('[Test Client] WebSocket error:', err);
});

// Automatically simulate answering a question after 2 seconds
setTimeout(() => {
    console.log(`[Test Client] Submitting MCQ answer (Option 1)...`);
    ws.send(JSON.stringify({
        event: 'submit_answer',
        payload: { selectedOption: 1 }
    }));
}, 2000);
