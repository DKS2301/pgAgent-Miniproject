import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import gettext from 'sources/gettext';
import url_for from 'sources/url_for';
import getApiInstance from 'sources/api_instance';
import { 
  Box, 
  FormControl, 
  InputLabel, 
  MenuItem, 
  Select, 
  TextField, 
  Button, 
  Paper, 
  Grid,
  Autocomplete,
} from '@mui/material';
import PgTable from 'sources/components/PgTable';
import { PgIconButton } from '../../../static/js/components/Buttons';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import EmptyPanelMessage from '../../../static/js/components/EmptyPanelMessage';
import { InputDateTimePicker } from '../../../static/js/components/FormComponents';
import { useTheme } from '@mui/material/styles';

// Define styles using theme
const getStyles = (theme) => ({
  filterContainer: {
    marginBottom: theme.spacing(2),
    padding: theme.spacing(2),
    backgroundColor: theme.palette.background.default,
    borderRadius: theme.shape.borderRadius,
    boxShadow: theme.shadows[1],
  },
  filterGrid: {
    marginBottom: theme.spacing(2),
  },
  filterItem: {
    minWidth: '200px',
  },
  filterActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
  },
  filterButton: {
    textTransform: 'none',
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(1, 2),
  },
  filterTitle: {
    fontSize: theme.typography.h6.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.palette.primary.main,
    marginBottom: theme.spacing(2),
    borderBottom: `1px solid ${theme.palette.divider}`,
    paddingBottom: theme.spacing(1),
  },
  filterLabel: {
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.palette.text.primary,
  },
  filterSelect: {
    '& .MuiOutlinedInput-root': {
      borderRadius: theme.shape.borderRadius,
      backgroundColor: theme.palette.background.paper,
    },
  },
  filterInput: {
    '& .MuiOutlinedInput-root': {
      borderRadius: theme.shape.borderRadius,
      backgroundColor: theme.palette.background.paper,
    },
  },
  tableContainer: {
    flex: 1,
    overflow: 'auto',
    borderRadius: theme.shape.borderRadius,
    boxShadow: theme.shadows[1],
  },
  headerCell: {
    fontWeight: theme.typography.fontWeightBold,
    backgroundColor: theme.palette.background.default,
  },
  title: {
    marginBottom: theme.spacing(2),
    fontWeight: theme.typography.fontWeightBold,
    color: theme.palette.text.primary,
  },
});

function AuditLog({ sid, pageVisible }) {
  const theme = useTheme();
  const styles = getStyles(theme);
  const api = getApiInstance();
  
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Filter states
  const [operation, setOperation] = useState('');
  const [username, setUsername] = useState('');
  const [jobname, setJobname] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // For job name dropdown
  const [jobNames, setJobNames] = useState([]);
  const [uniqueUsernames, setUniqueUsernames] = useState([]);

  // Fetch all job names for the dropdown
  const fetchJobNames = () => {
    if (!sid) return;
    
    // First fetch actual job names from the database
    api({
      url: url_for('dashboard.job_names', {'sid': sid}),
      method: 'GET',
    })
      .then((jobRes) => {
        // Create a map of job IDs to job names
        const jobNameMap = new Map();
        jobRes.data.forEach(job => {
          jobNameMap.set(job.jobid, job.jobname);
        });
        
        // Now fetch audit logs to get usernames
        return api({
          url: url_for('dashboard.audit_logs', {'sid': sid}),
          method: 'GET',
        })
          .then((auditRes) => {
            // Extract unique usernames
            const usernames = [...new Set(auditRes.data.map(log => log.operation_user))];
            setUniqueUsernames(usernames);
            
            // Get unique job IDs from audit logs
            const uniqueJobIds = [...new Set(auditRes.data.map(log => log.job_id))];
            
            // Create dropdown options
            const jobNameOptions = [];
            
            // First add all jobs with names from the database
            uniqueJobIds.forEach(id => {
              if (jobNameMap.has(id)) {
                const jobName = jobNameMap.get(id);
                jobNameOptions.push({
                  id: id,
                  name: jobName,
                  display: jobName
                });
              } else if (id) {
                // For jobs without names, just use the ID
                jobNameOptions.push({
                  id: id,
                  name: `Job ID: ${id}`,
                  display: `Job ID: ${id}`
                });
              }
            });
            
            // Sort by job name
            jobNameOptions.sort((a, b) => a.display.localeCompare(b.display));
            
            setJobNames(jobNameOptions);
          });
      })
      .catch((err) => {
        console.error('Failed to fetch job names:', err);
        
        // Fallback to just fetching audit logs
        api({
          url: url_for('dashboard.audit_logs', {'sid': sid}),
          method: 'GET',
        })
          .then((res) => {
            // Extract unique usernames
            const usernames = [...new Set(res.data.map(log => log.operation_user))];
            setUniqueUsernames(usernames);
            
            // Extract job IDs as fallback
            const uniqueJobIds = [...new Set(res.data.map(log => log.job_id))];
            const jobNameOptions = uniqueJobIds
              .filter(id => id)
              .map(id => ({
                id: id,
                name: `Job ID: ${id}`,
                display: `Job ID: ${id}`
              }));
            
            setJobNames(jobNameOptions);
          })
          .catch(() => {
            console.error('Failed to fetch audit logs as fallback');
          });
      });
  };


  const fetchAuditLogs = () => {
    if (!sid) return;
    
    setLoading(true);
    setError(null);
    
    let params = new URLSearchParams();
    if (operation) params.append('operation', operation);
    if (username) params.append('username', username);
    if (jobname) params.append('jobname', jobname);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const url = url_for('dashboard.audit_logs', {'sid': sid}) + '?' + params.toString();
    
    api({
      url: url,
      method: 'GET',
    })
      .then((res) => {
        setAuditLogs(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch audit logs');
        setLoading(false);
      });
  };

  useEffect(() => {
    if (pageVisible) {
      fetchJobNames();
      fetchAuditLogs();
    }
  }, [pageVisible, sid]);

  const handleCopyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        // Success notification could be added here
      })
      .catch((err) => {
        console.error('Failed to copy text: ', err);
      });
  };

  const handleReset = () => {
    setOperation('');
    setUsername('');
    setJobname('');
    setStartDate('');
    setEndDate('');
  };

  const columns = [
    {
      accessorKey: 'audit_id',
      header: gettext('ID'),
      enableSorting: true,
      enableResizing: true,
      size: 80,
    },
    {
      accessorKey: 'operation_time',
      header: gettext('Timestamp'),
      enableSorting: true,
      enableResizing: true,
      size: 180,
    },
    {
      accessorKey: 'operation_type',
      header: gettext('Operation'),
      enableSorting: true,
      enableResizing: true,
      size: 100,
    },
    {
      accessorKey: 'job_id',
      header: gettext('Job ID'),
      enableSorting: true,
      enableResizing: true,
      size: 80,
    },
    {
      accessorKey: 'operation_user',
      header: gettext('Username'),
      enableSorting: true,
      enableResizing: true,
      size: 120,
    },
    {
      accessorKey: 'additional_info',
      header: gettext('Additional Info'),
      enableSorting: true,
      enableResizing: true,
      minSize: 200,
    },
    {
      id: 'actions',
      header: gettext('Actions'),
      enableSorting: false,
      enableResizing: false,
      size: 80,
      cell: ({ row }) => {
        const logEntry = JSON.stringify(row.original, null, 2);
        return (
          <PgIconButton
            title={gettext('Copy to clipboard')}
            icon={<ContentCopyIcon />}
            size="xs"
            onClick={() => handleCopyToClipboard(logEntry)}
          />
        );
      },
    },
  ];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Paper sx={styles.filterContainer}>
        <Grid container spacing={2} sx={styles.filterGrid}>
          {/* Job Name Dropdown */}
          <Grid item xs={12} sm={6} md={4}>
            <Autocomplete
              options={jobNames}
              value={jobNames.find(option => option.id === parseInt(jobname)) || 
                    jobNames.find(option => option.name === jobname) || null}
              onChange={(event, newValue) => setJobname(newValue ? newValue.id.toString() : '')}
              getOptionLabel={(option) => option.name || ''}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  label={gettext('Job Name')} 
                  size="medium"
                  fullWidth
                  sx={styles.filterInput}
                  InputLabelProps={{
                    shrink: true,
                    sx: styles.filterLabel
                  }}
                />
              )}
              ListboxProps={{
                style: { 
                  maxHeight: '200px',
                  fontSize: '0.875rem' // Smaller font size for dropdown values
                }
              }}
              renderOption={(props, option) => (
                <li {...props} style={{ fontSize: '0.875rem' }}>
                  {option.name}
                </li>
              )}
            />
          </Grid>
          
          {/* Username Dropdown */}
          <Grid item xs={12} sm={6} md={4}>
            <Autocomplete
              options={uniqueUsernames}
              value={username}
              onChange={(event, newValue) => setUsername(newValue || '')}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  label={gettext('Username')} 
                  size="medium"
                  fullWidth
                  sx={styles.filterInput}
                  InputLabelProps={{
                    shrink: true,
                    sx: styles.filterLabel
                  }}
                />
              )}
              ListboxProps={{
                style: { maxHeight: '200px' }
              }}
            />
          </Grid>
          
          {/* Operation Type Dropdown */}
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth size="small" sx={styles.filterSelect}>
              <InputLabel id="operation-label" shrink sx={styles.filterLabel}>
                {gettext('Operation Type')}
              </InputLabel>
              <Select
                labelId="operation-label"
                value={operation}
                label={gettext('Operation Type')}
                onChange={(e) => setOperation(e.target.value)}
                notched
              >
                <MenuItem value="">{gettext('All Operations')}</MenuItem>
                <MenuItem value="CREATE">{gettext('CREATE')}</MenuItem>
                <MenuItem value="MODIFY">{gettext('MODIFY')}</MenuItem>
                <MenuItem value="DELETE">{gettext('DELETE')}</MenuItem>
                <MenuItem value="EXECUTE">{gettext('EXECUTE')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          
          {/* Start Date Picker */}
          <Grid item xs={12} sm={6} md={4}>
            <InputDateTimePicker
              value={startDate}
              onChange={setStartDate}
              controlProps={{
                pickerType: 'DateTime',
                format: 'yyyy-MM-dd HH:mm:ss',
                placeholder: 'yyyy-MM-dd HH:mm:ss'
              }}
              label={gettext('Start Date')}
              size="medium"
              fullWidth
              sx={styles.filterInput}
            />
          </Grid>
          
          {/* End Date Picker */}
          <Grid item xs={12} sm={6} md={4}>
            <InputDateTimePicker
              value={endDate}
              onChange={setEndDate}
              controlProps={{
                pickerType: 'DateTime',
                format: 'yyyy-MM-dd HH:mm:ss',
                placeholder: 'yyyy-MM-dd HH:mm:ss'
              }}
              label={gettext('End Date')}
              size="medium"
              fullWidth
              sx={styles.filterInput}
            />
          </Grid>
        </Grid>
        
        <Box sx={styles.filterActions}>
          <Button 
            variant="contained" 
            onClick={fetchAuditLogs} 
            startIcon={<FilterAltIcon />}
            sx={{
              ...styles.filterButton,
              backgroundColor: theme.palette.primary.main,
              '&:hover': {
                backgroundColor: theme.palette.primary.dark,
              }
            }}
            size="medium"
          >
            {gettext('Apply Filters')}
          </Button>
          <Button 
            variant="outlined" 
            onClick={handleReset}
            startIcon={<RestartAltIcon />}
            sx={{
              ...styles.filterButton,
              borderColor: theme.palette.primary.main,
              color: theme.palette.primary.main,
              '&:hover': {
                borderColor: theme.palette.primary.dark,
                backgroundColor: theme.palette.primary.light,
              }
            }}
            size="medium"
          >
            {gettext('Reset')}
          </Button>
        </Box>
      </Paper>
      
      {error ? (
        <Box sx={{ p: 2 }}>
          <EmptyPanelMessage text={error} />
        </Box>
      ) : (
        <Paper sx={styles.tableContainer}>
          <PgTable
            caveTable={false}
            tableNoBorder={false}
            columns={columns}
            data={auditLogs}
            isLoading={loading}
            enableColumnFilters={true}
            enableSorting={true}
            enablePagination={true}
            enableRowSelection={false}
            enableColumnResizing={true}
            initialState={{
              pagination: {
                pageSize: 10,
                pageIndex: 0
              },
              sorting: [
                {
                  id: 'operation_time',
                  desc: true
                }
              ]
            }}
            emptyTableText={gettext('No audit logs found')}
            tableClassName="audit-log-table"
            tableStyle={{
              borderCollapse: 'separate',
              borderSpacing: 0,
            }}
            getRowId={(row) => row.audit_id}
          />
        </Paper>
      )}
    </Box>
  );
}

AuditLog.propTypes = {
  sid: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  treeNodeInfo: PropTypes.object.isRequired,
  pageVisible: PropTypes.bool.isRequired,
};

export default AuditLog;