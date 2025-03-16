# pgAgent-Miniproject
enhancing features of pgAgent in collaboration with IITM Pravartak Technologies

### SMTP-Based Alerting for pgAgent
This feature enables email notifications for job failures in pgAgent using an SMTP server. When a scheduled job fails, an alert is sent to the configured email address with details of the failure.

Features
- Automatic email alerts on job failures
- Configurable SMTP server settings
- Supports authentication & SSL/TLS
- Logs email delivery status for debugging and audit.

#### Marked By
- pgAgent.cpp: [SMTP Alerting](https://github.com/DKS2301/pgAgent-Miniproject/blob/8ac251c1708fb8f044041f05536009e4e5655a4b/pgagent/pgAgent.cpp#L44-L169) ,[Sending notifies](https://github.com/DKS2301/pgAgent-Miniproject/blob/8ac251c1708fb8f044041f05536009e4e5655a4b/pgagent/pgAgent.cpp#L213-L222)
- job.cpp : [Notification Service](https://github.com/DKS2301/pgAgent-Miniproject/blob/8ac251c1708fb8f044041f05536009e4e5655a4b/pgagent/job.cpp#L24-L56)
- connection.cpp : [Polling Service](https://github.com/DKS2301/pgAgent-Miniproject/blob/8ac251c1708fb8f044041f05536009e4e5655a4b/pgagent/connection.cpp#L24-L66)

![pgAgent receives notifications for job failures and sends mail](https://github.com/user-attachments/assets/e97467ab-6137-4b6e-86c9-dca9efcce432)

![pagagent Alert mail for failed jobs with timestamp and reason](https://github.com/user-attachments/assets/7b369916-428f-4018-aaa9-8b0d2e82733c)
)
