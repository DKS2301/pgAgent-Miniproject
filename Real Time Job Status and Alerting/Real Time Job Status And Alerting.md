# Real-Time Job Status & Alerting System for pgAdmin4 + pgAgent

A powerful enhancement for **pgAdmin4** that enables real-time updates for **pgAgent job status** and **email alerting**, powered by **Socket.IO**, **PostgreSQL NOTIFY**, and **custom job subscriptions**.

##  Overview

This module enhances pgAdmin's job management capabilities by:
- Listening to **PostgreSQL NOTIFY events**
- Sending **instant browser updates** using **Socket.IO**
- Dispatching **email alerts** via **libcurl SMTP**
- Letting users **subscribe only to selected jobs** for notifications

---

##  Architecture Overview

> Real Time Job Status Workflow :  
<img src="./images/workflow.png" alt="System Architecture"/>

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

## 🔧 Core Components

### 1. Socket.IO Server (Python)

📄 [`__init__.py`](pgadmin4/web/pgadmin/browser/server_groups/servers/pgagent/__init__.py)

**Key Features:**
- `/pgagent` namespace
- Keeps track of connected clients and active job listeners
- Handles:
  - `connect`, `disconnect`
  - `start_job_status_listener`, `stop_job_status_listener`

```python
@socketio.on('start_job_status_listener', namespace='/pgagent')
def start_job_status_listener(sid, client_sid):
    ...
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(check_notifications(app, sid, client_sid))
```

** Async Notification Polling:**
```python
async def check_notifications(app, sid, client_sid):
    conn = await psycopg.AsyncConnection.connect(...)
    await conn.execute("LISTEN job_status_channel;")
    ...
```

---

### 2.  Frontend Integration (JavaScript)

📄 [`pga_job.js`](pgadmin4/web/pgadmin/browser/server_groups/servers/pgagent/static/js/pga_job.js)
📄 [`pga_job.ui.js`](pgadmin4/web/pgadmin/browser/server_groups/servers/pgagent/static/js/pga_job.ui.js)


**Features:**
- Real-time event updates from server
- Dynamic UI rendering
- Auto-reconnect + keep-alive ping

```javascript
connectJobStatusSocket: function(serverId) {
  this.socket = io("/pgagent");
  this.socket.emit("start_job_status_listener", { sid: serverId });
}
```

```javascript
startKeepAlivePing: function() {
  setInterval(() => {
    this.socket.emit("keep_alive");
  }, 30000);
}
```

---

### 3. 📬 Email Notification Module (C++)

📄 [`notification.cpp`](pgagent/notification.cpp)

**Features:**
- Sends email alerts on job status change
- SMTP config via environment variables
- Batches alerts to avoid spam

```cpp
void SendEmail(const std::string &subject, const std::string &body) {
  curl_easy_setopt(curl, CURLOPT_USERNAME, getenv("SMTP_USER"));
  curl_easy_setopt(curl, CURLOPT_PASSWORD, getenv("SMTP_PASS"));
  ...
}
```

**Buffering:**
```cpp
std::vector<std::string> emailBuffer;
#define MAX_BUFFER_SIZE 250
#define TIME_LIMIT_SEC 120
```

---

### 4. Custom Job Subscription System

📄 [`pga_job.ui.js`](https://github.com/DKS2301/pgAgent-Miniproject/blob/main/Real%20Time%20Job%20Status%20and%20Alerting/pgadmin4/web/pgadmin/browser/server_groups/servers/pgagent/static/js/pga_job.ui.js) + integrated in JS and Python

**Feature:**
Let users select **which jobs** they want to get notifications for.

**Client-side Job Selector (JavaScript):**
```javascript
toggleJobAlertSubscription: function(jobId, isSubscribed) {
  this.socket.emit("update_job_subscription", {
    job_id: jobId,
    subscribe: isSubscribed,
    server_id: currentServerId
  });
}
```

**Server-side Subscription Handling (Python):**
```python
@socketio.on("update_job_subscription", namespace="/pgagent")
def handle_job_subscription(data):
    server_id = data['server_id']
    job_id = data['job_id']
    ...
    if data['subscribe']:
        subscriptions[server_id].add(job_id)
    else:
        subscriptions[server_id].discard(job_id)
```

**C++ Notification Trigger (Only for Subscribed Jobs):**
```cpp
if (isSubscribed(job_id)) {
  NotifyJobStatus(job_id, status);
}
```

---

##  How to Test the Setup

### 1. Prerequisites
- PostgreSQL configured with pgAgent schema
- pgAdmin4 built from this modified version
- Python dependencies: `Flask`, `Flask-SocketIO`, `psycopg[binary]`
- C++ libraries : libcurl

### 2. Set Environment Variables for Email

```bash
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USER="your-email@gmail.com"
export SMTP_PASS="your-password"

```

### 3. Run and Monitor

- Launch pgAdmin and pgAgent
- Select server → Open `pgAgent Jobs`
- Enable subscription for target jobs
- Trigger job execution or failure
- Watch:
  - Real-time UI update
  - Email alert

---

## ✨ Screenshots
### Custom Subscription to Jobs
![Alert Subscription](./images/custom%20subscription.png)

### Socket initialization on server selection
![Socket Init](./images/socket%20initialised%20on%20tree%20selection.png)

### Live Socket.IO messages
![WebSocket messages](./images/Webscocket%20messages.png)

### Real-time UI status change
![Live status](./images/socket%20client%20receiving%20notify%20event.png)

### SMTP Email Dispatch
![Sending mail](./images/pgAgent%20sending%20email.png)

### Alert Email Example
![Mail received](./images/pgagent%20alert%20mail.png)

---

## Demo

https://github.com/user-attachments/assets/8e1b8f3f-a02e-44dc-865c-1b12ed9ec169

---

##  Implementation Details

### Server-Side Thread Management

```python
def start_job_status_listener(app, sid, client_sid):
    ...
    loop.run_until_complete(check_notifications(app, sid, client_sid))
```

### Subscription-Aware C++ Notify

```cpp
if (UserHasSubscribed(job_id)) {
    NotifyJobStatus(job_id, "FAILED");
}
```

---

##  Error Handling Strategy

| Component     | Failure Case                 | Mitigation                |
|---------------|------------------------------|---------------------------|
| SMTP Email    | Auth / Send failure          | Retry + Buffer            |
| Socket.IO     | Drop / Timeout               | Auto reconnect            |
| PostgreSQL    | Notify lost / timeout        | Periodic polling fallback |
| System Load   | Thread starvation / overload | Thread pool + cleanup     |

---

## Security Measures

- Environment variables for SMTP auth
- WebSocket session protection
- Validation of job IDs and server IDs
- Safe SQL and async DB usage
- Thread isolation & logging

---

## 🚀 Future Enhancements

-  Retry failed jobs from UI
-  View job logs directly
-  Dashboard for job trends & failures

---

## 🧪 Testing Matrix

| Type           | Coverage                                 |
|----------------|------------------------------------------|
| Manual         | Full UI + Email trigger flow             |
| Unit Tests     | Socket.IO events, subscription logic     |
| Integration    | PostgreSQL NOTIFY + Socket pipeline      |
| Load Testing   | Email batching + async listener stability|

---

## 📚 Dependencies

| Type     | Packages/Libs                 |
|----------|-------------------------------|
| Backend  | Flask-SocketIO, psycopg, asyncio |
| C++ Core | libcurl, nlohmann/json, Boost |
| Frontend | Socket.IO, jQuery, pgAdmin JS |

---

## ✅ Conclusion

This enhancement introduces **real-time**, **customizable**, and **secure job monitoring** to pgAdmin, empowering users with **proactive alerts** and **live UI feedback** for smoother devops and database workflows.

---

## 📂 Folder Structure

```
Real-Time-Job-Status-and-Alerting/
├── pgagent/                   # C++ source for pgAgent
│   ├── pgAgent.cpp
│   ├── subscription.cpp
├── pgadmin4/web/pgadmin/
│   └── browser/server_groups/servers/pgagent/
│       ├── __init__.py       # Python backend w/ socket server
│       └── static/js/
│           └── pga_job.js    # JS client-side handler
├── images/                   # Screenshots
├── README.md
```

---


Let me know if you'd like this saved as a file or added to your repo directly!