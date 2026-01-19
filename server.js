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
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS current_chat (
                id SERIAL PRIMARY KEY,
                username VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS history_archive (
                id SERIAL PRIMARY KEY,
                username VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('Database init error:', err);
    }
}

initDatabase();

pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection error:', err.stack);
    } else {
        console.log('✅ Connected to Neon Database');
        release();
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const HISTORY_LIMIT = 50;
let currentTheme = 'default';
let currentTitle = 'Classroom';

wss.on('connection', async (ws, req) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    const port = req.socket.remotePort;

    ws.userData = {
        username: '',
        color: '#00ff00',
        ip,
        isAdmin: false,
        isLoggedIn: false
    };

    console.log(`👤 Connection from ${ip}:${port} (awaiting auth)`);

    // Send theme and title
    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));
    
    // Send system message
    ws.send(JSON.stringify({ 
        type: 'system', 
        content: '🔐 Please login or register to chat. Use /login or /register commands after connecting.' 
    }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'message') {
                const content = data.content.trim();
                
                if (content.startsWith('/')) {
                    await handleCommand(ws, content);
                    return;
                }

                // Only logged-in users can send regular messages
                if (!ws.userData.isLoggedIn) {
                    ws.send(JSON.stringify({ 
                        type: 'system', 
                        content: '❌ Please /login first to send messages.' 
                    }));
                    return;
                }

                await saveAndBroadcast(ws.userData.username, ws.userData.color, content);
            } 
            else if (data.type === 'update_name') {
                if (!ws.userData.isLoggedIn) return;
                const oldName = ws.userData.username;
                const newName = data.content.trim().substring(0, 20) || oldName;
                if (newName !== oldName) {
                    ws.userData.username = newName;
                    broadcast(JSON.stringify({
                        type: 'system',
                        content: `${oldName} is now known as ${newName}`
                    }));
                }
            } 
            else if (data.type === 'update_color') {
                if (!ws.userData.isLoggedIn) return;
                ws.userData.color = data.content;
            } 
            else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', startTime: data.startTime }));
            } 
            else if (data.type === 'dm') {
                if (!ws.userData.isLoggedIn) return;
                handleDM(ws, data);
            }
        } catch (e) {
            console.error('Message parse error:', e);
        }
    });

    ws.on('close', () => {
        if (ws.userData.isLoggedIn) {
            broadcast(JSON.stringify({
                type: 'system',
                content: `${ws.userData.username} disconnected.`
            }));
        }
    });
});

async function handleCommand(ws, content) {
    const parts = content.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    if (cmd === '/?') {
        const publicCmds = '📋 COMMANDS: /login <user> <pass> /register <user> <pass> /note <text> /ping /m <user> <msg> /tdtu /cls\n🔐 ADMIN: /admin@ /rainbow /theme <name> /chattitle <title> /clearall /viewdatabase /archiveprune';
        ws.send(JSON.stringify({ type: 'system', content: publicCmds }));
        return;
    }

    // AUTH COMMANDS (always available)
    if (cmd === '/register') {
        const [regUser, regPass] = parts.slice(1);
        if (!regUser || !regPass) {
            ws.send(JSON.stringify({ type: 'system', content: '❌ Usage: /register <user> <pass>' }));
            return;
        }
        
        if (regUser.length > 20 || regPass.length < 4) {
            ws.send(JSON.stringify({ type: 'system', content: '❌ Username ≤20 chars, Password ≥4 chars' }));
            return;
        }

        try {
            // Check if user exists
            const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [regUser]);
            if (existingUser.rows.length > 0) {
                ws.send(JSON.stringify({ type: 'system', content: '❌ Username already taken.' }));
                return;
            }

            const hash = await bcrypt.hash(regPass, 10);
            await pool.query(
                'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
                [regUser, hash]
            );
            
            ws.send(JSON.stringify({ 
                type: 'auth_success',
                form: 'signup',
                message: '✅ Account created! Please login.'
            }));
        } catch (e) { 
            ws.send(JSON.stringify({ type: 'system', content: '❌ Registration failed.' })); 
        }
        return;
    }

    if (cmd === '/login') {
        const [logUser, logPass] = parts.slice(1);
        if (!logUser || !logPass) {
            ws.send(JSON.stringify({ type: 'system', content: '❌ Usage: /login <user> <pass>' }));
            return;
        }

        try {
            const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [logUser]);
            if (userRes.rows.length === 0) {
                ws.send(JSON.stringify({ 
                    type: 'auth_error', 
                    form: 'login',
                    message: '❌ User not found. Register first.'
                }));
                return;
            }

            const user = userRes.rows[0];
            if (await bcrypt.compare(logPass, user.password_hash)) {
                ws.userData.username = logUser;
                ws.userData.isLoggedIn = true;
                ws.userData.color = getRandomColor();
                
                // Update last login
                await pool.query(
                    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = $1',
                    [logUser]
                );

                ws.send(JSON.stringify({ 
                    type: 'init', 
                    username: logUser, 
                    color: ws.userData.color,
                    authenticated: true 
                }));
                ws.send(JSON.stringify({ 
                    type: 'auth_success',
                    form: 'login',
                    message: `🔓 Welcome back, ${logUser}!` 
                }));

                // Load chat history for new login
                try {
                    const res = await pool.query(
                        'SELECT username, content, timestamp FROM current_chat ORDER BY timestamp ASC LIMIT $1',
                        [HISTORY_LIMIT]
                    );
                    ws.send(JSON.stringify({ type: 'history', content: res.rows }));
                } catch (err) {
                    console.error('History load error:', err);
                }

                broadcast(JSON.stringify({ 
                    type: 'system', 
                    content: `${logUser} joined the chat.` 
                }));
            } else { 
                ws.send(JSON.stringify({ 
                    type: 'auth_error',
                    form: 'login',
                    message: '❌ Invalid password.'
                })); 
            }
        } catch (e) { 
            ws.send(JSON.stringify({ type: 'system', content: '❌ Login failed.' })); 
        }
        return;
    }

    // LOGIN REQUIRED COMMANDS
    if (!ws.userData.isLoggedIn) {
        ws.send(JSON.stringify({ type: 'system', content: '❌ Please /login first.' }));
        return;
    }

    if (cmd === '/note') {
        if (!args) {
            try {
                const noteRes = await pool.query(
                    'SELECT personal_note FROM users WHERE username = $1', 
                    [ws.userData.username]
                );
                const note = noteRes.rows[0]?.personal_note || '[No note]';
                ws.send(JSON.stringify({ 
                    type: 'system', 
                    content: `📝 Your note: ${note}` 
                }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'system', content: '❌ Note read failed.' }));
            }
        } else {
            try {
                await pool.query(
                    'UPDATE users SET personal_note = $1 WHERE username = $2', 
                    [args.substring(0, 500), ws.userData.username]
                );
                ws.send(JSON.stringify({ type: 'system', content: '✅ Note saved!' }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'system', content: '❌ Note save failed.' }));
            }
        }
        return;
    }

    // PUBLIC COMMANDS
    if (cmd === '/ping') {
        ws.send(JSON.stringify({ type: 'pong', startTime: Date.now() }));
        return;
    }

    if (cmd === '/tdtu') {
        const asciiArt = `████████╗██████╗ ████████╗██╗   ██╗
╚══██╔══╝██╔══██╗╚══██╔══╝██║   ██║
   ██║   ██║  ██║   ██║   ██║   ██║
   ██║   ██║  ██║   ██║   ██║   ██║
   ██║   ██████╔╝   ██║   ╚██████╔╝
   ╚═╝   ╚═════╝    ╚═╝    ╚═════╝
         #1 UNIVERSITY`;
        saveAndBroadcast('SYSTEM', '#00ff00', asciiArt);
        return;
    }

    if (cmd === '/m') {
        handleDM(ws, { target: parts[1], content: parts.slice(2).join(' ') });
        return;
    }

    // ADMIN COMMANDS
    if (cmd === '/admin@') {
        ws.userData.isAdmin = true;
        ws.send(JSON.stringify({ type: 'admin_granted' }));
        ws.send(JSON.stringify({
            type: 'system',
            content: '🔐 ADMIN: /rainbow /theme <name> /chattitle <title> /clearall /viewdatabase /archiveprune'
        }));
        return;
    }

    if (!ws.userData.isAdmin) {
        ws.send(JSON.stringify({ type: 'system', content: '❌ Admin required.' }));
        return;
    }

    switch (cmd) {
        case '/rainbow':
            ws.userData.color = 'rainbow';
            ws.send(JSON.stringify({ type: 'system', content: '🌈 Rainbow mode ON!' }));
            break;
        case '/theme':
            currentTheme = parts[1] || 'default';
            broadcast(JSON.stringify({ type: 'theme', theme: currentTheme }));
            broadcast(JSON.stringify({ type: 'system', content: `🎨 Theme: ${currentTheme}` }));
            break;
        case '/chattitle':
            currentTitle = parts.slice(1).join(' ') || 'Classroom';
            broadcast(JSON.stringify({ type: 'title', title: currentTitle }));
            broadcast(JSON.stringify({ type: 'system', content: `📝 Title: ${currentTitle}` }));
            break;
        case '/clearall':
            try {
                const currentRes = await pool.query('SELECT * FROM current_chat ORDER BY id DESC LIMIT 100');
                for (const row of currentRes.rows) {
                    await pool.query(
                        'INSERT INTO history_archive (username, content, timestamp) VALUES ($1, $2, $3)',
                        [row.username, row.content, row.timestamp]
                    );
                }
                await pool.query(`
                    DELETE FROM history_archive 
                    WHERE id NOT IN (
                        SELECT id FROM (
                            SELECT id FROM history_archive ORDER BY id DESC LIMIT 500
                        ) AS top500
                    )
                `);
                await pool.query('DELETE FROM current_chat');
                broadcast(JSON.stringify({ type: 'clear_history' }));
                broadcast(JSON.stringify({ type: 'system', content: '🗑️ Chat cleared + archived.' }));
            } catch (err) {
                console.error('Clear error:', err);
                ws.send(JSON.stringify({ type: 'system', content: '❌ Clear failed.' }));
            }
            break;
        case '/viewdatabase':
            try {
                const res = await pool.query(
                    'SELECT id, username, content, timestamp FROM current_chat ORDER BY id DESC LIMIT 100'
                );
                ws.send(JSON.stringify({ 
                    type: 'database_view', 
                    data: res.rows,
                    total: res.rowCount 
                }));
            } catch (err) {
                console.error('DB view error:', err);
                ws.send(JSON.stringify({ type: 'system', content: '❌ Database error.' }));
            }
            break;
        case '/archiveprune':
            try {
                const deleted = await pool.query(
                    "DELETE FROM history_archive WHERE timestamp < NOW() - INTERVAL '7 days' RETURNING *"
                );
                ws.send(JSON.stringify({ type: 'system', content: `📦 Pruned ${deleted.rowCount} old messages.` }));
            } catch (err) {
                ws.send(JSON.stringify({ type: 'system', content: '❌ Prune failed.' }));
            }
            break;
        default:
            ws.send(JSON.stringify({ type: 'system', content: '❓ Unknown command. Type /?' }));
    }
}

async function saveAndBroadcast(username, color, content) {
    const timestamp = new Date().toISOString();
    const msg = { type: 'message', username, color, content, timestamp };
    
    try {
        await pool.query(
            'INSERT INTO current_chat (username, content, timestamp) VALUES ($1, $2, $3)',
            [username, content, timestamp]
        );
        await pool.query(`
            DELETE FROM history_archive 
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id FROM history_archive ORDER BY id DESC LIMIT 500
                ) AS top500
            )
        `);
        await pool.query(
            'INSERT INTO history_archive (username, content, timestamp) VALUES ($1, $2, $3)',
            [username, content, timestamp]
        );
        broadcast(JSON.stringify(msg));
    } catch (err) {
        console.error('DB save error:', err);
    }
}

function handleDM(ws, data) {
    const targetName = data.target;
    let targetClient = null;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && 
            client.userData?.username === targetName &&
            client.userData.isLoggedIn) {
            targetClient = client;
        }
    });

    if (targetClient) {
        const dmData = {
            type: 'dm',
            from: ws.userData.username,
            to: targetName,
            color: ws.userData.color,
            content: data.content
        };
        targetClient.send(JSON.stringify(dmData));
        ws.send(JSON.stringify(dmData));
    } else {
        ws.send(JSON.stringify({
            type: 'system',
            content: `👤 '${targetName}' not online.`
        }));
    }
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.userData.isLoggedIn) {
            client.send(data);
        }
    });
}

function getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 60%)`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
