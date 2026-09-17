import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, MenuItem, Button, Alert, CircularProgress,
  Grid, Stepper, Step, StepLabel, Chip, Card, CardContent, FormControlLabel, Checkbox
} from '@mui/material';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { formatDisplayDateRange, getIsoDate } from '../../utils/dateFormat';

const HALF_DAY_PERIOD_LABELS = {
  FIRST_HALF: 'First Half',
  SECOND_HALF: 'Second Half',
};

export default function ApplyLeave() {
  const { user } = useAuth();
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formData, setFormData] = useState({
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
    is_half_day: false,
    half_day_period: ''
  });
  const activationDateStr = getIsoDate(user?.activated_at);

  const fetchData = async () => {
    try {
      const [typesRes, balancesRes, historyRes] = await Promise.all([
        api.get('/api/leave/types'),
        api.get(`/api/leave/balances/${user.id}`),
        api.get('/api/leave/requests')
      ]);
      setLeaveTypes(typesRes.data);
      setBalances(balancesRes.data);
      // Filter history down to just my requests, sorted by recent
      const myReqs = historyRes.data.filter(r => r.employee_id === user.id).reverse();
      setHistory(myReqs);
    } catch {
      setError('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!formData.leave_type_id || !formData.start_date || !formData.end_date || !formData.reason) {
      setError('Please fill all fields');
      return;
    }
    if (formData.is_half_day && !formData.half_day_period) {
      setError('Please select First Half or Second Half');
      return;
    }
    if (!activationDateStr || formData.start_date < activationDateStr) {
      setError('Leave can be applied only from the account activation date');
      return;
    }
    try {
      await api.post('/api/leave/apply', formData);
      setSuccess('Leave applied successfully! Sent for approval.');
      setFormData({ leave_type_id: '', start_date: '', end_date: '', reason: '', is_half_day: false, half_day_period: '' });
      fetchData(); // Refresh history and balances
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to apply leave');
    }
  };

  const getStepForStatus = (status) => {
    if (status === 'PENDING') return 1;
    if (status === 'HOD_APPROVED') return 2;
    if (status === 'APPROVED') return 4;
    if (status === 'REJECTED') return -1;
    return 0;
  };

  const getStatusLabel = (request) => {
    if (request.hod_skipped && request.status === 'HOD_APPROVED') return 'Awaiting HR';
    return request.status.replace('_', ' ');
  };

  if (loading) return <CircularProgress />;

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" mb={3}>
        Leave Application & History
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" mb={2}>Apply for Leave</Typography>
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <TextField
                select
                fullWidth
                label="Leave Type"
                value={formData.leave_type_id}
                onChange={(e) => setFormData({ ...formData, leave_type_id: e.target.value })}
                sx={{ mb: 3 }}
              >
                {leaveTypes.map((type) => (
                  <MenuItem key={type.id} value={type.id}>
                    {type.name} (Max {type.max_consecutive_days || 'Unlimited'} days)
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                fullWidth
                type="date"
                label="Start Date"
                InputLabelProps={{ shrink: true }}
                value={formData.start_date}
                onChange={(e) => {
                  const newDate = e.target.value;
                  setFormData({
                    ...formData,
                    start_date: newDate,
                    end_date: formData.is_half_day ? newDate : formData.end_date
                  });
                }}
                inputProps={{ min: activationDateStr || undefined }}
                sx={{ mb: 3 }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.is_half_day}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormData({
                        ...formData,
                        is_half_day: checked,
                        half_day_period: checked ? formData.half_day_period : '',
                        end_date: checked ? formData.start_date : formData.end_date
                      });
                    }}
                  />
                }
                label="Apply for Half Day"
                sx={{ mb: 2, display: 'block' }}
              />

              {formData.is_half_day && (
                <TextField
                  select
                  fullWidth
                  label="Half Day Session"
                  value={formData.half_day_period}
                  onChange={(e) => setFormData({ ...formData, half_day_period: e.target.value })}
                  sx={{ mb: 3 }}
                >
                  <MenuItem value="FIRST_HALF">First Half</MenuItem>
                  <MenuItem value="SECOND_HALF">Second Half</MenuItem>
                </TextField>
              )}

              <TextField
                fullWidth
                type="date"
                label="End Date"
                InputLabelProps={{ shrink: true }}
                disabled={formData.is_half_day}
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                inputProps={{ min: formData.start_date || activationDateStr || undefined }}
                sx={{ mb: 3 }}
              />

              <TextField
                fullWidth
                multiline
                rows={3}
                label="Reason"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                sx={{ mb: 3 }}
              />

              <Button type="submit" variant="contained" color="primary" fullWidth size="large">
                Submit Request
              </Button>
            </Box>
          </Paper>

          <Typography variant="h6" mb={2}>My Leave Balances</Typography>
          <Grid container spacing={2}>
            {balances.map(b => {
              const typeInfo = leaveTypes.find(t => t.id === b.leave_type_id);
              return (
                <Grid item xs={12} sm={6} key={b.id}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle2" color="text.secondary">
                        {typeInfo ? typeInfo.name : 'Unknown Type'}
                      </Typography>
                      <Typography variant="h5" color="primary">
                        {b.available} Days Available
                      </Typography>
                      <Typography variant="body2">
                        Total: {b.total_allocated} | Used: {b.used} | Pending: {b.pending}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, minHeight: '100%' }}>
            <Typography variant="h6" mb={2}>Leave Requests History</Typography>
            {history.length === 0 && <Typography>No history found.</Typography>}
            {history.map((req) => {
              const activeStep = getStepForStatus(req.status);
              const isRejected = activeStep === -1;

              return (
                <Box key={req.id} mb={4} p={2} border={1} borderColor="grey.200" borderRadius={2}>
                  <Box display="flex" justifyContent="space-between" mb={2}>
                    <Typography variant="subtitle1" fontWeight="bold">
                      {formatDisplayDateRange(req.start_date, req.end_date)} ({req.total_days} days{req.is_half_day ? `, ${HALF_DAY_PERIOD_LABELS[req.half_day_period] || 'Half Day'}` : ''})
                    </Typography>
                    <Chip
                      label={isRejected ? "Rejected" : getStatusLabel(req)}
                      color={isRejected ? "error" : (req.status === 'APPROVED' ? "success" : "info")}
                      size="small"
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    Reason: {req.reason}
                  </Typography>

                  <Stepper activeStep={isRejected ? 4 : activeStep} alternativeLabel>
                    <Step completed={true}>
                      <StepLabel>Applied</StepLabel>
                    </Step>
                    <Step completed={activeStep > 1 || req.status === 'APPROVED'} error={isRejected && req.rejection_reason && req.rejection_reason.includes('HOD')}>
                      <StepLabel error={isRejected}>{req.hod_skipped ? 'HOD Skipped' : 'Approved by HOD'}</StepLabel>
                    </Step>
                    <Step completed={activeStep > 2 || req.status === 'APPROVED'} error={isRejected && !req.rejection_reason?.includes('HOD')}>
                      <StepLabel error={isRejected}>Approved by HR</StepLabel>
                    </Step>
                    <Step completed={req.status === 'APPROVED'}>
                      <StepLabel>Done</StepLabel>
                    </Step>
                  </Stepper>
                  {isRejected && req.rejection_reason && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                      Rejection Reason: {req.rejection_reason}
                    </Alert>
                  )}
                </Box>
              );
            })}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
