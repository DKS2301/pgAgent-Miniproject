-- Get list of jobs except the current job (can't depend on itself)
SELECT 
    j.jobid as value,
    j.jobname as label
FROM 
    pgagent.pga_job j
{% if jid %}
WHERE j.jobid != {{ jid|qtLiteral(conn) }}::integer
{% endif %}
ORDER BY j.jobname; 