SELECT 
    j.jobid, 
    j.jobname
FROM 
    pgagent.pga_job j
ORDER BY 
    j.jobname;