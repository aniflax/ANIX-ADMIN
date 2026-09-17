import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  useMediaQuery,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { connectAttendanceStream } from '../../utils/attendanceSync';
import { formatDisplayDate, formatDisplayDateRange, formatDisplayDateTime, getIsoDate } from '../../utils/dateFormat';
import { getAttendanceCoordinateKey, resolveAttendanceLocationLabel } from '../../utils/reverseGeocode';
import LeaveMonthCalendar from '../../components/leave/LeaveMonthCalendar';
import CalendarErrorBoundary from '../../components/leave/CalendarErrorBoundary';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const IST_TIME_ZONE = 'Asia/Kolkata';
const SYNTHETIC_SOURCE = 'SYSTEM';

const parseDateParts = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
};

const formatIsoDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const getLocalIsoDate = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const getEffectiveWeekOffDay = (dateStr, fallbackWeekOff, weekOffHistory = []) => {
  const sortedHistory = [...(weekOffHistory || [])]
    .filter((entry) => entry?.week_off_day && entry?.effective_from)
    .sort((a, b) => getIsoDate(a.effective_from).localeCompare(getIsoDate(b.effective_from)));
  let effectiveDay = fallbackWeekOff || 'Sunday';
  sortedHistory.forEach((entry) => {
    const effectiveFrom = getIsoDate(entry.effective_from);
    if (effectiveFrom && effectiveFrom <= dateStr) {
      effectiveDay = entry.week_off_day;
    }
  });
  return effectiveDay;
};

const getWeekKey = (dateStr) => {
  const date = new Date(`${dateStr}T00:00:00`);
  const jsDay = date.getDay();
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  return formatIsoDate(monday);
};

const buildAttendanceCalendarEntries = ({ year, month, todayIso, history, leaveRequests, defaultWeekOff, weekOffHistory = [], activatedAt }) => {
  const entries = {};
  const approvedWeekOffDates = new Set();
  const weekOffSwapWeeks = new Set();
  const approvedLeaveDates = new Set();

  const activationDateStr = getIsoDate(activatedAt);
  if (!activationDateStr) {
    return [];
  }

  leaveRequests
    .filter((request) => request.status === 'APPROVED')
    .forEach((request) => {
      const startIso = getIsoDate(request.start_date);
      const endIso = getIsoDate(request.end_date);
      if (!startIso || !endIso) return;

      const startDate = new Date(`${startIso}T00:00:00`);
      const endDate = new Date(`${endIso}T00:00:00`);
      for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
        const dateStr = formatIsoDate(cursor);
        if (request.leave_type_name === 'Week Off') {
          approvedWeekOffDates.add(dateStr);
          weekOffSwapWeeks.add(getWeekKey(dateStr));
        } else {
          approvedLeaveDates.add(dateStr);
        }
      }
    });

  history.forEach((log) => {
    const logDate = getIsoDate(log.date);
    if (!logDate || logDate < activationDateStr) return;
    entries[logDate] = { ...log, date: logDate };
  });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month, day);
    const dateStr = formatIsoDate(currentDate);

    if (entries[dateStr]) continue;

    if (approvedLeaveDates.has(dateStr)) {
      if (dateStr < activationDateStr) continue;
      entries[dateStr] = {
        id: `leave-${dateStr}`,
        employee_id: history[0]?.employee_id || null,
        date: dateStr,
        check_in_time: null,
        check_out_time: null,
        status: 'ON_LEAVE',
        source: SYNTHETIC_SOURCE,
        geo_flagged: false,
        is_manual: false,
        unlocked_by_id: null,
      };
      continue;
    }

    const isApprovedWeekOff = approvedWeekOffDates.has(dateStr);
    const effectiveWeekOff = getEffectiveWeekOffDay(dateStr, defaultWeekOff, weekOffHistory);
    const isDefaultWeekOff = currentDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: IST_TIME_ZONE }) === effectiveWeekOff;
    const isShiftedWeek = weekOffSwapWeeks.has(getWeekKey(dateStr));
    if (isApprovedWeekOff || (isDefaultWeekOff && !isShiftedWeek)) {
      if (dateStr < activationDateStr) continue;
      entries[dateStr] = {
        id: `week-off-${dateStr}`,
        employee_id: history[0]?.employee_id || null,
        date: dateStr,
        check_in_time: null,
        check_out_time: null,
        status: 'WEEK_OFF',
        source: SYNTHETIC_SOURCE,
        geo_flagged: false,
        is_manual: false,
        unlocked_by_id: null,
      };
      continue;
    }

    if (dateStr < todayIso) {
      if (dateStr < activationDateStr) {
        continue;
      }
      entries[dateStr] = {
        id: `absent-${dateStr}`,
        employee_id: history[0]?.employee_id || null,
        date: dateStr,
        check_in_time: null,
        check_out_time: null,
        status: 'ABSENT',
        source: SYNTHETIC_SOURCE,
        geo_flagged: false,
        is_manual: false,
        unlocked_by_id: null,
      };
    }
  }

  return Object.values(entries).sort((a, b) => b.date.localeCompare(a.date));
};

const getAttendanceStatusColor = (status) => {
  switch (status) {
    case 'PRESENT': return '#4caf50';
    case 'ABSENT': return '#f44336';
    case 'HALF_DAY': return '#ff9800';
    case 'ON_LEAVE': return '#f28b26';
    case 'HOLIDAY': return '#9c27b0';
    case 'WEEK_OFF': return '#607d8b';
    default: return '#e0e0e0';
  }
};

const getAttendanceStatusLabel = (status) => {
  switch (status) {
    case 'PRESENT': return 'Present';
    case 'ABSENT': return 'Absent';
    case 'HALF_DAY': return 'Half Day';
    case 'ON_LEAVE': return 'On Leave';
    case 'HOLIDAY': return 'Holiday';
    case 'WEEK_OFF': return 'Week Off';
    default: return 'N/A';
  }
};

const ATTENDANCE_LOG_DOWNLOAD_ROLES = ['HR', 'ADMIN', 'SUPER_ADMIN'];

const getAttendanceLocationLabel = (log) => {
  if (log.location_name) return log.location_name;
  if (log.location_lat !== null && log.location_lat !== undefined && log.location_lng !== null && log.location_lng !== undefined) {
    return 'Unnamed location';
  }
  return '--';
};

const getAttendanceLocationStatus = (log) => {
  if (log.location_status) return log.location_status;
  if (log.geo_flagged) return 'Mismatch';
  if (log.check_in_time) return 'Verified';
  return '--';
};

const getLocationStatusColor = (status) => {
  switch (status) {
    case 'Verified': return 'success';
    case 'Mismatch': return 'warning';
    case 'Captured': return 'info';
    case 'Not captured': return 'default';
    default: return 'default';
  }
};

const escapeCsvValue = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

function AttendanceLocationCell({ log, resolvedLocationLabel }) {
  const label = resolvedLocationLabel || getAttendanceLocationLabel(log);
  const hasMap = Boolean(log.location_map_url);

  if (!hasMap || label === '--') {
    return <Typography variant="body2" color="text.secondary">{label}</Typography>;
  }

  return (
    <Link
      href={log.location_map_url}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 700, overflowWrap: 'anywhere' }}
    >
      {label}
      <OpenInNewIcon sx={{ fontSize: 14 }} />
    </Link>
  );
}

function useResolvedAttendanceLocationLabels(logs) {
  const [labels, setLabels] = useState({});
  const coordinateSignature = Array.from(new Set((logs || []).map(getAttendanceCoordinateKey).filter(Boolean))).sort().join('|');

  useEffect(() => {
    if (!coordinateSignature) return undefined;
    let isActive = true;
    const coordinateKeys = coordinateSignature.split('|');

    Promise.all(coordinateKeys.map(async (key) => {
      const [lat, lng] = key.split(',').map(Number);
      const label = await resolveAttendanceLocationLabel(lat, lng);
      return [key, label];
    })).then((resolvedEntries) => {
      if (!isActive) return;
      setLabels((current) => {
        const next = { ...current };
        let changed = false;
        resolvedEntries.forEach(([key, label]) => {
          if (next[key] !== label) {
            next[key] = label;
            changed = true;
          }
        });
        return changed ? next : current;
      });
    });

    return () => {
      isActive = false;
    };
  }, [coordinateSignature]);

  return labels;
}

function RequestProgress({ request, skipHodStep = false }) {
  const status = request.status;
  const steps = skipHodStep ? ['Applied', 'HR Approval'] : ['Applied', 'HOD Approval', 'HR Approval'];
  let currentStep = 1;

  if (skipHodStep) {
    if (status === 'APPROVED') currentStep = 2;
    if (status === 'REJECTED') currentStep = 1;
    if (status === 'CANCELLED') currentStep = 1;
  } else {
    if (status === 'PENDING') currentStep = 1;
    if (status === 'HOD_APPROVED') currentStep = 2;
    if (status === 'APPROVED') currentStep = 3;
    if (status === 'REJECTED') currentStep = 1;
    if (status === 'CANCELLED') currentStep = 1;
  }

  const formatStepDate = (date) => {
    if (!date) return '';
    return formatDisplayDateTime(date);
  };

  return (
    <Box sx={{ width: '100%', mt: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', px: 0, width: '100%', gap: 0 }}>
        {steps.map((label, idx) => {
          const isCompleted = currentStep > idx;
          const isActive = currentStep === idx;
          const showCheck = isCompleted || (idx === 0 && status !== 'CANCELLED');

          return (
            <React.Fragment key={label}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
                <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Box sx={{
                    width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: isCompleted ? '#4caf50' : 'white',
                    border: isActive ? '2px solid #757575' : isCompleted ? 'none' : '2px solid #bdbdbd',
                    color: isCompleted ? 'white' : isActive ? '#757575' : '#bdbdbd',
                    fontWeight: 'bold', fontSize: '0.75rem',
                    boxShadow: isCompleted ? '0 2px 4px rgba(76, 175, 80, 0.2)' : 'none',
                    transition: 'all 0.3s',
                    zIndex: 3
                  }}>
                    {showCheck ? (
                      <Box component="span" sx={{ fontSize: 16 }}>✓</Box>
                    ) : (idx + 1)}
                  </Box>
                </Box>
                <Box sx={{ mt: 1, textAlign: 'center' }}>
                  <Typography variant="caption" sx={{
                    display: 'block', fontSize: '0.65rem', fontWeight: isActive ? 'bold' : 'normal',
                    color: showCheck ? '#4caf50' : isActive ? 'text.primary' : 'text.secondary',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.2
                  }}>
                    {label}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', fontSize: '0.55rem', color: 'text.secondary', mt: 0.1, whiteSpace: 'nowrap' }}>
                    {idx === 0 ? formatStepDate(request.created_at) : (isCompleted ? formatStepDate(request.updated_at) : '\u00A0')}
                  </Typography>
                </Box>
              </Box>
              {idx < steps.length - 1 && (
                <Box sx={{
                  flex: 1,
                  height: 2,
                  bgcolor: (currentStep > idx + 1) ? '#4caf50' : '#e0e0e0',
                  alignSelf: 'flex-start',
                  mt: 2,
                  mx: 0,
                  transition: 'background-color 0.5s',
                  position: 'relative',
                  top: 15
                }} />
              )}
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
}

function EmployeeDetailsCard({ employee, department }) {
  const navigate = useNavigate();

  return (
    <Card sx={{ borderRadius: 4, border: '1px solid #e8eef5', boxShadow: 'none', position: 'relative' }}>
      <CardContent sx={{ p: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} flexWrap="wrap">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ letterSpacing: '0.08em', color: 'text.secondary' }}>
              Employee Details
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
              {employee.first_name} {employee.last_name}
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            onClick={() => navigate(`/profile/${employee.id}`)}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, mb: 2, width: { xs: '100%', sm: 'auto' } }}
          >
            View Profile
          </Button>
        </Box>

        <Grid container spacing={2} alignItems="stretch">
          <Grid item xs={12} sm={4}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3, height: '100%', minHeight: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">Employee ID</Typography>
              <Typography variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{employee.employee_id}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3, height: '100%', minHeight: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">Role</Typography>
              <Typography variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{String(employee.role || '').replace('_', ' ')}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3, height: '100%', minHeight: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">Department</Typography>
              {department ? (
                <Link
                  component="button"
                  type="button"
                  underline="hover"
                  onClick={() => navigate('/departments', { state: { viewDepartmentId: department.id } })}
                  sx={{ fontWeight: 700, fontSize: '1rem', textAlign: 'left', display: 'block', maxWidth: '100%', overflowWrap: 'anywhere', lineHeight: 1.35 }}
                >
                  {department.name}
                </Link>
              ) : (
                <Typography variant="subtitle1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>Unassigned</Typography>
              )}
            </Paper>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

function AttendanceSummaryView({ employee, leaveRequests, attendanceHistory, viewDate, setViewDate, canDownloadLogs }) {
  const today = new Date();
  const todayIso = getLocalIsoDate(today);
  const monthLabel = `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
  const isMobile = useMediaQuery((theme) => theme.breakpoints.down('lg'));
  const activationDateStr = getIsoDate(employee.activated_at);

  const derivedHistory = useMemo(() => buildAttendanceCalendarEntries({
    year: viewDate.getFullYear(),
    month: viewDate.getMonth(),
    todayIso,
    history: attendanceHistory,
    leaveRequests,
    defaultWeekOff: employee.default_week_off || 'Sunday',
    weekOffHistory: employee.week_off_history || [],
    activatedAt: employee.activated_at,
  }), [attendanceHistory, leaveRequests, employee.default_week_off, employee.week_off_history, employee.activated_at, todayIso, viewDate]);

  const derivedHistoryMap = useMemo(() => {
    const map = {};
    derivedHistory.forEach((entry) => { map[entry.date] = entry; });
    return map;
  }, [derivedHistory]);

  const monthLogs = useMemo(() => derivedHistory.filter((entry) => {
    const parts = parseDateParts(entry.date);
    return parts.year === viewDate.getFullYear() && parts.month === viewDate.getMonth() + 1;
  }), [derivedHistory, viewDate]);

  const stats = {
    present: monthLogs.filter((entry) => entry.status === 'PRESENT').length,
    leaves: monthLogs.filter((entry) => entry.status === 'ON_LEAVE').length,
    absent: monthLogs.filter((entry) => entry.status === 'ABSENT').length,
    geoFlags: monthLogs.filter((entry) => entry.geo_flagged).length,
  };
  const locationLabels = useResolvedAttendanceLocationLabels(monthLogs);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const downloadAttendanceLog = () => {
    const headers = ['Date', 'Day', 'Status', 'Time', 'Location', 'Location status', 'Latitude', 'Longitude'];
    const rows = monthLogs.map((log) => [
      formatDisplayDate(log.date),
      new Date(`${log.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }),
      getAttendanceStatusLabel(log.status),
      log.check_in_time ? formatDisplayDateTime(log.check_in_time) : '',
      (locationLabels[getAttendanceCoordinateKey(log)] || getAttendanceLocationLabel(log)) === '--' ? '' : (locationLabels[getAttendanceCoordinateKey(log)] || getAttendanceLocationLabel(log)),
      getAttendanceLocationStatus(log) === '--' ? '' : getAttendanceLocationStatus(log),
      log.location_lat ?? '',
      log.location_lng ?? '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `attendance_log_${employee.employee_id || employee.id}_${MONTHS[month]}_${year}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (isMobile) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Card sx={{ borderRadius: { xs: 3, md: 4 }, border: '1px solid #e8eef5', boxShadow: 'none' }}>
          <CardContent sx={{ p: { xs: 1, md: 2 } }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
              Attendance Summary
            </Typography>
            <Grid container spacing={1}>
              <Grid item xs={6}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 3 }}>
                  <Typography variant="h4" fontWeight={700} color="success.main">{stats.present}</Typography>
                  <Typography variant="caption" color="text.secondary">Present</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 3 }}>
                  <Typography variant="h4" fontWeight={700} sx={{ color: '#f28b26' }}>{stats.leaves}</Typography>
                  <Typography variant="caption" color="text.secondary">Leaves</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 3 }}>
                  <Typography variant="h4" fontWeight={700} color="error.main">{stats.absent}</Typography>
                  <Typography variant="caption" color="text.secondary">Absent</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6}>
                <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 3 }}>
                  <Typography variant="h4" fontWeight={700} color="warning.main">{stats.geoFlags}</Typography>
                  <Typography variant="caption" color="text.secondary">Geo Flags</Typography>
                </Paper>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        <Paper sx={{ p: { xs: 1, sm: 2.5 }, borderRadius: 4, border: '1px solid #e8eef5', boxShadow: 'none', overflowX: 'hidden' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={2} flexWrap="wrap">
            <Box display="flex" alignItems="center" gap={1}>
              <CalendarMonthIcon color="primary" />
              <Typography variant="h6" fontWeight={700} sx={{ fontSize: { xs: '1rem', sm: '1.25rem' } }}>{monthLabel}</Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <IconButton size="small" onClick={() => setViewDate(new Date(year, month - 1, 1))} sx={{ border: '1px solid #e0e0e0' }}>
                <ChevronLeftIcon />
              </IconButton>
              <IconButton size="small" onClick={() => setViewDate(new Date(year, month + 1, 1))} sx={{ border: '1px solid #e0e0e0' }}>
                <ChevronRightIcon />
              </IconButton>
            </Box>
          </Box>

          <Box sx={{ width: '100%', mx: 'auto' }}>
            <Box sx={{ display: 'flex', borderBottom: '2px solid #e0e0e0' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName) => (
                <Box key={dayName} sx={{ flex: 1, textAlign: 'center', py: 1 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary">{dayName}</Typography>
                </Box>
              ))}
            </Box>

            {Array.from({ length: 6 }).map((_, week) => (
              <Box key={week} sx={{ display: 'flex' }}>
                {Array.from({ length: 7 }).map((_, dayOfWeek) => {
                  const cellIndex = week * 7 + dayOfWeek;
                  const day = cellIndex - firstDay + 1;
                  const isValidDay = day >= 1 && day <= daysInMonth;

                  if (!isValidDay) {
                    return (
                      <Box key={dayOfWeek} sx={{ flex: 1, p: { xs: 0.2, sm: 0.375 }, borderRight: dayOfWeek < 6 ? '1px solid #f0f0f0' : 'none', borderBottom: week < 5 ? '1px solid #f0f0f0' : 'none' }}>
                        <Box sx={{ minHeight: { xs: 42, sm: 56 }, bgcolor: '#fafafa', borderRadius: 1.5 }} />
                      </Box>
                    );
                  }

                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const log = derivedHistoryMap[dateStr];
                  const isToday = dateStr === todayIso;
                  const isFuture = dateStr > todayIso;
                  const isBeforeActivation = !activationDateStr || dateStr < activationDateStr;

                  return (
                    <Box key={dayOfWeek} sx={{ flex: 1, p: { xs: 0.2, sm: 0.375 }, borderRight: dayOfWeek < 6 ? '1px solid #f0f0f0' : 'none', borderBottom: week < 5 ? '1px solid #f0f0f0' : 'none' }}>
                      <Tooltip title={log ? getAttendanceStatusLabel(log.status) : (isFuture || isBeforeActivation ? '' : 'Not marked')} arrow>
                        <Box sx={{
                          minHeight: { xs: 42, sm: 56 },
                          borderRadius: { xs: 1.25, sm: 2 },
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: log ? `${getAttendanceStatusColor(log.status)}15` : (isFuture || isBeforeActivation ? '#fafafa' : 'transparent'),
                          border: isToday ? '2px solid #f47c20' : '1px solid transparent',
                          position: 'relative',
                        }}>
                          <Typography variant="body2" fontWeight={isToday ? 700 : 500}>{day}</Typography>
                          {log && <Box sx={{ width: { xs: 14, sm: 20 }, height: 4, borderRadius: 2, bgcolor: getAttendanceStatusColor(log.status), mt: 0.75 }} />}
                          {log?.geo_flagged && <Box sx={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', bgcolor: '#ff9800' }} />}
                        </Box>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>

          <Box display="flex" gap={2} mt={3} flexWrap="wrap" justifyContent="center">
            {['PRESENT', 'ABSENT', 'WEEK_OFF', 'ON_LEAVE', 'HOLIDAY'].map(status => (
              <Box key={status} display="flex" alignItems="center" gap={1}>
                <Box sx={{ width: 24, height: 4, borderRadius: 2, bgcolor: getAttendanceStatusColor(status) }} />
                <Typography variant="caption" color="text.secondary">{getAttendanceStatusLabel(status)}</Typography>
              </Box>
            ))}
          </Box>
        </Paper>

        <Paper sx={{ p: 2, borderRadius: 4, border: '1px solid #e8eef5', boxShadow: 'none' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={1.5} mb={2} flexWrap="wrap">
            <Typography variant="subtitle2" color="text.secondary">
              Attendance Log
            </Typography>
            {canDownloadLogs && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={downloadAttendanceLog}
                disabled={monthLogs.length === 0}
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
              >
                Download
              </Button>
            )}
          </Box>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell><b>Date</b></TableCell>
                  <TableCell><b>Status</b></TableCell>
                  <TableCell><b>Time</b></TableCell>
                  <TableCell><b>Location</b></TableCell>
                  <TableCell><b>Location status</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {monthLogs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell>{formatDisplayDate(log.date)}</TableCell>
                    <TableCell>
                      <Chip
                        label={getAttendanceStatusLabel(log.status)}
                        size="small"
                        sx={{ bgcolor: `${getAttendanceStatusColor(log.status)}20`, color: getAttendanceStatusColor(log.status), fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell>
                      {log.check_in_time ? formatDisplayDateTime(log.check_in_time) : '--'}
                    </TableCell>
                    <TableCell>
                      <AttendanceLocationCell log={log} resolvedLocationLabel={locationLabels[getAttendanceCoordinateKey(log)]} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getAttendanceLocationStatus(log)}
                        size="small"
                        color={getLocationStatusColor(getAttendanceLocationStatus(log))}
                        variant="outlined"
                        sx={{ fontWeight: 700 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {monthLogs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      No attendance records for this month.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(300px, 360px) minmax(0, 1fr)' },
        gap: 3,
        alignItems: 'start',
        width: '100%',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Card sx={{ borderRadius: { xs: 3, md: 4 }, border: '1px solid #e8eef5', boxShadow: 'none', mb: 3 }}>
          <CardContent sx={{ p: { xs: 1, md: 2 } }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
              Attendance Summary
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1.25 }}>
              {[
                { label: 'Present', value: stats.present, color: 'success.main' },
                { label: 'Leaves', value: stats.leaves, color: '#f28b26' },
                { label: 'Absent', value: stats.absent, color: 'error.main' },
                { label: 'Geo Flags', value: stats.geoFlags, color: 'warning.main' },
              ].map((item) => (
                <Paper
                  key={item.label}
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    minHeight: 92,
                    textAlign: 'center',
                    borderRadius: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    minWidth: 0,
                  }}
                >
                  <Typography variant="h5" fontWeight={800} color={item.color}>{item.value}</Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}
                  >
                    {item.label}
                  </Typography>
                </Paper>
              ))}
            </Box>
          </CardContent>
        </Card>

        <Paper sx={{ p: 2, borderRadius: 4, border: '1px solid #e8eef5', boxShadow: 'none' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={1.5} mb={2} flexWrap="wrap">
            <Typography variant="subtitle2" color="text.secondary">
              Attendance Log
            </Typography>
            {canDownloadLogs && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={downloadAttendanceLog}
                disabled={monthLogs.length === 0}
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
              >
                Download
              </Button>
            )}
          </Box>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell><b>Date</b></TableCell>
                  <TableCell><b>Status</b></TableCell>
                  <TableCell><b>Time</b></TableCell>
                  <TableCell><b>Location</b></TableCell>
                  <TableCell><b>Location status</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {monthLogs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell>{formatDisplayDate(log.date)}</TableCell>
                    <TableCell>
                      <Chip
                        label={getAttendanceStatusLabel(log.status)}
                        size="small"
                        sx={{ bgcolor: `${getAttendanceStatusColor(log.status)}20`, color: getAttendanceStatusColor(log.status), fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell>
                      {log.check_in_time ? formatDisplayDateTime(log.check_in_time) : '--'}
                    </TableCell>
                    <TableCell>
                      <AttendanceLocationCell log={log} resolvedLocationLabel={locationLabels[getAttendanceCoordinateKey(log)]} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getAttendanceLocationStatus(log)}
                        size="small"
                        color={getLocationStatusColor(getAttendanceLocationStatus(log))}
                        variant="outlined"
                        sx={{ fontWeight: 700 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {monthLogs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      No attendance records for this month.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Paper sx={{ p: 2.5, borderRadius: 4, border: '1px solid #e8eef5', boxShadow: 'none' }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={2} flexWrap="wrap">
            <Box display="flex" alignItems="center" gap={1}>
              <CalendarMonthIcon color="primary" />
              <Typography variant="h6" fontWeight={700}>{monthLabel}</Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <IconButton size="small" onClick={() => setViewDate(new Date(year, month - 1, 1))} sx={{ border: '1px solid #e0e0e0' }}>
                <ChevronLeftIcon />
              </IconButton>
              <IconButton size="small" onClick={() => setViewDate(new Date(year, month + 1, 1))} sx={{ border: '1px solid #e0e0e0' }}>
                <ChevronRightIcon />
              </IconButton>
            </Box>
          </Box>

          <Box sx={{ width: '100%', mx: 'auto' }}>
            <Box sx={{ display: 'flex', borderBottom: '2px solid #e0e0e0' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName) => (
                <Box key={dayName} sx={{ flex: 1, textAlign: 'center', py: 1 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary">{dayName}</Typography>
                </Box>
              ))}
            </Box>

            {Array.from({ length: 6 }).map((_, week) => (
              <Box key={week} sx={{ display: 'flex' }}>
                {Array.from({ length: 7 }).map((_, dayOfWeek) => {
                  const cellIndex = week * 7 + dayOfWeek;
                  const day = cellIndex - firstDay + 1;
                  const isValidDay = day >= 1 && day <= daysInMonth;

                  if (!isValidDay) {
                    return (
                      <Box key={dayOfWeek} sx={{ flex: 1, p: 0.375, borderRight: dayOfWeek < 6 ? '1px solid #f0f0f0' : 'none', borderBottom: week < 5 ? '1px solid #f0f0f0' : 'none' }}>
                        <Box sx={{ minHeight: 56, bgcolor: '#fafafa', borderRadius: 1.5 }} />
                      </Box>
                    );
                  }

                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const log = derivedHistoryMap[dateStr];
                  const isToday = dateStr === todayIso;
                  const isFuture = dateStr > todayIso;
                  const isBeforeActivation = !activationDateStr || dateStr < activationDateStr;

                  return (
                    <Box key={dayOfWeek} sx={{ flex: 1, p: 0.375, borderRight: dayOfWeek < 6 ? '1px solid #f0f0f0' : 'none', borderBottom: week < 5 ? '1px solid #f0f0f0' : 'none' }}>
                      <Tooltip title={log ? getAttendanceStatusLabel(log.status) : (isFuture || isBeforeActivation ? '' : 'Not marked')} arrow>
                        <Box sx={{
                          minHeight: 56,
                          borderRadius: 2,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: log ? `${getAttendanceStatusColor(log.status)}15` : (isFuture || isBeforeActivation ? '#fafafa' : 'transparent'),
                          border: isToday ? '2px solid #f47c20' : '1px solid transparent',
                          position: 'relative',
                        }}>
                          <Typography variant="body2" fontWeight={isToday ? 700 : 500}>{day}</Typography>
                          {log && <Box sx={{ width: 20, height: 4, borderRadius: 2, bgcolor: getAttendanceStatusColor(log.status), mt: 0.75 }} />}
                          {log?.geo_flagged && <Box sx={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', bgcolor: '#ff9800' }} />}
                        </Box>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>

          {/* Legend */}
          <Box display="flex" gap={3} mt={3} flexWrap="wrap" justifyContent="center">
            {['PRESENT', 'ABSENT', 'WEEK_OFF', 'ON_LEAVE', 'HOLIDAY'].map(status => (
              <Box key={status} display="flex" alignItems="center" gap={1}>
                <Box sx={{ width: 24, height: 4, borderRadius: 2, bgcolor: getAttendanceStatusColor(status) }} />
                <Typography variant="caption" color="text.secondary">{getAttendanceStatusLabel(status)}</Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}

function LeaveSummaryView({ employee, requests, viewDate, setViewDate }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const HALF_DAY_PERIOD_LABELS = {
    FIRST_HALF: 'First Half',
    SECOND_HALF: 'Second Half',
  };

  const getLeaveStatusColor = (status) => {
    switch (status) {
      case 'APPROVED': return '#2e7d32';
      case 'PENDING': return '#e65100';
      case 'HOD_APPROVED': return '#e65100';
      case 'REJECTED': return '#c62828';
      case 'CANCELLED': return '#455a64';
      default: return '#607d8b';
    }
  };

  const monthRequests = requests.filter(r => {
    const [sy, sm] = r.start_date.split('-').map(Number);
    const [ey, em] = r.end_date.split('-').map(Number);
    return (sm - 1 === month && sy === year) || (em - 1 === month && ey === year);
  }).sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  const stats = {
    approved: monthRequests.filter(r => r.status === 'APPROVED').reduce((acc, r) => acc + r.total_days, 0),
    pending: monthRequests.filter(r => ['PENDING', 'HOD_APPROVED'].includes(r.status)).reduce((acc, r) => acc + r.total_days, 0),
    rejected: monthRequests.filter(r => r.status === 'REJECTED').reduce((acc, r) => acc + r.total_days, 0),
  };

  const grouped = {};
  monthRequests.forEach(r => {
    const type = r.leave_type_name || 'Unknown';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(r);
  });

  const isHod = user?.role === 'HOD';
  const handleCellClick = (req) => {
    if (!req) return;
    const isPending = ['PENDING', 'HOD_APPROVED'].includes(req.status);
    const targetPath = isHod ? '/leave/approvals' : '/leave-admin';
    navigate(targetPath, {
      state: {
        tab: isPending ? 'pending' : 'all',
        employeeId: employee?.id,
        highlightRequestId: req.id,
        category: !isPending ? req.leave_type_name : undefined,
      },
    });
  };

  return (
    <Box>
      <CalendarErrorBoundary>
        <LeaveMonthCalendar
          requests={requests}
          viewDate={viewDate}
          setViewDate={setViewDate}
          defaultWeekOff={employee?.default_week_off || 'Sunday'}
          weekOffHistory={employee?.week_off_history || []}
          onCellClick={handleCellClick}
          renderLabel={(req) => req.leave_type_name}
          showLegend
        />
      </CalendarErrorBoundary>

      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h6" fontWeight="bold" sx={{ mb: 2 }}>Monthly Summary — {MONTHS[month]}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(120px, 1fr))' }, gap: 2, maxWidth: 560, mx: 'auto' }}>
          <Box sx={{ textAlign: 'center', p: 2, minHeight: 118, bgcolor: 'rgba(76,175,80,0.08)', borderRadius: 3, border: '1px solid rgba(76,175,80,0.2)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="h4" fontWeight="bold" color="success.main">{stats.approved}</Typography>
            <Typography variant="body2" color="text.secondary">Approved Days</Typography>
          </Box>
          <Box sx={{ textAlign: 'center', p: 2, minHeight: 118, bgcolor: 'rgba(255,152,0,0.08)', borderRadius: 3, border: '1px solid rgba(255,152,0,0.2)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="h4" fontWeight="bold" color="warning.main">{stats.pending}</Typography>
            <Typography variant="body2" color="text.secondary">Pending Days</Typography>
          </Box>
          <Box sx={{ textAlign: 'center', p: 2, minHeight: 118, bgcolor: 'rgba(244,67,54,0.08)', borderRadius: 3, border: '1px solid rgba(244,67,54,0.2)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="h4" fontWeight="bold" color="error.main">{stats.rejected}</Typography>
            <Typography variant="body2" color="text.secondary">Rejected Days</Typography>
          </Box>
        </Box>
      </Box>

      {monthRequests.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, textAlign: 'center' }}>Leave Details</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
            {Object.entries(grouped).map(([type, reqs]) => (
              <Box key={type} sx={{ minWidth: 220, maxWidth: 320, flex: '1 1 220px' }}>
                <Box sx={{ px: 1.5, py: 0.75, mb: 1.5, bgcolor: '#f47c20', borderRadius: 2, textAlign: 'center' }}>
                  <Typography variant="body2" fontWeight="bold" color="white">{type}</Typography>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {reqs.map(r => (
                    <Paper
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleCellClick(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleCellClick(r);
                        }
                      }}
                      sx={{
                        p: 1.5, borderRadius: 2,
                        borderLeft: `4px solid ${getLeaveStatusColor(r.status)}`,
                        boxShadow: 1, cursor: 'pointer',
                        '&:hover': { boxShadow: 3, transform: 'translateX(2px)', transition: 'all 0.2s' },
                      }}
                    >
                      <Typography variant="caption" fontWeight="bold" display="block">{formatDisplayDateRange(r.start_date, r.end_date)}</Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          {r.total_days} day{r.total_days > 1 ? 's' : ''}
                          {r.is_half_day ? `, ${HALF_DAY_PERIOD_LABELS[r.half_day_period] || 'Half Day'}` : ''}
                        </Typography>
                        <Chip label={r.is_half_day ? `${r.status} · ${HALF_DAY_PERIOD_LABELS[r.half_day_period] || 'Half Day'}` : r.status} color={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'error' : 'warning'} size="small" sx={{ fontWeight: 'bold', fontSize: '0.65rem' }} />
                      </Box>
                    </Paper>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function EmployeeDirectoryRecordView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(() => {
    if (location.state?.tab === 'leave') return 1;
    return 0; // Default to Attendance
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employee, setEmployee] = useState(null);
  const [department, setDepartment] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);

  // Initialize viewDate from location state if available (from Attendance Report)
  const initialDate = useMemo(() => {
    if (location.state?.month && location.state?.year) {
      return new Date(location.state.year, location.state.month - 1, 1);
    }
    return new Date();
  }, [location.state]);

  const [viewDate, setViewDate] = useState(initialDate);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [profileRes, leavesRes, attendanceRes] = await Promise.all([
        api.get(`/api/employees/${id}`),
        api.get('/api/leave/requests'),
        api.get(`/api/attendance/history/employee/${id}`)
      ]);

      const targetEmployee = profileRes.data;
      setEmployee(targetEmployee);
      setLeaveRequests(leavesRes.data.filter((request) => request.employee_id === id));
      setAttendanceHistory(attendanceRes.data);

      if (targetEmployee.department_id) {
        const departmentRes = await api.get(`/api/departments/${targetEmployee.department_id}`);
        setDepartment(departmentRes.data);
      } else {
        setDepartment(null);
      }
    } catch (fetchError) {
      setError(fetchError.response?.data?.detail || 'Failed to load employee records.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const disconnectAttendanceStream = connectAttendanceStream((event) => {
      const targetId = event?.employee_id;
      if (!targetId || targetId === id) {
        fetchData();
      }
    });

    return () => {
      disconnectAttendanceStream();
    };
  }, [fetchData, id]);

  // Determine source page for Back button
  const sourcePage = useMemo(() => {
    if (location.state?.from) return location.state.from;
    return '/directory';
  }, [location.state?.from]);

  const handleBack = () => {
    if (sourcePage.includes('non-compliance')) {
      navigate(sourcePage, {
        state: {
          restoreAttendanceReport: location.state?.attendanceReportState,
        },
      });
    } else {
      navigate(sourcePage);
    }
  };

  if (loading) {
    return <Box sx={{ p: 4 }}><CircularProgress /></Box>;
  }

  if (!employee) {
    return <Alert severity="error">{error || 'Unable to load employee.'}</Alert>;
  }

  const title = "Employee Records";
  const canDownloadAttendanceLogs = ATTENDANCE_LOG_DOWNLOAD_ROLES.includes(user?.role);

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={handleBack}
          sx={{ borderRadius: 2, textTransform: 'none', color: 'text.secondary', px: 2, bgcolor: 'rgba(0,0,0,0.04)', '&:hover': { bgcolor: 'rgba(0,0,0,0.08)' } }}
        >
          Back
        </Button>
        <Typography variant="h5" fontWeight={700}>{title}</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Box sx={{ mb: 4 }}>
        <EmployeeDetailsCard employee={employee} department={department} />
      </Box>

      <Paper sx={{ borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 20px 0 rgba(0,0,0,0.05)' }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="fullWidth"
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: '#fafafa',
            '& .MuiTab-root': { py: 2, fontWeight: 'bold', textTransform: 'none', fontSize: '1rem' }
          }}
        >
          <Tab label="Attendance Calendar" />
          <Tab label="Leave Summary" />
        </Tabs>
        <Box sx={{ p: { xs: 2, md: 4 }, minHeight: 400 }}>
          {activeTab === 0 ? (
            <AttendanceSummaryView
              employee={employee}
              leaveRequests={leaveRequests}
              attendanceHistory={attendanceHistory}
              viewDate={viewDate}
              setViewDate={setViewDate}
              canDownloadLogs={canDownloadAttendanceLogs}
            />
          ) : (
            <LeaveSummaryView
              employee={employee}
              requests={leaveRequests}
              viewDate={viewDate}
              setViewDate={setViewDate}
            />
          )}
        </Box>
      </Paper>
    </Box>
  );
}
