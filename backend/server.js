const { WebSocketServer } = require('ws');
const ConnectionManager = require('./ConnectionManager');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const manager = new ConnectionManager();

// Load questions from questions.json
let questionsDeck = [];
try {
    const rawData = fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8');
    questionsDeck = JSON.parse(rawData);
    console.log(`[Server] Loaded ${questionsDeck.length} questions from questions.json`);
} catch (err) {
    console.error('[Server] Failed to load questions.json:', err);
}


const generateRoomCode = () => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 4; i++) {
        code += letters[Math.floor(Math.random() * letters.length)];
    }
    return code;
};

console.log(`[Jackbox Server] Running on ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const roomCode = url.searchParams.get('room');
    const playerId = url.searchParams.get('playerId');

    console.log(`[Server] New connection: ${pathname} | Room: ${roomCode} | Player: ${playerId}`);

    // Route 1: Host Connection
    if (pathname === '/host') {
        const code = roomCode || generateRoomCode();
        manager.addHost(code, ws);

        // Initialize multi-round room state
        roomsState.set(code, {
            gameState: 'LOBBY',
            currentQuestionIndex: -1,
            questionStartTime: null,
            timeLimit: 15000, // 15 seconds per question
            currentQuestion: null,
            answers: new Map(), // playerId -> { selectedOption, timestamp }
            scores: new Map()   // playerId -> cumulativeScore
        });

        ws.send(JSON.stringify({ event: 'room_created', roomCode: code, totalQuestions: questionsDeck.length }));

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                console.log(`[Host ${code}] Received action:`, message.event);

                const room = roomsState.get(code);
                if (!room) return;

                if (message.event === 'next_question') {
                    room.currentQuestionIndex++;

                    if (room.currentQuestionIndex < questionsDeck.length) {
                        const q = questionsDeck[room.currentQuestionIndex];
                        room.gameState = 'QUESTION_ACTIVE';
                        room.currentQuestion = q;
                        room.questionStartTime = Date.now();
                        room.answers.clear(); // reset answers for this round

                        ws.send(JSON.stringify({
                            event: 'question_started',
                            payload: {
                                questionIndex: room.currentQuestionIndex,
                                totalQuestions: questionsDeck.length,
                                question: q.question,
                                options: q.options,
                                timeLimit: room.timeLimit
                            }
                        }));

                        manager.broadcastToRoom(code, {
                            event: 'show_controller_options',
                            payload: {
                                questionIndex: room.currentQuestionIndex,
                                question: q.question,
                                options: q.options
                            }
                        });
                        console.log(`[Room ${code}] Started Question #${room.currentQuestionIndex + 1}`);
                    } else {
                        room.gameState = 'GAME_OVER';
                        
                        const leaderboard = Array.from(room.scores.entries()).map(([pId, score]) => ({
                            playerId: pId,
                            score
                        })).sort((a, b) => b.score - a.score);

                        ws.send(JSON.stringify({ event: 'game_over', payload: { leaderboard } }));
                        manager.broadcastToRoom(code, { event: 'game_over', payload: { leaderboard } });
                        console.log(`[Room ${code}] Game Over! Final leaderboard compiled.`);
                    }
                }
                // Host ends question manually or timer expires
                else if (message.event === 'end_question') {
                    room.gameState = 'QUESTION_ENDED';

                    const correctOpt = room.currentQuestion.correctOption;
                    const roundResults = [];

                    // Calculate speed-based scores for each submission
                    for (const [pId, submission] of room.answers.entries()) {
                        const isCorrect = (submission.selectedOption === correctOpt);
                        let pointsEarned = 0;

                        if (isCorrect) {
                            const timeElapsed = submission.timestamp - room.questionStartTime; // ms
                            const maxBonus = 500; // max speed bonus points
                            const basePoints = 1000; // correct answer base points
                            
                            // Speed multiplier decay formula (faster = more points)
                            const timeRatio = Math.min(Math.max(timeElapsed / room.timeLimit, 0), 1);
                            const speedBonus = Math.round(maxBonus * (1 - timeRatio));
                            pointsEarned = basePoints + speedBonus;
                        }

                        // Update cumulative scores
                        const currentScore = room.scores.get(pId) || 0;
                        const newScore = currentScore + pointsEarned;
                        room.scores.set(pId, newScore);

                        roundResults.push({
                            playerId: pId,
                            selectedOption: submission.selectedOption,
                            isCorrect,
                            pointsEarned,
                            totalScore: newScore
                        });
                    }

                    // Compile tally for host chart
                    const tally = {};
                    for (const sub of room.answers.values()) {
                        tally[sub.selectedOption] = (tally[sub.selectedOption] || 0) + 1;
                    }

                    const resultsPayload = {
                        correctOption: correctOpt,
                        totalAnswers: room.answers.size,
                        tally: tally,
                        roundResults: roundResults
                    };

                    ws.send(JSON.stringify({ event: 'question_results', payload: resultsPayload }));

                    // Notify players round is over + send their score
                    for (const [pId, wsClient] of (manager.players.get(code) || new Map()).entries()) {
                        const playerResult = roundResults.find(r => r.playerId === pId);
                        wsClient.send(JSON.stringify({
                            event: 'round_over',
                            payload: {
                                correctOption: correctOpt,
                                isCorrect: playerResult ? playerResult.isCorrect : false,
                                pointsEarned: playerResult ? playerResult.pointsEarned : 0,
                                totalScore: playerResult ? playerResult.totalScore : (room.scores.get(pId) || 0)
                            }
                        }));
                    }
                }
            } catch (err) {
                console.error('[Host] Failed to parse message:', err);
            }
        });

        ws.on('close', () => {
            manager.removeHost(code);
            roomsState.delete(code);
        });
    }
    //player conn
    else if (pathname === '/player') {
        if (!roomCode || !playerId) {
            ws.send(JSON.stringify({ error: 'Missing room code or player ID' }));
            ws.close();
            return;
        }

        const roomPlayers = manager.players.get(roomCode);
        let finalPlayerId = playerId;
        if (roomPlayers && roomPlayers.has(playerId)) {
            finalPlayerId = `${playerId}_${Math.floor(Math.random() * 900 + 100)}`;
        }

        manager.addPlayer(roomCode, finalPlayerId, ws);

        // player score shit
        const room = roomsState.get(roomCode);
        if (room && !room.scores.has(finalPlayerId)) {
            room.scores.set(finalPlayerId, 0);
        }

        ws.send(JSON.stringify({ event: 'joined_room', roomCode, playerId: finalPlayerId }));

        manager.sendToHost(roomCode, {
            event: 'player_joined',
            playerId: finalPlayerId,
            totalPlayers: (manager.players.get(roomCode)?.size || 0)
        });

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                
                if (message.event === 'submit_answer') {
                    const currentRoom = roomsState.get(roomCode);
                    if (currentRoom && currentRoom.gameState === 'QUESTION_ACTIVE') {
                        // time of answering
                        if (!currentRoom.answers.has(finalPlayerId)) {
                            currentRoom.answers.set(finalPlayerId, {
                                selectedOption: message.payload.selectedOption,
                                timestamp: Date.now()
                            });

                            console.log(`[Player ${finalPlayerId} in ${roomCode}] Locked in option: ${message.payload.selectedOption}`);

                            ws.send(JSON.stringify({ 
                                event: 'answer_locked', 
                                payload: { selectedOption: message.payload.selectedOption } 
                            }));

                            manager.sendToHost(roomCode, {
                                event: 'answer_progress',
                                payload: {
                                    answeredCount: currentRoom.answers.size,
                                    totalPlayers: (manager.players.get(roomCode)?.size || 0)
                                }
                            });
                        }
                    }
                }
            } catch (err) {
                console.error('[Player] Failed to parse message:', err);
            }
        });

        ws.on('close', () => {
            manager.removePlayer(roomCode, finalPlayerId);
            manager.sendToHost(roomCode, {
                event: 'player_left',
                playerId: finalPlayerId,
                totalPlayers: (manager.players.get(roomCode)?.size || 0)
            });
        });
    } else {
        ws.send(JSON.stringify({ error: 'Unknown route' }));
        ws.close();
    }
});
