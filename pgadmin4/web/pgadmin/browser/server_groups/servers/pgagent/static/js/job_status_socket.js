/* eslint-disable */
//////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

define('pgadmin.node.job_status_socket', [
  'sources/gettext', 'sources/url_for', 'pgadmin.browser',
  'sources/socket.io'
], function(gettext, url_for, pgBrowser, io) {
  // Create a singleton instance for the job status socket
  var jobStatusSocket = {
    socket: null,
    initialized: false,
    registeredServers: new Set(),

    initialize: function() {
      if (this.initialized) {
        return;
      }

      console.log('🔄 Initializing job status socket...');
      
      // Connect to the WebSocket server
      this.socket = io('/browser/job_status_socket', {
        transports: ['websocket'],
        upgrade: false
      });

      // Handle connection events
      this.socket.on('connect', function() {
        console.log('✅ Connected to job status socket');
      });

      this.socket.on('disconnect', function() {
        console.log('❌ Disconnected from job status socket');
      });

      // Handle job status updates
      this.socket.on('job_status_update', function(data) {
        console.log('📢 Received job status update:', data);
        // Trigger a custom event that other components can listen to
        $(document).trigger('pgagent:job_status_update', [data]);
      });

      this.initialized = true;
    },

    registerServer: function(serverId) {
      if (!this.initialized) {
        this.initialize();
      }

      if (!this.registeredServers.has(serverId)) {
        console.log(`🟢 Registering server ${serverId} for job status updates`);
        this.socket.emit('register_server', { server_id: serverId });
        this.registeredServers.add(serverId);
      }
    },

    unregisterServer: function(serverId) {
      if (this.initialized && this.registeredServers.has(serverId)) {
        console.log(`🔴 Unregistering server ${serverId}`);
        this.socket.emit('unregister_server', { server_id: serverId });
        this.registeredServers.delete(serverId);
      }
    }
  };

  return jobStatusSocket;
});
