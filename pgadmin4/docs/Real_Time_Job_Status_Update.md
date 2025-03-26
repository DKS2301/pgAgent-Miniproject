# Real-Time Job Status Update - Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Usage](#usage)
6. [Troubleshooting](#troubleshooting)
7. [Development](#development)

## Overview
The Real-Time Job Status Update feature in pgAdmin 4 provides instant notifications for pgAgent job executions using WebSocket technology. This document provides detailed technical information about the feature's implementation and usage.

### Architecture Diagram
```
[pgAgent Server] <---> [pgAdmin Server] <---> [WebSocket] <---> [pgAdmin Client]
     |                      |                      |                    |
     |                      |                      |                    |
[Job Status]         [Socket.IO Server]    [Real-time Updates]  [Browser Tree]
```

## Implementation Details

### Modified Files
The following files were modified to implement the real-time job status update feature:

1. **Web Client Files**:
   - [pga_job.js](https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/browser/server_groups/servers/pgagent/static/js/pga_job.js)
     - Main implementation file containing:
       - Socket.IO connection management
       - Job status event handling
       - Node refresh mechanism
       - Notification system
     - Key changes:
       - Added WebSocket connection setup
       - Implemented job status listener
       - Added node refresh functionality
       - Enhanced notification system
    
        ### Key Components

        #### 1. Socket Connection Management
        ```javascript
        connectJobStatusSocket: function(serverId) {
            // Socket connection setup with proper error handling
            // Automatic reconnection logic
            // Event handler registration
        }
        ```

        #### 2. Job Status Listener
        ```javascript
        setupJobStatusListener: function() {
            // Listener initialization
            // Browser tree integration
            // Event handling setup
        }
        ```

        #### 3. Node Refresh Mechanism
        ```javascript
        refreshJobNode: async function(serverId, jobId) {
            // Hierarchical node refresh
            // Visual feedback
            // Error handling
        }
        ```

   - [pga_job.ui.js](https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/browser/server_groups/servers/pgagent/static/js/pga_job.ui.js)
     - UI components and event bindings
     - Key changes:
       - Added refresh button to notifications
       - Enhanced visual feedback
       - Improved error handling

2. **Server Files**:
   - [pgagent.py](https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/browser/server_groups/servers/pgagent/pgagent.py)
     - Server-side implementation
     - Key changes:
       - Added WebSocket event handlers
       - Implemented job status monitoring
       - Enhanced error handling

   - [socket_io.py](https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/socket_io.py)
     - Socket.IO server implementation
     - Key changes:
       - Added pgAgent namespace
       - Implemented event routing
       - Added connection management

3. **Configuration Files**:
   - [config.py](https://github.com/pgadmin-org/pgadmin4/blob/master/web/pgadmin/config.py)
     - Configuration settings
     - Key changes:
       - Added WebSocket settings
       - Configured notification options
       - Set up security parameters

### Key Changes in Each File

#### pga_job.js
```javascript
// Added WebSocket connection
connectJobStatusSocket: function(serverId) {
    // Socket connection setup
}

// Added job status listener
setupJobStatusListener: function() {
    // Listener initialization
}

// Enhanced node refresh
refreshJobNode: async function(serverId, jobId) {
    // Node refresh implementation
}
```

#### socket_io.py
```python
# Added pgAgent namespace
@socketio.on('connect', namespace='/pgagent')
def handle_connect():
    # Connection handling

# Added event handlers
@socketio.on('job_status_update', namespace='/pgagent')
def handle_job_status(data):
    # Status update handling
```

#### config.py
```python
# WebSocket configuration
WEBSOCKET_ENABLED = True
WEBSOCKET_PORT = 5050

# Notification settings
NOTIFICATION_DURATION = 5000
NOTIFICATION_POSITION = 'top-right'
```

## System Requirements

### Server Requirements
- PostgreSQL 9.6 or later
- pgAgent extension installed
- pgAdmin 4 server with WebSocket support
- Python 3.6 or later
- Node.js 12 or later (for development)

### Client Requirements
- Modern web browser with WebSocket support
- JavaScript enabled
- Minimum screen resolution: 1024x768

## Installation

### 1. Server Setup
```bash
# Install required Python packages
pip install -r requirements.txt

# Install pgAgent extension
psql -d your_database -c "CREATE EXTENSION pgagent;"
```

### 2. Client Setup
```bash
# Install npm dependencies
npm install

# Build the client
npm run build
```

### 3. Configuration
Edit `config.py` to enable WebSocket support:
```python
WEBSOCKET_ENABLED = True
WEBSOCKET_PORT = 5050
```

## Configuration

### Socket.IO Settings
```javascript
const socketOptions = {
    path: '/socket.io',
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 20000
};
```

### Notification Settings
```javascript
const notificationConfig = {
    duration: 5000,
    position: 'top-right',
    animation: true
};
```

## Usage

### 1. Starting the Server
```bash
# Start pgAdmin server with WebSocket support
python pgadmin4.py
```

### 2. Connecting to a Server
1. Open pgAdmin 4 in your browser
2. Navigate to the pgAgent jobs section
3. The WebSocket connection will be established automatically

### 3. Job Status Updates
- Real-time notifications appear for:
  - Job start
  - Job completion
  - Job failure
  - Job progress updates

### 4. Manual Refresh
- Click the refresh button in notifications
- Use the browser tree context menu
- Press F5 to refresh the entire page

## Troubleshooting

### Common Issues

1. Connection Failures
```javascript
// Check connection status
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
});
```

2. Node Refresh Issues
```javascript
// Verify node existence
const node = tree.findNode('server', serverId);
if (!node) {
    console.error('Node not found');
}
```

3. Notification Problems
```javascript
// Check notification configuration
pgAdmin.Browser.notifier.success(message, {
    buttons: [{
        text: 'Refresh',
        click: () => refreshNode()
    }]
});
```

### Debug Mode
Enable debug logging:
```javascript
DEBUG_MODE = true;
```

## Development

### Adding New Features

1. Socket Events
```javascript
socket.on('new_event', (data) => {
    // Handle new event
});
```

2. Node Refresh
```javascript
refreshNode: async function(nodeId) {
    // Implement refresh logic
}
```

3. Notifications
```javascript
showNotification: function(message, type) {
    // Implement notification logic
}
```

### Testing

1. Unit Tests
```bash
# Run unit tests
npm test
```

2. Integration Tests
```bash
# Run integration tests
npm run test:integration
```

3. Manual Testing
- Test WebSocket connection
- Verify notifications
- Check node refresh
- Test error handling

### Code Style
Follow the project's coding standards:
- Use ES6+ features
- Follow JSDoc documentation
- Maintain consistent indentation
- Use meaningful variable names

## Performance Optimization

### 1. Connection Management
- Implement connection pooling
- Use keep-alive mechanism
- Handle reconnection gracefully

### 2. Node Refresh
- Implement batch updates
- Use debouncing for frequent updates
- Cache node data when appropriate

### 3. Memory Management
- Clean up event listeners
- Remove unused nodes
- Clear notification history

## Security Considerations

### 1. Authentication
- Validate server credentials
- Implement token-based auth
- Secure WebSocket connection

### 2. Data Validation
- Sanitize input data
- Validate job status updates
- Check server permissions

### 3. Error Handling
- Log security events
- Handle authentication failures
- Implement rate limiting

## Contributing

### 1. Code Review Process
1. Fork the repository
2. Create feature branch
3. Submit pull request
4. Address review comments
5. Merge after approval

### 2. Documentation
- Update README.md
- Add inline documentation
- Update API documentation

### 3. Testing
- Add unit tests
- Update integration tests
- Test in multiple browsers

## Support

### Getting Help
- Check documentation
- Search existing issues
- Contact maintainers

### Reporting Issues
1. Check for duplicates
2. Provide detailed information
3. Include steps to reproduce
4. Add relevant logs

## License
This feature is part of pgAdmin 4 and is released under the PostgreSQL License. 