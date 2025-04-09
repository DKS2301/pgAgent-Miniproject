/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import gettext from 'sources/gettext';
import BaseUISchema from 'sources/SchemaView/base_schema.ui';
import PgaJobScheduleSchema from '../../schedules/static/js/pga_schedule.ui';

export default class PgaJobSchema extends BaseUISchema {
  constructor(fieldOptions={}, getPgaJobStepSchema=()=>[], initValues={}) {
    super({
      jobname: '',
      jobid: undefined,
      jobenabled: true,
      jobhostagent: '',
      jobjclid: 1,
      jobcreated: undefined,
      jobchanged: undefined,
      jobnextrun: undefined,
      joblastrun: undefined,
      jlgstatus: undefined,
      jobrunningat: undefined,
      jobdesc: '',
      jsteps: [],
      jschedules: [],
      // Notification settings
      jnenabled: true,
      jnbrowser: true,
      jnemail: false,
      jnwhen: 'f',
      jnmininterval: 0,
      jnemailrecipients: '',
      jncustomtext: '',
      jnlastnotification: undefined,
      ...initValues,
    });

    this.fieldOptions = {
      jobjclid: [],
      ...fieldOptions,
    };
    this.getPgaJobStepSchema = getPgaJobStepSchema;
  }

  get idAttribute() {
    return 'jobid';
  }

  get baseFields() {
    return [
      {
        id: 'jobname', label: gettext('Name'), type: 'text', noEmpty: true,
      },{
        id: 'jobid', label: gettext('ID'), mode: ['properties'],
        type: 'int',
      },{
        id: 'jobenabled', label: gettext('Enabled?'), type: 'switch',
      },{
        id: 'jobjclid', label: gettext('Job class'), type: 'select',
        options: this.fieldOptions.jobjclid,
        controlProps: {allowClear: false},
        mode: ['properties'],
      },{
        id: 'jobjclid', label: gettext('Job class'), type: 'select',
        options: this.fieldOptions.jobjclid,
        mode: ['create', 'edit'],
        controlProps: {allowClear: false},
        helpMessage: gettext('Please select a class to categorize the job. This option will not affect the way the job runs.'),
        helpMessageMode: ['edit', 'create'],
      },{
        id: 'jobhostagent', label: gettext('Host agent'), type: 'text',
        mode: ['properties'],
      },{
        id: 'jobhostagent', label: gettext('Host agent'), type: 'text',
        mode: ['edit', 'create'],
        helpMessage: gettext('Enter the hostname of a machine running pgAgent if you wish to ensure only that machine will run this job. Leave blank if any host may run the job.'),
        helpMessageMode: ['edit', 'create'],
      },{
        id: 'jobcreated', type: 'text', mode: ['properties'],
        label: gettext('Created'),
      },{
        id: 'jobchanged', type: 'text', mode: ['properties'],
        label: gettext('Changed'),
      },{
        id: 'jobnextrun', type: 'text', mode: ['properties'],
        label: gettext('Next run'),
      },{
        id: 'joblastrun', type: 'text', mode: ['properties'],
        label: gettext('Last run'),
      },{
        id: 'jlgstatus', type: 'text', label: gettext('Last result'), mode: ['properties'],
        controlProps: {
          formatter: {
            fromRaw: (originalValue)=>{
              return originalValue || gettext('Unknown');
            },
          }
        }
      },{
        id: 'jobrunningat', type: 'text', mode: ['properties'], label: gettext('Running at'),
        controlProps: {
          formatter: {
            fromRaw: (originalValue)=>{
              return originalValue || gettext('Not running currently.');
            },
          }
        }
      },{
        id: 'jobdesc', label: gettext('Comment'), type: 'multiline',
      },{
        id: 'jsteps', label: '', group: gettext('Steps'),
        type: 'collection', mode: ['edit', 'create'],
        schema: this.getPgaJobStepSchema(),
        canEdit: true, canAdd: true, canDelete: true,
        columns: [
          'jstname', 'jstenabled', 'jstkind', 'jstconntype', 'jstonerror',
        ],
      },{
        id: 'jschedules', label: '', group: gettext('Schedules'),
        type: 'collection', mode: ['edit', 'create'],
        schema: new PgaJobScheduleSchema(),
        canAdd: true, canDelete: true, canEdit: true,
        columns: ['jscname', 'jscenabled', 'jscstart', 'jscend'],
      },{
        id: 'jnenabled', label: gettext('Enable Notifications'), type: 'switch',
        group: gettext('Notifications'),
        mode: ['edit', 'create', 'properties'],
        helpMessage: gettext('Enable or disable notifications for this job.'),
      },{
        id: 'jnbrowser', label: gettext('Browser Notifications'), type: 'switch',
        group: gettext('Notifications'),
        mode: ['edit', 'create', 'properties'],
        helpMessage: gettext('Show notifications in the browser.'),
        deps: ['jnenabled'],
        disabled: function(state) {
          return !state.jnenabled;
        },
      },{
        id: 'jnemail', label: gettext('Email Notifications'), type: 'switch',
        group: gettext('Notifications'),
        mode: ['edit', 'create', 'properties'],
        helpMessage: gettext('Send email notifications.'),
        deps: ['jnenabled'],
        disabled: function(state) {
          return !state.jnenabled;
        },
      },{
        id: 'jnwhen', label: gettext('Notify When'), type: 'select',
        group: gettext('Notifications'),
        mode: ['edit', 'create', 'properties'],
        options: [
          {label: gettext('On Failure'), value: 'f'},
          {label: gettext('On Success'), value: 's'},
          {label: gettext('Both'), value: 'b'},
          {label: gettext('Always'), value: 'a'},
        ],
        helpMessage: gettext('When to send notifications.'),
        deps: ['jnenabled'],
        disabled: function(state) {
          return !state.jnenabled;
        },
      },{
        id: 'jnmininterval', label: gettext('Minimum Interval (seconds)'), type: 'int',
        group: gettext('Notifications'),
        mode: ['edit', 'create', 'properties'],
        helpMessage: gettext('Minimum time between notifications in seconds.'),
        deps: ['jnenabled'],
        disabled: function(state) {
          return !state.jnenabled;
        },
        min: 0,
      },{
        id: 'jnemailrecipients', label: gettext('Email Recipients'), type: 'text',
        group: gettext('Notifications'),
        mode: ['edit', 'create', 'properties'],
        helpMessage: gettext('Comma-separated list of email recipients.'),
        deps: ['jnenabled', 'jnemail'],
        disabled: function(state) {
          return !state.jnenabled || !state.jnemail;
        },
      },{
        id: 'jncustomtext', label: gettext('Custom Message'), type: 'multiline',
        group: gettext('Notifications'),
        mode: ['edit', 'create', 'properties'],
        helpMessage: gettext('Custom message to include in notifications.'),
        deps: ['jnenabled'],
        disabled: function(state) {
          return !state.jnenabled;
        },
      },{
        id: 'jnlastnotification', type: 'text', mode: ['properties'],
        label: gettext('Last Notification'),
        group: gettext('Notifications'),
      }
    ];
  }
}
