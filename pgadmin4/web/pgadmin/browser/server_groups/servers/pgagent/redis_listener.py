##########################################################################
#
# pgAdmin 4 - PostgreSQL Tools
#
# Copyright (C) 2013 - 2025, The pgAdmin Development Team
# This software is released under the PostgreSQL Licence
#
##########################################################################

"""
Redis listener module for pgAgent job status notifications
"""
import json
import logging
import threading
import time
from datetime import datetime
from flask import current_app
from pgadmin.utils.exception import CryptKeyMissing
from pgadmin import socketio
import traceback

# Configure logging
logger = logging.getLogger(__name__)

# Redis process threads
redis_process_threads = {}

def process_notification(redis_client, sid, client_sid, user):
    """
    Process a single notification from Redis queue
    """
    try:
        # Get notification from Redis queue with a timeout
        data = redis_client.blpop('pgagent:job_updates', timeout=1)
        if data:
            update = json.loads(data[1])
            logger.debug('[Redis pgAgent] Processing job update: %s', update)
            
            # Create a request context with the proper user
            with current_app.test_request_context() as ctx:
                # Set up the user context
                ctx.user = user
                
                # Emit socket event
                socketio.emit('job_status_update', {
                    'sid': update['server_id'],
                    'job_id': update['job_id'],
                    'status': update['status'],
                    'timestamp': update['timestamp'],
                    'data': update['payload']
                }, namespace='/pgagent', to=client_sid)
                
                logger.info('[Redis pgAgent] Successfully emitted job status update for job %s', update['job_id'])
                return True
        return False
    except Exception as e:
        logger.error('[Redis pgAgent] Error processing notification: %s', str(e))
        logger.debug('[Redis pgAgent] Exception details: %s', traceback.format_exc())
        return False

def redis_process_thread(app, sid, client_sid, redis_client):
    """
    Redis process thread that handles notifications
    """
    with app.app_context():
        try:
            # Get the user from active_listeners
            from . import active_listeners
            user = active_listeners[sid][client_sid].get('user')
            if not user:
                logger.error('[Redis pgAgent] No user found in active listeners')
                return
            
            notification_count = 0
            reconnect_attempts = 0
            max_reconnect_attempts = 5
            base_sleep_time = 1.0
            
            logger.info('[Redis pgAgent] Starting notification processing for server %s, client %s', sid, client_sid)
            
            while sid in active_listeners and client_sid in active_listeners[sid] and \
                  socketio.server.manager.is_connected(client_sid, namespace='/pgagent'):
                try:
                    # Calculate sleep time based on reconnection attempts (exponential backoff)
                    sleep_time = min(base_sleep_time * (2 ** reconnect_attempts), 30)
                    
                    # Check if we've exceeded max reconnection attempts
                    if reconnect_attempts >= max_reconnect_attempts:
                        logger.error('[Redis pgAgent] Exceeded maximum reconnection attempts. Terminating listener.')
                        break
                    
                    # Process notifications
                    if process_notification(redis_client, sid, client_sid, user):
                        notification_count += 1
                        reconnect_attempts = 0  # Reset on successful processing
                        logger.debug('[Redis pgAgent] Successfully processed notification %d', notification_count)
                    else:
                        reconnect_attempts += 1
                        logger.debug('[Redis pgAgent] No notifications found, attempt %d/%d', 
                                   reconnect_attempts, max_reconnect_attempts)
                    
                    # Sleep to avoid high CPU usage
                    time.sleep(sleep_time)
                    
                except Exception as e:
                    logger.error('[Redis pgAgent] Error in notification loop: %s', str(e))
                    logger.debug('[Redis pgAgent] Exception details: %s', traceback.format_exc())
                    break
            
            logger.info('[Redis pgAgent] Listener ended. Total notifications: %d', notification_count)
            
        except CryptKeyMissing as e:
            logger.error('[Redis pgAgent] Crypto key missing: %s', str(e))
        except Exception as e:
            logger.error('[Redis pgAgent] Unexpected error: %s', str(e))
            logger.debug('[Redis pgAgent] Exception details: %s', traceback.format_exc())

def start_redis_process(app, sid, client_sid, redis_client):
    """
    Start a Redis process thread for handling notifications
    """
    # Create a unique key for this process
    process_key = f"{sid}_{client_sid}"
    
    # Stop existing process if any
    if process_key in redis_process_threads:
        stop_redis_process(sid, client_sid)
    
    # Create and start new process thread
    thread = threading.Thread(
        target=redis_process_thread,
        args=(app, sid, client_sid, redis_client),
        daemon=True
    )
    thread.start()
    
    # Store the thread
    redis_process_threads[process_key] = thread
    logger.info('[Redis pgAgent] Started Redis process thread for server %s, client %s', sid, client_sid)

def stop_redis_process(sid, client_sid):
    """
    Stop a Redis process thread
    """
    process_key = f"{sid}_{client_sid}"
    if process_key in redis_process_threads:
        thread = redis_process_threads[process_key]
        if thread.is_alive():
            thread.join(timeout=1.0)  # Wait up to 1 second for thread to finish
        del redis_process_threads[process_key]
        logger.info('[Redis pgAgent] Stopped Redis process thread for server %s, client %s', sid, client_sid)

def init_redis_listener(app, socket_io):
    """
    Initialize the Redis listener
    """
    try:
        # Get Redis configuration from Flask app config
        REDIS_URL = app.config.get('REDIS_URL', None) or \
                    app.config.get('RQ_REDIS_URL', None) or \
                    "redis://localhost:6379/0"
        
        # Initialize Redis connection
        redis_client = redis.Redis.from_url(REDIS_URL)
        redis_client.ping()
        
        app.logger.info(f"Redis connection established for pgAgent notifications: {REDIS_URL}")
        return True
    except Exception as e:
        app.logger.error(f"Failed to initialize Redis for pgAgent notifications: {str(e)}")
        app.logger.debug(traceback.format_exc())
        return False 