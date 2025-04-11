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

## Enhancements Implemented

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

# Advanced Job Scheduling in pgAgent

## Overview

This project enhances pgAgent's scheduling capabilities by adding support for complex scheduling patterns, particularly focusing on occurrence-based scheduling (e.g., "2nd Saturday of every month"). The modifications span both the frontend (pgAdmin) and backend (pgAgent) components.

## Key Modifications

### 1. Frontend Changes (pgAdmin)

#### UI Enhancements

- Added new occurrence dropdown field in the schedule creation interface
- Implemented in `pga_schedule.ui.js` and `repeat.ui.js`
- Enhanced form validation and data handling for occurrence-based scheduling

#### Constants and Configuration

- Added new constants in `constants.js`:
  ```javascript
  OCCURRENCE = [
    { label: gettext("1st"), value: "1" },
    { label: gettext("2nd"), value: "2" },
    { label: gettext("3rd"), value: "3" },
    { label: gettext("4th"), value: "4" },
    { label: gettext("last"), value: "5" },
  ];
  ```

### 2. Backend Changes (pgAgent)

#### Database Schema Modifications

- Added new column in `pgagent.pga_schedule` table:
  ```sql
  jscoccurrence bool[5] NOT NULL DEFAULT '{f,f,f,f,f}'
  ```
- Updated triggers and functions to handle occurrence-based scheduling

#### Scheduling Logic

- Enhanced `pga_next_schedule` function to handle occurrence-based scheduling
- Added support for:
  - First occurrence of a weekday in a month
  - Second occurrence of a weekday in a month
  - Third occurrence of a weekday in a month
  - Fourth occurrence of a weekday in a month
  - Last occurrence of a weekday in a month

### 3. Template and Macro Changes

- Updated `pga_schedule.macros` to handle occurrence data in SQL operations
- Modified INSERT and UPDATE macros to include occurrence field
- Enhanced property fetching to include occurrence information

## Technical Implementation Details

### 1. Frontend Implementation

- Added new form fields in `pga_schedule.ui.js`:
  ```javascript
  {
    id: 'jscoccurrence',
    label: gettext('Occurrence'),
    type: 'select',
    group: gettext('Days'),
    controlProps: {
      allowClear: true,
      multiple: true,
      allowSelectAll: true,
      placeholder: gettext('Select the occurrence...'),
      formatter: BooleanArrayFormatter
    },
    options: OCCURRENCE
  }
  ```

### 2. Backend Implementation

- Enhanced scheduling logic in `pga_next_schedule` function:
  ```sql
  -- Finding current occurrence
  occurrence := 0;
  curr_date := date_trunc('MONTH', nextrun);
  WHILE curr_date <= nextrun LOOP
    IF date_part('DOW', curr_date) = date_part('DOW', nextrun) THEN
      occurrence := occurrence + 1;
    END IF;
    curr_date := curr_date + INTERVAL '1 Day';
  END LOOP;
  ```

## Usage Examples

### Creating a Schedule for 2nd Saturday of Every Month

1. In pgAdmin, create a new schedule
2. Select "Saturday" in the Week Days section
3. Select "2nd" in the Occurrence dropdown
4. Configure other parameters as needed

### Creating a Schedule for Last Monday of Every Month

1. In pgAdmin, create a new schedule
2. Select "Monday" in the Week Days section
3. Select "last" in the Occurrence dropdown
4. Configure other parameters as needed

## Testing

To verify the implementation:

1. Create schedules with different occurrence patterns
2. Verify the schedules execute on the correct dates
3. Check the job logs for proper execution
4. Validate the UI displays the correct scheduling information

## Known Limitations

- Occurrence-based scheduling is limited to weekdays within a month
- The "last" occurrence option may not work as expected for months with varying numbers of days

## Future Enhancements

- Support for more complex patterns (e.g., "every other 2nd Saturday")
- Enhanced validation for occurrence-based scheduling
- Improved UI feedback for complex scheduling patterns

## License

This enhancement is released under the PostgreSQL License, consistent with the original pgAgent project.

## Acknowledgments

- pgAdmin Development Team for the base implementation
- PostgreSQL Global Development Group for pgAgent
- Contributors to the original scheduling logic

---
