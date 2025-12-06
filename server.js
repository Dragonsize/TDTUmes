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
let currentTitle = "Classroom"; 

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
        isAdmin: false
    };

    console.log(`Connection from ${ip}:${port}`);

    // 3. Send Initial Data
    ws.send(JSON.stringify({ type: 'history', content: chatHistory }));
    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));

    broadcast(JSON.stringify({
        type: 'system',
        content: `User ${ws.userData.username} joined the chat.`
    }));

    ws.send(JSON.stringify({
        type: 'init',
        username: ws.userData.username,
        color: ws.userData.color
    }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'message') {
                // 1. Process User Message
                const msgContent = data.content;
                const msgObject = {
                    type: 'message',
                    username: ws.userData.username,
                    color: ws.userData.color,
                    content: msgContent,
                    timestamp: Date.now()
                };

                chatHistory.push(msgObject);
                if (chatHistory.length > HISTORY_LIMIT) chatHistory.shift();

                broadcast(JSON.stringify(msgObject));

                // 2. CHECK FOR AI TRIGGER ("Hey Huybeo")
                const lowerMsg = msgContent.toLowerCase().trim();
                if (lowerMsg.startsWith("hey huybeo")) {
                    // Extract the question (remove "hey huybeo" from start)
                    const prompt = msgContent.substring(10).trim();
                    
                    if (prompt.length > 0) {
                        // Call AI
                        const aiResponse = await askHuybeoAI(prompt);
                        
                        // Broadcast AI Response
                        const aiMsgObject = {
                            type: 'message',
                            username: "Huybeo (AI)",
                            color: "#00ccff", // Cyan color for AI
                            content: aiResponse,
                            timestamp: Date.now()
                        };
                        
                        chatHistory.push(aiMsgObject);
                        if (chatHistory.length > HISTORY_LIMIT) chatHistory.shift();
                        
                        broadcast(JSON.stringify(aiMsgObject));
                    } else {
                        // User said "Hey Huybeo" but nothing else
                        const aiMsgObject = {
                            type: 'message',
                            username: "Huybeo (AI)",
                            color: "#00ccff",
                            content: "Yes? How can I help you?",
                            timestamp: Date.now()
                        };
                        broadcast(JSON.stringify(aiMsgObject));
                    }
                }
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
                ws.send(JSON.stringify({ type: 'admin_granted' }));
                ws.send(JSON.stringify({ 
                    type: 'system', 
                    content: 'ACCESS GRANTED. Secrets: /rainbow, /theme, /chattitle, /clearall' 
                }));
            }
            else if (data.type === 'set_rainbow') {
                if (ws.userData.isAdmin) {
                    ws.userData.color = 'rainbow';
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
                    chatHistory.length = 0;
                    broadcast(JSON.stringify({ type: 'clear_history' }));
                    broadcast(JSON.stringify({ type: 'system', content: 'Chat history has been cleared by an Admin.' }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', content: 'Permission Denied. Try /admin@' }));
                }
            }

        } catch (e) {
            console.error("Invalid message format", e);
        }
    });

    ws.on('close', () => {
        broadcast(JSON.stringify({
            type: 'system',
            content: `User ${ws.userData.username} disconnected.`
        }));
    });
});

// --- AI FUNCTION ---
async function askHuybeoAI(userText) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        return "I have no brain! (Please set GEMINI_API_KEY in Render Environment Variables)";
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{
                parts: [{
                    text: `You are Huybeo, a helpful, friendly, and slightly witty AI assistant in a classroom chatroom. 
                           User says: "${userText}". 
                           Keep your response concise and chatty (under 200 characters if possible).`
                }]
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        return aiText || "I'm lost for words...";
    } catch (error) {
        console.error("AI Error:", error);
        return "My brain hurts (API Error).";
    }
}

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
