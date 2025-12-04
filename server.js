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

wss.on('connection', (ws, req) => {
    // 1. Get the Client Ephemeral Port (used as default ID)
    const port = req.socket.remotePort;

    // 2. Initialize User State
    ws.userData = {
        username: `${port}`,
        color: getRandomColor()
    };

    console.log(`Connection from Port: ${port}`);

    // 3. Send History to the new user immediately
    ws.send(JSON.stringify({
        type: 'history',
        content: chatHistory
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
                // Create the message object
                const msgObject = {
                    type: 'message',
                    username: ws.userData.username,
                    color: ws.userData.color,
                    content: data.content,
                    timestamp: Date.now()
                };

                // Add to history
                chatHistory.push(msgObject);
                if (chatHistory.length > HISTORY_LIMIT) {
                    chatHistory.shift();
                }

                // Broadcast to everyone
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
                // Respond ONLY to the user who pinged
                ws.send(JSON.stringify({
                    type: 'pong',
                    startTime: data.startTime
                }));
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