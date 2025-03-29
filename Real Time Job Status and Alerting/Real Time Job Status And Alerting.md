
---

#  Real-Time Job Status Update Implementation in pgAdmin

---

## Overview
This document outlines the **Real-Time Job Status Update System** for pgAdmin using **Socket.IO**, allowing instant notifications for pgAgent job status changes without requiring manual refreshes.


## ✨ Key Components

### 1. Socket.IO Server ([_ _init__.py](https://github.com/DKS2301/pgAgent-Miniproject/blob/e3a9323ba50546158d52f0e63e9162ccc1d4d792/Real%20Time%20Job%20Status%20and%20Alerting/pgadmin4/web/pgadmin/browser/server_groups/servers/pgagent/__init__.py#L49-L607))

#### Features:
- **Namespace:** `/pgagent`
- **Connection Management:** Tracks active listeners per server
- **Event Handlers:**
  - `connect()`
  - `start_job_status_listener()`
  - `stop_job_status_listener()`
  - `disconnect()`
  
#### Highlights:
- ✅ **Asynchronous Notification Listening** using `psycopg`:
    ```python
    async def check_notifications(app, sid, client_sid):
        ...
    ```
- ✅ **Active Listeners Registry**:
    ```python
    active_listeners[sid][request.sid] = { ... }
    ```
- ✅ **Robust Error Handling**:
    - Retries: 3 attempts
    - Retry delay: 5s
    - Full error logging

---

### 2. Client-Side (JavaScript: [pga_job.js](https://github.com/DKS2301/pgAgent-Miniproject/blob/e3a9323ba50546158d52f0e63e9162ccc1d4d792/Real%20Time%20Job%20Status%20and%20Alerting/pgadmin4/web/pgadmin/browser/server_groups/servers/pgagent/static/js/pga_job.js#L144-L702))

#### Features:
- **Real-time UI Integration** via Socket.IO
- **Event Handling**:
  - `connect()`
  - `disconnect()`
  - `job_status_update()`
  - `reconnect()`
  
#### Connection Management:
```javascript
connectJobStatusSocket: function(serverId) { ... }
```

#### Keep-Alive Mechanism:
```javascript
startKeepAlivePing: function() { ... }
```

---

### 3. Job Status Alerting System (C++ Module: [pgAgent.cpp](https://github.com/DKS2301/pgAgent-Miniproject/blob/e3a9323ba50546158d52f0e63e9162ccc1d4d792/Real%20Time%20Job%20Status%20and%20Alerting/pgagent/pgAgent.cpp#L44-L168) , [job.cpp](https://github.com/DKS2301/pgAgent-Miniproject/blob/e3a9323ba50546158d52f0e63e9162ccc1d4d792/Real%20Time%20Job%20Status%20and%20Alerting/pgadmin4/web/pgadmin/browser/server_groups/servers/pgagent/static/js/pga_job.js#L144-L702))

#### Features:
- **Email Notifications** (via libcurl)
- **Buffer-Based Email Batching**
- **PostgreSQL NOTIFY Event Trigger**

#### Notification Example:
```cpp
void NotifyJobStatus(...);
```

#### Email Buffer Example:
```cpp
#define MAX_BUFFER_SIZE 250
#define TIME_LIMIT_SEC 120
std::vector<std::string> emailBuffer;
```

#### SMTP Email Example:
```cpp
void SendEmail(const std::string &subject, const std::string &body) { ... }
```

---

## Workflow
> Real Time Job Status Workflow :  
<img src="./images/workflow.png" alt="System Architecture"/>
---

### Workflow Steps:
1. **Connection Initialization**
   - pgAdmin client initiates Socket.IO connection
   - Registers for job status monitoring
2. **Real-Time Listening**
   - Background thread subscribes via `LISTEN`
   - PostgreSQL sends notifications
3. **Client Updates**
   - Receives status change
   - Updates UI dynamically
4. **Connection Management**
   - Keep-alive pings every 30s
   - Auto-reconnect support

---

## ✨ Previews

### Socket initialisation on tree selection
![socket init](./images/socket%20initialised%20on%20tree%20selection.png)

### Socket messages 
![socket messages](./images/Webscocket%20messages.png)


### Real-time status change without manual refresh
![Socket receives job Satus updates](./images/socket%20client%20receiving%20notify%20event.png)


### pgAgent sends mail via SMTP
![pgagent sends mail](./images/pgAgent%20sending%20email.png)

### Example of an email notification received on failure
![alert mail example](./images/pgagent%20alert%20mail.png)

### Working Demo

https://github.com/user-attachments/assets/8e1b8f3f-a02e-44dc-865c-1b12ed9ec169


---

## Implementation Details

### Server-Side Background Thread:
```python
def start_job_status_listener(app, sid, client_sid):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(check_notifications(app, sid, client_sid))
    finally:
        loop.close()
```

### Client-Side Setup:
```javascript
setupJobStatusListener: function() {
    if (this._listenerInitialized) return;
    ...
}
```

---

## 💡 Error Handling Overview

| Component | Common Errors | Mitigation |
|-----------|---------------|------------|
| SMTP | Connection / Auth Failures | Retry + Logging |
| PostgreSQL | Connection / Query Errors | Retry + Connection Pooling |
| Socket.IO | Disconnect / Timeout | Auto-reconnect |
| System | Thread / Resource Issues | Cleanup + Monitoring |

---

## 🔐 Security Measures

1. **Email Security**: TLS, credentials protection, rate limiting
2. **Database Security**: Input validation, safe SQL execution
3. **WebSocket Security**: Secure sessions, authentication
4. **System Security**: File permission hardening, thread isolation

---

## 🚦 Performance Optimizations

- Email batching (max 250 / 120 seconds)
- Efficient async listener with pooled connections
- Clean resource handling (connections, memory, threads)

---

## ✅ Usage

1. Select the target server
2. Navigate to **pgAgent Jobs** in pgAdmin
3. **Job Status Monitoring** auto-starts
4. Status updates appear without page reload

---

## 🧪 Testing Strategy

| Type | Focus |
|------|-------|
| Manual | End-to-end with actual pgAgent jobs |
| Unit | Socket.IO events, Email batching logic |
| Integration | PostgreSQL Notifications + Background Threads |
| Automated | UI auto-update + server event handling |

---

## 💼 Future Enhancements

- Batch notifications
- Customizable alert filters
- Historical status view
- Enhanced UI with failure insights

---

## 📦 Dependencies

- **Backend**: Flask-SocketIO, psycopg (async), libcurl, nlohmann/json, Boost
- **Frontend**: Socket.IO, pgAdmin Core

---

## ✅ Conclusion
This implementation significantly enhances **pgAdmin** by providing **real-time**, **scalable**, and **secure** job status updates with seamless UI integration and reliable alerting capabilities.

---
