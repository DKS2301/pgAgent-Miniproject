SELECT
    jd.jobid,
    jd.dependent_jobid,
    j.jobname as dependent_jobname
FROM
    pgagent.pga_job_dependency jd
    JOIN pgagent.pga_job j ON j.jobid = jd.dependent_jobid
{% if jid %}
WHERE jd.jobid = {{ jid|qtLiteral(conn) }}::integer
{% endif %}
ORDER BY j.jobname;