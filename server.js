const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 1. NEON DATABASE CONNECTION
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.static(path.join(__dirname, 'public')));

const HISTORY_LIMIT = 50;
let currentTheme = 'default';
let currentTitle = "Classroom"; 

wss.on('connection', async (ws, req) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.indexOf(',') > -1) ip = ip.split(',')[0];
    const port = req.socket.remotePort;

    ws.userData = { username: `${port}`, color: getRandomColor(), ip: ip, isAdmin: false };

    // 2. FETCH HISTORY FROM NEON
    try {
        const res = await pool.query(
            'SELECT username, color, content FROM chat_messages ORDER BY timestamp ASC LIMIT $1', 
            [HISTORY_LIMIT]
        );
        ws.send(JSON.stringify({ type: 'history', content: res.rows }));
    } catch (err) {
        console.error("DB History Error:", err);
    }

    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));
    ws.send(JSON.stringify({ type: 'init', username: ws.userData.username, color: ws.userData.color }));

    broadcast(JSON.stringify({ type: 'system', content: `User ${ws.userData.username} joined.` }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'message') {
                const msgObject = {
                    username: ws.userData.username,
                    color: ws.userData.color,
                    content: data.content,
                    timestamp: Date.now()
                };

                // 3. SAVE MESSAGE TO NEON
                await pool.query(
                    'INSERT INTO chat_messages (username, color, content, timestamp) VALUES ($1, $2, $3, $4)',
                    [msgObject.username, msgObject.color, msgObject.content, msgObject.timestamp]
                );

                broadcast(JSON.stringify({ type: 'message', ...msgObject }));

                // AI TRIGGER
                if (data.content.toLowerCase().startsWith("hey tdtuai")) {
                    const prompt = data.content.substring(10).trim();
                    const aiResponse = await asktdtuAIAI(prompt);
                    const aiMsg = { username: "tdtuAI (AI)", color: "#00ccff", content: aiResponse, timestamp: Date.now() };
                    
                    await pool.query(
                        'INSERT INTO chat_messages (username, color, content, timestamp) VALUES ($1, $2, $3, $4)',
                        [aiMsg.username, aiMsg.color, aiMsg.content, aiMsg.timestamp]
                    );
                    broadcast(JSON.stringify({ type: 'message', ...aiMsg }));
                }
            } 
            else if (data.type === 'clear_chat' && ws.userData.isAdmin) {
                // 4. PERMANENT WIPE
                await pool.query('DELETE FROM chat_messages');
                broadcast(JSON.stringify({ type: 'clear_history' }));
                broadcast(JSON.stringify({ type: 'system', content: 'History cleared by Admin.' }));
            }
            else if (data.type === 'tdtu') {
                handleTDTU(ws);
            }
            else if (data.type === 'admin_login') {
                ws.userData.isAdmin = true;
                ws.send(JSON.stringify({ type: 'admin_granted' }));
            }
            // Add your other handlers (update_name, ping, etc.) here...
        } catch (e) { console.error("Msg Error:", e); }
    });
});

async function asktdtuAIAI(userText) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "API Key missing!";
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: userText }] }] })
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
    } catch (e) { return "AI Error."; }
}

async function handleTDTU(ws) {
    const art = "████████╗██████╗ ████████╗██╗   ██╗\n╚══██╔══╝██╔══██╗╚══██╔══╝██║   ██║\n   ██║   ██║  ██║   ██║   ██║   ██║\n   ██║   ██████╔╝   ██║   ╚██████╔╝";
    const msg = { username: ws.userData.username, color: ws.userData.color, content: art, timestamp: Date.now() };
    await pool.query('INSERT INTO chat_messages (username, color, content, timestamp) VALUES ($1, $2, $3, $4)', [msg.username, msg.color, msg.content, msg.timestamp]);
    broadcast(JSON.stringify({ type: 'message', ...msg }));
}

function broadcast(data) {
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

function getRandomColor() { return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`; }

server.listen(process.env.PORT || 3000, () => console.log(`Server started`));
