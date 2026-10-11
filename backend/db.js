const { Pool } = require('pg');

// Use DATABASE_URL environment variable from Supabase/Render, or fallback for local dev
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
    console.log('[DB] Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client', err);
    process.exit(-1);
});

// Initialize Tables
const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rooms (
                room_code TEXT PRIMARY KEY,
                game_state TEXT,
                current_question_index INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                room_code TEXT,
                player_id TEXT,
                score INTEGER DEFAULT 0,
                UNIQUE(room_code, player_id),
                FOREIGN KEY(room_code) REFERENCES rooms(room_code) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_history (
                id SERIAL PRIMARY KEY,
                room_code TEXT,
                question_index INTEGER,
                player_id TEXT,
                selected_option INTEGER,
                is_correct BOOLEAN,
                points_awarded INTEGER,
                answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[DB] Database tables initialized successfully.');
    } catch (err) {
        console.error('[DB] Failed to initialize tables:', err.message);
    }
};

initDb();

module.exports = {
    saveRoomState: async (roomCode, gameState, questionIndex) => {
        try {
            await pool.query(
                `INSERT INTO rooms (room_code, game_state, current_question_index) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (room_code) DO UPDATE SET 
                 game_state = EXCLUDED.game_state, 
                 current_question_index = EXCLUDED.current_question_index`,
                [roomCode, gameState, questionIndex]
            );
        } catch (err) {
            console.error('[DB] Error saving room state:', err.message);
        }
    },

    savePlayerScore: async (roomCode, playerId, score) => {
        try {
            await pool.query(
                `INSERT INTO players (room_code, player_id, score) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (room_code, player_id) DO UPDATE SET score = EXCLUDED.score`,
                [roomCode, playerId, score]
            );
        } catch (err) {
            console.error('[DB] Error saving player score:', err.message);
        }
    },

    logAnswer: async (roomCode, questionIndex, playerId, selectedOption, isCorrect, pointsAwarded) => {
        try {
            await pool.query(
                `INSERT INTO game_history (room_code, question_index, player_id, selected_option, is_correct, points_awarded) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [roomCode, questionIndex, playerId, selectedOption, isCorrect, pointsAwarded]
            );
        } catch (err) {
            console.error('[DB] Error logging answer:', err.message);
        }
    },

    pool
};
