{% import 'macros/pga_jobstep.macros' as STEP %}
{% import 'macros/pga_schedule.macros' as SCHEDULE %}
DO $$
DECLARE
    jid integer := {{ jid }};
    scid integer;
BEGIN
    -- Update job
    UPDATE pgagent.pga_job SET
        jobjclid = {% if 'jobjclid' in data %}{{ data.jobjclid|qtLiteral(conn) }}::integer{% else %}jobjclid{% endif %},
        jobname = {% if 'jobname' in data %}{{ data.jobname|qtLiteral(conn) }}::text{% else %}jobname{% endif %},
        jobdesc = {% if 'jobdesc' in data %}{{ data.jobdesc|qtLiteral(conn) }}::text{% else %}jobdesc{% endif %},
        jobhostagent = {% if 'jobhostagent' in data %}{{ data.jobhostagent|qtLiteral(conn) }}::text{% else %}jobhostagent{% endif %},
        jobenabled = {% if 'jobenabled' in data %}{% if data.jobenabled %}true{% else %}false{% endif %}{% else %}jobenabled{% endif %}
    WHERE jobid = jid;

    -- Update notification settings
    UPDATE pgagent.pga_job_notification SET
        jnenabled = {% if 'jnenabled' in data %}{{ data.jnenabled }}{% else %}jnenabled{% endif %},
        jnbrowser = {% if 'jnbrowser' in data %}{{ data.jnbrowser }}{% else %}jnbrowser{% endif %},
        jnemail = {% if 'jnemail' in data %}{{ data.jnemail }}{% else %}jnemail{% endif %},
        jnwhen = {% if 'jnwhen' in data %}{{ data.jnwhen|qtLiteral(conn) }}{% else %}jnwhen{% endif %},
        jnmininterval = {% if 'jnmininterval' in data %}{{ data.jnmininterval }}{% else %}jnmininterval{% endif %},
        jnemailrecipients = {% if 'jnemailrecipients' in data %}{{ data.jnemailrecipients|qtLiteral(conn) }}{% else %}jnemailrecipients{% endif %},
        jncustomtext = {% if 'jncustomtext' in data %}{{ data.jncustomtext|qtLiteral(conn) }}{% else %}jncustomtext{% endif %}
    WHERE jnjobid = jid;

    -- Handle steps
    {% if 'deleted' in data.jsteps %}{% for step in data.jsteps.deleted %}{{ STEP.DELETE(jid, step.jstid, conn) }}{% endfor %}{% endif %}
    {% if 'changed' in data.jsteps %}{% for step in data.jsteps.changed %}{{ STEP.UPDATE(has_connstr, jid, step.jstid, step, conn) }}{% endfor %}{% endif %}
    {% if 'added' in data.jsteps %}{% for step in data.jsteps.added %}{{ STEP.INSERT(has_connstr, jid, step, conn) }}{% endfor %}{% endif %}

    -- Handle schedules
    {% if 'deleted' in data.jschedules %}{% for schedule in data.jschedules.deleted %}{{ SCHEDULE.DELETE(jid, schedule.jscid, conn) }}{% endfor %}{% endif %}
    {% if 'changed' in data.jschedules %}{% for schedule in data.jschedules.changed %}{{ SCHEDULE.UPDATE(jid, schedule.jscid, schedule, conn) }}{% endfor %}{% endif %}
    {% if 'added' in data.jschedules %}{% for schedule in data.jschedules.added %}{{ SCHEDULE.INSERT(jid, schedule, conn) }}{% endfor %}{% endif %}
END
$$;
{% if 'jobjclid' in data or 'jobname' in data or 'jobdesc' in data or 'jobhostagent' in data or 'jobenabled' in data %}
UPDATE pgagent.pga_job
SET {% if 'jobjclid' in data %}jobjclid={{ data.jobjclid|qtLiteral(conn) }}::integer{% if 'jobname' in data or 'jobdesc' in data or 'jobhostagent' in data or 'jobenabled' in data %}, {% endif %}{% endif %}
{% if 'jobname' in data %}jobname={{ data.jobname|qtLiteral(conn) }}::text{%if 'jobdesc' in data or 'jobhostagent' in data or 'jobenabled' in data %}, {% endif %}{% endif %}
{% if 'jobdesc' in data %}jobdesc={{ data.jobdesc|qtLiteral(conn) }}::text{%if 'jobhostagent' in data or 'jobenabled' in data %}, {% endif %}{% endif %}
{%if 'jobhostagent' in data %}jobhostagent={{ data.jobhostagent|qtLiteral(conn) }}::text{% if 'jobenabled' in data %}, {% endif %}{% endif %}
{% if 'jobenabled' in data %}jobenabled={% if data.jobenabled %}true{% else %}false{% endif %}{% endif %}

WHERE jobid = {{ jid }};
{% endif %}{% if 'jsteps' in data %}

{% if 'deleted' in data.jsteps %}{% for step in data.jsteps.deleted %}{{ STEP.DELETE(jid, step.jstid, conn) }}{% endfor %}{% endif %}
{% if 'changed' in data.jsteps %}{% for step in data.jsteps.changed %}{{ STEP.UPDATE(has_connstr, jid, step.jstid, step, conn) }}{% endfor %}{% endif %}
{% if 'added' in data.jsteps %}{% for step in data.jsteps.added %}{{ STEP.INSERT(has_connstr, jid, step, conn) }}{% endfor %}{% endif %}{% endif %}{% if 'jschedules' in data %}

{% if 'deleted' in data.jschedules %}{% for schedule in data.jschedules.deleted %}{{ SCHEDULE.DELETE(jid, schedule.jscid, conn) }}{% endfor %}{% endif %}
{% if 'changed' in data.jschedules %}{% for schedule in data.jschedules.changed %}{{ SCHEDULE.UPDATE(jid, schedule.jscid, schedule, conn) }}{% endfor %}{% endif %}
{% if 'added' in data.jschedules %}

DO $$
DECLARE
    scid integer;
BEGIN
{% for schedule in data.jschedules.added %}{{ SCHEDULE.INSERT(jid, schedule, conn) }}{% endfor %}
END
$$;
{% endif %}
{% endif %}
