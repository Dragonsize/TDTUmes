const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize database tables
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(20) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                personal_note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS current_chat (
                id SERIAL PRIMARY KEY,
                username VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS history_archive (
                id SERIAL PRIMARY KEY,
                username VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('Database init error:', err);
        process.exit(1); // Stop if DB fails
    }
}

app.use(express.static(path.join(__dirname, 'public')));

const HISTORY_LIMIT = 50;
let currentTheme = 'default';
let currentTitle = 'Classroom';

wss.on('connection', async (ws, req) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    ws.userData = { username: '', color: '#00ff00', ip, isAdmin: false, isLoggedIn: false };

    // Initial state sync
    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));
    ws.send(JSON.stringify({ type: 'system', content: '🔐 Welcome! Please /login or /register.' }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'message') {
                const content = data.content.trim();
                if (content.startsWith('/')) {
                    await handleCommand(ws, content);
                } else if (ws.userData.isLoggedIn) {
                    await saveAndBroadcast(ws.userData.username, ws.userData.color, content);
                } else {
                    ws.send(JSON.stringify({ type: 'system', content: '❌ Please /login first.' }));
                }
            } else if (data.type === 'update_color' && ws.userData.isLoggedIn) {
                ws.userData.color = data.content;
            }
        } catch (e) { console.error('WS Error:', e); }
    });
});

async function handleCommand(ws, content) {
    const parts = content.split(' ');
    const cmd = parts[0].toLowerCase();
    
    // --- AUTHENTICATION HANDLER ---
    if (cmd === '/register' || cmd === '/login') {
        const [username, password] = parts.slice(1);
        if (!username || !password) {
            ws.send(JSON.stringify({ type: 'system', content: `❌ Usage: ${cmd} <user> <pass>` }));
            return;
        }

        try {
            if (cmd === '/register') {
                if (username.length > 20 || password.length < 4) {
                    ws.send(JSON.stringify({ type: 'system', content: '❌ Name ≤20, Pass ≥4 chars' }));
                    return;
                }
                const check = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
                if (check.rows.length > 0) {
                    ws.send(JSON.stringify({ type: 'auth_error', form: 'signup', message: '❌ Username taken' }));
                    return;
                }
                const hash = await bcrypt.hash(password, 10);
                await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]);
            } else {
                const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
                if (userRes.rows.length === 0 || !(await bcrypt.compare(password, userRes.rows[0].password_hash))) {
                    ws.send(JSON.stringify({ type: 'auth_error', form: 'login', message: '❌ Invalid credentials' }));
                    return;
                }
            }

            // LOGIN SUCCESS (Auto-login after register OR normal login)
            ws.userData.username = username;
            ws.userData.isLoggedIn = true;
            ws.userData.color = getRandomColor();

            await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = $1', [username]);

            ws.send(JSON.stringify({ type: 'init', username, color: ws.userData.color, authenticated: true }));
            ws.send(JSON.stringify({ type: 'auth_success', message: '🔓 Access Granted' }));

            const history = await pool.query('SELECT username, content, timestamp FROM current_chat ORDER BY timestamp ASC LIMIT $1', [HISTORY_LIMIT]);
            ws.send(JSON.stringify({ type: 'history', content: history.rows }));
            broadcast(JSON.stringify({ type: 'system', content: `${username} joined.` }));

        } catch (e) { ws.send(JSON.stringify({ type: 'system', content: '❌ Auth failed' })); }
        return;
    }

    // --- OTHER COMMANDS (Only if logged in) ---
    if (!ws.userData.isLoggedIn) return;
    
    if (cmd === '/admin@') {
        ws.userData.isAdmin = true;
        ws.send(JSON.stringify({ type: 'admin_granted' }));
    } else if (cmd === '/cls') {
        ws.send(JSON.stringify({ type: 'clear_history' }));
    }
}

async function saveAndBroadcast(username, color, content) {
    const timestamp = new Date().toISOString();
    await pool.query('INSERT INTO current_chat (username, content, timestamp) VALUES ($1, $2, $3)', [username, content, timestamp]);
    broadcast(JSON.stringify({ type: 'message', username, color, content, timestamp }));
}

function broadcast(data) {
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN && c.userData.isLoggedIn) c.send(data); });
}

function getRandomColor() { return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`; }

const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
    server.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
});
