{% import 'macros/pga_jobstep.macros' as STEP %}
{% import 'macros/pga_schedule.macros' as SCHEDULE %}
DO $$
DECLARE
    jid integer;{% if 'jschedules' in data and data.jschedules|length > 0 %}

    scid integer;{% endif %}

BEGIN
-- Creating a new job
INSERT INTO pgagent.pga_job(
    jobjclid, jobname, jobdesc, jobhostagent, jobenabled
) VALUES (
    {{ data.jobjclid|qtLiteral(conn) }}::integer, {{ data.jobname|qtLiteral(conn) }}::text, {{ data.jobdesc|qtLiteral(conn) }}::text, {{ data.jobhostagent|qtLiteral(conn) }}::text, {% if data.jobenabled %}true{% else %}false{% endif %}
) RETURNING jobid INTO jid;

-- Add notification settings
INSERT INTO pgagent.pga_job_notification (
    jnjobid,
    jnenabled,
    jnbrowser,
    jnemail,
    jnwhen,
    jnmininterval,
    jnemailrecipients,
    jncustomtext
) VALUES (
    jid,
    {% if data.jnenabled is defined %}{{ data.jnenabled }}{% else %}true{% endif %},
    {% if data.jnbrowser is defined %}{{ data.jnbrowser }}{% else %}true{% endif %},
    {% if data.jnemail is defined %}{{ data.jnemail }}{% else %}false{% endif %},
    {% if data.jnwhen is defined %}{{ data.jnwhen|qtLiteral(conn) }}{% else %}'f'{% endif %},
    {% if data.jnmininterval is defined %}{{ data.jnmininterval }}{% else %}0{% endif %},
    {% if data.jnemailrecipients is defined %}{{ data.jnemailrecipients|qtLiteral(conn) }}{% else %}''{% endif %},
    {% if data.jncustomtext is defined %}{{ data.jncustomtext|qtLiteral(conn) }}{% else %}''{% endif %}
);{% if 'jsteps' in data and data.jsteps|length > 0 %}


-- Steps
{% for step in data.jsteps %}{{ STEP.INSERT(has_connstr, None, step, conn) }}{% endfor %}
{% endif %}{% if 'jschedules' in data and data.jschedules|length > 0 %}


-- Schedules
{% for schedule in data.jschedules %}{{ SCHEDULE.INSERT(None, schedule, conn) }}{% endfor %}
{% endif %}

END
$$;{% if fetch_id %}

SELECT jobid FROM pgagent.pga_job WHERE xmin::text = (txid_current() % (2^32)::bigint)::text;{% endif %}
