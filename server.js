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
    // 1. Get the Client IP
    // Render (and most hosts) put the real IP in the 'x-forwarded-for' header.
    // If that's missing, we fall back to the direct connection IP.
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // If x-forwarded-for contains multiple IPs, the first one is the client
    if (ip && ip.indexOf(',') > -1) {
        ip = ip.split(',')[0];
    }

    // 2. Get the Client Ephemeral Port
    // This is the random port the user's browser opened to talk to the server
    const port = req.socket.remotePort;

    const connectionInfo = `New user connected from IP: ${ip} (Source Port: ${port})`;
    console.log(connectionInfo);

    // Broadcast the connection info to EVERYONE so they can see it in the chat
    broadcast(JSON.stringify({
        type: 'system',
        content: connectionInfo
    }));

    ws.on('message', (message) => {
        // Broadcast the user's message
        const msgString = message.toString();
        
        broadcast(JSON.stringify({
            type: 'message',
            ip: ip, // Tag the message with their IP
            content: msgString
        }));
    });

    ws.on('close', () => {
        broadcast(JSON.stringify({
            type: 'system',
            content: `User disconnected (IP: ${ip})`
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

// Start the server
// Render provides the PORT environment variable
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});