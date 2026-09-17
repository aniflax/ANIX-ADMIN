import React, { useState, useEffect, useCallback } from 'react';
import { 
  Box, Typography, Paper, Button, Alert, CircularProgress,
  Grid, Card, CardContent, IconButton, Tooltip, Chip,
  Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, Link
} from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import HistoryIcon from '@mui/icons-material/History';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ListAltIcon from '@mui/icons-material/ListAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { connectAttendanceStream } from '../../utils/attendanceSync';
import { formatDisplayDate, getIsoDate } from '../../utils/dateFormat';
import { getAttendanceCoordinateKey, resolveAttendanceLocationLabel } from '../../utils/reverseGeocode';

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const IST_TIME_ZONE = 'Asia/Kolkata';

const SYNTHETIC_SOURCE = 'SYSTEM';

const parseDateParts = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
};

const compareDateParts = (a, b) => {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
};

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

const getStatusColor = (status) => {
  switch(status) {
    case 'PRESENT': return '#4caf50';
    case 'ABSENT': return '#f44336';
    case 'HALF_DAY': return '#ff9800';
    case 'ON_LEAVE': return '#f28b26';
    case 'HOLIDAY': return '#9c27b0';
    case 'WEEK_OFF': return '#607d8b';
    default: return '#e0e0e0';
  }
};

const getStatusLabel = (status) => {
  switch(status) {
    case 'PRESENT': return 'Present';
    case 'ABSENT': return 'Absent';
    case 'HALF_DAY': return 'Half Day';
    case 'ON_LEAVE': return 'On Leave';
    case 'HOLIDAY': return 'Holiday';
    case 'WEEK_OFF': return 'Week Off';
    default: return 'N/A';
  }
};

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

const formatIsoDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

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

const buildAttendanceCalendarEntries = ({
  year,
  month,
  todayIso,
  history,
  leaveRequests,
  defaultWeekOff,
  weekOffHistory = [],
  activatedAt,
}) => {
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

    if (entries[dateStr]) {
      continue;
    }

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
    const isDefaultWeekOff = currentDate.toLocaleDateString('en-US', { weekday: 'long' }) === effectiveWeekOff;
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

export default function Attendance() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [history, setHistory] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [logDialog, setLogDialog] = useState(false);
  const [locationPermission, setLocationPermission] = useState('checking');
  
  // Calendar State
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date());

  const fetchHistory = useCallback(async () => {
    try {
      const res = await api.get('/api/attendance/history');
      setHistory(res.data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchLeaveRequests = useCallback(async () => {
    try {
      const res = await api.get('/api/leave/requests');
      setLeaveRequests(res.data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
    fetchLeaveRequests();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const disconnectAttendanceStream = connectAttendanceStream(() => {
      fetchHistory();
      fetchLeaveRequests();
    });

    return () => {
      clearInterval(timer);
      disconnectAttendanceStream();
    };
  }, [fetchHistory, fetchLeaveRequests]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationPermission('unsupported');
      return undefined;
    }

    let permissionStatus;
    let isMounted = true;

    const updatePermission = (state) => {
      if (isMounted) setLocationPermission(state);
    };

    if (!navigator.permissions?.query) {
      setLocationPermission('prompt');
      return undefined;
    }

    navigator.permissions.query({ name: 'geolocation' })
      .then((status) => {
        permissionStatus = status;
        updatePermission(status.state);
        status.onchange = () => updatePermission(status.state);
      })
      .catch(() => updatePermission('prompt'));

    return () => {
      isMounted = false;
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, []);

  const handleMarkAttendance = () => {
    setLoading(true);
    setMessage({ text: '', type: '' });

    if (!navigator.geolocation) {
      setLoading(false);
      setLocationPermission('unsupported');
      setMessage({ text: 'Location access is required to mark attendance on this device.', type: 'error' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationPermission('granted');
        submitAttendance(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        console.warn("Geolocation Error:", error.message);
        setLoading(false);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationPermission('denied');
        } else {
          setLocationPermission('unavailable');
        }
        setMessage({ text: 'Location permission is required. Please allow location access and try again.', type: 'error' });
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  };

  const submitAttendance = async (lat, lng) => {
    try {
      const payload = { source: 'WEB' };
      if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) {
        payload.lat = lat;
        payload.lng = lng;
      }
      const res = await api.post('/api/attendance/mark', payload);
      const newLog = res.data;
      if (newLog?.id) {
        setHistory((prev) => {
          const next = [newLog, ...prev.filter((item) => item.id !== newLog.id && item.date !== newLog.date)];
          return next.sort((a, b) => b.date.localeCompare(a.date));
        });
      }
      await fetchHistory();
      setViewDate(new Date());
      setMessage({ text: 'Attendance marked successfully!', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to mark attendance', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const todayIso = getLocalIsoDate(today);
  const activationDateStr = getIsoDate(user?.activated_at);
  const todayParts = parseDateParts(todayIso);
  const todayLog = activationDateStr && todayIso >= activationDateStr
    ? history.find(h => getIsoDate(h.date) === todayIso)
    : null;
  const isMarkedToday = !!todayLog;
  const ownLeaveRequests = leaveRequests.filter(r => r.employee_id === user?.id);
  const derivedHistory = buildAttendanceCalendarEntries({
    year: viewDate.getFullYear(),
    month: viewDate.getMonth(),
    todayIso,
    history,
    leaveRequests: ownLeaveRequests,
    defaultWeekOff: user?.default_week_off || 'Sunday',
    weekOffHistory: user?.week_off_history || [],
    activatedAt: user?.activated_at,
  });
  const derivedHistoryMap = {};
  derivedHistory.forEach((entry) => {
    derivedHistoryMap[entry.date] = entry;
  });
  const displayedMonthlyHistory = derivedHistory.filter((entry) => {
    const entryDate = parseDateParts(entry.date);
    return entryDate.year === viewDate.getFullYear() && entryDate.month === viewDate.getMonth() + 1;
  });
  const locationLabels = useResolvedAttendanceLocationLabels(displayedMonthlyHistory);

  // Monthly stats
  const selectedMonthLogs = buildAttendanceCalendarEntries({
    year: viewDate.getFullYear(),
    month: viewDate.getMonth(),
    todayIso,
    history,
    leaveRequests: ownLeaveRequests,
    defaultWeekOff: user?.default_week_off || 'Sunday',
    weekOffHistory: user?.week_off_history || [],
    activatedAt: user?.activated_at,
  }).filter(h => {
    const d = parseDateParts(h.date);
    return d.month === viewDate.getMonth() + 1 && d.year === viewDate.getFullYear();
  });
  const daysPresent = selectedMonthLogs.filter(h => h.status === 'PRESENT').length;
  const daysAbsent = selectedMonthLogs.filter(h => h.status === 'ABSENT').length;
  const geoMismatches = selectedMonthLogs.filter(h => h.geo_flagged).length;

  const leaves = selectedMonthLogs.filter(h => h.status === 'ON_LEAVE').length;

  const todayWeekAnchor = new Date(`${todayIso}T00:00:00`);
  const weekStartOffset = (todayWeekAnchor.getDay() + 6) % 7;
  const weekStartDate = parseDateParts(getLocalIsoDate(new Date(todayWeekAnchor.getFullYear(), todayWeekAnchor.getMonth(), todayWeekAnchor.getDate() - weekStartOffset)));
  const weekEndDate = parseDateParts(getLocalIsoDate(new Date(todayWeekAnchor.getFullYear(), todayWeekAnchor.getMonth(), todayWeekAnchor.getDate() - weekStartOffset + 6)));

  const approvedWeekOffThisWeek = ownLeaveRequests.some((r) => {
    if (r.status !== 'APPROVED' || r.leave_type_name !== 'Week Off') return false;
    const day = parseDateParts(r.start_date);
    return compareDateParts(day, weekStartDate) >= 0 && compareDateParts(day, weekEndDate) <= 0;
  });
  const isApprovedLeaveToday = ownLeaveRequests.some((r) => {
    if (r.status !== 'APPROVED' || r.leave_type_name === 'Week Off') return false;
    const start = parseDateParts(r.start_date);
    const end = parseDateParts(r.end_date);
    return compareDateParts(start, todayParts) <= 0 && compareDateParts(end, todayParts) >= 0;
  });
  const isApprovedWeekOffToday = ownLeaveRequests.some((r) => {
    if (r.status !== 'APPROVED' || r.leave_type_name !== 'Week Off') return false;
    return compareDateParts(parseDateParts(r.start_date), todayParts) === 0;
  });
  const effectiveWeekOffToday = getEffectiveWeekOffDay(todayIso, user?.default_week_off || 'Sunday', user?.week_off_history || []);
  const isDefaultWeekOffToday = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: IST_TIME_ZONE }) === effectiveWeekOffToday && !approvedWeekOffThisWeek;
  const attendanceBlockedReason = isApprovedLeaveToday ? 'On Leave Today' : (isApprovedWeekOffToday || isDefaultWeekOffToday) ? 'Week Off Today' : '';
  const activationBlockedReason = !activationDateStr || todayIso < activationDateStr ? 'Account Not Activated' : '';
  const markBlockedReason = activationBlockedReason || attendanceBlockedReason;
  const locationBlockedReason = locationPermission === 'unsupported'
    ? 'Location Unsupported'
    : locationPermission === 'denied'
      ? 'Allow Location Access'
      : '';
  const isAttendanceBlockedToday = Boolean(markBlockedReason || locationBlockedReason);
  const showLocationCaptureRequirement = !isMarkedToday
    && !markBlockedReason
    && ['denied', 'unsupported', 'unavailable'].includes(locationPermission);

  // Calendar logic
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <Box>
      <Box display="flex" alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" mb={4} gap={2} flexDirection={{ xs: 'column', sm: 'row' }}>
        <Box>
          <Box display="flex" alignItems="center" gap={2} mb={1}>
            <AccessTimeIcon sx={{ fontSize: 32, color: '#f47c20' }} />
            <Typography variant="h5" fontWeight="bold">Attendance Hub</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Mark your daily attendance and track your records.
          </Typography>
        </Box>
        <Button 
          variant="outlined" 
          startIcon={<ListAltIcon />}
          onClick={() => setLogDialog(true)}
          sx={{ borderRadius: 2, width: { xs: '100%', sm: 'auto' } }}
        >
          View Attendance Log
        </Button>
      </Box>

      {message.text && <Alert severity={message.type} sx={{ mb: 3, borderRadius: 2 }} onClose={() => setMessage({text:'', type:''})}>{message.text}</Alert>}

      {/* Main Grid: Left (Mark + Summary) | Right (Calendar) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(300px, 360px) minmax(0, 1fr)' },
          gap: 3,
          alignItems: 'start',
          width: '100%',
        }}
      >
        {/* Left Column - Fixed Width */}
        <Box sx={{ minWidth: 0 }}>
          {/* Mark Attendance Card */}
          <Card sx={{ 
            borderRadius: 4, textAlign: 'center', 
            background: isMarkedToday ? 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)' : 'linear-gradient(135deg, #f47c20 0%, #d66a18 100%)',
            color: 'white',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            mb: 3
          }}>
            <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
              <Typography
                variant="h6"
                fontWeight="bold"
                sx={{ opacity: 0.9, mb: 1, whiteSpace: { xs: 'normal', sm: 'nowrap' }, fontSize: { xs: '1rem', sm: '1.25rem' } }}
              >
                {today.toLocaleDateString('en-IN', { weekday: 'long' })}, {formatDisplayDate(todayIso)}
              </Typography>
              <Typography variant="h2" fontWeight="900" sx={{ mb: 2, fontSize: { xs: '2.6rem', sm: '3.75rem' } }}>
                {currentTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </Typography>
              
              <Box sx={{ my: 3 }}>
                {isMarkedToday ? (
                  <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.15)', borderRadius: 3 }}>
                    <CheckCircleIcon sx={{ fontSize: 50, mb: 1 }} />
                    <Typography variant="h6" fontWeight="bold" sx={{ whiteSpace: { xs: 'normal', sm: 'nowrap' } }}>Attendance Marked</Typography>
                    <Typography variant="body2" sx={{ opacity: 0.8 }}>
                      Marked at {new Date(todayLog.check_in_time).toLocaleTimeString('en-IN', { timeZone: IST_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true })}
                    </Typography>
                    {todayLog.geo_flagged && (
                      <Chip icon={<ErrorOutlineIcon />} label="Location Mismatch" size="small" sx={{ mt: 1, bgcolor: 'rgba(255,152,0,0.3)' }} />
                    )}
                  </Box>
                ) : (
                  <Button 
                    variant="contained" 
                    fullWidth
                    size="large" 
                    startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <LocationOnIcon />}
                    onClick={handleMarkAttendance}
                    disabled={loading || isAttendanceBlockedToday}
                    sx={{ 
                      py: 2.5, borderRadius: 3, fontSize: '1.2rem', fontWeight: 'bold', textTransform: 'none',
                      whiteSpace: { xs: 'normal', sm: 'nowrap' },
                      bgcolor: '#f47c20',
                      color: 'white',
                      boxShadow: '0 4px 12px rgba(244, 124, 32, 0.4)',
                      '&:hover': { bgcolor: '#d66a18', boxShadow: '0 6px 16px rgba(244, 124, 32, 0.5)' }
                    }}
                  >
                    {loading ? 'Capturing Location...' : markBlockedReason || locationBlockedReason || 'Mark Attendance'}
                  </Button>
                )}
              </Box>
              {showLocationCaptureRequirement && (
                <Typography variant="caption" sx={{ opacity: 0.85 }}>
                  Location coordinates are required before attendance can be marked.
                </Typography>
              )}
            </CardContent>
          </Card>

          {/* Monthly Summary */}
          <Card sx={{ borderRadius: 4, border: '1px solid #eee', boxShadow: 'none' }}>
            <CardContent sx={{ p: { xs: 2.25, sm: 3 } }}>
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, whiteSpace: { xs: 'normal', sm: 'nowrap' } }}>
                {MONTHS[viewDate.getMonth()]} Summary
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: 'rgba(76, 175, 80, 0.08)', borderRadius: 2 }}>
                    <Typography variant="h4" fontWeight="bold" color="success.main">{daysPresent}</Typography>
                    <Typography variant="caption" color="text.secondary">Present</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: 'rgba(33, 150, 243, 0.08)', borderRadius: 2 }}>
                    <Typography variant="h4" fontWeight="bold" sx={{ color: '#f28b26' }}>{leaves}</Typography>
                    <Typography variant="caption" color="text.secondary">Leaves</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: 'rgba(244, 67, 54, 0.08)', borderRadius: 2 }}>
                    <Typography variant="h4" fontWeight="bold" color="error.main">{daysAbsent}</Typography>
                    <Typography variant="caption" color="text.secondary">Absent</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: 'rgba(255, 152, 0, 0.08)', borderRadius: 2 }}>
                    <Typography variant="h4" fontWeight="bold" color="warning.main">{geoMismatches}</Typography>
                    <Typography variant="caption" color="text.secondary">Geo Flags</Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Box>

        {/* Right Column: Calendar - Takes Remaining Space */}
        <Box sx={{ minWidth: 0 }}>
          <Paper sx={{ width: '100%', p: { xs: 1, sm: 2.5 }, borderRadius: { xs: 2.5, sm: 4 }, border: '1px solid #eee', boxShadow: 'none', overflowX: 'hidden' }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1.5}>
              <Box display="flex" alignItems="center" gap={1}>
                <CalendarMonthIcon color="primary" />
                <Typography variant="h6" fontWeight="bold" sx={{ fontSize: { xs: '1rem', sm: '1.25rem' } }}>{MONTHS[month]} {year}</Typography>
              </Box>
              <Box display="flex" alignItems="center" gap={1}>
                <IconButton size="small" onClick={prevMonth} sx={{ border: '1px solid #eee' }}><ChevronLeftIcon /></IconButton>
                <IconButton size="small" onClick={nextMonth} sx={{ border: '1px solid #eee' }}><ChevronRightIcon /></IconButton>
              </Box>
            </Box>
            
            {/* Calendar using Table for proper alignment */}
            <Box sx={{ width: '100%', borderCollapse: 'collapse' }}>
              {/* Weekday Headers */}
              <Box sx={{ display: 'flex', borderBottom: '2px solid #e0e0e0' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <Box key={d} sx={{ flex: 1, textAlign: 'center', py: 1 }}>
                    <Typography variant="caption" fontWeight="bold" color="text.secondary">{d}</Typography>
                  </Box>
                ))}
              </Box>
              
              {/* Calendar Days */}
              {(() => {
                const weeks = [];
                const totalCells = firstDay + daysInMonth;
                const totalWeeks = Math.ceil(totalCells / 7);
                
                for (let week = 0; week < totalWeeks; week++) {
                  const weekDays = [];
                  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
                    const cellIndex = week * 7 + dayOfWeek;
                    const day = cellIndex - firstDay + 1;
                    const isValidDay = day >= 1 && day <= daysInMonth;
                    
                    if (isValidDay) {
                      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const log = derivedHistoryMap[dateStr];
                      const isSelectedToday = dateStr === todayIso;
                      const isFuture = dateStr > todayIso;
                      const isBeforeActivation = !activationDateStr || dateStr < activationDateStr;
                      
                      weekDays.push(
                        <Box key={dayOfWeek} sx={{ 
                          flex: 1, 
                          p: { xs: 0.2, sm: 0.375 },
                          borderRight: dayOfWeek < 6 ? '1px solid #f0f0f0' : 'none',
                          borderBottom: week < totalWeeks - 1 ? '1px solid #f0f0f0' : 'none'
                        }}>
                          <Tooltip title={log ? getStatusLabel(log.status) : (isFuture || isBeforeActivation ? '' : 'Not marked')} arrow>
                            <Box sx={{ 
                              width: '100%',
                              minHeight: { xs: 42, sm: 52 },
                              borderRadius: { xs: 1.25, sm: 2 },
                              display: 'flex', 
                              flexDirection: 'column', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              bgcolor: log ? `${getStatusColor(log.status)}15` : (isFuture || isBeforeActivation ? '#fafafa' : 'transparent'),
                              border: isSelectedToday ? '2px solid #f47c20' : '1px solid transparent',
                              position: 'relative',
                              cursor: 'default'
                            }}>
                              <Typography 
                                variant="body2" 
                                fontWeight={isSelectedToday ? 'bold' : 'normal'} 
                                sx={{ mb: 0.5 }}
                              >
                                {day}
                              </Typography>
                              {log && (
                                <Box sx={{ 
                                  width: { xs: 14, sm: 20 },
                                  height: 4, 
                                  borderRadius: 2, 
                                  bgcolor: getStatusColor(log.status)
                                }} />
                              )}
                              {log?.geo_flagged && (
                                <Box sx={{ 
                                  position: 'absolute', 
                                  top: 3, 
                                  right: 3,
                                  width: 6, 
                                  height: 6, 
                                  borderRadius: '50%', 
                                  bgcolor: '#ff9800'
                                }} />
                              )}
                            </Box>
                          </Tooltip>
                        </Box>
                      );
                    } else {
                      weekDays.push(
                        <Box key={dayOfWeek} sx={{ 
                          flex: 1, 
                          p: 0.375,
                          borderRight: dayOfWeek < 6 ? '1px solid #f0f0f0' : 'none',
                          borderBottom: week < totalWeeks - 1 ? '1px solid #f0f0f0' : 'none'
                        }}>
                          <Box sx={{ minHeight: 52, bgcolor: '#fafafa', borderRadius: 1 }} />
                        </Box>
                      );
                    }
                  }
                  
                  weeks.push(
                    <Box key={week} sx={{ display: 'flex' }}>
                      {weekDays}
                    </Box>
                  );
                }
                
                return weeks;
              })()}
            </Box>

            {/* Legend */}
            <Box display="flex" gap={3} mt={2} flexWrap="wrap" justifyContent="center">
              {['PRESENT', 'ABSENT', 'WEEK_OFF', 'ON_LEAVE'].map(status => (
                <Box key={status} display="flex" alignItems="center" gap={1}>
                  <Box sx={{ width: 24, height: 4, borderRadius: 2, bgcolor: getStatusColor(status) }} />
                  <Typography variant="caption" color="text.secondary">{getStatusLabel(status)}</Typography>
                </Box>
              ))}
            </Box>
          </Paper>
        </Box>
      </Box>

      {/* Full Attendance Log Dialog */}
      <Dialog
        open={logDialog}
        onClose={() => setLogDialog(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <HistoryIcon color="primary" />
            Attendance Log - {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
          </Box>
        </DialogTitle>
        <DialogContent>
	          <Box sx={{ overflowX: 'auto' }}>
	          <Table size="small" sx={{ minWidth: 760 }}>
	            <TableHead sx={{ bgcolor: '#f8f9fa' }}>
	              <TableRow>
	                <TableCell><b>Date</b></TableCell>
	                <TableCell><b>Day</b></TableCell>
	                <TableCell><b>Time</b></TableCell>
	                <TableCell><b>Status</b></TableCell>
	                <TableCell><b>Location</b></TableCell>
	                <TableCell><b>Location status</b></TableCell>
	              </TableRow>
	            </TableHead>
	            <TableBody>
	              {displayedMonthlyHistory.map((log) => (
	                <TableRow key={log.id} hover>
	                  <TableCell>{formatDisplayDate(log.date)}</TableCell>
	                  <TableCell>{new Date(`${log.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })}</TableCell>
	                  <TableCell>
                    {log.check_in_time ? new Date(log.check_in_time).toLocaleTimeString('en-IN', { timeZone: IST_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }) : '--'}
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={getStatusLabel(log.status)} 
	                      size="small"
	                      sx={{ bgcolor: `${getStatusColor(log.status)}20`, color: getStatusColor(log.status), fontWeight: 'bold' }}
	                    />
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
	              {displayedMonthlyHistory.length === 0 && (
	                <TableRow>
	                  <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
	                    <Typography color="text.secondary">No records for this month</Typography>
	                  </TableCell>
	                </TableRow>
	              )}
	            </TableBody>
	          </Table>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
