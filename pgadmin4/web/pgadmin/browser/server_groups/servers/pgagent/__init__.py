##########################################################################
#
# pgAdmin 4 - PostgreSQL Tools
#
# Copyright (C) 2013 - 2025, The pgAdmin Development Team
# This software is released under the PostgreSQL Licence
#
##########################################################################

"""Implements the pgAgent Jobs Node"""
from functools import wraps
import json
from datetime import datetime, time, timedelta
import select
import traceback
import random
import functools

from flask import render_template, request, jsonify, current_app
import flask
from flask_babel import gettext as _
from flask_login import current_user, login_user

from config import PG_DEFAULT_DRIVER  

from pgadmin.browser.collection import CollectionNodeModule
from pgadmin.browser.utils import PGChildNodeView
from pgadmin.browser.server_groups import servers
from pgadmin.utils.ajax import make_json_response, internal_server_error, \
    make_response as ajax_response, gone, success_return
from pgadmin.utils.driver import get_driver
from pgadmin.utils.preferences import Preferences
from pgadmin.browser.server_groups.servers.pgagent.utils \
    import format_schedule_data, format_step_data
from pgadmin import socketio

# Import the worker process helper
from pgadmin.misc.bgprocess.processes import BatchProcess

# Define the SocketIO namespace for pgAgent
SOCKETIO_NAMESPACE = '/pgagent'

# Dictionary to store server's active listeners
# Format: {server_id: {conn_id: connection}}
active_listeners = {}


class JobModule(CollectionNodeModule):
    _NODE_TYPE = 'pga_job'
    _COLLECTION_LABEL = _("pgAgent Jobs")

    def get_nodes(self, gid, sid):
        """
        Generate the collection node
        """
        if self.show_node:
            yield self.generate_browser_collection_node(sid)

    @property
    def script_load(self):
        """
        Load the module script for server, when any of the server-group node is
        initialized.
        """
        return servers.ServerModule.node_type

    def backend_supported(self, manager, **kwargs):
        if hasattr(self, 'show_node') and not self.show_node:
            return False

        conn = manager.connection()

        status, res = conn.execute_scalar("""
SELECT
    has_table_privilege(
      'pgagent.pga_job', 'INSERT, SELECT, UPDATE'
    ) has_priviledge
WHERE EXISTS(
    SELECT has_schema_privilege('pgagent', 'USAGE')
    WHERE EXISTS(
        SELECT cl.oid FROM pg_catalog.pg_class cl
        LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid=relnamespace
        WHERE relname='pga_job' AND nspname='pgagent'
    )
)
""")
        if status and res:
            status, res = conn.execute_dict("""
SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE
            table_schema='pgagent' AND table_name='pga_jobstep' AND
            column_name='jstconnstr'
    ) has_connstr""")

            manager.db_info['pgAgent'] = res['rows'][0]
            return True
        return False

    @property
    def csssnippets(self):
        """
        Returns a snippet of css to include in the page
        """
        snippets = [
            render_template(
                self._COLLECTION_CSS,
                node_type=self.node_type,
                _=_
            ),
            render_template(
                "pga_job/css/pga_job.css",
                node_type=self.node_type,
                _=_
            )
        ]

        for submodule in self.submodules:
            snippets.extend(submodule.csssnippets)

        return snippets

    @property
    def module_use_template_javascript(self):
        """
        Returns whether Jinja2 template is used for generating the javascript
        module.
        """
        return False

    def register(self, app, options):
        """
        Override the default register function to automagically register
        sub-modules at once.
        """
        from .schedules import blueprint as module
        self.submodules.append(module)

        from .steps import blueprint as module
        self.submodules.append(module)

        super().register(app, options)


##########################################################################
#
# SocketIO event handlers for pgAgent job status updates
#
##########################################################################
@socketio.on('connect', namespace=SOCKETIO_NAMESPACE)
def pgagent_connect(auth=None):
    """
    Event handler for client connection
    """
    current_app.logger.info('[SocketIO pgAgent] Client connected with ID: %s', request.sid)
    current_app.logger.debug('[SocketIO pgAgent] Connection headers: %s', request.headers)
    current_app.logger.debug('[SocketIO pgAgent] Connection details: Transport=%s, Remote=%s', 
                    getattr(request, 'connection', {}).get('transport', None),
                    request.remote_addr)
    
    try:
        # Emit the connected event to acknowledge the connection
        socketio.emit('connected', {
            'sid': request.sid,
            'message': 'Successfully connected to pgAgent Socket.IO server',
            'timestamp': datetime.now().isoformat(),
            'server_info': {
                'version': current_app.config.get('APP_VERSION', 'unknown'),
                'namespace': SOCKETIO_NAMESPACE
            }
        }, namespace=SOCKETIO_NAMESPACE, to=request.sid)
        current_app.logger.debug('[SocketIO pgAgent] Connected event emitted to client %s', request.sid)

    except Exception as e:
        current_app.logger.error('[SocketIO pgAgent] Error sending connected event: %s', str(e))
        current_app.logger.error('[SocketIO pgAgent] Exception details: %s', traceback.format_exc())


@socketio.on('echo_test', namespace=SOCKETIO_NAMESPACE)
def echo_test(data):
    """
    Simple echo handler for connection testing
    """
    current_app.logger.info('[SocketIO pgAgent] Received echo test: %s', str(data))
    
    # Echo the data back with a timestamp
    response = {
        'original': data,
        'timestamp': datetime.now().isoformat(),
        'server_time': datetime.now().strftime('%H:%M:%S')
    }
    
    socketio.emit('echo_response', response, namespace=SOCKETIO_NAMESPACE, to=request.sid)
    current_app.logger.info('[SocketIO pgAgent] Sent echo response to %s', request.sid)
    return response


@socketio.on('start_job_status_listener', namespace=SOCKETIO_NAMESPACE)
def start_job_status_listener(data):
    """
    Start a listener for pgAgent job status notifications.
    This function is called via a Socket.IO event.
    """
    import json
    
    # Get the server ID from the data
    sid = data.get('sid', None)
    client_info = data.get('client_info', {})
    current_app.logger.info(
        f"Starting job status listener for server ID {sid} from client {client_info.get('client_id', 'unknown')}"
    )
    
    try:
        # Check if we have a server ID
        if sid is None:
            current_app.logger.error("No server ID provided for job status listener")
            socketio.emit('job_status_listener_error', {
                'error': 'No server ID provided',
                'server_id': None,
                'status': 'error',
                'code': 'NO_SERVER_ID'
            }, namespace=SOCKETIO_NAMESPACE, to=request.sid)
            return
        
        # Convert to integer if it's a string
        if isinstance(sid, str) and sid.isdigit():
            sid = int(sid)
            
        # Get the server's connection manager
        manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
        if not manager:
            current_app.logger.error(f"Could not find connection manager for server ID {sid}")
            socketio.emit('job_status_listener_error', {
                'error': 'Server connection not found',
                'server_id': sid,
                'status': 'error',
                'code': 'SERVER_NOT_FOUND'
            }, namespace=SOCKETIO_NAMESPACE, to=request.sid)
            return
        
        # Make sure we have a connection
        conn = manager.connection()
        if not conn:
            current_app.logger.error(f"Could not get connection for server ID {sid}")
            socketio.emit('job_status_listener_error', {
                'error': 'Database connection not available',
                'server_id': sid,
                'status': 'error',
                'code': 'CONNECTION_ERROR'
            }, namespace=SOCKETIO_NAMESPACE, to=request.sid)
            return
        
        # Set up a LISTEN command to listen for pgAgent job status updates
        try:
            # Use execute_void for more reliable execution of the LISTEN command
            current_app.logger.info(f"Setting up LISTEN for pgAgent job status updates on server {sid}")
            status, result = conn.execute_void("LISTEN job_status_update")
            
            if not status:
                current_app.logger.error(f"Failed to execute LISTEN command: {result}")
                socketio.emit('job_status_listener_error', {
                    'error': f'Database error: Failed to execute LISTEN command: {result}',
                    'server_id': sid,
                    'status': 'error',
                    'code': 'DB_ERROR_LISTEN_FAILED'
                }, namespace=SOCKETIO_NAMESPACE, to=request.sid)
                return
                
            # Double-check that we're actually listening
            status, channels = conn.execute_dict("SELECT pg_listening_channels() AS channel")
            if status and 'rows' in channels:
                has_pgagent_channel = any(row['channel'] == 'job_status_update' for row in channels['rows'])
                current_app.logger.info(f"LISTEN command executed. Listening on job_status_update: {has_pgagent_channel}")
                
                if not has_pgagent_channel:
                    current_app.logger.warning(f"LISTEN command executed but job_status_update not in listening channels. Retrying...")
                    # Try again
                    conn.execute_void("LISTEN job_status_update")
            
            current_app.logger.info(f"Listening for pgAgent job status updates on server {sid}")
            
            # Register this client for job status updates
            server_info = {
                'server_id': sid,
                'client_id': client_info.get('client_id', request.sid),
                'socket_id': request.sid,
                'started_at': datetime.now().isoformat()
            }
            
            # Store the server info in an application-wide store for job status updates
            if not hasattr(current_app, 'pgagent_listeners'):
                current_app.pgagent_listeners = {}
            
            current_app.pgagent_listeners[request.sid] = server_info
            
            # Store the connection in the active_listeners dict for notifications
            if sid not in active_listeners:
                active_listeners[sid] = {}
            
            # Store the connection and user for this client
            active_listeners[sid][request.sid] = {
                'conn': conn, 
                'user': current_user._get_current_object()
            }
            
            # Start background task to check for notifications
            # The connection is already established and stored in active_listeners
            # so we don't need to create a new one in the background thread
            socketio.start_background_task(check_job_status_notifications, current_app._get_current_object(), sid, request.sid)
            
            # Send success response to client
            socketio.emit('job_status_listener_started', {
                'status': 'success',
                'server_id': sid,
                'message': 'Job status listener started successfully',
                'listener_info': server_info
            }, namespace=SOCKETIO_NAMESPACE, to=request.sid)
            
            current_app.logger.info(f"Job status listener started for server {sid}, client {request.sid}")
            
        except Exception as e:
            # Handle specific database errors
            error_msg = str(e)
            error_code = getattr(e, 'pgcode', 'UNKNOWN_ERROR')
            current_app.logger.error(f"Database error setting up job status listener: {error_msg}")
            current_app.logger.error(traceback.format_exc())
            
            socketio.emit('job_status_listener_error', {
                'error': f"Database error: {error_msg}",
                'server_id': sid,
                'status': 'error',
                'code': f'DB_ERROR_{error_code}'
            }, namespace=SOCKETIO_NAMESPACE, to=request.sid)
            
    except Exception as e:
        # Log the full exception details for debugging
        current_app.logger.error(f"Error starting job status listener: {str(e)}")
        current_app.logger.error(traceback.format_exc())
        
        socketio.emit('job_status_listener_error', {
            'error': f"Server error: {str(e)}",
            'server_id': sid if 'sid' in locals() else None,
            'status': 'error',
            'code': 'SERVER_ERROR'
        }, namespace=SOCKETIO_NAMESPACE, to=request.sid)


@socketio.on('stop_job_status_listener', namespace=SOCKETIO_NAMESPACE)
def stop_job_status_listener(data):
    """
    Stop listening for job status updates for this client
    """
    current_app.logger.info('📢[SocketIO pgAgent] Stopping job status listener for client: %s', request.sid)
    current_app.logger.debug('📢[SocketIO pgAgent] Request data: %s', str(data))
    
    try:
        sid = data.get('sid')
        if not sid:
            current_app.logger.warning('📢[SocketIO pgAgent] No server ID provided for stop_job_status_listener')
            return
            
        current_app.logger.debug('📢[SocketIO pgAgent] Active listeners before stopping: %s', 
                       str({k: list(v.keys()) for k, v in active_listeners.items()}))
            
        if sid not in active_listeners:
            current_app.logger.debug('📢[SocketIO pgAgent] No active listeners found for server: %s', sid)
            return
            
        if request.sid in active_listeners[sid]:
            conn = active_listeners[sid][request.sid]['conn']
            try:
                current_app.logger.debug('📢[SocketIO pgAgent] Issuing UNLISTEN command for server: %s', sid)
                status, result = conn.execute_void("UNLISTEN job_status_update")
                current_app.logger.info('📢[SocketIO pgAgent] UNLISTEN command issued for job_status_update on server: %s (Status: %s)', 
                              sid, status)
                if not status:
                    current_app.logger.warning('📢[SocketIO pgAgent] Failed to execute UNLISTEN command: %s', str(result))
            except Exception as e:
                current_app.logger.warning('📢[SocketIO pgAgent] Error issuing UNLISTEN command: %s', str(e))
                current_app.logger.debug('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
                
            del active_listeners[sid][request.sid]
            current_app.logger.info('📢[SocketIO pgAgent] Removed client %s from active listeners for server %s', 
                          request.sid, sid)
            
            # Clean up if no more listeners for this server
            if not active_listeners[sid]:
                del active_listeners[sid]
                current_app.logger.info('📢[SocketIO pgAgent] No more active listeners for server %s, removed server entry', sid)
                
        current_app.logger.debug('📢[SocketIO pgAgent] Active listeners after stopping: %s', 
                       str({k: list(v.keys()) for k, v in active_listeners.items()}))
                
        socketio.emit('job_status_listener_stopped', 
                     {'sid': sid},
                     namespace=SOCKETIO_NAMESPACE, 
                     to=request.sid)
        current_app.logger.info('📢[SocketIO pgAgent] Job status listener stopped for client %s on server %s', 
                      request.sid, sid)
    except Exception as e:
        current_app.logger.error('📢[SocketIO pgAgent] Error stopping job status listener: %s', str(e))
        current_app.logger.error('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
        socketio.emit('job_status_listener_error', 
                     'Error stopping listener: ' + str(e),
                     namespace=SOCKETIO_NAMESPACE, 
                     to=request.sid)


@socketio.on('disconnect', namespace=SOCKETIO_NAMESPACE)
def handle_client_disconnect(event=None):
    """
    Handle client disconnection
    """
    # Import for exception handling
    from pgadmin.utils.exception import CryptKeyMissing
    
    client_sid = request.sid if hasattr(request, 'sid') else None
    current_app.logger.info('📢[SocketIO pgAgent] Client disconnected: %s', client_sid)
    
    # If no client SID, we can't clean up
    if not client_sid:
        current_app.logger.warning('📢[SocketIO pgAgent] No client SID available for disconnect cleanup')
        return
    
    client_servers = []
    
    # Find all servers this client was listening to
    for sid in list(active_listeners.keys()):
        if client_sid in active_listeners[sid]:
            client_servers.append((sid, active_listeners[sid][client_sid]['conn']))
    
    if not client_servers:
        current_app.logger.info('📢[SocketIO pgAgent] No active listeners found for client %s', client_sid)
        return
    
    current_app.logger.info('📢[SocketIO pgAgent] Cleaning up %d active listeners for client %s', 
                      len(client_servers), client_sid)
    
    # Clean up each connection
    for sid, conn in client_servers:
        try:
            if conn and hasattr(conn, 'connected') and conn.connected():
                current_app.logger.info('📢[SocketIO pgAgent] Closing connection for server %s, client %s', 
                                  sid, client_sid)
                
                try:
                    # Try to execute UNLISTEN
                    conn.execute_dict("UNLISTEN job_status_update")
                except CryptKeyMissing as e:
                    current_app.logger.error('❌ [SocketIO pgAgent] Crypto key missing error during UNLISTEN: %s', str(e))
                    current_app.logger.debug('This typically occurs when a background thread cannot access the master password')
                except Exception as e:
                    current_app.logger.warning('📢[SocketIO pgAgent] Error during UNLISTEN: %s', str(e))
                
                try:
                    # Close the connection if it has a close method
                    if hasattr(conn, 'close'):
                        conn.close()
                    elif hasattr(conn, 'release'):
                        conn.release()
                    else:
                        current_app.logger.warning('📢[SocketIO pgAgent] Connection object has no close or release method')
                except Exception as e:
                    current_app.logger.warning('📢[SocketIO pgAgent] Error closing connection: %s', str(e))
            
            # Remove from active listeners dict
            if sid in active_listeners and client_sid in active_listeners[sid]:
                del active_listeners[sid][client_sid]
                
                # If no more clients for this server, clean up the server entry
                if not active_listeners[sid]:
                    del active_listeners[sid]
                
                current_app.logger.info('📢[SocketIO pgAgent] Removed listener for server %s, client %s', 
                                  sid, client_sid)
            
        except CryptKeyMissing as e:
            current_app.logger.error('❌ [SocketIO pgAgent] Crypto key missing error during disconnect cleanup: %s', str(e))
            current_app.logger.debug('This typically occurs when a background thread cannot access the master password')
        except Exception as e:
            current_app.logger.error('📢[SocketIO pgAgent] Error cleaning up listener: %s', str(e))
    
    # Log the remaining active listeners for debugging
    remaining_listeners = sum(len(clients) for clients in active_listeners.values())
    current_app.logger.info('📢[SocketIO pgAgent] Disconnect cleanup complete. %d remaining active listeners', 
                      remaining_listeners)

def with_app_context(func):
    """Decorator to ensure function runs in application context"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        # Get the app object safely
        if hasattr(current_app, '_get_current_object'):
            app = current_app._get_current_object()
        else:
            app = current_app
            
        # Check if we're already in an app context
        if flask.has_app_context():
            return func(*args, **kwargs)
        else:
            # Create a new app context
            with app.app_context():
                return func(*args, **kwargs)

    return wrapper

def check_job_status_notifications(app, sid, client_sid):
    """
    Background task to check for notifications and emit them to the client
    with improved robustness for cursor loss and connection issues
    """
    from pgadmin.utils.exception import CryptKeyMissing
    import json
    import traceback
    from datetime import datetime

    # Core variables for connection management
    reconnect_attempts = 0
    max_reconnect_attempts = 5
    base_sleep_time = 1.0
    connection_age = 0
    max_connection_age = 600  # 10 minutes
    last_cursor_recovery = None
    notification_count = 0

    with app.app_context():
        app.logger.info('[SocketIO pgAgent] Starting notifications listener for server %s, client %s', sid, client_sid)

        try:
            # Validate active listener exists
            if sid not in active_listeners or client_sid not in active_listeners[sid]:
                app.logger.error('[SocketIO pgAgent] No active listener found for server %s, client %s', sid, client_sid)
                return
                
            conn = active_listeners[sid][client_sid]['conn']
            
            if not conn or not conn.connected():
                app.logger.error('[SocketIO pgAgent] Connection not available for server %s', sid)
                return
            
            # Function to establish or re-establish LISTEN command
            @with_app_context
            def setup_listener():
                nonlocal connection_age
                
                with app.test_request_context():
                    user = active_listeners[sid][client_sid]['user']
                    
                    # Set up user context
                    if hasattr(app, 'login_manager'):
                        app.login_manager._update_request_context_with_user(user)
                    
                    # Configure connection settings
                    try:
                        # First make sure we're not in a transaction
                        try:
                            conn.execute_void("ROLLBACK")
                        except Exception:
                            pass  # Ignore errors in rollback
            
                        conn.execute_void("BEGIN")
                        conn.execute_void("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED")
                        conn.execute_void("SET statement_timeout = 10000")
                        conn.execute_void("SET tcp_keepalives_idle = 60")
                        conn.execute_void("SET tcp_keepalives_interval = 30")
                        conn.execute_void("SET tcp_keepalives_count = 5")
                        conn.execute_void("COMMIT")
                    except Exception as e:
                        app.logger.warning('[SocketIO pgAgent] Error setting session parameters: %s', str(e))
                        try:
                            conn.execute_void("ROLLBACK")
                        except:
                            pass
                    
                    # Establish LISTEN
                    try:
                        status, result = conn.execute_void("LISTEN job_status_update")
                        if status:
                            connection_age = 0
                            status, channels = conn.execute_dict("SELECT pg_listening_channels() AS channel")
                            if not status or 'rows' not in channels:
                                app.logger.error('[SocketIO pgAgent] Could not verify LISTEN channels')
                                return False
                                
                            has_pgagent_channel = any(row['channel'] == 'job_status_update' for row in channels['rows'])
                            if not has_pgagent_channel:
                                app.logger.error('[SocketIO pgAgent] LISTEN command succeeded but channel not active')
                                return False
                            return True
                        return False
                    except Exception as e:
                        app.logger.error('[SocketIO pgAgent] Error executing LISTEN command: %s', str(e))
                        return False
            
            # Function to create a new connection when needed
            @with_app_context
            def create_new_connection():
                nonlocal conn, reconnect_attempts, last_cursor_recovery
                
                with app.test_request_context():
                    user = active_listeners[sid][client_sid]['user']
                    
                    if hasattr(app, 'login_manager'):
                        app.login_manager._update_request_context_with_user(user)
                    
                    from pgadmin.utils.driver import get_driver
                    driver = get_driver(PG_DEFAULT_DRIVER)
                    manager = driver.connection_manager(sid)
                    
                    if not manager:
                        app.logger.error('[SocketIO pgAgent] Failed to get connection manager')
                        return False
                    
                    try:
                        # Try to get server details for potential direct connection
                        server_info = None
                        try:
                            temp_conn = manager.connection()
                            if temp_conn:
                                if hasattr(temp_conn, 'get_server_details'):
                                    server_info = temp_conn.get_server_details()
                                elif hasattr(manager, 'get_server_by_id'):
                                    server = manager.get_server_by_id(sid)
                                    if server:
                                        server_info = {
                                            'host': server.host,
                                            'port': server.port,
                                            'database': server.db,
                                            'username': server.user,
                                            'password': server.password
                                        }
                        except Exception as e:
                            app.logger.warning('[SocketIO pgAgent] Could not retrieve server details: %s', str(e))
                        
                        if server_info:
                            active_listeners[sid][client_sid]['server_info'] = server_info
                        
                        # Release old connection if possible
                        old_conn_id = getattr(conn, 'conn_id', None)
                        if old_conn_id and hasattr(manager, 'release'):
                            try:
                                manager.release(old_conn_id)
                            except Exception as e:
                                app.logger.warning('[SocketIO pgAgent] Error releasing connection: %s', str(e))
                        
                        # Create new connection
                        new_conn = manager.connection()
                        
                        # ENHANCED VERIFICATION - Test connection immediately
                        if new_conn:
                            try:
                                # Try a simple query to verify connection works
                                status, _ = new_conn.execute_scalar("SELECT 1 AS verify_connection")
                                
                                if status:
                                    active_listeners[sid][client_sid]['conn'] = new_conn
                                    conn = new_conn
                                    last_cursor_recovery = datetime.now()
                                    reconnect_attempts = 0
                                    return True
                                else:
                                    app.logger.error('[SocketIO pgAgent] New connection verification query failed')
                            except Exception as e:
                                app.logger.error('[SocketIO pgAgent] New connection verification error: %s', str(e))
                        
                        app.logger.error('[SocketIO pgAgent] Created connection but it is not connected')
                        reconnect_attempts += 1
                        return False
                    except Exception as e:
                        app.logger.error('[SocketIO pgAgent] Error creating new connection: %s', str(e))
                        reconnect_attempts += 1
                        return False
            
            # Function to handle notifications
            @with_app_context
            def process_notifications():
                nonlocal notification_count
                
                try:
                    notify = conn.get_notification()
                    
                    while notify:
                        if notify.channel == 'job_status_update':
                            notification_count += 1
                            try:
                                payload = json.loads(notify.payload)
                                
                                if payload.get('test', False) is True:
                                    app.logger.info('[SocketIO pgAgent] Received test notification')
                                else:
                                    try:
                                        socketio.emit('job_status_update', 
                                                   payload,
                                                   namespace=SOCKETIO_NAMESPACE, 
                                                   to=client_sid)
                                    except Exception as e:
                                        app.logger.error('[SocketIO pgAgent] Error emitting job status update: %s', str(e))
                            except json.JSONDecodeError:
                                app.logger.error('[SocketIO pgAgent] Invalid JSON in notification payload: %s', notify.payload)
                            except Exception as e:
                                app.logger.error('[SocketIO pgAgent] Error processing notification: %s', str(e))
                        
                        try:
                            notify = conn.get_notification()
                        except Exception as e:
                            app.logger.warning('[SocketIO pgAgent] Error getting next notification: %s', str(e))
                            break
                    
                    return True
                except Exception as e:
                    app.logger.error('[SocketIO pgAgent] Error in process_notifications: %s', str(e))
                    return False
            
            # Function to check if connection is alive
            @with_app_context
            def is_connection_alive():
                if not conn or not conn.connected():
                    return False
                
                try:
                    status, _ = conn.execute_scalar("SELECT 1")
                    return status
                except Exception as e:
                    app.logger.warning('[SocketIO pgAgent] Connection test query failed: %s', str(e))
                    return False
            
            # Function to verify connection has a valid cursor
            @with_app_context
            def verify_connection_cursor():
                if not conn:
                    return False
                    
                try:
                    # Test if cursor exists and works
                    if hasattr(conn, 'cursor') and conn.cursor is not None:
                        status, _ = conn.execute_scalar("SELECT 1")
                        return status
                    else:
                        return False
                except Exception as e:
                    app.logger.error('[SocketIO pgAgent] Cursor verification failed: %s', str(e))
                    return False
            
            # Function to check connection health
            @with_app_context
            def check_connection_health():
                if not conn or not conn.connected():
                    return False
                
                try:
                    if not is_connection_alive():
                        return False
                    
                    # Also verify cursor specifically
                    if not verify_connection_cursor():
                        return False
                    
                    status, channels = conn.execute_dict("SELECT pg_listening_channels() AS channel")
                    if not status or 'rows' not in channels:
                        return False
                        
                    has_pgagent_channel = any(row['channel'] == 'job_status_update' for row in channels['rows'])
                    if not has_pgagent_channel:
                        return False
                        
                    return True
                except Exception as e:
                    app.logger.error('[SocketIO pgAgent] Error checking connection health: %s', str(e))
                    return False
            
            # Function to send test notification
            @with_app_context
            def send_test_notification():
                try:
                    test_payload = json.dumps({
                        'test': True,
                        'timestamp': datetime.now().isoformat(),
                        'message': 'Test notification to verify LISTEN is working'
                    })
                    
                    status, result = conn.execute_scalar(
                        "SELECT pg_notify('job_status_update', $1::text)",
                        (test_payload,)
                    )
                    
                    if status:
                        return True
                    else:
                        app.logger.warning('[SocketIO pgAgent] Failed to send test notification: %s', str(result))
                        return False
                except Exception as e:
                    app.logger.warning('[SocketIO pgAgent] Error sending test notification: %s', str(e))
                    return False
                    
            # Function to execute keepalive with proper context handling
            @with_app_context
            def perform_keepalive():
                """Execute keepalive query with proper context handling"""
                with app.test_request_context():
                    user = active_listeners[sid][client_sid]['user']
                    if hasattr(app, 'login_manager'):
                        app.login_manager._update_request_context_with_user(user)
                        
                    if conn and conn.connected():
                        try:
                            status, _ = conn.execute_scalar("SELECT 1 AS keepalive")
                            return status
                        except Exception as e:
                            app.logger.warning('[SocketIO pgAgent] Keepalive error: %s', str(e))
                            return False
                    return False
                    
            # Initialize timing variables
            last_activity_time = datetime.now()
            last_health_check_time = datetime.now()
            last_heartbeat_time = datetime.now()
            next_keepalive_time = datetime.now()
            last_poll_success_time = datetime.now()
            last_connection_cycle = datetime.now()
            
            # Intervals for connection checks
            health_check_interval = 120  # 2 minutes
            heartbeat_interval = 30      # 30 seconds
            keepalive_interval = 45      # 45 seconds
            connection_cycle_interval = 300  # 5 minutes
            
            # Setup initial listener
            setup_success = setup_listener()
            if not setup_success:
                app.logger.error('[SocketIO pgAgent] Failed initial listener setup')
                if create_new_connection():
                    setup_listener()
            
            # Main event loop
            while sid in active_listeners and client_sid in active_listeners[sid] and \
                  socketio.server.manager.is_connected(client_sid, namespace=SOCKETIO_NAMESPACE):
                
                # Calculate sleep time based on reconnection attempts (exponential backoff)
                sleep_time = min(base_sleep_time * (2 ** reconnect_attempts), 30)
                
                # Increment connection age
                connection_age += sleep_time
                
                # Check if we've exceeded max reconnection attempts
                if reconnect_attempts >= max_reconnect_attempts:
                    app.logger.error('[SocketIO pgAgent] Exceeded maximum reconnection attempts. Terminating listener.')
                    break
                
                # Current time for interval calculations
                current_time = datetime.now()
                
                # Force connection cycle every X minutes regardless of other checks
                if (current_time - last_connection_cycle).total_seconds() > connection_cycle_interval:
                    last_connection_cycle = current_time
                    app.logger.info('[SocketIO pgAgent] Cycling connection due to age')
                    with app.app_context():
                        if create_new_connection():
                            setup_listener()
                            connection_age = 0
                        socketio.sleep(sleep_time)
                        continue
                
                # Periodic connection age refresh
                time_since_last_poll = (current_time - last_poll_success_time).total_seconds()
                if connection_age >= max_connection_age and time_since_last_poll > 120:
                    app.logger.info('[SocketIO pgAgent] Connection age limit reached, creating new connection')
                    if create_new_connection():
                        setup_listener()
                        connection_age = 0
                    socketio.sleep(sleep_time)
                    continue
                
                # Periodic status logging
                if (current_time - last_activity_time).total_seconds() > 300:
                    last_activity_time = current_time
                    app.logger.info('[SocketIO pgAgent] Listener running for client %s, server %s, notifications: %d', 
                                client_sid, sid, notification_count)
                
                # Connection keepalive
                if (current_time - next_keepalive_time).total_seconds() >= 0:
                    next_keepalive_time = current_time + timedelta(seconds=keepalive_interval)
                    
                    if perform_keepalive():
                        if connection_age > 60:
                            connection_age = max(connection_age - 30, 0)
                    else:
                        if create_new_connection():
                            setup_listener()
                
                # Heartbeat check
                if (current_time - last_heartbeat_time).total_seconds() > heartbeat_interval:
                    last_heartbeat_time = current_time
                    
                    if not is_connection_alive():
                        app.logger.warning('[SocketIO pgAgent] Heartbeat failed, connection appears dead')
                        if create_new_connection():
                            setup_listener()
                            socketio.sleep(sleep_time)
                            continue
                
                # Full health check
                if (current_time - last_health_check_time).total_seconds() > health_check_interval:
                    last_health_check_time = current_time
                    
                    if not check_connection_health():
                        app.logger.warning('[SocketIO pgAgent] Health check failed, attempting to fix')
                        
                        # Try to fix the connection by re-establishing LISTEN first
                        if conn and conn.connected():
                            if setup_listener():
                                # Only send test notification occasionally
                                if random.random() < 0.2:
                                    send_test_notification()
                                continue
                        
                        # If that didn't work, create a new connection
                        if create_new_connection():
                            setup_listener()
                
                # Poll for notifications
                try:
                    if conn and conn.connected():
                        poll_result = conn.poll()
                        
                        if isinstance(poll_result, tuple) and poll_result[0] == False:
                            # Handle error in poll result
                            error_msg = str(poll_result[1]) if len(poll_result) > 1 else "Unknown error"
                            
                            # Check for cursor errors - expanded pattern list
                            cursor_error_patterns = ["cursor", "no active sql", "connection", "closed", "reset", 
                                                    "broken", "not connected", "async", "context"]
                            is_cursor_error = any(pattern in error_msg.lower() for pattern in cursor_error_patterns)
                            
                            if is_cursor_error:
                                app.logger.warning("[SocketIO pgAgent] Cursor error: %s", error_msg)
                                
                                # For cursor errors, always create a new connection (don't try to salvage)
                                with app.app_context():
                                    if create_new_connection():
                                        setup_listener()
                                    else:
                                        reconnect_attempts += 1
                            else:
                                app.logger.error("[SocketIO pgAgent] Unhandled poll error: %s", error_msg)
                                reconnect_attempts += 1
                        elif poll_result == 1:
                            # Process notifications
                            process_success = process_notifications()
                            if process_success:
                                reconnect_attempts = 0
                                last_poll_success_time = datetime.now()
                            else:
                                # If processing failed, try to reset connection
                                app.logger.warning('[SocketIO pgAgent] Notification processing failed, checking connection')
                                if not is_connection_alive():
                                    create_new_connection()
                                    setup_listener()
                    else:
                        app.logger.warning('[SocketIO pgAgent] Connection lost, attempting to reconnect')
                        create_new_connection()
                        setup_listener()
                
                except CryptKeyMissing as e:
                    app.logger.error('[SocketIO pgAgent] Crypto key missing: %s', str(e))
                    return
                except Exception as e:
                    app.logger.error('[SocketIO pgAgent] Error in notification loop: %s', str(e))
                    reconnect_attempts += 1
                    
                    # Immediate retry if this seems to be a connection issue
                    conn_error_indicators = ["connection", "broken", "terminate", "reset", "closed"]
                    if any(indicator in str(e).lower() for indicator in conn_error_indicators):
                        app.logger.info('[SocketIO pgAgent] Connection appears broken, immediate reconnect attempt')
                        if create_new_connection():
                            setup_listener()
                
                # Sleep to avoid high CPU usage
                socketio.sleep(sleep_time)
            
            app.logger.info('[SocketIO pgAgent] Listener ended. Total notifications: %d', notification_count)
                            
        except CryptKeyMissing as e:
            app.logger.error('[SocketIO pgAgent] Crypto key missing: %s', str(e))
        except Exception as e:
            app.logger.error('[SocketIO pgAgent] Unexpected error: %s', str(e))
            app.logger.debug('[SocketIO pgAgent] Exception details: %s', traceback.format_exc())


#################################################################

blueprint = JobModule(__name__)

# Add a diagnostic endpoint for active listeners
@blueprint.route('/debug/active_listeners/', methods=['GET'])
def get_active_listeners():
    """
    Return information about all active Socket.IO listeners for pgAgent
    This is useful for debugging Socket.IO connection issues
    """
    from flask import current_app
    
    # Only allow in DEBUG mode
    if not current_app.debug:
        return make_json_response(
            success=0,
            errormsg="This endpoint is only available in DEBUG mode"
        )
    
    listener_info = {}
    try:
        # Collect information about active listeners
        for server_id, clients in active_listeners.items():
            listener_info[server_id] = {
                'client_count': len(clients),
                'clients': []
            }
            
            for client_id, conn_user in clients.items():
                connection_status = 'unknown'
                if conn_user['conn']:
                    try:
                        connection_status = 'connected' if conn_user['conn'].connected() else 'disconnected'
                    except Exception as e:
                        connection_status = f'error: {str(e)}'
                
                # Get socketio client info
                socket_connected = False
                try:
                    socket_connected = socketio.server.manager.is_connected(
                        client_id, namespace=SOCKETIO_NAMESPACE
                    )
                except Exception as e:
                    current_app.logger.error(
                        f'📢[SocketIO pgAgent] Error checking client connection: {str(e)}'
                    )
                
                listener_info[server_id]['clients'].append({
                    'client_id': client_id,
                    'db_connection_status': connection_status,
                    'socket_connected': socket_connected,
                    'timestamp': datetime.now().isoformat()
                })
        
        # Add global SocketIO stats
        listener_info['_socketio_stats'] = {
            'connected_clients': len(socketio.server.manager.get_participants(SOCKETIO_NAMESPACE)),
            'total_server_clients': socketio.server.manager.socket_count,
        }
        
        return make_json_response(
            data=listener_info,
            status=200
        )
    except Exception as e:
        current_app.logger.error(f'📢[SocketIO pgAgent] Error in diagnostic endpoint: {str(e)}')
        current_app.logger.error(f'📢[SocketIO pgAgent] Exception details: {traceback.format_exc()}')
        return make_json_response(
            success=0,
            errormsg=f"Error collecting listener information: {str(e)}"
        )

# Add a diagnostic endpoint to test notifications
@blueprint.route('/debug/test_notification/<int:sid>', methods=['GET'])
def test_notification(sid):
    """
    Send a test notification to simulate a pgAgent job status update
    This is useful for debugging Socket.IO notification handling
    """
    from flask import current_app
    
    # Only allow in DEBUG mode
    if not current_app.debug:
        return make_json_response(
            success=0,
            errormsg="This endpoint is only available in DEBUG mode"
        )
    
    try:
        # Get the server connection
        manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
        if not manager:
            return make_json_response(
                success=0,
                errormsg=f"Could not find connection manager for server ID {sid}"
            )
        
        conn = manager.connection()
        if not conn:
            return make_json_response(
                success=0,
                errormsg=f"Could not get connection for server ID {sid}"
            )
        
        # Create a test notification 
        current_app.logger.info(f"Sending test notification for server {sid}")
        
        test_payload = json.dumps({
            "job_id": 1,
            "status": "running",
            "timestamp": datetime.now().isoformat()
        })
        
        # Use NOTIFY to simulate a pgAgent job status update
        sql = f"NOTIFY job_status_update, '{test_payload}';"
        status, result = conn.execute_scalar(sql)
        
        if not status:
            return make_json_response(
                success=0,
                errormsg=f"Failed to execute NOTIFY command: {result}"
            )
        
        current_app.logger.info(f"Test notification sent for server {sid}")
        
        return make_json_response(
            success=1,
            data={
                "message": "Test notification sent",
                "server_id": sid,
                "timestamp": datetime.now().isoformat()
            }
        )
    except Exception as e:
        current_app.logger.error(f"Error sending test notification: {str(e)}")
        current_app.logger.error(f"Exception details: {traceback.format_exc()}")
        return make_json_response(
            success=0,
            errormsg=f"Error sending test notification: {str(e)}"
        )

# Add a direct test endpoint that can be used more easily for testing
@blueprint.route('/test_notification_direct/<int:sid>', methods=['GET'])
def test_notification_direct(sid):
    """A simpler test notification endpoint that will work in any mode"""
    try:
        # Get the server connection
        manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
        if not manager:
            return make_json_response(
                success=0,
                errormsg=f"Could not find connection manager for server ID {sid}"
            )
        
        conn = manager.connection()
        if not conn:
            return make_json_response(
                success=0,
                errormsg=f"Could not get connection for server ID {sid}"
            )
        
        # Create a test notification 
        current_app.logger.info(f"Sending direct test notification for server {sid}")
        
        test_payload = json.dumps({
            "job_id": 1,
            "status": "running",
            "timestamp": datetime.now().isoformat()
        })
        
        # Use NOTIFY to simulate a pgAgent job status update
        sql = f"NOTIFY job_status_update, '{test_payload}';"
        status, result = conn.execute_scalar(sql)
        
        if not status:
            return make_json_response(
                success=0,
                errormsg=f"Failed to execute NOTIFY command: {result}"
            )
        
        current_app.logger.info(f"Direct test notification sent for server {sid}")
        
        return make_json_response(
            success=1,
            data={
                "message": "Test notification sent directly",
                "server_id": sid,
                "timestamp": datetime.now().isoformat()
            }
        )
    except Exception as e:
        current_app.logger.error(f"Error sending direct test notification: {str(e)}")
        current_app.logger.error(f"Exception details: {traceback.format_exc()}")
        return make_json_response(
            success=0,
            errormsg=f"Error sending direct test notification: {str(e)}"
        )

# Simple test endpoint that works without restrictions for easy debugging
@blueprint.route('/test_notification_simple/<int:sid>', methods=['GET'])
def test_notification_simple(sid):
    """
    Simple test endpoint to send a notification for a given server.
    This endpoint is for diagnostics and doesn't require any authentication beyond 
    the existing session.
    
    Args:
        sid: Server ID
        
    Returns:
        Response with the status of the notification attempt
    """
    current_app.logger.info('🔍 [pgAgent] Received simple test notification request for server %s', str(sid))
    
    try:
        # Get the server from the session
        manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
        conn = manager.connection()
        
        if not conn:
            current_app.logger.error('❌ [pgAgent] Server connection not found for %s', str(sid))
            return make_json_response(
                success=False,
                errormsg='Server connection not found. Please connect to the server first.'
            )
            
        # Create a test payload
        import datetime
        import json
        import uuid
        
        job_id = str(uuid.uuid4())
        timestamp = datetime.datetime.now().isoformat()
        
        # Create both formats of notification to ensure compatibility
        payload = json.dumps({
            'job_id': job_id,
            'status': 'SUCCESS',
            'timestamp': timestamp
        }, ensure_ascii=False, separators=(',', ':'))
        
        # Log notification channels for debugging
        current_app.logger.info('🔈 [pgAgent] Available notification channels:')
        try:
            status, channels = conn.execute_dict("SELECT pg_listening_channels() AS channel")
            if status and 'rows' in channels:
                for channel in channels['rows']:
                    current_app.logger.info('  - %s', channel['channel'])
            else:
                current_app.logger.warning('⚠️ [pgAgent] Could not query listening channels')
        except Exception as e:
            current_app.logger.error('❌ [pgAgent] Error querying listening channels: %s', str(e))
            
        # Send notification using the NOTIFY command with the pgagent_jobs_status channel
        current_app.logger.info('🔔 [pgAgent] Sending test notification on channel "job_status_update" with payload: %s', payload)
        
        # First check if we are listening to this channel
        channel = 'job_status_update'
        status, listening = conn.execute_dict(f"SELECT count(*) as count FROM (SELECT pg_listening_channels() AS channel) AS t WHERE channel = '{channel}'")
        
        if status and 'rows' in listening and listening['rows'][0]['count'] > 0:
            current_app.logger.info('✓ [pgAgent] Confirmed listening on channel "%s"', channel)
        else:
            current_app.logger.warning('⚠️ [pgAgent] Not currently listening on channel "%s"', channel)
            current_app.logger.info('🔄 [pgAgent] Setting up LISTEN command for "%s"', channel)
            try:
                status, result = conn.execute_dict(f"LISTEN {channel}")
                if status:
                    current_app.logger.info('✓ [pgAgent] Successfully set up LISTEN for "%s"', channel)
                else:
                    current_app.logger.warning('⚠️ [pgAgent] Failed to LISTEN on "%s": %s', channel, str(result))
            except Exception as e:
                current_app.logger.error('❌ [pgAgent] Error setting up LISTEN: %s', str(e))
            
        # Send the notification
        sql = f"SELECT pg_notify('{channel}', $${payload}$$)"
        current_app.logger.info('🔔 [pgAgent] Executing SQL: %s', sql)
        status, notify_result = conn.execute_dict(sql)
        
        if status:
            current_app.logger.info('✓ [pgAgent] Successfully sent test notification')
            # Also log a notification with a different format for testing
            alt_payload = json.dumps({
                'message': 'Job status updated',
                'job_id': job_id,
                'status': 'SUCCESS',
                'server_id': sid
            }, ensure_ascii=False, separators=(',', ':'))
            
            conn.execute_dict(f"SELECT pg_notify('{channel}', $${alt_payload}$$)")
            
            return make_json_response(
                data={
                    'success': True,
                    'channel': channel,
                    'job_id': job_id,
                    'server_id': sid,
                    'message': 'Test notification sent successfully',
                    'payload': payload
                }
            )
        else:
            current_app.logger.error('❌ [pgAgent] Failed to send test notification: %s', str(notify_result))
            return make_json_response(
                success=False,
                errormsg=f'Failed to send test notification: {str(notify_result)}'
            )
    except Exception as e:
        import traceback
        current_app.logger.error('❌ [pgAgent] Exception in test_notification_simple: %s', str(e))
        current_app.logger.error(traceback.format_exc())
        return make_json_response(
            success=False,
            errormsg=f'Exception while sending test notification: {str(e)}'
        )


class JobView(PGChildNodeView):
    node_type = blueprint.node_type

    parent_ids = [
        {'type': 'int', 'id': 'gid'},
        {'type': 'int', 'id': 'sid'}
    ]
    ids = [
        {'type': 'int', 'id': 'jid'}
    ]

    operations = dict({
        'obj': [
            {'get': 'properties', 'delete': 'delete', 'put': 'update'},
            {'get': 'properties', 'post': 'create', 'delete': 'delete'}
        ],
        'nodes': [{'get': 'nodes'}, {'get': 'nodes'}],
        'sql': [{'get': 'sql'}],
        'msql': [{'get': 'msql'}, {'get': 'msql'}],
        'run_now': [{'put': 'run_now'}],
        'classes': [{}, {'get': 'job_classes'}],
        'children': [{'get': 'children'}],
        'stats': [{'get': 'statistics'}]
    })

    def check_precondition(f):
        """
        This function will behave as a decorator which will checks
        database connection before running view, it will also attaches
        manager,conn & template_path properties to self
        """

        @wraps(f)
        def wrap(self, *args, **kwargs):

            self.manager = get_driver(
                PG_DEFAULT_DRIVER
            ).connection_manager(
                kwargs['sid']
            )
            self.conn = self.manager.connection()

            # Set the template path for the sql scripts.
            self.template_path = 'pga_job/sql/pre3.4'

            if 'pgAgent'not in self.manager.db_info:
                _, res = self.conn.execute_dict("""
SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE
            table_schema='pgagent' AND table_name='pga_jobstep' AND
            column_name='jstconnstr'
    ) has_connstr""")

                self.manager.db_info['pgAgent'] = res['rows'][0]

            return f(self, *args, **kwargs)
        return wrap

    @check_precondition
    def nodes(self, gid, sid, jid=None):
        SQL = render_template(
            "/".join([self.template_path, self._NODES_SQL]),
            jid=jid, conn=self.conn
        )
        status, rset = self.conn.execute_dict(SQL)

        if not status:
            return internal_server_error(errormsg=rset)

        if jid is not None:
            if len(rset['rows']) != 1:
                return gone(
                    errormsg=_("Could not find the pgAgent job on the server.")
                )
            return make_json_response(
                data=self.blueprint.generate_browser_node(
                    rset['rows'][0]['jobid'],
                    sid,
                    rset['rows'][0]['jobname'],
                    "icon-pga_job" if rset['rows'][0]['jobenabled'] else
                    "icon-pga_job-disabled",
                    description=rset['rows'][0]['jobdesc']
                ),
                status=200
            )

        res = []
        for row in rset['rows']:
            res.append(
                self.blueprint.generate_browser_node(
                    row['jobid'],
                    sid,
                    row['jobname'],
                    "icon-pga_job" if row['jobenabled'] else
                    "icon-pga_job-disabled",
                    description=row['jobdesc']
                )
            )

        return make_json_response(
            data=res,
            status=200
        )

    @check_precondition
    def properties(self, gid, sid, jid=None):
        SQL = render_template(
            "/".join([self.template_path, self._PROPERTIES_SQL]),
            jid=jid, conn=self.conn
        )
        status, rset = self.conn.execute_dict(SQL)

        if not status:
            return internal_server_error(errormsg=rset)

        if jid is not None:
            if len(rset['rows']) != 1:
                return gone(
                    errormsg=_(
                        "Could not find the pgAgent job on the server."
                    )
                )
            res = rset['rows'][0]
            status, rset = self.conn.execute_dict(
                render_template(
                    "/".join([self.template_path, 'steps.sql']),
                    jid=jid, conn=self.conn,
                    has_connstr=self.manager.db_info['pgAgent']['has_connstr']
                )
            )
            if not status:
                return internal_server_error(errormsg=rset)
            res['jsteps'] = rset['rows']
            status, rset = self.conn.execute_dict(
                render_template(
                    "/".join([self.template_path, 'schedules.sql']),
                    jid=jid, conn=self.conn
                )
            )
            if not status:
                return internal_server_error(errormsg=rset)

            # Create jscexceptions in the correct format that React control
            # required.
            for schedule in rset['rows']:
                if 'jexid' in schedule and schedule['jexid'] is not None \
                        and len(schedule['jexid']) > 0:
                    schedule['jscexceptions'] = []
                    index = 0
                    for exid in schedule['jexid']:
                        schedule['jscexceptions'].append(
                            {'jexid': exid,
                             'jexdate': schedule['jexdate'][index],
                             'jextime': schedule['jextime'][index]
                             }
                        )

                        index += 1

            res['jschedules'] = rset['rows']
        else:
            res = rset['rows']

        return ajax_response(
            response=res,
            status=200
        )

    @check_precondition
    def create(self, gid, sid):
        """Create the pgAgent job."""
        required_args = [
            'jobname'
        ]

        data = request.form if request.form else json.loads(
            request.data.decode('utf-8')
        )

        for arg in required_args:
            if arg not in data:
                return make_json_response(
                    status=410,
                    success=0,
                    errormsg=_(
                        "Could not find the required parameter ({})."
                    ).format(arg)
                )

        status, res = self.conn.execute_void('BEGIN')
        if not status:
            return internal_server_error(errormsg=res)

        status, res = self.conn.execute_scalar(
            render_template(
                "/".join([self.template_path, self._CREATE_SQL]),
                data=data, conn=self.conn, fetch_id=True,
                has_connstr=self.manager.db_info['pgAgent']['has_connstr']
            )
        )

        if not status:
            self.conn.execute_void('END')
            return internal_server_error(errormsg=res)

        # We need oid of newly created database
        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, self._NODES_SQL]),
                jid=res, conn=self.conn
            )
        )

        self.conn.execute_void('END')
        if not status:
            return internal_server_error(errormsg=res)

        row = res['rows'][0]

        return jsonify(
            node=self.blueprint.generate_browser_node(
                row['jobid'],
                sid,
                row['jobname'],
                icon="icon-pga_job" if row['jobenabled']
                else "icon-pga_job-disabled"
            )
        )

    @check_precondition
    def update(self, gid, sid, jid):
        """Update the pgAgent Job."""

        data = request.form if request.form else json.loads(
            request.data.decode('utf-8')
        )

        # Format the schedule and step data
        self.format_schedule_step_data(data)

        status, res = self.conn.execute_void(
            render_template(
                "/".join([self.template_path, self._UPDATE_SQL]),
                data=data, conn=self.conn, jid=jid,
                has_connstr=self.manager.db_info['pgAgent']['has_connstr']
            )
        )

        if not status:
            return internal_server_error(errormsg=res)

        # We need oid of newly created database
        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, self._NODES_SQL]),
                jid=jid, conn=self.conn
            )
        )

        if not status:
            return internal_server_error(errormsg=res)

        row = res['rows'][0]

        return jsonify(
            node=self.blueprint.generate_browser_node(
                jid,
                sid,
                row['jobname'],
                icon="icon-pga_job" if row['jobenabled']
                else "icon-pga_job-disabled",
                description=row['jobdesc']
            )
        )

    @check_precondition
    def delete(self, gid, sid, jid=None):
        """Delete the pgAgent Job."""

        if jid is None:
            data = request.form if request.form else json.loads(
                request.data
            )
        else:
            data = {'ids': [jid]}

        for jid in data['ids']:
            status, res = self.conn.execute_void(
                render_template(
                    "/".join([self.template_path, self._DELETE_SQL]),
                    jid=jid, conn=self.conn
                )
            )
            if not status:
                return internal_server_error(errormsg=res)

        return make_json_response(success=1)

    @check_precondition
    def msql(self, gid, sid, jid=None):
        """
        This function to return modified SQL.
        """
        data = {}
        for k, v in request.args.items():
            try:
                data[k] = json.loads(
                    v.decode('utf-8') if hasattr(v, 'decode') else v
                )
            except ValueError:
                data[k] = v

        # Format the schedule and step data
        self.format_schedule_step_data(data)

        return make_json_response(
            data=render_template(
                "/".join([
                    self.template_path,
                    self._CREATE_SQL if jid is None else self._UPDATE_SQL
                ]),
                jid=jid, data=data, conn=self.conn, fetch_id=False,
                has_connstr=self.manager.db_info['pgAgent']['has_connstr']
            ),
            status=200
        )

    @check_precondition
    def statistics(self, gid, sid, jid):
        """
        statistics
        Returns the statistics for a particular database if jid is specified,
        otherwise it will return statistics for all the databases in that
        server.
        """
        pref = Preferences.module('browser')
        rows_threshold = pref.preference(
            'pgagent_row_threshold'
        )

        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'stats.sql']),
                jid=jid, conn=self.conn,
                rows_threshold=rows_threshold.get()
            )
        )

        if not status:
            return internal_server_error(errormsg=res)

        return make_json_response(
            data=res,
            status=200
        )

    @check_precondition
    def sql(self, gid, sid, jid):
        """
        This function will generate sql for sql panel
        """
        SQL = render_template(
            "/".join([self.template_path, self._PROPERTIES_SQL]),
            jid=jid, conn=self.conn, last_system_oid=0
        )
        status, res = self.conn.execute_dict(SQL)
        if not status:
            return internal_server_error(errormsg=res)

        if len(res['rows']) == 0:
            return gone(
                _("Could not find the object on the server.")
            )

        row = res['rows'][0]

        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'steps.sql']),
                jid=jid, conn=self.conn,
                has_connstr=self.manager.db_info['pgAgent']['has_connstr']
            )
        )
        if not status:
            return internal_server_error(errormsg=res)

        row['jsteps'] = res['rows']

        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'schedules.sql']),
                jid=jid, conn=self.conn
            )
        )
        if not status:
            return internal_server_error(errormsg=res)

        row['jschedules'] = res['rows']
        for schedule in row['jschedules']:
            schedule['jscexceptions'] = []
            if schedule['jexid']:
                idx = 0
                for exc in schedule['jexid']:
                    # Convert datetime.time object to string
                    if isinstance(schedule['jextime'][idx], time):
                        schedule['jextime'][idx] = \
                            schedule['jextime'][idx].strftime("%H:%M:%S")
                    schedule['jscexceptions'].append({
                        'jexid': exc,
                        'jexdate': schedule['jexdate'][idx],
                        'jextime': schedule['jextime'][idx]
                    })
                    idx += 1
            del schedule['jexid']
            del schedule['jexdate']
            del schedule['jextime']

        return ajax_response(
            response=render_template(
                "/".join([self.template_path, self._CREATE_SQL]),
                jid=jid, data=row, conn=self.conn, fetch_id=False,
                has_connstr=self.manager.db_info['pgAgent']['has_connstr']
            )
        )

    @check_precondition
    def run_now(self, gid, sid, jid):
        """
        This function will set the next run to now, to inform the pgAgent to
        run the job now.
        """
        status, res = self.conn.execute_void(
            render_template(
                "/".join([self.template_path, 'run_now.sql']),
                jid=jid, conn=self.conn
            )
        )
        if not status:
            return internal_server_error(errormsg=res)

        return success_return(
            message=_("Updated the next runtime to now.")
        )

    @check_precondition
    def job_classes(self, gid, sid):
        """
        This function will return the set of job classes.
        """
        status, res = self.conn.execute_dict(
            render_template("/".join([self.template_path, 'job_classes.sql']))
        )

        if not status:
            return internal_server_error(errormsg=res)

        return make_json_response(
            data=res['rows'],
            status=200
        )

    def format_schedule_step_data(self, data):
        """
        This function is used to format the schedule and step data.
        :param data:
        :return:
        """
        # Format the schedule data. Convert the boolean array
        jschedules = data.get('jschedules', {})
        if isinstance(jschedules, dict):
            for schedule in jschedules.get('added', []):
                format_schedule_data(schedule)
            for schedule in jschedules.get('changed', []):
                format_schedule_data(schedule)

        has_connection_str = self.manager.db_info['pgAgent']['has_connstr']
        jssteps = data.get('jsteps', {})
        if isinstance(jssteps, dict):
            for changed_step in jssteps.get('changed', []):
                status, res = format_step_data(
                    data['jobid'], changed_step, has_connection_str,
                    self.conn, self.template_path)
                if not status:
                    internal_server_error(errormsg=res)


JobView.register_node_view(blueprint)
