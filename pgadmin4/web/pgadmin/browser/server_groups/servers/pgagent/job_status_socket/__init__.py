import json
import threading
import logging
import sys
from flask import url_for, current_app
from flask_socketio import Namespace, emit, join_room, leave_room
from flask_security import login_required
from pgadmin.utils.driver import get_driver
from config import PG_DEFAULT_DRIVER
from pgadmin.browser import PgAdminModule

# ✅ Configure custom logger
logger = logging.getLogger("JobStatusSocket")
logger.setLevel(logging.DEBUG)  # Set to DEBUG for detailed logs

# ✅ Add handler if missing
if not logger.hasHandlers():
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

logger.info("✅ JobStatusSocketModule logging initialized")

# Define our module class that inherits from PgAdminModule
class JobStatusSocketModule(PgAdminModule):
    """A module for pgAgent job status notification via WebSockets"""

    LABEL = 'Job Status Socket'
    
    def __init__(self, import_name, **kwargs):
        kwargs.setdefault('url_prefix', '/job_status_socket')
        super().__init__('job_status_socket', import_name, **kwargs)
        self.server_connections = {}

    def get_nodes(self, sid, **kwargs):
        return []

    @property
    def csssnippets(self):
        return []

    def get_exposed_url_endpoints(self):
        return ['job_status_socket.index']

    def register(self, app, options):
        """Register the module with the Flask app."""
        super().register(app, options)
        if hasattr(app, 'socketio'):
            app.socketio.on_namespace(JobStatusNamespace('/browser/job_status_socket', self))
            logger.info('✅Registered pgAgent job status socket namespace')
        else:
            logger.info('❌ Failed Registered pgAgent job status socket namespace')


    def setup_pg_listener(self, server_id):
        """Set up a connection to listen for PostgreSQL notifications"""
        try:
            manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(server_id)
            conn = manager.connection()
            
            if not conn:
                logger.error(f'❌  Could not establish connection to server {server_id}')
                return

            self.server_connections[server_id] = conn
            logger.info(f'✅ Listening for job_status_update on server {server_id}')

            def listen_for_notifications():
                listen_conn = manager.connection(auto_reconnect=True, did=None)
                if not listen_conn:
                    logger.error(f'⚠️ Could not establish listener connection to server {server_id}')
                    return

                listen_cursor = listen_conn.cursor()
                listen_cursor.execute("LISTEN job_status_update;")
                listen_conn.commit()
                logger.info(f'🔔 Started LISTEN job_status_update on server {server_id}')

                try:
                    while True:
                        listen_conn.poll()
                        for notify in listen_conn.notifies:
                            try:
                                payload = json.loads(notify.payload)
                                room = f'server_{server_id}'
                                logger.info(f'📢 Job {payload.get("job_id")} updated: {payload}')
                                current_app.socketio.emit('job_status_update', payload, room=room, namespace='/browser/job_status_socket')

                            except json.JSONDecodeError:
                                logger.error(f'❌ Invalid JSON payload: {notify.payload}')
                        listen_conn.notifies.clear()
                except Exception as e:
                    logger.error(f'❗ Error in notification listener: {str(e)}')
                finally:
                    listen_cursor.close()
                    listen_conn.close()

            listener_thread = threading.Thread(target=listen_for_notifications, daemon=True)
            listener_thread.start()
            logger.info(f'🟢 Started notification listener thread for server {server_id}')

        except Exception as e:
            logger.error(f'❗ Error setting up PostgreSQL listener: {str(e)}')

    def cleanup_connection(self, server_id):
        if server_id in self.server_connections:
            del self.server_connections[server_id]
            logger.info(f'🧹 Cleaned up connection for server {server_id}')

# Define the namespace class for SocketIO
class JobStatusNamespace(Namespace):
    def __init__(self, namespace, module):
        super(JobStatusNamespace, self).__init__(namespace)
        logger.info(f'🟢 Initialising server for job status updates')

        self.module = module

    def on_connect(self):
        logger.info('🔌 Client connected to job status socket')

    def on_disconnect(self):
        logger.info('❌ Client disconnected from job status socket')

    def on_register_server(self, data):
        server_id = data.get('server_id')
        if not server_id:
            return
        logger.info(f'🟢 Registering server {server_id} for job status updates')

        room = f'server_{server_id}'
        join_room(room)
        if server_id not in self.module.server_connections:
            self.module.setup_pg_listener(server_id)

    def on_unregister_server(self, data):
        server_id = data.get('server_id')
        if not server_id:
            return
        logger.info(f'🔴 Unregistering server {server_id}')
        room = f'server_{server_id}'
        leave_room(room)
        self.module.cleanup_connection(server_id)

def index():
    return ''

# Create the blueprint module
blueprint = JobStatusSocketModule(__name__, static_url_path='/static')

# Register the index route with the blueprint
blueprint.add_url_rule('/', 'index', index)
