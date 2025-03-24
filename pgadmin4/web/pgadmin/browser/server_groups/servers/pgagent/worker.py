##########################################################################
#
# pgAdmin 4 - PostgreSQL Tools
#
# Copyright (C) 2013 - 2025, The pgAdmin Development Team
# This software is released under the PostgreSQL Licence
#
##########################################################################

"""
Background worker for processing pgAgent job notifications via Redis queue.
"""

import os
import sys
import logging
import time
import json
import traceback
from datetime import datetime

from redis import Redis
from rq import Worker, Queue, Connection
import psycopg
from psycopg.rows import dict_row

# Import the current app context
from flask import Flask, current_app

# Get the directory of this script
script_dir = os.path.dirname(os.path.realpath(__file__))

# Add the parent directory to the Python path
parent_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(script_dir)))))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Import configuration
from config import REDIS_URL, RQ_REDIS_URL, SERVER_MODE

# Default Redis URL if not specified in config
DEFAULT_REDIS_URL = "redis://localhost:6379/0"
redis_url = RQ_REDIS_URL or REDIS_URL or DEFAULT_REDIS_URL

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('pgagent_worker')

class PgAgentWorker:
    def __init__(self, redis_url=None):
        self.redis_url = redis_url or "redis://localhost:6379/0"
        self.redis_conn = Redis.from_url(self.redis_url)
        self.job_status_queue = Queue('pgagent_notifications', connection=self.redis_conn)
        self.connection_pool = {}
        
    def get_persistent_connection(self, server_id, dsn):
        """Ensure we always have an active connection for a server"""
        if server_id not in self.connection_pool:
            self.connection_pool[server_id] = None
            
        while True:
            try:
                if not self.connection_pool[server_id] or not self.connection_pool[server_id].closed:
                    conn = psycopg.connect(dsn, autocommit=True)
                    self.connection_pool[server_id] = conn
                    logger.info(f"Created new persistent connection for server {server_id}")
                    return conn
                else:
                    logger.info(f"Reconnecting to server {server_id}")
                    conn = psycopg.connect(dsn, autocommit=True)
                    self.connection_pool[server_id] = conn
                    return conn
            except Exception as e:
                logger.error(f"Failed to connect to PostgreSQL server {server_id}: {e}")
                logger.error(traceback.format_exc())
                time.sleep(5)
                
    def listen_for_notifications(self, server_id, dsn):
        """Continuously LISTEN for pgAgent job status updates"""
        conn = self.get_persistent_connection(server_id, dsn)
        cur = conn.cursor(row_factory=dict_row)
        
        try:
            # Start listening to job status updates
            cur.execute("LISTEN job_status_update")
            logger.info(f"Started listening for notifications on server {server_id}")
            
            while True:
                try:
                    conn.poll()  # Process incoming notifications
                    while conn.notifies:
                        notify = conn.notifies.pop(0)
                        logger.info(f"Notification received from server {server_id}: {notify.payload}")
                        
                        # Send notification to Redis queue for processing
                        self.job_status_queue.enqueue(
                            'pgadmin.browser.server_groups.servers.pgagent.worker.process_job_notification',
                            notify.payload
                        )
                except Exception as e:
                    logger.error(f"Connection lost for server {server_id}: {e}")
                    logger.error(traceback.format_exc())
                    conn = self.get_persistent_connection(server_id, dsn)
                    cur = conn.cursor(row_factory=dict_row)
                    cur.execute("LISTEN job_status_update")
                    
        except Exception as e:
            logger.error(f"Error in notification listener for server {server_id}: {e}")
            logger.error(traceback.format_exc())
            
    def process_job_notification(self, payload):
        """Process a job notification from the queue"""
        try:
            data = json.loads(payload)
            logger.info(f"Processing job notification: {data}")
            # Add your notification processing logic here
            return True
        except Exception as e:
            logger.error(f"Error processing job notification: {e}")
            logger.error(traceback.format_exc())
            return False

def start_worker(queues=None, burst=False):
    """Start the pgAgent worker process"""
    try:
        # Initialize worker
        worker = PgAgentWorker()
        
        # Start Redis worker
        with Connection(worker.redis_conn):
            queues = queues or ['pgagent_notifications']
            worker = Worker(queues)
            worker.work(burst=burst)
            
        return 0
    except Exception as e:
        logger.error(f"Error starting worker: {e}")
        logger.error(traceback.format_exc())
        return 1

if __name__ == '__main__':
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler()]
    )
    
    # Start the worker
    sys.exit(start_worker()) 