const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 1. NEON DATABASE SETUP
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Test DB Connection on Startup
pool.connect((err, client, release) => {
    if (err) return console.error('Error acquiring client', err.stack);
    console.log('Successfully connected to Neon Database');
    release();
});

app.use(express.static(path.join(__dirname, 'public')));

// GLOBAL STATE (Stored in memory, reset on server sleep)
let currentTheme = 'default';
let currentTitle = "Classroom";
const HISTORY_LIMIT = 50;

wss.on('connection', async (ws, req) => {
    // GET CLIENT IP
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.indexOf(',') > -1) ip = ip.split(',')[0];
    
    const port = req.socket.remotePort;

    // INITIALIZE USER STATE
    ws.userData = {
        username: `Guest_${port}`,
        color: getRandomColor(),
        ip: ip,
        isAdmin: false
    };

    console.log(`User connected: ${ip}:${port}`);

    // 2. FETCH HISTORY FROM NEON
    try {
        const res = await pool.query(
            'SELECT username, color, content FROM chat_messages ORDER BY timestamp ASC LIMIT $1', 
            [HISTORY_LIMIT]
        );
        ws.send(JSON.stringify({ type: 'history', content: res.rows }));
    } catch (err) {
        console.error("Database Fetch Error:", err);
    }

    // SEND INITIAL STATE
    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));
    ws.send(JSON.stringify({ type: 'init', username: ws.userData.username }));

    broadcast(JSON.stringify({
        type: 'system',
        content: `User ${ws.userData.username} joined the chat.`
    }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            // --- COMMAND LOGIC ---
            if (data.type === 'message' && data.content.startsWith('/')) {
                const parts = data.content.split(' ');
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
                    const art = `\n████████╗██████╗ \n╚══██╔══╝██╔══██╗\n   ██║   ██║  ██║\n   ██║   ██████╔╝\n   ╚═╝   ╚═════╝ `;
                    await saveAndBroadcast(ws.userData.username, ws.userData.color, art);
                    return;
                }

                // ADMIN COMMANDS
                if (cmd === '/admin@') { // Your secret admin trigger
                    ws.userData.isAdmin = true;
                    ws.send(JSON.stringify({ type: 'admin_granted' }));
                    return;
                }

                if (ws.userData.isAdmin) {
                    if (cmd === '/rainbow') {
                        ws.userData.color = 'rainbow';
                        ws.send(JSON.stringify({ type: 'system', content: 'Rainbow mode active!' }));
                    } else if (cmd === '/theme') {
                        currentTheme = parts[1] || 'default';
                        broadcast(JSON.stringify({ type: 'theme', theme: currentTheme }));
                    } else if (cmd === '/chattitle') {
                        currentTitle = parts.slice(1).join(' ');
                        broadcast(JSON.stringify({ type: 'title', title: currentTitle }));
                    } else if (cmd === '/clearall') {
                        await pool.query('DELETE FROM chat_messages');
                        broadcast(JSON.stringify({ type: 'clear_history' }));
                        broadcast(JSON.stringify({ type: 'system', content: 'Chat history wiped by Admin.' }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'system', content: 'Permission denied.' }));
                }
                return;
            }

            // --- NORMAL MESSAGE LOGIC ---
            if (data.type === 'message') {
                await saveAndBroadcast(ws.userData.username, ws.userData.color, data.content);

                // AI TRIGGER
                const lowerMsg = data.content.toLowerCase().trim();
                if (lowerMsg.startsWith("hey tdtuai")) {
                    const prompt = data.content.substring(10).trim();
                    const aiResponse = await askAI(prompt || "Hello!");
                    await saveAndBroadcast("tdtuAI (AI)", "#00ccff", aiResponse);
                }
            } 
            
            // --- PROFILE UPDATES ---
            else if (data.type === 'update_name') {
                const oldName = ws.userData.username;
                ws.userData.username = data.content.trim().substring(0, 15) || oldName;
                broadcast(JSON.stringify({ type: 'system', content: `${oldName} changed name to ${ws.userData.username}` }));
            }
            else if (data.type === 'update_color') {
                ws.userData.color = data.content;
            }

        } catch (e) { console.error("Message Error:", e); }
    });

    ws.on('close', () => {
        broadcast(JSON.stringify({ type: 'system', content: `User ${ws.userData.username} disconnected.` }));
    });
});

// HELPERS
async function saveAndBroadcast(user, color, content) {
    const timestamp = Date.now();
    try {
        await pool.query(
            'INSERT INTO chat_messages (username, color, content, timestamp) VALUES ($1, $2, $3, $4)',
            [user, color, content, timestamp]
        );
        broadcast(JSON.stringify({ type: 'message', username: user, color: color, content: content }));
    } catch (e) { console.error("Save Error:", e); }
}

function handleDM(ws, data) {
    wss.clients.forEach((client) => {
        if (client.userData.username === data.target) {
            const dm = JSON.stringify({ type: 'dm', from: ws.userData.username, to: data.target, content: data.content, color: ws.userData.color });
            client.send(dm);
            ws.send(dm);
        }
    });
}

async function askAI(userText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "API key missing in Render variables.";
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: userText }] }] })
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm lost for words...";
    } catch (e) { return "AI connection error."; }
}

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

function getRandomColor() {
    return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
