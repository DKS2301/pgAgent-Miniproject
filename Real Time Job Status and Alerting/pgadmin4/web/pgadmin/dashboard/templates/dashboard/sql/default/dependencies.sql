SELECT
    jd.jobid,
    jd.dependent_jobid,
    j.jobname as dependent_jobname,
    j.jobenabled,
    COALESCE(jl.jlgstatus, 'f') as status,
    j.jobnextrun,
    j.joblastrun
FROM
    pgagent.pga_job_dependency jd
    JOIN pgagent.pga_job j ON j.jobid = jd.dependent_jobid
    LEFT JOIN (
        SELECT DISTINCT ON (jlgjobid) jlgjobid, jlgstatus
        FROM pgagent.pga_joblog
        ORDER BY jlgjobid, jlgstart DESC
    ) jl ON j.jobid = jl.jlgjobid
{% if jid %}
WHERE jd.jobid = {{ jid|qtLiteral(conn) }}::integer
{% endif %}
ORDER BY j.jobname;