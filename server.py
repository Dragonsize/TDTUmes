#!/usr/bin/env python3
"""
TCP Message Server
A simple TCP server that handles multiple client connections and broadcasts messages.
"""

import socket
import threading


class MessageServer:
    """TCP server for handling message broadcasting between clients."""
    
    def __init__(self, host='127.0.0.1', port=5000):
        """Initialize the server with host and port."""
        self.host = host
        self.port = port
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.clients = []
        self.clients_lock = threading.Lock()
        self.running = False
    
    def start(self):
        """Start the server and listen for connections."""
        self.server_socket.bind((self.host, self.port))
        self.server_socket.listen(5)
        self.running = True
        print(f"[SERVER] Server started on {self.host}:{self.port}")
        
        while self.running:
            try:
                client_socket, address = self.server_socket.accept()
                print(f"[SERVER] Connection from {address}")
                
                with self.clients_lock:
                    self.clients.append(client_socket)
                
                client_thread = threading.Thread(
                    target=self.handle_client,
                    args=(client_socket, address)
                )
                client_thread.daemon = True
                client_thread.start()
            except OSError:
                break
    
    def handle_client(self, client_socket, address):
        """Handle messages from a connected client."""
        try:
            while self.running:
                message = client_socket.recv(1024).decode('utf-8')
                if not message:
                    break
                print(f"[{address}] {message}")
                self.broadcast(message, client_socket)
        except (ConnectionResetError, OSError):
            pass
        finally:
            self.remove_client(client_socket)
            print(f"[SERVER] {address} disconnected")
    
    def broadcast(self, message, sender_socket):
        """Send a message to all connected clients except the sender."""
        failed_clients = []
        with self.clients_lock:
            for client in self.clients:
                if client != sender_socket:
                    try:
                        client.send(message.encode('utf-8'))
                    except (BrokenPipeError, OSError):
                        failed_clients.append(client)
            for client in failed_clients:
                self.clients.remove(client)
    
    def remove_client(self, client_socket):
        """Remove a client from the list and close the socket."""
        with self.clients_lock:
            if client_socket in self.clients:
                self.clients.remove(client_socket)
        try:
            client_socket.close()
        except OSError:
            pass
    
    def stop(self):
        """Stop the server and close all connections."""
        self.running = False
        with self.clients_lock:
            for client in self.clients:
                try:
                    client.close()
                except OSError:
                    pass
            self.clients.clear()
        try:
            self.server_socket.close()
        except OSError:
            pass
        print("[SERVER] Server stopped")


def main():
    """Main function to run the server."""
    server = MessageServer()
    try:
        server.start()
    except KeyboardInterrupt:
        print("\n[SERVER] Shutting down...")
        server.stop()


if __name__ == "__main__":
    main()
