##############################################################################################
#                                                               
#               WebSocket Manager for notifications              
#                                                                
###############################################################################################

import json
import threading
from flask import current_app
from flask_socketio import SocketIO, emit

class WebSocketManager:
    """
    Manages WebSocket connections and broadcasts
    """
    def __init__(self, app=None):
        self.socketio = SocketIO(app, async_mode='threading', cors_allowed_origins="*")
        self.clients = {}
        self._setup_handlers()
        
    def init_app(self, app):
        """Initialize with Flask app"""
        self.socketio = SocketIO(app, async_mode='threading', cors_allowed_origins="*")
        self._setup_handlers()
        
    def _setup_handlers(self):
        """Set up socket event handlers"""
        @self.socketio.on('connect')
        def handle_connect():
            client_id = threading.get_ident()
            current_app.logger.debug(f"WebSocket client connected: {client_id}")
            self.clients[client_id] = True
            
        @self.socketio.on('disconnect')
        def handle_disconnect():
            client_id = threading.get_ident()
            if client_id in self.clients:
                del self.clients[client_id]
            current_app.logger.debug(f"WebSocket client disconnected: {client_id}")
            
        @self.socketio.on('subscribe_pgagent')
        def handle_subscribe(data):
            """Handle subscription to pgAgent notifications"""
            server_id = data.get('server_id')
            if server_id:
                current_app.logger.debug(f"Client subscribed to pgAgent notifications for server {server_id}")
                # Start listener for this server if not already started
                from pgadmin.misc.bgprocess.processes import pgagent_listener
                pgagent_listener.start_listener(server_id)
    
    def broadcast(self, event, data):
        """Broadcast an event to all connected clients"""
        try:
            self.socketio.emit(event, data)
            return True
        except Exception as e:
            current_app.logger.error(f"Error broadcasting message: {str(e)}")
            return False
            
    def run(self, host, port):
        """Run the WebSocket server"""
        self.socketio.run(current_app, host=host, port=port)