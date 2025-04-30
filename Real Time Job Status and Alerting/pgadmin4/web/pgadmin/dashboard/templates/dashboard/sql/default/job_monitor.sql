/*pga4dash*/
-- Get job summary statistics
WITH job_stats AS (
    SELECT
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN jobenabled THEN 1 ELSE 0 END) AS enabled_jobs,
        SUM(CASE WHEN NOT jobenabled THEN 1 ELSE 0 END) AS disabled_jobs
    FROM 
        pgagent.pga_job
),
-- Get job status counts
job_status_stats AS (
    SELECT
        SUM(CASE WHEN jlgstatus = 'r' THEN 1 ELSE 0 END) AS running_jobs,
        SUM(CASE WHEN jlgstatus = 's' THEN 1 ELSE 0 END) AS successful_jobs,
        SUM(CASE WHEN jlgstatus = 'f' OR jlgstatus = 'x' THEN 1 ELSE 0 END) AS failed_jobs
    FROM 
        pgagent.pga_joblog
    WHERE 
        jlgid IN (
            SELECT MAX(jlgid) 
            FROM pgagent.pga_joblog 
            GROUP BY jlgjobid
        )
),
-- Get job steps for each job
job_steps AS (
    SELECT 
        jstjobid,
        COUNT(*) AS total_steps
    FROM 
        pgagent.pga_jobstep
    GROUP BY 
        jstjobid
),
-- Get latest step log for each job
latest_step_logs AS (
    SELECT DISTINCT ON (jl.jlgjobid)
        jl.jlgjobid AS job_id,
        js.jstname AS step_name,
        sl.jslstatus,
        sl.jslresult,
        sl.jslstart,
        sl.jslduration,
        js.jscnextrun
    FROM
        pgagent.pga_jobsteplog sl
    JOIN
        pgagent.pga_joblog jl ON sl.jsljlgid = jl.jlgid
    JOIN
        pgagent.pga_jobstep js ON sl.jsljstid = js.jstid
    ORDER BY
        jl.jlgjobid, sl.jslstart DESC
),
-- Get active jobs with basic information
active_jobs AS (
    SELECT 
        j.jobid,
        j.jobname,
        j.jobdesc,
        j.jobenabled,
        j.jobnextrun,
        CASE 
            WHEN jl.jlgstatus = 'r' THEN 'Running'
            WHEN jl.jlgstatus = 's' THEN 'Success'
            WHEN jl.jlgstatus = 'f' or jl.jlgstatus='x' THEN 'Failed'
            WHEN jl.jlgstatus = 'i' THEN 'Internal Error'
            WHEN jl.jlgstatus = 'd' THEN 'Aborted'
            WHEN j.jobenabled THEN 'Enabled'
            ELSE 'Disabled'
        END AS status,
        jl.jlgstart AS start_time,
        jl.jlgduration AS duration,
        -- Get the last run time for the job
        (SELECT MAX(jlgstart) 
         FROM pgagent.pga_joblog 
         WHERE jlgjobid = j.jobid) AS joblastrun,
        -- Get current step information for this specific job
        (SELECT 
            js.jstname
         FROM 
            pgagent.pga_jobsteplog sl
         JOIN 
            pgagent.pga_joblog jl ON sl.jsljlgid = jl.jlgid
         JOIN 
            pgagent.pga_jobstep js ON sl.jsljstid = js.jstid
         WHERE 
            jl.jlgjobid = j.jobid
         ORDER BY 
            sl.jslstart DESC
         LIMIT 1
        ) AS current_step,
        -- Get current step status for this specific job
        (SELECT 
            CASE 
                WHEN sl.jslstatus = 'r' THEN 'Running'
                WHEN sl.jslstatus = 's' THEN 'Success'
                WHEN sl.jslstatus = 'f' THEN 'Failed'
                WHEN sl.jslstatus = 'i' THEN 'Internal Error'
                WHEN sl.jslstatus = 'd' THEN 'Aborted'
                ELSE 'Unknown'
            END
         FROM 
            pgagent.pga_jobsteplog sl
         JOIN 
            pgagent.pga_joblog jl ON sl.jsljlgid = jl.jlgid
         WHERE 
            jl.jlgjobid = j.jobid
         ORDER BY 
            sl.jslstart DESC
         LIMIT 1
        ) AS current_step_status,
        -- Calculate progress for running jobs
        CASE
            WHEN jl.jlgstatus = 'r' THEN
                COALESCE(
                    (SELECT 
                        (COUNT(DISTINCT jsl.jsljstid) FILTER (WHERE jslstatus IN ('s', 'f', 'd', 'i')))::float * 100 / 
                        NULLIF((SELECT COUNT(*) FROM pgagent.pga_jobstep WHERE jstjobid = j.jobid), 0)
                     FROM 
                        pgagent.pga_jobsteplog jsl
                     JOIN
                        pgagent.pga_joblog jlg ON jsl.jsljlgid = jlg.jlgid
                     WHERE 
                        jlg.jlgjobid = j.jobid AND 
                        jsl.jslstart >= jl.jlgstart
                    ), 0)
            ELSE
                CASE 
                    WHEN jl.jlgstatus IN ('s', 'f', 'd', 'i') THEN 100
                    ELSE 0
                END
        END AS progress,
        -- Include total steps for this job
        (SELECT total_steps FROM job_steps WHERE jstjobid = j.jobid) AS total_steps
    FROM 
        pgagent.pga_job j
    LEFT JOIN 
        pgagent.pga_joblog jl ON j.jobid = jl.jlgjobid AND 
        jl.jlgid = (
            SELECT MAX(jlgid) 
            FROM pgagent.pga_joblog 
            WHERE jlgjobid = j.jobid
        )
    ORDER BY 
        CASE WHEN jl.jlgstatus = 'r' THEN 0 ELSE 1 END,
        jl.jlgstart DESC NULLS LAST
),
-- Get historical job data for charts (last 30 days)
job_history AS (
    SELECT 
        DATE_TRUNC('day', jlgstart) AS date,
        jlgjobid,
        COUNT(*) AS total_runs,
        SUM(CASE WHEN jlgstatus = 's' THEN 1 ELSE 0 END) AS successful_runs,
        SUM(CASE WHEN jlgstatus = 'f' THEN 1 ELSE 0 END) AS failed_runs,
        SUM(CASE WHEN jlgstatus = 'r' THEN 1 ELSE 0 END) AS running_runs,
        SUM(CASE WHEN jlgstatus = 'i' THEN 1 ELSE 0 END) AS error_runs,
        SUM(CASE WHEN jlgstatus = 'd' THEN 1 ELSE 0 END) AS aborted_runs,
        AVG(EXTRACT(EPOCH FROM jlgduration)) AS avg_duration
    FROM 
        pgagent.pga_joblog
    WHERE 
        jlgstart >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY 
        DATE_TRUNC('day', jlgstart), jlgjobid
    ORDER BY 
        DATE_TRUNC('day', jlgstart)
)
SELECT 
    json_build_object(
        'summary', (
            SELECT row_to_json(combined_stats) 
            FROM (
                SELECT 
                    js.total_jobs,
                    js.enabled_jobs,
                    js.disabled_jobs,
                    COALESCE(jss.running_jobs, 0) AS running_jobs,
                    COALESCE(jss.successful_jobs, 0) AS successful_jobs,
                    COALESCE(jss.failed_jobs, 0) AS failed_jobs
                FROM 
                    job_stats js
                LEFT JOIN 
                    job_status_stats jss ON true
            ) combined_stats
        ),
        'jobs', COALESCE((SELECT json_agg(active_jobs) FROM active_jobs), '[]'::json),
        'history', COALESCE((SELECT json_agg(job_history) FROM job_history), '[]'::json)
    ) AS result;