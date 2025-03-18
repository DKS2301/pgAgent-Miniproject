-- Function to notify job status updates
CREATE OR REPLACE FUNCTION pgagent.notify_job_status_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify with job status update
    PERFORM pg_notify(
        'job_status_update',
        json_build_object(
            'job_id', NEW.jobid,
            'job_name', NEW.jobname,
            'status', NEW.jlgstatus,
            'last_run', NEW.joblastrun,
            'next_run', NEW.jobnextrun,
            'enabled', NEW.jobenabled
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for job status updates
DROP TRIGGER IF EXISTS job_status_update_trigger ON pgagent.pga_job;
CREATE TRIGGER job_status_update_trigger
    AFTER UPDATE ON pgagent.pga_job
    FOR EACH ROW
    EXECUTE FUNCTION pgagent.notify_job_status_update();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION pgagent.notify_job_status_update() TO pgagent;
GRANT USAGE ON SCHEMA pgagent TO pgagent; 