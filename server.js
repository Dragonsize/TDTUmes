const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Store last 50 messages
const chatHistory = [];
const HISTORY_LIMIT = 50;

// Store global state
let currentTheme = 'default';
let currentTitle = "Classroom"; // Default Title Changed

wss.on('connection', (ws, req) => {
    // 1. Get Client Info
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.indexOf(',') > -1) {
        ip = ip.split(',')[0];
    }
    
    const port = req.socket.remotePort;

    // 2. Initialize User State
    ws.userData = {
        username: `${port}`,
        color: getRandomColor(),
        ip: ip,
        isAdmin: false // Admin privilege flag
    };

    console.log(`Connection from ${ip}:${port}`);

    // 3. Send Initial Data (History, Theme, Title, Init User)
    ws.send(JSON.stringify({
        type: 'history',
        content: chatHistory
    }));

    ws.send(JSON.stringify({
        type: 'theme',
        theme: currentTheme
    }));

    ws.send(JSON.stringify({
        type: 'title',
        title: currentTitle
    }));

    // Notify others
    broadcast(JSON.stringify({
        type: 'system',
        content: `User ${ws.userData.username} joined the chat.`
    }));

    // Send init data to user
    ws.send(JSON.stringify({
        type: 'init',
        username: ws.userData.username,
        color: ws.userData.color
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'message') {
                const msgObject = {
                    type: 'message',
                    username: ws.userData.username,
                    color: ws.userData.color,
                    content: data.content,
                    timestamp: Date.now()
                };

                chatHistory.push(msgObject);
                if (chatHistory.length > HISTORY_LIMIT) chatHistory.shift();

                broadcast(JSON.stringify(msgObject));
            } 
            else if (data.type === 'update_name') {
                const oldName = ws.userData.username;
                const newName = data.content.trim().substring(0, 20);
                if (newName && newName !== oldName) {
                    ws.userData.username = newName;
                    broadcast(JSON.stringify({
                        type: 'system',
                        content: `${oldName} is now known as ${newName}`
                    }));
                }
            }
            else if (data.type === 'update_color') {
                ws.userData.color = data.content;
            }
            else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', startTime: data.startTime }));
            }
            else if (data.type === 'dm') {
                handleDM(ws, data);
            }
            else if (data.type === 'tdtu') {
                handleTDTU(ws);
            }
            // --- SECRET COMMANDS ---
            else if (data.type === 'admin_login') {
                ws.userData.isAdmin = true;
                
                // Tell frontend to enable admin features
                ws.send(JSON.stringify({ type: 'admin_granted' }));
                
                ws.send(JSON.stringify({ 
                    type: 'system', 
                    content: 'ACCESS GRANTED. Secrets: /rainbow, /theme, /chattitle, /clearall' 
                }));
            }
            else if (data.type === 'set_rainbow') {
                if (ws.userData.isAdmin) {
                    ws.userData.color = 'rainbow'; // Special color flag
                    ws.send(JSON.stringify({ type: 'system', content: 'Rainbow mode activated!' }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', content: 'Permission Denied. Try /admin@' }));
                }
            }
            else if (data.type === 'change_theme') {
                if (ws.userData.isAdmin) {
                    currentTheme = data.theme;
                    broadcast(JSON.stringify({ type: 'theme', theme: currentTheme }));
                    broadcast(JSON.stringify({ type: 'system', content: `Global theme changed to ${currentTheme}` }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', content: 'Permission Denied. Try /admin@' }));
                }
            }
            else if (data.type === 'change_title') {
                if (ws.userData.isAdmin) {
                    currentTitle = data.title;
                    broadcast(JSON.stringify({ type: 'title', title: currentTitle }));
                    broadcast(JSON.stringify({ type: 'system', content: `Room title changed to: ${currentTitle}` }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', content: 'Permission Denied. Try /admin@' }));
                }
            }
            else if (data.type === 'clear_chat') {
                if (ws.userData.isAdmin) {
                    // 1. Clear Server Memory
                    chatHistory.length = 0;
                    
                    // 2. Tell everyone to clear their screens
                    broadcast(JSON.stringify({ type: 'clear_history' }));
                    
                    broadcast(JSON.stringify({ type: 'system', content: 'Chat history has been cleared by an Admin.' }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', content: 'Permission Denied. Try /admin@' }));
                }
            }

        } catch (e) {
            console.error("Invalid message format");
        }
    });

    ws.on('close', () => {
        broadcast(JSON.stringify({
            type: 'system',
            content: `User ${ws.userData.username} disconnected.`
        }));
    });
});

function handleDM(ws, data) {
    const targetName = data.target;
    let targetClient = null;

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userData.username === targetName) {
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
        ws.send(JSON.stringify({ type: 'system', content: `Error: User '${targetName}' not found.` }));
    }
}

function handleTDTU(ws) {
    // TDTU #1 ASCII Art
    const asciiArt = `
████████╗██████╗ ████████╗██╗   ██╗    ██╗  ██╗   ██╗
╚══██╔══╝██╔══██╗╚══██╔══╝██║   ██║    ██║  ██║   ██║
   ██║   ██║  ██║   ██║   ██║   ██║    ██║  ██║   ██║
   ██║   ██║  ██║   ██║   ██║   ██║    ╚═╝  ╚═╝   ╚═╝
   ██║   ██████╔╝   ██║   ╚██████╔╝    ██╗  ██╗   ██╗
   ╚═╝   ╚═════╝    ╚═╝    ╚═════╝     ╚═╝  ╚═╝   ╚═╝
              #1 UNIVERSITY
`;
    const msgObject = {
        type: 'message',
        username: ws.userData.username,
        color: ws.userData.color,
        content: asciiArt
    };
    chatHistory.push(msgObject);
    if (chatHistory.length > HISTORY_LIMIT) chatHistory.shift();
    broadcast(JSON.stringify(msgObject));
}

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function getRandomColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 60%)`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});