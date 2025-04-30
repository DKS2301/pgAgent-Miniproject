SELECT 
    j.jobid,
    j.jobname,
    j.jobenabled,
    COALESCE(jl.jlgstatus, 'd') as status,
    j.jobnextrun,
    j.joblastrun
FROM pgagent.pga_job j
LEFT JOIN (
    SELECT DISTINCT ON (jlgjobid) jlgjobid, jlgstatus
    FROM pgagent.pga_joblog
    ORDER BY jlgjobid, jlgstart DESC
) jl ON j.jobid = jl.jlgjobid
ORDER BY j.jobid; 