/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////
import { io } from 'socket.io-client';
import gettext from 'sources/gettext';
import url_for from 'sources/url_for';
import { parseApiError } from './api_instance';

// Create a global registry to track all socket connections for debugging
const _socketRegistry = {
  connections: {},
  registerSocket: function(namespace, socket) {
    this.connections[namespace] = socket;
    console.log(`[Socket.IO] Registered socket for namespace ${namespace}`);
    return socket;
  },
  getSocket: function(namespace) {
    return this.connections[namespace];
  },
  removeSocket: function(namespace) {
    if (this.connections[namespace]) {
      console.log(`[Socket.IO] Removed socket for namespace ${namespace}`);
      delete this.connections[namespace];
    }
  },
  getAllSockets: function() {
    return this.connections;
  }
};

// Add to window object for console debugging
if (typeof window !== 'undefined') {
  window._pgAdminSockets = _socketRegistry;
}

// Create a direct io object for modules that need immediate access
// without going through the openSocket promise
const socket_io = io;

// Export the socket.io directly
export { socket_io as io };

// Add a connect method to make the interface more compatible with older code
socket_io.connect = function(namespace, options) {
  console.log('[Socket.IO] io.connect called directly for:', namespace);
  
  // First check if we already have a socket for this namespace
  const existingSocket = _socketRegistry.getSocket(namespace);
  if (existingSocket && existingSocket.connected) {
    console.log('[Socket.IO] Reusing existing connected socket for namespace', namespace);
    return existingSocket;
  }
  
  try {
    const socketUrl = namespace.startsWith('/') ? namespace : '/' + namespace;
    console.log('[Socket.IO] Creating socket connection via io.connect to:', socketUrl, `\t url is ${url_for('pgadmin.root')}/socket.io`);
    
    const socketObj = socket_io(socketUrl, {
      path: `${url_for('pgadmin.root')}/socket.io`,
      pingTimeout: 120000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      ...options,
    });
    
    // Register this socket in our registry
    _socketRegistry.registerSocket(namespace, socketObj);
    
    return socketObj;
  } catch (err) {
    console.error('[Socket.IO] Error in io.connect:', err);
    throw err;
  }
};

export function openSocket(namespace, options) {
  console.log('[Socket.IO] openSocket called with namespace:', namespace);
  
  // First check if we already have a socket for this namespace
  const existingSocket = _socketRegistry.getSocket(namespace);
  if (existingSocket && existingSocket.connected) {
    console.log('[Socket.IO] Reusing existing connected socket for namespace', namespace);
    return Promise.resolve(existingSocket);
  }
  
  return new Promise((resolve, reject) => {
    try {
      const socketUrl = namespace.startsWith('/') ? namespace : '/' + namespace;
      console.log('[Socket.IO] Creating socket connection to:', socketUrl);
      
      const socketObj = io(socketUrl, {
        path: `${url_for('pgadmin.root')}/socket.io`,
        pingTimeout: 120000,
        pingInterval: 25000,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        ...options,
      });

      console.log('[Socket.IO] Socket object created, awaiting connection...');

      socketObj.on('connect', () => {
        console.log('[Socket.IO] Socket connected with ID:', socketObj.id);
      });

      socketObj.on('connected', (data) => {
        console.log('[Socket.IO] Connected event received, socket ready:', data);
        _socketRegistry.registerSocket(namespace, socketObj);
        resolve(socketObj);
      });

      socketObj.on('connect_error', (err) => {
        console.error('[Socket.IO] Socket connection error:', err);
        _socketRegistry.removeSocket(namespace);
        reject(err instanceof Error ? err : new Error(gettext('Socket connection error: ') + String(err)));
      });

      socketObj.on('disconnect', (reason) => {
        console.log('[Socket.IO] Socket disconnected:', reason);
        _socketRegistry.removeSocket(namespace);
        // Only reject if this happens during initial connection
        if (!socketObj.wasConnected) {
          reject(new Error(gettext('Socket disconnected: ') + reason));
        }
      });

      socketObj.on('error', (err) => {
        console.error('[Socket.IO] Socket error:', err);
        if (!socketObj.wasConnected) {
          _socketRegistry.removeSocket(namespace);
          reject(err instanceof Error ? err : new Error(gettext('Socket error: ') + String(err)));
        }
      });
      
      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!socketObj.connected) {
          console.error('[Socket.IO] Connection timeout for namespace:', namespace);
          socketObj.close();
          _socketRegistry.removeSocket(namespace);
          reject(new Error(gettext('Socket connection timeout')));
        }
      }, 15000); // 15 second timeout
      
      // Clear timeout when connected
      socketObj.on('connected', () => {
        clearTimeout(connectionTimeout);
        socketObj.wasConnected = true;
      });
      
    } catch (err) {
      console.error('[Socket.IO] Error creating socket:', err);
      reject(err);
    }
  });
}

export function socketApiGet(socket, endpoint, params) {
  return new Promise((resolve, reject) => {
    console.log(`[Socket.IO] Emitting ${endpoint} with params:`, params);
    
    socket.emit(endpoint, params);
    
    const successEvent = `${endpoint}_success`;
    const failureEvent = `${endpoint}_failed`;
    
    const successHandler = (data) => {
      console.log(`[Socket.IO] Received ${successEvent}:`, data);
      cleanup();
      resolve(data);
    };
    
    const failureHandler = (data) => {
      console.error(`[Socket.IO] Received ${failureEvent}:`, data);
      cleanup();
      reject(new Error(parseApiError(data)));
    };
    
    const disconnectHandler = () => {
      console.error('[Socket.IO] Socket disconnected during operation');
      cleanup();
      reject(new Error(gettext('Connection to pgAdmin server has been lost')));
    };
    
    // Set up timeout
    const timeout = setTimeout(() => {
      console.error(`[Socket.IO] Timeout waiting for ${endpoint} response`);
      cleanup();
      reject(new Error(gettext('Socket operation timed out')));
    }, 30000); // 30 second timeout
    
    // Clean up function to remove all listeners
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(successEvent, successHandler);
      socket.off(failureEvent, failureHandler);
      socket.off('disconnect', disconnectHandler);
    };
    
    // Set up event handlers
    socket.on(successEvent, successHandler);
    socket.on(failureEvent, failureHandler);
    socket.on('disconnect', disconnectHandler);
  });
}

// Export the socket registry for debugging
export const socketRegistry = _socketRegistry;

// Export socket registry and functions
export default {
  io: socket_io,
  openSocket,
  socketApiGet,
  registry: _socketRegistry
};

// Add a debug function to window object to help diagnose socket issues
if (typeof window !== 'undefined') {
  window._checkSocketExports = function() {
    console.log('==== Socket.IO Export Check ====');
    console.log('socket_instance default export:', typeof socket_instance !== 'undefined' ? 'Available' : 'Missing');
    
    if (typeof socket_instance !== 'undefined') {
      console.log('- socket_instance.io:', typeof socket_instance.io !== 'undefined' ? 'Available' : 'Missing');
      if (typeof socket_instance.io !== 'undefined') {
        console.log('  - socket_instance.io.connect:', typeof socket_instance.io.connect === 'function' ? 'Available' : 'Missing');
      }
      console.log('- socket_instance.openSocket:', typeof socket_instance.openSocket === 'function' ? 'Available' : 'Missing');
    }
    
    console.log('Direct io export:', typeof io !== 'undefined' ? 'Available' : 'Missing');
    if (typeof io !== 'undefined') {
      console.log('- io.connect:', typeof socket_io.connect === 'function' ? 'Available' : 'Missing');
    }
    
    console.log('Socket.IO client from import:', typeof socket_io !== 'undefined' ? 'Available' : 'Missing');
    
    return {
      socket_instance: typeof socket_instance !== 'undefined',
      socket_instance_io: typeof socket_instance !== 'undefined' && typeof socket_instance.io !== 'undefined',
      socket_instance_io_connect: typeof socket_instance !== 'undefined' && 
                                  typeof socket_instance.io !== 'undefined' && 
                                  typeof socket_instance.io.connect === 'function',
      direct_io: typeof io !== 'undefined',
      direct_io_connect: typeof io !== 'undefined' && typeof socket_io.connect === 'function',
      socket_io: typeof socket_io !== 'undefined'
    };
  };
}
