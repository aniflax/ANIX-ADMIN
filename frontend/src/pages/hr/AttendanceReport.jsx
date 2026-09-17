import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Button, Grid, Card, CardContent,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, CircularProgress, Alert, MenuItem, Select, FormControl, InputLabel
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import WarningIcon from '@mui/icons-material/Warning';
import BlockIcon from '@mui/icons-material/Block';
import LocationOffIcon from '@mui/icons-material/LocationOff';
import PeopleIcon from '@mui/icons-material/People';
import HistoryIcon from '@mui/icons-material/History';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import { useLocation, Link } from 'react-router-dom';
import api from '../../api/axios';

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const REPORT_DATA_VERSION = 2;
const REPORT_CACHE_KEY = 'hrms.attendanceReport.cache.v1';
const REPORT_ACCESS_COUNTS_KEY = 'hrms.attendanceReport.accessCounts.v1';

const getReportKey = (month, year) => `${year}-${String(month).padStart(2, '0')}`;

const buildSummaryFromRows = (rows, month, year) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const missedAttendance = safeRows.reduce((total, row) => total + Number(row.absent_days || 0), 0);
  const geoMismatch = safeRows.reduce((total, row) => total + Number(row.geo_mismatch || 0), 0);
  const uniqueEmployees = safeRows.filter(
    (row) => Number(row.absent_days || 0) > 0 || Number(row.geo_mismatch || 0) > 0
  ).length;
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return {
    total_records: missedAttendance + geoMismatch,
    missed_attendance: missedAttendance,
    geo_mismatch: geoMismatch,
    unique_employees: uniqueEmployees,
    period: `${startDate.toLocaleDateString('en-GB')} to ${endDate.toLocaleDateString('en-GB')}`,
  };
};

const readLocalStorageJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeLocalStorageJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep runtime behavior functional.
  }
};

export default function AttendanceReport() {
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState([]);
  const [summary, setSummary] = useState(null);

  // Default to last month
  const today = new Date();
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const defaultMonth = lastMonthDate.getMonth() + 1;
  const defaultYear = lastMonthDate.getFullYear();

  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  
  // Track displayed date separately from selected date
  const [displayDate, setDisplayDate] = useState({ month: defaultMonth, year: defaultYear });

  const updateReportCache = ({ month: targetMonth, year: targetYear, aggregatedData, summaryData, trackAccess = true }) => {
    const cache = readLocalStorageJson(REPORT_CACHE_KEY, { reports: {}, latestKey: null, preferredKey: null });
    const accessCounts = readLocalStorageJson(REPORT_ACCESS_COUNTS_KEY, {});
    const reports = cache.reports || {};
    const key = getReportKey(targetMonth, targetYear);
    const latestKey = getReportKey(defaultMonth, defaultYear);

    reports[key] = {
      month: targetMonth,
      year: targetYear,
      reportData: aggregatedData,
      summary: summaryData,
      version: REPORT_DATA_VERSION,
      cachedAt: new Date().toISOString(),
    };

    if (trackAccess) {
      accessCounts[key] = (accessCounts[key] || 0) + 1;
    }

    const latestAccessCount = accessCounts[latestKey] || 0;
    let mostAccessedKey = latestKey;
    let mostAccessedCount = latestAccessCount;

    Object.entries(accessCounts).forEach(([reportKey, count]) => {
      if (reports[reportKey] && count > mostAccessedCount) {
        mostAccessedKey = reportKey;
        mostAccessedCount = count;
      }
    });

    cache.reports = reports;
    cache.latestKey = latestKey;
    cache.preferredKey = mostAccessedKey;

    writeLocalStorageJson(REPORT_CACHE_KEY, cache);
    writeLocalStorageJson(REPORT_ACCESS_COUNTS_KEY, accessCounts);
  };

  const isMonthDisabled = (m, y) => {
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-indexed
    if (y > currentYear) return true;
    if (y === currentYear && m >= currentMonth) return true;
    return false;
  };

  const fetchReport = async (selectedDate = { month, year }, options = { trackAccess: true }) => {
    const { month: targetMonth, year: targetYear } = selectedDate;
    const { trackAccess } = options;
    setLoading(true);
    setError('');
    try {
      const payload = { month: targetMonth, year: targetYear };
      const aggregatedRes = await api.post('/api/attendance/reports/non-compliant/aggregated', payload);
      const summaryData = buildSummaryFromRows(aggregatedRes.data, targetMonth, targetYear);

      setMonth(targetMonth);
      setYear(targetYear);
      setReportData(aggregatedRes.data);
      setSummary(summaryData);
      setDisplayDate({ month: targetMonth, year: targetYear }); // Update displayed date only when report is fetched
      updateReportCache({
        month: targetMonth,
        year: targetYear,
        aggregatedData: aggregatedRes.data,
        summaryData,
        trackAccess
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const restoredState = location.state?.restoreAttendanceReport;
    if (restoredState?.displayDate && Array.isArray(restoredState?.reportData)) {
      setMonth(restoredState.selectedMonth ?? restoredState.displayDate.month);
      setYear(restoredState.selectedYear ?? restoredState.displayDate.year);
      setDisplayDate(restoredState.displayDate);
      setReportData(restoredState.reportData);
      setSummary(restoredState.summary ?? buildSummaryFromRows(
        restoredState.reportData,
        restoredState.displayDate.month,
        restoredState.displayDate.year,
      ));
      return;
    }

    const cache = readLocalStorageJson(REPORT_CACHE_KEY, { reports: {}, latestKey: null, preferredKey: null });
    const accessCounts = readLocalStorageJson(REPORT_ACCESS_COUNTS_KEY, {});
    const latestKey = getReportKey(defaultMonth, defaultYear);
    const latestAccessCount = accessCounts[latestKey] || 0;
    const preferredKey =
      cache.preferredKey &&
      cache.preferredKey !== latestKey &&
      (accessCounts[cache.preferredKey] || 0) > latestAccessCount
        ? cache.preferredKey
        : latestKey;

    const cachedReport = cache.reports?.[preferredKey] || cache.reports?.[latestKey];

    if (cachedReport) {
      setMonth(cachedReport.month);
      setYear(cachedReport.year);
      setDisplayDate({ month: cachedReport.month, year: cachedReport.year });
      setReportData(Array.isArray(cachedReport.reportData) ? cachedReport.reportData : []);
      setSummary(cachedReport.summary ?? buildSummaryFromRows(
        cachedReport.reportData,
        cachedReport.month,
        cachedReport.year,
      ));
      return;
    }

    fetchReport({ month: defaultMonth, year: defaultYear }, { trackAccess: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportToExcel = async () => {
    try {
      const response = await api.post('/api/attendance/reports/non-compliant/export', { month: displayDate.month, year: displayDate.year }, {
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `attendance_non_compliance_${MONTHS[displayDate.month-1]}_${displayDate.year}.xlsx`;
      link.click();
    } catch {
      setError('Failed to export Excel');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight="bold">
            Attendance Report - {MONTHS[displayDate.month-1]} {displayDate.year}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Aggregate attendance summary and exception records
          </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Month/Year Selection */}
      <Paper sx={{ p: 3, mb: 3, borderRadius: 4 }}>
        <Grid container spacing={3} alignItems="center">
          <Grid item>
            <FormControl sx={{ minWidth: 160 }}>
              <InputLabel>Month</InputLabel>
              <Select
                value={month}
                label="Month"
                onChange={(e) => setMonth(e.target.value)}
              >
                {MONTHS.map((m, idx) => (
                  <MenuItem 
                    key={idx} 
                    value={idx + 1}
                    disabled={isMonthDisabled(idx + 1, year)}
                  >
                    {m}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item>
            <FormControl sx={{ minWidth: 120 }}>
              <InputLabel>Year</InputLabel>
              <Select
                value={year}
                label="Year"
                onChange={(e) => setYear(e.target.value)}
              >
                {[today.getFullYear() - 1, today.getFullYear()].map((y) => (
                  <MenuItem key={y} value={y}>{y}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                onClick={() => fetchReport()}
                disabled={loading}
                sx={{ borderRadius: 2, height: 56, minWidth: 150 }}
              >
                {loading ? <CircularProgress size={20} /> : 'Generate Report'}
              </Button>
              {reportData.length > 0 && (
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={exportToExcel}
                  sx={{ borderRadius: 2, height: 56 }}
                >
                  Export Excel
                </Button>
              )}
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Attendance summary cards */}
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ borderRadius: 3, border: '1px solid #eee' }}>
              <CardContent sx={{ p: 2, textAlign: 'center' }}>
                <WarningIcon sx={{ fontSize: 32, color: 'warning.main', mb: 1 }} />
                <Typography variant="h5" fontWeight="bold">{summary.total_records}</Typography>
                <Typography variant="caption" color="text.secondary" display="block">Total Attendance Exceptions</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ borderRadius: 3, border: '1px solid #eee' }}>
              <CardContent sx={{ p: 2, textAlign: 'center' }}>
                <BlockIcon sx={{ fontSize: 32, color: 'error.main', mb: 1 }} />
                <Typography variant="h5" fontWeight="bold">{summary.missed_attendance}</Typography>
                <Typography variant="caption" color="text.secondary" display="block">Missed Attendance Incidents</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ borderRadius: 3, border: '1px solid #eee' }}>
              <CardContent sx={{ p: 2, textAlign: 'center' }}>
                <LocationOffIcon sx={{ fontSize: 32, color: 'warning.dark', mb: 1 }} />
                <Typography variant="h5" fontWeight="bold">{summary.geo_mismatch}</Typography>
                <Typography variant="caption" color="text.secondary" display="block">Geo Mismatch Incidents</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card sx={{ borderRadius: 3, border: '1px solid #eee' }}>
              <CardContent sx={{ p: 2, textAlign: 'center' }}>
                <PeopleIcon sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
                <Typography variant="h5" fontWeight="bold">{summary.unique_employees}</Typography>
                <Typography variant="caption" color="text.secondary" display="block">Affected Employees Count</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Attendance report table */}
      {reportData.length > 0 && (
        <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold' }}>Employee ID</TableCell>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold' }}>Name</TableCell>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold', textAlign: 'center' }}>Present</TableCell>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold', textAlign: 'center' }}>Leave</TableCell>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold', textAlign: 'center' }}>Absent</TableCell>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold', textAlign: 'center' }}>Geo Mismatch</TableCell>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold', textAlign: 'center' }}>Week off</TableCell>
                  <TableCell sx={{ bgcolor: '#f47c20', color: 'white', fontWeight: 'bold', textAlign: 'center' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportData.map((row) => (
                  <TableRow key={row.employee_db_id} hover>
                    <TableCell fontWeight={600}>{row.employee_id}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Chip label={row.present} size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 700 }} />
                    </TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Chip label={row.leave} size="small" sx={{ bgcolor: '#fff3e0', color: '#f47c20', fontWeight: 700 }} />
                    </TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Chip label={row.absent_days} size="small" sx={{ bgcolor: '#ffebee', color: '#c62828', fontWeight: 700 }} />
                    </TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Chip label={row.geo_mismatch || 0} size="small" sx={{ bgcolor: '#fff8e1', color: '#f57f17', fontWeight: 700 }} />
                    </TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Chip label={row.week_off} size="small" sx={{ bgcolor: '#efebe9', color: '#6d4c41', fontWeight: 700 }} />
                    </TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Box display="flex" justifyContent="center" gap={1}>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<HistoryIcon />}
                          component={Link}
                          to={`/directory/${row.employee_db_id}/employee-records`}
                          state={{
                            month: displayDate.month,
                            year: displayDate.year,
                            from: location.pathname,
                            tab: 'leave',
                            attendanceReportState: {
                              selectedMonth: month,
                              selectedYear: year,
                              displayDate,
                              reportData,
                              summary,
                              version: REPORT_DATA_VERSION
                            }
                          }}
                          sx={{ textTransform: 'none' }}
                        >
                          Leave History
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<EventAvailableIcon />}
                          color="secondary"
                          component={Link}
                          to={`/directory/${row.employee_db_id}/employee-records`}
                          state={{
                            month: displayDate.month,
                            year: displayDate.year,
                            from: location.pathname,
                            tab: 'attendance',
                            attendanceReportState: {
                              selectedMonth: month,
                              selectedYear: year,
                              displayDate,
                              reportData,
                              summary,
                              version: REPORT_DATA_VERSION
                            }
                          }}
                          sx={{ textTransform: 'none' }}
                        >
                          Attendance Calendar
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {reportData.length === 0 && !loading && summary === null && (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 4 }}>
          <WarningIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">Select a month and generate the attendance report</Typography>
        </Paper>
      )}
    </Box>
  );
}
