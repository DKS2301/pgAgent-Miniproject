////////////////////////////////////////////////////////////////////////
//
//      pgAdmin Frontend WebSocket Client
//
////////////////////////////////////////////////////////////////////////
import io from 'socket.io-client';

define([
  'sources/gettext',
  'jquery',
  'underscore',
  'sources/pgadmin',
  'pgadmin.browser',
], function (gettext, $, _, pgAdmin, pgBrowser) {
  'use strict';

  // PgAgent status update manager
  var PgAgentStatusManager = {
    socket: null,
    serverIds: [],

    // Initialize WebSocket connection
    init: function () {
      let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let host = window.location.hostname;
      let port = pgAdmin.websocket_port || window.location.port;
      let url = `${protocol}//${host}:${port}/socket.io/`;

      console.warn(`Connecting to WebSocket at ${url}`);

      try {
        // Use Socket.IO client
        this.socket = io(url, {
          transports: ['websocket'],
          upgrade: false,
        });

        // Bind event listeners
        this.socket.on('connect', this.onConnect.bind(this));
        this.socket.on('disconnect', this.onDisconnect.bind(this));
        this.socket.on('pgagent_status_update', this.onStatusUpdate.bind(this));

        // Set reconnection parameters
        this.socket.io.reconnectionAttempts(5);
        this.socket.io.reconnectionDelay(1000);
        this.socket.io.timeout(10000);
      } catch (error) {
        console.error('Error initializing WebSocket:', error);
        // Optionally, notify the user or retry connection
      }
    },

    // Handle WebSocket connection
    onConnect: function () {
      console.warn('Connected to pgAdmin WebSocket');

      // Subscribe to pgAgent status updates for all server connections
      this.serverIds.forEach((serverId) => {
        this.subscribeToServer(serverId);
      });
    },

    // Handle WebSocket disconnection
    onDisconnect: function () {
      console.warn('Disconnected from pgAdmin WebSocket');
      // Optionally, attempt to reconnect or notify the user
    },

    // Add a server to monitor
    addServer: function (serverId) {
      if (!this.serverIds.includes(serverId)) {
        this.serverIds.push(serverId);

        // If we're already connected, subscribe immediately
        if (this.socket && this.socket.connected) {
          this.subscribeToServer(serverId);
        }
      }
    },

    // Subscribe to pgAgent updates for a server
    subscribeToServer: function (serverId) {
      console.warn(`Subscribing to pgAgent updates for server ${serverId}`);
      this.socket.emit('subscribe_pgagent', { server_id: serverId });
    },

    // Handle status update notifications
    onStatusUpdate: function (data) {
      console.warn('Received pgAgent status update:', data);

      // Refresh the pgAgent jobs browser node
      if (pgBrowser && pgBrowser.Nodes && pgBrowser.Nodes.pga_job) {
        let tree = pgBrowser.tree;

        // Find the pgAgent node for this server
        let serverNode = tree.findNodeByDomElement(
          `.pgadmin-browser-tab-pane .aciTree[role=tree] li[data-pgadmin-server-id="${data.server_id}"]`,
        );

        if (serverNode) {
          // Find the pgAgent node
          let pgAgentNode = null;
          tree.children(serverNode, function (child) {
            if (tree.itemData(child).type === 'pga_job') {
              pgAgentNode = child;
              return false; // Stop iteration
            }
            return true; // Continue iteration
          });

          if (pgAgentNode) {
            // Refresh the node with a slight delay to avoid UI jank
            setTimeout(function () {
              tree.reload(pgAgentNode);
            }, 100);
          }
        }
      }
    },
  };

  // Initialize when the page loads
  $(document).ready(function () {
    PgAgentStatusManager.init();
  });

  // Add this to window for easier debugging
  window.PgAgentStatusManager = PgAgentStatusManager;

  return PgAgentStatusManager;
});