import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Tabs, Tab, Grid, Card, CardContent, Divider, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  MenuItem, IconButton, Alert, Autocomplete
} from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import api from '../../api/axios';
import { connectAttendanceStream } from '../../utils/attendanceSync';
import { formatDisplayDate } from '../../utils/dateFormat';

export default function AttendanceReports() {
  const [tabIndex, setTabIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [allLogs, setAllLogs] = useState([]);
  const [mismatchLogs, setMismatchLogs] = useState([]);
  const [employeeMap, setEmployeeMap] = useState({});
  const [employees, setEmployees] = useState([]);

  // Manual Update Dialog State
  const [openDialog, setOpenDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    employee_id: '',
    date: new Date().toISOString().split('T')[0],
    check_in_time: '',
    check_out_time: '',
    status: 'PRESENT'
  });

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [allLogsRes, mismatchRes, employeesRes] = await Promise.all([
        api.get('/api/attendance/reports/all'),
        api.get('/api/attendance/reports/geo-mismatch'),
        api.get('/api/employees/')
      ]);
      
      setAllLogs(allLogsRes.data);
      setMismatchLogs(mismatchRes.data);
      setEmployees(employeesRes.data);
      
      const map = {};
      employeesRes.data.forEach(s => {
        map[s.id] = `${s.first_name} ${s.last_name} (${s.employee_id})`;
      });
      setEmployeeMap(map);
    } catch (err) {
      console.error("Failed to fetch reports", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    const handleAttendanceSync = () => {
      fetchAllData();
    };

    const disconnectAttendanceStream = connectAttendanceStream(handleAttendanceSync);

    return () => {
      disconnectAttendanceStream();
    };
  }, []);

  const handleOpenDialog = (log = null) => {
    if (log) {
      setFormData({
        employee_id: log.employee_id,
        date: log.date,
        check_in_time: log.check_in_time ? new Date(log.check_in_time).toISOString().slice(0, 16) : '',
        check_out_time: log.check_out_time ? new Date(log.check_out_time).toISOString().slice(0, 16) : '',
        status: log.status
      });
    } else {
      setFormData({
        employee_id: '',
        date: new Date().toISOString().split('T')[0],
        check_in_time: '',
        check_out_time: '',
        status: 'PRESENT'
      });
    }
    setError('');
    setOpenDialog(true);
  };

  const handleManualUpdate = async () => {
    if (!formData.employee_id || !formData.date) {
      setError('Employee and Date are required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        employee_id: formData.employee_id,
        date: formData.date,
        status: formData.status,
        check_in_time: formData.check_in_time || null,
        check_out_time: formData.check_out_time || null
      };
      await api.post('/api/attendance/manual-update', payload);
      setOpenDialog(false);
      fetchAllData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update attendance');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && allLogs.length === 0) return <CircularProgress />;

  const displayedLogs = tabIndex === 0 ? allLogs : mismatchLogs;

  const renderTable = (logs) => (
    <TableContainer component={Paper} sx={{ mt: 2 }}>
      <Table sx={{ minWidth: { xs: 300, sm: 650 } }}>
        <TableHead sx={{ bgcolor: 'background.default' }}>
          <TableRow>
            <TableCell><b>Employee Name</b></TableCell>
            <TableCell><b>Date</b></TableCell>
            <TableCell><b>In Time</b></TableCell>
            <TableCell><b>Out Time</b></TableCell>
            <TableCell><b>Status</b></TableCell>
            <TableCell><b>Compliance</b></TableCell>
            <TableCell><b>Actions</b></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id}>
              <TableCell>{employeeMap[log.employee_id] || 'Unknown User'}</TableCell>
              <TableCell>{formatDisplayDate(log.date)}</TableCell>
              <TableCell>{log.check_in_time ? new Date(log.check_in_time).toLocaleTimeString() : 'N/A'}</TableCell>
              <TableCell>{log.check_out_time ? new Date(log.check_out_time).toLocaleTimeString() : 'N/A'}</TableCell>
              <TableCell>
                <Chip 
                  label={log.status} 
                  size="small" 
                  color={log.is_manual ? "secondary" : "default"}
                  variant={log.is_manual ? "filled" : "outlined"}
                />
              </TableCell>
              <TableCell>
                {log.geo_flagged ? (
                   <Chip icon={<WarningIcon />} label="> 50m MISMATCH" color="error" size="small" variant="outlined" />
                ) : (
                   <Chip icon={<CheckCircleOutlineIcon />} label="COMPLIANT" color="success" size="small" variant="outlined" />
                )}
                {log.is_manual && (
                  <Chip label="MANUAL" size="small" color="info" sx={{ ml: 1 }} />
                )}
              </TableCell>
              <TableCell>
                <IconButton size="small" onClick={() => handleOpenDialog(log)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
          {logs.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} align="center">
                 <Typography py={3} color="text.secondary">
                    No attendance records found.
                 </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h4" fontWeight="bold">
          Attendance Compliance
        </Typography>
        <Button 
          variant="contained" 
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Manual Fix / Unlock
        </Button>
      </Box>
      <Typography variant="body1" color="text.secondary" mb={4}>
        Review and manually adjust attendance logs. "Manual" updates bypass Geofence validation.
      </Typography>

      {/* Analytics Summary Banner */}
      <Grid container spacing={3} mb={4}>
         <Grid item xs={12} sm={6}>
            <Card variant="outlined" sx={{ bgcolor: 'success.main', color: 'success.contrastText' }}>
               <CardContent>
                  <Typography variant="h6">Total Weekly Logs</Typography>
                  <Typography variant="h3" fontWeight="bold">{allLogs.length}</Typography>
               </CardContent>
            </Card>
         </Grid>
         <Grid item xs={12} sm={6}>
            <Card variant="outlined" sx={{ bgcolor: 'error.main', color: 'error.contrastText' }}>
               <CardContent>
                  <Typography variant="h6">Non-Compliant Logs</Typography>
                  <Typography variant="h3" fontWeight="bold">{mismatchLogs.length}</Typography>
               </CardContent>
            </Card>
         </Grid>
      </Grid>
      
      <Divider sx={{ mb: 2 }} />

      <Paper sx={{ width: '100%' }}>
        <Tabs 
          value={tabIndex} 
          onChange={(e, v) => setTabIndex(v)}
          variant="scrollable"
          scrollButtons="auto"
          textColor="primary"
          indicatorColor="primary"
        >
          <Tab label={`Attendance Logs (${allLogs.length})`} />
          <Tab label={`Attendance Non-compliance (${mismatchLogs.length})`} sx={{ color: mismatchLogs.length > 0 ? 'error.main' : 'inherit' }} />
        </Tabs>
      </Paper>

      {/* Responsive View Switcher */}
      {renderTable(displayedLogs)}

      {/* Manual Update Dialog */}
      <Dialog open={openDialog} onClose={() => !submitting && setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{formData.employee_id ? 'Edit Attendance' : 'Manual Attendance Entry'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} sm ={4}>
              <Autocomplete
                sx = {{ width : 250}}
                size="medium"
                options={employees}
                getOptionLabel={(s) => `${s.first_name} ${s.last_name} (${s.employee_id})`}
                value={employees.find(s => s.id === formData.employee_id) || null}
                onChange={(_, v) => setFormData({ ...formData, employee_id: v ? v.id : '' })}
                disabled={!!formData.id || submitting}
                renderInput={(p) => <TextField {...p} label="Select Employee" required />}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={submitting}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                disabled={submitting}
              >
                <MenuItem value="PRESENT">PRESENT</MenuItem>
                <MenuItem value="ABSENT">ABSENT</MenuItem>
                <MenuItem value="HALF_DAY">HALF_DAY</MenuItem>
                <MenuItem value="ON_LEAVE">ON_LEAVE</MenuItem>
                <MenuItem value="HOLIDAY">HOLIDAY</MenuItem>
                <MenuItem value="WEEK_OFF">WEEK_OFF</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                sx = {{ width : 200}}
                label="Check-In Time"
                type="datetime-local"
                value={formData.check_in_time}
                onChange={(e) => setFormData({ ...formData, check_in_time: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={submitting}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                sx = {{ width : 200}}
                label="Check-Out Time"
                type="datetime-local"
                value={formData.check_out_time}
                onChange={(e) => setFormData({ ...formData, check_out_time: e.target.value })}
                InputLabelProps={{ shrink: true }}
                disabled={submitting}
              />
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            * Manual updates will override any existing logs for the selected date and mark the record as "VERIFIED".
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)} disabled={submitting}>Cancel</Button>
          <Button 
            onClick={handleManualUpdate} 
            variant="contained" 
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
