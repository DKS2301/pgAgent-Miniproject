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
import PgaJobDependencySchema from './pga_job_dependency.ui';

class AuditLogSchema extends BaseUISchema {
  get baseFields() {
    return [
      {
        id: 'audit_id', label: gettext('ID'), cell: 'string', type: 'text',
        readonly: true, mode: ['properties'], sortable: true,
      }, {
        id: 'operation_type', label: gettext('Operation'), cell: 'string', type: 'text',
        readonly: true, mode: ['properties'], sortable: true,
      }, {
        id: 'operation_time', label: gettext('Time'), cell: 'string', type: 'text',
        readonly: true, mode: ['properties'], sortable: true,
      }, {
        id: 'operation_user', label: gettext('User'), cell: 'string', type: 'text',
        readonly: true, mode: ['properties'], sortable: true,
      }, {
        id: 'old_values', label: gettext('Old Values'), cell: 'string', type: 'jsonb',
        readonly: true, mode: ['properties'],
        controlProps: {
          formatter: {
            fromRaw: (value) => {
              return value ? JSON.stringify(value, null, 4) : '';
            }
          }
        }
      }, {
        id: 'new_values', label: gettext('New Values'), cell: 'string', type: 'jsonb',
        readonly: true, mode: ['properties'],
        controlProps: {
          formatter: {
            fromRaw: (value) => {
              return value ? JSON.stringify(value, null, 4) : '';
            }
          }
        }
      }, {
        id: 'additional_info', label: gettext('Additional Info'), cell: 'string', type: 'text',
        readonly: true, mode: ['properties'],
      }
    ];
  }
}

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
      jdependencies: [],
      ...initValues,
    });

    this.fieldOptions = {
      jobjclid: [],
      jobs: [],
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
      },{
        id: 'jdependencies', label: '', group: gettext('Dependencies'),
        type: 'collection', mode: ['edit', 'create', 'properties'],
        schema: new PgaJobDependencySchema({
          jobs: this.fieldOptions.jobs,
        }),
        canAdd: true, canDelete: true, canEdit: true,
        columns: ['dependent_jobname'],
        uniqueCol: ['dependent_jobid'],
      },{
        id: 'audit_logs', label: '', group: gettext('Audit Logs'),
        mode: ['properties'],
        type: 'collection',
        schema: new AuditLogSchema(),
        canAdd: false, canDelete: false, canEdit: false,
        columns: ['audit_id', 'operation_type', 'operation_time', 'operation_user'],
        url: 'audit_log',
        // Enable sorting
        isSortable: true,
        sortColumns: {
          'audit_id': 'numeric',
          'operation_type': 'string',
          'operation_time': 'string',
          'operation_user': 'string'
        },
        // Add filter toolbar with simple filter buttons
        customButtomPanel: true,
        customButtomPanelRender: (panel) => {
          const container = document.createElement('div');
          container.className = 'pg-audit-filter-container';
          container.style.padding = '8px';
          container.style.display = 'flex';
          container.style.flexWrap = 'wrap';
          container.style.gap = '8px';
          container.style.alignItems = 'center';
          
          // Create operation type filter buttons
          const opTypeLabel = document.createElement('span');
          opTypeLabel.textContent = 'Filter by: ';
          opTypeLabel.style.marginRight = '8px';
          container.appendChild(opTypeLabel);
          
          // Create filter buttons for operation types
          const operations = [
            { label: 'CREATE', value: 'CREATE' },
            { label: 'MODIFY', value: 'MODIFY' },
            { label: 'EXECUTE', value: 'EXECUTE' },
          ];
          
          operations.forEach(op => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = op.label;
            btn.style.marginRight = '5px';
            btn.onclick = function() {
              // Apply filter when button is clicked
              panel.onCustomFilter({
                operation_types: op.value
              });
            };
            container.appendChild(btn);
          });
          
          // Add a reset button
          const resetBtn = document.createElement('button');
          resetBtn.className = 'btn btn-secondary btn-sm';
          resetBtn.textContent = 'Show All';
          resetBtn.style.marginLeft = '5px';
          resetBtn.onclick = function() {
            // Reset filters
            panel.onCustomFilter({});
          };
          container.appendChild(resetBtn);
          
          // Add date range filters
          const dateContainer = document.createElement('div');
          dateContainer.style.display = 'flex';
          dateContainer.style.alignItems = 'center';
          dateContainer.style.marginTop = '8px';
          dateContainer.style.width = '100%';
          
          const dateLabel = document.createElement('span');
          dateLabel.textContent = 'Date range: ';
          dateLabel.style.marginRight = '8px';
          dateContainer.appendChild(dateLabel);
          
          // Add date inputs
          const dateFrom = document.createElement('input');
          dateFrom.type = 'date';
          dateFrom.className = 'form-control';
          dateFrom.style.marginRight = '8px';
          dateFrom.style.width = '150px';
          dateContainer.appendChild(dateFrom);
          
          const dateTo = document.createElement('input');
          dateTo.type = 'date';
          dateTo.className = 'form-control';
          dateTo.style.marginRight = '8px';
          dateTo.style.width = '150px';
          dateContainer.appendChild(dateTo);
          
          // Add apply button for date range
          const applyDateBtn = document.createElement('button');
          applyDateBtn.className = 'btn btn-primary btn-sm';
          applyDateBtn.textContent = 'Apply Date Filter';
          applyDateBtn.onclick = function() {
            const params = {};
            if (dateFrom.value) params.date_from = dateFrom.value;
            if (dateTo.value) params.date_to = dateTo.value;
            panel.onCustomFilter(params);
          };
          dateContainer.appendChild(applyDateBtn);
          
          container.appendChild(dateContainer);
          
          // Add some styling
          const style = document.createElement('style');
          style.textContent = `
            .pg-audit-filter-container button:hover {
              background-color: #4a6785;
              color: white;
            }
          `;
          container.appendChild(style);
          
          return container;
        },
        onCustomFilter: (filterValues) => {
          const params = {};
          
          if (filterValues.operation_types) {
            params.operation_types = filterValues.operation_types;
          }
          
          if (filterValues.date_from) {
            params.date_from = filterValues.date_from;
          }
          
          if (filterValues.date_to) {
            params.date_to = filterValues.date_to;
          }
          
          return params;
        },
      }
    ];
  }
}
