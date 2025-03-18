/* eslint-disable */
//////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////
import { getNodeAjaxOptions } from '../../../../../static/js/node_ajax';
import PgaJobSchema from './pga_job.ui';
import { getNodePgaJobStepSchema } from '../../steps/static/js/pga_jobstep.ui';
import getApiInstance from '../../../../../../static/js/api_instance';
import pgAdmin from 'sources/pgadmin';

define('pgadmin.node.pga_job', [
  'sources/gettext', 'sources/url_for', 'pgadmin.browser',
  'pgadmin.node.pga_jobstep', 'pgadmin.node.pga_schedule',
  'pgadmin.node.job_status_socket'
  // Add the job_status_socket module as a dependency
], function(gettext, url_for, pgBrowser, jobStatusSocket) {

  if (!pgBrowser.Nodes['coll-pga_job']) {
    pgBrowser.Nodes['coll-pga_job'] =
      pgBrowser.Collection.extend({
        node: 'pga_job',
        label: gettext('pga_jobs'),
        type: 'coll-pga_job',
        columns: ['jobid', 'jobname', 'jobenabled', 'jlgstatus', 'jobnextrun', 'joblastrun', 'jobdesc'],
        hasStatistics: false,
        canDrop: true,
        canDropCascade: false,
      });
  }

  if (!pgBrowser.Nodes['pga_job']) {
    pgBrowser.Nodes['pga_job'] = pgBrowser.Node.extend({
      parent_type: 'server',
      type: 'pga_job',
      dialogHelp: url_for('help.static', {'filename': 'pgagent_jobs.html'}),
      hasSQL: true,
      hasDepends: false,
      hasStatistics: true,
      hasCollectiveStatistics: true,
      width: '80%',
      height: '80%',
      canDrop: true,
      label: gettext('pgAgent Job'),
      node_image: function() {
        return 'icon-pga_job';
      },
      
      Init: function() {
        /* Avoid multiple registrations of menus */
        if (this.initialized)
          return;

        this.initialized = true;
        pgBrowser.add_menus([{
          name: 'create_pga_job_on_coll', node: 'coll-pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_obj_properties',
          category: 'create', priority: 4, label: gettext('pgAgent Job...'),
          data: {action: 'create'},
        },{
          name: 'create_pga_job', node: 'pga_job', module: this,
          applies: ['object', 'context'], callback: 'show_obj_properties',
          category: 'create', priority: 4, label: gettext('pgAgent Job...'),
          data: {action: 'create'},
        }, {
          name: 'run_now_pga_job', node: 'pga_job', module: this,
          applies: ['object', 'context'], callback: 'run_pga_job_now',
          priority: 4, label: gettext('Run now'), data: {action: 'create'},
        }]);

        // Initialize WebSocket connection when the module is initialized
        jobStatusSocket.initialize();
      },
      
      getSchema: function(treeNodeInfo, itemNodeData) {
        return new PgaJobSchema(
          {
            jobjclid: ()=>getNodeAjaxOptions('classes', this, treeNodeInfo, itemNodeData, {
              cacheLevel: 'server',
              cacheNode: 'server'
            })
          },
          () => getNodePgaJobStepSchema(treeNodeInfo, itemNodeData),
        );
      },
      
      /* Run pgAgent job now */
      run_pga_job_now: function(args) {
        let input = args || {},
        obj = this,
        t = pgBrowser.tree,
        i = input.item || t.selected(),
        d = i ? t.itemData(i) : undefined;
        
        if (d) {
          getApiInstance().put(
            obj.generate_url(i, 'run_now', d, true),
          ).then(({data: res})=> {
            pgAdmin.Browser.notifier.success(res.info);
            t.unload(i);
            
            // Register the server for job status updates after running the job
            if (d._pid && d._pid._parent_id) {
              jobStatusSocket.registerServer(d._pid._parent_id);
            }
          }).catch(function(error) {
            pgAdmin.Browser.notifier.pgRespErrorNotify(error);
            t.unload(i);
          });
        }

        return false;
      },
    });

    // ✅ Add WebSocket Integration for Job Status Updates

    // Ensure the job node exists before modifying callbacks
    if (pgBrowser.Nodes['pga_job']) {
      var jobNode = pgBrowser.Nodes['pga_job'];

      // Save the original callbacks
      var origCallbacks = jobNode.callbacks || {};

      // Override the refresh callback
      jobNode.callbacks = {
        ...origCallbacks,

        refresh: function(args) {
          // Call the original refresh if it exists
          if (origCallbacks && origCallbacks.refresh) {
            origCallbacks.refresh(args);
          }

          // ✅ Initialize the job status WebSocket if not already done
          console.warn("📢 pgagent.js loaded, initializing WebSocket...");

          jobStatusSocket.initialize();

          // ✅ Register the server ID for updates
          if (args && args.item && args.item._pid) {
            var serverId = args.item._pid._parent_id;
            if (serverId) {
              jobStatusSocket.registerServer(serverId);
            }
          }
        }
      };

      // ✅ Add event listener for job status updates
      $(document).on('pgagent:job_status_update', function(e, data) {
        console.groupCollapsed("🔄 Job Status Update Received");
        console.log("📢 Data:", JSON.stringify(data, null, 2));
        console.groupEnd();
      
        if (pgBrowser.Nodes['pga_job'].grid) {
          console.log("🔄 Refreshing job grid...");
          pgBrowser.Nodes['pga_job'].grid.refresh();
        }
      
        if (pgBrowser.Nodes['pga_jobstep'] && pgBrowser.Nodes['pga_jobstep'].grid) {
          console.log("🔄 Refreshing job step grid...");
          pgBrowser.Nodes['pga_jobstep'].grid.refresh();
        }
      });
      
    }
  }

  return pgBrowser.Nodes['pga_job'];
});
