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
  Chip,
  CircularProgress,
  Collapse,
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
  Skeleton,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
  Avatar,
  Drawer,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
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
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import SectionContainer from './components/SectionContainer';
import getApiInstance from 'sources/api_instance';
import url_for from 'sources/url_for';
import { useInterval } from 'sources/custom_hooks';
import RefreshButton from './components/RefreshButtons';
import EmptyPanelMessage from '../../../static/js/components/EmptyPanelMessage';
import gettext from 'sources/gettext';
import { io } from 'socket.io-client';
import pgAdmin from 'sources/pgadmin';
import ForceGraph2D from 'react-force-graph-2d';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';

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

// Add this helper function at the top level
const getContrastText = (theme, bgColor) => {
  return theme.palette.getContrastText(bgColor);
};

const StatCardItem = ({ title, value, status, icon }) => {
  StatCardItem.propTypes = {
    title: PropTypes.string.isRequired,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    status: PropTypes.string.isRequired,
    icon: PropTypes.element.isRequired,
  };
  StatCardItem.propTypes = {

  };
  const theme = useTheme();
  
  const getStatusColor = () => {
    switch(status) {
    case 'total': return theme.palette.info.main;
    case 'enabled': return theme.palette.success.main;
    case 'disabled': return theme.palette.warning.main;
    case 'running': return theme.palette.primary.main;
    case 'success': return theme.palette.success.main;
    case 'failed': return theme.palette.error.main;
    default: return theme.palette.grey[500];
    }
  };

  const statusColor = getStatusColor();
  
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
          borderTop: `4px solid ${statusColor}`,
          borderRadius: theme.shape.borderRadius,
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
          boxShadow: theme.shadows[2],
          transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: theme.shadows[4],
            backgroundColor: alpha(statusColor, 0.05),
          }
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {icon && (
            <Box sx={{ mb: 2, color: statusColor }}>
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
              color: theme.palette.text.primary
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
        '& canvas': {
          // Ensure chart text is visible in dark mode
          color: theme.palette.text.primary + ' !important',
        }
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
      color: theme.palette.text.primary,
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
        borderColor: statusInfo.color,
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.text.primary
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
            <Typography variant="body2">
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
                    sx={{ color: theme.palette.text.primary }}
                  />
                )}
                {job.duration && (
                  <Chip
                    size="small"
                    icon={<ScheduleIcon fontSize="small" />}
                    label={formatDuration(job.duration)}
                    variant="outlined"
                    sx={{ color: theme.palette.text.primary }}
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
              <Typography variant="body2">
                {gettext('Progress')}
              </Typography>
              <Typography variant="body2">
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
              <Typography variant="subtitle2">
                {gettext('ID')}
              </Typography>
              <Typography variant="body2">
                {job.jobid}
              </Typography>
            </Grid2>
            <Grid2 item xs={12} sm={6} md={3}>
              <Typography variant="subtitle2">
                {gettext('Last Run')}
              </Typography>
              <Typography variant="body2">
                {job.start_time ? formatDateTime(job.start_time) : gettext('Never')}
              </Typography>
            </Grid2>
            <Grid2 item xs={12} sm={6} md={3}>
              <Typography variant="subtitle2" >
                {gettext('Next Run')}
              </Typography>
              <Typography variant="body2">
                {job.jobnextrun || job.next_run ? formatDateTime(job.jobnextrun || job.next_run) : 
                  job.jobenabled ? gettext('Not scheduled') : gettext('Job disabled')}
              </Typography>
            </Grid2>
            <Grid2 item xs={12} sm={6} md={3}>
              <Typography variant="subtitle2">
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
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
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

// Add the missing calculateNodeLevels function
const calculateNodeLevels = (nodes, links) => {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set();
  
  const visit = (nodeId, level) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    
    const node = nodeMap.get(nodeId);
    node.level = Math.max(node.level, level);
    
    // Visit all dependent nodes
    links
      .filter(link => link.source === nodeId)
      .forEach(link => visit(link.target, level + 1));
  };
  
  // Start with nodes that have no incoming links
  nodes
    .filter(node => !links.some(link => link.target === node.id))
    .forEach(node => visit(node.id, 0));
};

// Add the renderErrorDetails function
const renderErrorDetails = (errorDetails) => {
  if (!errorDetails) return null;
  
  const theme = useTheme();
  
  return (
    <Paper 
      sx={{ 
        p: 2, 
        mb: 2, 
        bgcolor: alpha(theme.palette.error.main, 0.05),
        border: '1px solid',
        borderColor: theme.palette.error.main,
        borderRadius: 1
      }}
    >
      <Typography variant="subtitle1" color="error" gutterBottom>
        {gettext('Error Details')}
      </Typography>
      
      {errorDetails.formatted_message && (
        <Typography variant="body1" sx={{ mb: 1 }}>
          {errorDetails.formatted_message}
        </Typography>
      )}
      
      {errorDetails.description && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            {gettext('Description')}
          </Typography>
          <Paper 
            sx={{ 
              p: 1.5, 
              bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.2 : 0.7),
              maxHeight: '150px',
              overflow: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {errorDetails.description}
          </Paper>
        </Box>
      )}
      
      {errorDetails.custom_text && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            {gettext('Custom Text')}
          </Typography>
          <Paper 
            sx={{ 
              p: 1.5, 
              bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.2 : 0.7),
              maxHeight: '150px',
              overflow: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {errorDetails.custom_text}
          </Paper>
        </Box>
      )}
      
      {errorDetails.timestamp && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: theme.palette.text.secondary }}>
          {gettext('Timestamp')}: {formatDateTime(errorDetails.timestamp)}
        </Typography>
      )}
    </Paper>
  );
};

export default function JobMonitor({sid, pageVisible = true}) {
  const [jobData, setJobData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(false);
  const [tabValue, setTabValue] = useState(0);
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
  const [dependencyGraphData, setDependencyGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [_zoomLevel, setZoomLevel] = useState(1);
  const graphRef = useRef(null);
  const theme = useTheme();
  const api = getApiInstance();
  const [_socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  
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
          boxShadow: theme.shadows[3],
          callbacks: {
            label: function(context) {
              if (context.parsed && context.parsed.y !== undefined) {
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}`;
              } else if (context.raw !== undefined) {
                return `${context.dataset.label}: ${typeof context.raw === 'number' ? context.raw.toFixed(2) : context.raw}`;
              } else {
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
            color: alpha(theme.palette.divider, 0.1),
            drawBorder: false
          },
          ticks: {
            color: theme.palette.text.primary,
            font: {
              size: 12
            },
            padding: 10
          }
        },
        x: {
          grid: {
            color: alpha(theme.palette.divider, 0.1),
            drawBorder: false
          },
          ticks: {
            color: theme.palette.text.primary,
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
                  },
                  scales: {
                    x: {
                      ticks: {
                        color: theme.palette.text.primary
                      },
                      grid: {
                        color: alpha(theme.palette.text.primary, 0.1)
                      }
                    },
                    y: {
                      ticks: {
                        color: theme.palette.text.primary
                      },
                      grid: {
                        color: alpha(theme.palette.text.primary, 0.1)
                      }
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
                  },
                  scales: {
                    x: {
                      ticks: {
                        color: theme.palette.text.primary
                      },
                      grid: {
                        color: alpha(theme.palette.text.primary, 0.1)
                      }
                    },
                    y: {
                      ticks: {
                        color: theme.palette.text.primary
                      },
                      grid: {
                        color: alpha(theme.palette.text.primary, 0.1)
                      }
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
                  },
                  scales: {
                    x: {
                      ticks: {
                        color: theme.palette.text.primary
                      },
                      grid: {
                        color: alpha(theme.palette.text.primary, 0.1)
                      }
                    },
                    y: {
                      ticks: {
                        color: theme.palette.text.primary
                      },
                      grid: {
                        color: alpha(theme.palette.text.primary, 0.1)
                      }
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
                    },
                    legend: {
                      labels: {
                        color: theme.palette.text.primary
                      }
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
          fetchDependencyGraphData(); // Also refresh dependency graph
        };

        // Set up event listeners
        existingSocket.on('job_status_update', onJobStatusUpdate);
        existingSocket.on('connect', () => {
          setSocketConnected(true);
        });
        existingSocket.on('disconnect', () => {
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
      fetchDependencyGraphData(); // Also refresh dependency graph
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
    fetchJobMonitorData();
    fetchDependencyGraphData();
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
            color={autoRefresh ? 'primary' : 'default'}
            size="small"
          >
            <AccessTimeIcon />
          </IconButton>
        </Tooltip>
        <RefreshButton onClick={handleRefresh} />
      </Box>
    );
  };

  // Fix the fetchDependencyGraphData function
  const fetchDependencyGraphData = async () => {
    try {
      setGraphLoading(true);
      const url = url_for('dashboard.job_dependency_graph', {'sid': sid});
      
      const response = await api.get(url);      
      if (response.data && response.data.dependency_graph) {
        // Process the graph data
        const graphData = response.data.dependency_graph;
        
        // Check if we have nodes
        if (!graphData.nodes || graphData.nodes.length === 0) {
          console.warn('No nodes in dependency graph data');
          setError(gettext('No jobs found in the database'));
          setGraphLoading(false);
          return;
        }
        
        // Add node properties for visualization
        graphData.nodes = graphData.nodes.map(node => ({
          ...node,
          val: 1, // Base size
          color: getNodeColor(node.status, node.enabled),
          label: node.name,
          status: node.status, // Use the status directly from the SQL result
          enabled: node.enabled,
          level: 0, // Initialize level for topological sorting
          incomingLinks: 0,
          outgoingLinks: 0
        }));
        
        // Add link properties for visualization
        graphData.links = graphData.links.map(link => {
          const sourceNode = graphData.nodes.find(n => n.id === link.source);
          const targetNode = graphData.nodes.find(n => n.id === link.target);
          
          if (!sourceNode || !targetNode) {
            console.warn('Missing source or target node for link:', link);
            return null;
          }
          
          return {
            ...link,
            source: sourceNode,
            target: targetNode,
            color: getEdgeColor(targetNode.status, targetNode.enabled),
            width: 4,
            strokeWidth: 2,
            strokeDasharray: targetNode.enabled ? null : '5,5',
            opacity: 0.8
          };
        }).filter(Boolean); // Remove any null links
        
        // Calculate node levels for hierarchical layout
        calculateNodeLevels(graphData.nodes, graphData.links);
        
        setDependencyGraphData(graphData);
      } else {
        console.warn('Invalid dependency graph data format:', response);
        setError(gettext('Invalid dependency graph data format'));
      }
    } catch (error) {
      console.error('Error fetching dependency graph data:', error);
      setError(error.response?.data?.errormsg || gettext('Error fetching dependency data'));
    } finally {
      setGraphLoading(false);
    }
  };

  // Add new helper function for edge colors
  const getEdgeColor = (status, enabled) => {
    if (!enabled) return theme.palette.grey[500];
    
    // Convert status to lowercase for consistent comparison
    const statusLower = status?.toLowerCase();
    
    switch(statusLower) {
    case 'r':
    case 'running':
      return theme.palette.primary.main;
    case 's':
    case 'success':
      return theme.palette.success.main;
    case 'f':
    case 'failed':
      return theme.palette.error.main;
    case 'd':
    case 'disabled':
      return theme.palette.warning.main;
    default:
      return theme.palette.grey[500];
    }
  };

  // Get node color based on status and enabled state
  const getNodeColor = (status, enabled) => {
    if (!enabled) return theme.palette.grey[500];
    
    // Convert status to lowercase for consistent comparison
    const statusLower = status?.toLowerCase();
    
    switch(statusLower) {
    case 'r':
    case 'running':
      return theme.palette.primary.main;
    case 's':
    case 'success':
      return theme.palette.success.main;
    case 'f':
    case 'x':
    case 'dependency failure':
    case 'failed':
      return theme.palette.error.main;
    case 'd':
    case 'disabled':
      return theme.palette.warning.main;
    default:
      return theme.palette.grey[500];
    }
  };

  // Get node size based on dependencies
  const getNodeSize = (node, graphData) => {
    const incomingLinks = graphData.links.filter(link => link.target === node.id).length;
    const outgoingLinks = graphData.links.filter(link => link.source === node.id).length;
    const totalConnections = incomingLinks + outgoingLinks;
    return Math.max(1, Math.min(3, 1 + (totalConnections * 0.2)));
  };

  // Handle node hover
  const handleNodeHover = (node) => {
    if (node) {
      setHoveredNodeId(node.id);
      setSelectedNode(node);
    } else {
      setHoveredNodeId(null);
      setSelectedNode(null);
    }
  };

  // Handle node click
  const handleNodeClick = (node) => {
    setSelectedNode(node);
    setDrawerOpen(true);
  };

  // Handle zoom controls
  const handleZoomIn = () => {
    if (graphRef.current) {
      graphRef.current.zoom(1.2, 400);
      setZoomLevel(prev => prev * 1.2);
    }
  };

  const handleZoomOut = () => {
    if (graphRef.current) {
      graphRef.current.zoom(0.8, 400);
      setZoomLevel(prev => prev * 0.8);
    }
  };

  const handleResetView = () => {
    if (graphRef.current) {
      graphRef.current.centerAt(0, 0, 1000);
      graphRef.current.zoom(1, 1000);
      setZoomLevel(1);
    }
  };

  // Function to reset the graph layout
  const handleResetLayout = () => {
    if (graphRef.current) {
      try {
        // Reset the simulation
        if (typeof graphRef.current.d3ReheatSimulation === 'function') {
          graphRef.current.d3ReheatSimulation();
        }
        
        // Reset zoom and center
        if (typeof graphRef.current.centerAt === 'function') {
          graphRef.current.centerAt(0, 0, 1000);
        }
        
        if (typeof graphRef.current.zoom === 'function') {
          graphRef.current.zoom(1, 1000);
          setZoomLevel(1);
        }
        
        // Recalculate node levels
        if (dependencyGraphData && dependencyGraphData.nodes && dependencyGraphData.links) {
          calculateNodeLevels(dependencyGraphData.nodes, dependencyGraphData.links);
        }
        
        // Force a redraw - check if forces exist before accessing them
        if (graphRef.current.d3Force) {
          const yForce = graphRef.current.d3Force('y');
          const xForce = graphRef.current.d3Force('x');
          
          if (yForce && typeof yForce.strength === 'function') {
            yForce.strength(0.1);
          }
          
          if (xForce && typeof xForce.strength === 'function') {
            xForce.strength(0.1);
          }
        }
        
        // After a short delay, freeze the simulation again
        setTimeout(() => {
          if (graphRef.current) {
            graphRef.current.d3ReheatSimulation = () => {};
          }
        }, 1000);
      } catch (error) {
        console.error('Error resetting layout:', error);
      }
    }
  };

  // Fix the renderDependencyGraph function to use graphLoading instead of loading
  const renderDependencyGraph = () => {
    if (graphLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <CircularProgress />
        </Box>
      );
    }

    if (error) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography color="error">{error}</Typography>
        </Box>
      );
    }

    if (!dependencyGraphData || !dependencyGraphData.nodes || dependencyGraphData.nodes.length === 0) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', gap: 2 }}>
          <Typography>No dependency data available</Typography>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={() => fetchDependencyGraphData()}
            size="small"
          >
            Refresh Dependencies
          </Button>
        </Box>
      );
    }

    // Function to check if a node is connected to the hovered node
    const isConnected = (node, hoveredNodeId) => {
      if (!hoveredNodeId) return false;
      
      // Check if this node is the source of a link to the hovered node
      const isSource = dependencyGraphData.links.some(
        link => link.source.id === node.id && link.target.id === hoveredNodeId
      );
      
      // Check if this node is the target of a link from the hovered node
      const isTarget = dependencyGraphData.links.some(
        link => link.source.id === hoveredNodeId && link.target.id === node.id
      );
      
      return isSource || isTarget;
    };

    // Function to determine node color based on hover state
    const getNodeColorWithHover = (node) => {
      if (hoveredNodeId && (node.id === hoveredNodeId || isConnected(node, hoveredNodeId))) {
        return theme.palette.info.main; 
      }
      return getNodeColor(node.status, node.enabled);
    };

    // Function to determine link color based on hover state
    const getLinkColorWithHover = (link) => {
      if (hoveredNodeId && (link.source.id === hoveredNodeId || link.target.id === hoveredNodeId)) {
        return theme.palette.warning.main;
      }
      return link.color;
    };

    return (
      <Box sx={{ position: 'relative', height: '100%', width: '100%' }}>
        <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1, display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh Dependencies">
            <IconButton
              onClick={() => fetchDependencyGraphData()}
              size="small"
              sx={{ bgcolor: 'background.paper' }}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reset View">
            <IconButton
              onClick={handleResetView}
              size="small"
              sx={{ bgcolor: 'background.paper' }}
            >
              <CenterFocusStrongIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reset Layout">
            <IconButton
              onClick={handleResetLayout}
              size="small"
              sx={{ bgcolor: 'background.paper' }}
            >
              <AutoFixHighIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <ForceGraph2D
          ref={graphRef}
          graphData={dependencyGraphData}
          nodeId="id"
          nodeLabel="label"
          nodeColor={getNodeColorWithHover}
          nodeVal={node => getNodeSize(node, dependencyGraphData)}
          linkColor={getLinkColorWithHover}
          linkWidth={link => link.width}
          linkCurvatureDirectional={0.1}
          linkDirectionalArrowLength={5}
          linkDirectionalArrowRelPos={0.5}
          linkDirectionalArrowColor={link => link.color}
          cooldownTicks={100}
          onEngineStop={() => {
            // Freeze the simulation after initial layout
            if (graphRef.current) {
              graphRef.current.d3ReheatSimulation = () => {};
            }
          }}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const label = node.label;
            const fontSize = 12/globalScale;
            ctx.font = `bold ${fontSize}px Sans-Serif`;
            const textWidth = ctx.measureText(label).width;
            
            // Calculate dimensions for rounded rectangle
            const padding = 4;
            const width = textWidth + padding * 2;
            const height = fontSize + padding * 2;
            const radius = 5; // Corner radius
            // Draw rounded rectangle background
            ctx.beginPath();
            ctx.moveTo(node.x - width/2 + radius, node.y - height/2);
            ctx.lineTo(node.x + width/2 - radius, node.y - height/2);
            ctx.quadraticCurveTo(node.x + width/2, node.y - height/2, node.x + width/2, node.y - height/2 + radius);
            ctx.lineTo(node.x + width/2, node.y + height/2 - radius);
            ctx.quadraticCurveTo(node.x + width/2, node.y + height/2, node.x + width/2 - radius, node.y + height/2);
            ctx.lineTo(node.x - width/2 + radius, node.y + height/2);
            ctx.quadraticCurveTo(node.x - width/2, node.y + height/2, node.x - width/2, node.y + height/2 - radius);
            ctx.lineTo(node.x - width/2, node.y - height/2 + radius);
            ctx.quadraticCurveTo(node.x - width/2, node.y - height/2, node.x - width/2 + radius, node.y - height/2);
            ctx.closePath();
            
            // Fill with node color with transparency
            const nodeColor = getNodeColorWithHover(node);
            ctx.fillStyle = nodeColor.startsWith('rgb') 
              ? nodeColor.replace('rgb', 'rgba').replace(')', ', 0.8)')
              : alpha(nodeColor, 0.8);
            ctx.fill();
            // Add a subtle border
            ctx.strokeStyle = nodeColor;
            ctx.lineWidth = 0.5;
            ctx.stroke();
            
            // Draw node label
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = getContrastText(theme, nodeColor);
            ctx.fillText(label, node.x, node.y);
          }}
        />
        
        {/* Controls */}
        <Box sx={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 1 }}>
          <IconButton onClick={handleZoomIn} size="small" sx={{ bgcolor: 'background.paper' }}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
          <IconButton onClick={handleZoomOut} size="small" sx={{ bgcolor: 'background.paper' }}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
          <IconButton onClick={handleResetView} size="small" sx={{ bgcolor: 'background.paper' }}>
            <RestartAltIcon fontSize="small" />
          </IconButton>
          <Tooltip title={gettext('Reset Layout')}>
            <IconButton onClick={handleResetLayout} size="small" sx={{ bgcolor: 'background.paper' }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        
        {/* Legend */}
        <Box sx={{ position: 'absolute', top: 16, right: 16, bgcolor: 'background.paper', p: 1, borderRadius: 1, boxShadow: 1 }}>
          <Typography variant="subtitle2" gutterBottom>Legend</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: getNodeColor('s', true) }} />
              <Typography variant="body2">Success</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: getNodeColor('f', true) }} />
              <Typography variant="body2">Failed</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: getNodeColor('r', true) }} />
              <Typography variant="body2">Running</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: getNodeColor(null, false) }} />
              <Typography variant="body2">Disabled</Typography>
            </Box>
          </Box>
        </Box>
        
        {/* Node details panel */}
        {selectedNode && renderNodeDetails()}
      </Box>
    );
  };

  // Render node details drawer
  const renderNodeDetails = () => {
    if (!selectedNode) return null;

    return (
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: 320,
            bgcolor: theme.palette.background.paper
          }
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ color: theme.palette.text.primary }}>{selectedNode.name}</Typography>
            <IconButton onClick={() => setDrawerOpen(false)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
          
          <List>
            <ListItem>
              <ListItemIcon>
                <Chip
                  size="small"
                  label={selectedNode.status || gettext('Unknown')}
                  sx={{
                    bgcolor: alpha(getNodeColor(selectedNode.status, selectedNode.enabled), 0.1),
                    color: getNodeColor(selectedNode.status, selectedNode.enabled)
                  }}
                />
              </ListItemIcon>
              <ListItemText primary={gettext('Status')} primaryTypographyProps={{ color: theme.palette.text.primary }} />
            </ListItem>
            
            <ListItem>
              <ListItemIcon>
                <Chip
                  size="small"
                  label={selectedNode.enabled ? gettext('Enabled') : gettext('Disabled')}
                  sx={{
                    bgcolor: alpha(selectedNode.enabled ? theme.palette.success.main : theme.palette.grey[500], 0.1),
                    color: selectedNode.enabled ? theme.palette.success.main : theme.palette.grey[500]
                  }}
                />
              </ListItemIcon>
              <ListItemText primary={gettext('Enabled')} primaryTypographyProps={{ color: theme.palette.text.primary }} />
            </ListItem>
            
            {selectedNode.next_run && (
              <ListItem>
                <ListItemIcon>
                  <ScheduleIcon color="action" />
                </ListItemIcon>
                <ListItemText 
                  primary={gettext('Next Run')} 
                  secondary={formatDateTime(selectedNode.next_run)}
                  primaryTypographyProps={{ color: theme.palette.text.primary }}
                  secondaryTypographyProps={{ color: theme.palette.text.primary }}
                />
              </ListItem>
            )}
            
            {selectedNode.last_run && (
              <ListItem>
                <ListItemIcon>
                  <AccessTimeIcon color="action" />
                </ListItemIcon>
                <ListItemText 
                  primary={gettext('Last Run')} 
                  secondary={formatDateTime(selectedNode.last_run)}
                  primaryTypographyProps={{ color: theme.palette.text.primary }}
                  secondaryTypographyProps={{ color: theme.palette.text.primary }}
                />
              </ListItem>
            )}
          </List>
          
          <Button
            variant="outlined"
            fullWidth
            startIcon={<ArticleIcon />}
            onClick={() => {
              setDrawerOpen(false);
              handleViewLog(selectedNode);
            }}
            sx={{ mt: 2 }}
          >
            {gettext('View Log')}
          </Button>
        </Box>
      </Drawer>
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
              <Tab label={gettext('Dependencies')} icon={<AccountTreeIcon />} />
            </Tabs>
            
            <Box sx={{ mt: 2 }}>
              {tabValue === 0 ? renderJobTabs() : 
                tabValue === 1 ? renderCharts() : 
                  renderDependencyGraph()}
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
            <DialogContentText sx={{ mb: 2, color: theme.palette.primary.main }}>
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
          <Box sx={{ color: theme.palette.primary.main }}>
            {selectedJob && gettext(`Job Log for "${selectedJob.jobname}"`)}
          </Box>
          <IconButton onClick={handleCloseJobLog} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ 
          p: 0, 
          backgroundColor: theme.palette.background.default,
          color: theme.palette.primary.main 
        }}>
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
                    <Typography variant="h6" sx={{ color: theme.palette.primary.main, mb: 1 }}>
                      {gettext('Run')} #{log.jlgid} - {log.status}
                    </Typography>
                    
                    <Grid2 container spacing={2} sx={{ mb: 2 }}>
                      <Grid2 item xs={12} sm={6}>
                        <Typography variant="body2" sx={{ color: theme.palette.primary.main }}>
                          <strong>{gettext('Start Time')}:</strong> {formatDateTime(log.jlgstart)}
                        </Typography>
                      </Grid2>
                      <Grid2 item xs={12} sm={6}>
                        <Typography variant="body2" sx={{ color: theme.palette.primary.main }}>
                          <strong>{gettext('Duration')}:</strong> {formatDuration(log.jlgduration)}
                        </Typography>
                      </Grid2>
                    </Grid2>
                    
                    <Divider sx={{ my: 2 }} />
                    
                    <Typography variant="subtitle1" sx={{ color: theme.palette.primary.main, mb: 1 }}>
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
                                <Typography variant="subtitle2" sx={{ color: theme.palette.primary.main }}>
                                  {step.step_name || gettext('Step')} #{stepIndex + 1}
                                </Typography>
                                <JobStatusChip 
                                  label={step.status} 
                                  status={step.status} 
                                  size="small" 
                                />
                              </Box>
                              
                              {step.step_desc && (
                                <Typography variant="body2" sx={{ color: theme.palette.primary.main, mb: 1 }}>
                                  {step.step_desc}
                                </Typography>
                              )}
                            
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1 }}>
                                {step.start_time && (
                                  <Typography variant="body2" sx={{ color: theme.palette.primary.main }}>
                                    <strong>{gettext('Start')}:</strong> {formatDateTime(step.start_time)}
                                  </Typography>
                                )}
                                {step.duration && (
                                  <Typography variant="body2" sx={{ color: theme.palette.primary.main }}>
                                    <strong>{gettext('Duration')}:</strong> {formatDuration(step.duration)}
                                  </Typography>
                                )}
                              </Box>
                              
                              {step.output && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="subtitle2" sx={{ color: theme.palette.primary.main, mb: 0.5 }}>
                                    {gettext('Output')}
                                  </Typography>
                                  <Paper 
                                    sx={{ 
                                      p: 1.5, 
                                      bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.2 : 0.7),
                                      maxHeight: '150px',
                                      overflow: 'auto',
                                      fontFamily: 'monospace',
                                      fontSize: '0.85rem',
                                      color: theme.palette.primary.main,
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
                      <Typography variant="body2" sx={{ color: theme.palette.primary.main, fontStyle: 'italic' }}>
                        {gettext('No step information available')}
                      </Typography>
                    )}
                  </Paper>
                ))}
              </Box>
            </Box>
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" sx={{ color: theme.palette.primary.main, fontStyle: 'italic' }}>
                {gettext('No log information available for this job')}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${theme.palette.divider}`, p: 1.5 }}>
          <Button onClick={handleCloseJobLog} variant="outlined">{gettext('Close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Node Details Drawer */}
      {renderNodeDetails()}
    </SectionContainer>
  );
}

JobMonitor.propTypes = {
  sid: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  pageVisible: PropTypes.bool,
};