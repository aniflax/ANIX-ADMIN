import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Tabs, Tab, Paper, Grid, Card, CardContent,
  Button, TextField, MenuItem, Select, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Alert, CircularProgress, IconButton, Tooltip,
  LinearProgress, Stepper, Step, StepLabel, Divider,
  Checkbox, FormControlLabel, Popover
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HolidayVillageIcon from '@mui/icons-material/HolidayVillage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoIcon from '@mui/icons-material/Info';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import axios from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { formatDisplayDate, formatDisplayDateRange, getIsoDate } from '../../utils/dateFormat';
import { getTargetDefaultForSwap } from '../../utils/weekOff';
import LeaveRequestDetailDialog from '../../components/leave/LeaveRequestDetailDialog';
import LeaveMonthCalendar from '../../components/leave/LeaveMonthCalendar';
import CalendarErrorBoundary from '../../components/leave/CalendarErrorBoundary';

const getStatusColor = (status) => {
  switch (status) {
    case 'APPROVED': return '#4caf50';
    case 'HOD_APPROVED': return '#f28b26';
    case 'PENDING': return '#f28b26';
    case 'REJECTED': return '#f44336';
    default: return '#9e9e9e';
  }
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HALF_DAY_PERIOD_LABELS = {
  FIRST_HALF: 'First Half',
  SECOND_HALF: 'Second Half',
};

const parseDateOnly = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
};

const compareDateOnly = (a, b) => {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
};

const formatLocalDate = (value) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const DAY_NAME_TO_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const ACTIVE_LEAVE_STATUSES = ['APPROVED', 'PENDING', 'HOD_APPROVED'];

const isWeekOffRequest = (request) => (request.leave_type_name || '').toLowerCase() === 'week off';

const eachDateInRange = (startDate, endDate, visit) => {
  if (!startDate || !endDate) return;
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (![sy, sm, sd, ey, em, ed].every(Boolean)) return;

  const current = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (current <= end) {
    visit(formatLocalDate(current), new Date(current));
    current.setDate(current.getDate() + 1);
  }
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

const buildLeaveCalendarState = (requests = [], defaultWeekOff = 'Sunday', weekOffHistory = []) => {
  const approvedWeekOffDates = new Set();
  const pendingWeekOffDates = new Set();
  const approvedReplacedDefaultDates = new Set();
  const activeLeaveByDate = {};

  requests.forEach((request) => {
    if (isWeekOffRequest(request)) {
      if (request.status === 'APPROVED') {
        eachDateInRange(request.start_date, request.end_date, (dateStr) => {
          approvedWeekOffDates.add(dateStr);
          const replacedDefault = getTargetDefaultForSwap(dateStr, defaultWeekOff);
          if (replacedDefault) approvedReplacedDefaultDates.add(replacedDefault);
        });
      } else if (['PENDING', 'HOD_APPROVED'].includes(request.status)) {
        eachDateInRange(request.start_date, request.end_date, (dateStr) => pendingWeekOffDates.add(dateStr));
      }
      return;
    }

    if (!ACTIVE_LEAVE_STATUSES.includes(request.status)) return;
    eachDateInRange(request.start_date, request.end_date, (dateStr) => {
      if (!activeLeaveByDate[dateStr]) activeLeaveByDate[dateStr] = [];
      activeLeaveByDate[dateStr].push(request);
    });
  });

  const isWeekOffDate = (dateStr) => {
    if (approvedWeekOffDates.has(dateStr)) return 'approved';
    if (pendingWeekOffDates.has(dateStr)) return 'pending';
    // Bug 2: default week-off day whose slot was replaced by an approved swap
    if (approvedReplacedDefaultDates.has(dateStr)) return false;

    const [year, month, day] = dateStr.split('-').map(Number);
    if (![year, month, day].every(Boolean)) return false;
    const date = new Date(year, month - 1, day);
    const defaultWONum = DAY_NAME_TO_NUM[getEffectiveWeekOffDay(dateStr, defaultWeekOff, weekOffHistory)] ?? 0;
    if (date.getDay() !== defaultWONum) return false;

    // Default day is a rest day only if no other approved swap lives in the same Sun-Sat week
    const sunOffset = date.getDay();
    for (let offset = 0; offset < 7; offset += 1) {
      const check = new Date(year, month - 1, day - sunOffset + offset);
      if (approvedWeekOffDates.has(formatLocalDate(check))) return false;
    }
    return 'approved';
  };

  return { activeLeaveByDate, isWeekOffDate };
};

const getChargeableLeaveDays = (startDate, endDate, isHalfDay, isWeekOffDate) => {
  if (!startDate || !endDate) return 0;
  if (isHalfDay) return 0.5;

  let count = 0;
  eachDateInRange(startDate, endDate, (dateStr) => {
    if (!isWeekOffDate(dateStr)) count += 1;
  });
  return count;
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

const WEEK_OFF_COLOR = '#8d6e63';

function TabPanel({ children, value, index }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

// ── Apply Leave Tab (Redesigned) ─────────────────────────────────────────────────
function DateStatusCalendar({ anchorDate, selectedDate, minDate, maxDate, calendarState, onSelectDate, onClear }) {
  const base = anchorDate || selectedDate || minDate || formatLocalDate(new Date());
  const [baseYear, baseMonth] = base.split('-').map(Number);
  const [viewYear, setViewYear] = useState(baseYear || new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState((baseMonth || new Date().getMonth() + 1) - 1);
  const year = viewYear;
  const month = viewMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalWeeks = Math.ceil((firstDay + daysInMonth) / 7);
  const min = minDate || '';
  const max = maxDate || '';
  const todayIso = formatLocalDate(new Date());
  const isTodayDisabled = (min && todayIso < min) || (max && todayIso > max);

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((current) => current - 1);
    } else {
      setViewMonth((current) => current - 1);
    }
  };

  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((current) => current + 1);
    } else {
      setViewMonth((current) => current + 1);
    }
  };

  return (
    <Box sx={{ p: 1, borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <IconButton size="small" onClick={goPrev} aria-label="Previous month">
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" fontWeight={800}>
          {MONTHS[month]} {year}
        </Typography>
        <IconButton size="small" onClick={goNext} aria-label="Next month">
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', columnGap: 0.75, rowGap: 0.6 }}>
        {Array.from({ length: totalWeeks * 7 }).map((_, cellIdx) => {
          const day = cellIdx - firstDay + 1;
          const isValid = day >= 1 && day <= daysInMonth;

          if (!isValid) {
            return <Box key={cellIdx} sx={{ width: 24, height: 24 }} />;
          }

          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isDisabled = (min && dateStr < min) || (max && dateStr > max);
          const isSelected = selectedDate === dateStr;
          const dayRequests = calendarState.activeLeaveByDate[dateStr] || [];
          const primaryRequest = dayRequests[0] || null;
          const woStatus = calendarState.isWeekOffDate(dateStr);
          const isWeekOff = Boolean(woStatus);
          // Bug 1: week-off takes visual priority over leave on overlapping days
          const cellColor = isWeekOff
            ? (woStatus === 'pending' ? '#a1887f' : WEEK_OFF_COLOR)
            : primaryRequest ? getLeaveStatusColor(primaryRequest.status) : null;
          const hasCell = Boolean(primaryRequest || isWeekOff);

          return (
            <Box
              key={dateStr}
              component="button"
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onSelectDate?.(dateStr)}
              sx={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                p: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: isSelected ? 'transparent' : hasCell ? cellColor : 'transparent',
                border: isSelected ? '2px solid #2f251c' : '1px solid transparent',
                color: hasCell && !isSelected ? 'white' : 'text.primary',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled ? 0.25 : 1,
                transition: 'all 0.15s',
                '&:hover': !isDisabled ? {
                  bgcolor: isSelected ? 'transparent' : hasCell ? cellColor : 'rgba(244,124,32,0.08)',
                  transform: 'scale(1.04)',
                } : {},
              }}
            >
              <Typography sx={{
                fontSize: '0.78rem',
                fontWeight: 800,
                color: 'inherit',
                lineHeight: 1,
              }}>
                {day}
              </Typography>
            </Box>
          );
        })}
      </Box>
      <Box display="flex" justifyContent="space-between" gap={1} sx={{ mt: 1.25 }}>
        <Button size="small" onClick={onClear} sx={{ minWidth: 0, px: 1.25 }}>
          Clear
        </Button>
        <Button
          size="small"
          onClick={() => onSelectDate?.(todayIso)}
          disabled={isTodayDisabled}
          sx={{ minWidth: 0, px: 1.25 }}
        >
          Today
        </Button>
      </Box>
    </Box>
  );
}

import SendIcon from '@mui/icons-material/Send';
import BlockIcon from '@mui/icons-material/Block';

function ApplyLeaveTab({ leaveTypes, requests = [], onRefresh, onSwitchTab, onRequestCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '', is_half_day: false, half_day_period: '' });
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [balances, setBalances] = useState({});
  const [startAnchor, setStartAnchor] = useState(null);
  const [endAnchor, setEndAnchor] = useState(null);
  const startCalendarWidth = startAnchor?.offsetWidth || undefined;
  const endCalendarWidth = endAnchor?.offsetWidth || undefined;

  // Fetch balances on mount
  useEffect(() => {
    const year = new Date().getFullYear();
    axios.get(`/api/leave/balances/${user.id}?year=${year}`)
      .then(res => {
        const balMap = {};
        res.data.forEach(b => {
          const available = b.total_allocated - b.used - b.pending;
          balMap[b.leave_type_id] = { ...b, available };
        });
        setBalances(balMap);
      })
      .catch(() => { });
  }, [user.id]);

  const selectedType = leaveTypes.find(lt => lt.id === form.leave_type_id);
  const selectedBalance = balances[form.leave_type_id]?.available ?? 0;
  const activationDateStr = getIsoDate(user?.activated_at);
  const calendarState = buildLeaveCalendarState(requests, user?.default_week_off, user?.week_off_history || []);

  // Calculate max selectable end date based on balance
  const getMaxEndDate = () => {
    if (!form.start_date || !form.leave_type_id) return '';
    if (form.is_half_day) return form.start_date;
    const maxDays = selectedBalance;
    if (maxDays <= 0) return form.start_date;
    const [year, month, day] = form.start_date.split('-').map(Number);
    const maxDate = new Date(year, month - 1, day);
    let countedDays = 0;
    let guard = 0;

    while (countedDays < maxDays && guard < 370) {
      const dateStr = formatLocalDate(maxDate);
      if (!calendarState.isWeekOffDate(dateStr)) countedDays += 1;
      if (countedDays >= maxDays) break;
      maxDate.setDate(maxDate.getDate() + 1);
      guard += 1;
    }

    return formatLocalDate(maxDate);
  };

  const totalDays = form.start_date && form.end_date
    ? getChargeableLeaveDays(form.start_date, form.end_date, form.is_half_day, calendarState.isWeekOffDate)
    : 0;
  const startCalendarOpen = Boolean(startAnchor);
  const endCalendarOpen = Boolean(endAnchor);

  // Check if all leave types have 0 balance
  const allZero = leaveTypes.every(lt => (balances[lt.id]?.available ?? 0) === 0);
  if (allZero && Object.keys(balances).length > 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 4, boxShadow: 3 }}>
          <BlockIcon sx={{ fontSize: 80, color: '#f44336', mb: 2 }} />
          <Typography variant="h5" fontWeight="bold" color="error">No Leave Possible</Typography>
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            You have zero balance across all leave types.
          </Typography>
          <Typography color="text.secondary">Please contact HR.</Typography>
        </Paper>
      </Box>
    );
  }

  const submit = async () => {
    if (!form.leave_type_id || !form.start_date || !form.end_date || !form.reason) {
      setMsg({ type: 'error', text: 'Please fill all fields.' });
      return;
    }
    if (form.is_half_day && !form.half_day_period) {
      setMsg({ type: 'error', text: 'Please select First Half or Second Half for half day leave.' });
      return;
    }
    if (!activationDateStr || form.start_date < activationDateStr) {
      setMsg({ type: 'error', text: 'Leave can be applied only from the account activation date.' });
      return;
    }
    setLoading(true); setMsg(null);
    try {
      const res = await axios.post('/api/leave/apply', form);
      const createdRequest = res.data;
      const appliedDate = form.start_date;
      if (onRequestCreated) onRequestCreated(createdRequest);
      if (onRefresh) await onRefresh();
      setForm({ leave_type_id: '', start_date: '', end_date: '', reason: '', is_half_day: false, half_day_period: '' });
      onSwitchTab({ date: appliedDate, requestId: createdRequest?.id || null });
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.detail || 'Something went wrong.' });
    } finally { setLoading(false); }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
      <Paper sx={{
        p: 0,
        width: '100%',
        maxWidth: 800,
        borderRadius: 4,
        boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <Box sx={{
          background: 'linear-gradient(135deg, #f47c20 0%, #d66a18 100%)',
          p: 3,
          textAlign: 'center',
          color: 'white'
        }}>
          <Typography variant="h5" fontWeight="bold">Leave Application</Typography>
        </Box>

        {msg && <Alert severity={msg.type} sx={{ mx: 3, mt: 2, borderRadius: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

        <Box sx={{ p: 4 }}>
          {/* Current Leave Balance Section - CENTERED (Week Off excluded) */}
          <Box sx={{ mb: 4, p: 3, bgcolor: '#f8f9fa', borderRadius: 2, border: '1px solid #e0e0e0', textAlign: 'center' }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 2 }}>Current Leave Balance</Typography>
            <Grid container spacing={2} justifyContent="center">
              {leaveTypes.filter(lt => lt.name !== 'Week Off').map(lt => {
                const avail = balances[lt.id]?.available ?? 0;
                return (
                  <Grid item key={lt.id} xs={12} sm={4}>
                    <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: 'white', borderRadius: 2, border: avail === 0 ? '1px solid #f44336' : '1px solid #4caf50' }}>
                      <Typography variant="h5" fontWeight="bold" color={avail > 0 ? 'success.main' : 'error.main'}>
                        {avail}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">{lt.name}</Typography>
                    </Box>
                  </Grid>
                );
              })}
            </Grid>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Box sx={{ flex: 1.2 }}>
              <FormControl fullWidth variant="outlined" sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}>
                <InputLabel>Select Leave Type</InputLabel>
                <Select
                  value={form.leave_type_id}
                  label="Select Leave Type"
                  onChange={e => setForm(f => ({ ...f, leave_type_id: e.target.value, end_date: '', is_half_day: false, half_day_period: '' }))}
                  MenuProps={{ PaperProps: { sx: { maxHeight: 200 } } }}
                  sx={{ '& .MuiSelect-select': { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 } }}
                >
                  {leaveTypes.filter(lt => lt.name !== 'Week Off').map(lt => {
                    const avail = balances[lt.id]?.available ?? 0;
                    return (
                      <MenuItem key={lt.id} value={lt.id} disabled={avail === 0}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, width: '100%' }}>
                          <span>{lt.name}</span>
                          <span style={{ color: avail === 0 ? '#f44336' : '#4caf50', fontWeight: 'bold' }}>
                            {avail} days
                          </span>
                        </Box>
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ flex: 1 }}>
              <TextField
                fullWidth
                label="Start Date"
                InputLabelProps={{ shrink: true }}
                value={form.start_date ? formatDisplayDate(form.start_date) : ''}
                disabled={!form.leave_type_id}
                inputProps={{ readOnly: true }}
                onClick={(event) => form.leave_type_id && setStartAnchor(event.currentTarget)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, cursor: form.leave_type_id ? 'pointer' : 'default' }, '& input': { cursor: form.leave_type_id ? 'pointer' : 'default' } }}
              />
              <Popover
                open={startCalendarOpen}
                anchorEl={startAnchor}
                onClose={() => setStartAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                PaperProps={{ sx: { width: startCalendarWidth, minWidth: startCalendarWidth, border: '1px solid #f3dfcf', borderRadius: 3, boxShadow: '0 10px 24px rgba(168, 98, 45, 0.08)' } }}
              >
                <DateStatusCalendar
                  anchorDate={form.start_date || formatLocalDate(new Date())}
                  selectedDate={form.start_date}
                  minDate={activationDateStr}
                  calendarState={calendarState}
                  onClear={() => {
                    setForm(f => ({ ...f, start_date: '', end_date: '', is_half_day: false, half_day_period: '' }));
                    setStartAnchor(null);
                  }}
                  onSelectDate={(dateStr) => {
                    const newEnd = form.end_date && new Date(form.end_date) < new Date(dateStr) ? '' : form.end_date;
                    setForm(f => ({ ...f, start_date: dateStr, end_date: f.is_half_day ? dateStr : newEnd }));
                    setStartAnchor(null);
                  }}
                />
              </Popover>
            </Box>
            <Box sx={{ flex: 1 }}>
              <TextField
                fullWidth
                label="End Date"
                InputLabelProps={{ shrink: true }}
                value={form.end_date ? formatDisplayDate(form.end_date) : ''}
                disabled={!form.start_date || form.is_half_day}
                inputProps={{ readOnly: true }}
                onClick={(event) => form.start_date && !form.is_half_day && setEndAnchor(event.currentTarget)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, cursor: form.start_date && !form.is_half_day ? 'pointer' : 'default' }, '& input': { cursor: form.start_date && !form.is_half_day ? 'pointer' : 'default' } }}
              />
              <Popover
                open={endCalendarOpen}
                anchorEl={endAnchor}
                onClose={() => setEndAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                PaperProps={{ sx: { width: endCalendarWidth, minWidth: endCalendarWidth, border: '1px solid #f3dfcf', borderRadius: 3, boxShadow: '0 10px 24px rgba(168, 98, 45, 0.08)' } }}
              >
                <DateStatusCalendar
                  anchorDate={form.end_date || form.start_date}
                  selectedDate={form.end_date}
                  minDate={form.start_date}
                  maxDate={getMaxEndDate()}
                  calendarState={calendarState}
                  onClear={() => {
                    setForm(f => ({ ...f, end_date: '' }));
                    setEndAnchor(null);
                  }}
                  onSelectDate={(dateStr) => {
                    setForm(f => ({ ...f, end_date: dateStr }));
                    setEndAnchor(null);
                  }}
                />
              </Popover>
            </Box>
          </Box>

          <Box sx={{ mb: 3, p: 1.5, borderRadius: 2, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.is_half_day}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setForm(f => ({
                          ...f,
                          is_half_day: checked,
                          half_day_period: checked ? f.half_day_period : '',
                          end_date: checked ? f.start_date : f.end_date,
                        }));
                      }}
                      disabled={!form.start_date || selectedBalance < 0.5}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" fontWeight={700}>Half day leave</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Uses 0.5 day and must be for a single selected date.
                      </Typography>
                    </Box>
                  }
                />
              </Grid>
              {form.is_half_day && (
                <Grid item xs={12} sm={6} sx={{ width: { xs: "75%", md: "30%" } }}>
                  <FormControl fullWidth size="medium" sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}>
                    <InputLabel>Half Day Session</InputLabel>
                    <Select
                      label="Half Day Session"
                      value={form.half_day_period}
                      onChange={e => setForm(f => ({ ...f, half_day_period: e.target.value }))}
                    >
                      <MenuItem value="FIRST_HALF">First Half</MenuItem>
                      <MenuItem value="SECOND_HALF">Second Half</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              )}
            </Grid>
          </Box>

          {/* Row 2: Reason - Full Width */}
          <Box sx={{ mb: 2 }}>
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Reason"
              placeholder="Briefly tell us why you need time off..."
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              disabled={!form.end_date}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
            />
          </Box>

          {/* Summary */}
          {form.leave_type_id && form.start_date && form.end_date && (
            <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 3, border: '1px dashed #ccc', textAlign: 'center' }}>
              <Typography variant="body2">
                <strong>{selectedType?.name}</strong> | {formatDisplayDateRange(form.start_date, form.end_date)} | <strong>{totalDays} day{totalDays === 1 ? '' : 's'}</strong>
                {form.is_half_day && <Chip label={form.half_day_period ? `Half Day - ${HALF_DAY_PERIOD_LABELS[form.half_day_period]}` : 'Half Day'} size="small" color="primary" variant="outlined" sx={{ ml: 1 }} />}
              </Typography>
              {selectedBalance < totalDays && (
                <Typography variant="caption" color="error">Insufficient balance!</Typography>
              )}
            </Box>
          )}

          {/* Row 3: Submit - CENTERED */}
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="contained"
              size="large"
              disabled={!form.leave_type_id || !form.start_date || !form.end_date || !form.reason || (form.is_half_day && !form.half_day_period) || loading || totalDays > selectedBalance}
              onClick={submit}
              startIcon={<SendIcon />}
              sx={{
                py: 2,
                px: 6,
                borderRadius: 3,
                fontSize: '1.1rem',
                fontWeight: 'bold',
                background: 'linear-gradient(135deg, #f47c20 0%, #d66a18 100%)',
                boxShadow: '0 4px 14px 0 rgba(244, 124, 32, 0.30)'
              }}
            >
              {loading ? 'Submitting...' : 'Submit Leave Request'}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}

// ── Stepped Progress Bar (Custom) ──────────────────────────────────────────────────
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
    const raw = typeof date === 'string' ? date : String(date);
    const normalized = /T.*([Zz]|[+-]\d{2}:?\d{2})/.test(raw) ? raw : `${raw}+05:30`;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return '';
    const datePart = d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    const timePart = d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
    return `${datePart} ${timePart}`;
  };

  return (
    <Box sx={{ width: '100%', mt: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', px: 1 }}>
        {steps.map((label, idx) => {
          const isCompleted = currentStep > idx;
          const isActive = currentStep === idx;
          const showCheck = isCompleted || (idx === 0 && status !== 'CANCELLED');

          return (
            <React.Fragment key={label}>
              {/* Node Column */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
                {/* Circle Node Container */}
                <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {/* Circle Node */}
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
                    {showCheck ? <CheckCircleIcon sx={{ fontSize: 16 }} /> : (isActive ? idx + 1 : idx + 1)}
                  </Box>
                </Box>

                {/* Labels & Timestamps */}
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

              {/* Connector Line (between this node and the next) */}
              {idx < steps.length - 1 && (
                <Box sx={{
                  flex: 1,
                  height: 2,
                  bgcolor: (currentStep > idx + 1 || (currentStep > idx && steps[idx + 1] === (currentStep === idx + 1 ? steps[idx + 1] : ''))) ? '#4caf50' : '#e0e0e0', // Slightly more precise logic
                  alignSelf: 'flex-start',
                  mt: 2, // 16px (half of 32px node)
                  mx: -0.5, // Slight overlap to avoid gaps
                  transition: 'background-color 0.5s'
                }}>
                  {/* Overlap fix: highlight the line ONLY if the next step is reached */}
                  <Box sx={{
                    width: '100%',
                    height: '100%',
                    bgcolor: currentStep > idx + 1 ? '#4caf50' : (currentStep === idx + 1 && status !== 'REJECTED' && status !== 'CANCELLED' ? '#e0e0e0' : '#e0e0e0'),
                  }} />
                  {/* Simplified: just use the parent's bgcolor logic */}
                </Box>
              )}
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
}

function getRequestStatusLabel(request) {
  if (request.status === 'CANCELLED') return 'Cancelled';
  if (request.status === 'REJECTED') return 'Rejected';
  if (request.hod_skipped && request.status === 'HOD_APPROVED') return 'Awaiting HR';
  if (request.status === 'PENDING') return request.hod_skipped ? 'Awaiting HR' : 'Awaiting HoD';
  if (request.status === 'HOD_APPROVED') return 'Awaiting HR';
  if (request.status === 'APPROVED') return request.hod_skipped ? 'Final Approved' : 'Approved';
  return request.status.replace('_', ' ');
}

// ── Leave Requests Tab (New Design) ─────────────────────────────────────────────
function LeaveRequestsTab({ requests, onRefresh, appliedDate, onClearAppliedDate, calendarHighlightId, onClearCalendarHighlight, onOpenRequest }) {
  const today = new Date();
  const defaultDate = appliedDate ? new Date(appliedDate) : today;
  const [filter, setFilter] = useState('ALL'); // Default: All when redirected
  const [month, setMonth] = useState('ALL');
  const [year, setYear] = useState(defaultDate.getFullYear());
  const [cancelDialog, setCancelDialog] = useState({ open: false, id: null });
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [highlightedId, setHighlightedId] = useState(null);

  // Map a leave request status to the filter button that owns it
  const statusToFilter = (status) => {
    if (status === 'APPROVED') return 'APPROVED';
    if (status === 'REJECTED') return 'REJECTED';
    if (status === 'CANCELLED') return 'CANCELLED';
    return 'PENDING'; // PENDING + HOD_APPROVED
  };

  // When redirected with appliedDate, highlight the newest request (Bug 3: dynamic filter)
  useEffect(() => {
    if (calendarHighlightId) return;
    if (!appliedDate || requests.length === 0) return;
    const newest = requests
      .filter(r => r.start_date === appliedDate || r.start_date.startsWith(appliedDate))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (newest) {
      setFilter(statusToFilter(newest.status));
      setHighlightedId(newest.id);
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
      setTimeout(() => setHighlightedId(null), 5000); // Remove highlight after 5s
    }
    if (onClearAppliedDate) onClearAppliedDate();
  }, [appliedDate, requests, calendarHighlightId, onClearAppliedDate]);

  // Bug 3: dynamic filter from request status instead of hard-coded PENDING
  useEffect(() => {
    if (calendarHighlightId) {
      const target = requests.find(r => r.id === calendarHighlightId);
      if (target) setFilter(statusToFilter(target.status));
      setHighlightedId(calendarHighlightId);
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
      setTimeout(() => setHighlightedId(null), 5000);
      if (onClearCalendarHighlight) onClearCalendarHighlight();
      if (onClearAppliedDate) onClearAppliedDate();
    }
  }, [calendarHighlightId, requests, onClearCalendarHighlight, onClearAppliedDate]);

  const requestOverlapsYear = (request, selectedYear) => {
    const yearStart = { year: selectedYear, month: 1, day: 1 };
    const yearEnd = { year: selectedYear, month: 12, day: 31 };
    const start = parseDateOnly(request.start_date);
    const end = parseDateOnly(request.end_date);
    return compareDateOnly(start, yearEnd) <= 0 && compareDateOnly(end, yearStart) >= 0;
  };

  const requestOverlapsMonth = (request, selectedYear, selectedMonth) => {
    if (selectedMonth === 'ALL') return true;
    const monthStart = { year: selectedYear, month: selectedMonth + 1, day: 1 };
    const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const monthEnd = { year: selectedYear, month: selectedMonth + 1, day: lastDay };
    const start = parseDateOnly(request.start_date);
    const end = parseDateOnly(request.end_date);
    return compareDateOnly(start, monthEnd) <= 0 && compareDateOnly(end, monthStart) >= 0;
  };

  const yearRequests = requests.filter(r => requestOverlapsYear(r, year) && requestOverlapsMonth(r, year, month));

  const filteredRequests = yearRequests.filter(r => {

    if (filter === 'ALL') return true;
    if (filter === 'PENDING') return r.status === 'PENDING' || r.status === 'HOD_APPROVED';
    if (filter === 'APPROVED') return r.status === 'APPROVED';
    if (filter === 'REJECTED') return r.status === 'REJECTED';
    if (filter === 'CANCELLED') return r.status === 'CANCELLED'; // Bug 5
    return true;
  }).sort((a, b) => {
    if (highlightedId && a.id === highlightedId) return -1;
    if (highlightedId && b.id === highlightedId) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const doCancel = async () => {
    setLoading(true);
    try {
      await axios.post(`/api/leave/cancel/${cancelDialog.id}?comment=${encodeURIComponent(comment)}`);
      setCancelDialog({ open: false, id: null });
      setComment('');
      onRefresh();
    } catch (e) { alert(e.response?.data?.detail || 'Failed to cancel.'); }
    finally { setLoading(false); }
  };

  // Map filter key → user-facing label
  const filterLabel = (f) => {
    if (f === 'ALL') return 'All';
    if (f === 'PENDING') return 'Pending';
    if (f === 'CANCELLED') return 'Cancelled'; // Bug 5
    return f.charAt(0) + f.slice(1).toLowerCase();
  };

  return (
    <Box>
      {/* Filters & Year Selector */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'center' }, mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5, flex: '1 1 360px', minWidth: 0 }}>
          {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'].map(f => ( // Bug 5
            <Button
              key={f}
              variant={filter === f ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setFilter(f)}
              sx={{ borderRadius: 2, textTransform: 'none', px: 2, flexShrink: 0 }}
              color={filter === f ? 'primary' : 'inherit'}
            >
              {filterLabel(f)}
              {f === 'PENDING' && yearRequests.filter(r => ['PENDING', 'HOD_APPROVED'].includes(r.status)).length > 0 && (
                <Chip label={yearRequests.filter(r => ['PENDING', 'HOD_APPROVED'].includes(r.status)).length} size="small" sx={{ ml: 1, height: 16, fontSize: '0.65rem' }} color="warning" />
              )}
            </Button>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flex: { xs: '1 1 100%', md: '0 0 auto' } }}>
          <Select size="small" value={month} onChange={e => setMonth(e.target.value)} sx={{ borderRadius: 2, minWidth: { xs: 150, sm: 170 }, flex: { xs: 1, sm: '0 0 auto' } }}>
            <MenuItem value="ALL">All Months</MenuItem>
            {MONTHS.map((m, i) => <MenuItem key={m} value={i}>{m}</MenuItem>)}
          </Select>
          <Select size="small" value={year} onChange={e => setYear(Number(e.target.value))} sx={{ borderRadius: 2, minWidth: 80 }}>
            {[year - 1, year, year + 1].map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </Select>
        </Box>
      </Box>

      {/* Listed View */}
      {filteredRequests.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center', bgcolor: '#fafafa', borderRadius: 3 }}>
          <Typography color="text.secondary">No leave requests for this year</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filteredRequests.map(r => {
            const isPending = ['PENDING', 'HOD_APPROVED'].includes(r.status);

            return (
              <Paper
                key={r.id}
                role={onOpenRequest ? 'button' : undefined}
                tabIndex={onOpenRequest ? 0 : -1}
                onClick={onOpenRequest ? () => onOpenRequest(r.id) : undefined}
                onKeyDown={onOpenRequest ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenRequest(r.id);
                  }
                } : undefined}
                sx={{
                  p: 2.5,
                  borderRadius: 3,
                  borderLeft: `5px solid ${getStatusColor(r.status)}`,
                  boxShadow: highlightedId === r.id ? '0 0 0 3px #f47c20' : 2,
                  bgcolor: highlightedId === r.id ? 'rgba(244, 124, 32, 0.08)' : 'white',
                  transition: 'all 0.3s',
                  cursor: onOpenRequest ? 'pointer' : 'default',
                  '&:hover': onOpenRequest ? { boxShadow: 4, transform: 'translateY(-1px)' } : {},
                }}
              >
                <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', md: 'center' }, gap: { xs: 2, md: 4 }, py: 1, width: '100%', justifyContent: 'space-between', flexDirection: { xs: 'column', md: 'row' } }}>
                  {/* Part 1: Leave Basic Info */}
                  <Box sx={{ minWidth: { md: 160 } }}>
                    <Typography variant="subtitle2" fontWeight="800" color="text.primary" sx={{ letterSpacing: -0.2 }}>
                      {r.leave_type_name}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'text.secondary', fontWeight: 500 }}>
                      {formatDisplayDateRange(r.start_date, r.end_date)}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: 'primary.main', fontWeight: 'bold', fontSize: '0.65rem' }}>
                      {r.total_days} DAY{r.total_days === 1 ? '' : 'S'}{r.is_half_day ? ` (${HALF_DAY_PERIOD_LABELS[r.half_day_period] || 'Half Day'})` : ''}
                    </Typography>
                  </Box>

                  {/* Part 2: Progress Stepper */}
                  <Box sx={{ flex: { xs: '1 1 100%', md: '0 0 360px' }, px: { xs: 0, md: 2 }, width: { xs: '100%', md: 360 }, minWidth: { xs: 0, md: 320 }, overflowX: 'auto' }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                      <Typography variant="caption" color="text.disabled" fontWeight="700" sx={{ mb: 0.5, textTransform: 'uppercase', letterSpacing: 1.2, fontSize: '0.6rem' }}>
                        {getRequestStatusLabel(r)}
                      </Typography>
                      <RequestProgress request={r} skipHodStep={r.hod_skipped} />
                    </Box>
                  </Box>

                  {/* Part 3: Status & Action */}
                  <Box sx={{ display: 'flex', flexDirection: { xs: 'row', md: 'column' }, alignItems: { xs: 'center', md: 'flex-end' }, justifyContent: { xs: 'space-between', md: 'flex-start' }, minWidth: { md: 130 }, gap: 1 }}>
                    <Chip
                      label={getRequestStatusLabel(r)}
                      size="small"
                      color={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'error' : 'warning'}
                      variant={r.status === 'APPROVED' ? 'filled' : 'outlined'}
                      sx={{ borderRadius: 1.5, fontWeight: '900', fontSize: '0.65rem', height: 24 }}
                    />

                    {isPending && (
                      <Button
                        variant="text"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelDialog({ open: true, id: r.id });
                        }}
                        sx={{
                          textTransform: 'none',
                          color: '#d32f2f',
                          fontWeight: 'bold',
                          fontSize: '0.7rem',
                          p: 0,
                          minWidth: 0,
                          '&:hover': { background: 'none', textDecoration: 'underline' }
                        }}
                      >
                        Cancel Request
                      </Button>
                    )}
                  </Box>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      <Dialog open={cancelDialog.open} onClose={() => setCancelDialog({ open: false, id: null })} PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Cancel Leave Request</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Are you sure you want to cancel this request? This action cannot be undone.
          </Typography>
          <TextField fullWidth multiline rows={2} label="Reason (optional)" value={comment} onChange={e => setComment(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCancelDialog({ open: false, id: null })} sx={{ borderRadius: 2 }}>Keep</Button>
          <Button variant="contained" color="error" onClick={doCancel} disabled={loading} sx={{ borderRadius: 2 }}>
            {loading ? 'Cancelling...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}


// ── Leave History Calendar Tab ─────────────────────────────────────────────────
function LeaveCalendarTab({ requests, onNavigateToRequest }) {
  const { user } = useAuth();
  const [viewDate, setViewDate] = useState(() => new Date());
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const getLeaveTypeAbbrev = (name) => {
    if (!name) return 'LV';
    const normalized = name.toLowerCase();
    if (normalized.includes('casual')) return 'CL';
    if (normalized.includes('sick')) return 'SL';
    if (normalized.includes('earned') || normalized.includes('privilege')) return 'EL';
    if (normalized.includes('maternity')) return 'ML';
    if (normalized.includes('paternity')) return 'PL';
    if (normalized.includes('week off')) return 'WO';
    const words = name.split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words.map(word => word[0]).join('') : name.slice(0, 2)).toUpperCase();
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

  const getLeaveStatusLabel = (status) => {
    switch (status) {
      case 'APPROVED': return 'Approved';
      case 'PENDING': return 'Pending';
      case 'HOD_APPROVED': return 'Pending';
      case 'REJECTED': return 'Rejected';
      case 'CANCELLED': return 'Cancelled';
      default: return status;
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

  return (
    <Box>
      <CalendarErrorBoundary>
        <LeaveMonthCalendar
          requests={requests}
          viewDate={viewDate}
          setViewDate={setViewDate}
          defaultWeekOff={user?.default_week_off ?? 'Sunday'}
          weekOffHistory={user?.week_off_history || []}
          onCellClick={(req) => onNavigateToRequest && onNavigateToRequest(req.id)}
          renderLabel={(req) => getLeaveTypeAbbrev(req?.leave_type_name)}
          showLegend
        />
      </CalendarErrorBoundary>

      {/* Monthly Summary - Centered */}
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <Typography variant="h6" fontWeight="bold" sx={{ mb: 2 }}>Monthly Summary — {MONTHS[month]}</Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ textAlign: 'center', p: 2.5, minWidth: 110, bgcolor: 'rgba(76,175,80,0.08)', borderRadius: 3, border: '1px solid rgba(76,175,80,0.2)' }}>
            <Typography variant="h4" fontWeight="bold" color="success.main">{stats.approved}</Typography>
            <Typography variant="body2" color="text.secondary">Approved Days</Typography>
          </Box>
          <Box sx={{ textAlign: 'center', p: 2.5, minWidth: 110, bgcolor: 'rgba(255,152,0,0.08)', borderRadius: 3, border: '1px solid rgba(255,152,0,0.2)' }}>
            <Typography variant="h4" fontWeight="bold" color="warning.main">{stats.pending}</Typography>
            <Typography variant="body2" color="text.secondary">Pending Days</Typography>
          </Box>
          <Box sx={{ textAlign: 'center', p: 2.5, minWidth: 110, bgcolor: 'rgba(244,67,54,0.08)', borderRadius: 3, border: '1px solid rgba(244,67,54,0.2)' }}>
            <Typography variant="h4" fontWeight="bold" color="error.main">{stats.rejected}</Typography>
            <Typography variant="body2" color="text.secondary">Rejected Days</Typography>
          </Box>
        </Box>
      </Box>

      {/* Leave categories list — centered */}
      {monthRequests.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center', bgcolor: '#fafafa', borderRadius: 3, border: '1px dashed #ccc' }}>
          <Typography variant="body2" color="text.secondary">No leave activity this month</Typography>
        </Box>
      ) : (
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
                      role={onNavigateToRequest ? 'button' : undefined}
                      tabIndex={onNavigateToRequest ? 0 : -1}
                      onClick={onNavigateToRequest ? () => onNavigateToRequest(r.id) : undefined}
                      onKeyDown={onNavigateToRequest ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onNavigateToRequest(r.id);
                        }
                      } : undefined}
                      sx={{
                        p: 1.5, borderRadius: 2,
                        borderLeft: `4px solid ${getLeaveStatusColor(r.status)}`,
                        boxShadow: 1,
                        cursor: onNavigateToRequest ? 'pointer' : 'default',
                        '&:hover': onNavigateToRequest ? { boxShadow: 3, transform: 'translateX(2px)', transition: 'all 0.2s' } : {},
                      }}
                    >
                      <Typography variant="caption" fontWeight="bold" display="block">
                        {formatDisplayDateRange(r.start_date, r.end_date)}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">{r.total_days} day{r.total_days > 1 ? 's' : ''}</Typography>
                        <Chip
                          label={r.is_half_day ? `${getLeaveStatusLabel(r.status)} · ${HALF_DAY_PERIOD_LABELS[r.half_day_period] || 'Half Day'}` : getLeaveStatusLabel(r.status)}
                          color={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'error' : 'warning'}
                          size="small"
                        />
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

// ── Leave Balance Tab ───────────────────────────────────────────────────────────
function LeaveBalanceTab({ onRefresh, onSwitchTab, onRequestCreated }) {
  const { user } = useAuth();
  const [balances, setBalances] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [weekOffStatus, setWeekOffStatus] = useState(null);
  const [showSwapDialog, setShowSwapDialog] = useState(false);
  const [swapDate, setSwapDate] = useState('');
  const [submittingSwap, setSubmittingSwap] = useState(false);
  const [swapConflict, setSwapConflict] = useState(null);
  const [loading, setLoading] = useState(true);

  const [requests, setRequests] = useState([]);

  useEffect(() => {
    const year = new Date().getFullYear();
    setLoading(true);

    // Fetch all data
    Promise.all([
      axios.get(`/api/leave/balances/${user.id}?year=${year}`).catch(() => ({ data: [] })),
      axios.get('/api/leave/types').catch(() => ({ data: [] })),
      axios.get('/api/leave/requests').catch(() => ({ data: [] })),
    ]).then(([balancesRes, typesRes, requestsRes]) => {
      setBalances(Array.isArray(balancesRes?.data) ? balancesRes.data : []);
      setLeaveTypes(Array.isArray(typesRes?.data) ? typesRes.data : []);
      setRequests(Array.isArray(requestsRes?.data) ? requestsRes.data : []);
      // Fetch week-off status separately with timeout
      return axios.get('/api/leave/week-off/status', { timeout: 5000 }).catch(() => null);
    }).then(weekOffRes => {
      setWeekOffStatus(weekOffRes?.data || null);
    }).catch(err => {
      console.error('Failed to load leave data:', err);
    }).finally(() => setLoading(false));
  }, [user.id]);

  const checkLeaveConflict = (dateStr) => {
    // Check if selected date has any approved or pending leave
    return requests.find(r =>
      r.leave_type_name !== 'Week Off' &&
      ['APPROVED', 'PENDING', 'HOD_APPROVED'].includes(r.status) &&
      r.start_date <= dateStr && r.end_date >= dateStr
    );
  };

  const handleDateSelect = (dateStr) => {
    setSwapDate(dateStr);
    const conflict = checkLeaveConflict(dateStr);
    setSwapConflict(conflict);
  };

  const handleWeekOffSwap = async () => {
    if (!swapDate) return;

    // Check for conflict
    const conflict = checkLeaveConflict(swapDate);
    if (conflict) {
      setSwapConflict(conflict);
      return;
    }

    setSubmittingSwap(true);
    try {
      const response = await axios.post('/api/leave/week-off/swap', {
        swap_date: swapDate
      });
      const createdRequest = response?.data;
      const createdRequestId = response?.data?.id || response?.data?.request_id;
      const createdRequestDate = response?.data?.start_date || response?.data?.swap_date || swapDate;

      if (!createdRequestId) {
        throw new Error('Week-off swap request response is missing the request id.');
      }

      setShowSwapDialog(false);
      setSwapConflict(null);
      if (onRequestCreated && createdRequest) {
        onRequestCreated({
          ...createdRequest,
          leave_type_name: createdRequest.leave_type_name || 'Week Off',
        });
      }
      if (onRefresh) {
        await onRefresh();
      }
      setSwapDate('');
      if (onSwitchTab) {
        onSwitchTab({
          date: createdRequestDate,
          requestId: createdRequestId,
        });
      }
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Failed to submit swap request');
    } finally {
      setSubmittingSwap(false);
    }
  };

  const cancelConflictLeave = async () => {
    if (!swapConflict) return;
    try {
      await axios.post(`/api/leave/cancel/${swapConflict.id}?comment=${encodeURIComponent('Cancelled for week-off swap')}`);
      setSwapConflict(null);
      const updatedRequests = requests.map((request) => (
        request.id === swapConflict.id
          ? { ...request, status: 'CANCELLED', cancel_comment: 'Cancelled for week-off swap' }
          : request
      ));
      setRequests(updatedRequests);
      // Re-check conflict after cancellation
      alert('Leave request cancelled. You can now select this date for week-off swap.');
    } catch (err) {
      alert('Failed to cancel leave: ' + (err.response?.data?.detail || 'Unknown error'));
    }
  };

  if (loading) return <CircularProgress />;

  const swapWindow = weekOffStatus ? {
    swapStart: weekOffStatus.applicable_week_start,
    swapEnd: weekOffStatus.applicable_week_end,
    nextDefaultDate: weekOffStatus.default_week_off_date,
    nextDefaultDay: weekOffStatus.default_week_off_day,
  } : null;
  const isSwapApproved = Boolean(weekOffStatus?.approved_this_week);
  const isSwapPending = Boolean(weekOffStatus?.pending_this_week);

  const woStatusLabel = isSwapApproved ? 'Swap Consumed'
    : isSwapPending ? 'Swap Applied'
      : weekOffStatus?.available ? 'Available'
        : 'Available';

  return (
    <Box>
      <Alert severity="info" icon={<InfoIcon />} sx={{ mb: 3, borderRadius: 2 }}>
        Leave year cycle: <strong>January 1st to December 31st, {new Date().getFullYear()}</strong>
      </Alert>

      {/* Week Off Status Widget */}
      <Paper sx={{
        mb: 3, p: 2.5, borderRadius: 3,
        background: 'linear-gradient(135deg, #8d6e63 0%, #a1887f 100%)',
        color: 'white', boxShadow: '0 4px 20px rgba(40,53,147,0.3)',
      }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="subtitle2" sx={{ opacity: 0.8, mb: 0.25 }}>Week Off Swap</Typography>
            {isSwapApproved ? (
              <>
                <Typography variant="h6" fontWeight="bold">
                  Swap consumed
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.85 }}>
                  Updated week off: {formatDisplayDate(weekOffStatus?.current_request?.date ?? swapWindow?.nextDefaultDate)}
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h6" fontWeight="bold">
                  This week&apos;s off: <span style={{ opacity: 0.9 }}>{user?.default_week_off || 'Sunday'}</span>
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.75 }}>
                  Swap window: {swapWindow?.swapStart ?? '--'} → {swapWindow?.swapEnd ?? '--'}
                  <br />Next off day: {swapWindow?.nextDefaultDate ?? '--'} ({swapWindow?.nextDefaultDay ?? '--'})
                </Typography>
              </>
            )}
          </Box>
          <Box textAlign="center">
            <Chip
              label={woStatusLabel}
              sx={{
                bgcolor: 'rgba(255,255,255,0.2)',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '0.85rem',
                px: 1,
                border: '1px solid rgba(255,255,255,0.35)',
              }}
            />
            {weekOffStatus?.current_request && !isSwapApproved && (
              <Typography variant="caption" display="block" sx={{ mt: 0.5, opacity: 0.8 }}>
                Swap date: {formatDisplayDate(weekOffStatus.current_request.date)}
              </Typography>
            )}
          </Box>
        </Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={2}>
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>Status</Typography>
            <Typography fontWeight="bold">
              {isSwapApproved ? 'Updated week off is active'
                : isSwapPending ? 'Swap applied for this week'
                  : 'Swap available for this week'}
            </Typography>
          </Box>
          {!isSwapApproved && !isSwapPending && (
            <Button
              variant="contained"
              size="medium"
              onClick={() => setShowSwapDialog(true)}
              sx={{ bgcolor: 'white', color: '#8d6e63', '&:hover': { bgcolor: '#efebe9' }, fontWeight: 'bold', px: 3 }}
            >
              Apply Week Off Swap
            </Button>
          )}
        </Box>
      </Paper>

      {/* Week Off Swap Dialog */}
      <Dialog open={showSwapDialog} onClose={() => { setShowSwapDialog(false); setSwapDate(''); setSwapConflict(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Typography variant="h6" fontWeight="bold">Apply Week Off Swap</Typography>
          <Typography variant="body2" color="text.secondary">
            Swap your {user?.default_week_off || 'Sunday'} off with another day
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Select a day from the calendar to swap with your default week-off.
          </Alert>

          {/* Mini Calendar */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>
              Swap Window: {swapWindow?.swapStart ?? '--'} → {swapWindow?.swapEnd ?? '--'}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {(() => {
                const days = [];
                if (!swapWindow?.swapStart || !swapWindow?.swapEnd) {
                  return days;
                }
                const start = new Date(`${swapWindow.swapStart}T00:00:00`);
                const end = new Date(`${swapWindow.swapEnd}T00:00:00`);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                  const dateStr = formatLocalDate(d);
                  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                  const dayNum = d.getDate();
                  const isSelected = swapDate === dateStr;
                  const hasLeave = checkLeaveConflict(dateStr);

                  days.push(
                    <Button
                      key={dateStr}
                      variant={isSelected ? "contained" : "outlined"}
                      size="small"
                      onClick={() => handleDateSelect(dateStr)}
                      sx={{
                        minWidth: 65,
                        flexDirection: 'column',
                        py: 1,
                        borderColor: hasLeave ? '#f44336' : isSelected ? '#8d6e63' : '#e0e0e0',
                        bgcolor: isSelected ? '#8d6e63' : hasLeave ? 'rgba(244,67,54,0.08)' : 'white',
                        color: isSelected ? 'white' : hasLeave ? '#f44336' : 'inherit',
                        '&:hover': {
                          borderColor: '#8d6e63',
                          bgcolor: isSelected ? '#5d4037' : '#efebe9'
                        }
                      }}
                    >
                      <Typography variant="caption" sx={{ opacity: 0.7, fontSize: '0.65rem' }}>{dayName}</Typography>
                      <Typography variant="body2" fontWeight="bold">{dayNum}</Typography>
                      {hasLeave && <Typography variant="caption" sx={{ fontSize: '0.55rem' }}>Leave</Typography>}
                    </Button>
                  );
                }
                return days;
              })()}
            </Box>
          </Paper>

          {/* Selected Date Info */}
          {swapDate && (
            <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 2 }}>
              <Typography variant="body2" fontWeight="bold">
                Selected: {formatDisplayDate(swapDate)}
              </Typography>

              {swapConflict && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  <Typography variant="body2">
                    You have <strong>{swapConflict.leave_type_name}</strong> ({swapConflict.status}) on this date.
                  </Typography>
                  <Button size="small" color="error" onClick={cancelConflictLeave} sx={{ mt: 1 }}>
                    Cancel This Leave
                  </Button>
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setShowSwapDialog(false); setSwapDate(''); setSwapConflict(null); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleWeekOffSwap}
            disabled={!swapDate || submittingSwap || swapConflict || !swapWindow?.swapStart}
          >
            {submittingSwap ? 'Submitting...' : 'Submit Swap Request'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Regular leave balances (Week Off excluded) */}
      {balances.filter(b => {
        const lt = leaveTypes.find(l => l.id === b.leave_type_id);
        return !lt || lt.name !== 'Week Off';
      }).length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 3 }}>
          <Typography color="text.secondary">No leave balances found.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {balances.filter(b => {
            const lt = leaveTypes.find(l => l.id === b.leave_type_id);
            return !lt || lt.name !== 'Week Off';
          }).map(b => {
            const lt = leaveTypes.find(l => l.id === b.leave_type_id);
            const pct = b.total_allocated > 0 ? Math.round((b.used / b.total_allocated) * 100) : 0;
            const available = b.total_allocated - b.used - b.pending;
            return (
              <Grid item xs={12} sm={6} md={4} key={b.id}>
                <Card sx={{ borderRadius: 4, transition: '0.3s', '&:hover': { boxShadow: 6, transform: 'translateY(-4px)' } }}>
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>{lt?.name || 'Leave Category'}</Typography>
                    <Box sx={{ mt: 3, mb: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, gap: 2 }}>
                        <Typography variant="body2" color="text.secondary">Leave Consumption</Typography>
                        <Typography variant="body2" fontWeight="bold">{b.used} / {b.total_allocated} Days</Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{ height: 10, borderRadius: 5, bgcolor: '#eee', '& .MuiLinearProgress-bar': { borderRadius: 5 } }}
                        color={pct > 80 ? 'error' : pct > 50 ? 'warning' : 'success'}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
                      <Chip
                        label={`${available} Available`}
                        color={available > 0 ? 'success' : 'error'}
                        sx={{ fontWeight: 'bold' }}
                      />
                      {b.pending > 0 && (
                        <Chip label={`${b.pending} Pending Approval`} color="primary" variant="outlined" />
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}
// ── Main Leaves Page ───────────────────────────────────────────────────────────
export default function Leaves() {
  const { user } = useAuth();
  const [tab, setTab] = useState(0);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appliedDate, setAppliedDate] = useState(null);
  const [calendarHighlightId, setCalendarHighlightId] = useState(null);
  const [dialogRequest, setDialogRequest] = useState(null);

  const handleSwitchToRequests = (payload) => {
    if (typeof payload === 'string') {
      setAppliedDate(payload);
      setCalendarHighlightId(null);
    } else if (payload && typeof payload === 'object') {
      setAppliedDate(payload.date || null);
      setCalendarHighlightId(payload.requestId || null);
    } else {
      setAppliedDate(null);
      setCalendarHighlightId(null);
    }
    setTab(2);
  };

  const handleRequestCreated = (request) => {
    if (!request?.id) return;
    setRequests((current) => {
      const remaining = current.filter((item) => item.id !== request.id);
      return [request, ...remaining];
    });
  };

  const fetchData = useCallback(async () => {
    try {
      const [types, reqs] = await Promise.all([
        axios.get('/api/leave/types'),
        axios.get('/api/leave/requests')
      ]);
      setLeaveTypes(types.data);
      // For Employees and HODs (when acting as a employee): only own requests
      const myReqs = reqs.data.filter(r => r.employee_id === user.id);
      setRequests(myReqs);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [user.id, user.role]);

  // Navigate from calendar / Leave Details → switch to My Requests tab and
  // highlight the clicked request at the top. Calendar views are a
  // navigation aid; the actual full-detail popup is opened from the My
  // Requests list.
  const handleNavigateToRequest = (requestId) => {
    setCalendarHighlightId(requestId);
    setTab(2);
  };

  // Open the full-detail popup from a My Requests row click.
  const handleOpenRequest = (requestId) => {
    const found = requests.find((r) => r.id === requestId);
    if (found) {
      setDialogRequest(found);
    } else {
      // Fallback: if the request isn't in the local list, still open the dialog
      // and let it show a minimal payload — useful when called from the calendar
      // before the requests list has been re-fetched.
      setDialogRequest({ id: requestId });
    }
  };

  const handleDialogClose = () => {
    setDialogRequest(null);
    // Refresh requests so the underlying tab/list reflects any actions taken
    // in the dialog (approve/reject/notify/cancel).
    fetchData();
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Box p={4}><CircularProgress /></Box>;

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={1}>
        <HolidayVillageIcon sx={{ fontSize: 32, color: '#d66a18' }} />
        <Typography variant="h5" fontWeight="bold">Leave Planner</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Your central place for planning time off, tracking history, and managing balances.
      </Typography>

      <Paper sx={{ borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 20px 0 rgba(0,0,0,0.05)' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: '#fafafa',
            '& .MuiTab-root': { py: 2, fontWeight: 'bold', textTransform: 'none', fontSize: '1rem' }
          }}
        >
          <Tab label="Request Leave" />
          <Tab label="Leave Balance" />
          <Tab label="My Requests" />
          <Tab label="Calendar History" />
        </Tabs>
        <Box sx={{ p: { xs: 2, md: 4 }, minHeight: 400 }}>
          <TabPanel value={tab} index={0}>
            <ApplyLeaveTab leaveTypes={leaveTypes} requests={requests} onRefresh={fetchData} onSwitchTab={handleSwitchToRequests} onRequestCreated={handleRequestCreated} />
          </TabPanel>
          <TabPanel value={tab} index={1}>
            <LeaveBalanceTab onRefresh={fetchData} onSwitchTab={handleSwitchToRequests} onRequestCreated={handleRequestCreated} />
          </TabPanel>
          <TabPanel value={tab} index={2}>
            <LeaveRequestsTab
              requests={requests}
              onRefresh={fetchData}
              appliedDate={appliedDate}
              onClearAppliedDate={() => setAppliedDate(null)}
              calendarHighlightId={calendarHighlightId}
              onClearCalendarHighlight={() => setCalendarHighlightId(null)}
              onOpenRequest={handleOpenRequest}
            />
          </TabPanel>
          <TabPanel value={tab} index={3}>
            <LeaveCalendarTab
              requests={requests}
              onNavigateToRequest={handleNavigateToRequest}
            />
          </TabPanel>
        </Box>
      </Paper>

      <LeaveRequestDetailDialog
        open={!!dialogRequest}
        request={dialogRequest}
        viewer="EMPLOYEE"
        employees={[user].filter(Boolean)}
        defaultWeekOff={user?.default_week_off}
        onClose={handleDialogClose}
        onActionComplete={() => fetchData()}
      />
    </Box>
  );
}
