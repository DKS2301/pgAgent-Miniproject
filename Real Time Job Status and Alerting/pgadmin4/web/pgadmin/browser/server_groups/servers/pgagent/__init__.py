##########################################################################
#
# pgAdmin 4 - PostgreSQL Tools
#
# Copyright (C) 2013 - 2025, The pgAdmin Development Team
# This software is released under the PostgreSQL Licence
#
##########################################################################

"""Implements the pgAgent Jobs Node"""
import asyncio
from functools import wraps
import json
from datetime import datetime, time, timedelta

import threading
import time
import json
from flask import current_app
from datetime import datetime
from pgadmin.utils.driver import get_driver
import traceback
import functools
import logging
import threading

from flask import render_template, request, jsonify, current_app
import flask
from flask_babel import gettext as _
from flask_login import current_user

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

# Configure logging
logger = logging.getLogger(__name__)

# Define the SocketIO namespace for pgAgent
SOCKETIO_NAMESPACE = '/pgagent'

# Dictionary to store server's active listeners
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
        
        # Make sure we have a connection - explicitly use synchronous connection
        conn = manager.connection(async_=0)
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
            
            # Store the connection in the active_listeners dict for notifications
            if sid not in active_listeners:
                active_listeners[sid] = {}
            
            # Store the connection and user for this client
            active_listeners[sid][request.sid] = {
                'conn': conn, 
                'user': current_user._get_current_object(),
                'server_info': {
                'server_id': sid,
                'client_id': client_info.get('client_id', request.sid),
                'socket_id': request.sid,
                'started_at': datetime.now().isoformat()
                }
            }
            
            # Run async function in a new thread
            async def check_notifications(app, sid, client_sid):
                """
                Background thread to listen for pgAgent job status updates using raw PostgreSQL connection.
                
                Args:
                    app: Flask application context
                    sid: Server ID
                """
                max_retries = 3
                retry_delay = 5  # seconds
                retry_count = 0
                
                while retry_count < max_retries:
                    try:
                        with app.app_context():                            
                            # Get server from model
                            from pgadmin.model import Server
                            server = Server.query.filter_by(id=sid).first()
                            
                            if not server:
                                logger.error(f"Server with ID {sid} not found")
                                return
                                
                            # Create raw connection using psycopg
                            import psycopg
                            from psycopg.conninfo import make_conninfo
                            
                            # Build connection string from server details
                            conninfo = make_conninfo(
                                dbname=server.maintenance_db,
                                user=server.username,
                                password=server.password,
                                host=server.host,
                                port=server.port,
                                sslmode=server.ssl_mode if hasattr(server, 'ssl_mode') else None
                            )
                            
                            # Create async connection
                            async with await psycopg.AsyncConnection.connect(conninfo) as conn:
                                # Set up notification listener
                                async with conn.cursor() as cur:
                                    await cur.execute("LISTEN job_status_update")
                                    await conn.commit() 
                                    logger.info(f"Listening for pgAgent job updates on server {sid}")
                                
                                # Reset retry count on successful connection
                                retry_count = 0
                                while True:
                                    logger.info(f"Checking for pgAgent job updates on server {sid}")
                                    # Process notifications
                                    async for notify in conn.notifies():
                                        logger.info(f"Received pgAgent job update notification: {notify}")
                                        try:
                                            # Parse notification payload
                                            payload = json.loads(notify.payload)
                                            payload['sid'] = sid
                                            try:
                                                socketio.emit('job_status_update', 
                                                    payload,
                                                    namespace=SOCKETIO_NAMESPACE, 
                                                    to=client_sid)
                                            except Exception as e:
                                                    logger.error('[SocketIO pgAgent] Error emitting job status update: %s', str(e))
                                        except json.JSONDecodeError as e:
                                            logger.error(f"Error parsing notification payload: {e}")
                                        except Exception as e:
                                            logger.error(f"Error processing notification: {e}")
                                        
                    except Exception as e:
                        retry_count += 1
                        logger.error(f"Error in notification listener (attempt {retry_count}/{max_retries}): {e}")
                        logger.error(traceback.format_exc())
                        
                        if retry_count < max_retries:
                            logger.info(f"Retrying connection in {retry_delay} seconds...")
                            await asyncio.sleep(retry_delay)
                        else:
                            logger.error("Max retries exceeded. Stopping notification listener.")
                            break
                            
                logger.info(f"Notification listener stopped for server {sid}")

            def start_job_status_listener(app, sid, client_sid):
                """Start the notification listener in a new event loop"""
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(check_notifications(app, sid, client_sid))
                except Exception as e:
                    logger.error(f"Error in notification listener thread: {e}")
                    logger.error(traceback.format_exc())
                finally:
                    loop.close()

            client_sid = request.sid
            thread = threading.Thread(
                target=start_job_status_listener, 
                args=(current_app._get_current_object(), sid, client_sid), 
                daemon=True
            )
            thread.start()

            
            # Send success response to client
            socketio.emit('job_status_listener_started', {
                'status': 'success',
                'server_id': sid,
                'message': 'Job status listener started successfully',
                'listener_info': active_listeners[sid][request.sid]['server_info']
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
        'jobs': [{'get': 'jobs'}, {'get': 'jobs'}],
        'children': [{'get': 'children'}],
        'stats': [{'get': 'statistics'}],
        'audit_log': [{'get': 'audit_log'}],
        'dependency_graph': [{'get': 'dependency_graph'}]
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
        """Get the job properties."""
        if jid is None:
            # Get all jobs
            SQL = render_template(
                "/".join([self.template_path, self._NODES_SQL]),
                conn=self.conn
            )
            status, rset = self.conn.execute_dict(SQL)
            
            if not status:
                return internal_server_error(errormsg=rset)
                
            return ajax_response(
                response=rset['rows'],
                status=200
            )
            
        # Get specific job properties
        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, self._PROPERTIES_SQL]),
                jid=jid, conn=self.conn, last_system_oid=0
            )
        )
        if not status:
            return internal_server_error(errormsg=res)

        if len(res['rows']) == 0:
            return gone(
                _("Could not find the object on the server.")
            )

        row = res['rows'][0]

        # Get job steps
        status, rset = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'steps.sql']),
                jid=jid, conn=self.conn,
                has_connstr=self.manager.db_info['pgAgent']['has_connstr']
            )
        )
        if not status:
            return internal_server_error(errormsg=rset)

        row['jsteps'] = rset['rows']

        # Get job schedules
        status, rset = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'schedules.sql']),
                jid=jid, conn=self.conn
            )
        )
        if not status:
            return internal_server_error(errormsg=rset)

        # Create jscexceptions in the correct format that React control required
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

        row['jschedules'] = rset['rows']

        # Get job dependencies
        status, rset = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'dependencies.sql']),
                jid=jid, conn=self.conn
            )
        )
        if not status:
            return internal_server_error(errormsg=rset)

        # Set original_dependent_jobid to track changes
        for dep in rset['rows']:
            dep['original_dependent_jobid'] = dep['dependent_jobid']

        row['jdependencies'] = rset['rows']
        
        # Get audit logs for the job
        status, rset = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'audit_log.sql']),
                jid=jid, conn=self.conn
            )
        )
        if not status:
            return internal_server_error(errormsg=rset)
            
        # Process JSON fields to ensure they're properly formatted
        for audit_row in rset['rows']:
            if 'old_values' in audit_row and audit_row['old_values']:
                if isinstance(audit_row['old_values'], str):
                    try:
                        audit_row['old_values'] = json.loads(audit_row['old_values'])
                    except ValueError:
                        pass
                        
            if 'new_values' in audit_row and audit_row['new_values']:
                if isinstance(audit_row['new_values'], str):
                    try:
                        audit_row['new_values'] = json.loads(audit_row['new_values'])
                    except ValueError:
                        pass
                        
        row['audit_logs'] = rset['rows']

        return ajax_response(
            response=row,
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

        job_id = res
            
        # Insert dependencies if any
        if 'jdependencies' in data and len(data['jdependencies']) > 0:
            status, res = self.conn.execute_void(
                render_template(
                    "/".join([self.template_path, 'create_dependencies.sql']),
                    data=data, conn=self.conn, jid=job_id
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
         # Update dependencies
        status, res = self.conn.execute_void(
            render_template(
                "/".join([self.template_path, 'update_dependencies.sql']),
                data=data, conn=self.conn, jid=jid
            )
        )

        if not status:
            self.conn.execute_void('END')
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
    

    @check_precondition
    def jobs(self, gid, sid, jid=None):
        """
        This function will return the list of jobs for dependencies.
        """
        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'jobs.sql']),
                jid=jid,
                conn=self.conn
            )
        )

        if not status:
            return internal_server_error(errormsg=res)

        return make_json_response(
            data=res['rows'],
            status=200
        )

    @check_precondition
    def audit_log(self, gid, sid, jid):
        """
        Returns the audit log entries for the specified job.
        """
        # First check if the audit log table exists
        check_sql = """
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'pgagent' 
            AND table_name = 'pga_job_audit_log'
        ) as table_exists;
        """
        status, check_res = self.conn.execute_dict(check_sql)
        
        if not status:
            return internal_server_error(errormsg=check_res)
            
        if len(check_res['rows']) == 0 or not check_res['rows'][0]['table_exists']:
            # Table doesn't exist, return empty result
            return ajax_response(
                response={'rows': [], 'msg': 'Audit log table does not exist. Please upgrade pgAgent to version 4.3 or later.'},
                status=200
            )
        
        # Get row threshold preference
        pref = Preferences.module('browser')
        rows_threshold = pref.preference(
            'pgagent_row_threshold'
        )
        
        # Get filter parameters from request
        operation_types = request.args.get('operation_types', None)
        date_from = request.args.get('date_from', None)
        date_to = request.args.get('date_to', None)
        
        # Get sorting parameters
        sort_column = request.args.get('sort', 'operation_time')
        sort_order = request.args.get('sort_order', 'desc')
        
        # Format operation types for SQL query if provided
        operation_types_sql = None
        if operation_types:
            op_types = operation_types.split(',')
            # Format as SQL string list: 'CREATE', 'MODIFY', etc.
            operation_types_sql = "'" + "', '".join(op_types) + "'"

        # Table exists, proceed with query
        status, res = self.conn.execute_dict(
            render_template(
                "/".join([self.template_path, 'audit_log.sql']),
                jid=jid,
                conn=self.conn,
                operation_types=operation_types_sql,
                date_from=date_from,
                date_to=date_to,
                sort_column=sort_column,
                sort_order=sort_order,
                rows_threshold=rows_threshold.get()
            )
        )

        if not status:
            return internal_server_error(errormsg=res)
        
        # Debug: Log the number of rows returned and filter parameters
        filter_info = f"Filters: operation_types={operation_types}, date_from={date_from}, date_to={date_to}"
        print(f"Audit log query for job {jid} returned {len(res['rows'])} rows. {filter_info}")
            
        # Process JSON fields to ensure they're properly formatted
        for row in res['rows']:
            if 'old_values' in row and row['old_values']:
                if isinstance(row['old_values'], str):
                    try:
                        row['old_values'] = json.loads(row['old_values'])
                    except ValueError:
                        pass
                        
            if 'new_values' in row and row['new_values']:
                if isinstance(row['new_values'], str):
                    try:
                        row['new_values'] = json.loads(row['new_values'])
                    except ValueError:
                        pass

        return ajax_response(
            response=res,
            status=200
        )

    @check_precondition
    def dependency_graph(self, gid, sid):
        """Get the job dependency graph data."""
        try:
            # Get all jobs
            status, jobs = self.conn.execute_dict(
                render_template(
                    "/".join([self.template_path, self._NODES_SQL]),
                    conn=self.conn
                )
            )
            if not status:
                return internal_server_error(errormsg=jobs)

            # Get all dependencies
            status, deps = self.conn.execute_dict(
                render_template(
                    "/".join([self.template_path, 'dependencies.sql']),
                    conn=self.conn
                )
            )
            if not status:
                return internal_server_error(errormsg=deps)

            # Build the graph data
            nodes = []
            edges = []
            
            # Add nodes for all jobs
            for job in jobs['rows']:
                nodes.append({
                    'id': job['jobid'],
                    'name': job['jobname'],
                    'enabled': job['jobenabled'],
                    'status': job['jlgstatus'],
                    'next_run': job['jobnextrun'],
                    'last_run': job['joblastrun']
                })

            # Add edges for all dependencies
            for dep in deps['rows']:
                edges.append({
                    'source': dep['jobid'],
                    'target': dep['dependent_jobid'],
                    'dependent_jobname': dep['dependent_jobname']
                })

            return ajax_response(
                response={
                    'nodes': nodes,
                    'edges': edges
                },
                status=200
            )

        except Exception as e:
            return internal_server_error(errormsg=str(e))

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
