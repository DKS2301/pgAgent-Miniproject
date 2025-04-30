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

        if (socket_instance) {
          if (!socket_instance.io && typeof socket_io === 'function') {
            socket_instance.io = socket_io;
          }
        }

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
        }, {
          name: 'job_audit_log', node: 'coll-pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_job_audit_log',
          priority: 5, label: gettext('Job Audit Log (All)'), icon: 'fa fa-history',
        }, {
          name: 'job_audit_log_create', node: 'coll-pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_job_audit_log_create',
          priority: 5, label: gettext('Job Audit Log (Create)'), icon: 'fa fa-plus',
        }, {
          name: 'job_audit_log_modify', node: 'coll-pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_job_audit_log_modify',
          priority: 5, label: gettext('Job Audit Log (Modify)'), icon: 'fa fa-edit',
        }, {
          name: 'job_audit_log_delete', node: 'coll-pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_job_audit_log_delete',
          priority: 5, label: gettext('Job Audit Log (Delete)'), icon: 'fa fa-trash',
        }, {
          name: 'job_audit_log_execute', node: 'coll-pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_job_audit_log_execute',
          priority: 5, label: gettext('Job Audit Log (Execute)'), icon: 'fa fa-play',
        }]);
        this.setupJobStatusListener();
      },

      getSchema: function(treeNodeInfo, itemNodeData) {
        return new PgaJobSchema(
          {
            jobjclid: ()=>getNodeAjaxOptions('classes', this, treeNodeInfo, itemNodeData, {
              cacheLevel: 'server',
              cacheNode: 'server'
            })
            ,
            jobs: ()=>getNodeAjaxOptions('jobs', this, treeNodeInfo, itemNodeData, {
              cacheLevel: 'server',
              cacheNode: 'server',
              urlWithId: true,
              useCache: false
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
        /* Avoid setting up listeners more than once */
        if (this._listenerInitialized) {
          return;
        }
        
        const self = this;
        this._listenerInitialized = true;

        /* Check if the browser is already initialized by looking for tree
           or wait for the initialization event */
        if (pgBrowser) {
          
          /* Keep trying to set up listeners until tree is available */
          const setupInterval = setInterval(function() {
            if (pgBrowser.tree) {
              clearInterval(setupInterval);
              self.setupJobStatusListenerEvents();
            }
          }, 500);

          /* Set a timeout to stop trying after 10 seconds */
          setTimeout(function() {
            if (!pgBrowser.tree) {
              console.error('Failed to set up job status listeners after 10 seconds');
              clearInterval(setupInterval); 
            }
          }, 10000);
        } else {
          /* Browser not yet initialized, use a polling approach */
          
          const checkInitInterval = setInterval(function() {
            if (pgBrowser) {
              
              /* Keep trying to set up listeners until tree is available */
              const setupInterval = setInterval(function() {
                if (pgBrowser.tree) {
                  clearInterval(setupInterval);
                  self.setupJobStatusListenerEvents();
                }
              }, 500);
              
              /* Set a timeout to stop trying after 10 seconds */
              setTimeout(function() {
                if (!pgBrowser.tree) {
                  console.error('Failed to set up job status listeners after 10 seconds');
                  clearInterval(setupInterval); 
                }
              }, 10000);
            }
          }, 500);
          
          /* Set a timeout to stop polling after 30 seconds */
          setTimeout(function() {
            clearInterval(checkInitInterval);
            console.error('Browser initialization not detected after 30 seconds');
          }, 30000);
        }
        
        /* Also disconnect when browser window is closed */
        window.addEventListener('beforeunload', function() {
          self.disconnectJobStatusSocket();
        });
      },
      
      /* Set up the event handlers for job status updates */
      setupJobStatusListenerEvents: function() {
        if(this._listenerActive){
          return;
        }
        const self = this;
        
        /* Monitor all node selections, not just pgAgent nodes */
        pgBrowser.Events.on(
          'pgadmin-browser:tree:selected',
          function(item, data) {
            if(self._socketConnected){
              return;
            }
            /* Check if the selected node is a pgagent collection or individual job */
            if (data && (data._type === 'coll-pga_job' || data._type === 'pga_job')) {
              if (!item || !pgBrowser.tree.hasParent(item)) return;
              
              /* For individual job nodes, get the server from grandparent
                 For collection nodes, get server from parent */
              let serverItem;
              if (data._type === 'pga_job') {
                const collectionItem = pgBrowser.tree.parent(item);
                serverItem = pgBrowser.tree.parent(collectionItem);
              } else {
                serverItem = pgBrowser.tree.parent(item);
              }
              
              const serverData = serverItem ? pgBrowser.tree.itemData(serverItem) : null;
              
              if (serverData && serverData._type === 'server' && serverData._id) {
                /* Connect to socket and start listening for job status updates */
                self.connectJobStatusSocket(serverData._id);
                self._socketConnected = true;
              }
            }
          }
        );
      },
      
      /* Connect to the Socket.IO server for job status updates */
      connectJobStatusSocket: function(serverId) {
        var self = this;
        try {
          /* Store the server ID for later use */
          if (serverId) {
            self.currentServerId = serverId;
          }
          
          /* First disconnect any existing socket */
          if (self.socket) {
            self.disconnectJobStatusSocket();
          }
          
          /* Construct the socket URLs - Socket.IO requires just the namespace */
          const pgAdminPath = url_for('pgadmin.root').replace(/\/$/, '');
          /* Use just the namespace name with leading slash for Socket.IO */
          const pgAgentNamespace = '/pgagent';
          
          /* Define socket connection options */
          const socketOptions = {
            path: pgAdminPath + '/socket.io',
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            randomizationFactor: 0.5,
            timeout: 20000,
            autoConnect: true,
            /* Force to use the correct namespace */
            forceNew: true
          };

          /* Try to use the global io first, then fallback to window.io */
          let socketManager;
          try {
            if (typeof window.io !== 'undefined') {
              socketManager = window.io;
            } else if (typeof socket_io !== 'undefined') {
              socketManager = socket_io;
            } else {
              console.error('[pgAgent] Socket.IO not available');
              return false;
            }

            /* Connect to the Socket.IO server using the correct namespace */
            if (self.socket && self.socket.connected) {
              self.disconnectJobStatusSocket();
            }

            /* Important: We're using manually constructed URL to ensure namespace is correct */
            self.socket = socketManager(pgAgentNamespace, socketOptions);
            
            if (!self.socket) {
              console.error('[pgAgent] Failed to create socket instance');
              return false;
            }
            
            /* Set a custom property to track the namespace */
            self.socket._pgAgentNamespace = pgAgentNamespace;
            
            /* Set up event handlers for the socket */
            self.socket.on('connect', function() {
              /* Set the namespace explicitly if it's not set */
              if (!self.socket.nsp || !self.socket.nsp.name) {
                self.socket._pgAgentNamespace = pgAgentNamespace;
              }
              
              /* CRITICAL FIX: Start the job status listener with the server ID */
              if (self.currentServerId) {
                self.socket.emit('start_job_status_listener', { 
                  sid: self.currentServerId,
                  client_info: {
                    client_id: self.socket.id,
                    timestamp: new Date().toISOString()
                  }
                });
              } else {
                console.error('[pgAgent] Cannot start job status listener - no server ID available');
              }
              
              /* Start the keep-alive ping if it exists */
              if (typeof self.startKeepAlivePing === 'function') {
                self.startKeepAlivePing();
              }
            });
            
            /* Handle success event for job status listener start */
            self.socket.on('job_status_listener_started', function(_data) {
              self._jobStatusListenerActive = true;
            });
            
            /* Handle error event for job status listener */
            self.socket.on('job_status_listener_error', function(data) {
              console.error('[pgAgent] Job status listener error:', data);
              self._jobStatusListenerActive = false;
              
              /* Attempt to restart the listener after a delay */
              if (self.currentServerId) {
                setTimeout(function() {
                  if (self.socket && self.socket.connected) {
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
              
              /* Try to diagnose common issues */
              if (err.message && err.message.includes('ETIMEDOUT')) {
                console.error('[pgAgent] Connection timeout - check firewall or proxy settings');
              } else if (err.message && err.message.includes('xhr poll error')) {
                console.error('[pgAgent] XHR polling error - fallback transport failed');
                /* Try to force websocket transport on next attempt */
                socketOptions.transports = ['websocket'];
              } else if (err.message && err.message.includes('websocket error')) {
                console.error('[pgAgent] WebSocket transport error - trying to fall back to polling');
                /* Try to force polling on next attempt */
                socketOptions.transports = ['polling'];
              }
            });
            
            self.socket.on('error', function(err) {
              console.error('[pgAgent] Socket error:', err);
            });
            
            self.socket.on('disconnect', function(_reason) {
              self._jobStatusListenerActive = false;
              
              /* Stop the keep-alive ping */
              self.stopKeepAlivePing();
            });
            
            self.socket.on('job_status_update', function(data) {
              try {
                if (!data) {
                  console.error('📢[pgAdmin pgAgent] Invalid job status update - data is null or undefined');
                  return;
                }
                
                let statusData = data.status;
                let jobId = data.job_id;
                let jobName = data.job_name;
                let serverId = data.sid;
                let notification = data.notification || { browser: true };
                let description = data.description || '';
                let customText = data.custom_text || '';
                
                if (!statusData) {
                  console.error('📢[pgAdmin pgAgent] Invalid job status update - missing status data');
                  return;
                }
                if (!serverId) {
                  console.error('📢[pgAdmin pgAgent] Invalid job status update - missing server ID');
                  return;
                }
                
                /* Only show browser notifications if enabled in notification settings */
                if (notification.browser && (statusData === 's' || statusData === 'f')){
                  /* Call the refreshJobNode method with proper error handling */
                  if (jobId) {
                    if (statusData === 's'){
                      let notificationMessage = gettext('Job ' + (jobName || jobId) + ' completed successfully');
                      if (description) {
                        notificationMessage += ': ' + customText;
                      }
                      pgAdmin.Browser.notifier.success(notificationMessage);
                    }
                    else if(statusData === 'f'){
                      let notificationMessage = gettext('Job ' + (jobName || jobId) + ' failed');
                      if (description) {
                        notificationMessage += ': '+customText + ' ' + description;
                      }
                      pgAdmin.Browser.notifier.error(notificationMessage);
                    }
                    
                    self.refreshJobNode(serverId, jobId);
                  } else {
                    console.warn('📢[pgAdmin pgAgent] Job ID missing in update, refreshing all jobs');
                    self.refreshJobs(serverId);
                  }
                } else {
                  /* Still refresh the job node even if notifications are disabled */
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
            
            self.socket.on('reconnect', function(_attemptNumber) {
              /* Reestablish job status listener after reconnection if we have a server ID */
              if (self.currentServerId) {
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
        
        /* Clear any existing interval */
        self.stopKeepAlivePing();
        
        /* Set a new interval to ping the server every 30 seconds */
        self._keepAlivePingInterval = setInterval(function() {
          if (self.socket && self.socket.connected) {
            self.socket.emit('ping', { 
              timestamp: new Date().toISOString(),
              client_id: self.socket.id
            });
          } else {
            /* Stop pinging if socket is disconnected */
            self.stopKeepAlivePing();
          }
        }, 30000); // 30 seconds
      },
      
      /* Stop the keep-alive ping interval */
      stopKeepAlivePing: function() {
        var self = this;
        
        if (self._keepAlivePingInterval) {
          clearInterval(self._keepAlivePingInterval);
          self._keepAlivePingInterval = null;
        }
      },
      refreshJobNode: async function(serverId, jobId) {
        let self = this,
          t = pgBrowser.tree;
        
        try {
          let selectedItem = t.selected(),
            selectedData = selectedItem ? t.itemData(selectedItem) : null;
            
          if (jobId && selectedData && selectedData._type === 'pga_job' && String(selectedData._id) === String(jobId)) {
            pgBrowser.Events.trigger('pgadmin:browser:tree:refresh', selectedItem || pgBrowser.tree.selected(), {
              success: function() {
                self.callbacks.selected.apply(self, [selectedItem, selectedData, pgBrowser]);
              },
              fail: function(error) {
                console.error('[pgAgent] Job node refresh failed:', error);
                t.unload(selectedItem, () => t.refresh(selectedItem, () => {
                }));
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
              return;
            }
  
            pgBrowser.Events.trigger('pgadmin:browser:tree:refresh', jobNode, {
              success: function() {
                t.select(jobNode);
                self.callbacks.selected.apply(self, [jobNode, t.itemData(jobNode), pgBrowser]);
              },
              fail: function(error) {
                console.error('[pgAgent] Job node refresh failed:', error);
                t.unload(jobNode, () => t.refresh(jobNode, () => {
                }));
              }
            });
          } else {
            pgBrowser.Events.trigger('pgadmin:browser:tree:refresh', collNode, {
              success: function() {
                self.callbacks.selected.apply(self, [collNode, t.itemData(collNode), pgBrowser]);
              },
              fail: function(error) {
                console.error('[pgAgent] Collection refresh failed:', error);
                t.unload(collNode, () => t.refresh(collNode, () => {
                }));
              }
            });
          }
        } catch (ex) {
          ex.error('[pgAgent] Error stack:', ex.stack);
        }
      },
    
      /* Disconnect the socket if one exists */
      disconnectJobStatusSocket: function() {
        var self = this;
        
        try {
          if (self.socket) {
            /* Only send stop event if the socket is connected */
            if (self.socket.connected && self.currentServerId) {
              self.socket.emit('stop_job_status_listener', {
                sid: self.currentServerId
              });
            }
            
            /* Unregister all event handlers to prevent memory leaks */
            self.socket.off('connect');
            self.socket.off('disconnect');
            self.socket.off('connect_error');
            self.socket.off('error');
            self.socket.off('job_status_listener_started');
            self.socket.off('job_status_listener_error');
            self.socket.off('job_status_update');
            self.socket.off('reconnect');
            
            /* Disconnect the socket */
            self.socket.disconnect();
            self._socketConnected = false;
          }
          
          /* Clean up references */
          self.socket = null;
          self._jobStatusListenerActive = false;
          
          /* Also stop the keep-alive ping */
          self.stopKeepAlivePing();
          
          return true;
        } catch (error) {
          console.error('[pgAgent] Error disconnecting socket:', error);
          return false;
        }
      },
      /* Common function for all Job Audit Log operations */
      _copy_job_audit_log_query: function(args, operation) {
        let input = args || {},
          t = pgBrowser.tree,
          i = input.item || t.selected(),
          d = i ? t.itemData(i) : undefined;

        if (!d) {
          pgAdmin.Browser.notifier.error(gettext('No item selected.'));
          return false;
        }

        /* Find the server node so we know what database to connect to */
        let serverNode = i;
        let serverData = d;
        
        if (d._type !== 'server') {
          /* Navigate up to find the server */
          while (serverData && serverData._type !== 'server' && serverNode) {
            serverNode = t.parent(serverNode);
            if (serverNode) {
              serverData = t.itemData(serverNode);
            }
          }
        }

        if (!serverNode || !serverData || serverData._type !== 'server') {
          pgAdmin.Browser.notifier.error(gettext('Could not find server node.'));
          return false;
        }

        try {
          /* Build the query based on operation type */
          let query = 'SELECT * FROM pgagent.pga_job_audit_log';
          
          /* Add WHERE clause if operation is specified */
          if (operation) {
            query += ' WHERE operation_type = ' + '\''+operation + '\'';
          }
          
          /* Add ORDER BY clause */
          query += ' ORDER BY operation_time DESC;';
          
          /* Create a temporary textarea to copy the query */
          const tempTextArea = document.createElement('textarea');
          tempTextArea.value = query;
          document.body.appendChild(tempTextArea);
          tempTextArea.select();
          document.execCommand('copy');
          document.body.removeChild(tempTextArea);
          
          /* Show success message with operation type */
          let operationLabel = operation ? operation : 'All';
          pgAdmin.Browser.notifier.success(
            gettext('SQL query for ' + operationLabel + ' operations copied to clipboard. Paste into the query tool and execute.')
          );
          
          /* Now open the query tool */
          pgAdmin.Browser.Node.callbacks.show_query_tool({}, serverNode);
          
        } catch (error) {
          pgAdmin.Browser.notifier.error(gettext('Error: ') + error.message);
        }
        
        return false;
      },

      /* Show Job Audit Log - All operations */
      show_job_audit_log: function(args) {
        return this._copy_job_audit_log_query(args, null);
      },
      
      /* Show Job Audit Log - Create operations */
      show_job_audit_log_create: function(args) {
        return this._copy_job_audit_log_query(args, 'CREATE');
      },
      
      /* Show Job Audit Log - Modify operations */
      show_job_audit_log_modify: function(args) {
        return this._copy_job_audit_log_query(args, 'MODIFY');
      },
      
      /* Show Job Audit Log - Delete operations */
      show_job_audit_log_delete: function(args) {
        return this._copy_job_audit_log_query(args, 'DELETE');
      },
      
      /* Show Job Audit Log - Execute operations */
      show_job_audit_log_execute: function(args) {
        return this._copy_job_audit_log_query(args, 'EXECUTE');
      },
      /* Refresh the jobs list after creating a new job */
      onSave: function(isNew, data) {
        let obj = this;
        return obj.nodeAjax('create', data, {}, function(res) {
          if (res.success) {
            /* Refresh the jobs list by invalidating the cache */
            let cacheNode = pgAdmin.Browser.Nodes['server'];
            if (cacheNode) {
              cacheNode.cache(obj.type + '#jobs', {}, 'server', null);
            }
          }
        });
      }
    });
  }

  return pgBrowser.Nodes['pga_job'];
});
