{% import 'macros/pga_audit_log.macros' as AUDIT_LOG %}
{{ AUDIT_LOG.PROPERTIES(jid, conn) }}
{% if rows_threshold is defined %}
LIMIT {{ rows_threshold }}
{% endif %}
