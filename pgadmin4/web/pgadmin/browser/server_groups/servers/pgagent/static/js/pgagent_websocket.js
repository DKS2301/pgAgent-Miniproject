////////////////////////////////////////////////////////////////
//
//      WebSocket Handler for PgAgent Notifications
//
////////////////////////////////////////////////////////////////

define([
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore',
  'sources/pgadmin', 'pgadmin.browser'
], function(gettext, url_for, $, _, pgAdmin, pgBrowser) {
    
  var pgAgentSocket = {
    socket: null,
    serverIdJobMapping: {},
    
    // Initialize WebSocket connection
    init: function(server_id) {
      var baseUrl = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      var port = window.location.port ? `:${window.location.port}` : '';
      var url = `${baseUrl}//${window.location.hostname}${port}${url_for('pgagent.job_status_events')}/${server_id}`;
      
      if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
        this.socket.close();
      }
      
      this.socket = new WebSocket(url);
      
      this.socket.onopen = function() {
        console.warn('PgAgent status WebSocket connected');
      };
      
      this.socket.onclose = function() {
        console.warn('PgAgent status WebSocket disconnected');
        // Try to reconnect after 5 seconds
        setTimeout(function() {
          pgAgentSocket.init(server_id);
        }, 5000);
      };
      
      this.socket.onmessage = function(event) {
        var data = JSON.parse(event.data);
        
        if (data.job_id && data.status) {
          // Refresh the specific job's status in the UI
          pgAgentSocket.refreshJobStatus(data.job_id, data.status, data.timestamp);
          
          // If we have the jobs grid open, refresh it
          if (pgBrowser.tree.selected() && 
            pgBrowser.tree.selected().match(/pgagent/)) {
            pgAgentSocket.refreshJobsGrid();
          }
        }
      };
      
      this.socket.onerror = function(error) {
        console.error('PgAgent WebSocket error:', error);
      };
      
      this.serverIdJobMapping[server_id] = true;
    },
    
    // Refresh status for a specific job
    refreshJobStatus: function(job_id, status, timestamp) {
      // Update job status in grid if displayed
      var grid = $('.pgagent-jobs-grid');
      if (grid.length > 0) {
        var row = grid.find(`tr[data-job-id="${job_id}"]`);
        if (row.length > 0) {
          row.find('.job-status').text(status);
          row.find('.job-timestamp').text(timestamp);
          
          // Highlight the row briefly to show it's been updated
          row.addClass('updated-row');
          setTimeout(function() {
            row.removeClass('updated-row');
          }, 2000);
        }
      }
        
      // If we're on the job details page for this job, refresh that too
      if ($(`#jobDetailsPanel_${job_id}`).length > 0) {
        pgAgentSocket.refreshJobDetails(job_id);
      }
    },
    
    // Refresh the entire jobs grid
    refreshJobsGrid: function() {
      if (pgBrowser.Nodes['job']) {
        var view = pgBrowser.Nodes['job'].grid;
        if (view) {
          view.refresh();
        }
      }
    },
    
    // Refresh job details panel
    refreshJobDetails: function(job_id) {
      // This function will depend on how your job details panel works
      // One approach: trigger a click on the refresh button
      $(`#jobDetailsPanel_${job_id} .refresh-btn`).trigger('click');  
    },
    
    // Cleanup WebSocket connection
    cleanup: function(server_id) {
      if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
        this.socket.close();
      }
      
      if (this.serverIdJobMapping[server_id]) {
        delete this.serverIdJobMapping[server_id];
      }
    }
  };
  
  return pgAgentSocket;
});