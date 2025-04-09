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

// Struct to hold job notification settings
struct JobNotificationSettings {
    std::string jobId;
    bool enabled;
    bool browser;
    bool email;
    std::string when;       // a=all, s=success, f=failure, b=both
    int minInterval;        // minimum time between notifications in seconds
    std::string emailRecipients;
    std::string customText;
    std::string lastNotification;
};

// Struct to hold failure information
struct FailureInfo {
    std::string jobId;
    std::string timestamp;
    std::string description;
    std::string detailedLog;
    std::string emailRecipients; // Custom email recipients for this job
    std::string customText;      // Custom notification text for this job
};

// Email data structure
struct EmailData {
    std::istringstream* stream;
};

// Main notification functions
void NotifyJobStatus(const std::string& jobId, const std::string& status, const std::string& description);
void CheckPendingEmailNotifications();

// Job notification settings functions
bool GetJobNotificationSettings(const std::string& jobId, JobNotificationSettings& settings);
bool ShouldSendNotification(const JobNotificationSettings& settings, const std::string& status);
void UpdateLastNotificationTime(const std::string& jobId);

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