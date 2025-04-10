/*
// pgAgent - PostgreSQL Tools
//
// Copyright (C) 2002 - 2024, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
// pgagent--4.2--4.3.sql - Upgrade the pgAgent schema from 4.2 to 4.3
//
*/

\echo Use "ALTER EXTENSION pgagent UPDATE" to load this file. \quit

CREATE OR REPLACE FUNCTION pgagent.pgagent_schema_version() RETURNS int2 AS '
BEGIN
    -- RETURNS PGAGENT MAJOR VERSION
    -- WE WILL CHANGE THE MAJOR VERSION, ONLY IF THERE IS A SCHEMA CHANGE
    RETURN 4;
END;
' LANGUAGE 'plpgsql' VOLATILE;

-- Add notification settings table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace 
                 WHERE c.relname = 'pga_job_notification' AND n.nspname = 'pgagent') THEN
        
        CREATE TABLE pgagent.pga_job_notification (
            jnid                 serial               NOT NULL PRIMARY KEY,
            jnjobid              int4                 NOT NULL REFERENCES pgagent.pga_job (jobid) ON DELETE CASCADE ON UPDATE RESTRICT,
            jnenabled            bool                 NOT NULL DEFAULT true,
            jnbrowser            bool                 NOT NULL DEFAULT true,
            jnemail              bool                 NOT NULL DEFAULT false,
            jnwhen               char                 NOT NULL CHECK (jnwhen IN ('a', 's', 'f', 'b')) DEFAULT 'f', -- a=all, s=success, f=failure, b=both (success and failure)
            jnmininterval        int4                 NOT NULL DEFAULT 0, -- minimum interval between notifications in seconds (0 = no limit)
            jnemailrecipients    text                 NOT NULL DEFAULT '', -- comma-separated list of email recipients
            jncustomtext         text                 NOT NULL DEFAULT '', -- custom text to include in notifications
            jnlastnotification   timestamptz          NULL    -- timestamp of last notification sent
        );
        
        CREATE UNIQUE INDEX pga_job_notification_jobid_unique ON pgagent.pga_job_notification(jnjobid);
        COMMENT ON TABLE pgagent.pga_job_notification IS 'Job notification settings';
        COMMENT ON COLUMN pgagent.pga_job_notification.jnwhen IS 'When to send notifications: a=all states, s=success only, f=failure only, b=both success and failure';
        
        -- For each existing job, create a default notification entry
        INSERT INTO pgagent.pga_job_notification (jnjobid, jnenabled, jnbrowser, jnemail, jnwhen)
        SELECT jobid, true, true, false, 'f' FROM pgagent.pga_job;
    END IF;
END$$;

-- Add the notification table to the extension
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgagent') THEN
        ALTER EXTENSION pgagent ADD TABLE pgagent.pga_job_notification;
        ALTER EXTENSION pgagent ADD SEQUENCE pgagent.pga_job_notification_jnid_seq;
    END IF;
END$$;

-- Add config dump
SELECT pg_catalog.pg_extension_config_dump('pga_job_notification', ''); 