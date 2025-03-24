/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { getNodeAjaxOptions } from '../../../../../static/js/node_ajax';
import PgaJobSchema from './pga_job.ui';
import { getNodePgaJobStepSchema } from '../../steps/static/js/pga_jobstep.ui';
import getApiInstance from '../../../../../../static/js/api_instance';
import pgAdmin from 'sources/pgadmin';
import url_for from 'sources/url_for';
// Import socket.io-client directly for backup use only
import { io as socket_io } from 'socket.io-client';

/* 
 * SOCKET.IO IMPROVEMENTS - JOB STATUS LISTENER
 * 
 * This module implements the pgAgent job status listener using Socket.IO.
 * 
 * To use diagnostic tools in browser console:
 *   pgAgentSocketDiagnostics.help()
 */

define('pgadmin.node.pga_job', [
  'sources/gettext', 'sources/url_for', 'pgadmin.browser',
  'pgadmin.node.pga_jobstep', 'pgadmin.node.pga_schedule',
  'sources/socket_instance'
], function(gettext, url_for, pgBrowser, jobstep, schedule, socket_instance) {

  if (!pgBrowser.Nodes['coll-pga_job']) {
    pgBrowser.Nodes['coll-pga_job'] =
      pgBrowser.Collection.extend({
        node: 'pga_job',
        label: gettext('pga_jobs'),
        type: 'coll-pga_job',
        columns: ['jobid', 'jobname', 'jobenabled', 'jlgstatus', 'jobnextrun', 'joblastrun', 'jobdesc'],
        hasStatistics: false,
        canDrop: true,
        canDropCascade: false,
      });
  }

  if (!pgBrowser.Nodes['pga_job']) {
    pgBrowser.Nodes['pga_job'] = pgBrowser.Node.extend({
      parent_type: 'server',
      type: 'pga_job',
      dialogHelp: url_for('help.static', {'filename': 'pgagent_jobs.html'}),
      hasSQL: true,
      hasDepends: false,
      hasStatistics: true,
      hasCollectiveStatistics: true,
      width: '80%',
      height: '80%',
      canDrop: true,
      label: gettext('pgAgent Job'),
      node_image: function() {
        return 'icon-pga_job';
      },

      // Socket connection for job status updates
      _jobStatusSocket: null,
      // Flag to track if we've already set up listeners
      _listenerInitialized: false,
      
      Init: function() {
        /* Avoid mulitple registration of menus */
        if (this.initialized)
          return;

        this.initialized = true;
        console.log('[pgAgent] Initializing pgAgent job module');

        // Add detailed diagnostic info to console to help debug the socket import issue
        console.log('[pgAgent] Module environment check:');
        console.log('[pgAgent] socket_instance available:', typeof socket_instance);
        if (socket_instance) {
          console.log('[pgAgent] socket_instance.io available:', typeof socket_instance.io);
          // Emergency fix: if socket_instance exists but io is missing, patch it
          if (!socket_instance.io && typeof socket_io === 'function') {
            console.log('[pgAgent] Patching socket_instance.io with global io...');
            socket_instance.io = socket_io;
          }
        }
        console.log('[pgAgent] io global available:', typeof socket_io);
        console.log('[pgAgent] url_for available:', typeof url_for);

        pgBrowser.add_menus([{
          name: 'create_pga_job_on_coll', node: 'coll-pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_obj_properties',
          category: 'create', priority: 4, label: gettext('pgAgent Job...'),
          data: {action: 'create'},
        },{
          name: 'create_pga_job', node: 'pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_obj_properties',
          category: 'create', priority: 4, label: gettext('pgAgent Job...'),
          data: {action: 'create'},
        }, {
          name: 'run_now_pga_job', node: 'pga_job', module: this,
          applies: ['object', 'context'], callback: 'run_pga_job_now',
          priority: 4, label: gettext('Run now'), data: {action: 'create'},
        }]);
        
        // Set up diagnostic tools
        this.setupDiagnosticTools();
        
        // Even if browser is not fully initialized, set up the listener
        // It will automatically detect browser state and handle initialization
        this.setupJobStatusListener();
        
        console.log('pgAgent job module initialization complete');
      },

      getSchema: function(treeNodeInfo, itemNodeData) {
        return new PgaJobSchema(
          {
            jobjclid: ()=>getNodeAjaxOptions('classes', this, treeNodeInfo, itemNodeData, {
              cacheLevel: 'server',
              cacheNode: 'server'
            })
          },
          () => getNodePgaJobStepSchema(treeNodeInfo, itemNodeData),
        );
      },

      /* Run pgagent job now */
      run_pga_job_now: function(args) {
        let input = args || {},
          obj = this,
          t = pgBrowser.tree,
          i = input.item || t.selected(),
          d = i  ? t.itemData(i) : undefined;

        if (d) {
          getApiInstance().put(
            obj.generate_url(i, 'run_now', d, true),
          ).then(({data: res})=> {
            pgAdmin.Browser.notifier.success(res.info);
            t.unload(i);
          }).catch(function(error) {
            pgAdmin.Browser.notifier.pgRespErrorNotify(error);
            t.unload(i);
          });
        }

        return false;
      },
      
      /* Setup Socket.IO connection for job status updates */
      setupJobStatusListener: function() {
        // Avoid setting up listeners more than once
        if (this._listenerInitialized) {
          console.log('Job status listeners already initialized, skipping setup');
          return;
        }
        
        console.log('Setting up job status listener');
        const self = this;
        this._listenerInitialized = true;

        // Check if the browser is already initialized by looking for tree
        // or wait for the initialization event
        if (pgBrowser) {
          console.log('Browser already initialized, setting up listeners directly');
          
          // Keep trying to set up listeners until tree is available
          const setupInterval = setInterval(function() {
            if (pgBrowser.tree) {
              console.log('Tree is available, setting up listeners');
              clearInterval(setupInterval);
              self.setupJobStatusListenerEvents();
            } else {
              console.log('Tree not yet available, retrying...');
            }
          }, 500);

          // Set a timeout to stop trying after 10 seconds
          setTimeout(function() {
            if (!pgBrowser.tree) {
              console.error('Failed to set up job status listeners after 10 seconds');
              clearInterval(setupInterval); 
            }
          }, 10000);
        } else {
          // Browser not yet initialized, use a polling approach
          console.log('Browser not initialized yet, using polling approach');
          
          const checkInitInterval = setInterval(function() {
            if (pgBrowser) {
              console.log('Browser initialized detected through polling');
              
              // Keep trying to set up listeners until tree is available
              const setupInterval = setInterval(function() {
                if (pgBrowser.tree) {
                  console.log('Tree is available, setting up listeners');
                  clearInterval(setupInterval);
                  self.setupJobStatusListenerEvents();
                } else {
                  console.log('Tree not yet available, retrying...');
                }
              }, 500);
              
              // Set a timeout to stop trying after 10 seconds
              setTimeout(function() {
                if (!pgBrowser.tree) {
                  console.error('Failed to set up job status listeners after 10 seconds');
                  clearInterval(setupInterval); 
                }
              }, 10000);
            }
          }, 500);
          
          // Set a timeout to stop polling after 30 seconds
          setTimeout(function() {
            clearInterval(checkInitInterval);
            console.error('Browser initialization not detected after 30 seconds');
          }, 30000);
        }
        
        // Also disconnect when browser window is closed
        window.addEventListener('beforeunload', function() {
          console.log('Disconnecting from socket when browser window is closed');
          self.disconnectJobStatusSocket();
        });
      },
      
      /* Set up the event listeners for job status updates */
      setupJobStatusListenerEvents: function() {
        const self = this;
        
        console.log('Setting up job status listener events');
        
        // Monitor all node selections, not just pgAgent nodes
        pgBrowser.Events.on(
          'pgadmin-browser:tree:selected',
          function(item, data) {
            console.log('Node selected, checking if it is a pgAgent collection', data ? data._type : 'no data');
            // Check if the selected node is a pgagent collection
            if (data && data._type === 'coll-pga_job') {
              console.log('pgagent collection node selected from tree selection event');
              if (!item || !pgBrowser.tree.hasParent(item)) return;
              
              // Get the server ID from the parent node
              const serverItem = pgBrowser.tree.parent(item);
              const serverData = serverItem ? pgBrowser.tree.itemData(serverItem) : null;
              
              if (serverData && serverData._type === 'server' && serverData._id) {
                // Connect to socket and start listening for job status updates
                console.log('Connecting to socket for server:', serverData.name || serverData._id);
                self.connectJobStatusSocket(serverData._id);
              }
            }
          }
        );
        
        // Also listen for specific node:selected events
        pgBrowser.Events.on(
          'pgadmin:browser:node:selected',
          function(item) {
            console.log('Node selected event received');
            try {
              if (!item || !pgBrowser.tree) return;
              
              const data = pgBrowser.tree.itemData(item);
              if (data && data._type === 'coll-pga_job') {
                console.log('pgagent collection node selected from node:selected event');
                
                // Get the server ID from the parent node
                const serverItem = pgBrowser.tree.parent(item);
                const serverData = serverItem ? pgBrowser.tree.itemData(serverItem) : null;
                
                if (serverData && serverData._type === 'server' && serverData._id) {
                  // Connect to socket and start listening for job status updates
                  console.log('Connecting to socket for server:', serverData.name || serverData._id);
                  self.connectJobStatusSocket(serverData._id);
                }
              }
            } catch (e) {
              console.error('Error in node:selected event handler:', e);
            }
          }
        );
                
        // Monitor when nodes are closed/collapsed
        pgBrowser.Events.on(
          'pgadmin-browser:tree:closed',
          function(item) {
            try {
              if (!item || !pgBrowser.tree) return;
              
              const data = pgBrowser.tree.itemData(item);
              // Check if the node being closed is a pgagent collection or server containing pgagent
              if (data && (data._type === 'coll-pga_job' || data._type === 'server')) {
                console.log('pgagent collection or server node closed');
                self.disconnectJobStatusSocket();
              }
            } catch (e) {
              console.error('Error in tree.closed event handler:', e);
            }
          }
        );
        
        console.log('Job status listener events set up successfully');
      },
      
      /* Connect to the Socket.IO server for job status updates */
      connectJobStatusSocket: function(serverId) {
        var self = this;
        
        try {
          console.log('[pgAgent] Connecting job status socket...');
          
          // Store the server ID for later use
          if (serverId) {
            self.currentServerId = serverId;
          }
          
          // First disconnect any existing socket
          if (self.socket) {
            self.disconnectJobStatusSocket();
          }
          
          // Construct the socket URLs - Socket.IO requires just the namespace
          const baseUrl = window.location.origin;
          const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
          // Use just the namespace name with leading slash for Socket.IO
          const pgAgentNamespace = '/pgagent';
          
          console.log('[pgAgent] Connecting to namespace:', pgAgentNamespace);
          console.log('[pgAgent] Using socket.io path:', pgAdminPath + '/socket.io');
          console.log('[pgAgent] Current server ID:', self.currentServerId);
          
          // Define socket connection options
          const socketOptions = {
            path: pgAdminPath + '/socket.io',
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            randomizationFactor: 0.5,
            timeout: 20000,
            autoConnect: true,
            // Force to use the correct namespace
            forceNew: true
          };

          console.log('[pgAgent] Socket.IO options:', JSON.stringify(socketOptions));

          // Try to use the global io first, then fallback to window.io
          let socketManager;
          try {
            if (typeof io !== 'undefined') {
              console.log('[pgAgent] Using global io');
              socketManager = io;
            } else if (window.io !== undefined) {
              console.log('[pgAgent] Using window.io');
              socketManager = window.io;
            } else if (typeof socket_io !== 'undefined') {
              console.log('[pgAgent] Using socket_io');
              socketManager = socket_io;
            } else {
              console.error('[pgAgent] Socket.IO not available');
              return false;
            }

            // Connect to the Socket.IO server using the correct namespace
            if (self.socket && self.socket.connected) {
              console.log('[pgAgent] Disconnecting existing socket');
              self.disconnectJobStatusSocket();
            }

            // Important: We're using manually constructed URL to ensure namespace is correct
            console.log('[pgAgent] Attempting connection with explicit namespace: ' + pgAgentNamespace);
            self.socket = socketManager(pgAgentNamespace, socketOptions);
            
            if (!self.socket) {
              console.error('[pgAgent] Failed to create socket instance');
              return false;
            }
            
            // Set a custom property to track the namespace
            self.socket._pgAgentNamespace = pgAgentNamespace;
            
            // Set up event handlers for the socket
            self.socket.on('connect', function() {
              console.log('[pgAgent] Socket.IO connected successfully with ID: ' + self.socket.id);
              console.log('[pgAgent] Socket.IO namespace: ' + (self.socket.nsp?.name || self.socket._pgAgentNamespace || '(unknown)'));
              
              // Set the namespace explicitly if it's not set
              if (!self.socket.nsp || !self.socket.nsp.name) {
                console.log('[pgAgent] Socket namespace not detected, using custom tracking');
                self.socket._pgAgentNamespace = pgAgentNamespace;
              }
              
              // CRITICAL FIX: Start the job status listener with the server ID
              if (self.currentServerId) {
                console.log('[pgAgent] Starting job status listener for server ID:', self.currentServerId);
                self.socket.emit('start_job_status_listener', { 
                  sid: self.currentServerId,
                  client_info: {
                    client_id: self.socket.id,
                    timestamp: new Date().toISOString()
                  }
                });
                console.log('[pgAgent] Job status listener start request sent for server ID:', self.currentServerId);
              } else {
                console.error('[pgAgent] Cannot start job status listener - no server ID available');
              }
              
              // Start the keep-alive ping if it exists
              if (typeof self.startKeepAlivePing === 'function') {
                self.startKeepAlivePing();
              }
            });
            
            // Handle success event for job status listener start
            self.socket.on('job_status_listener_started', function(data) {
              console.log('[pgAgent] Job status listener started:', data);
              self._jobStatusListenerActive = true;
              
              // If diagnostics exist, update the status
              if (window.pgAgentSocketDiagnostics && window.pgAgentSocketDiagnostics.status) {
                window.pgAgentSocketDiagnostics.status.listenerActive = true;
                window.pgAgentSocketDiagnostics.status.listenerStartTime = new Date().toISOString();
                window.pgAgentSocketDiagnostics.status.checks.push({
                  type: 'listener_started',
                  timestamp: new Date().toISOString(),
                  data: data
                });
              }
            });
            
            // Handle error event for job status listener
            self.socket.on('job_status_listener_error', function(data) {
              console.error('[pgAgent] Job status listener error:', data);
              self._jobStatusListenerActive = false;
              
              // If diagnostics exist, update the status
              if (window.pgAgentSocketDiagnostics && window.pgAgentSocketDiagnostics.status) {
                window.pgAgentSocketDiagnostics.status.listenerActive = false;
                window.pgAgentSocketDiagnostics.status.errors.push({
                  type: 'listener_error',
                  timestamp: new Date().toISOString(),
                  error: data
                });
              }
              
              // Attempt to restart the listener after a delay
              if (self.currentServerId) {
                setTimeout(function() {
                  if (self.socket && self.socket.connected) {
                    console.log('[pgAgent] Attempting to restart job status listener...');
                    self.socket.emit('start_job_status_listener', { 
                      sid: self.currentServerId,
                      client_info: {
                        client_id: self.socket.id,
                        timestamp: new Date().toISOString(),
                        retry: true
                      }
                    });
                  }
                }, 5000); // 5 second delay before retry
              }
            });
            
            self.socket.on('connect_error', function(err) {
              console.error('[pgAgent] Socket connection error:', err);
              console.error('[pgAgent] Socket connection details:', {
                namespace: pgAgentNamespace,
                path: socketOptions.path,
                uri: window.location.origin + socketOptions.path,
                readyState: self.socket.io ? self.socket.io.readyState : 'unknown'
              });
              
              // Try to diagnose common issues
              if (err.message && err.message.includes('ETIMEDOUT')) {
                console.error('[pgAgent] Connection timeout - check firewall or proxy settings');
              } else if (err.message && err.message.includes('xhr poll error')) {
                console.error('[pgAgent] XHR polling error - fallback transport failed');
                // Try to force websocket transport on next attempt
                socketOptions.transports = ['websocket'];
              } else if (err.message && err.message.includes('websocket error')) {
                console.error('[pgAgent] WebSocket transport error - trying to fall back to polling');
                // Try to force polling on next attempt
                socketOptions.transports = ['polling'];
              }
            });
            
            self.socket.on('error', function(err) {
              console.error('[pgAgent] Socket error:', err);
            });
            
            self.socket.on('disconnect', function(reason) {
              console.log('[pgAgent] Socket disconnected:', reason);
              self._jobStatusListenerActive = false;
              
              // Stop the keep-alive ping
              self.stopKeepAlivePing();
              
              // Track disconnection reason for diagnostics
              if (window.pgAgentSocketDiagnostics && window.pgAgentSocketDiagnostics.status) {
                window.pgAgentSocketDiagnostics.status.lastDisconnectReason = reason;
                window.pgAgentSocketDiagnostics.status.lastDisconnectTime = new Date().toISOString();
                
                // Add to error log if it was an unexpected disconnection
                if (reason !== 'io client disconnect') {
                  window.pgAgentSocketDiagnostics.status.errors.push({
                    type: 'socket_disconnected',
                    reason: reason,
                    timestamp: new Date().toISOString()
                  });
                }
              }
            });
            
            self.socket.on('job_status_update', function(data) {
              console.log('📢[pgAdmin pgAgent] Job status update received:', data);
              
              try {
                if (!data) {
                  console.error('📢[pgAdmin pgAgent] Invalid job status update - data is null or undefined');
                  return;
                }
                
                let statusData = data.status;
                let serverId = data.sid;
                let jobId = data.job_id;
                
                if (!statusData) {
                  console.error('📢[pgAdmin pgAgent] Invalid job status update - missing status data');
                  return;
                }
                
                if (!serverId) {
                  console.error('📢[pgAdmin pgAgent] Invalid job status update - missing server ID');
                  return;
                }
                
                // Log the notification details
                console.log('📢[pgAdmin pgAgent] Processing job update for server:', serverId,
                           'job:', jobId,
                           'status:', statusData.status || 'unknown');
                
                // Call the refreshJobNode method with proper error handling
                if (jobId) {
                  self.refreshJobNode(serverId, jobId);
                } else {
                  console.warn('📢[pgAdmin pgAgent] Job ID missing in update, refreshing all jobs');
                  self.refreshJobs(serverId);
                }
              } catch (e) {
                console.error('📢[pgAdmin pgAgent] Error processing job status update:', e);
                console.error('📢[pgAdmin pgAgent] Update data:', data);
                
                window.pgAgentSocketDiagnostics.status.errors.push({
                  type: 'job_status_update_error',
                  error: e.message,
                  data: JSON.stringify(data),
                  timestamp: new Date().toISOString()
                });
              }
            });
            
            self.socket.on('reconnect', function(attemptNumber) {
              console.log('[pgAgent] Socket.IO reconnected after', attemptNumber, 'attempts');
              
              // Reestablish job status listener after reconnection if we have a server ID
              if (self.currentServerId) {
                console.log('[pgAgent] Reestablishing job status listener for server ID:', self.currentServerId);
                self.socket.emit('start_job_status_listener', { 
                  sid: self.currentServerId,
                  client_info: {
                    client_id: self.socket.id,
                    timestamp: new Date().toISOString(),
                    reconnect: true
                  }
                });
              }
              
              // Run a connection test after reconnection
              if (window.pgAgentSocketDiagnostics && 
                  typeof window.pgAgentSocketDiagnostics.testDirectConnection === 'function') {
                setTimeout(function() {
                  console.log('[pgAgent] Running connection test after reconnect event');
                  window.pgAgentSocketDiagnostics.testDirectConnection();
                }, 1000);
              }
            });
            
            console.log('[pgAgent] Socket event handlers set up successfully');
            return true;
          } catch (err) {
            console.error('[pgAgent] Error connecting job status socket:', err);
            return false;
          }
        } catch (err) {
          console.error('[pgAgent] Error connecting job status socket:', err);
          return false;
        }
      },
      
      /* Start a keep-alive ping to prevent socket disconnection */
      startKeepAlivePing: function() {
        var self = this;
        
        // Clear any existing interval
        self.stopKeepAlivePing();
        
        // Set a new interval to ping the server every 30 seconds
        self._keepAlivePingInterval = setInterval(function() {
          if (self.socket && self.socket.connected) {
            console.log('[pgAgent] Sending keep-alive ping');
            self.socket.emit('ping', { 
              timestamp: new Date().toISOString(),
              client_id: self.socket.id
            });
          } else {
            // Stop pinging if socket is disconnected
            self.stopKeepAlivePing();
          }
        }, 30000); // 30 seconds
        
        console.log('[pgAgent] Started keep-alive ping with interval:', self._keepAlivePingInterval);
      },
      
      /* Stop the keep-alive ping interval */
      stopKeepAlivePing: function() {
        var self = this;
        
        if (self._keepAlivePingInterval) {
          console.log('[pgAgent] Stopping keep-alive ping interval:', self._keepAlivePingInterval);
          clearInterval(self._keepAlivePingInterval);
          self._keepAlivePingInterval = null;
        }
      },

      refreshJobNodeIfNeeded: function(data) {
        var self = this;
        
        if (!data || !data.job_id) {
          console.warn('[pgAgent] Received job status update without job_id');
          return;
        }
        
        console.log('[pgAgent] Processing job status update:', data);
        
        // Make sure browser and tree are available
        if (!pgBrowser || !pgBrowser.tree) {
          console.warn('[pgAgent] Cannot refresh job node: browser or tree not available');
          return;
        }
        
        // Find the job node in the tree
        try {
          // We need to find all job nodes that match the job_id
          var treeRoot = pgBrowser.tree.rootNode();
          var matchingNodes = [];
          
          // Function to recursively search for job nodes
          function findJobNodes(node) {
            if (!node) return;
            
            // Check if this is a job node with matching ID
            if (node._type === 'pga_job' && 
                node._id && 
                node._id.toString() === data.job_id.toString()) {
              matchingNodes.push(node);
            }
            
            // Check children
            if (node.children) {
              node.children.forEach(findJobNodes);
            }
          }
          
          // Start search from root
          findJobNodes(treeRoot);
          
          if (matchingNodes.length === 0) {
            console.log('[pgAgent] No matching job nodes found for job_id:', data.job_id);
            return;
          }
          
          // Refresh each matching node
          matchingNodes.forEach(function(node) {
            console.log('[pgAgent] Refreshing job node:', node._id);
            pgBrowser.tree.refresh(node);
          });
          
          console.log('[pgAgent] Refreshed', matchingNodes.length, 'job nodes for job_id:', data.job_id);
        } catch (err) {
          console.error('[pgAgent] Error refreshing job node:', err);
        }
      },

      /* Refresh a job node when status update is received */
      refreshJobNode: function(serverId, jobId) {
        const t = pgBrowser.tree;
        console.log('Refreshing job node for server ID:', serverId, 'and job ID:', jobId);
        
        try {
          // First attempt: Find the server node by data-attribute
          let serverNode = t.findNodeByDomElement(
            `div[data-pgadmin-node-type="server"][data-pgadmin-value="${serverId}"]`
          );
          
          // If server node not found, try to find it by traversing the tree
          if (!serverNode) {
            console.log('Server node not found by DOM element, trying alternative method');
            const rootNode = t.rootNode;
            t.findNodesByDomElement(rootNode, function(node) {
              const data = t.itemData(node);
              if (data && data._type === 'server' && data._id === serverId) {
                serverNode = node;
                return true;
              }
              return false;
            });
          }
          
          if (!serverNode) {
            console.log('Server node not found, cannot refresh job');
            return;
          }
          
          console.log('Server node found, looking for pgAgent collection node');
          
          // Find the pgAgent collection node
          let collectionNode = null;
          t.findChildNodes(serverNode, function(node) {
            const data = t.itemData(node);
            if (data && data._type === 'coll-pga_job') {
              collectionNode = node;
              return true;
            }
            return false;
          });
          
          if (!collectionNode) {
            console.log('pgAgent collection node not found, cannot refresh job');
            return;
          }
          
          console.log('pgAgent collection node found, looking for job node');
          
          // Find the specific job node
          let jobNode = null;
          if (t.isInode(collectionNode)) {
            t.findChildNodes(collectionNode, function(node) {
              const data = t.itemData(node);
              if (data && data._type === 'pga_job' && data.jobid === jobId) {
                jobNode = node;
                return true;
              }
              return false;
            });
          }
          
          // If job node found, refresh it
          if (jobNode) {
            console.log('Job node found, refreshing it');
            // Unload and reload the job node to refresh its data
            t.unload(jobNode);
            t.setInode(jobNode);
            
            // If the job node is currently selected, re-select it after refreshing
            if (t.selected() && t.selected().length > 0 && 
                t.selected().indexOf(jobNode) !== -1) {
              setTimeout(function() { 
                t.select(jobNode); 
              }, 500);
            }
          } else {
            console.log('Job node not found, refreshing entire collection');
            t.refresh(collectionNode);
          }
        } catch (ex) {
          console.error('Error refreshing job node:', ex);
        }
      },
      
      /* Refresh all pgAgent jobs for a server */
      refreshJobs: function(serverId) {
        const t = pgBrowser.tree;
        console.log('📢[pgAdmin pgAgent] Refreshing all jobs for server ID:', serverId);
        
        try {
          // Find the server node in the tree
          let serverNode = t.findNodeByDomElement(
            `div[data-pgadmin-node-type="server"][data-pgadmin-value="${serverId}"]`
          );
          
          // If server node not found, try to find it by traversing the tree
          if (!serverNode) {
            console.log('📢[pgAdmin pgAgent] Server node not found by DOM element, trying alternative method');
            const rootNode = t.rootNode;
            t.findNodesByDomElement(rootNode, function(node) {
              const data = t.itemData(node);
              if (data && data._type === 'server' && data._id === serverId) {
                serverNode = node;
                return true;
              }
              return false;
            });
          }
          
          if (!serverNode) {
            console.warn('📢[pgAdmin pgAgent] Server node not found for ID:', serverId);
            return;
          }
          
          // Find the pgAgent Jobs collection node under the server
          let collectionNode = null;
          t.findChildNodes(serverNode, function(node) {
            const data = t.itemData(node);
            if (data && data._type === 'coll-pga_job') {
              collectionNode = node;
              return true;
            }
            return false;
          });
          
          if (!collectionNode) {
            console.warn('📢[pgAdmin pgAgent] pgAgent Jobs collection node not found for server:', serverId);
            return;
          }
          
          // Refresh the pgAgent Jobs collection node
          console.log('📢[pgAdmin pgAgent] Refreshing pgAgent Jobs collection');
          setTimeout(function() {
            try {
              t.refresh(collectionNode).then(function() {
                console.log('📢[pgAdmin pgAgent] Successfully refreshed pgAgent Jobs collection');
              }).catch(function(err) {
                console.error('📢[pgAdmin pgAgent] Error refreshing pgAgent Jobs collection:', err);
              });
            } catch (e) {
              console.error('📢[pgAdmin pgAgent] Error triggering refresh:', e);
            }
          }, 100);
          
        } catch (e) {
          console.error('📢[pgAdmin pgAgent] Error in refreshJobs:', e);
        }
      },
      
      /* Set up diagnostic tools for socket debugging */
      setupDiagnosticTools: function() {
        var self = this;
        console.log('[pgAgent] Setting up diagnostic tools');
        
        // Create global diagnostic object if it doesn't exist
        window.pgAgentSocketDiagnostics = window.pgAgentSocketDiagnostics || {
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          status: {
            checks: [],
            errors: []
          }
        };
        
        // Help documentation
        window.pgAgentSocketDiagnostics.help = function() {
          console.log('===== pgAgent Socket Diagnostics Help =====');
          console.log('Available commands:');
          console.log('  pgAgentSocketDiagnostics.status() - Show current connection status');
          console.log('  pgAgentSocketDiagnostics.testConnection() - Test socket connection');
          console.log('  pgAgentSocketDiagnostics.testDirectConnection() - Test direct socket connection');
          console.log('  pgAgentSocketDiagnostics.testNotification() - Test notification processing');
          console.log('  pgAgentSocketDiagnostics.testSimpleNotification() - Test notification with simple endpoint');
          console.log('  pgAgentSocketDiagnostics.reconnect() - Force socket reconnection');
          console.log('  pgAgentSocketDiagnostics.help() - Show this help message');
          return 'Help displayed in console.';
        };
        
        // Record environment info
        window.pgAgentSocketDiagnostics.environment = {
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString()
        };
        
        // Log initial state
        console.log('[pgAgent] Diagnostic tools initialized at', window.pgAgentSocketDiagnostics.timestamp);
        
        // Add a URL validation function
        window.pgAgentSocketDiagnostics.validateSocketURL = function() {
          console.log('====== pgAgent Socket URL Validation ======');
          
          // Test URL construction
          try {
            // Get the full base URL and path components
            const origin = window.location.origin;
            const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
            
            // For Socket.IO, we connect to the root and use namespaces
            console.log('URL components:');
            console.log('- Origin:', origin);
            console.log('- pgAdmin path:', pgAdminPath);
            console.log('- Socket.IO path:', pgAdminPath + '/socket.io');
            console.log('- Socket.IO namespace:', 'pgagent');
            
            // WebSocket URL construction for Socket.IO
            const wsUrl = new URL(pgAdminPath + '/socket.io', origin);
            wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            console.log('WebSocket URL construction:', wsUrl.href);
            
            // Correct Socket.IO URL format
            console.log('Correct Socket.IO connection format:');
            console.log('- URL: origin (', origin, ')');
            console.log('- Namespace: "pgagent" (not a URL path)');
            console.log('- Path option: "' + pgAdminPath + '/socket.io"');
            
            // Record all URL construction results
            return {
              origin: origin,
              pgAdminPath: pgAdminPath,
              socketIoPath: pgAdminPath + '/socket.io',
              socketIoNamespace: 'pgagent',
              websocketUrl: wsUrl.href,
              href: window.location.href
            };
          } catch (err) {
            console.error('Error validating Socket.IO URLs:', err);
            return {
              error: err.toString(),
              origin: window.location.origin,
              href: window.location.href
            };
          }
        };
        
        // Add a function to check for Socket.IO availability
        window.pgAgentSocketDiagnostics.checkSocketIO = function() {
          console.log('====== Socket.IO Module Check ======');
          
          const socketIOAvailability = {
            'socket_instance': {
              available: typeof socket_instance !== 'undefined',
              type: typeof socket_instance
            },
            'socket_instance.io': {
              available: typeof socket_instance !== 'undefined' && 
                        socket_instance && 
                        typeof socket_instance.io !== 'undefined',
              type: typeof socket_instance !== 'undefined' && 
                    socket_instance ? 
                    typeof socket_instance.io : 'N/A'
            },
            'socket_instance.io.connect': {
              available: typeof socket_instance !== 'undefined' && 
                        socket_instance && 
                        socket_instance.io && 
                        typeof socket_instance.io.connect === 'function',
              type: typeof socket_instance !== 'undefined' && 
                    socket_instance && 
                    socket_instance.io ? 
                    typeof socket_instance.io.connect : 'N/A'
            },
            'socket_io': {
              available: typeof socket_io !== 'undefined',
              type: typeof socket_io
            },
            'window.io': {
              available: typeof window.io !== 'undefined',
              type: typeof window.io
            },
            'global.io': {
              available: typeof io !== 'undefined',
              type: typeof io
            }
          };
          
          console.log('Socket.IO module availability:');
          for (const key in socketIOAvailability) {
            const item = socketIOAvailability[key];
            console.log(`- ${key}: ${item.available ? '✓' : '✗'} (${item.type})`);
          }
          
          // Display info about socket_instance if available
          if (socketIOAvailability['socket_instance'].available) {
            console.log('\nSocket Instance Details:');
            if (socket_instance.io) {
              console.log('- Has io property: ✓');
              console.log('- io type:', typeof socket_instance.io);
              console.log('- Has io.connect():', typeof socket_instance.io.connect === 'function' ? '✓' : '✗');
            } else {
              console.log('- Has io property: ✗');
            }
            
            console.log('- Has openSocket():', typeof socket_instance.openSocket === 'function' ? '✓' : '✗');
            console.log('- Has registry:', typeof socket_instance.registry !== 'undefined' ? '✓' : '✗');
            
            // Check for any registered sockets
            if (socket_instance.registry && socket_instance.registry.connections) {
              const connCount = Object.keys(socket_instance.registry.connections).length;
              console.log('- Registered connections:', connCount);
              if (connCount > 0) {
                console.log('- Active connections:');
                for (const ns in socket_instance.registry.connections) {
                  const sock = socket_instance.registry.connections[ns];
                  console.log(`  * ${ns}: connected=${sock.connected}, id=${sock.id || 'none'}`);
                }
              }
            }
          }
          
          return socketIOAvailability;
        };
        
        // Add a test function to specifically check for transport errors
        window.pgAgentSocketDiagnostics.checkTransportErrors = function() {
          console.log('====== Socket.IO Transport Diagnostics ======');
          
          try {
            // Get reference to pgAgent module
            var pgaModule = pgBrowser.Nodes['pga_job'];
            
            if (!pgaModule) {
              console.error('pgAgent module not found in pgBrowser.Nodes');
              return {
                available: false,
                error: 'pgAgent module not found'
              };
            }
            
            // Check for existing socket connection
            if (!pgaModule.socket) {
              console.log('No existing socket connection. Will attempt a test connection.');
              
              // Create a test socket to check transport errors
              const baseUrl = window.location.origin;
              const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
              const pgAgentNamespace = '/pgagent';
              
              console.log('Creating test connection with:');
              console.log('- Origin:', baseUrl);
              console.log('- pgAdmin Path:', pgAdminPath);
              console.log('- Socket.IO Path:', pgAdminPath + '/socket.io');
              console.log('- Namespace:', pgAgentNamespace);
              
              // Try to connect with both transports to test which one works
              const testSocket = io(pgAgentNamespace, {
                path: pgAdminPath + '/socket.io',
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 1,
                reconnectionDelay: 100,
                timeout: 5000,
                auth: {
                  test: true
                }
              });
              
              console.log('Test connection initiated');
              
              // Set up event handlers to track connection status
              const connectionStatus = {
                connected: false,
                transport: null,
                errors: [],
                disconnected: false,
                disconnectReason: null
              };
              
              testSocket.on('connect', function() {
                connectionStatus.connected = true;
                connectionStatus.transport = testSocket.io.engine.transport.name;
                console.log('Test connection successful via ' + connectionStatus.transport);
                
                // Check for transport upgrade ability
                testSocket.io.engine.once('upgrade', function() {
                  console.log('Transport upgraded to: ' + testSocket.io.engine.transport.name);
                  connectionStatus.transport = testSocket.io.engine.transport.name;
                });
                
                // Disconnect after 3 seconds
                setTimeout(function() {
                  console.log('Closing test connection');
                  testSocket.disconnect();
                }, 3000);
              });
              
              testSocket.on('connect_error', function(err) {
                console.error('Test connection error:', err);
                connectionStatus.errors.push({
                  type: 'connect_error',
                  message: err.toString(),
                  timestamp: new Date().toISOString()
                });
              });
              
              testSocket.on('error', function(err) {
                console.error('Test socket error:', err);
                connectionStatus.errors.push({
                  type: 'error',
                  message: err.toString(),
                  timestamp: new Date().toISOString()
                });
              });
              
              testSocket.on('disconnect', function(reason) {
                console.log('Test connection disconnected:', reason);
                connectionStatus.disconnected = true;
                connectionStatus.disconnectReason = reason;
              });
              
              // Let caller know this is async
              console.log('Transport test initiated - check console for results in a few seconds');
              
              return {
                testing: true,
                message: 'Transport test in progress - check console for results'
              };
            } else {
              // Existing socket is available, report on its status
              const socket = pgaModule.socket;
              
              const transportInfo = {
                connected: socket.connected,
                id: socket.id,
                namespace: socket.nsp ? socket.nsp.name : 'unknown',
                transport: socket.io && socket.io.engine ? socket.io.engine.transport.name : 'unknown',
                transportProtocol: socket.io && socket.io.engine ? socket.io.engine.protocol : 'unknown',
                supportedTransports: socket.io ? socket.io._readyState : 'unknown'
              };
              
              console.log('Current socket transport information:');
              for (const key in transportInfo) {
                console.log(`- ${key}: ${transportInfo[key]}`);
              }
              
              // Check if we have any recorded errors
              if (window.pgAgentSocketDiagnostics && 
                  window.pgAgentSocketDiagnostics.status && 
                  window.pgAgentSocketDiagnostics.status.errors && 
                  window.pgAgentSocketDiagnostics.status.errors.length > 0) {
                console.log('\nRecorded transport errors:');
                window.pgAgentSocketDiagnostics.status.errors.forEach(function(err, idx) {
                  console.log(`${idx + 1}. [${err.timestamp}] ${err.type}: ${err.message || err.reason || JSON.stringify(err)}`);
                });
              } else {
                console.log('No recorded transport errors');
              }
              
              return transportInfo;
            }
          } catch (err) {
            console.error('Error in transport diagnostics:', err);
            return {
              error: err.toString()
            };
          }
        };
        
        // Check environment function
        window.pgAgentSocketDiagnostics.checkEnvironment = function() {
          console.log('====== pgAgent Socket Environment Check ======');
          console.log('Browser:', navigator.userAgent);
          console.log('URL:', window.location.href);
          console.log('Time:', new Date().toISOString());
          
          // Check for required globals
          var globals = {
            'socket_instance': typeof socket_instance !== 'undefined',
            'socket_instance.io': typeof socket_instance !== 'undefined' && socket_instance && socket_instance.io,
            'socket_instance.openSocket': typeof socket_instance !== 'undefined' && socket_instance && typeof socket_instance.openSocket === 'function',
            'socket_io': typeof socket_io !== 'undefined',
            'io': typeof io !== 'undefined',
            'url_for': typeof url_for === 'function'
          };
          
          console.log('Required globals:');
          for (var key in globals) {
            console.log('  ' + key + ':', globals[key] ? '✓ Available' : '✗ Missing');
            
            // Record check result
            window.pgAgentSocketDiagnostics.status.checks.push({
              type: 'global',
              name: key,
              available: globals[key],
              timestamp: new Date().toISOString()
            });
            
            // Record error if a required global is missing
            if (!globals[key]) {
              window.pgAgentSocketDiagnostics.status.errors.push({
                type: 'missing_global',
                name: key,
                timestamp: new Date().toISOString()
              });
            }
          }
          
          // Check current socket status
          console.log('Current socket status:');
          if (self.socket) {
            console.log('  Socket exists:', '✓');
            console.log('  Socket ID:', self.socket.id || 'None');
            console.log('  Connected:', self.socket.connected ? '✓' : '✗');
            console.log('  Disconnected:', self.socket.disconnected ? '✓' : '✗');
            
            // Record socket status
            window.pgAgentSocketDiagnostics.socketStatus = {
              exists: true,
              id: self.socket.id,
              connected: self.socket.connected,
              disconnected: self.socket.disconnected,
              timestamp: new Date().toISOString()
            };
          } else {
            console.log('  Socket exists:', '✗');
            
            // Record socket status
            window.pgAgentSocketDiagnostics.socketStatus = {
              exists: false,
              timestamp: new Date().toISOString()
            };
            
            // Record error if socket doesn't exist
            window.pgAgentSocketDiagnostics.status.errors.push({
              type: 'socket_missing',
              timestamp: new Date().toISOString()
            });
          }
          
          return window.pgAgentSocketDiagnostics.status;
        };
        
        // Test direct connection function
        window.pgAgentSocketDiagnostics.testDirectConnection = function() {
          console.log('====== pgAgent Socket Connection Test ======');
          var testSocket = null;
          
          try {
            // Construct the socket URLs properly - avoid double slashes in URL
            const baseUrl = window.location.origin;
            const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
            // Just use the namespace name with leading slash for Socket.IO
            const pgAgentNamespace = '/pgagent';
            
            console.log('Socket connection test configuration:');
            console.log('- Base URL:', baseUrl);
            console.log('- pgAdmin path:', pgAdminPath);
            console.log('- Socket.IO path:', pgAdminPath + '/socket.io');
            console.log('- pgAgent namespace:', pgAgentNamespace);
            
            console.log('Attempting test connection with namespace:', pgAgentNamespace);
            
            // Record connection attempt
            window.pgAgentSocketDiagnostics.status.checks.push({
              type: 'connection_test',
              url: baseUrl,
              namespace: pgAgentNamespace,
              started: true,
              timestamp: new Date().toISOString()
            });
            
            // Enhanced connection options to prevent quick disconnection
            const socketOptions = {
              path: pgAdminPath + '/socket.io',
              reconnection: false,
              timeout: 5000
            };
            
            // Try using socket_instance first
            if (socket_instance && socket_instance.io) {
              console.log('Using socket_instance.io for test');
              testSocket = socket_instance.io(pgAgentNamespace, socketOptions);
            } else if (socket_io) {
              console.log('Using imported socket_io for test');
              testSocket = socket_io(pgAgentNamespace, socketOptions);
            } else if (typeof io !== 'undefined') {
              console.log('Using global io for test');
              testSocket = io(pgAgentNamespace, socketOptions);
            } else {
              throw new Error('No Socket.IO client available for test');
            }
            
            // Check namespace immediately after creation
            console.log('Socket created, checking namespace before connection:');
            console.log('- Socket has nsp:', testSocket.nsp ? '✓' : '✗');
            if (testSocket.nsp) {
              console.log('- Socket namespace:', testSocket.nsp.name);
              console.log('- Namespace correct:', testSocket.nsp.name === pgAgentNamespace ? '✓' : '✗');
            }
            
            // Set up event handlers for the test socket
            testSocket.on('connect', function() {
              console.log('Test connection succeeded with ID:', testSocket.id);
              
              // Verify namespace after connection
              if (testSocket.nsp) {
                console.log('Socket namespace after connect:', testSocket.nsp.name);
                console.log('Namespace matches expected:', 
                  testSocket.nsp.name === pgAgentNamespace ? '✓' : '✗');
              } else {
                console.warn('Socket nsp property not available after connection');
              }
              
              // Check Socket.IO version
              const isSocketIOv4 = testSocket.io && testSocket.io.engine 
                && typeof testSocket.io.engine.transport !== 'undefined';
              
              console.log('Socket.IO test connection using transport:', 
                isSocketIOv4 ? testSocket.io.engine.transport.name : 'unknown');
              
              // Send echo test with different event formats
              console.log('Sending echo test');
              testSocket.emit('echo_test', { 
                message: 'Test from pgAgent diagnostics', 
                timestamp: new Date().toISOString() 
              });
              
              // Record successful connection
              window.pgAgentSocketDiagnostics.status.checks.push({
                type: 'connection_test',
                namespace: pgAgentNamespace,
                success: true,
                socketId: testSocket.id,
                timestamp: new Date().toISOString()
              });
              
              // Disconnect after a short delay
              setTimeout(function() {
                testSocket.disconnect();
                console.log('Test socket disconnected');
              }, 3000);
            });
            
            testSocket.on('echo_response', function(response) {
              console.log('Received echo response from server:', response);
              
              // Record echo response
              window.pgAgentSocketDiagnostics.status.checks.push({
                type: 'echo_response',
                response: response,
                timestamp: new Date().toISOString()
              });
            });
            
            testSocket.on('connect_error', function(err) {
              console.error('Test connection error:', err);
              
              // Try to log as much info as possible about the error
              var errorDetails = {
                message: err.message || 'Unknown error',
                type: err.type || typeof err,
                data: err.data || null
              };
              console.error('Connection error details:', errorDetails);
              
              // Check if the error might be related to namespace issues
              if (err.message && 
                  (err.message.includes('namespace') || 
                   err.message.includes('Invalid namespace'))) {
                console.error('Namespace error detected. Make sure namespace starts with a /');
              }
              
              // Record connection error
              window.pgAgentSocketDiagnostics.status.errors.push({
                type: 'connection_error',
                namespace: pgAgentNamespace,
                error: err.toString(),
                error_details: errorDetails,
                timestamp: new Date().toISOString()
              });
              
              // Disconnect test socket
              testSocket.disconnect();
            });
            
            testSocket.on('error', function(err) {
              console.error('Test socket error:', err);
              
              // Record socket error
              window.pgAgentSocketDiagnostics.status.errors.push({
                type: 'socket_error',
                error: err.toString(),
                timestamp: new Date().toISOString()
              });
            });
            
            return true;
          } catch (err) {
            console.error('Error in test connection:', err);
            
            // Record test error
            window.pgAgentSocketDiagnostics.status.errors.push({
              type: 'test_error',
              error: err.toString(),
              timestamp: new Date().toISOString()
            });
            
            return false;
          }
        };
        
        // Run initial environment check
        window.pgAgentSocketDiagnostics.checkEnvironment();
        console.log('[pgAgent] Validating Socket.IO URLs:');
        window.pgAgentSocketDiagnostics.validateSocketURL();
        console.log('[pgAgent] Diagnostic tools setup complete. Type pgAgentSocketDiagnostics.help() in the console for available commands.');
        
        // Add the fix connection function
        window.pgAgentSocketDiagnostics.fixConnection = function() {
          console.log('====== pgAgent Socket Connection Fix ======');
          
          try {
            // Get reference to pgAgent module
            var pgaModule = pgBrowser.Nodes['pga_job'];
            
            if (!pgaModule) {
              console.error('pgAgent module not found in pgBrowser.Nodes');
              return {
                success: false,
                error: 'pgAgent module not found'
              };
            }
            
            console.log('Checking current connection status...');
            
            // First, store the current server ID if we have one
            var currentServerId = pgaModule.currentServerId;
            console.log('Current server ID:', currentServerId || 'None');
            
            // Check if socket exists and its status
            var socketExists = pgaModule.socket ? true : false;
            var socketConnected = socketExists && pgaModule.socket.connected;
            var correctNamespace = false;

            if (socketExists && pgaModule.socket.nsp) {
              // More detailed logging about the namespace
              console.log('Socket namespace details:', {
                nspName: pgaModule.socket.nsp.name,
                nspType: typeof pgaModule.socket.nsp.name,
                expectedNamespace: pgAgentNamespace,
                namespacesMatch: pgaModule.socket.nsp.name === pgAgentNamespace
              });
              
              // Check for exact match or if the namespace is there but formatted differently
              correctNamespace = pgaModule.socket.nsp.name === pgAgentNamespace ||
                                 pgaModule.socket.nsp.name === '/pgagent';
            } else if (socketExists) {
              console.log('Socket exists but nsp property is missing:', pgaModule.socket);
            }
            
            console.log('Socket status:');
            console.log('- Exists:', socketExists ? '✓' : '✗');
            console.log('- Connected:', socketConnected ? '✓' : '✗');
            console.log('- In correct namespace:', correctNamespace ? '✓' : '✗');
            
            // Always disconnect existing socket first to ensure clean state
            if (socketExists) {
              console.log('Disconnecting existing socket...');
              pgaModule.disconnectJobStatusSocket();
              
              // Wait a moment to ensure disconnection is complete
              setTimeout(function() {
                console.log('Reconnecting socket to pgagent namespace...');
                
                // Reconnect with the server ID we had before
                if (currentServerId) {
                  console.log('Connecting with server ID:', currentServerId);
                  pgaModule.connectJobStatusSocket(currentServerId);
                } else {
                  console.warn('No server ID available for reconnection');
                  console.log('Will connect without server ID - listener will not function until a server ID is set');
                  pgaModule.connectJobStatusSocket();
                }
                
                // Schedule a check of the new connection
                setTimeout(function() {
                  console.log('Checking new connection status...');
                  
                  var newSocketExists = pgaModule.socket ? true : false;
                  var newSocketConnected = newSocketExists && pgaModule.socket.connected;
                  var newCorrectNamespace = newSocketExists && 
                                          pgaModule.socket.nsp && 
                                          pgaModule.socket.nsp.name && 
                                          pgaModule.socket.nsp.name.includes('pgagent');
                  
                  console.log('New socket status:');
                  console.log('- Exists:', newSocketExists ? '✓' : '✗');
                  console.log('- Connected:', newSocketConnected ? '✓' : '✗');
                  console.log('- In correct namespace:', newCorrectNamespace ? '✓' : '✗');
                  
                  if (newSocketConnected && newCorrectNamespace) {
                    console.log('Connection fix successful!');
                    
                    // Make sure listener is started if we have a server ID
                    if (currentServerId) {
                      console.log('Ensuring job status listener is started...');
                      pgaModule.socket.emit('start_job_status_listener', { 
                        sid: currentServerId,
                        client_info: {
                          client_id: pgaModule.socket.id,
                          timestamp: new Date().toISOString(),
                          reconnect: true
                        }
                      });
                    }
                  } else {
                    console.error('Connection fix was not successful');
                    
                    if (!newSocketExists) {
                      console.error('Socket was not created');
                    } else if (!newSocketConnected) {
                      console.error('Socket failed to connect');
                    } else if (!newCorrectNamespace) {
                      console.error('Socket connected to wrong namespace');
                    }
                    
                    console.log('Check browser console for Socket.IO errors');
                    console.log('Try refreshing the page to restart the socket connection');
                  }
                }, 2000); // Wait 2 seconds for connection to complete
              }, 1000); // Wait 1 second after disconnection
            } else {
              console.log('No existing socket, creating new connection...');
              
              // Connect with server ID if available
              if (currentServerId) {
                pgaModule.connectJobStatusSocket(currentServerId);
              } else {
                pgaModule.connectJobStatusSocket();
              }
              
              console.log('Connection initiated, check browser console for results');
            }
            
            return {
              success: true,
              message: 'Connection fix initiated',
              originalStatus: {
                hadServerId: !!currentServerId,
                socketExisted: socketExists,
                wasConnected: socketConnected,
                wasInCorrectNamespace: correctNamespace
              }
            };
          } catch (err) {
            console.error('Error fixing connection:', err);
            return {
              success: false,
              error: err.toString()
            };
          }
        };
        
        // Run initial environment and diagnostic checks
        window.pgAgentSocketDiagnostics.checkEnvironment();
        window.pgAgentSocketDiagnostics.validateSocketURL();
        window.pgAgentSocketDiagnostics.checkSocketIO();
        console.log('[pgAgent] Diagnostic tools setup complete. Type pgAgentSocketDiagnostics.help() in the console for available commands.');
        
        // Check server connection status
        window.pgAgentSocketDiagnostics.checkServerConnection = function() {
          console.log('====== pgAgent Socket Server Connection Check ======');
          
          try {
            // Make an AJAX request to the server connection status endpoint
            const xhr = new XMLHttpRequest();
            // Fix the URL construction to ensure proper path joining
            const baseUrl = window.location.origin;
            const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
            const socketStatusUrl = baseUrl + pgAdminPath + '/socket-status';
            
            console.log('Socket status URL:', socketStatusUrl);
            
            xhr.open('GET', socketStatusUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('X-pgA-CSRFToken', (window.pgAdmin && window.pgAdmin.csrf_token) || '');
            xhr.withCredentials = true; // Include cookies for session authentication
            
            xhr.onreadystatechange = function() {
              if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                  const response = JSON.parse(xhr.responseText);
                  console.log('Server connection status:', response);
                  console.log('Active connections:', response.active_connections);
                  if (response.clients && response.clients.length > 0) {
                    console.log('Connected clients:');
                    response.clients.forEach(function(client, index) {
                      console.log(`Client ${index+1}:`, client);
                    });
                  } else {
                    console.log('No clients connected');
                  }
                  return response;
                } else if (xhr.status === 403) {
                  console.log('Access denied. This endpoint is only available in debug mode or for admin users.');
                  return false;
                } else if (xhr.status === 401) {
                  console.log('Authentication required. Make sure you are logged in as an admin user.');
                  return false;
                } else {
                  console.error('Error checking server connection:', xhr.status);
                  console.log('Response:', xhr.responseText);
                  return false;
                }
              }
            };
            xhr.send();
            console.log('Server connection check request sent. Awaiting response...');
            return true;
          } catch (err) {
            console.error('Error in server connection check:', err);
            return false;
          }
        };
        
        // Request server to send a test event
        window.pgAgentSocketDiagnostics.requestServerTest = function() {
          console.log('====== Requesting Server-Initiated Socket Test ======');
          
          try {
            // Make an AJAX request to trigger a server-initiated socket event
            const xhr = new XMLHttpRequest();
            // Fix the URL construction to ensure proper path joining
            const baseUrl = window.location.origin;
            const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
            const socketTestUrl = baseUrl + pgAdminPath + '/socket-test';
            
            console.log('Socket test URL:', socketTestUrl);
            
            xhr.open('GET', socketTestUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('X-pgA-CSRFToken', (window.pgAdmin && window.pgAdmin.csrf_token) || '');
            xhr.withCredentials = true; // Include cookies for session authentication
            
            xhr.onreadystatechange = function() {
              if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                  const response = JSON.parse(xhr.responseText);
                  console.log('Server test request response:', response);
                  return response;
                } else if (xhr.status === 403) {
                  console.log('Access denied. This endpoint is only available in debug mode or for admin users.');
                  return false;
                } else if (xhr.status === 401) {
                  console.log('Authentication required. Make sure you are logged in as an admin user.');
                  return false;
                } else {
                  console.error('Error requesting server test:', xhr.status);
                  console.log('Response:', xhr.responseText);
                  return false;
                }
              }
            };
            xhr.send();
            console.log('Server test request sent. Awaiting response...');
            return true;
          } catch (err) {
            console.error('Error in server test request:', err);
            return false;
          }
        };
        
        // Add function to check Socket.IO globals
        setTimeout(function() {
          if (window.pgAgentSocketDiagnostics) {
            window.pgAgentSocketDiagnostics.checkSocketGlobals = function() {
              const globals = {
                io: typeof io !== 'undefined',
                window_io: typeof window.io !== 'undefined',
                socket_io: typeof socket_io !== 'undefined',
                socket_instance: typeof socket_instance !== 'undefined',
                socket_instance_io: typeof socket_instance !== 'undefined' && typeof socket_instance.io !== 'undefined'
              };
              
              console.log('------- Socket.IO Global Availability -------');
              console.log('io (global): ' + globals.io);
              console.log('window.io: ' + globals.window_io);
              console.log('socket_io: ' + globals.socket_io);
              console.log('socket_instance: ' + globals.socket_instance);
              console.log('socket_instance.io: ' + globals.socket_instance_io);
              console.log('-------------------------------------------');
              
              // Analyze and recommend
              if (!globals.io && !globals.window_io && !globals.socket_io) {
                console.error('ERROR: No Socket.IO library available. Socket.IO may not be loaded properly.');
                console.log('Check network tab for socket.io.js or socket.io.min.js loading errors.');
                console.log('Look for script tags or import statements loading Socket.IO in the HTML source.');
              } else {
                console.log('At least one Socket.IO client is available.');
                
                // Determine which client to use for connection
                if (globals.io) {
                  console.log('Recommended connection method: io(namespace, options)');
                } else if (globals.window_io) {
                  console.log('Recommended connection method: window.io(namespace, options)');
                } else if (globals.socket_io) {
                  console.log('Recommended connection method: socket_io(namespace, options)');
                }
              }
              
              return globals;
            };
          }
        }, 0);

        // Check job status listener function
        window.pgAgentSocketDiagnostics.checkJobStatusListener = function() {
          console.log('====== Checking pgAgent Job Status Listener ======');
          
          var pgaModule = pgBrowser.Nodes['pga_job'];
          if (!pgaModule) {
            console.error('pgAgent module not found in pgBrowser.Nodes');
            return {
              success: false,
              error: 'pgAgent module not found'
            };
          }
          
          // Check if a socket connection is established
          var socket = pgaModule.socket;
          if (!socket) {
            console.error('No socket connection established for pgAgent');
            return {
              success: false,
              error: 'No socket connection established'
            };
          }
          
          console.log('Socket connection status:', socket.connected ? 'Connected' : 'Disconnected');
          
          // Check if the socket is connected to the correct namespace
          // Using optional chaining and fallbacks to prevent errors
          var currentNamespace = socket.nsp?.name || socket._pgAgentNamespace || socket.io?.opts?.path;
          var expectedNamespace = '/pgagent';
          
          console.log('Socket namespace check:', {
            hasNamespace: currentNamespace !== undefined,
            namespaceValue: currentNamespace,
            expectedNamespace: expectedNamespace,
            customNamespaceTracking: !!socket._pgAgentNamespace,
            socketObject: Object.keys(socket)
          });
          
          // Check if namespace is correct
          if (currentNamespace && currentNamespace.includes(expectedNamespace)) {
            console.log('✓ Socket is connected to the correct namespace:', currentNamespace);
          } else {
            console.warn('⚠️ Socket namespace mismatch or undefined!');
            console.warn('  - Current:', currentNamespace);
            console.warn('  - Expected:', expectedNamespace);
            console.log('Socket object:', socket);
          }
          
          return {
            success: true,
            connected: socket.connected,
            namespace: {
              current: currentNamespace,
              expected: expectedNamespace,
              isCorrect: currentNamespace && currentNamespace.includes(expectedNamespace)
            }
          };
        };

        // Add a diagnostic function to test notification processing
        window.pgAgentSocketDiagnostics.testNotification = function() {
          console.log('====== Testing pgAgent Notification Processing ======');
          
          try {
            // Get reference to pgAgent module
            var pgaModule = pgBrowser.Nodes['pga_job'];
            
            if (!pgaModule) {
              console.error('pgAgent module not found in pgBrowser.Nodes');
              return {
                success: false,
                error: 'pgAgent module not found'
              };
            }
            
            // Check if a socket connection exists
            if (!pgaModule.socket || !pgaModule.socket.connected) {
              console.error('Socket not connected, cannot test notification');
              return {
                success: false,
                error: 'Socket not connected'
              };
            }
            
            // Get server ID
            var serverId = pgaModule.currentServerId;
            if (!serverId) {
              console.error('No server ID available, cannot test notification');
              return {
                success: false,
                error: 'No server ID available'
              };
            }
            
            console.log('Sending test notification request for server ID:', serverId);
            
            // Make an AJAX request to trigger a test notification from the server
            const xhr = new XMLHttpRequest();
            const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
            const testUrl = window.location.origin + pgAdminPath + 
                           '/browser/server_groups/servers/pgagent/debug/test_notification/' + serverId;
            
            xhr.open('GET', testUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.withCredentials = true;
            
            xhr.onreadystatechange = function() {
              if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                  try {
                    const response = JSON.parse(xhr.responseText);
                    console.log('Test notification request response:', response);
                    console.log('Check console logs for notification events in the next few seconds...');
                  } catch (e) {
                    console.error('Error parsing response:', e);
                  }
                } else {
                  console.error('Error sending test notification request:', xhr.status, xhr.statusText);
                  console.log('Response:', xhr.responseText);
                }
              }
            };
            
            xhr.send();
            
            return {
              success: true,
              message: 'Test notification request sent, check console for events'
            };
          } catch (err) {
            console.error('Error testing notification:', err);
            return {
              success: false,
              error: err.toString()
            };
          }
        };

        // Add a simple test notification that works without debug mode
        window.pgAgentSocketDiagnostics.testSimpleNotification = function() {
          console.log('====== Testing pgAgent Simple Notification ======');
          
          try {
            // Get reference to pgAgent module
            var pgaModule = pgBrowser.Nodes['pga_job'];
            
            if (!pgaModule) {
              console.error('pgAgent module not found in pgBrowser.Nodes');
              return {
                success: false,
                error: 'pgAgent module not found'
              };
            }
            
            // Check if a socket connection exists
            if (!pgaModule.socket || !pgaModule.socket.connected) {
              console.error('Socket not connected, cannot test notification');
              return {
                success: false,
                error: 'Socket not connected'
              };
            }
            
            // Get server ID
            var serverId = pgaModule.currentServerId;
            if (!serverId) {
              console.error('No server ID available, cannot test notification');
              return {
                success: false,
                error: 'No server ID available'
              };
            }
            
            console.log('Sending simple test notification for server ID:', serverId);
            
            // Make an AJAX request to trigger a test notification from the server
            const xhr = new XMLHttpRequest();
            const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
            const testUrl = window.location.origin + pgAdminPath + 
                           '/browser/server_groups/servers/pgagent/test_notification_simple/' + serverId;
            
            console.log('Using test URL:', testUrl);
            
            // Log detailed Socket.IO state before sending test
            console.log('Current Socket.IO state:');
            console.log('- Connected:', pgaModule.socket.connected);
            console.log('- Socket ID:', pgaModule.socket.id);
            console.log('- Namespace:', pgaModule.socket.nsp?.name || pgaModule.socket._pgAgentNamespace || '(unknown)');
            
            // Set up a socket.io event listener for the notification
            pgaModule.socket.once('job_status_update', function(data) {
              console.log('✅ Received job_status_update event:', data);
              alert('Job status notification received! Check console for details.');
            });
            
            xhr.open('GET', testUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.withCredentials = true;
            
            xhr.onreadystatechange = function() {
              if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                  try {
                    const response = JSON.parse(xhr.responseText);
                    console.log('Simple test notification response:', response);
                    console.log('✓ Simple test notification sent successfully.');
                    console.log('Check console logs for notification events in the next few seconds...');
                    
                    // Give more guidance to users
                    console.log('If no notification appears, check:');
                    console.log('1. Server logs for NOTIFY commands');
                    console.log('2. Connection status of the Socket.IO connection');
                    console.log('3. That you are listening on the correct channel (job_status_update)');
                  } catch (e) {
                    console.error('Error parsing response:', e);
                  }
                } else {
                  console.error('Error sending simple test notification:', xhr.status, xhr.statusText);
                  console.log('Response:', xhr.responseText);
                  
                  // Provide troubleshooting guidance
                  console.log('Common troubleshooting steps:');
                  console.log('1. Check that you are connected to the server');
                  console.log('2. Verify the server has pgAgent extension installed');
                  console.log('3. Check server logs for any errors');
                  console.log('4. Try reconnecting the Socket.IO connection');
                }
              }
            };
            
            xhr.send();
            
            return {
              success: true,
              message: 'Simple test notification request sent, check console for events'
            };
          } catch (err) {
            console.error('Error testing simple notification:', err);
            return {
              success: false,
              error: err.toString()
            };
          }
        };
      },

      /* Disconnect the socket if one exists */
      disconnectJobStatusSocket: function() {
        var self = this;
        
        try {
          console.log('[pgAgent] Disconnecting job status socket...');
          
          if (self.socket) {
            // Only send stop event if the socket is connected
            if (self.socket.connected && self.currentServerId) {
              console.log('[pgAgent] Sending stop_job_status_listener for server ID:', self.currentServerId);
              self.socket.emit('stop_job_status_listener', {
                sid: self.currentServerId
              });
            }
            
            // Unregister all event handlers to prevent memory leaks
            self.socket.off('connect');
            self.socket.off('disconnect');
            self.socket.off('connect_error');
            self.socket.off('error');
            self.socket.off('job_status_listener_started');
            self.socket.off('job_status_listener_error');
            self.socket.off('job_status_update');
            self.socket.off('reconnect');
            
            // Disconnect the socket
            self.socket.disconnect();
            console.log('[pgAgent] Socket disconnected');
          }
          
          // Clean up references
          self.socket = null;
          self._jobStatusListenerActive = false;
          
          // Also stop the keep-alive ping
          self.stopKeepAlivePing();
          
          console.log('[pgAgent] Socket cleanup complete');
          return true;
        } catch (error) {
          console.error('[pgAgent] Error disconnecting socket:', error);
          return false;
        }
      }
    });
  }

  return pgBrowser.Nodes['pga_job'];
});
