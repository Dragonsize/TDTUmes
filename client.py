#!/usr/bin/env python3
"""
TCP Message Client
A simple TCP client for connecting to the message server.
"""

import socket
import threading
import sys


class MessageClient:
    """TCP client for sending and receiving messages."""
    
    def __init__(self, host='127.0.0.1', port=5000):
        """Initialize the client with server host and port."""
        self.host = host
        self.port = port
        self.client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.running = False
        self.username = None
    
    def connect(self, username):
        """Connect to the server."""
        self.username = username
        try:
            self.client_socket.connect((self.host, self.port))
            self.running = True
            print(f"[CLIENT] Connected to server at {self.host}:{self.port}")
            return True
        except ConnectionRefusedError:
            print("[CLIENT] Connection refused. Is the server running?")
            return False
        except OSError as e:
            print(f"[CLIENT] Connection error: {e}")
            return False
    
    def receive_messages(self):
        """Receive messages from the server in a separate thread."""
        while self.running:
            try:
                message = self.client_socket.recv(1024).decode('utf-8')
                if not message:
                    break
                print(f"\n{message}")
                print("You: ", end="", flush=True)
            except (ConnectionResetError, OSError):
                break
        
        if self.running:
            print("\n[CLIENT] Disconnected from server")
            self.running = False
    
    def send_message(self, message):
        """Send a message to the server."""
        if not self.running:
            return False
        try:
            formatted_message = f"{self.username}: {message}"
            self.client_socket.send(formatted_message.encode('utf-8'))
            return True
        except (BrokenPipeError, OSError):
            print("[CLIENT] Failed to send message")
            return False
    
    def disconnect(self):
        """Disconnect from the server."""
        self.running = False
        try:
            self.client_socket.close()
        except OSError:
            pass
        print("[CLIENT] Disconnected")


def main():
    """Main function to run the client."""
    username = input("Enter your username: ").strip()
    if not username:
        username = "Anonymous"
    
    client = MessageClient()
    if not client.connect(username):
        sys.exit(1)
    
    receive_thread = threading.Thread(target=client.receive_messages)
    receive_thread.daemon = True
    receive_thread.start()
    
    print("Type your messages (type 'quit' to exit):")
    try:
        while client.running:
            message = input("You: ")
            if message.lower() == 'quit':
                break
            if message:
                client.send_message(message)
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        client.disconnect()


if __name__ == "__main__":
    main()
