
# pgAgent-Miniproject Enhancement
### In collaboration with IITM Pravartak Technologies

---
## Overview
This project focuses on enhancing **pgAgent** with **Advanced Scheduling Options**, **Real-Time Job Status Updates**, and **Alerting Mechanisms**. The modifications are built on top of **pgAdmin's official pgAgent** to provide better control, monitoring, and automation of jobs. 

For general setup instructions, **refer to the official [pgAdmin4 README](https://github.com/pgadmin-org/pgadmin4/blob/master/README.md)**.
For Windows-specific instructions, **refer to the official [pgAdmin4 README](https://github.com/pgadmin-org/pgadmin4/blob/master/pkg/win32/README.md)**.

---

## Cloning and Setting Up the Project

### **1️⃣ Clone Repositories**
Clone **pgAgent-Miniproject** and **pgAdmin** locally:

```
git clone https://github.com/DKS2301/pgAgent-Miniproject.git
git clone https://github.com/pgadmin-org/pgadmin4.git
```

Place both repositories in your project folder.

---

### **2️⃣ Install Dependencies**
Ensure you have the following installed:
- **PostgreSQL**
- **pgAdmin4**
- **CMake**
- **Visual Studio (for building pgAgent on Windows)**
- **Git**
- **Python (for pgAdmin UI changes, if needed)**

---

### **3️⃣ Build and Install pgAgent**
1. **Navigate to the pgAgent directory:**
   ```
   cd pgAgent
   ```

2. **Create a build directory:**
   ```
   mkdir build
   cd build
   ```

3. **Generate the build files using CMake:**
   ```
   cmake ..
   ```

4. **Compile pgAgent:**
   ```
   cmake --build . --config Debug
   ```

5. **Ensure `pgagent.exe` is successfully created.**

---

### **4️⃣ Configure pgAgent with PostgreSQL**
1. Open **pgAdmin**.
2. Run `pgagent.sql` to create necessary tables:
   ```
   \i your_actual_path_for_project_folder\pgagent\pgagent.sql
   ```

---

### **5️⃣ Running pgAgent**
Start pgAgent using PowerShell:

```
.\pgagent.exe DEBUG -l 2 -t 60 "host=localhost dbname=postgres user=postgres password=yourpassword application_name=pgAgent"
```

Ensure pgAgent is running and visible in:

```
SELECT * FROM pg_stat_activity WHERE application_name = 'pgAgent';
```

---

##  Enhancements Implemented

### ✅ **Advanced Scheduling Options** (Completed)  
- Customizable complex scheduling options like evry third Mons=day and so on.
- Flexible scheduling to meet diverse user needs.

### ✅ **Real-Time Job Status Updates** (Completed)  
- Real-time updates for job status changes (Running, Completed, Failed).
- Integrated with the UI for seamless monitoring.

### ✅ **Alerting Mechanism** (Completed)  
- Email and webhook notifications for job completion, failure, and status changes.
- Configurable alert options within pgAdmin.

For detailed information on enhancements, refer to the following:
- [**Advanced Scheduling Options**](https://github.com/DKS2301/pgAgent-Miniproject/blob/main/Advanced%20Scheduling%20Options/README.md)
- [**Real-Time Job Status**](https://github.com/DKS2301/pgAgent-Miniproject/blob/main/Real%20Time%20Job%20Status%20and%20Alerting/Real%20Time%20Job%20Status%20And%20Alerting.md)

- [**Documentation**](https://github.com/DKS2301/pgAgent-Miniproject/tree/main/Documentation)

---

## 📊 Features Overview
- **Real-Time Job Status**  
  View the status of jobs in real-time, directly from pgAdmin without need for manula refresh and live notifications of job statuses.
  
- **Advanced Scheduling Options**  
  Set up support for advanced Scheduling options like every first monday and so on .

- **Alerting System**  
  Receive notifications for job status changes, failures, and completions. Alerts can be configured to send via email or external webhook integrations.

- **UI Integration**  
  Automatic UI updates when job status changes, allowing users to view updated job statuses without needing to refresh the interface.

---

## 🛠️ Future Enhancements
- **Advanced Reporting**: Generate detailed reports on job history, failures, and performance.
- **User Role Management**: Provide access control for different user roles within the pgAdmin interface for managing jobs and alerts.
- **External Service Integration**: Integrate with more alerting and monitoring services like Slack, Telegram, and others.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments
- **pgAdmin Team** for their development of pgAdmin, which serves as the foundation for this project.
- **pgAgent Developers** for their work on pgAgent, allowing the addition of custom enhancements.
- **IITM Pravartak Technologies** for providing an opportunity for working on this project and their valuable guidance.

---

📌 **Need More Help?**  
For detailed instructions and issues, feel free to check out the official [pgAdmin4 GitHub repository](https://github.com/pgadmin-org/pgadmin4). 

---
