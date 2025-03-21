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
        
        // Fall back to directly monitor tree.select event
        if (pgBrowser.tree) {
          pgBrowser.tree.onSelect(function() {
            try {
              console.log('Tree selected event triggered');
              const selectedNode = pgBrowser.tree.selected();
              if (!selectedNode) return;
              
              const data = pgBrowser.tree.itemData(selectedNode);
              if (data && data._type === 'coll-pga_job') {
                console.log('pgagent collection node selected via tree.selected event');
                
                // Get the server ID from the parent node
                const serverItem = pgBrowser.tree.parent(selectedNode);
                const serverData = serverItem ? pgBrowser.tree.itemData(serverItem) : null;
                
                if (serverData && serverData._type === 'server' && serverData._id) {
                  // Connect to socket and start listening for job status updates
                  console.log('Connecting to socket for server:', serverData.name || serverData._id);
                  self.connectJobStatusSocket(serverData._id);
                }
              }
            } catch (e) {
              console.error('Error in tree.selected event handler:', e);
            }
          });
        } else {
          console.error('Cannot set up tree.selected event handler: pgBrowser.tree is null');
        }
        
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
        
        if (!self.socket) {
          console.log('[pgAgent] Setting up new Socket.IO connection for job status updates');
          try {
            // Get the full base URL for the socket connection - ensuring we have protocol, host and port
            const baseUrl = window.location.origin;
            const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
            const pgAgentSocketUrl = baseUrl + '/pgagent';
            
            console.log('[pgAgent] Constructing socket URL:', pgAgentSocketUrl);
            console.log('[pgAgent] Using socket.io path:', '/socket.io');
            
            // First try to use the imported socket_instance, which should have both io and openSocket
            if (socket_instance) {
              console.log('[pgAgent] Using socket_instance to connect to:', pgAgentSocketUrl);
              
              if (socket_instance.io) {
                // Method 1: Use socket_instance.io directly
                console.log('[pgAgent] Using socket_instance.io.connect() method');
                self.socket = socket_instance.io.connect(pgAgentSocketUrl, {
                  path: '/socket.io',
                  transports: ['websocket', 'polling'],
                  reconnection: true,
                  reconnectionDelay: 1000,
                  reconnectionDelayMax: 5000,
                  reconnectionAttempts: 5,
                  timeout: 10000
                });
              } else if (socket_instance.openSocket) {
                // Method 2: Use the openSocket promise
                console.log('[pgAgent] Using socket_instance.openSocket() method');
                socket_instance.openSocket(pgAgentSocketUrl, {
                  path: '/socket.io',
                  transports: ['websocket', 'polling'],
                  reconnection: true,
                  reconnectionDelay: 1000,
                  reconnectionDelayMax: 5000,
                  reconnectionAttempts: 5,
                  timeout: 10000
                }).then(function(sock) {
                  self.socket = sock;
                  console.log('[pgAgent] Socket connected via openSocket promise with ID:', self.socket.id);
                  self.setupSocketEventHandlers();
                }).catch(function(err) {
                  console.error('[pgAgent] openSocket promise failed:', err);
                  // Try the direct method as a fallback
                  self.connectWithDirectIO(pgAgentSocketUrl);
                });
                return; // Early return since we're using the promise
              } else {
                console.error('[pgAgent] socket_instance is missing both io and openSocket methods');
                self.connectWithDirectIO(pgAgentSocketUrl);
              }
            } else {
              console.error('[pgAgent] socket_instance is not available');
              self.connectWithDirectIO(pgAgentSocketUrl);
            }
            
            // If we get here, we're using the synchronous connection methods (not the promise)
            // so we need to set up event handlers
            if (self.socket) {
              self.setupSocketEventHandlers();
            }
          } catch (err) {
            console.error('[pgAgent] Error setting up Socket.IO connection:', err);
          }
        } else {
          console.log('[pgAgent] Socket.IO already connected with ID:', self.socket.id);
        }
      },
      
      connectWithDirectIO: function(pgAgentSocketUrl) {
        var self = this;
        console.log('[pgAgent] Trying direct socket_io connection to:', pgAgentSocketUrl);
        
        try {
          // Use fixed socket.io path
          console.log('[pgAgent] Using socket.io path:', '/socket.io');
          
          // Fall back to direct socket.io-client import as a last resort
          self.socket = socket_io(pgAgentSocketUrl, {
            path: '/socket.io',
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5,
            timeout: 10000
          });
          console.log('[pgAgent] Created socket with direct socket_io import');
        } catch (err) {
          console.error('[pgAgent] Direct socket_io connection failed:', err);
        }
      },

      setupSocketEventHandlers: function() {
        var self = this;
        
        if (!self.socket) {
          console.error('[pgAgent] Cannot set up event handlers - socket is null');
          return;
        }
        
        console.log('[pgAgent] Setting up socket event handlers');
        
        self.socket.on('connect', function() {
          console.log('[pgAgent] Socket.IO connected successfully with ID:', self.socket.id);
          
          // Run a connection test after successful connection
          if (window.pgAgentSocketDiagnostics && 
              typeof window.pgAgentSocketDiagnostics.testDirectConnection === 'function') {
            setTimeout(function() {
              console.log('[pgAgent] Running connection test after connect event');
              window.pgAgentSocketDiagnostics.testDirectConnection();
            }, 1000);
          }
        });
        
        self.socket.on('connect_error', function(err) {
          console.error('[pgAgent] Socket.IO connection error:', err);
        });
        
        self.socket.on('connect_timeout', function() {
          console.error('[pgAgent] Socket.IO connection timeout');
        });
        
        self.socket.on('error', function(err) {
          console.error('[pgAgent] Socket.IO error:', err);
        });
        
        self.socket.on('disconnect', function(reason) {
          console.log('[pgAgent] Socket.IO disconnected, reason:', reason);
        });
        
        self.socket.on('reconnect', function(attemptNumber) {
          console.log('[pgAgent] Socket.IO reconnected after', attemptNumber, 'attempts');
          
          // Run a connection test after reconnection
          if (window.pgAgentSocketDiagnostics && 
              typeof window.pgAgentSocketDiagnostics.testDirectConnection === 'function') {
            setTimeout(function() {
              console.log('[pgAgent] Running connection test after reconnect event');
              window.pgAgentSocketDiagnostics.testDirectConnection();
            }, 1000);
          }
        });
        
        self.socket.on('reconnect_error', function(err) {
          console.error('[pgAgent] Socket.IO reconnection error:', err);
        });
        
        self.socket.on('job_status_update', function(data) {
          // Handle job status updates
          console.log('[pgAgent] Received job status update for job:', data.job_id);
          
          // Refresh job node if needed based on data received
          try {
            self.refreshJobNodeIfNeeded(data);
          } catch (err) {
            console.error('[pgAgent] Error handling job status update:', err);
          }
        });
        
        self.socket.on('echo_response', function(response) {
          console.log('[pgAgent] Received echo response from server:', response);
        });
        
        console.log('[pgAgent] Socket event handlers set up successfully');
      },
      
      /* Disconnect from the Socket.IO server */
      disconnectJobStatusSocket: function() {
        var self = this;
        
        try {
          console.log('[pgAgent] Attempting to disconnect job status socket');
          
          if (self.socket) {
            if (self.socket.connected) {
              console.log('[pgAgent] Socket is connected with ID:', self.socket.id, ' - disconnecting');
              self.socket.disconnect();
              console.log('[pgAgent] Socket disconnected successfully');
            } else {
              console.log('[pgAgent] Socket exists but is not connected - cleaning up reference');
            }
            
            // Remove all listeners to prevent memory leaks
            if (typeof self.socket.removeAllListeners === 'function') {
              self.socket.removeAllListeners();
              console.log('[pgAgent] Removed all socket event listeners');
            }
            
            // Clear the socket reference
            self.socket = null;
            console.log('[pgAgent] Socket reference cleared');
          } else {
            console.log('[pgAgent] No active socket connection to disconnect');
          }
        } catch (err) {
          console.error('[pgAgent] Error disconnecting job status socket:', err);
          // Ensure socket reference is cleared even if an error occurs
          self.socket = null;
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
            const wasSelected = t.isSelected(jobNode);
            if (wasSelected) {
              t.deselect(jobNode);
              setTimeout(function() {
                t.select(jobNode);
              }, 100);
            }
          } else {
            // If job not found, refresh the collection to show new/updated jobs
            console.log('Job node not found, refreshing collection node');
            // Only unload if it's loaded (has children)
            if (t.isInode(collectionNode)) {
              t.unload(collectionNode);
              setTimeout(function() {
                t.toggle(collectionNode);
              }, 100);
            }
          }
        } catch (error) {
          console.error('Error refreshing job node:', error);
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
            const socketIoPath = '/socket.io';
            const pgAgentNamespace = '/pgagent';
            
            console.log('URL components:');
            console.log('- Origin:', origin);
            console.log('- pgAdmin Path:', pgAdminPath);
            console.log('- Socket.IO Path:', socketIoPath);
            console.log('- pgAgent Namespace:', pgAgentNamespace);
            
            // Full URL construction
            const fullSocketUrl = origin + pgAgentNamespace;
            console.log('Full Socket URL:', fullSocketUrl);
            
            // Test WebSocket URL - this will show how the browser would interpret a WebSocket connection
            const wsUrl = new URL(socketIoPath, origin);
            wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            console.log('WebSocket URL construction:', wsUrl.href);
            
            // Check for protocol-relative URLs
            if (pgAdminPath.startsWith('//')) {
              console.warn('Warning: Protocol-relative URL detected which may cause WebSocket connection issues');
            }
            
            // Record all URL construction results
            return {
              origin: origin,
              pgAdminPath: pgAdminPath,
              socketIoPath: socketIoPath,
              pgAgentNamespace: pgAgentNamespace,
              fullSocketUrl: fullSocketUrl,
              websocketUrl: wsUrl.href,
              href: window.location.href,
              protocolRelativeDetected: pgAdminPath.startsWith('//')
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
            // Get the full base URL for the socket connection
            const baseUrl = window.location.origin;
            const testUrl = baseUrl + '/pgagent';
            
            console.log('Attempting test connection to:', testUrl);
            console.log('Using socket.io path:', '/socket.io');
            
            // Record connection attempt
            window.pgAgentSocketDiagnostics.status.checks.push({
              type: 'connection_test',
              url: testUrl,
              socketIoPath: '/socket.io',
              started: true,
              timestamp: new Date().toISOString()
            });
            
            // Try using socket_instance first
            if (socket_instance && socket_instance.io) {
              console.log('Using socket_instance.io for test');
              testSocket = socket_instance.io.connect(testUrl, {
                path: '/socket.io',
                transports: ['websocket', 'polling'],
                reconnection: false,
                timeout: 5000
              });
            } else if (socket_io) {
              console.log('Using imported socket_io for test');
              testSocket = socket_io(testUrl, {
                path: '/socket.io',
                transports: ['websocket', 'polling'],
                reconnection: false,
                timeout: 5000
              });
            } else if (typeof io !== 'undefined') {
              console.log('Using global io for test');
              testSocket = io(testUrl, {
                path: '/socket.io',
                transports: ['websocket', 'polling'],
                reconnection: false,
                timeout: 5000
              });
            } else {
              throw new Error('No Socket.IO client available for test');
            }
            
            // Set up event handlers for the test socket
            testSocket.on('connect', function() {
              console.log('Test connection succeeded with ID:', testSocket.id);
              
              // Send echo test
              console.log('Sending echo test');
              testSocket.emit('echo_test', { message: 'Test from pgAgent diagnostics', timestamp: new Date().toISOString() });
              
              // Record successful connection
              window.pgAgentSocketDiagnostics.status.checks.push({
                type: 'connection_test',
                url: testUrl,
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
            
            testSocket.on('connect_error', function(err) {
              console.error('Test connection error:', err);
              
              // Record connection error
              window.pgAgentSocketDiagnostics.status.errors.push({
                type: 'connection_error',
                url: testUrl,
                error: err.toString(),
                timestamp: new Date().toISOString()
              });
              
              // Disconnect test socket
              testSocket.disconnect();
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
        
        // Fix connection function
        window.pgAgentSocketDiagnostics.fixConnection = function() {
          console.log('====== pgAgent Socket Fix Attempt ======');
          var fixes = [];
          
          // Check and fix socket_instance.io
          if (socket_instance && !socket_instance.io && typeof io !== 'undefined') {
            console.log('Fixing missing socket_instance.io with global io');
            socket_instance.io = io;
            fixes.push('Patched socket_instance.io with global io');
          }
          
          // Check if we need to reconnect the main socket
          if (!self.socket || !self.socket.connected) {
            console.log('Attempting to reconnect main socket');
            self.disconnectJobStatusSocket(); // Clean up any existing socket
            self.connectJobStatusSocket();
            fixes.push('Attempted to reconnect main socket');
          }
          
          // Record fixes
          window.pgAgentSocketDiagnostics.fixes = fixes;
          console.log('Fix attempts completed:', fixes);
          
          return fixes;
        };
        
        // Help documentation
        window.pgAgentSocketDiagnostics.help = function() {
          console.log('====== pgAgent Socket Diagnostics Help ======');
          console.log('Available commands:');
          console.log('  pgAgentSocketDiagnostics.checkEnvironment() - Check required globals and environment');
          console.log('  pgAgentSocketDiagnostics.testDirectConnection() - Test direct socket connection');
          console.log('  pgAgentSocketDiagnostics.validateSocketURL() - Validate Socket.IO URLs');
          console.log('  pgAgentSocketDiagnostics.fixConnection() - Attempt to fix common connection issues');
          console.log('  pgAgentSocketDiagnostics.help() - Show this help message');
          console.log('  pgAgentSocketDiagnostics.status - View recorded checks and errors');
          
          return 'Use the commands above to diagnose socket connection issues';
        };
        
        // Run initial environment check
        window.pgAgentSocketDiagnostics.checkEnvironment();
        console.log('[pgAgent] Validating Socket.IO URLs:');
        window.pgAgentSocketDiagnostics.validateSocketURL();
        console.log('[pgAgent] Diagnostic tools setup complete. Type pgAgentSocketDiagnostics.help() in the console for available commands.');
        
        return window.pgAgentSocketDiagnostics;
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
    });
  }

  return pgBrowser.Nodes['pga_job'];
});
