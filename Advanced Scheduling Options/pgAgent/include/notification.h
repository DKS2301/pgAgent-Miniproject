//////////////////////////////////////////////////////////////////////////
//
// pgAgent - PostgreSQL Tools
//
// Copyright (C) 2002 - 2024, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
// notification.h - Notification service
//
//////////////////////////////////////////////////////////////////////////

#ifndef NOTIFICATION_H
#define NOTIFICATION_H

#include <string>
#include <vector>
#include <chrono>

// Constants for notification timing
#define TIME_LIMIT_SEC 60  // Maximum time to wait before sending notifications
#define MAX_EMAIL_RETRIES 3

// Struct to hold failure information
struct FailureInfo {
    std::string jobId;
    std::string timestamp;
    std::string description;
    std::string detailedLog;
};

// Email data structure
struct EmailData {
    std::istringstream* stream;
};

// Main notification functions
void NotifyJobStatus(const std::string& jobId, const std::string& status, const std::string& description);
void CheckPendingEmailNotifications();

// Email sending functions
void SendBufferedEmail();
bool SendEmailWithAttachment(const std::string& subject, const std::string& body, const std::string& attachmentPath);

// Helper functions
std::string GetFileTimestamp();
std::string GetCurrentTimestamp();
std::string GenerateLogFile();
std::string GenerateEmailBody(const std::string& logFileName);
std::string CollectDetailedLogs(const std::string& jobId);

#endif // NOTIFICATION_H 