const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Database setup with Neon/PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Test connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection error:', err.stack);
    } else {
        console.log('Connected to Neon Database');
        release();
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const HISTORY_LIMIT = 50;
let currentTheme = 'default';
let currentTitle = 'Classroom';

wss.on('connection', async (ws, req) => {
    // Get client IP
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    const port = req.socket.remotePort;

    // Initialize user data
    ws.userData = {
        username: `Guest_${port}`,
        color: getRandomColor(),
        ip,
        isAdmin: false
    };

    console.log(`Connection from ${ip}:${port}`);

    // Send chat history from DB
    try {
        const res = await pool.query(
            'SELECT username, color, content, timestamp FROM chat_messages ORDER BY timestamp ASC LIMIT $1',
            [HISTORY_LIMIT]
        );
        ws.send(JSON.stringify({ type: 'history', content: res.rows }));
    } catch (err) {
        console.error('DB history fetch error:', err);
        ws.send(JSON.stringify({ type: 'history', content: [] }));
    }

    // Send initial state
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
                
                // Handle slash commands first
                if (content.startsWith('/')) {
                    await handleCommand(ws, content);
                    return;
                }

                // Save and broadcast normal message
                await saveAndBroadcast(ws.userData.username, ws.userData.color, content);

                // AI trigger
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
            } else if (data.type === 'tdtu') {
                handleTDTU(ws);
            }
            // Admin secret commands (JSON-based)
            else if (data.type === 'admin_login') {
                ws.userData.isAdmin = true;
                ws.send(JSON.stringify({ type: 'admin_granted' }));
                ws.send(JSON.stringify({
                    type: 'system',
                    content: 'ACCESS GRANTED. Slash commands: /rainbow, /theme <name>, /chattitle <title>, /clearall'
                }));
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

// Handle slash commands
async function handleCommand(ws, content) {
    const parts = content.split(' ');
    const cmd = parts[0].toLowerCase();

    if (cmd === '/ping') {
        ws.send(JSON.stringify({ type: 'pong', startTime: Date.now() }));
        return;
    }

    if (cmd === '/m') {
        handleDM(ws, { target: parts[1], content: parts.slice(2).join(' ') });
        return;
    }

    if (cmd === '/tdtu') {
        handleTDTU(ws);
        return;
    }

    // Admin commands
    if (cmd === '/admin@') {
        ws.userData.isAdmin = true;
        ws.send(JSON.stringify({ type: 'admin_granted' }));
        return;
    }

    if (!ws.userData.isAdmin) {
        ws.send(JSON.stringify({ type: 'system', content: 'Permission denied.' }));
        return;
    }

    switch (cmd) {
        case '/rainbow':
            ws.userData.color = 'rainbow';
            ws.send(JSON.stringify({ type: 'system', content: 'Rainbow mode activated!' }));
            break;
        case '/theme':
            currentTheme = parts[1] || 'default';
            broadcast(JSON.stringify({ type: 'theme', theme: currentTheme }));
            broadcast(JSON.stringify({ type: 'system', content: `Theme changed to ${currentTheme}` }));
            break;
        case '/chattitle':
            currentTitle = parts.slice(1).join(' ') || 'Classroom';
            broadcast(JSON.stringify({ type: 'title', title: currentTitle }));
            broadcast(JSON.stringify({ type: 'system', content: `Title changed to: ${currentTitle}` }));
            break;
        case '/clearall':
            await pool.query('DELETE FROM chat_messages');
            broadcast(JSON.stringify({ type: 'clear_history' }));
            broadcast(JSON.stringify({ type: 'system', content: 'Chat history cleared by Admin.' }));
            break;
        default:
            ws.send(JSON.stringify({ type: 'system', content: 'Unknown command.' }));
    }
}

// Save message to DB and broadcast
async function saveAndBroadcast(username, color, content) {
    const timestamp = Date.now();
    const msg = { type: 'message', username, color, content, timestamp };
    
    try {
        await pool.query(
            'INSERT INTO chat_messages (username, color, content, timestamp) VALUES ($1, $2, $3, $4)',
            [username, color, content, timestamp]
        );
        broadcast(JSON.stringify(msg));
    } catch (err) {
        console.error('DB save error:', err);
    }
}

// AI integration
async function asktdtuAI(userText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return 'AI unavailable (set GEMINI_API_KEY env var).';
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{
                parts: [{
                    text: `You are tdtuAI, helpful & witty classroom chat AI. User: "${userText}". Keep responses concise (<200 chars), chatty. Use live search when needed. No placeholders.`
                }]
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Hmm, not sure about that...";
    } catch (error) {
        console.error('AI error:', error);
        return 'AI brain freeze (check API key/network).';
    }
}

function handleDM(ws, data) {
    const targetName = data.target;
    let targetClient = null;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && 
            client.userData?.username === targetName) {
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
            content: `User '${targetName}' not found.`
        }));
    }
}

function handleTDTU(ws) {
    const asciiArt = `████████╗██████╗ ████████╗██╗   ██╗
╚══██╔══╝██╔══██╗╚══██╔══╝██║   ██║
   ██║   ██║  ██║   ██║   ██║   ██║
   ██║   ██║  ██║   ██║   ██║   ██║
   ██║   ██████╔╝   ██║   ╚██████╔╝
   ╚═╝   ╚═════╝    ╚═╝    ╚═════╝
         #1 UNIVERSITY`;
    
    saveAndBroadcast(ws.userData.username, ws.userData.color, asciiArt);
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
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
    console.log(`Server running on port ${PORT}`);
});
