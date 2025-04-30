{% if 'jdependencies' in data and data.jdependencies|length > 0 %}
-- Insert dependencies
{% for dep in data.jdependencies %}
INSERT INTO pgagent.pga_job_dependency (
    jobid,
    dependent_jobid
) VALUES (
    {{ jid|qtLiteral(conn) }}::integer,
    {{ dep.dependent_jobid|qtLiteral(conn) }}::integer
);
{% endfor %}
{% endif %} 