# TDTUmes

A simple TCP message application written in Python.

## Features

- TCP-based client-server architecture
- Multi-client support with message broadcasting
- Threaded server handling multiple connections
- Simple command-line interface

## Requirements

- Python 3.6+

## Usage

### Starting the Server

```bash
python server.py
```

The server will start listening on `127.0.0.1:5000` by default.

### Connecting as a Client

```bash
python client.py
```

1. Enter your username when prompted
2. Type your messages and press Enter to send
3. Type `quit` to disconnect

## Architecture

- `server.py` - TCP server that accepts connections and broadcasts messages to all connected clients
- `client.py` - TCP client that connects to the server and handles sending/receiving messages
