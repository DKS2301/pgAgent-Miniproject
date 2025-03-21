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
from datetime import datetime, time
import select
import traceback

from flask import app, render_template, request, jsonify, current_app
from flask_babel import gettext as _

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


# SocketIO event handlers for pgAgent job status updates
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
    Start listening for job status updates from PostgreSQL
    """
    current_app.logger.info('📢[SocketIO pgAgent] Starting job status listener for client: %s', request.sid)
    current_app.logger.debug('📢[SocketIO pgAgent] Request data: %s', str(data))
    
    try:
        sid = data.get('sid')
        if not sid:
            current_app.logger.warning('📢[SocketIO pgAgent] Server ID not provided for job status listener')
            socketio.emit('job_status_listener_error', 
                         'Server ID is required',
                         namespace=SOCKETIO_NAMESPACE, 
                         to=request.sid)
            return

        current_app.logger.debug('📢[SocketIO pgAgent] Getting connection manager for server ID: %s', sid)
        
        # Get the connection manager for this server
        manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
        if not manager:
            current_app.logger.error('📢[SocketIO pgAgent] Connection manager not found for server ID: %s', sid)
            socketio.emit('job_status_listener_error', 
                         'Connection manager not found',
                         namespace=SOCKETIO_NAMESPACE, 
                         to=request.sid)
            return
            
        current_app.logger.debug('📢[SocketIO pgAgent] Getting database connection for server ID: %s', sid)
        conn = manager.connection()
        
        # Check if connection is valid
        if not conn or not conn.connected():
            current_app.logger.error('📢[SocketIO pgAgent] Database connection is not valid for server: %s', sid)
            current_app.logger.debug('📢[SocketIO pgAgent] Connection status: %s', 
                           'None' if not conn else conn.status_message())
            socketio.emit('job_status_listener_error', 
                         'Database connection is not valid',
                         namespace=SOCKETIO_NAMESPACE, 
                         to=request.sid)
            return
        
        current_app.logger.debug('📢[SocketIO pgAgent] Setting up LISTEN for job_status_update on server: %s', sid)
        
        # Setup LISTEN for job status updates
        try:
            status, result = conn.execute_void("LISTEN job_status_update")
            current_app.logger.info('📢[SocketIO pgAgent] LISTEN command issued for job_status_update on server: %s (Status: %s)', 
                          sid, status)
            if not status:
                current_app.logger.error('📢[SocketIO pgAgent] Failed to execute LISTEN command: %s', str(result))
                socketio.emit('job_status_listener_error', 
                             'Failed to execute LISTEN command',
                             namespace=SOCKETIO_NAMESPACE, 
                             to=request.sid)
                return
        except Exception as e:
            current_app.logger.error('📢[SocketIO pgAgent] Exception while setting up LISTEN: %s', str(e))
            current_app.logger.error('📢[SocketIO pgAgent] Exception details: %s', str(e.__traceback__))
            socketio.emit('job_status_listener_error', 
                         'Exception while setting up LISTEN: ' + str(e),
                         namespace=SOCKETIO_NAMESPACE, 
                         to=request.sid)
            return
        
        # Store the connection to track active listeners
        current_app.logger.debug('📢[SocketIO pgAgent] Storing connection in active listeners dict')
        if sid not in active_listeners:
            active_listeners[sid] = {}
        
        active_listeners[sid][request.sid] = conn
        current_app.logger.info('📢[SocketIO pgAgent] Added client %s to active listeners for server %s', 
                      request.sid, sid)
        current_app.logger.debug('📢[SocketIO pgAgent] Current active listeners: %s', 
                       str({k: list(v.keys()) for k, v in active_listeners.items()}))
        
        # Start background task to check for notifications
        current_app.logger.debug('📢[SocketIO pgAgent] Starting background task to check for notifications')
        socketio.start_background_task(
            target=check_job_status_notifications,
            sid=sid,
            client_sid=request.sid
        )
        
        socketio.emit('job_status_listener_started', 
                     {'sid': sid},
                     namespace=SOCKETIO_NAMESPACE, 
                     to=request.sid)
        current_app.logger.info('📢[SocketIO pgAgent] Job status listener started for client %s on server %s', 
                      request.sid, sid)
    except Exception as e:
        current_app.logger.error('📢[SocketIO pgAgent] Unexpected error starting job status listener: %s', str(e))
        current_app.logger.error('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
        socketio.emit('job_status_listener_error', 
                     'Unexpected error: ' + str(e),
                     namespace=SOCKETIO_NAMESPACE, 
                     to=request.sid)


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
            conn = active_listeners[sid][request.sid]
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
        app.logger.error('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
        socketio.emit('job_status_listener_error', 
                     'Error stopping listener: ' + str(e),
                     namespace=SOCKETIO_NAMESPACE, 
                     to=request.sid)


@socketio.on('disconnect', namespace=SOCKETIO_NAMESPACE)
def handle_client_disconnect():
    """
    Clean up when client disconnects
    """
    current_app.logger.info('📢[SocketIO pgAgent] Client disconnected from pgAgent socket: %s', request.sid)
    
    try:
        # Track if we found any active listeners for this client
        found_listeners = False
        
        current_app.logger.debug('📢[SocketIO pgAgent] Active listeners before disconnect cleanup: %s', 
                       str({k: list(v.keys()) for k, v in active_listeners.items()}))
        
        for sid in list(active_listeners.keys()):
            if request.sid in active_listeners[sid]:
                found_listeners = True
                app.logger.info('📢[SocketIO pgAgent] Found active listener for client %s on server %s, cleaning up', 
                              request.sid, sid)
                
                try:
                    conn = active_listeners[sid][request.sid]
                    if conn and conn.connected():
                        try:
                            app.logger.debug('📢[SocketIO pgAgent] Issuing UNLISTEN command on disconnect for server: %s', sid)
                            status, result = conn.execute_void("UNLISTEN job_status_update")
                            app.logger.info('📢[SocketIO pgAgent] UNLISTEN command issued on disconnect for server: %s (Status: %s)', 
                                          sid, status)
                            if not status:
                                app.logger.warning('📢[SocketIO pgAgent] Failed to execute UNLISTEN command on disconnect: %s', 
                                                 str(result))
                        except Exception as e:
                            app.logger.warning('📢[SocketIO pgAgent] Error issuing UNLISTEN command on disconnect: %s', str(e))
                            app.logger.debug('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
                    else:
                        app.logger.debug('📢[SocketIO pgAgent] Connection already closed for client %s, server %s', 
                                       request.sid, sid)
                except Exception as e:
                    app.logger.warning('📢[SocketIO pgAgent] Error accessing connection on disconnect: %s', str(e))
                
                finally:
                    # Always remove the client from active listeners
                    del active_listeners[sid][request.sid]
                    app.logger.info('📢[SocketIO pgAgent] Removed client %s from active listeners for server %s on disconnect', 
                                  request.sid, sid)
                    
                    # Clean up server entry if no more clients are listening
                    if not active_listeners[sid]:
                        del active_listeners[sid]
                        app.logger.info('📢[SocketIO pgAgent] No more active listeners for server %s, removed server entry', sid)
        
        if not found_listeners:
            app.logger.debug('📢[SocketIO pgAgent] No active listeners found for disconnecting client %s', request.sid)
            
        app.logger.debug('📢[SocketIO pgAgent] Active listeners after disconnect cleanup: %s', 
                       str({k: list(v.keys()) for k, v in active_listeners.items()}))
                       
    except Exception as e:
        app.logger.error('📢[SocketIO pgAgent] Unexpected error in disconnect handler: %s', str(e))
        app.logger.error('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())


def check_job_status_notifications(sid, client_sid):
    """
    Background task to check for notifications and emit them to the client
    """
    app.logger.info('📢[SocketIO pgAgent] Starting notification checker for client %s, server %s', 
                  client_sid, sid)
    
    try:
        # Validate active listener exists
        if sid not in active_listeners or client_sid not in active_listeners[sid]:
            app.logger.warning('📢[SocketIO pgAgent] No active listener found for client %s, server %s', 
                             client_sid, sid)
            return
            
        conn = active_listeners[sid][client_sid]
        
        if not conn or not conn.connected():
            app.logger.error('📢[SocketIO pgAgent] Connection not valid for notification checker')
            return
            
        app.logger.debug('📢[SocketIO pgAgent] Starting notification loop for client %s, server %s', 
                       client_sid, sid)
        
        # Count notifications for logging
        notification_count = 0
        last_activity_time = datetime.now()
        
        # Continue as long as the connection is active and client is still connected
        while sid in active_listeners and client_sid in active_listeners[sid] and \
              conn.connected() and socketio.server.manager.is_connected(client_sid, namespace=SOCKETIO_NAMESPACE):
            
            # Log periodic status updates
            current_time = datetime.now()
            time_diff = (current_time - last_activity_time).total_seconds()
            if time_diff > 60:  # Log status every minute
                app.logger.debug('📢[SocketIO pgAgent] Notification checker still active for client %s, server %s. ' 
                               'Notifications received so far: %d', 
                               client_sid, sid, notification_count)
                last_activity_time = current_time
                
            try:
                # Check for notifications using select with a timeout
                app.logger.debug('📢[SocketIO pgAgent] Checking for notifications from PostgreSQL')
                if conn.poll() == 1:
                    try:
                        notify = conn.get_notification()
                        
                        while notify:
                            app.logger.debug('📢[SocketIO pgAgent] Received notification: %s', str(notify))
                            
                            # Process the notification if it is a job status update
                            if notify.channel == 'job_status_update':
                                notification_count += 1
                                try:
                                    # Parse the payload as JSON
                                    payload = json.loads(notify.payload)
                                    app.logger.info('📢[SocketIO pgAgent] Job status update received: %s', str(payload))
                                    
                                    # Emit the update to the client
                                    socketio.emit('job_status_update', 
                                                 payload,
                                                 namespace=SOCKETIO_NAMESPACE, 
                                                 to=client_sid)
                                    app.logger.debug('📢[SocketIO pgAgent] Job status update emitted to client %s', 
                                                   client_sid)
                                except json.JSONDecodeError:
                                    app.logger.error('📢[SocketIO pgAgent] Invalid JSON in notification payload: %s', 
                                                   notify.payload)
                                except Exception as e:
                                    app.logger.error('📢[SocketIO pgAgent] Error processing notification: %s', str(e))
                                    app.logger.debug('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
                            
                            # Get the next notification if available
                            notify = conn.get_notification()
                    except Exception as e:
                        app.logger.error('📢[SocketIO pgAgent] Error retrieving notification: %s', str(e))
                        app.logger.debug('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
                
                # Sleep briefly to avoid high CPU usage
                socketio.sleep(0.5)
                
            except Exception as e:
                app.logger.error('📢[SocketIO pgAgent] Error in notification loop: %s', str(e))
                app.logger.debug('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())
                socketio.sleep(1)  # Sleep a bit longer after an error
        
        app.logger.info('📢[SocketIO pgAgent] Notification checker ending for client %s, server %s. ' 
                      'Total notifications: %d. Connection state: %s', 
                      client_sid, sid, notification_count, 
                      'Connected' if conn and conn.connected() else 'Disconnected')
                      
    except Exception as e:
        app.logger.error('📢[SocketIO pgAgent] Unexpected error in notification checker: %s', str(e))
        app.logger.error('📢[SocketIO pgAgent] Exception details: %s', traceback.format_exc())


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
            
            for client_id, conn in clients.items():
                connection_status = 'unknown'
                if conn:
                    try:
                        connection_status = 'connected' if conn.connected() else 'disconnected'
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
