//////////////////////////////////////////////////////////////////////////
//
// pgAgent - PostgreSQL Tools
//
// Copyright (C) 2002 - 2024, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
// notification.cpp - Notification service
//
//////////////////////////////////////////////////////////////////////////

#include "pgAgent.h"
#include "notification.h"
#include <curl/curl.h>
#include <fstream>
#include <sstream>
#include <iostream>
#include <iomanip>

#if !BOOST_OS_WINDOWS
#include <errno.h>
#include <sys/wait.h>
#include <sys/stat.h>
#endif

// Global variables for notification system
std::vector<FailureInfo> failureBuffer;
std::chrono::steady_clock::time_point firstFailureTime;
bool timerStarted = false;

// Track last check time to avoid too frequent checks
static std::chrono::steady_clock::time_point lastCheckTime = std::chrono::steady_clock::now();
static const int MIN_CHECK_INTERVAL_SEC = 5; // Minimum time between checks

// Create a timestamp string in the format YYYY-MM-DD_HH-MM-SS
std::string GetFileTimestamp() {
    auto now = std::chrono::system_clock::now();
    std::time_t now_c = std::chrono::system_clock::to_time_t(now);
    
    char buffer[20];
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%d_%H-%M-%S", std::localtime(&now_c));
    
    return std::string(buffer);
}

// Get formatted timestamp for logs
std::string GetCurrentTimestamp() {
    auto now = std::chrono::system_clock::now();
    std::time_t now_c = std::chrono::system_clock::to_time_t(now);
    
    char buffer[25];
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", std::localtime(&now_c));

    return std::string(buffer);
}

// CURL read callback
size_t read_callback(char* buffer, size_t size, size_t nitems, void* userdata) {
    EmailData* emailData = static_cast<EmailData*>(userdata);
    return emailData->stream->readsome(buffer, size * nitems);
}

// Generate detailed log file for the current batch of failures
std::string GenerateLogFile() {
    std::string logFileName = "job_failures_" + GetFileTimestamp() + ".log";
    std::ofstream logFile(logFileName);
    
    if (!logFile.is_open()) {
        LogMessage("Failed to create log file: " + logFileName, LOG_ERROR);
        return "";
    }
    
    // Log file header
    logFile << "##############################################################\n";
    logFile << "#                    JOB FAILURE REPORT                      #\n";
    logFile << "##############################################################\n\n";
    
    logFile << "Generated at: " << GetCurrentTimestamp() << "\n";
    logFile << "Total Failures: " << failureBuffer.size() << "\n\n";
    
    // System information section
    logFile << "==============================================================\n";
    logFile << "                     SYSTEM INFORMATION                        \n";
    logFile << "==============================================================\n";
    
    #if !BOOST_OS_WINDOWS
    // Get memory usage on Linux/Unix
    std::ifstream meminfo("/proc/meminfo");
    if (meminfo.is_open()) {
        std::string line;
        while (std::getline(meminfo, line)) {
            if (line.find("MemTotal") != std::string::npos || 
                line.find("MemFree") != std::string::npos || 
                line.find("MemAvailable") != std::string::npos) {
                logFile << line << "\n";
            }
        }
        meminfo.close();
    }
    
    // Get CPU load
    std::ifstream loadavg("/proc/loadavg");
    if (loadavg.is_open()) {
        std::string load;
        std::getline(loadavg, load);
        logFile << "Load Average: " << load << "\n";
        loadavg.close();
    }
    #endif
    
    logFile << "\n";
    
    // Individual job failure details
    for (const auto& failure : failureBuffer) {
        logFile << "==============================================================\n";
        logFile << "                     JOB FAILURE DETAILS                       \n";
        logFile << "==============================================================\n";
        logFile << "Job ID: " << failure.jobId << "\n";
        logFile << "Timestamp: " << failure.timestamp << "\n";
        logFile << "Description: " << failure.description << "\n\n";
        
        logFile << "---------------------- DETAILED LOG --------------------------\n\n";
        logFile << failure.detailedLog << "\n\n";
    }
    
    logFile.close();
    LogMessage("🔍Created detailed log file: " + logFileName, LOG_INFO);
    return logFileName;
}

// Send email with attachment
bool SendEmailWithAttachment(const std::string& subject, const std::string& body, const std::string& attachmentPath) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        LogMessage("Failed to initialize CURL!", LOG_ERROR);
        return false;
    }

    const char* fromEnv = std::getenv("MY_MAIL");
    const char* passEnv = std::getenv("MAIL_PASS");
    
    // First check if we have custom recipients set in TEMP_REC_MAIL
    const char* tempRecEnv = std::getenv("TEMP_REC_MAIL");
    // If not, fall back to default REC_MAIL
    const char* toEnv = tempRecEnv ? tempRecEnv : std::getenv("REC_MAIL");

    if (!fromEnv || !toEnv || !passEnv) {
        LogMessage("Error: Email environment variables are not set!", LOG_ERROR);
        curl_easy_cleanup(curl);
        return false;
    }

    std::string from = fromEnv;
    std::string to = toEnv;
    std::string pass = passEnv;
    
    // Log which recipient list we're using
    if (tempRecEnv) {
        LogMessage("🔍Using custom recipients from TEMP_REC_MAIL: " + std::string(tempRecEnv), LOG_DEBUG);
    } else {
        LogMessage("🔍Using default recipients from REC_MAIL: " + std::string(toEnv), LOG_DEBUG);
    }

    // Parse multiple recipients if comma-separated
    std::vector<std::string> recipients;
    std::string recipientStr = to;
    size_t pos = 0;
    std::string token;
    
    while ((pos = recipientStr.find(",")) != std::string::npos) {
        token = recipientStr.substr(0, pos);
        // Trim whitespace
        token.erase(0, token.find_first_not_of(" \t"));
        token.erase(token.find_last_not_of(" \t") + 1);
        if (!token.empty()) {
            recipients.push_back(token);
        }
        recipientStr.erase(0, pos + 1);
    }
    
    // Add the last recipient
    recipientStr.erase(0, recipientStr.find_first_not_of(" \t"));
    recipientStr.erase(recipientStr.find_last_not_of(" \t") + 1);
    if (!recipientStr.empty()) {
        recipients.push_back(recipientStr);
    }
    
    // Add all recipients to the curl recipient list
    struct curl_slist* recipientsList = nullptr;
    for (const auto& recipient : recipients) {
        recipientsList = curl_slist_append(recipientsList, recipient.c_str());
    }

    // Prepare email content with MIME parts for HTML and attachment
    std::ostringstream emailContent;
    std::string boundary = "------------EmailBoundary";
    
    emailContent << "From: " << from << "\r\n"
                 << "To: " << to << "\r\n"
                 << "Subject: " << subject << "\r\n"
                 << "MIME-Version: 1.0\r\n";
    
    // Always use multipart for HTML emails with or without attachments
    emailContent << "Content-Type: multipart/mixed; boundary=" << boundary << "\r\n\r\n";
    
    // HTML part
    emailContent << "--" << boundary << "\r\n"
                 << "Content-Type: text/html; charset=UTF-8\r\n\r\n"
                 << body << "\r\n\r\n";
    
    // If we have an attachment
    if (!attachmentPath.empty() && std::ifstream(attachmentPath).good()) {
        LogMessage("🔍Sending HTML email with attachment...", LOG_DEBUG);
        
        emailContent << "--" << boundary << "\r\n"
                     << "Content-Type: text/plain; name=\"" << attachmentPath << "\"\r\n"
                     << "Content-Disposition: attachment; filename=\"" << attachmentPath << "\"\r\n\r\n";
        
        // Read the attachment file
        std::ifstream attachmentFile(attachmentPath, std::ios::binary);
        if (attachmentFile) {
            emailContent << attachmentFile.rdbuf() << "\r\n\r\n";
            attachmentFile.close();
        }
    } else {
        LogMessage("🔍Sending HTML email without attachment...", LOG_DEBUG);
    }
    
    // Close boundary
    emailContent << "--" << boundary << "--\r\n";

    std::istringstream emailStream(emailContent.str());
    EmailData emailData = {&emailStream};

    curl_easy_setopt(curl, CURLOPT_USERNAME, from.c_str());
    curl_easy_setopt(curl, CURLOPT_PASSWORD, pass.c_str());
    curl_easy_setopt(curl, CURLOPT_URL, "smtp://smtp.gmail.com:587");
    curl_easy_setopt(curl, CURLOPT_USE_SSL, CURLUSESSL_ALL);
    curl_easy_setopt(curl, CURLOPT_MAIL_FROM, from.c_str());
    curl_easy_setopt(curl, CURLOPT_MAIL_RCPT, recipientsList);
    curl_easy_setopt(curl, CURLOPT_READFUNCTION, read_callback);
    curl_easy_setopt(curl, CURLOPT_READDATA, &emailData);
    curl_easy_setopt(curl, CURLOPT_UPLOAD, 1L);
    curl_easy_setopt(curl, CURLOPT_VERBOSE, 0L); // Set to 1L for debugging

    CURLcode res = curl_easy_perform(curl);
    bool success = (res == CURLE_OK);

    LogMessage(success ? "🔍HTML email sent successfully!" : "🔍HTML email sending failed", 
               success ? LOG_INFO : LOG_INFO);

    curl_slist_free_all(recipientsList);
    curl_easy_cleanup(curl);
    
    return success;
}

std::string GenerateEmailBody(const std::string& logFileName) {
    if (failureBuffer.empty()) return "";
    
    std::ostringstream emailBody;
    
    // Start HTML document with styling
    emailBody << "<!DOCTYPE html>\n"
              << "<html>\n"
              << "<head>\n"
              << "<style>\n"
              << "  body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }\n"
              << "  .container { max-width: 800px; margin: 0 auto; padding: 20px; }\n"
              << "  .header { background-color: #0056b3; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }\n"
              << "  .content { padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }\n"
              << "  .summary { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }\n"
              << "  table { border-collapse: collapse; width: 100%; margin: 20px 0; }\n"
              << "  th, td { text-align: left; padding: 12px; }\n"
              << "  th { background-color: #0056b3; color: white; }\n"
              << "  tr:nth-child(even) { background-color: #f2f2f2; }\n"
              << "  tr:hover { background-color: #e9ecef; }\n"
              << "  .note-box { background-color: #f8f9fa; border-left: 4px solid #0056b3; padding: 15px; margin: 20px 0; }\n"
              << "  .footer { font-size: 12px; color: #666; margin-top: 30px; text-align: center; }\n"
              << "  .status-badge { display: inline-block; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; }\n"
              << "  .failure { background-color: #ffebee; color: #c62828; }\n"
              << "  .action-button { display: inline-block; background-color: #0056b3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; margin: 20px 0; }\n"
              << "  .action-button:hover { background-color: #003d82; }\n"
              << "  .attachment-box { background-color: #e8f4ff; border: 1px solid #b3d7ff; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center; }\n"
              << "  .custom-message { background-color: #f0f4f8; border: 1px dashed #ccc; padding: 15px; margin: 20px 0; border-radius: 5px; }\n"
              << "</style>\n"
              << "</head>\n"
              << "<body>\n"
              << "<div class='container'>\n";
    
    // Header section
    emailBody << "  <div class='header'>\n"
              << "    <h1>Job Failure Notification</h1>\n"
              << "  </div>\n"
              << "  <div class='content'>\n";
    
    // Summary information
    emailBody << "    <div class='summary'>\n"
              << "      <h2>Notification Summary</h2>\n"
              << "      <p><strong>Time of Report:</strong> " << GetCurrentTimestamp() << "</p>\n"
              << "      <p><strong>Number of Failed Jobs:</strong> <span class='status-badge failure'>" 
              << failureBuffer.size() << "</span></p>\n"
              << "    </div>\n";
    
    // Table of failed jobs
    emailBody << "    <h2>Failed Jobs Summary</h2>\n"
              << "    <table>\n"
              << "      <thead>\n"
              << "        <tr>\n"
              << "          <th>Job ID</th>\n"
              << "          <th>Timestamp</th>\n"
              << "          <th>Description</th>\n"
              << "          <th>Actions</th>\n"
              << "        </tr>\n"
              << "      </thead>\n"
              << "      <tbody>\n";
    
    // List all failures in table rows
    for (const auto& failure : failureBuffer) {
        // Truncate description if too long
        std::string truncDesc = failure.description;
        if (truncDesc.length() > 50) {
            truncDesc = truncDesc.substr(0, 47) + "...";
        }
        
        // HTML escape the description to prevent breaking HTML
        std::string escapedDesc = truncDesc;
        // Replace < with &lt; and > with &gt;
        size_t pos = 0;
        while ((pos = escapedDesc.find("<", pos)) != std::string::npos) {
            escapedDesc.replace(pos, 1, "&lt;");
            pos += 4;
        }
        pos = 0;
        while ((pos = escapedDesc.find(">", pos)) != std::string::npos) {
            escapedDesc.replace(pos, 1, "&gt;");
            pos += 4;
        }
        
        emailBody << "        <tr>\n"
                  << "          <td><strong>" << failure.jobId << "</strong></td>\n"
                  << "          <td>" << failure.timestamp << "</td>\n"
                  << "          <td>" << escapedDesc << "</td>\n"
                  << "          <td><a href='http://monitoring.example.com/job/" << failure.jobId 
                  << "' style='color: #0056b3; text-decoration: underline;'>View Details</a></td>\n"
                  << "        </tr>\n";
    }
    
    emailBody << "      </tbody>\n"
              << "    </table>\n";
    
    // Add custom text for each job if available
    bool hasCustomMessages = false;
    for (const auto& failure : failureBuffer) {
        if (!failure.customText.empty()) {
            if (!hasCustomMessages) {
                emailBody << "    <h2>Job-Specific Messages</h2>\n";
                hasCustomMessages = true;
            }
            
            // HTML escape custom text
            std::string escapedText = failure.customText;
            size_t pos = 0;
            while ((pos = escapedText.find("<", pos)) != std::string::npos) {
                escapedText.replace(pos, 1, "&lt;");
                pos += 4;
            }
            pos = 0;
            while ((pos = escapedText.find(">", pos)) != std::string::npos) {
                escapedText.replace(pos, 1, "&gt;");
                pos += 4;
            }
            
            // Replace newlines with <br>
            pos = 0;
            while ((pos = escapedText.find("\n", pos)) != std::string::npos) {
                escapedText.replace(pos, 1, "<br>");
                pos += 4;
            }
            
            emailBody << "    <div class='custom-message'>\n"
                      << "      <h3>Job " << failure.jobId << " Message:</h3>\n"
                      << "      <p>" << escapedText << "</p>\n"
                      << "    </div>\n";
        }
    }
			  
	emailBody << "    <div class='attachment-box'>\n"
              << "      <h3>Detailed Log Report</h3>\n"
              << "      <p>The detailed log file <strong>" << (logFileName.empty() ? "job_failures_report.log" : logFileName) << "</strong> is attached to this email.</p>\n"
              << "    </div>\n";
    // Additional information box
    emailBody << "    <div class='note-box'>\n"
              << "      <h3>Important Notes</h3>\n"
              << "      <ul>\n"
              << "        <li><strong>Attachment Instructions:</strong> Open the attached log file for detailed error information.</li>\n"
              << "        <li><strong>Contact:</strong> Reach out to the system administrator at <a href='mailto:sysadmin@example.com' style='color: #0056b3;'>sysadmin@example.com</a> if failures persist.</li>\n"
              << "      </ul>\n"
              << "    </div>\n";
    
    // Footer
    emailBody << "    <div class='footer'>\n"
              << "      <p>This is an automated message. Please do not reply directly to this email.</p>\n"
              << "      <p>Generated by Job Notification System on " << GetCurrentTimestamp() << "</p>\n"
              << "    </div>\n"
              << "  </div>\n"
              << "</div>\n"
              << "</body>\n"
              << "</html>";
    
    return emailBody.str();
}

// Send buffered emails with retry mechanism
void SendBufferedEmail() {
    if (failureBuffer.empty()) return;

    // Generate detailed log file
    std::string logFilePath = GenerateLogFile();
    
    // Extract just the filename portion for the email
    std::string logFileName = logFilePath;
    size_t lastSlash = logFilePath.find_last_of("/\\");
    if (lastSlash != std::string::npos) {
        logFileName = logFilePath.substr(lastSlash + 1);
    }
    
    // Generate formatted email body with log filename
    std::string emailBody = GenerateEmailBody(logFileName);
    
    // Create appropriate subject line
    std::string subject = failureBuffer.size() == 1 
        ? "ALERT: Job Failure Detected" 
        : "ALERT: Multiple Job Failures (" + std::to_string(failureBuffer.size()) + ")";
    
    // Get custom email recipients if available (from first job that has them)
    std::string customRecipients;
    for (const auto& failure : failureBuffer) {
        if (!failure.emailRecipients.empty()) {
            customRecipients = failure.emailRecipients;
            LogMessage("🔍Using custom email recipients from job " + failure.jobId + ": " + customRecipients, LOG_DEBUG);
            break;
        }
    }
    
    // Try to send the email with the log file attached
    bool emailSent = false;
    
    // If we have custom recipients, use them instead of default ones
    if (!customRecipients.empty()) {
        const char* fromEnv = std::getenv("MY_MAIL");
        const char* passEnv = std::getenv("MAIL_PASS");
        
        if (fromEnv && passEnv) {
            // Use custom environment variables for testing
            setenv("TEMP_REC_MAIL", customRecipients.c_str(), 1);
            emailSent = SendEmailWithAttachment(subject, emailBody, logFilePath);
            // Restore original REC_MAIL (or unset TEMP_REC_MAIL)
            unsetenv("TEMP_REC_MAIL");
        } else {
            LogMessage("🔍Email environment variables (MY_MAIL, MAIL_PASS) not set, can't use custom recipients", LOG_WARNING);
            emailSent = SendEmailWithAttachment(subject, emailBody, logFilePath);
        }
    } else {
        emailSent = SendEmailWithAttachment(subject, emailBody, logFilePath);
    }
    
    if (!emailSent) {
        LogMessage("🔍Failed to send email notification after " + 
                   std::to_string(MAX_EMAIL_RETRIES) + " attempts", LOG_WARNING);
        
        // As a fallback, try to save the email content locally
        std::string fallbackFileName = "failed_email_" + GetFileTimestamp() + ".html";
        std::ofstream fallbackFile(fallbackFileName);
        if (fallbackFile.is_open()) {
            fallbackFile << "Subject: " << subject << "\n\n";
            fallbackFile << emailBody;
            fallbackFile.close();
            LogMessage("🔍Email content saved to " + fallbackFileName, LOG_WARNING);
        }
    } else {
        LogMessage("🔍Successfully sent notification email for " + 
                   std::to_string(failureBuffer.size()) + " job failures", LOG_INFO);
    }
    
    // Clear the buffer regardless of email sending success
    failureBuffer.clear();
    timerStarted = false;
}

// Periodic timer check for pending email notifications
void CheckPendingEmailNotifications() {
    if (!timerStarted || failureBuffer.empty()) return;
    
    auto now = std::chrono::steady_clock::now();
    
    // Only check if minimum interval has passed since last check
    double timeSinceLastCheck = std::chrono::duration_cast<std::chrono::seconds>(
        now - lastCheckTime).count();
    if (timeSinceLastCheck < MIN_CHECK_INTERVAL_SEC) {
        return;
    }
    
    // Update last check time
    lastCheckTime = now;
    
    double elapsedSeconds = std::chrono::duration_cast<std::chrono::seconds>(
        now - firstFailureTime).count();

    if (elapsedSeconds >= TIME_LIMIT_SEC) {
        LogMessage("🔍Periodic check: Sending buffered email notifications...", LOG_DEBUG);
        SendBufferedEmail();
    } else {
        LogMessage("🔍Not sending email yet, buffer size: " + std::to_string(failureBuffer.size()) + 
                   ", elapsed time: " + std::to_string(elapsedSeconds) + " seconds", LOG_DEBUG);
    }
}

// Collect detailed logs for a job failure
std::string CollectDetailedLogs(const std::string& jobId) {
    std::ostringstream detailedLogs;
    
    // Add system resource information
    detailedLogs << "System Information:\n";
    
    #if !BOOST_OS_WINDOWS
    // Get memory usage on Linux/Unix
    std::ifstream meminfo("/proc/meminfo");
    if (meminfo.is_open()) {
        std::string line;
        while (std::getline(meminfo, line)) {
            if (line.find("MemTotal") != std::string::npos || 
                line.find("MemFree") != std::string::npos || 
                line.find("MemAvailable") != std::string::npos) {
                detailedLogs << line << "\n";
            }
        }
        meminfo.close();
    }
    
    // Get CPU load
    std::ifstream loadavg("/proc/loadavg");
    if (loadavg.is_open()) {
        std::string load;
        std::getline(loadavg, load);
        detailedLogs << "Load Average: " << load << "\n";
        loadavg.close();
    }
    #endif
    
    // Check for job-specific logs - could be customized based on your logging system
    detailedLogs << "\nJob Specific Logs:\n";
    
    // Example: Try to find logs for this job in a log directory
    std::string jobLogPath = "/var/log/jobs/" + jobId + ".log";
    std::ifstream jobLog(jobLogPath);
    if (jobLog.is_open()) {
        detailedLogs << "Contents of " << jobLogPath << ":\n";
        std::string line;
        while (std::getline(jobLog, line)) {
            detailedLogs << line << "\n";
        }
        jobLog.close();
    } else {
        detailedLogs << "No job-specific log file found at " << jobLogPath << "\n";
    }
    
    // Get recent application logs that might be relevant
    detailedLogs << "\nRecent Application Logs:\n";
    
    // This would be tailored to your specific logging system
    // For example, you might run a command like:
    #if !BOOST_OS_WINDOWS
    FILE* pipe = popen(("tail -n 50 /var/log/application.log | grep " + jobId).c_str(), "r");
    if (pipe) {
        char buffer[128];
        while (!feof(pipe)) {
            if (fgets(buffer, 128, pipe) != NULL) {
                detailedLogs << buffer;
            }
        }
        pclose(pipe);
    }
    #endif
    
    return detailedLogs.str();
}

// Get notification settings for a job
bool GetJobNotificationSettings(const std::string& jobId, JobNotificationSettings& settings) {
    DBconn* conn = DBconn::Get();
    if (!conn) {
        LogMessage("GetJobNotificationSettings: Connection is NULL or not connected!", LOG_ERROR);
        return false;
    }
    
    std::string query = "SELECT jnenabled, jnbrowser, jnemail, jnwhen, jnmininterval, jnemailrecipients, jncustomtext, jnlastnotification "
                        "FROM pgagent.pga_job_notification WHERE jnjobid = " + jobId+";";
    
    
    DBresultPtr res = conn->Execute(query);
    if (!res) {
        LogMessage("GetJobNotificationSettings: Failed to get notification settings for job " + jobId, LOG_WARNING);
        conn->Return();
        return false;
    }
    
    // No notification settings found
    if (!res->HasData()) {
        LogMessage("🔍DEBUG: No notification settings found for job " + jobId + ", using defaults", LOG_DEBUG);
        // Set default values for settings
        settings.enabled = true;
        settings.browser = true;
        settings.email = false;
        settings.when = "f"; // default to failure only
        settings.minInterval = 0;
        settings.emailRecipients = "";
        settings.customText = "";
        settings.lastNotification = "";
        
        conn->Return();
        return true;
    }
    
    // Get settings from result
    settings.enabled = res->GetString("jnenabled") == "t";
    settings.browser = res->GetString("jnbrowser") == "t";
    settings.email = res->GetString("jnemail") == "t";
    settings.when = res->GetString("jnwhen");
    settings.minInterval = std::stoi(res->GetString("jnmininterval"));
    settings.emailRecipients = res->GetString("jnemailrecipients");
    settings.customText = res->GetString("jncustomtext");
    settings.lastNotification = res->GetString("jnlastnotification");
    
    LogMessage("🔍DEBUG: Retrieved settings for job " + jobId + 
               ": enabled=" + std::string(settings.enabled?"true":"false") +
               ", browser=" + std::string(settings.browser?"true":"false") +
               ", email=" + std::string(settings.email?"true":"false") +
               ", when=" + settings.when, LOG_DEBUG);
    
    conn->Return();
    return true;
}

// Check if notification should be sent based on settings and job status
bool ShouldSendNotification(const JobNotificationSettings& settings, const std::string& status) {
    // If notifications are disabled, don't send
    if (!settings.enabled) {
        LogMessage("🔍DEBUG: Notification disabled for job " + settings.jobId, LOG_DEBUG);
        return false;
    }
    
    // Check notification timing criteria
    if (settings.when == "a") { // All states
        LogMessage("🔍DEBUG: Sending notification for job " + settings.jobId + " (all states)", LOG_DEBUG);
        return true;
    } else if (settings.when == "s" && status == "s") { // Success only
        LogMessage("🔍DEBUG: Sending notification for job " + settings.jobId + " (success)", LOG_DEBUG);
        return true;
    } else if (settings.when == "f" && status == "f") { // Failure only
        LogMessage("🔍DEBUG: Sending notification for job " + settings.jobId + " (failure)", LOG_DEBUG);
        return true;
    } else if (settings.when == "b" && (status == "s" || status == "f")) { // Both success and failure
        LogMessage("🔍DEBUG: Sending notification for job " + settings.jobId + " (both success and failure)", LOG_DEBUG);
        return true;
    }
    
    // Check minimum interval between notifications if set
    if (settings.minInterval > 0 && !settings.lastNotification.empty()) {
        std::time_t lastTime = 0;
        std::tm lastTm = {};
        // Format example: "2023-05-15 14:30:45"
        if (strptime(settings.lastNotification.c_str(), "%Y-%m-%d %H:%M:%S", &lastTm)) {
            lastTime = std::mktime(&lastTm);
            std::time_t currentTime = std::time(nullptr);
            double secondsElapsed = std::difftime(currentTime, lastTime);
            
            if (secondsElapsed < settings.minInterval) {
                LogMessage("🔍DEBUG: Not sending notification for job " + settings.jobId + 
                          " due to minimum interval, seconds elapsed: " + 
                          std::to_string(secondsElapsed) + ", required: " + 
                          std::to_string(settings.minInterval), LOG_DEBUG);
                return false;
            }
        }
    }
    
    LogMessage("🔍DEBUG: Notification criteria not met for job " + settings.jobId + 
               " (status=" + status + ", when=" + settings.when + ")", LOG_DEBUG);
    return false;
}

// Update the timestamp of the last notification for a job
void UpdateLastNotificationTime(const std::string& jobId) {
    DBconn* conn = DBconn::Get();
    if (!conn) {
        LogMessage("UpdateLastNotificationTime: Connection is NULL or not connected!", LOG_ERROR);
        return;
    }
    
    std::string query = "UPDATE pgagent.pga_job_notification SET jnlastnotification = NOW() "
                        "WHERE jnjobid = " + jobId;
    
    conn->ExecuteVoid(query);
    conn->Return();
}

std::string escapeJsonString(const std::string& input, bool escapeUnicode = false) {
    std::ostringstream ss;
    for (unsigned char c : input) {
        switch (c) {
            case '\"': ss << "\\\""; break;
            case '\\': ss << "\\\\"; break;
            case '\b': ss << "\\b";  break;
            case '\f': ss << "\\f";  break;
            case '\n': ss << "\\n";  break;
            case '\r': ss << "\\r";  break;
            case '\t': ss << "\\t";  break;
            case '/':  ss << "\\/";  break;
            case '\0': ss << "\\0";  break;
            case '\'': ss << "\'\'"; break;
            default:
                // Control characters or special Unicode characters
                if (c < 0x20 || c == 0x2028 || c == 0x2029 || escapeUnicode) {
                    ss << "\\u"
                       << std::hex << std::setw(4) << std::setfill('0')
                       << static_cast<int>(c);
                } else {
                    ss << c;
                }
        }
    }
    return ss.str();
}

// Notify job status and buffer failures
void NotifyJobStatus(const std::string& jobId, const std::string& status, const std::string& description) {
    std::string timestamp = GetCurrentTimestamp();
    
    // Get notification settings for this job
    JobNotificationSettings settings;
    settings.jobId = jobId;
    
    if (!GetJobNotificationSettings(jobId, settings)) {
        LogMessage("🔍Could not get notification settings for job " + jobId + ", using default behavior", LOG_DEBUG);
    }

    std::string escapedDescription = escapeJsonString(description);

    // Create JSON payload
    std::string payload = "{\"job_id\": \"" + jobId + "\", \"status\": \"" + status + 
                          "\", \"description\": \"" + escapedDescription + 
                          "\", \"timestamp\": \"" + timestamp + "\"";
    
    // Add custom text if available
    if (!settings.customText.empty()) {
        std::string escapedCustomText = escapeJsonString(settings.customText);
        payload += ", \"custom_text\": \"" + escapedCustomText + "\"";
    }
    
    // Add notification settings to payload
    payload += ", \"notification\": {\"browser\": " + std::string(settings.browser?"true":"false") +
               ", \"email\": " + std::string(settings.email?"true":"false") + "}";
    
    payload += "}";
    
    // This ensures the pgAdmin UI can still show real-time updates for jobs
    LogMessage("🔍DEBUG: Sending notification for job " + jobId + " with payload: " + payload, LOG_DEBUG);
    std::string query = "NOTIFY job_status_update, '" + payload + "'";
    DBconn* notifyConn = DBconn::Get();
    if (!notifyConn) {
        LogMessage("NotifyJobStatus: Connection is NULL or not connected!", LOG_ERROR);
        return;
    }
    
    notifyConn->ExecuteVoid(query);
    LogMessage("🔍DEBUG: Job " + jobId + " status updated to " + status, LOG_DEBUG);
    
    // Check if we should process this notification based on settings
    if (ShouldSendNotification(settings, status)) {
        // Update the last notification time
        UpdateLastNotificationTime(jobId);
        
        // If job failed and email notifications are enabled, collect logs and add to buffer
        if (status == "f" && settings.email) {
            LogMessage("🔍DEBUG: Job " + jobId + " failed, collecting detailed logs...", LOG_DEBUG);
            
            // Collect detailed logs
            std::string detailedLog = CollectDetailedLogs(jobId);
            
            // Add to failure buffer
            FailureInfo failure;
            failure.jobId = jobId;
            failure.timestamp = timestamp;
            failure.description = description;
            failure.detailedLog = detailedLog;
            
            // Add custom email recipients if specified
            if (!settings.emailRecipients.empty()) {
                failure.emailRecipients = settings.emailRecipients;
            }
            
            // Add custom text if specified
            if (!settings.customText.empty()) {
                failure.customText = settings.customText;
            }
            
            failureBuffer.push_back(failure);
            
            // Start timer if this is the first failure in the batch
            if (!timerStarted) {
                firstFailureTime = std::chrono::steady_clock::now();
                timerStarted = true;
            }
            
            // Check if it's time to send the email
            CheckPendingEmailNotifications();
        }
    } else {
        LogMessage("🔍DEBUG: Notification skipped for job " + jobId + " based on notification settings", LOG_DEBUG);
    }
    
    notifyConn->Return();
} 