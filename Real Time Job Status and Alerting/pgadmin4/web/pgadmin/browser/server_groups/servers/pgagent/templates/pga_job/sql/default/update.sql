{% import 'macros/pga_jobstep.macros' as STEP %}
{% import 'macros/pga_schedule.macros' as SCHEDULE %}
DO $$
DECLARE
    jid integer = {{ jid }};{% if 'jschedules' in data and data.jschedules|length > 0 %}

    scid integer;{% endif %}
BEGIN
-- Updating the existing job
UPDATE pgagent.pga_job
SET jobjclid = {{ data.jobjclid|qtLiteral(conn) }}::integer,
    jobname = {{ data.jobname|qtLiteral(conn) }}::text,
    jobdesc = {{ data.jobdesc|qtLiteral(conn) }}::text,
    jobhostagent = {{ data.jobhostagent|qtLiteral(conn) }}::text,
    jobenabled = {% if data.jobenabled %}true{% else %}false{% endif %},
    jobchanged = now()
WHERE jobid = jid;{% if 'jsteps' in data and data.jsteps|length > 0 %}


-- Steps
{% for step in data.jsteps %}{{ STEP.UPDATE(has_connstr, jid, step, conn) }}{% endfor %}
{% endif %}{% if 'jschedules' in data and data.jschedules|length > 0 %}


-- Schedules
{% for schedule in data.jschedules %}{{ SCHEDULE.UPDATE(jid, schedule, conn) }}{% endfor %}
{% endif %}

-- Update Notification Settings
UPDATE pgagent.pga_job_notification
SET jnenabled = {% if data.notification and data.notification.jnenabled is defined %}{{ 'true' if data.notification.jnenabled else 'false' }}{% else %}jnenabled{% endif %},
    jnbrowser = {% if data.notification and data.notification.jnbrowser is defined %}{{ 'true' if data.notification.jnbrowser else 'false' }}{% else %}jnbrowser{% endif %},
    jnemail = {% if data.notification and data.notification.jnemail is defined %}{{ 'true' if data.notification.jnemail else 'false' }}{% else %}jnemail{% endif %},
    jnwhen = {% if data.notification and data.notification.jnwhen is defined %}{{ data.notification.jnwhen|qtLiteral(conn) }}{% else %}jnwhen{% endif %},
    jnmininterval = {% if data.notification and data.notification.jnmininterval is defined %}{{ data.notification.jnmininterval }}{% else %}jnmininterval{% endif %},
    jnemailrecipients = {% if data.notification and data.notification.jnemailrecipients is defined %}{{ data.notification.jnemailrecipients|qtLiteral(conn) }}{% else %}jnemailrecipients{% endif %},
    jncustomtext = {% if data.notification and data.notification.jncustomtext is defined %}{{ data.notification.jncustomtext|qtLiteral(conn) }}{% else %}jncustomtext{% endif %}
WHERE jnjobid = jid;

-- Insert if no notification settings exist
IF NOT FOUND THEN
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
END IF;

END
$$; 