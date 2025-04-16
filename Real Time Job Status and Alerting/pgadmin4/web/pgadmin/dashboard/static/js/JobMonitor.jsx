/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2025, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { 
  Box, 
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Grid2,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
  Avatar
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import moment from 'moment';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  ArcElement
} from 'chart.js';
import { Line, Bar, Pie } from 'react-chartjs-2';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import SportsScoreIcon from '@mui/icons-material/SportsScore';
import DisabledByDefaultIcon from '@mui/icons-material/DisabledByDefault';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FilterListIcon from '@mui/icons-material/FilterList';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ArticleIcon from '@mui/icons-material/Article';
import CloseIcon from '@mui/icons-material/Close';
import SectionContainer from './components/SectionContainer';
import getApiInstance from 'sources/api_instance';
import url_for from 'sources/url_for';
import { useInterval } from 'sources/custom_hooks';
import RefreshButton from './components/RefreshButtons';
import EmptyPanelMessage from '../../../static/js/components/EmptyPanelMessage';
import gettext from 'sources/gettext';
import { io } from 'socket.io-client';
import pgBrowser from 'sources/pgadmin';
import pgAdmin from 'sources/pgadmin';

// Helper functions
const formatDateTime = (dateTimeStr) => {
  if (!dateTimeStr) return '-';
  return moment(dateTimeStr).format('YYYY-MM-DD HH:mm:ss');
};

const formatDuration = (durationSecs) => {
  if (!durationSecs) return '-';
  
  const duration = parseFloat(durationSecs);
  if (isNaN(duration)) return '-';
  
  if (duration < 60) {
    return `${duration.toFixed(2)} ${gettext('seconds')}`;
  } else if (duration < 3600) {
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes} ${gettext('min')} ${seconds.toFixed(0)} ${gettext('sec')}`;
  } else {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    return `${hours} ${gettext('hr')} ${minutes} ${gettext('min')}`;
  }
};

const StatCardItem = ({ title, value, status, icon }) => {
  const theme = useTheme();
  
  return (
    <Grid2 item xs={12} sm={6} md={4} lg={3}>
      <Card 
        sx={{ 
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing(3),
          height: '100%',
          minHeight: 140,
          borderTop: `4px solid ${status === 'total' ? theme.palette.info.main :
                                  status === 'enabled' ? theme.palette.success.main :
                                  status === 'disabled' ? theme.palette.warning.main :
                                  status === 'running' ? theme.palette.primary.main :
                                  status === 'success' ? theme.palette.success.main :
                                  status === 'failed' ? theme.palette.error.main :
                                  theme.palette.grey[500]}`,
          borderRadius: theme.shape.borderRadius,
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
          boxShadow: theme.shadows[2],
          transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: theme.shadows[4],
            backgroundColor: alpha(status === 'total' ? theme.palette.info.main :
                                  status === 'enabled' ? theme.palette.success.main :
                                  status === 'disabled' ? theme.palette.warning.main :
                                  status === 'running' ? theme.palette.primary.main :
                                  status === 'success' ? theme.palette.success.main :
                                  status === 'failed' ? theme.palette.error.main :
                                  theme.palette.grey[500], 0.05),
          }
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {icon && (
            <Box sx={{ mb: 2 }}>
              {React.cloneElement(icon, { fontSize: 'large', style: { fontSize: '2.5rem' } })}
            </Box>
          )}
          <Typography 
            variant="h3"
            component="div" 
            sx={{ 
              fontWeight: 'bold',
              color: theme.palette.text.primary,
              mb: 1
            }}
          >
            {value}
          </Typography>
          <Typography 
            variant="body1"
            sx={{ 
              textAlign: 'center',
              color: theme.palette.text.secondary
            }}
          >
            {title}
          </Typography>
        </Box>
      </Card>
    </Grid2>
  );
};

const JobStatusChip = ({ label, status, size = 'medium', icon }) => {
  const theme = useTheme();
  
  // Get color based on status
  const getStatusColor = (status) => {
    if (typeof status === 'string') {
      const statusLower = status.toLowerCase();
      
      if (status === 'r' || statusLower === 'running') {
        return {
          color: theme.palette.primary.main,
          bgColor: alpha(theme.palette.primary.main, 0.1)
        };
      } else if (status === 's' || statusLower === 'success') {
        return {
          color: theme.palette.success.main,
          bgColor: alpha(theme.palette.success.main, 0.1)
        };
      } else if (status === 'f' || statusLower === 'failed') {
        return {
          color: theme.palette.error.main,
          bgColor: alpha(theme.palette.error.main, 0.1)
        };
      } else if (status === 'd' || statusLower === 'disabled') {
        return {
          color: theme.palette.warning.main,
          bgColor: alpha(theme.palette.warning.main, 0.1)
        };
      } else if (statusLower === 'internal error' || statusLower === 'aborted') {
        return {
          color: theme.palette.error.main,
          bgColor: alpha(theme.palette.error.main, 0.1)
        };
      }
    }
    
    // Default
    return {
      color: theme.palette.grey[600],
      bgColor: alpha(theme.palette.grey[600], 0.1)
    };
  };
  
  const { color, bgColor } = getStatusColor(status);
  
  return (
    <Chip
      label={label}
      size={size}
      icon={icon}
      sx={{
        color: color,
        backgroundColor: bgColor,
        borderColor: alpha(color, 0.3),
        fontWeight: 'medium',
        '& .MuiChip-icon': {
          color: color
        }
      }}
    />
  );
};

JobStatusChip.propTypes = {
  label: PropTypes.string.isRequired,
  status: PropTypes.string,
  size: PropTypes.oneOf(['small', 'medium']),
  icon: PropTypes.node
};

const StyledProgressBar = (props) => {
  const theme = useTheme();
  const getStatusColor = () => {
    switch(props.status?.toLowerCase()) {
      case 'running': return theme.palette.primary.main;
      case 'success': 
      case 'enabled': return theme.palette.success.main;
      case 'failed': 
      case 'aborted': 
      case 'internal error': return theme.palette.error.main;
      case 'disabled': return theme.palette.warning.main;
      default: return theme.palette.grey[500];
    }
  };
  
  return (
    <LinearProgress 
      {...props}
      sx={{ 
        height: 8,
        borderRadius: 4,
        backgroundColor: alpha(getStatusColor(), 0.2),
        '& .MuiLinearProgress-bar': {
          backgroundColor: getStatusColor(),
        },
        ...props.sx
      }}
    />
  );
};

StyledProgressBar.propTypes = {
  status: PropTypes.string,
  sx: PropTypes.object
};

const JobDetailsPanel = (props) => {
  const theme = useTheme();
  const getStatusColor = () => {
    switch(props.status?.toLowerCase()) {
      case 'running': return theme.palette.primary.main;
      case 'success': 
      case 'enabled': return theme.palette.success.main;
      case 'failed': 
      case 'aborted': 
      case 'internal error': return theme.palette.error.main;
      case 'disabled': return theme.palette.warning.main;
      default: return theme.palette.grey[500];
    }
  };
  
  return (
    <Paper 
      {...props}
      sx={{ 
        padding: theme.spacing(2),
        marginBottom: theme.spacing(2),
        borderLeft: `4px solid ${getStatusColor()}`,
        boxShadow: theme.shadows[1],
        ...props.sx
      }}
    >
      {props.children}
    </Paper>
  );
};

JobDetailsPanel.propTypes = {
  status: PropTypes.string,
  sx: PropTypes.object,
  children: PropTypes.node
};

const ScrollableContainer = (props) => {
  const theme = useTheme();
  
  return (
    <Box 
      {...props}
      sx={{ 
        height: 'calc(100vh - 100px)',
        width: '100%',
        maxWidth: '1800px',
        margin: '0 auto',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: theme.spacing(3),
        '&::-webkit-scrollbar': {
          width: '8px',
          height: '8px',
        },
        '&::-webkit-scrollbar-track': {
          background: theme.palette.background.default,
          borderRadius: '4px',
        },
        '&::-webkit-scrollbar-thumb': {
          background: theme.palette.mode === 'dark' 
            ? theme.palette.grey[700] 
            : theme.palette.grey[400],
          borderRadius: '4px',
        },
        '&::-webkit-scrollbar-thumb:hover': {
          background: theme.palette.mode === 'dark' 
            ? theme.palette.grey[600] 
            : theme.palette.grey[500],
        }
      }}
    >
      {props.children}
    </Box>
  );
};

ScrollableContainer.propTypes = {
  children: PropTypes.node
};

const ChartContainer = (props) => {
  const theme = useTheme();
  
  return (
    <Box 
      {...props}
      sx={{ 
        height: 400,
        padding: theme.spacing(3),
        backgroundColor: theme.palette.background.paper,
        borderRadius: theme.shape.borderRadius,
        boxShadow: theme.shadows[1],
      }}
    >
      {props.children}
    </Box>
  );
};

ChartContainer.propTypes = {
  children: PropTypes.node
};

const JobRow = ({ job, onViewLog }) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  
  const handleExpandClick = () => {
    setExpanded(!expanded);
  };
  
  // Determine job status color and icon
  const getStatusInfo = (status) => {
    // Handle both status codes and status names
    if (typeof status === 'string') {
      const statusLower = status.toLowerCase();
      
      if (status === 'r' || statusLower === 'running') {
        return {
          color: theme.palette.primary.main,
          icon: <PlayArrowIcon />,
          label: gettext('Running')
        };
      } else if (status === 's' || statusLower === 'success') {
        return {
          color: theme.palette.success.main,
          icon: <CheckCircleIcon />,
          label: gettext('Success')
        };
      } else if (status === 'f' || statusLower === 'failed') {
        return {
          color: theme.palette.error.main,
          icon: <ErrorIcon />,
          label: gettext('Failed')
        };
      } else if (status === 'd' || statusLower === 'disabled') {
        return {
          color: theme.palette.warning.main,
          icon: <PauseCircleIcon />,
          label: gettext('Disabled')
        };
      } else if (statusLower === 'enabled') {
        return {
          color: theme.palette.success.main,
          icon: <CheckCircleIcon />,
          label: gettext('Enabled')
        };
      } else if (statusLower === 'internal error' || statusLower === 'aborted') {
        return {
          color: theme.palette.error.main,
          icon: <ErrorIcon />,
          label: statusLower === 'internal error' ? gettext('Internal Error') : gettext('Aborted')
        };
      }
    }
    
    // Default
    return {
      color: theme.palette.text.secondary,
      icon: <HelpOutlineIcon />,
      label: gettext('Unknown')
    };
  };
  
  // Check if job has a status field, otherwise use jobstatus
  const jobStatus = job.status || job.jobstatus || 'Unknown';
  const statusInfo = getStatusInfo(jobStatus);
  const isRunning = jobStatus === 'r' || jobStatus.toLowerCase() === 'running';
  const hasError = jobStatus === 'f' || jobStatus.toLowerCase() === 'failed' || 
                  jobStatus.toLowerCase() === 'internal error' || 
                  jobStatus.toLowerCase() === 'aborted';
  
  return (
    <Paper 
      elevation={1} 
      sx={{ 
        mb: 2, 
        overflow: 'hidden',
        borderLeft: '4px solid',
        borderColor: statusInfo.color
      }}
    >
      <Box sx={{ p: 2 }}>
        <Grid2 container spacing={2} alignItems="center">
          <Grid2 item>
            <Avatar 
              sx={{ 
                bgcolor: alpha(statusInfo.color, 0.1),
                color: statusInfo.color
              }}
            >
              {statusInfo.icon}
            </Avatar>
          </Grid2>
          <Grid2 item xs>
            <Typography variant="h6" component="div">
              {job.jobname}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {job.jobdesc || gettext('No description')}
            </Typography>
            
            {/* Display job details like start time and duration if available */}
            {(job.start_time || job.duration) && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {job.start_time && (
                  <Chip
                    size="small"
                    icon={<AccessTimeIcon fontSize="small" />}
                    label={formatDateTime(job.start_time)}
                    variant="outlined"
                    sx={{ color: theme.palette.text.secondary }}
                  />
                )}
                {job.duration && (
                  <Chip
                    size="small"
                    icon={<ScheduleIcon fontSize="small" />}
                    label={formatDuration(job.duration)}
                    variant="outlined"
                    sx={{ color: theme.palette.text.secondary }}
                  />
                )}
              </Box>
            )}
          </Grid2>
          <Grid2 item>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <JobStatusChip 
                label={statusInfo.label} 
                status={jobStatus} 
              />
              
              <Box sx={{ ml: 1 }}>
                {hasError && (
                  <Tooltip title={gettext('View Log')}>
                    <IconButton 
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewLog(job);
                      }}
                      sx={{ 
                        color: theme.palette.error.main,
                        '&:hover': {
                          bgcolor: alpha(theme.palette.error.main, 0.1)
                        }
                      }}
                    >
                      <ArticleIcon />
                    </IconButton>
                  </Tooltip>
                )}
                
                <Tooltip title={expanded ? gettext('Hide Details') : gettext('Show Details')}>
                  <IconButton
                    onClick={handleExpandClick}
                    aria-expanded={expanded}
                    aria-label="show more"
                    size="small"
                  >
                    {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Grid2>
        </Grid2>
        
        {/* Progress bar for running jobs */}
        {isRunning && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                {gettext('Progress')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {`${Math.round(job.progress || 0)}%`}
              </Typography>
            </Box>
            <LinearProgress 
              variant="determinate" 
              value={job.progress || 0}
              sx={{
                height: 8,
                borderRadius: 4,
                backgroundColor: alpha(theme.palette.primary.main, 0.2),
                '& .MuiLinearProgress-bar': {
                  backgroundColor: theme.palette.primary.main,
                }
              }}
            />
          </Box>
        )}
      </Box>
      
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Divider />
        <Box sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5) }}>
          <Grid2 container spacing={2}>
            <Grid2 item xs={12} sm={6} md={3}>
              <Typography variant="subtitle2" color="text.secondary">
                {gettext('ID')}
              </Typography>
              <Typography variant="body2">
                {job.jobid}
              </Typography>
            </Grid2>
            <Grid2 item xs={12} sm={6} md={3}>
              <Typography variant="subtitle2" color="text.secondary">
                {gettext('Last Run')}
              </Typography>
              <Typography variant="body2">
                {job.start_time ? formatDateTime(job.start_time) : gettext('Never')}
              </Typography>
            </Grid2>
            <Grid2 item xs={12} sm={6} md={3}>
              <Typography variant="subtitle2" color="text.secondary">
                {gettext('Next Run')}
              </Typography>
              <Typography variant="body2">
                {job.jobnextrun || job.next_run ? formatDateTime(job.jobnextrun || job.next_run) : 
                 job.jobenabled ? gettext('Not scheduled') : gettext('Job disabled')}
              </Typography>
            </Grid2>
            <Grid2 item xs={12} sm={6} md={3}>
              <Typography variant="subtitle2" color="text.secondary">
                {gettext('Enabled')}
              </Typography>
              <Typography variant="body2">
                {job.jobenabled !== undefined ? (job.jobenabled ? gettext('Yes') : gettext('No')) : 
                 (jobStatus.toLowerCase() === 'enabled' ? gettext('Yes') : 
                  jobStatus.toLowerCase() === 'disabled' ? gettext('No') : gettext('Unknown'))}
              </Typography>
            </Grid2>
          </Grid2>
          
          {/* Current step information */}
          {job.current_step && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                {gettext('Current Step')}
              </Typography>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.7) }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">
                    {job.current_step}
                  </Typography>
                  {job.current_step_status && (
                    <JobStatusChip 
                      label={getStatusInfo(job.current_step_status).label} 
                      status={job.current_step_status} 
                      size="small"
                    />
                  )}
                </Box>
              </Paper>
            </Box>
          )}
          
          {hasError && (
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                color="error"
                startIcon={<ArticleIcon />}
                size="small"
                onClick={() => onViewLog(job)}
              >
                {gettext('View Detailed Log')}
              </Button>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

JobRow.propTypes = {
  job: PropTypes.object.isRequired,
  onViewLog: PropTypes.func.isRequired
};

const TabPanel = (props) => {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`job-tabpanel-${index}`}
      aria-labelledby={`job-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ pt: 2 }}>
          {children}
        </Box>
      )}
    </div>
  );
};
  
TabPanel.propTypes = {
  children: PropTypes.node,
  index: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
};

// Add this function at the component level to format error messages
const formatErrorMessage = (description) => {
  if (!description) return '';
  
  // Extract the error message between ERROR: and LINE if present
  const errorMatch = description.match(/ERROR:\s*(.*?)(?=LINE|$)/i);
  if (errorMatch) {
    return errorMatch[1].trim();
  }
  
  // If no ERROR: pattern, return the first 100 characters
  return description.slice(0, 100) + (description.length > 100 ? '...' : '');
};

export default function JobMonitor({sid, node, preferences, treeNodeInfo, nodeData, pageVisible = true}) {
  const [jobData, setJobData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [chartTabValue, setChartTabValue] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [jobLogDialogOpen, setJobLogDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLog, setJobLog] = useState(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [dateRange, setDateRange] = useState({
    startDate: moment().subtract(30, 'days').toDate(),
    endDate: moment().toDate(),
  });
  const [dateRangeDialogOpen, setDateRangeDialogOpen] = useState(false);
  const [timeFilterAnchorEl, setTimeFilterAnchorEl] = useState(null);
  const timeFilterOpen = Boolean(timeFilterAnchorEl);
  const [selectedJobFilter, setSelectedJobFilter] = useState('all');
  const [jobFilterAnchorEl, setJobFilterAnchorEl] = useState(null);
  const jobFilterOpen = Boolean(jobFilterAnchorEl);
  const api = getApiInstance();
  const theme = useTheme();
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  
  // Initialize Chart.js
  useEffect(() => {
    ChartJS.register(
      CategoryScale,
      LinearScale,
      PointElement,
      LineElement,
      BarElement,
      ArcElement,
      Title,
      ChartTooltip,
      Legend
    );
  }, []);

  // Filter jobs by status
  const allJobs = useMemo(() => jobData?.jobs || [], [jobData]);
  const runningJobs = useMemo(() => 
    allJobs.filter(job => job.status === 'Running'), 
    [allJobs]
  );
  const successJobs = useMemo(() => 
    allJobs.filter(job => job.status === 'Success'), 
    [allJobs]
  );
  const failedJobs = useMemo(() => 
    allJobs.filter(job => job.status === 'Failed'), 
    [allJobs]
  );

  const [jobStatusFilter, setJobStatusFilter] = useState('all');
  
  // Get filtered jobs based on current status filter
  const filteredJobs = useMemo(() => {
    switch(jobStatusFilter) {
      case 'running':
        return runningJobs;
      case 'success':
        return successJobs;
      case 'failed':
        return failedJobs;
      default:
        return allJobs;
    }
  }, [jobStatusFilter, allJobs, runningJobs, successJobs, failedJobs]);

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const handleChartTabChange = (event, newValue) => {
    setChartTabValue(newValue);
  };

  // Handle time filter menu
  const handleTimeFilterClick = (event) => {
    setTimeFilterAnchorEl(event.currentTarget);
  };

  const handleTimeFilterClose = () => {
    setTimeFilterAnchorEl(null);
  };

  const handleTimeFilterSelect = (days) => {
    if (days === 'custom') {
      setDateRangeDialogOpen(true);
    } else {
      setDateRange({
        startDate: moment().subtract(days, 'days').toDate(),
        endDate: moment().toDate(),
      });
      fetchJobMonitorData(); // Refresh data when time filter changes
    }
    handleTimeFilterClose();
  };

  const handleDateRangeDialogClose = () => {
    setDateRangeDialogOpen(false);
  };

  const handleDateRangeApply = () => {
    if (dateRange.startDate && dateRange.endDate) {
      const startDate = moment(dateRange.startDate);
      const endDate = moment(dateRange.endDate);
      
      if (startDate.isAfter(endDate)) {
        setDateRange({
          startDate: endDate.toDate(),
          endDate: startDate.toDate(),
        });
      }
    }
    
    setDateRangeDialogOpen(false);
    fetchJobMonitorData(); // Refresh data when date range changes
  };

  // Process historical data for charts with date filtering
  const processedHistoryData = useMemo(() => {
    if (!jobData || !jobData.history || jobData.history.length === 0) {
      return [];
    }
    
    const startDateMoment = moment(dateRange.startDate).startOf('day');
    const endDateMoment = moment(dateRange.endDate).endOf('day');
    
    let filteredHistory = jobData.history;
    
    // Filter by selected job if not 'all'
    if (selectedJobFilter !== 'all') {
      filteredHistory = filteredHistory.filter(entry => entry.jlgjobid === selectedJobFilter);
    }
    
    return filteredHistory
      .filter(entry => {
        const entryDate = moment(entry.date);
        return entryDate.isBetween(startDateMoment, endDateMoment, null, '[]');
      })
      .map(entry => {
        const totalRuns = parseInt(entry.total_runs || 0);
        const successfulRuns = parseInt(entry.successful_runs || 0);
        const failedRuns = parseInt(entry.failed_runs || 0);
        
        // Calculate success and failure rates
        const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;
        const failureRate = totalRuns > 0 ? (failedRuns / totalRuns) * 100 : 0;
        
        // Format date for display
        const formattedDate = entry.date ? moment(entry.date).format('MM/DD') : '';
        
        // Convert duration from seconds to minutes for better visualization
        const averageDuration = entry.avg_duration ? parseFloat(entry.avg_duration) / 60 : 0;
        
        return {
          ...entry,
          formattedDate,
          successRate,
          failureRate,
          averageDuration,
          total_runs: totalRuns,
          successful_runs: successfulRuns,
          failed_runs: failedRuns
        };
      });
  }, [jobData, dateRange, selectedJobFilter]);
  console.log("Processed History Data :",processedHistoryData);

  const renderJobStats = () => {
    if (!jobData || !jobData.summary) {
      return (
        <Grid2 container spacing={3}>
          {[...Array(4)].map((_, i) => (
            <Grid2 item xs={12} sm={6} md={4} lg={3} key={i}>
              <Skeleton variant="rectangular" height={140} animation="wave" />
            </Grid2>
          ))}
        </Grid2>
      );
    }

    const summary = jobData.summary;
    
    return (
      <Grid2 container spacing={5}>
        <StatCardItem 
          title={gettext('Total Jobs')} 
          value={summary.total_jobs || 0} 
          status="total" 
          icon={<SportsScoreIcon color="primary" />}
        />
        <StatCardItem 
          title={gettext('Running Jobs')} 
          value={summary.running_jobs || 0} 
          status="running" 
          icon={<AccessTimeIcon color="warning" />}
        />
        <StatCardItem 
          title={gettext('Successful Jobs')} 
          value={summary.successful_jobs || 0} 
          status="success" 
          icon={<CheckCircleIcon color="success" />}
        />
        <StatCardItem 
          title={gettext('Failed Jobs')} 
          value={summary.failed_jobs || 0} 
          status="failed" 
          icon={<ErrorIcon color="error" />}
        />
        <StatCardItem 
          title={gettext('Disabled Jobs')} 
          value={summary.disabled_jobs || 0} 
          status="disabled" 
          icon={<DisabledByDefaultIcon color="disabled" />}
        />
      </Grid2>
    );
  };

  const renderJobTabs = () => {
    // Define the job status tabs
    const jobTabs = [
      { id: 'all', label: gettext('All Jobs'), icon: <SportsScoreIcon />, jobs: allJobs },
      { id: 'running', label: gettext('Running'), icon: <AccessTimeIcon />, jobs: runningJobs },
      { id: 'success', label: gettext('Successful'), icon: <CheckCircleIcon />, jobs: successJobs },
      { id: 'failed', label: gettext('Failed'), icon: <ErrorIcon />, jobs: failedJobs }
    ];

    return (
      <Box sx={{ width: '100%' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs 
            value={jobStatusFilter}
            onChange={(e, newValue) => setJobStatusFilter(newValue)}
            aria-label="job status tabs"
            indicatorColor="primary"
            textColor="primary"
          >
            {jobTabs.map((tab) => (
              <Tab 
                key={tab.id}
                value={tab.id}
                label={tab.label} 
                icon={tab.icon} 
                iconPosition="start"
                disabled={tab.id !== 'all' && (!tab.jobs || tab.jobs.length === 0)}
              />
            ))}
          </Tabs>
        </Box>
        
        <Box sx={{ mt: 2 }}>
          {renderJobList(filteredJobs)}
        </Box>
      </Box>
    );
  };

  const renderJobList = (jobs) => {
    if (!jobs || jobs.length === 0) {
      return (
        <Box sx={{ textAlign: 'center', padding: 4 }}>
          <EmptyPanelMessage text={gettext('No jobs found in this category')} />
        </Box>
      );
    }

    return (
      <Box sx={{ mt: 2 }}>
        {jobs.map((job) => (
          <JobRow key={job.jobid || job.jobname} job={job} onViewLog={handleViewLog} />
        ))}
      </Box>
    );
  };

  const renderCharts = () => {
    if (!jobData || !jobData.history || jobData.history.length === 0) {
      return (
        <Box sx={{ textAlign: 'center', padding: 4 }}>
          <EmptyPanelMessage text={gettext('No historical job data available for charts')} />
        </Box>
      );
    }
    
    // Define common chart options
    const commonChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: theme.palette.text.primary,
            font: {
              size: 12,
              weight: 'medium'
            },
            padding: 20,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        title: {
          display: true,
          color: theme.palette.text.primary,
          font: {
            size: 14,
            weight: 'medium'
          },
          padding: {
            top: 10,
            bottom: 10
          }
        },
        tooltip: {
          backgroundColor: theme.palette.background.paper,
          titleColor: theme.palette.text.primary,
          bodyColor: theme.palette.text.primary,
          borderColor: theme.palette.divider,
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          usePointStyle: true,
          callbacks: {
            label: function(context) {
              // Check if context.parsed and context.parsed.y exist before calling toFixed
              if (context.parsed && context.parsed.y !== undefined) {
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}`;
              } else if (context.raw !== undefined) {
                // Fallback to raw value if parsed is not available
                return `${context.dataset.label}: ${typeof context.raw === 'number' ? context.raw.toFixed(2) : context.raw}`;
              } else {
                // If no valid value is found
                return `${context.dataset.label}: N/A`;
              }
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: theme.palette.divider,
            drawBorder: false
          },
          ticks: {
            color: theme.palette.text.secondary,
            font: {
              size: 12
            },
            padding: 10
          }
        },
        x: {
          grid: {
            color: theme.palette.divider,
            drawBorder: false
          },
          ticks: {
            color: theme.palette.text.secondary,
            font: {
              size: 12
            },
            padding: 10
          }
        }
      }
    };

    // Update the job filter button text
    const selectedJobName = selectedJobFilter === 'all' 
      ? gettext('All Jobs') 
      : jobFilterOptions.find(job => job.id === selectedJobFilter)?.name || gettext('Job Filter');
    
    const selectedTimeFilter = dateRange.days === 'custom' ? gettext('Custom range...') : gettext(`Last ${dateRange.days} days`);
    console.log("Found Job :",jobFilterOptions.find(job => job.id === selectedJobFilter));
    
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'flex-end', 
          alignItems: 'center',
          borderBottom: 1, 
          borderColor: 'divider',
          pb: 1
        }}>
          <Box>
            <Button
              id="job-filter-button"
              aria-controls={jobFilterOpen ? 'job-filter-menu' : undefined}
              aria-haspopup="true"
              aria-expanded={jobFilterOpen ? 'true' : undefined}
              variant="outlined"
              size="small"
              startIcon={<FilterListIcon />}
              onClick={handleJobFilterClick}
              sx={{ textTransform: 'none' }}
            >
              {selectedJobName}
            </Button>
            <Menu
              id="job-filter-menu"
              anchorEl={jobFilterAnchorEl}
              open={jobFilterOpen}
              onClose={handleJobFilterClose}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
            >
              <MenuItem 
                onClick={() => handleJobFilterChange('all')}
                selected={selectedJobFilter === 'all'}
              >
                {gettext('All Jobs')}
              </MenuItem>
              {jobFilterOptions.map((job) => (
                <MenuItem 
                  key={job.id}
                  onClick={() => handleJobFilterChange(job.id)}
                  selected={selectedJobFilter === job.id}
                >
                  {job.name}
                </MenuItem>
              ))}
            </Menu>

            <Button
              id="time-filter-button"
              aria-controls={timeFilterOpen ? 'time-filter-menu' : undefined}
              aria-haspopup="true"
              aria-expanded={timeFilterOpen ? 'true' : undefined}
              variant="outlined"
              size="small"
              startIcon={<CalendarTodayIcon />}
              onClick={handleTimeFilterClick}
              sx={{ textTransform: 'none', ml: 1 }}
            >
              {gettext('Time Filter')}
            </Button>
            <Menu
              id="time-filter-menu"
              anchorEl={timeFilterAnchorEl}
              open={timeFilterOpen}
              onClose={handleTimeFilterClose}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
            >
              <MenuItem onClick={() => handleTimeFilterSelect(7)} >{gettext('Last 7 days')}</MenuItem>
              <MenuItem onClick={() => handleTimeFilterSelect(14)} >{gettext('Last 14 days')}</MenuItem>
              <MenuItem onClick={() => handleTimeFilterSelect(30)} >{gettext('Last 30 days')}</MenuItem>
              <MenuItem onClick={() => handleTimeFilterSelect(90)} >{gettext('Last 90 days')}</MenuItem>
              <MenuItem onClick={() => handleTimeFilterSelect('custom')} >{gettext('Custom range...')}</MenuItem>
            </Menu>
          </Box>
        </Box>
        
        <Grid2 container spacing={3}>
          {/* Success/Failure Rate Chart */}
          <Grid2 item xs={12} md={6}>
        <ChartContainer>
            <Line 
              data={{
                  labels: processedHistoryData.map(entry => entry.formattedDate),
                datasets: [
                  {
                    label: gettext('Success Rate (%)'),
                      data: processedHistoryData.map(entry => entry.successRate.toFixed(2)),
                      borderColor: theme.palette.success.main,
                      backgroundColor: alpha(theme.palette.success.main, 0.1),
                      tension: 0.4,
                      borderWidth: 2,
                      pointRadius: 4,
                      pointHoverRadius: 6
                  },
                  {
                    label: gettext('Failure Rate (%)'),
                      data: processedHistoryData.map(entry => entry.failureRate.toFixed(2)),
                      borderColor: theme.palette.error.main,
                      backgroundColor: alpha(theme.palette.error.main, 0.1),
                      tension: 0.4,
                      borderWidth: 2,
                      pointRadius: 4,
                      pointHoverRadius: 6
                  }
                ]
              }}
              options={{
                  ...commonChartOptions,
                plugins: {
                    ...commonChartOptions.plugins,
                  title: {
                      ...commonChartOptions.plugins.title,
                      text: gettext('Success/Failure Rate Over Time')
                  }
                }
              }}
            />
            </ChartContainer>
          </Grid2>
          
          {/* Job Runs Chart */}
          <Grid2 item xs={12} md={6}>
            <ChartContainer>
            <Bar 
              data={{
                  labels: processedHistoryData.map(entry => entry.formattedDate),
                datasets: [
                  {
                    label: gettext('Total Runs'),
                      data: processedHistoryData.map(entry => entry.total_runs),
                      backgroundColor: alpha(theme.palette.primary.main, 0.1),
                      borderColor: theme.palette.primary.main,
                      borderWidth: 1,
                      borderRadius: 4
                  },
                  {
                    label: gettext('Successful Runs'),
                      data: processedHistoryData.map(entry => entry.successful_runs),
                      backgroundColor: alpha(theme.palette.success.main, 0.1),
                      borderColor: theme.palette.success.main,
                      borderWidth: 1,
                      borderRadius: 4
                  },
                  {
                    label: gettext('Failed Runs'),
                      data: processedHistoryData.map(entry => entry.failed_runs),
                      backgroundColor: alpha(theme.palette.error.main, 0.1),
                      borderColor: theme.palette.error.main,
                      borderWidth: 1,
                      borderRadius: 4
                  }
                ]
              }}
              options={{
                  ...commonChartOptions,
                plugins: {
                    ...commonChartOptions.plugins,
                  title: {
                      ...commonChartOptions.plugins.title,
                      text: gettext('Job Runs Over Time')
                  }
                }
              }}
            />
            </ChartContainer>
          </Grid2>
          
          {/* Average Duration Chart */}
          <Grid2 item xs={12} md={6}>
            <ChartContainer>
            <Line 
              data={{
                  labels: processedHistoryData.map(entry => entry.formattedDate),
                datasets: [
                  {
                    label: gettext('Average Duration (minutes)'),
                      data: processedHistoryData.map(entry => entry.averageDuration.toFixed(2)),
                      borderColor: theme.palette.secondary.main,
                      backgroundColor: alpha(theme.palette.secondary.main, 0.1),
                      tension: 0.4,
                      borderWidth: 2,
                      pointRadius: 4,
                      pointHoverRadius: 6
                  }
                ]
              }}
              options={{
                  ...commonChartOptions,
                plugins: {
                    ...commonChartOptions.plugins,
                  title: {
                      ...commonChartOptions.plugins.title,
                      text: gettext('Average Job Duration Over Time')
                  }
                }
              }}
            />
            </ChartContainer>
          </Grid2>
          
          {/* Status Distribution Chart */}
          <Grid2 item xs={12} md={6}>
            <ChartContainer>
              <Pie 
                data={{
                  labels: [gettext('Successful'), gettext('Failed'), gettext('Running')],
                  datasets: [
                    {
                      label: gettext('Status Distribution'),
                      data: [
                        processedHistoryData.reduce((sum, entry) => sum + entry.successful_runs, 0),
                        processedHistoryData.reduce((sum, entry) => sum + entry.failed_runs, 0),
                        processedHistoryData.reduce((sum, entry) => sum + entry.running_runs, 0)
                      ],
                      backgroundColor: [
                        alpha(theme.palette.success.main, 0.1),
                        alpha(theme.palette.error.main, 0.1),
                        alpha(theme.palette.primary.main, 0.1),
                      ],
                      borderColor: [
                        theme.palette.success.main,
                        theme.palette.error.main,
                        theme.palette.primary.main,
                      ],
                      borderWidth: 1,
                    }
                  ]
                }}
                options={{
                  ...commonChartOptions,
                  plugins: {
                    ...commonChartOptions.plugins,
                    title: {
                      ...commonChartOptions.plugins.title,
                      text: gettext('Job Status Distribution')
                    }
                  }
                }}
              />
        </ChartContainer>
          </Grid2>
        </Grid2>
      </Box>
    );
  };

  // Handle job filter menu
  const handleJobFilterClick = (event) => {
    setJobFilterAnchorEl(event.currentTarget);
  };

  const handleJobFilterClose = () => {
    setJobFilterAnchorEl(null);
  };

  const handleJobFilterChange = (jobId) => {
    setSelectedJobFilter(jobId);
    setJobFilterAnchorEl(null);
    fetchJobMonitorData(); // Refresh data when filter changes
  };

  // Generate job filter options from job data
  const jobFilterOptions = useMemo(() => {
    if (!jobData || !jobData.jobs) return [];
    
    return jobData.jobs.map(job => ({
      id: job.jobid,
      name: job.jobname
    }));
  }, [jobData]);

  // Handle view log
  const handleViewLog = (job) => {
    setSelectedJob(job);
    setLoadingLog(true);
    setJobLogDialogOpen(true);
    
    if (sid && job.jobid) {
      const url = url_for('dashboard.job_log', {'sid': sid, 'jobid': job.jobid});
      
      api.get(url)
        .then(res => {
          if (res.data && res.data.success) {
            const logData = res.data.data;
            
            // Add error details to log data
            if (job.error_details) {
              logData.error_details = job.error_details;
              
              // Add error information to the most recent log entry
              if (logData.rows && logData.rows.length > 0) {
                const lastRun = logData.rows[0];
                if (lastRun.status === 'Failed') {
                  lastRun.error_details = job.error_details;
                }
              }
            }
            
            setJobLog(logData);
          } else {
            setJobLog({
              error: res.data?.errormsg || gettext('Failed to retrieve job log'),
              error_details: job.error_details
            });
          }
          setLoadingLog(false);
        })
        .catch(error => {
          setJobLog({
            error: error.response?.data?.errormsg || gettext('Error retrieving job log'),
            error_details: job.error_details
          });
          setLoadingLog(false);
        });
    }
  };

  const handleCloseJobLog = () => {
    setJobLogDialogOpen(false);
    setSelectedJob(null);
    setJobLog(null);
  };

  // Update the socket connection setup
  useEffect(() => {
    if (!sid || !pageVisible) return;

    const setupSocket = () => {
      try {
        console.log('[JobMonitor] Setting up socket connection...');
        
        // Check if pgAdmin and Browser are available
        if (!pgAdmin?.Browser) {
          console.warn('[JobMonitor] pgAdmin.Browser not available, retrying in 1s...');
          setTimeout(setupSocket, 1000);
          return;
        }

        // Check if pga_job node exists
        const pgaJobNode = pgAdmin.Browser.Nodes['pga_job'];
        if (!pgaJobNode) {
          console.warn('[JobMonitor] pga_job node not available, retrying in 1s...');
          setTimeout(setupSocket, 1000);
          return;
        }

        // Initialize socket if not already available
        if (!pgaJobNode.socket) {
          console.log('[JobMonitor] Initializing new socket connection...');
          // Get the appropriate URL for socket connection
          const socketPath = url_for('pgadmin.job_socket', {'sid': sid});
          pgaJobNode.socket = io(socketPath, {
            transports: ['websocket'],
            upgrade: false
          });
        }

        const existingSocket = pgaJobNode.socket;
        setSocket(existingSocket);
        setSocketConnected(existingSocket.connected);

        // Improved job status update handler
        const onJobStatusUpdate = async (data) => {
          console.log('[JobMonitor] Job status update received:', data);
          
          if (!data) return;

          const {
            job_id,
            status,
            description,
            custom_text,
            timestamp
          } = data;

          // Handle failed jobs
          if (status === 'f') {
            console.log('[JobMonitor] Processing failed job:', job_id);

            // Format error message
            const errorMessage = description ? formatErrorMessage(description) : 'No error details available';
            const notificationMessage = custom_text 
              ? `${custom_text}\n${errorMessage}`
              : errorMessage;

            // Show notification
            pgAdmin.Browser.notifier.error(
              `Job ${job_id} failed: ${notificationMessage}`,
              30000
            );

            try {
              // Immediately fetch fresh job data
              const url = url_for('dashboard.job_monitor', {'sid': sid});
              const response = await getApiInstance().get(url);
              
              if (response.data && response.data.jobs) {
                // Update job data with new information
                const updatedJobData = response.data;
                const failedJob = updatedJobData.jobs.find(job => job.jobid === job_id);
                
                if (failedJob) {
                  // Enhance the job object with error details
                  failedJob.error_details = {
                    description: description,
                    custom_text: custom_text,
                    timestamp: timestamp || new Date().toISOString(),
                    formatted_message: notificationMessage
                  };
                  
                  // Update the job data state
                  setJobData(updatedJobData);
                  
                  // Automatically open log dialog for the failed job
                  handleViewLog(failedJob);
                }
              }
            } catch (error) {
              console.error('[JobMonitor] Error refreshing job data:', error);
            }
          }

          // Always refresh data for any status update
          fetchJobMonitorData();
        };

        // Set up event listeners
        existingSocket.on('job_status_update', onJobStatusUpdate);
        existingSocket.on('connect', () => {
          console.log('[JobMonitor] Socket connected');
          setSocketConnected(true);
        });
        existingSocket.on('disconnect', () => {
          console.log('[JobMonitor] Socket disconnected');
          setSocketConnected(false);
        });
        existingSocket.on('connect_error', (error) => {
          console.error('[JobMonitor] Socket connection error:', error);
          setSocketConnected(false);
        });

        // Clean up
        return () => {
          existingSocket.off('job_status_update', onJobStatusUpdate);
          existingSocket.off('connect');
          existingSocket.off('disconnect');
          existingSocket.off('connect_error');
        };
      } catch (error) {
        console.error('[JobMonitor] Error setting up socket:', error);
        setSocketConnected(false);
        // Retry setup after a delay
        setTimeout(setupSocket, 1000);
      }
    };

    // Initial setup
    setupSocket();
  }, [sid, pageVisible]);

  // Modify the useInterval to only refresh when auto-refresh is on and socket is not connected
  useInterval(() => {
    if (pageVisible && autoRefresh && !socketConnected) {
      fetchJobMonitorData();
    }
  }, 5000);

  // Update fetchJobMonitorData to handle filter changes
  const fetchJobMonitorData = useCallback(() => {
    if (!sid || !pageVisible) return;
    
    setLoading(true);
    const url = url_for('dashboard.job_monitor', {'sid': sid});
    
    api.get(url)
      .then(res => {
        if (res.data) {
          // Extract job data from response based on format
          if (res.data.debug_info) {
            if (res.data.data) {
              if (typeof res.data.data === 'object' && !Array.isArray(res.data.data) && 
                  (res.data.data.summary || res.data.data.jobs)) {
                setJobData(res.data.data);
              } else if (typeof res.data.data === 'object') {
                const keys = Object.keys(res.data.data);
                const isArrayLike = keys.length > 0 && keys.every(key => !isNaN(parseInt(key)));
                
                if (isArrayLike) {
                  const rawResult = res.data.debug_info?.raw_result?.result;
                  if (rawResult && typeof rawResult === 'object') {
                    setJobData(rawResult);
                  } else {
                    setError(gettext('Invalid data format received from server'));
                  }
                } else {
                  setJobData({
                    summary: {
                      total_jobs: res.data.debug_info?.job_count || 0,
                      enabled_jobs: 0,
                      disabled_jobs: 0,
                      running_jobs: 0,
                      successful_jobs: 0,
                      failed_jobs: 0
                    },
                    jobs: []
                  });
                }
              } else {
                setError(gettext('Invalid response format from server'));
              }
            } else {
              setError(gettext('Invalid response format from server'));
            }
          } else {
            if (res.data.result) {
              setJobData(res.data.result);
            } else if (typeof res.data === 'object' && (res.data.summary || res.data.jobs)) {
              setJobData(res.data);
            } else {
              setError(gettext('Invalid data format received from server'));
            }
          }
          setError(null);
        } else {
          setError(gettext('No data returned from server'));
        }
        setLoading(false);
      })
      .catch(error => {
        setLoading(false);
            setError(error.response?.data?.errormsg || gettext('Error fetching job data'));
      });
  }, [sid, pageVisible]);

  // Handle refresh button click
  const handleRefresh = () => {
    setRefresh(!refresh);
  };

  // Toggle auto refresh
  const handleToggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  // Custom refresh section with auto-refresh toggle
  const renderRefreshSection = () => {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Tooltip title={autoRefresh ? gettext('Auto-refresh is ON') : gettext('Auto-refresh is OFF')}>
          <IconButton 
            onClick={handleToggleAutoRefresh}
            color={autoRefresh ? "primary" : "default"}
            size="small"
          >
            <AccessTimeIcon />
          </IconButton>
        </Tooltip>
        <RefreshButton onClick={handleRefresh} />
      </Box>
    );
  };

  // If there's an error, show error message
  if (error) {
    return (
      <SectionContainer 
        title={gettext('Job Monitor')}
        subtitle={gettext('View and monitor pgAgent job status')}
        icon={<AccessTimeIcon />}
        refresh={renderRefreshSection()}
      >
        <Box sx={{ p: 2 }}>
          <Typography color="error">{error}</Typography>
        </Box>
      </SectionContainer>
    );
  }

  return (
    <SectionContainer 
      title={gettext('Job Monitor')}
      subtitle={gettext('View and monitor pgAgent job status')}
      icon={<AccessTimeIcon />}
      refresh={renderRefreshSection()}
    >
      {error ? (
        <Box sx={{ p: 2 }}>
          <Typography color="error">{error}</Typography>
        </Box>
      ) : loading ? (
        <Box sx={{ p: 2 }}>
          <LinearProgress />
        </Box>
      ) : (
        <ScrollableContainer>
          {renderJobStats()}
          
          <Box sx={{ mt: 4 }}>
            <Tabs 
              value={tabValue} 
              onChange={handleTabChange}
              aria-label="job monitor main tabs"
              indicatorColor="primary"
              textColor="primary"
            >
              <Tab label={gettext('Jobs')} />
              <Tab label={gettext('Analytics')} />
            </Tabs>
            
            <Box sx={{ mt: 2 }}>
              {tabValue === 0 ? renderJobTabs() : renderCharts()}
            </Box>
          </Box>
        </ScrollableContainer>
      )}

      {/* Date Range Dialog */}
      <LocalizationProvider dateAdapter={AdapterMoment}>
        <Dialog
          open={dateRangeDialogOpen}
          onClose={handleDateRangeDialogClose}
          aria-labelledby="date-range-dialog-title"
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle id="date-range-dialog-title">
            {gettext('Select Date Range')}
            <IconButton
              aria-label="close"
              onClick={handleDateRangeDialogClose}
              sx={{
                position: 'absolute',
                right: 8,
                top: 8,
                color: (theme) => theme.palette.grey[500],
              }}
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {gettext('Select a custom date range for filtering job history data.')}
            </DialogContentText>
            <Grid2 container spacing={2}>
              <Grid2 item xs={12} sm={6}>
                <DatePicker
                  label={gettext('Start Date')}
                  value={moment(dateRange.startDate)}
                  onChange={(newValue) => {
                    if (newValue && newValue.isValid()) {
                      setDateRange(prev => ({
                        ...prev,
                        startDate: newValue.toDate()
                      }));
                    }
                  }}
                  renderInput={(params) => <TextField {...params} fullWidth />}
                  maxDate={moment(dateRange.endDate)}
                />
              </Grid2>
              <Grid2 item xs={12} sm={6}>
                <DatePicker
                  label={gettext('End Date')}
                  value={moment(dateRange.endDate)}
                  onChange={(newValue) => {
                    if (newValue && newValue.isValid()) {
                      setDateRange(prev => ({
                        ...prev,
                        endDate: newValue.toDate()
                      }));
                    }
                  }}
                  renderInput={(params) => <TextField {...params} fullWidth />}
                  minDate={moment(dateRange.startDate)}
                  maxDate={moment()}
                />
              </Grid2>
            </Grid2>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleDateRangeDialogClose}>{gettext('Cancel')}</Button>
            <Button onClick={handleDateRangeApply} variant="contained" color="primary">
              {gettext('Apply')}
            </Button>
          </DialogActions>
        </Dialog>
      </LocalizationProvider>

      {/* Job Log Dialog */}
      <Dialog
        open={jobLogDialogOpen}
        onClose={handleCloseJobLog}
        aria-labelledby="job-log-dialog-title"
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle id="job-log-dialog-title" sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${theme.palette.divider}`
        }}>
          <Box>
            {selectedJob && gettext(`Job Log for "${selectedJob.jobname}"`)}
          </Box>
          <IconButton onClick={handleCloseJobLog} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {loadingLog ? (
            <Box sx={{ p: 2 }}>
              <LinearProgress />
            </Box>
          ) : jobLog && jobLog.error ? (
            <Box sx={{ p: 2 }}>
              <Typography color="error">{jobLog.error}</Typography>
              {jobLog.error_details && renderErrorDetails(jobLog.error_details)}
            </Box>
          ) : jobLog && jobLog.rows && jobLog.rows.length > 0 ? (
            <Box sx={{ height: '60vh', overflow: 'auto' }}>
              <Box sx={{ p: 2 }}>
                {/* Show error details at the top if available */}
                {jobLog.error_details && renderErrorDetails(jobLog.error_details)}

                {/* Existing log entries */}
                {jobLog.rows.map((log, index) => (
                  <Paper 
                    key={index} 
                    sx={{ 
                      p: 2, 
                      mb: 2, 
                      borderLeft: '4px solid',
                      borderColor: log.status === 'Success' ? theme.palette.success.main :
                                   log.status === 'Failed' ? theme.palette.error.main :
                                   log.status === 'Running' ? theme.palette.primary.main :
                                   theme.palette.grey[500]
                    }}
                  >
                    {/* Show error details for failed runs */}
                    {log.status === 'Failed' && log.error_details && renderErrorDetails(log.error_details)}
                    
                    {/* Rest of the existing log entry content */}
                    <Typography variant="h6" sx={{ color: theme.palette.text.primary, mb: 1 }}>
                      {gettext('Run')} #{log.jlgid} - {log.status}
                    </Typography>
                    
                    <Grid2 container spacing={2} sx={{ mb: 2 }}>
                      <Grid2 item xs={12} sm={6}>
                        <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                          <strong>{gettext('Start Time')}:</strong> {formatDateTime(log.jlgstart)}
                        </Typography>
                      </Grid2>
                      <Grid2 item xs={12} sm={6}>
                        <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                          <strong>{gettext('Duration')}:</strong> {formatDuration(log.jlgduration)}
                        </Typography>
                      </Grid2>
                    </Grid2>
                    
                    <Divider sx={{ my: 2 }} />
                    
                    <Typography variant="subtitle1" sx={{ color: theme.palette.text.primary, mb: 1 }}>
                      {gettext('Steps')}
                    </Typography>
                    
                    {log.steps && log.steps.length > 0 ? (
                      <Box>
                        {log.steps
                          .filter(step => step.step_id !== null)
                          .map((step, stepIndex) => (
                          <Box 
                            key={stepIndex} 
                            sx={{ 
                              p: 1.5, 
                              mb: 1, 
                              bgcolor: alpha(theme.palette.background.paper, 0.7),
                              borderRadius: 1,
                              border: '1px solid',
                              borderColor: theme.palette.divider,
                              boxShadow: 1
                            }}
                          >
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                              <Typography variant="subtitle2" sx={{ color: theme.palette.text.primary }}>
                                {step.step_name || gettext('Step')} #{stepIndex + 1}
                              </Typography>
                              <JobStatusChip 
                                label={step.status} 
                                status={step.status} 
                                size="small" 
                              />
                            </Box>
                            
                            {step.step_desc && (
                              <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 1 }}>
                                {step.step_desc}
                              </Typography>
                            )}
                            
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1 }}>
                              {step.start_time && (
                                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                                  <strong>{gettext('Start')}:</strong> {formatDateTime(step.start_time)}
                                </Typography>
                              )}
                              {step.duration && (
                                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                                  <strong>{gettext('Duration')}:</strong> {formatDuration(step.duration)}
                                </Typography>
                              )}
                            </Box>
                            
                            {step.output && (
                              <Box sx={{ mt: 1 }}>
                                <Typography variant="subtitle2" sx={{ color: theme.palette.text.primary, mb: 0.5 }}>
                                  {gettext('Output')}
                                </Typography>
                                <Paper 
                                  sx={{ 
                                    p: 1.5, 
                                    bgcolor: alpha(theme.palette.background.default, 0.7),
                                    maxHeight: '150px',
                                    overflow: 'auto',
                                    fontFamily: 'monospace',
                                    fontSize: '0.85rem',
                                    color: theme.palette.text.primary,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all'
                                  }}
                                >
                                  {step.output}
                                </Paper>
                              </Box>
                            )}
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" sx={{ color: theme.palette.text.secondary, fontStyle: 'italic' }}>
                        {gettext('No step information available')}
                      </Typography>
                    )}
                  </Paper>
                ))}
              </Box>
            </Box>
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary, fontStyle: 'italic' }}>
                {gettext('No log information available for this job')}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${theme.palette.divider}`, p: 1.5 }}>
          <Button onClick={handleCloseJobLog} variant="outlined">{gettext('Close')}</Button>
        </DialogActions>
      </Dialog>
    </SectionContainer>
  );
}

JobMonitor.propTypes = {
  sid: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  node: PropTypes.func,
  preferences: PropTypes.object,
  treeNodeInfo: PropTypes.object,
  nodeData: PropTypes.object,
  pageVisible: PropTypes.bool,
};