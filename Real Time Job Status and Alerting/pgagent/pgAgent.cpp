//////////////////////////////////////////////////////////////////////////
//
// pgAgent - PostgreSQL Tools
//
// Copyright (C) 2002 - 2024, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
// pgAgent.cpp - pgAgent main entry
//
//////////////////////////////////////////////////////////////////////////

#include "pgAgent.h"
#include <iostream>

/*Include JSON library and libcurl for parsing and smtp notification*/ 
#include <curl/curl.h>
#include <sstream>
#include <nlohmann/json.hpp>  
using json = nlohmann::json;

#if !BOOST_OS_WINDOWS
#include <unistd.h>
#endif

std::string connectString;
std::string backendPid;
long        longWait = 30;
long        shortWait = 5;
long        minLogLevel = LOG_ERROR;

using namespace std;

#define MAXATTEMPTS 10

#if !BOOST_OS_WINDOWS
bool        runInForeground = false;
std::string logFile;

#else
// pgAgent Initialized
void        Initialized();
#endif

///////////////////////////////////////////////////////////////////////////////////////////////////////////
//   ALERTING ON JOB FAILURES VIA SMTP MAILS 
//////////////////////////////////////////////////////////////////////////////////////////////////////////

//  Define buffer and time limit to save the email body
#define MAX_BUFFER_SIZE 250
#define TIME_LIMIT_SEC 120     

//buffer and timer for storing email body and expiry time
std::vector<std::string> emailBuffer; 
std::chrono::steady_clock::time_point lastEmailTime = std::chrono::steady_clock::now();

struct EmailData
{
    std::istringstream *stream;
};

size_t read_callback(char *buffer, size_t size, size_t nitems, void *userdata)
{
    EmailData *emailData = static_cast<EmailData *>(userdata);
    return emailData->stream->readsome(buffer, size * nitems);
}

void SendEmail(const std::string &subject, const std::string &body) {
    CURL *curl = curl_easy_init();
    if (!curl) {
        std::cerr << "Failed to initialize CURL!" << std::endl;
        return;
    }

    const char *fromEnv = std::getenv("MY_MAIL");
    const char *toEnv = std::getenv("REC_MAIL");
    const char *passEnv = std::getenv("MAIL_PASS");

    if (!fromEnv || !toEnv || !passEnv) {
        LogMessage("Error: Email environment variables are not set!", LOG_ERROR);
        return;
    }

    std::string from = fromEnv;
    std::string to = toEnv;
    std::string pass = passEnv;

    struct curl_slist *recipients = curl_slist_append(nullptr, to.c_str());

    std::ostringstream emailContent;
    emailContent << "From: " << from << "\r\n"
                 << "To: " << to << "\r\n"
                 << "Subject: " << subject << "\r\n"
                 << "MIME-Version: 1.0\r\n"
                 << "Content-Type: text/plain; charset=UTF-8\r\n"
                 << "\r\n" << body << "\r\n";

    std::istringstream emailStream(emailContent.str());
    EmailData emailData = {&emailStream};

    curl_easy_setopt(curl, CURLOPT_USERNAME, from.c_str());
    curl_easy_setopt(curl, CURLOPT_PASSWORD, pass.c_str());
    curl_easy_setopt(curl, CURLOPT_URL, "smtp://smtp.gmail.com:587");
    curl_easy_setopt(curl, CURLOPT_USE_SSL, CURLUSESSL_ALL);
    curl_easy_setopt(curl, CURLOPT_MAIL_FROM, from.c_str());
    curl_easy_setopt(curl, CURLOPT_MAIL_RCPT, recipients);
    curl_easy_setopt(curl, CURLOPT_READFUNCTION, read_callback);
    curl_easy_setopt(curl, CURLOPT_READDATA, &emailData);
    curl_easy_setopt(curl, CURLOPT_UPLOAD, 1L);

    CURLcode res = curl_easy_perform(curl);

    LogMessage(res == CURLE_OK ? "Email sent successfully!" : "Email sending failed", res == CURLE_OK ? LOG_INFO : LOG_WARNING);

    curl_slist_free_all(recipients);
    curl_easy_cleanup(curl);
}

void SendBufferedEmail()
{
    if (emailBuffer.empty()) return;

    std::ostringstream emailBody;
    emailBody << "The following jobs have failed :\n\n";
    for (const auto &msg : emailBuffer)
        emailBody << msg << "\n";

    SendEmail("Job Aborted Summary", emailBody.str());
    emailBuffer.clear();
    lastEmailTime = std::chrono::steady_clock::now();
}

void CheckAndSendEmail()
{
    auto now = std::chrono::steady_clock::now();
    double elapsedSeconds = std::chrono::duration_cast<std::chrono::seconds>(now - lastEmailTime).count();

    if (emailBuffer.size() >= MAX_BUFFER_SIZE || elapsedSeconds >= TIME_LIMIT_SEC)
        SendBufferedEmail();
}

//Listens for Notifications
void PollForJobStatus(DBconn *conn)
{
	CheckAndSendEmail();
    while (conn->PollNotification())
    {
        try
        {
            json jobData = json::parse(conn->GetLastNotification());
            std::string jobid = jobData.value("job_id", "Unknown");
            std::string status = jobData.value("status", "Unknown");
            std::string timestamp = jobData.value("timestamp", "");

            LogMessage("Job " + jobid + " status: " + status + " at " + timestamp, LOG_INFO);

            if (status == "f")
            {
                emailBuffer.emplace_back("Job " + jobid +"\nAt " + timestamp+"\n\n");
				CheckAndSendEmail();
            }
        }
        catch (json::parse_error &e)
        {
            LogMessage("JSON Parse Error: " + std::string(e.what()), LOG_ERROR);
        }
    }
}
//********************************************************************************************************************


int MainRestartLoop(DBconn *serviceConn)
{
    LogMessage("Listening for job status updates...", LOG_DEBUG);
	// clean up old jobs
    serviceConn->ExecuteVoid("LISTEN job_status_update");

	int rc;

	LogMessage("Clearing zombies", LOG_DEBUG);
	rc = serviceConn->ExecuteVoid("CREATE TEMP TABLE pga_tmp_zombies(jagpid int4)");

	if (serviceConn->BackendMinimumVersion(9, 2))
	{
		rc = serviceConn->ExecuteVoid(
			"INSERT INTO pga_tmp_zombies (jagpid) "
			"SELECT jagpid "
			"  FROM pgagent.pga_jobagent AG "
			"  LEFT JOIN pg_stat_activity PA ON jagpid=pid "
			" WHERE pid IS NULL"
		);
	}
	else
	{
		rc = serviceConn->ExecuteVoid(
			"INSERT INTO pga_tmp_zombies (jagpid) "
			"SELECT jagpid "
			"  FROM pgagent.pga_jobagent AG "
			"  LEFT JOIN pg_stat_activity PA ON jagpid=procpid "
			" WHERE procpid IS NULL"
		);
	}

	if (rc > 0)
	{
		// There are orphaned agent entries
		// mark the jobs as aborted
		rc = serviceConn->ExecuteVoid(
			"UPDATE pgagent.pga_joblog SET jlgstatus='d' WHERE jlgid IN ("
			"SELECT jlgid "
			"FROM pga_tmp_zombies z, pgagent.pga_job j, pgagent.pga_joblog l "
			"WHERE z.jagpid=j.jobagentid AND j.jobid = l.jlgjobid AND l.jlgstatus='r');\n"
			//************************** Send NOTIFY when job is aborted *****************************
			"WITH job_data AS ("
			"  SELECT jlgjobid AS job_id, "
			"         'f' AS status, "
			"         now() AS timestamp "
			"  FROM pgagent.pga_joblog "
			"  WHERE jlgstatus = 'd' "
			"  LIMIT 1"
			") "
			"SELECT pg_notify('job_status_update', row_to_json(job_data)::text) FROM job_data;\n"


			"UPDATE pgagent.pga_jobsteplog SET jslstatus='d' WHERE jslid IN ( "
			"SELECT jslid "
			"FROM pga_tmp_zombies z, pgagent.pga_job j, pgagent.pga_joblog l, pgagent.pga_jobsteplog s "
			"WHERE z.jagpid=j.jobagentid AND j.jobid = l.jlgjobid AND l.jlgid = s.jsljlgid AND s.jslstatus='r');\n"

			"UPDATE pgagent.pga_job SET jobagentid=NULL, jobnextrun=NULL "
			"  WHERE jobagentid IN (SELECT jagpid FROM pga_tmp_zombies);\n"

			"DELETE FROM pgagent.pga_jobagent "
			"  WHERE jagpid IN (SELECT jagpid FROM pga_tmp_zombies);\n"
		);
	}

	rc = serviceConn->ExecuteVoid("DROP TABLE pga_tmp_zombies");

	std::string host_name = boost::asio::ip::host_name();

	rc = serviceConn->ExecuteVoid(
		"INSERT INTO pgagent.pga_jobagent (jagpid, jagstation) SELECT pg_backend_pid(), '" +
		host_name + "'"
	);

	if (rc < 0)
		return rc;

	while (1)
	{
		//ProcessJobNotification(serviceConn);
		PollForJobStatus(serviceConn);

		bool foundJobToExecute = false;

		LogMessage("Checking for jobs to run", LOG_DEBUG);
		DBresultPtr res = serviceConn->Execute(
			"SELECT J.jobid "
			"  FROM pgagent.pga_job J "
			" WHERE jobenabled "
			"   AND jobagentid IS NULL "
			"   AND jobnextrun <= now() "
			"   AND (jobhostagent = '' OR jobhostagent = '" + host_name + "')"
			" ORDER BY jobnextrun"
		);

		if (res)
		{
			while (res->HasData())
			{
				std::string jobid = res->GetString("jobid");

				boost::thread job_thread = boost::thread(JobThread(jobid));
				job_thread.detach();
				foundJobToExecute = true;
				res->MoveNext();
			}
			res = NULL;

			LogMessage("Sleeping...", LOG_DEBUG);
			WaitAWhile();
		}
		else
			LogMessage("Failed to query jobs table!", LOG_ERROR);

		if (!foundJobToExecute)
			DBconn::ClearConnections();
	}
	return 0;
}


void MainLoop()
{
	int attemptCount = 1;

	// OK, let's get down to business
	do
	{
		LogMessage("Creating primary connection", LOG_DEBUG);
		DBconn *serviceConn = DBconn::InitConnection(connectString);

		if (serviceConn)
		{
			// Basic sanity check, and a chance to get the serviceConn's PID
			LogMessage("Database sanity check", LOG_DEBUG);
			DBresultPtr res = serviceConn->Execute(
				"SELECT count(*) As count, pg_backend_pid() AS pid FROM pg_class cl JOIN pg_namespace ns ON ns.oid=relnamespace WHERE relname='pga_job' AND nspname='pgagent'"
			);

			if (res)
			{
				std::string val = res->GetString("count");

				if (val == "0")
					LogMessage(
						"Could not find the table 'pgagent.pga_job'. Have you run pgagent.sql on this database?",
						LOG_ERROR
					);

				backendPid = res->GetString("pid");

				res = NULL;
			}

			// Check for particular version
			bool hasSchemaVerFunc = false;
			std::string sqlCheckSchemaVersion	=
				"SELECT COUNT(*)                                            " \
				"FROM pg_proc                                               " \
				"WHERE proname = 'pgagent_schema_version' AND               " \
				"      pronamespace = (SELECT oid                           " \
				"                      FROM pg_namespace                    " \
				"                      WHERE nspname = 'pgagent') AND       " \
				"      prorettype = (SELECT oid                             " \
				"                    FROM pg_type                           " \
				"                    WHERE typname = 'int2') AND            " \
				"      proargtypes = ''                                     ";

			res = serviceConn->Execute(sqlCheckSchemaVersion);

			if (res)
			{
				if (res->IsValid() && res->GetString(0) == "1")
					hasSchemaVerFunc = true;
				res = NULL;
			}

			if (!hasSchemaVerFunc)
			{
				LogMessage(
					"Couldn't find the function 'pgagent_schema_version' - please run ALTER EXTENSION \"pgagent\" UPDATE;.",
					LOG_ERROR
				);
			}

			std::string strPgAgentSchemaVer = serviceConn->ExecuteScalar(
				"SELECT pgagent.pgagent_schema_version()"
			);
			std::string currentPgAgentVersion = (boost::format("%d") % PGAGENT_VERSION_MAJOR).str();

			if (strPgAgentSchemaVer != currentPgAgentVersion)
			{
				LogMessage(
					"Unsupported schema version: " + strPgAgentSchemaVer +
					". Version " + currentPgAgentVersion +
					" is required - please run ALTER EXTENSION \"pgagent\" UPDATE;.",
					LOG_ERROR
				);
			}

#ifdef WIN32
			Initialized();
#endif
			MainRestartLoop(serviceConn);
		}

		LogMessage((boost::format(
			"Couldn't create the primary connection [Attempt #%d]") % attemptCount
		).str(), LOG_STARTUP);

		DBconn::ClearConnections(true);

		// Try establishing primary connection upto MAXATTEMPTS times
		if (attemptCount++ >= (int)MAXATTEMPTS)
		{
			LogMessage(
				"Stopping pgAgent: Couldn't establish the primary connection with the database server.",
				LOG_ERROR
			);
		}
		WaitAWhile();
	} while (1);
}