struct JobNotificationSettings {
    std::string jobId;
    bool enabled;
    bool browser;
    bool email;
    std::string when;
    int minInterval;
    std::string emailRecipients;
    std::string customText;
    std::string lastNotification;
};

struct FailureInfo {
    std::string jobId;
    std::string timestamp;
    std::string description;
    std::string detailedLog;
    std::string emailRecipients;
    std::string customText;
}; 