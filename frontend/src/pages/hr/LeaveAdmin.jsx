import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Button, Alert, Tab, Tabs, Grid, TextField, Dialog, DialogTitle, DialogContent,
  DialogActions, IconButton, InputAdornment, Autocomplete
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SearchIcon from '@mui/icons-material/Search';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { formatDisplayDate } from '../../utils/dateFormat';
import LeaveRequestDetailDialog from '../../components/leave/LeaveRequestDetailDialog';
import LeaveNotifyButton from '../../components/leave/LeaveNotifyButton';

const getRequestStatusLabel = (request) => {
  if (request.hod_skipped && request.status === 'HOD_APPROVED') return 'Awaiting HR';
  return request.status;
};

const HALF_DAY_PERIOD_LABELS = {
  FIRST_HALF: 'First Half',
  SECOND_HALF: 'Second Half',
};

const ROLE_OPTIONS = ['HOD', 'EMPLOYEE', 'HR', 'ADMIN', 'SUPER_ADMIN'];

export default function LeaveAdmin() {
  const { user } = useAuth();
  const [tabIndex, setTabIndex] = useState(0);
  const [requests, setRequests] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // Modals state
  const [editType, setEditType] = useState(null);
  const [deleteType, setDeleteType] = useState(null);
  const [password, setPassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deletingType, setDeletingType] = useState(false);
  const [newType, setNewType] = useState({ name: '', annual_quota: '', max_consecutive_days: '' });

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState(null);
  const [filterDept, setFilterDept] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);

  const [dialogRequest, setDialogRequest] = useState(null);

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = location.state?.highlightRequestId || searchParams.get('highlight');
  const highlightEmployeeId = location.state?.employeeId;
  const redirectCategory = location.state?.category;
  const rowRefs = useRef({});

  const fetchRequests = async () => {
    try {
      const res = await api.get('/api/leave/requests');
      setRequests(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTypes = async () => {
    try {
      const res = await api.get('/api/leave/types');
      setLeaveTypes(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([
        fetchRequests(),
        fetchTypes(),
        api.get('/api/employees/').then(r => setEmployees(r.data)).catch(() => {}),
        api.get('/api/departments/').then(r => setDepartments(r.data)).catch(() => {}),
      ]);
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (location.state?.tab === 'all') setTabIndex(1);
  }, [location.state]);

  useEffect(() => {
    if (redirectCategory) {
      const match = leaveTypes.find(t => t.name === redirectCategory);
      if (match) setFilterCategory(match);
    }
  }, [redirectCategory, leaveTypes]);

  useEffect(() => {
    if (!highlightId) return;
    // Auto-open the detail dialog for the highlighted request so that
    // cross-page navigations (e.g. from the calendar, or an email link
    // with ?highlight=ID) land directly on the full request view.
    const target = requests.find((r) => r.id === highlightId);
    if (!target) {
      // Data not yet fetched (e.g. page loaded in a new tab via the email
      // link). Keep highlightId so the effect re-runs once requests
      // populates.
      return;
    }
    const el = rowRefs.current[highlightId];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (target.status === 'PENDING' || target.status === 'HOD_APPROVED') {
      setTabIndex(0);
    } else {
      setTabIndex(1);
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
  }, [highlightId, requests]);

  const getEmployee = (id) => employees.find(s => s.id === id);
  const getDept = (id) => departments.find(d => d.id === id);

  const applyRequestFilters = (reqs) => reqs.filter(r => {
    if (highlightEmployeeId && r.employee_id !== highlightEmployeeId) return false;
    const sv = getEmployee(r.employee_id);
    const searchLower = search.toLowerCase();
    const matchSearch = !search
      || (sv && (
        sv.first_name?.toLowerCase().includes(searchLower)
        || sv.last_name?.toLowerCase().includes(searchLower)
        || String(sv.employee_id || '').includes(search)
      ));
    const matchRole = filterRole ? sv?.role === filterRole : true;
    const matchDept = filterDept ? sv?.department_id === filterDept.id : true;
    const matchCategory = filterCategory ? r.leave_type_id === filterCategory.id : true;
    return matchSearch && matchRole && matchDept && matchCategory;
  });

  const handleAction = async (id, action) => {
    try {
      await api.post(`/api/leave/action/${id}`, { action });
      setMessage(`Request ${action.toLowerCase()}d successfully.`);
      fetchRequests();
    } catch (err) {
      setMessage('Action failed. ' + err.response?.data?.detail);
    }
  };

  const handleEdit = async () => {
    try {
      await api.put(`/api/leave/types/${editType.id}`, {
        name: editType.name,
        annual_quota: editType.annual_quota,
        max_consecutive_days: editType.max_consecutive_days,
        is_active: editType.is_active
      });
      setMessage('Leave type updated successfully.');
      setEditType(null);
      fetchTypes();
    } catch (err) {
      setMessage('Failed to update. ' + (err.response?.data?.detail || ''));
    }
  };

  const handleAddType = async () => {
    const name = newType.name.trim();
    const quota = newType.annual_quota;
    const max = newType.max_consecutive_days;
    if (!name || !quota) {
      setMessage('Name and Quota are required');
      return;
    }
    try {
      await api.post('/api/leave/types', {
        name,
        annual_quota: parseInt(quota, 10),
        max_consecutive_days: max ? parseInt(max, 10) : null
      });
      setMessage('Leave type added successfully');
      setNewType({ name: '', annual_quota: '', max_consecutive_days: '' });
      fetchTypes();
    } catch(err) {
      setMessage('Failed to add type. ' + (err.response?.data?.detail || ''));
    }
  };

  const handleEnter = (event, action) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    action();
  };

  const handleDelete = async () => {
    try {
      if(!password) {
        setMessage('Password is required to delete');
        return;
      }
      setDeletingType(true);
      await api.request({
        method: 'DELETE',
        url: `/api/leave/types/${deleteType.id}`,
        data: { password }
      });
      setMessage('Leave type deleted successfully.');
      setDeleteType(null);
      setPassword('');
      fetchTypes();
    } catch (err) {
      setMessage('Failed to delete. ' + (err.response?.data?.detail || ''));
    } finally {
      setDeletingType(false);
    }
  };

  if (loading) return <CircularProgress />;

  const canApproveAsHod = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);
  const pendingHrAction = applyRequestFilters(
    requests.filter((r) => r.status === 'PENDING' || r.status === 'HOD_APPROVED')
  );
  const allFilteredRequests = applyRequestFilters(requests);

  const handleNotify = (req, result) => {
    if (result?.error) {
      setMessage('Notify failed: ' + result.error);
    } else {
      setMessage(result?.message || 'Notification sent.');
    }
    fetchRequests();
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" mb={3} sx={{ fontSize: { xs: '1.65rem', sm: '2.125rem' } }}>
        Leave Administration (HR)
      </Typography>

      {message && <Alert severity="info" sx={{ mb: 2 }}>{message}</Alert>}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabIndex} onChange={(e, v) => setTabIndex(v)} variant="scrollable" allowScrollButtonsMobile>
          <Tab label={`Pending Requests (${pendingHrAction.length})`} />
          <Tab label={`All Requests (${allFilteredRequests.length})`} />
          <Tab label="Manage Types" />
        </Tabs>
      </Box>

      {tabIndex < 2 && (
        <Box sx={{ p: 2, mb: 2, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', overflowX: 'auto' }}>
          <Grid container spacing={2} alignItems="center" wrap="nowrap" sx={{ minWidth: 800 }}>
            <Grid item xs={12} sm={4} sx={{ minWidth: 240 }}>
              <TextField size="small" label="Search Name or ID" value={search} fullWidth
                onChange={e => setSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> }} />
            </Grid>
            <Grid item xs={12} sm={2} sx={{ minWidth: 140 }}>
              <Autocomplete size="small" options={ROLE_OPTIONS} value={filterRole} onChange={(_, v) => setFilterRole(v)} fullWidth
                renderInput={p => <TextField {...p} label="Role" />} />
            </Grid>
            <Grid item xs={12} sm={3} sx={{ minWidth: 200 }}>
              <Autocomplete size="small" options={departments} getOptionLabel={o => o.name} fullWidth
                value={filterDept} onChange={(_, v) => setFilterDept(v)}
                renderInput={p => <TextField {...p} label="Department" />} />
            </Grid>
            {tabIndex === 1 && (
              <Grid item xs={12} sm={3} sx={{ minWidth: 200 }}>
                <Autocomplete size="small" options={leaveTypes} getOptionLabel={o => o.name} fullWidth
                  value={filterCategory} onChange={(_, v) => setFilterCategory(v)}
                  renderInput={p => <TextField {...p} label="Leave Category" />} />
              </Grid>
            )}
          </Grid>
        </Box>
      )}

      {tabIndex < 2 ? (
        <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
          <Table sx={{ minWidth: 650 }}>
            <TableHead sx={{ bgcolor: 'background.default' }}>
              <TableRow>
                <TableCell><b>Employee Name</b></TableCell>
                <TableCell><b>Department</b></TableCell>
                <TableCell><b>Leave Type</b></TableCell>
                <TableCell><b>Status</b></TableCell>
                <TableCell><b>Start Date</b></TableCell>
                <TableCell><b>End Date</b></TableCell>
                <TableCell><b>Days</b></TableCell>
                <TableCell><b>Reason</b></TableCell>
                <TableCell align="center"><b>Actions</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(tabIndex === 0 ? pendingHrAction : allFilteredRequests).map((req) => {
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
                        {sv ? `${sv.first_name} ${sv.last_name}` : '—'}
                      </Typography>
                      <Typography variant="caption">#{sv?.employee_id}</Typography>
                    </TableCell>
                    <TableCell>{dept?.name || '—'}</TableCell>
                    <TableCell>{req.leave_type_name || '—'}</TableCell>
                    <TableCell>
                      <Chip
                        label={getRequestStatusLabel(req)}
                        color={
                          req.status === 'APPROVED' ? 'success' :
                          req.status === 'REJECTED' ? 'error' :
                          req.status === 'HOD_APPROVED' ? 'info' : 'warning'
                        }
                        size="small"
                      />
                    </TableCell>
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
                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                      {tabIndex === 0 && (
                        req.status === 'PENDING' && canApproveAsHod ? (
                          <>
                            <Button size="small" variant="contained" color="success" sx={{ mr: 1 }}
                              onClick={() => handleAction(req.id, 'APPROVE')}
                            >
                              Approve as HOD
                            </Button>
                            <Button size="small" variant="outlined" color="error"
                              onClick={() => handleAction(req.id, 'REJECT')}
                            >
                              Reject
                            </Button>
                          </>
                        ) : req.status === 'PENDING' ? (
                          <LeaveNotifyButton
                            request={req}
                            targetRole="HOD"
                            onNotified={(result) => handleNotify(req, result)}
                          />
                        ) : req.status === 'HOD_APPROVED' ? (
                          <>
                            <Button size="small" variant="contained" color="success" sx={{ mr: 1 }}
                              onClick={() => handleAction(req.id, 'APPROVE')}
                            >
                              Approve
                            </Button>
                            <Button size="small" variant="outlined" color="error"
                              onClick={() => handleAction(req.id, 'REJECT')}
                            >
                              Reject
                            </Button>
                          </>
                        ) : '-'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(tabIndex === 0 ? pendingHrAction : allFilteredRequests).length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center">No requests found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box>
          <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3, borderRadius: { xs: 2, sm: 3 } }}>
            <Typography variant="h6" mb={2}>Add New Leave Category</Typography>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Name" fullWidth size="small"
                  id="new-type-name"
                  value={newType.name}
                  onChange={(e) => setNewType((current) => ({ ...current, name: e.target.value }))}
                  onKeyDown={(e) => handleEnter(e, handleAddType)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Annual Quota" type="number" fullWidth size="small"
                  id="new-type-quota"
                  value={newType.annual_quota}
                  onChange={(e) => setNewType((current) => ({ ...current, annual_quota: e.target.value }))}
                  onKeyDown={(e) => handleEnter(e, handleAddType)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="Max Consecutive" type="number" fullWidth size="small"
                  id="new-type-max"
                  value={newType.max_consecutive_days}
                  onChange={(e) => setNewType((current) => ({ ...current, max_consecutive_days: e.target.value }))}
                  onKeyDown={(e) => handleEnter(e, handleAddType)}
                />
              </Grid>
              <Grid item xs={12} sm={2}>
                <Button variant="contained" fullWidth onClick={handleAddType}>Add</Button>
              </Grid>
            </Grid>
          </Paper>
          <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Annual Quota</TableCell>
                  <TableCell>Max Consecutive</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leaveTypes.map(t => (
                  <TableRow key={t.id}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell>{t.annual_quota}</TableCell>
                    <TableCell>{t.max_consecutive_days || 'Unlimited'}</TableCell>
                    <TableCell>
                      <Chip label={t.is_active ? "Active" : "Inactive"} color={t.is_active ? "success" : "default"} size="small" />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton size="small" color="primary" onClick={() => setEditType({...t})}>
                        <EditIcon fontSize="small"/>
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => setDeleteType(t)}>
                        <DeleteIcon fontSize="small"/>
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Edit Dialog */}
          <Dialog open={!!editType} onClose={() => setEditType(null)} maxWidth="sm" fullWidth PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}>
            <DialogTitle>Edit Leave Type</DialogTitle>
            <DialogContent>
              <Box pt={2} display="flex" flexDirection="column" gap={2}>
                <TextField
                  label="Name"
                  fullWidth
                  value={editType?.name || ''}
                  onChange={(e) => setEditType({...editType, name: e.target.value})}
                  onKeyDown={(e) => handleEnter(e, handleEdit)}
                />
                <TextField
                  label="Annual Quota"
                  type="number"
                  fullWidth
                  value={editType?.annual_quota || ''}
                  onChange={(e) => setEditType({...editType, annual_quota: parseInt(e.target.value)})}
                  onKeyDown={(e) => handleEnter(e, handleEdit)}
                />
                <TextField
                  label="Max Consecutive Days"
                  type="number"
                  fullWidth
                  value={editType?.max_consecutive_days === null ? '' : editType?.max_consecutive_days}
                  onChange={(e) => setEditType({...editType, max_consecutive_days: e.target.value ? parseInt(e.target.value) : null})}
                  onKeyDown={(e) => handleEnter(e, handleEdit)}
                  helperText="Leave empty for unlimited"
                />
              </Box>
            </DialogContent>
            <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, px: 3, pb: 3, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, ml: { xs: '0 !important', sm: 1 } } }}>
              <Button onClick={() => setEditType(null)}>Cancel</Button>
              <Button variant="contained" onClick={handleEdit}>Save</Button>
            </DialogActions>
          </Dialog>

          {/* Delete Dialog */}
          <Dialog open={!!deleteType} onClose={() => { setDeleteType(null); setPassword(''); setShowDeletePassword(false); }} fullWidth maxWidth="xs" PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}>
            <DialogTitle>Delete Leave Type</DialogTitle>
            <DialogContent>
              <Box pt={2}>
                <Typography mb={2}>
                  Are you sure you want to delete <b>{deleteType?.name}</b>?
                  Please enter your password to confirm.
                </Typography>
                <TextField
                  label="Your Password"
                  type={showDeletePassword ? 'text' : 'password'}
                  fullWidth
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => handleEnter(e, handleDelete)}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle password visibility"
                          edge="end"
                          onClick={() => setShowDeletePassword((value) => !value)}
                        >
                          {showDeletePassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
            </DialogContent>
            <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, px: 3, pb: 3, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, ml: { xs: '0 !important', sm: 1 } } }}>
              <Button onClick={() => { setDeleteType(null); setPassword(''); setShowDeletePassword(false); }} disabled={deletingType}>Cancel</Button>
              <Button variant="contained" color="error" onClick={handleDelete} disabled={deletingType || !password}>
                {deletingType ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      )}

      <LeaveRequestDetailDialog
        open={!!dialogRequest}
        request={dialogRequest}
        viewer={user?.role || 'HR'}
        employees={employees}
        departments={departments}
        readOnly={tabIndex !== 0}
        onClose={() => {
          setDialogRequest(null);
          fetchRequests();
        }}
        onActionComplete={() => fetchRequests()}
      />
    </Box>
  );
}
