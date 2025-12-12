TDTU Messenger (Port Chat)

A real-time, WebSocket-based chat application built with Node.js. This application assigns users a unique identity based on their connection port and allows for public messaging, private DMs, and customizable themes. Including an integrated AI assistant named tdtuAI.

Core functionality

Real-time messaging: communication using WebSockets.
Identity system: users are identified by their unique port number by default but can change their username and text color.
Private Messaging: send DMs to specific users.
Chat history: new users automatically see the last 50 messages upon joining so they have context.
Mobile friendly: specific fixes to display ASCII art correctly on small screens.
AI assistant (tdtuAI)
Smart replies: Start any message with Hey tdtuAI to ask the AI a question.
Example: Hey tdtuAI what is the capital of Vietnam?
Powered by Google Gemini

Themes & Customization

Themes: switch between Green (Default), Purple,  Blue, and  Red.
Rainbow mode: special animated text color .
Dynamic room title: The chat room title can be changed dynamically by an admin.

Tech Stack
Backend: Node.js, Express, ws (WebSocket library).
Frontend: Vanilla HTML, CSS, and JavaScript.
AI: Google Gemini API (gemini-1.5-flash).

Commands

Public Commands
/m <user> <msg>
Send a private Direct Message to a user.

/tdtu
Display the custom TDTU #1 ASCII art.

/ping
Check your latency (ping) to the server.

/cls
Clear your local chat screen.

/?
Show the help menu.

Hey tdtuAI <query>
Ask the AI assistant a question.

Secret Admin Commands
To access these, you must first type /admin@ to unlock admin privileges.
/admin@
Unlocks admin mode (grants access to commands below).

/rainbow
Sets your text color to an animated rainbow gradient.

/theme <color>
Changes the theme for everyone. Options: red, purple, blue, default.

/chattitle <text>
Changes the chatroom header title for everyone.

/clearall
Wipes the server chat history and clears screens for everyone.
