#############################################################
#   WebSocket Backend Routes
#############################################################

import json
import time
import select
from threading import Thread

from flask import current_app, Response
from flask_security import login_required
from pgadmin.utils.ajax import make_json_response, bad_request
from pgadmin.utils.driver import get_driver
from pgadmin.utils.exception import ConnectionLost, SSHTunnelConnectionLost
from pgadmin.model import Server

class PgAgentJobStatusReceiver:
  """
  Class to listen for PostgreSQL NOTIFY events for pgAgent job status updates
  and forward them to the client via WebSocket
  """
  
  def __init__(self, server_id, user_id):
      self.server_id = server_id
      self.user_id = user_id
      self.stopped = False
      self.conn = None
      self.manager = None
      self._thread = None
  
  def start_listening(self, ws):
      """
      Start a thread to listen for notifications
      """
      if self._thread is not None and self._thread.is_alive():
          return
      
      self.stopped = False
      self._thread = Thread(target=self._listener_thread, args=(ws,))
      self._thread.daemon = True
      self._thread.start()
  
  def stop_listening(self):
      """
      Stop the listener thread
      """
      self.stopped = True
      if self.conn:
          self.manager.release(self.conn)
  
  def _listener_thread(self, ws):
      """
      Thread function to listen for PostgreSQL notifications
      """
      try:
          # Get the database connection
          from pgadmin.utils.driver import get_driver
          driver = get_driver(current_app.config['PGADMIN_RUNTIME_USER_MODE'],
                              current_app.config)
          self.manager = driver.connection_manager(self.server_id)
          self.conn = self.manager.connection()
          
          if not self.conn:
              current_app.logger.error(
                  'Could not establish a connection to the database server.')
              return
          
          # Listen for notifications
          cursor = self.conn.cursor()
          cursor.execute("LISTEN job_status_update;")
          self.conn.commit()
          
          current_app.logger.info(
              f"Started listening for PgAgent job status updates on server {self.server_id}")
          
          # Loop until stopped
          while not self.stopped:
              if self.conn.closed:
                  current_app.logger.warning(
                      "Database connection closed, attempting to reconnect...")
                  self.conn = self.manager.connection()
                  if not self.conn:
                      time.sleep(5)
                      continue
                  
                  cursor = self.conn.cursor()
                  cursor.execute("LISTEN job_status_update;")
                  self.conn.commit()
              
              # Check for notifications with a timeout of 1 second
              if select.select([self.conn], [], [], 1) == ([], [], []):
                  continue
              
              self.conn.poll()
              
              # Process notifications
              while self.conn.notifies:
                  notify = self.conn.notifies.pop()
                  payload = json.loads(notify.payload)
                  
                  # Send to WebSocket
                  try:
                      ws.send(json.dumps({
                          'job_id': payload.get('job_id'),
                          'status': payload.get('status'),
                          'timestamp': payload.get('timestamp')
                      }))
                  except Exception as e:
                      current_app.logger.error(
                          f"Error sending notification to WebSocket: {e}")
                      # If we can't send to WebSocket, client probably disconnected
                      self.stopped = True
                      break
          
      except (ConnectionLost, SSHTunnelConnectionLost) as e:
          current_app.logger.error(f"Connection lost: {e}")
      except Exception as e:
          current_app.logger.error(f"Error in notification listener: {e}")
      finally:
          if self.conn and not self.conn.closed:
              self.manager.release(self.conn)
          current_app.logger.info(
              f"Stopped listening for PgAgent job status updates on server {self.server_id}")