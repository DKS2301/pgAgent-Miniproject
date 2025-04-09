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
// Import socket.io-client directly 
import { io as socket_io } from 'socket.io-client';

/* 
 * SOCKET.IO IMPROVEMENTS - JOB STATUS LISTENER
*/

define('pgadmin.node.pga_job', [
  'sources/gettext', 'sources/url_for', 'pgadmin.browser',
  'pgadmin.node.pga_jobstep', 'pgadmin.node.pga_schedule',
  'sources/socket_instance','pgadmin.browser.events',
], function(gettext, url_for, pgBrowser,jobstep, schedule, socket_instance) {

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
      _listenerActive: false,
      _socketConnected: false,
            
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
      
      /* Set up the event handlers for job status updates */
      setupJobStatusListenerEvents: function() {
        if(this._listenerActive){
          console.log('[pgAgent] Listener already active, skipping connection');
          return;
        }
        const self = this;
        
        console.log('Setting up job status listener events');
        
        // Monitor all node selections, not just pgAgent nodes
        pgBrowser.Events.on(
          'pgadmin-browser:tree:selected',
          function(item, data) {
            console.log("Socket connected :",self._socketConnected);
            if(self._socketConnected){
              console.log("Socket already connected");
              return;
            }
            console.log('Node selected, checking if it is a pgAgent collection', data ? data._type : 'no data');
            // Check if the selected node is a pgagent collection or individual job
            if (data && (data._type === 'coll-pga_job' || data._type === 'pga_job')) {
              console.log('pgAgent node selected:', data._type);
              if (!item || !pgBrowser.tree.hasParent(item)) return;
              
              // For individual job nodes, get the server from grandparent
              // For collection nodes, get server from parent
              let serverItem;
              if (data._type === 'pga_job') {
                const collectionItem = pgBrowser.tree.parent(item);
                serverItem = pgBrowser.tree.parent(collectionItem);
              } else {
                serverItem = pgBrowser.tree.parent(item);
              }
              
              const serverData = serverItem ? pgBrowser.tree.itemData(serverItem) : null;
              
              if (serverData && serverData._type === 'server' && serverData._id) {
                // Connect to socket and start listening for job status updates
                console.log('Connecting to socket for server:', serverData.name || serverData._id);
                self.connectJobStatusSocket(serverData._id);
                self._socketConnected = true ;
              }
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
              
            });
            
            // Handle error event for job status listener
            self.socket.on('job_status_listener_error', function(data) {
              console.error('[pgAgent] Job status listener error:', data);
              self._jobStatusListenerActive = false;
              
              
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
              
            });
            
            self.socket.on('job_status_update', function(data) {
              console.log('📢[pgAdmin pgAgent] Job status update received:', data);
              
              try {
                if (!data) {
                  console.error('📢[pgAdmin pgAgent] Invalid job status update - data is null or undefined');
                  return;
                }
                
                let statusData = data.status;
                let jobId = data.job_id;
                let serverId = data.sid;
                let notification = data.notification || { browser: true };
                let customText = data.custom_text || '';
                
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
                           'status:', statusData || 'unknown',
                           'browser notification:', notification.browser);
                           
                // Only show browser notifications if enabled in notification settings
                if (notification.browser && (statusData === 's' || statusData === 'f')){
                    // Call the refreshJobNode method with proper error handling
                    if (jobId) {
                        console.log('📢[pgAdmin pgAgent] Refreshing job node for server:', serverId, 'and job:', jobId);
                        
                        // Create appropriate notification message
                        let notificationMessage = '';
                        if(statusData === 's'){
                            notificationMessage = gettext('Job ' + jobId + ' completed successfully');
                            if (customText) {
                                notificationMessage += ': ' + customText;
                            }
                            pgAdmin.Browser.notifier.success(notificationMessage);
                        }
                        else if(statusData === 'f'){
                            notificationMessage = gettext('Job ' + jobId + ' failed');
                            if (customText) {
                                notificationMessage += ': ' + customText;
                            }
                            pgAdmin.Browser.notifier.error(notificationMessage);
                        }
                        
                        self.refreshJobNode(serverId, jobId);
                        console.log('📢[pgAdmin pgAgent] Refreshed job node for server:', serverId, 'and job:', jobId, "status:", statusData);
                    } else {
                        console.warn('📢[pgAdmin pgAgent] Job ID missing in update, refreshing all jobs');
                        self.refreshJobs(serverId);
                    }
                } else {
                    console.log('📢[pgAdmin pgAgent] Browser notifications disabled for this job or status not reportable');
                    // Still refresh the job node even if notifications are disabled
                    if (jobId) {
                        self.refreshJobNode(serverId, jobId);
                    }
                }
              }
              catch (e) {
                console.error('📢[pgAdmin pgAgent] Error processing job status update:', e);
                console.error('📢[pgAdmin pgAgent] Update data:', data);
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
      refreshJobNode: async function(serverId, jobId) {
        let self = this,
            t = pgBrowser.tree;
        
        try {
            console.log('[pgAgent] Starting job node refresh for server:', serverId, 'job:', jobId);
            
            let selectedItem = t.selected(),
                selectedData = selectedItem ? t.itemData(selectedItem) : null;
            
            if (jobId && selectedData && selectedData._type === 'pga_job' && String(selectedData._id) === String(jobId)) {
                console.log('[pgAgent] Already on the correct job, refreshing current node');
                
                pgBrowser.Events.trigger('pgadmin:browser:tree:refresh', selectedItem || pgBrowser.tree.selected(), {
                    success: function() {
                        console.log('[pgAgent] Job node refresh completed successfully');
                        self.callbacks.selected.apply(self, [selectedItem, selectedData, pgBrowser]);
                    },
                    fail: function(error) {
                        console.error('[pgAgent] Job node refresh failed:', error);
                        t.unload(selectedItem, () => t.refresh(selectedItem, () => console.log('[pgAgent] Alternative refresh completed')));
                    }
                });
                return;
            }
    
            let serverNode = null, currentItem = selectedItem;
            while (currentItem) {
                let itemData = t.itemData(currentItem);
                if (itemData && itemData._type === 'server' && String(itemData._id) === String(serverId)) {
                    serverNode = currentItem;
                    break;
                }
                currentItem = t.parent(currentItem);
            }
    
            if (!serverNode) {
                console.log('[pgAgent] Server node not found, cannot refresh');
                return;
            }
    
            let collNode = null, serverChildren = t.children(serverNode);
            for (let child of serverChildren) {
                let childData = t.itemData(child);
                if (childData && childData._type === 'coll-pga_job') {
                    collNode = child;
                    break;
                }
            }
    
            if (!collNode) {
                console.log('[pgAgent] Jobs collection node not found');
                return;
            }
    
            if (jobId) {
                let children = t.children(collNode), jobNode = null;
                for (let child of children) {
                    let childData = t.itemData(child);
                    if (childData && childData._type === 'pga_job' && String(childData._id) === String(jobId)) {
                        jobNode = child;
                        break;
                    }
                }
    
                if (!jobNode) {
                    console.log('[pgAgent] Job node not found');
                    return;
                }
    
                pgBrowser.Events.trigger('pgadmin:browser:tree:refresh', jobNode, {
                    success: function() {
                        t.select(jobNode);
                        console.log('[pgAgent] Job node refresh completed successfully');
                        self.callbacks.selected.apply(self, [jobNode, t.itemData(jobNode), pgBrowser]);
                    },
                    fail: function(error) {
                        console.error('[pgAgent] Job node refresh failed:', error);
                        t.unload(jobNode, () => t.refresh(jobNode, () => console.log('[pgAgent] Alternative refresh completed')));
                    }
                });
            } else {
                pgBrowser.Events.trigger('pgadmin:browser:tree:refresh', collNode, {
                    success: function() {
                        console.log('[pgAgent] Collection refresh completed successfully');
                        self.callbacks.selected.apply(self, [collNode, t.itemData(collNode), pgBrowser]);
                    },
                    fail: function(error) {
                        console.error('[pgAgent] Collection refresh failed:', error);
                        t.unload(collNode, () => t.refresh(collNode, () => console.log('[pgAgent] Alternative refresh completed')));
                    }
                });
            }
        } catch (ex) {
            console.error('[pgAgent] Error refreshing job node:', ex);
            console.error('[pgAgent] Error stack:', ex.stack);
        }
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
            self._socketConnected = false;
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