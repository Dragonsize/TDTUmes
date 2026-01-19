const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); // Added for secure passwords

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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
        username: `Guest_${port}`,
        color: getRandomColor(),
        ip,
        isAdmin: false,
        isLoggedIn: false // Track authentication state
    };

    console.log(`👤 Connection from ${ip}:${port}`);

    try {
        const res = await pool.query(
            'SELECT username, content, timestamp FROM current_chat ORDER BY timestamp ASC LIMIT $1',
            [HISTORY_LIMIT]
        );
        ws.send(JSON.stringify({ type: 'history', content: res.rows }));
    } catch (err) {
        console.error('DB history fetch error:', err);
        ws.send(JSON.stringify({ type: 'history', content: [] }));
    }

    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));
    ws.send(JSON.stringify({
        type: 'init',
        username: ws.userData.username,
        color: ws.userData.color
    }));

    broadcast(JSON.stringify({
        type: 'system',
        content: `${ws.userData.username} joined the chat.`
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

                await saveAndBroadcast(ws.userData.username, ws.userData.color, content);

                const lowerMsg = content.toLowerCase();
                if (lowerMsg.startsWith('hey tdtuai') || lowerMsg.startsWith('hey tdtuAI')) {
                    const prompt = content.substring(10).trim() || 'Hello!';
                    const aiResponse = await asktdtuAI(prompt);
                    await saveAndBroadcast('tdtuAI (AI)', '#00ccff', aiResponse);
                }
            } else if (data.type === 'update_name') {
                const oldName = ws.userData.username;
                const newName = data.content.trim().substring(0, 20) || oldName;
                if (newName !== oldName) {
                    ws.userData.username = newName;
                    broadcast(JSON.stringify({
                        type: 'system',
                        content: `${oldName} is now known as ${newName}`
                    }));
                }
            } else if (data.type === 'update_color') {
                ws.userData.color = data.content;
            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', startTime: data.startTime }));
            } else if (data.type === 'dm') {
                handleDM(ws, data);
            }
        } catch (e) {
            console.error('Message parse error:', e);
        }
    });

    ws.on('close', () => {
        broadcast(JSON.stringify({
            type: 'system',
            content: `${ws.userData.username} disconnected.`
        }));
    });
});

async function handleCommand(ws, content) {
    const parts = content.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    if (cmd === '/?') {
        const publicCmds = '📋 PUBLIC: /register <u..> <p..> /login <u..> <p..> /note <text> /ping /m <user> <msg> /tdtu /cls\n🔐 ADMIN: /admin@ /rainbow /theme <name> /chattitle <title> /clearall /viewdatabase /archiveprune';
        ws.send(JSON.stringify({ type: 'system', content: publicCmds }));
        return;
    }

    // --- ACCOUNT SYSTEM COMMANDS ---
    if (cmd === '/register') {
        const [regUser, regPass] = parts.slice(1);
        if (!regUser || !regPass) return ws.send(JSON.stringify({ type: 'system', content: '❌ Usage: /register <user> <pass>' }));
        try {
            const hash = await bcrypt.hash(regPass, 10);
            await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [regUser, hash]);
            ws.send(JSON.stringify({ type: 'system', content: '✅ Account created! Use /login to sign in.' }));
        } catch (e) { ws.send(JSON.stringify({ type: 'system', content: '❌ Username taken.' })); }
        return;
    }

    if (cmd === '/login') {
        const [logUser, logPass] = parts.slice(1);
        try {
            const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [logUser]);
            if (userRes.rows.length > 0 && await bcrypt.compare(logPass, userRes.rows[0].password_hash)) {
                ws.userData.username = logUser;
                ws.userData.isLoggedIn = true;
                ws.send(JSON.stringify({ type: 'init', username: logUser }));
                ws.send(JSON.stringify({ type: 'system', content: `🔓 Welcome back, ${logUser}!` }));
            } else { ws.send(JSON.stringify({ type: 'system', content: '❌ Invalid username or password.' })); }
        } catch (e) { ws.send(JSON.stringify({ type: 'system', content: '❌ Login failed.' })); }
        return;
    }

    if (cmd === '/note') {
        if (!ws.userData.isLoggedIn) return ws.send(JSON.stringify({ type: 'system', content: '❌ Please /login to use notes.' }));
        if (!args) {
            const noteRes = await pool.query('SELECT personal_note FROM users WHERE username = $1', [ws.userData.username]);
            ws.send(JSON.stringify({ type: 'system', content: `📝 Personal Note: ${noteRes.rows[0].personal_note || '[Empty]'}` }));
        } else {
            await pool.query('UPDATE users SET personal_note = $1 WHERE username = $2', [args, ws.userData.username]);
            ws.send(JSON.stringify({ type: 'system', content: '✅ Personal note saved.' }));
        }
        return;
    }

    // --- ORIGINAL COMMANDS ---
    if (cmd === '/tdtu') {
        const art = "\n████████╗██████╗ ████████╗██╗   ██╗\n╚══██╔══╝██╔══██╗╚══██╔══╝██║   ██║\n   ██║   ██║  ██║   ██║   ██║   ██║\n   ██║   ██║  ██║   ██║   ██║   ██║\n   ██║   ██████╔╝   ██║   ╚██████╔╝\n   ╚═╝   ╚═════╝    ╚═╝    ╚═════╝";
        broadcast(JSON.stringify({ type: 'message', username: 'SYSTEM', content: art, color: '#00ff00', timestamp: new Date() }));
        return;
    }

    if (cmd === '/ping') {
        ws.send(JSON.stringify({ type: 'pong', startTime: Date.now() }));
        return;
    }

    if (cmd === '/m') {
        handleDM(ws, { target: parts[1], content: parts.slice(2).join(' ') });
        return;
    }

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
        ws.send(JSON.stringify({ type: 'system', content: '❌ Permission denied.' }));
        return;
    }

    switch (cmd) {
        case '/rainbow':
            ws.userData.color = 'rainbow';
            ws.send(JSON.stringify({ type: 'system', content: '🌈 Rainbow mode activated!' }));
            break;
        case '/theme':
            currentTheme = parts[1] || 'default';
            broadcast(JSON.stringify({ type: 'theme', theme: currentTheme }));
            broadcast(JSON.stringify({ type: 'system', content: `🎨 Theme changed to ${currentTheme}` }));
            break;
        case '/chattitle':
            currentTitle = parts.slice(1).join(' ') || 'Classroom';
            broadcast(JSON.stringify({ type: 'title', title: currentTitle }));
            broadcast(JSON.stringify({ type: 'system', content: `📝 Title changed to: ${currentTitle}` }));
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
                await pool.query('DELETE FROM current_chat');
                broadcast(JSON.stringify({ type: 'clear_history' }));
                broadcast(JSON.stringify({ type: 'system', content: '🗑️ Chat cleared. History archived.' }));
            } catch (err) {
                console.error('Clear error:', err);
                ws.send(JSON.stringify({ type: 'system', content: '❌ Clear failed.' }));
            }
            break;
        case '/viewdatabase':
            try {
                const res = await pool.query('SELECT id, username, content, timestamp FROM current_chat ORDER BY id DESC LIMIT 100');
                ws.send(JSON.stringify({ type: 'database_view', data: res.rows, total: res.rowCount }));
            } catch (err) {
                ws.send(JSON.stringify({ type: 'system', content: `❌ DB Error.` }));
            }
            break;
        case '/archiveprune':
            try {
                const deleted = await pool.query("DELETE FROM history_archive WHERE timestamp < NOW() - INTERVAL '7 days' RETURNING id");
                ws.send(JSON.stringify({ type: 'system', content: `📦 Archive pruned: ${deleted.rowCount} msgs removed.` }));
            } catch (err) { ws.send(JSON.stringify({ type: 'system', content: '❌ Prune error.' })); }
            break;
        default:
            ws.send(JSON.stringify({ type: 'system', content: '❓ Unknown command. Type /?' }));
    }
}

async function saveAndBroadcast(username, color, content) {
    const timestamp = new Date().toISOString();
    const msg = { type: 'message', username, color, content, timestamp };
    try {
        await pool.query('INSERT INTO current_chat (username, content, timestamp) VALUES ($1, $2, $3)', [username, content, timestamp]);
        broadcast(JSON.stringify(msg));
    } catch (err) { console.error('DB save error:', err); }
}

async function asktdtuAI(userText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return '🤖 AI unavailable (set GEMINI_API_KEY).';
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
        const payload = { contents: [{ parts: [{ text: `You are tdtuAI, helpful classroom chat AI. User: "${userText}". Keep responses concise (<200 chars).` }] }] };
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "🤔 Not sure...";
    } catch (error) { return '🤖 AI error.'; }
}

function handleDM(ws, data) {
    const targetName = data.target;
    let targetClient = null;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.userData?.username === targetName) targetClient = client;
    });
    if (targetClient) {
        const dmData = { type: 'dm', from: ws.userData.username, to: targetName, color: ws.userData.color, content: data.content };
        targetClient.send(JSON.stringify(dmData));
        ws.send(JSON.stringify(dmData));
    } else { ws.send(JSON.stringify({ type: 'system', content: `👤 User '${targetName}' not found.` })); }
}

function broadcast(data) {
    wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(data); });
}

function getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 60%)`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
