SELECT
    audit_id,
    operation_time,
    operation_type,
    job_id,
    operation_user,
    additional_info
FROM
    pgagent.pga_job_audit_log
WHERE
    {% if operation %}
    operation_type = '{{ operation }}'
    {% else %}
    1=1
    {% endif %}
    AND
    {% if username %}
    operation_user = '{{ username }}'
    {% else %}
    1=1
    {% endif %}
    AND
    {% if jobname %}
    (additional_info LIKE '%{{ jobname }}%' OR job_id::text = '{{ jobname }}')
    {% else %}
    1=1
    {% endif %}
    AND
    {% if start_date %}
    operation_time >= '{{ start_date }}'::timestamptz
    {% else %}
    1=1
    {% endif %}
    AND
    {% if end_date %}
    operation_time <= '{{ end_date }}'::timestamptz
    {% else %}
    1=1
    {% endif %}
ORDER BY operation_time DESC;