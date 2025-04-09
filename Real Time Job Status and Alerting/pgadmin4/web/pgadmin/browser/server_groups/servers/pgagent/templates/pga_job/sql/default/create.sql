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

) RETURNING jobid INTO jid;{% if 'jsteps' in data and data.jsteps|length > 0 %}


-- Steps
{% for step in data.jsteps %}{{ STEP.INSERT(has_connstr, None, step, conn) }}{% endfor %}
{% endif %}{% if 'jschedules' in data and data.jschedules|length > 0 %}


-- Schedules
{% for schedule in data.jschedules %}{{ SCHEDULE.INSERT(None, schedule, conn) }}{% endfor %}
{% endif %}

-- Notification Settings
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
    {% if data.notification and data.notification.jnenabled is defined %}{{ 'true' if data.notification.jnenabled else 'false' }}{% else %}true{% endif %},
    {% if data.notification and data.notification.jnbrowser is defined %}{{ 'true' if data.notification.jnbrowser else 'false' }}{% else %}true{% endif %},
    {% if data.notification and data.notification.jnemail is defined %}{{ 'true' if data.notification.jnemail else 'false' }}{% else %}false{% endif %},
    {% if data.notification and data.notification.jnwhen is defined %}{{ data.notification.jnwhen|qtLiteral(conn) }}{% else %}'f'{% endif %},
    {% if data.notification and data.notification.jnmininterval is defined %}{{ data.notification.jnmininterval }}{% else %}0{% endif %},
    {% if data.notification and data.notification.jnemailrecipients is defined %}{{ data.notification.jnemailrecipients|qtLiteral(conn) }}{% else %}''{% endif %},
    {% if data.notification and data.notification.jncustomtext is defined %}{{ data.notification.jncustomtext|qtLiteral(conn) }}{% else %}''{% endif %}
);

END
$$;{% if fetch_id %}

SELECT jobid FROM pgagent.pga_job WHERE xmin::text = (txid_current() % (2^32)::bigint)::text;{% endif %} 