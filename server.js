const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws, req) => {
    // 1. Get the Client Ephemeral Port (used as default ID)
    const port = req.socket.remotePort;

    // 2. Initialize User State
    // Default username is the port, default color is a random HSL value
    ws.userData = {
        username: `${port}`,
        color: getRandomColor()
    };

    // Log internally, but don't broadcast IP anymore
    console.log(`Connection from Port: ${port}`);

    // Notify everyone of the new joiner
    broadcast(JSON.stringify({
        type: 'system',
        content: `User ${ws.userData.username} joined the chat.`
    }));

    // Send the user their own initial details so the UI can update
    ws.send(JSON.stringify({
        type: 'init',
        username: ws.userData.username,
        color: ws.userData.color
    }));

    ws.on('message', (message) => {
        try {
            // We expect JSON messages now for different actions
            const data = JSON.parse(message);

            if (data.type === 'message') {
                // Broadcast the user's message with their CURRENT name/color
                broadcast(JSON.stringify({
                    type: 'message',
                    username: ws.userData.username,
                    color: ws.userData.color,
                    content: data.content
                }));
            } 
            else if (data.type === 'update_name') {
                const oldName = ws.userData.username;
                const newName = data.content.trim().substring(0, 20); // Limit length
                
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
                // We don't broadcast color changes to avoid spam, 
                // but next time they speak, it will be the new color.
            }

        } catch (e) {
            console.error("Received non-JSON message or invalid format");
        }
    });

    ws.on('close', () => {
        broadcast(JSON.stringify({
            type: 'system',
            content: `User ${ws.userData.username} disconnected.`
        }));
    });
});

// Helper function to send data to all connected clients
function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Helper to generate random bright colors (HSL) for dark mode
function getRandomColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 60%)`;
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});