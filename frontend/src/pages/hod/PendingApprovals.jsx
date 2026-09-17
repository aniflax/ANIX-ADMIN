import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Button, Alert, Tabs, Tab, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Grid, Autocomplete, InputAdornment
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/axios';
import { formatDisplayDate } from '../../utils/dateFormat';
import { useAuth } from '../../context/AuthContext';
import LeaveRequestDetailDialog from '../../components/leave/LeaveRequestDetailDialog';
import LeaveNotifyButton from '../../components/leave/LeaveNotifyButton';

const statusColor = { APPROVED: 'success', REJECTED: 'error', HOD_APPROVED: 'info', PENDING: 'warning', CANCELLED: 'default' };
const HALF_DAY_PERIOD_LABELS = {
  FIRST_HALF: 'First Half',
  SECOND_HALF: 'Second Half',
};

export default function PendingApprovals() {
  const [allRequests, setAllRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [message, setMessage] = useState('');
  const [rejectDialog, setRejectDialog] = useState({ open: false, id: null });
  const [rejectReason, setRejectReason] = useState('');

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState(null);

  const [dialogRequest, setDialogRequest] = useState(null);

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const highlightId = location.state?.highlightRequestId || searchParams.get('highlight');
  const highlightEmployeeId = location.state?.employeeId;
  const redirectCategory = location.state?.category;
  const rowRefs = useRef({});

  const fetchData = useCallback(async () => {
    try {
      const [reqRes, sevRes, deptRes, typeRes] = await Promise.all([
        api.get('/api/leave/requests'),
        api.get('/api/employees/'),
        api.get('/api/departments/').catch(() => ({ data: [] })),
        api.get('/api/leave/types').catch(() => ({ data: [] })),
      ]);
      setAllRequests(reqRes.data);
      setEmployees(sevRes.data);
      setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
      setLeaveTypes(Array.isArray(typeRes.data) ? typeRes.data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (location.state?.tab === 'all') setTab(1);
  }, [location.state]);

  useEffect(() => {
    if (!redirectCategory) return;
    const match = leaveTypes.find(t => t.name === redirectCategory);
    if (match) setFilterCategory(match);
  }, [redirectCategory, leaveTypes]);

  useEffect(() => {
    if (!highlightId) return;
    // Auto-open the detail dialog for the highlighted request so that
    // cross-page navigations (e.g. from the calendar, or an email link
    // with ?highlight=ID) land directly on the full request view.
    const target = allRequests.find((r) => r.id === highlightId);
    if (!target) {
      // Data not yet fetched (e.g. page loaded in a new tab via the email
      // link). Keep highlightId so the effect re-runs once allRequests
      // populates.
      return;
    }
    const el = rowRefs.current[highlightId];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (target.status === 'PENDING' || target.status === 'HOD_APPROVED') {
      setTab(0);
    } else {
      setTab(1);
    }
    setDialogRequest(target);
    // Only now that the dialog is opened, clear the navigation state
    // and the query param so reloads / re-renders don't re-trigger.
    navigate(location.pathname, { replace: true, state: {} });
    if (searchParams.get('highlight')) {
      const next = new URLSearchParams(searchParams);
      next.delete('highlight');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, allRequests]);

  const getEmployee = (id) => employees.find(s => s.id === id);
  const getDept = (id) => departments.find(d => d.id === id);

  const applyRequestFilters = (reqs, currentTab) => reqs.filter(r => {
    // HOD's own leave requests must never appear in Leave Approvals — HODs
    // approve leave for their team, not for themselves.
    if (r.employee_id === user?.id) return false;
    if (highlightEmployeeId && r.employee_id !== highlightEmployeeId) return false;
    const sv = getEmployee(r.employee_id);
    const searchLower = search.toLowerCase();
    const matchSearch = !search
      || (sv && (
        sv.first_name?.toLowerCase().includes(searchLower)
        || sv.last_name?.toLowerCase().includes(searchLower)
        || String(sv.employee_id || '').includes(search)
      ));
    // Leave Category filter only applies on the All Requests tab — the
    // Pending Approval tab has no category filter.
    const matchCategory = (currentTab === 1 && filterCategory)
      ? r.leave_type_id === filterCategory.id
      : true;
    return matchSearch && matchCategory;
  });

  const pendingForHod = applyRequestFilters(
    allRequests.filter(r => r.status === 'PENDING' || r.status === 'HOD_APPROVED'),
    0
  );
  const allDeptRequests = applyRequestFilters(allRequests, 1);

  const handleNotify = (req, result) => {
    if (result?.error) {
      setMessage('Notify failed: ' + result.error);
    } else {
      setMessage(result?.message || 'Notification sent.');
    }
    fetchData();
  };

  const handleApprove = async (id) => {
    try {
      await api.post(`/api/leave/action/${id}`, { action: 'APPROVE' });
      setMessage('Leave request approved.');
      fetchData();
    } catch (err) { setMessage('Failed: ' + (err.response?.data?.detail || '')); }
  };

  const handleReject = async () => {
    try {
      await api.post(`/api/leave/action/${rejectDialog.id}`, { action: 'REJECT', rejection_reason: rejectReason });
      setMessage('Leave request rejected.');
      setRejectDialog({ open: false, id: null });
      setRejectReason('');
      fetchData();
    } catch (err) { setMessage('Failed: ' + (err.response?.data?.detail || '')); }
  };

  if (loading) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;

  const renderTable = (reqs, showActions = false) => (
    <TableContainer>
      <Table size="small">
        <TableHead sx={{ bgcolor: 'grey.50' }}>
          <TableRow>
            <TableCell><b>Employee Name</b></TableCell>
            <TableCell><b>Department</b></TableCell>
            <TableCell><b>Leave Type</b></TableCell>
            <TableCell><b>Start</b></TableCell>
            <TableCell><b>End</b></TableCell>
            <TableCell><b>Days</b></TableCell>
            <TableCell><b>Reason</b></TableCell>
            <TableCell><b>Status</b></TableCell>
            {showActions && <TableCell align="center"><b>Actions</b></TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {reqs.map(req => {
            const sv = getEmployee(req.employee_id);
            const dept = getDept(sv?.department_id);
            const isHighlighted = highlightId && req.id === highlightId;
            return (
              <TableRow
                key={req.id}
                hover
                ref={isHighlighted ? (el) => { rowRefs.current[req.id] = el; } : undefined}
                onClick={() => setDialogRequest(req)}
                sx={{
                  cursor: 'pointer',
                  ...(isHighlighted ? { bgcolor: 'action.selected' } : {}),
                }}
              >
                <TableCell>
                  <Typography variant="body2" fontWeight="bold">
                    {sv ? `${sv.first_name} ${sv.last_name}` : 'Unknown'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">#{sv?.employee_id}</Typography>
                </TableCell>
                <TableCell>{dept?.name || '—'}</TableCell>
                <TableCell>{req.leave_type_name || req.leave_type_id?.substring(0, 8)}</TableCell>
                <TableCell>{formatDisplayDate(req.start_date)}</TableCell>
                <TableCell>{formatDisplayDate(req.end_date)}</TableCell>
                <TableCell>
                  {req.total_days}
                  {req.is_half_day && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {HALF_DAY_PERIOD_LABELS[req.half_day_period] || 'Half Day'}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ maxWidth: 240 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {req.reason}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={req.status} size="small" color={statusColor[req.status] || 'default'} />
                </TableCell>
                {showActions && (
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    {req.status === 'PENDING' ? (
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                        <Button size="small" variant="contained" color="success" onClick={() => handleApprove(req.id)}>
                          Approve
                        </Button>
                        <Button size="small" variant="outlined" color="error"
                          onClick={() => setRejectDialog({ open: true, id: req.id })}>
                          Reject
                        </Button>
                      </Box>
                    ) : req.status === 'HOD_APPROVED' ? (
                      <LeaveNotifyButton
                        request={req}
                        targetRole="HR"
                        onNotified={(result) => handleNotify(req, result)}
                      />
                    ) : '—'}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {reqs.length === 0 && (
            <TableRow>
              <TableCell colSpan={showActions ? 9 : 8} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                No requests found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box>
      <Typography variant="h5" fontWeight="bold" gutterBottom>Leave Approvals (HOD)</Typography>
      {message && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setMessage('')}>{message}</Alert>}

      <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', overflowX: 'auto' }}>
          <Grid container spacing={2} alignItems="center" wrap="nowrap" sx={{ minWidth: tab === 1 ? 600 : 280 }}>
            <Grid item xs={12} sm={tab === 1 ? 6 : 12} sx={{ minWidth: 280 }}>
              <TextField size="small" label="Search Name or ID" value={search} fullWidth
                onChange={e => setSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> }} />
            </Grid>
            {tab === 1 && (
              <Grid item xs={12} sm={6} sx={{ minWidth: 280 }}>
                <Autocomplete size="small" options={leaveTypes} getOptionLabel={o => o.name} isOptionEqualToValue={(o, v) => o.id === v.id} fullWidth
                  value={filterCategory} onChange={(_, v) => setFilterCategory(v)}
                  renderInput={p => <TextField {...p} label="Leave Category" />} />
              </Grid>
            )}
          </Grid>
        </Box>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tab label={`Pending Approval (${pendingForHod.length})`} />
          <Tab label={`All Requests (${allDeptRequests.length})`} />
        </Tabs>
        <Box sx={{ p: 1 }}>
          {tab === 0 && renderTable(pendingForHod, true)}
          {tab === 1 && renderTable(allDeptRequests, false)}
        </Box>
      </Paper>

      {/* Reject Dialog */}
      <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ open: false, id: null })}>
        <DialogTitle>Reject Leave Request</DialogTitle>
        <DialogContent>
          <TextField fullWidth multiline rows={3} label="Rejection Reason" value={rejectReason}
            onChange={e => setRejectReason(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialog({ open: false, id: null })}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleReject}>Confirm Reject</Button>
        </DialogActions>
      </Dialog>

      <LeaveRequestDetailDialog
        open={!!dialogRequest}
        request={dialogRequest}
        viewer={user?.role || 'HOD'}
        employees={employees}
        departments={departments}
        readOnly={tab !== 0}
        onClose={() => {
          setDialogRequest(null);
          fetchData();
        }}
        onActionComplete={() => fetchData()}
      />
    </Box>
  );
}
