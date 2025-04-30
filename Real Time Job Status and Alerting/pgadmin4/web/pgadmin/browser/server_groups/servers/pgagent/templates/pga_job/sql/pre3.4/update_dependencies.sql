-- Delete only the dependencies that are explicitly marked as deleted
{% if 'deleted' in data.jdependencies %}
DELETE FROM pgagent.pga_job_dependency
WHERE jobid = {{ jid|qtLiteral(conn) }} AND dependent_jobid IN (
    {% for dep in data.jdependencies.deleted %}
    {{ dep.dependent_jobid|qtLiteral(conn) }}{% if not loop.last %}, {% endif %}
    {% endfor %}
);
{% endif %}

-- Handle changes by deleting and re-adding them
-- First delete all existing dependencies that are being changed
{% if 'changed' in data.jdependencies %}
{% for dep in data.jdependencies.changed %}
DELETE FROM pgagent.pga_job_dependency
WHERE jobid = {{ jid|qtLiteral(conn) }} AND dependent_jobid = {{ dep.original_dependent_jobid|qtLiteral(conn) }};

-- Then insert the changed dependency with new value
INSERT INTO pgagent.pga_job_dependency (jobid, dependent_jobid)
VALUES ({{ jid|qtLiteral(conn) }}, {{ dep.dependent_jobid|qtLiteral(conn) }});
{% endfor %}
{% endif %}

-- Add new dependencies
{% if 'added' in data.jdependencies %}
INSERT INTO pgagent.pga_job_dependency (jobid, dependent_jobid)
VALUES
{% for dep in data.jdependencies.added %}
({{ jid|qtLiteral(conn) }}, {{ dep.dependent_jobid|qtLiteral(conn) }}){% if not loop.last %}, {% endif %}
{% endfor %};
{% endif %}