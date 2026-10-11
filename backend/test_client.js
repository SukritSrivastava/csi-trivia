const WebSocket = require('ws');

// Usage: node test_client.js <roomCode> <playerId> <optionIndex>
// Example: node test_client.js ABCD Kingsley 2
const roomCode = process.argv[2] || 'TEST';
const playerId = process.argv[3] || 'Anonymous';
const chosenOption = parseInt(process.argv[4], 10);

if (isNaN(chosenOption) || chosenOption < 0 || chosenOption > 3) {
    console.log("⚠️ Error: You must provide a valid option index (0, 1, 2, or 3) as the 3rd argument.");
    console.log("Usage: node test_client.js <roomCode> <playerId> <optionIndex>");
    process.exit(1);
}

console.log(`[Test Client] Connecting to Room [${roomCode}] as Player [${playerId}] (Will choose Option ${chosenOption})...\n`);

const ws = new WebSocket(`ws://localhost:8080/player?room=${roomCode}&playerId=${encodeURIComponent(playerId)}`);

ws.on('open', () => {
    console.log(`[Test Client] Connected successfully! Waiting for host to start a question...`);
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        console.log(`[Test Client] Received event: [${msg.event}]`, msg.payload || '');

        // Automatically submit your chosen option as soon as the question options arrive!
        if (msg.event === 'show_controller_options') {
            console.log(`[Test Client] Question received! Submitting Option ${chosenOption} in 1 second...`);
            setTimeout(() => {
                ws.send(JSON.stringify({
                    event: 'submit_answer',
                    payload: { selectedOption: chosenOption }
                }));
                console.log(`[Test Client] Answer (Option ${chosenOption}) submitted successfully!`);
            }, 1000);
        }
    } catch (err) {
        console.error('[Test Client] Error parsing message:', err);
    }
});

ws.on('close', () => {
    console.log('[Test Client] Disconnected from server.');
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('[Test Client] WebSocket error:', err);
});
