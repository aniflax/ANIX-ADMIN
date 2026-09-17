import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, CircularProgress,
  Button, TextField, Grid, Autocomplete, InputAdornment,
  Tabs, Tab, Menu, MenuItem as MuiMenuItem, Alert, Dialog,
  DialogTitle, DialogContent, DialogActions, Select, FormControl,
  InputLabel, Checkbox, Tooltip
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import SearchIcon from '@mui/icons-material/Search';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import EmailIcon from '@mui/icons-material/Email';
import OfficialCommunicationDialog from '../../components/leave/OfficialCommunicationDialog';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { useLocation, Link } from 'react-router-dom';
import { formatDisplayDate } from '../../utils/dateFormat';

const statusColor = { ACTIVE: 'success', INACTIVE: 'default', LOCKED: 'error' };

function TabPanel({ children, value, index }) {
  return value === index ? <Box>{children}</Box> : null;
}

// ─── Financial Month Helpers ───────────────────────────────────────────────────
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Returns the display label for a financial month using the cutoff day.
 * Financial month N: (cutoff+1) of (N-1) to cutoff of N.
 * E.g. cutoff=20, April => "April (21 Mar – 20 Apr)"
 */
function getFinancialMonthLabel(month, year, cutoff) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const startDay = cutoff + 1;
  return `${MONTH_NAMES[month - 1]} ${year} (${startDay} ${MONTH_NAMES[prevMonth - 1].slice(0, 3)} – ${cutoff} ${MONTH_NAMES[month - 1].slice(0, 3)})`;
}

/**
 * Build last 13 financial months + "All" as option list.
 */
function buildMonthOptions(cutoff = 20) {
  const now = new Date();
  const options = [{ label: 'All', month: null, year: null }];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    options.push({ label: getFinancialMonthLabel(month, year, cutoff), month, year });
  }
  return options;
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function EmployeeDirectory() {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Onboardings state
  const [onboardings, setOnboardings] = useState([]);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [cutoffDay, setCutoffDay] = useState(20);
  const [monthOptions, setMonthOptions] = useState(buildMonthOptions(20));
  const [selectedMonthOption, setSelectedMonthOption] = useState(buildMonthOptions(20)[0]);
  const [selectedOnboardings, setSelectedOnboardings] = useState(new Set());
  const [onboardingSearch, setOnboardingSearch] = useState('');

  const [tabIdx, setTabIdx] = useState(0);
  const [msg, setMsg] = useState(null);
  const { user } = useAuth();
  const location = useLocation();

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState(null);
  const [filterDept, setFilterDept] = useState(null);

  // Actions dropdown state per row
  const [anchorEl, setAnchorEl] = useState(null);
  const [activeRow, setActiveRow] = useState(null);
  const [menuContext, setMenuContext] = useState('directory');

  // Delete-request confirm dialog
  const [delReqDialog, setDelReqDialog] = useState({ open: false, employee: null });

  // Bulk Communication dialog
  const [bulkOpen, setBulkOpen] = useState(false);

  const isHod = user?.role === 'HOD';
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role);
  const isHr = user?.role === 'HR';
  const canSeeOnboarding = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role);
  const canBulkCommunicate = isHr || isAdmin;
  // Leave Balance Modification Dialog
  const [leaveDialog, setLeaveDialog] = useState({ open: false, employee: null });
  const [editingBalances, setEditingBalances] = useState([]);
  const [saveLoading, setSaveLoading] = useState(false);

  // Tab indices: 0=All Employees, 1=Onboardings (if allowed), 2=Inactive (if not HOD)
  // We compute the actual tab index mapping here:
  const onboardingTabIdx = canSeeOnboarding ? 1 : null;

  // ─── Fetch main directory ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [sevRes, deptRes] = await Promise.all([
        api.get('/api/employees/'),
        api.get('/api/departments/')
      ]);
      setEmployees(sevRes.data);
      setDepartments(deptRes.data);
    } catch (error) {
      console.error('Failed to fetch directory data', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canSeeOnboarding) return;
    api.get('/api/leave/types')
      .then(res => setLeaveTypes(Array.isArray(res.data) ? res.data : []))
      .catch(() => setLeaveTypes([]));
  }, [canSeeOnboarding]);

  // ─── Fetch onboardings ─────────────────────────────────────────────────────
  const fetchOnboardings = useCallback(async (monthOpt) => {
    if (!canSeeOnboarding) return;
    setOnboardingLoading(true);
    try {
      const params = {};
      if (monthOpt.month !== null && monthOpt.year !== null) {
        params.month = monthOpt.month;
        params.year = monthOpt.year;
        params.cutoff = cutoffDay;
      }
      const res = await api.get('/api/employees/onboarding', { params });
      setOnboardings(res.data);
      setSelectedOnboardings(new Set()); // clear selection on filter change
      setOnboardingSearch('');
    } catch (error) {
      console.error('Failed to fetch onboardings', error);
    } finally {
      setOnboardingLoading(false);
    }
  }, [canSeeOnboarding, cutoffDay]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch FINANCIAL_CUTOFF_DATE from config
  useEffect(() => {
    if (!canSeeOnboarding) return;
    api.get('/api/config/FINANCIAL_CUTOFF_DATE')
      .then(res => {
        const day = parseInt(res.data?.value || '20', 10);
        if (!isNaN(day) && day > 0 && day < 28) {
          setCutoffDay(day);
          const opts = buildMonthOptions(day);
          setMonthOptions(opts);
          setSelectedMonthOption(opts[0]);
        }
      })
      .catch(() => { /* use default 20 */ });
  }, [canSeeOnboarding]);

  // Fetch onboardings whenever month filter changes OR when we switch to onboarding tab
  useEffect(() => {
    if (tabIdx === onboardingTabIdx) {
      fetchOnboardings(selectedMonthOption);
    }
  }, [tabIdx, selectedMonthOption, fetchOnboardings, onboardingTabIdx]);

  const getDeptName = (id) => departments.find(d => d.id === id)?.name || 'Unassigned';
  const getLeaveTypeName = (leaveTypeId) => (
    leaveTypes.find(t => t.id === leaveTypeId)?.name || 'Leave Type'
  );
  const sortBalancesByLeaveType = (balances) => [...balances].sort((a, b) => (
    getLeaveTypeName(a.leave_type_id).localeCompare(getLeaveTypeName(b.leave_type_id), undefined, { sensitivity: 'base' })
  ));
  const isSameLocalDate = (value, date = new Date()) => {
    if (!value) return false;
    const target = new Date(value);
    return target.getFullYear() === date.getFullYear()
      && target.getMonth() === date.getMonth()
      && target.getDate() === date.getDate();
  };
  const canModifyLeaveBalances = (employee) => {
    if (!employee?.email_verified) return false;
    if (isAdmin) return true;
    return isHr && !employee.hr_leave_modified && isSameLocalDate(employee.activated_at);
  };

  // 3 months ago cutoff for inactive accounts
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const applyFilters = (list) => list.filter(s => {
    // HOD scope: only their own department, excluding the HOD themselves.
    // This enforces the rule that HODs only ever see and act on their team.
    if (isHod && (s.department_id !== user.department_id || s.id === user.id)) return false;
    const searchLower = search.toLowerCase();
    const matchSearch = !search
      || s.first_name.toLowerCase().includes(searchLower)
      || s.last_name.toLowerCase().includes(searchLower)
      || s.employee_id.toString().includes(search)
      || (s.email && s.email.toLowerCase().includes(searchLower));
    const matchRole = filterRole ? s.role === filterRole : true;
    const matchDept = filterDept ? s.department_id === filterDept.id : true;
    return matchSearch && matchRole && matchDept;
  });

  const activeEmployees = applyFilters(employees.filter(s => s.status !== 'INACTIVE' ||
    !s.updated_at || new Date(s.updated_at) > threeMonthsAgo));
  const inactiveEmployees = applyFilters(employees.filter(s =>
    s.status === 'INACTIVE' && s.updated_at && new Date(s.updated_at) <= threeMonthsAgo
  ));

  // Onboarding search filter
  const filteredOnboardings = onboardings.filter(o => {
    if (!onboardingSearch) return true;
    const q = onboardingSearch.toLowerCase();
    return (
      o.first_name?.toLowerCase().includes(q) ||
      o.last_name?.toLowerCase().includes(q) ||
      String(o.employee_id).includes(q) ||
      o.email?.toLowerCase().includes(q)
    );
  });

  // ─── CSV Export ──────────────────────────────────────────────────────────────
  const exportToCsv = (list) => {
    let csv = 'data:text/csv;charset=utf-8,';
    csv += 'ID,First Name,Last Name,Email,Role,Status,Department\n';
    list.forEach(s => {
      csv += [s.employee_id, s.first_name, s.last_name, s.email || 'N/A', s.role, s.status, getDeptName(s.department_id)].join(',') + '\r\n';
    });
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', 'employee_directory.csv');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleOpenLeaveDialog = async (employee) => {
    closeMenu();
    try {
      const res = await api.get(`/api/leave/balances/${employee.id}`);
      setEditingBalances(sortBalancesByLeaveType(Array.isArray(res.data) ? res.data : []));
      setLeaveDialog({ open: true, employee });
    } catch (err) {
      console.error('Failed to fetch leave balances', err);
      setMsg({ type: 'error', text: 'Failed to fetch leave balances' });
    }
  };

  const handleSaveBalances = async () => {
    const hasInvalidBalance = editingBalances.some(b => Number(b.total_allocated) < Number(b.used || 0) + Number(b.pending || 0));
    if (hasInvalidBalance) {
      setMsg({ type: 'error', text: 'Allocated balance cannot be less than used plus pending days.' });
      return;
    }
    setSaveLoading(true);
    try {
      await api.put(`/api/leave/balances/${leaveDialog.employee.id}`, {
        updates: editingBalances.map(b => ({
          leave_type_id: b.leave_type_id,
          new_allocated: b.total_allocated
        }))
      });
      setMsg({ type: 'success', text: 'Balances updated successfully' });
      setLeaveDialog({ open: false, employee: null });
      fetchOnboardings(selectedMonthOption); // Refresh
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to update balances' });
    } finally {
      setSaveLoading(false);
    }
  };

  const exportOnboardingsCsv = () => {
    const toExport = selectedOnboardings.size > 0
      ? onboardings.filter(o => selectedOnboardings.has(o.id))
      : onboardings;

    let csv = 'data:text/csv;charset=utf-8,';
    csv += 'Employee ID,First Name,Last Name,Email,Email Verified,Status,Registered On,Activated On\n';
    toExport.forEach(o => {
      const registeredOn = o.created_at ? formatDisplayDate(o.created_at, 'N/A') : '—';
      const activatedOn = o.email_verified && o.activated_at ? formatDisplayDate(o.activated_at, 'N/A') : '—';
      csv += [
        o.employee_id,
        o.first_name,
        o.last_name,
        o.email || 'N/A',
        o.email_verified ? 'Yes' : 'No',
        o.status,
        registeredOn,
        activatedOn
      ].join(',') + '\r\n';
    });
    const label = selectedOnboardings.size > 0 ? `onboardings_selected` : `onboardings_all`;
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `${label}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  // ─── Onboarding selection helpers ─────────────────────────────────────────
  const toggleOnboarding = (id) => {
    setSelectedOnboardings(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Directory actions ─────────────────────────────────────────────────────
  const openMenu = (e, employee, context = 'directory') => {
    setAnchorEl(e.currentTarget);
    setActiveRow(employee);
    setMenuContext(context);
  };
  const closeMenu = () => { setAnchorEl(null); setActiveRow(null); setMenuContext('directory'); };

  const doDeactivate = async (employee) => {
    closeMenu();
    try {
      await api.put(`/api/employees/${employee.id}/admin`, { status: 'INACTIVE' });
      setMsg({ type: 'success', text: `${employee.first_name} deactivated.` });
      fetchData();
    } catch (e) { setMsg({ type: 'error', text: e.response?.data?.detail || 'Failed.' }); }
  };

  const doActivate = async (employee) => {
    closeMenu();
    try {
      await api.post(`/api/employees/${employee.id}/activate`);
      setMsg({ type: 'success', text: `${employee.first_name} activated.` });
      fetchData();
    } catch (e) { setMsg({ type: 'error', text: e.response?.data?.detail || 'Failed.' }); }
  };

  const doDeleteRequest = async () => {
    const employee = delReqDialog.employee;
    setDelReqDialog({ open: false, employee: null });
    try {
      await api.post(`/api/employees/${employee.id}/delete-request`);
      setMsg({ type: 'success', text: `Delete request submitted for ${employee.first_name} ${employee.last_name}.` });
      fetchData();
    } catch (e) { setMsg({ type: 'error', text: e.response?.data?.detail || 'Failed.' }); }
  };

  const doWithdrawDeleteRequest = async (employee) => {
    closeMenu();
    try {
      await api.delete(`/api/employees/${employee.id}/delete-request`);
      setMsg({ type: 'success', text: `Delete request withdrawn for ${employee.first_name} ${employee.last_name}.` });
      fetchData();
    } catch (e) { setMsg({ type: 'error', text: e.response?.data?.detail || 'Failed.' }); }
  };

  // ─── Main directory table ──────────────────────────────────────────────────
  const renderTable = (list, showInactiveWarning = false) => (
    <TableContainer>
      <Table sx={{ minWidth: 700 }} size="small">
        <TableHead sx={{ bgcolor: 'grey.50' }}>
          <TableRow>
            <TableCell><b>ID</b></TableCell>
            <TableCell><b>Name</b></TableCell>
            <TableCell><b>Department</b></TableCell>
            <TableCell><b>Role</b></TableCell>
            <TableCell><b>Email</b></TableCell>
            <TableCell><b>Status</b></TableCell>
            <TableCell align="right"><b>Actions</b></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {list.map(s => (
            <TableRow key={s.id} hover sx={{ bgcolor: s.delete_requested ? '#fff3e0' : 'inherit' }}>
              <TableCell>{s.employee_id}</TableCell>
              <TableCell>
                <Link
                  to={`/profile/${s.id}`}
                  state={{ from: location.pathname }}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <b style={{ textDecoration: 'underline' }}>{s.first_name} {s.last_name}</b>
                </Link>
              </TableCell>
              <TableCell>{getDeptName(s.department_id)}</TableCell>
              <TableCell><Chip label={s.role?.replace('_', ' ')} size="small" variant="outlined" /></TableCell>
              <TableCell>
                <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
                  <Typography variant="body2" component="span">
                    {s.email || '—'}
                  </Typography>
                  {s.email && (
                    s.email_verified ? (
                      <VerifiedIcon sx={{ fontSize: 18, color: '#2e7d32' }} titleAccess="Email verified" />
                    ) : (
                      <MarkEmailUnreadIcon sx={{ fontSize: 18, color: '#ed6c02' }} titleAccess="Email not verified" />
                    )
                  )}
                </Box>
              </TableCell>
              <TableCell>
                <Chip label={s.status} size="small" color={statusColor[s.status] || 'default'} />
                {s.delete_requested && <Chip label="Del. Requested" size="small" color="error" sx={{ ml: 0.5 }} />}
              </TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<ArrowDropDownIcon />}
                  onClick={(e) => openMenu(e, s, 'directory')}
                >
                  Actions
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {list.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                {showInactiveWarning ? 'No inactive accounts older than 3 months.' : 'No Employees found.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );

  // ─── Onboardings table ─────────────────────────────────────────────────────
  const renderOnboardingsTable = (list) => {
    if (onboardingLoading) {
      return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>;
    }
    const allSelected = list.length > 0 && selectedOnboardings.size === list.length;
    const someSelected = selectedOnboardings.size > 0 && !allSelected;

    return (
      <TableContainer>
        <Table sx={{ minWidth: 750 }} size="small">
          <TableHead sx={{ bgcolor: 'grey.50' }}>
            <TableRow>
              <TableCell padding="checkbox">
                <Tooltip title={allSelected ? 'Deselect all' : `Select all ${list.length}`}>
                  <Checkbox
                    indeterminate={someSelected}
                    checked={allSelected}
                    onChange={() => {
                      if (allSelected) setSelectedOnboardings(new Set());
                      else setSelectedOnboardings(new Set(list.map(o => o.id)));
                    }}
                    size="small"
                  />
                </Tooltip>
              </TableCell>
              <TableCell><b>Employee ID</b></TableCell>
              <TableCell><b>Name</b></TableCell>
              <TableCell><b>Email</b></TableCell>
              <TableCell><b>Registered On</b></TableCell>
              <TableCell><b>Activated On</b></TableCell>
              <TableCell><b>Status</b></TableCell>
              <TableCell align="center"><b>Manage</b></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map(o => {
              const registeredOn = o.created_at
                ? formatDisplayDate(o.created_at, 'N/A')
                : '—';
              const activatedOn = o.email_verified && o.activated_at
                ? formatDisplayDate(o.activated_at, 'N/A')
                : '—';
              return (
                <TableRow
                  key={o.id}
                  hover
                  selected={selectedOnboardings.has(o.id)}
                  sx={{ bgcolor: selectedOnboardings.has(o.id) ? 'action.selected' : 'inherit' }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedOnboardings.has(o.id)}
                      onChange={() => toggleOnboarding(o.id)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{o.employee_id}</TableCell>
                  <TableCell>
                    <b>{o.first_name} {o.last_name}</b>
                  </TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={0.75}>
                      <Typography variant="body2" component="span">{o.email || '—'}</Typography>
                      {o.email && (
                        o.email_verified
                          ? <VerifiedIcon sx={{ fontSize: 16, color: '#2e7d32' }} titleAccess="Email verified" />
                          : <MarkEmailUnreadIcon sx={{ fontSize: 16, color: '#ed6c02' }} titleAccess="Pending verification" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{registeredOn}</TableCell>
                  <TableCell>
                    {o.email_verified
                      ? <Typography variant="body2" color="success.main">{activatedOn}</Typography>
                      : <Typography variant="body2" color="text.secondary" fontStyle="italic">Pending</Typography>
                    }
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={o.email_verified ? 'ACTIVATED' : 'PENDING'}
                      size="small"
                      color={o.email_verified ? 'success' : 'warning'}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Button
                      size="small"
                      variant="outlined"
                      endIcon={<ArrowDropDownIcon />}
                      onClick={(e) => openMenu(e, o, 'onboarding')}
                    >
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No onboarding records found for the selected period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  if (loading) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;

  const roles = ['HOD', 'EMPLOYEE'];
  const currentList = tabIdx === 0 ? activeEmployees : inactiveEmployees;
  const balanceValidationError = editingBalances.some(
    b => Number(b.total_allocated) < Number(b.used || 0) + Number(b.pending || 0)
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, mb: 3, gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Typography variant="h5" fontWeight="bold">{isHod ? 'Department Directory' : 'Employee Directory'}</Typography>
        <Box display="flex" gap={1.5} flexWrap="wrap" sx={{ '& .MuiButton-root': { flex: { xs: '1 1 100%', sm: '0 0 auto' } } }}>
          {tabIdx === onboardingTabIdx ? (
            <Button
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              onClick={exportOnboardingsCsv}
            >
              {selectedOnboardings.size > 0
                ? `Export Selected (${selectedOnboardings.size})`
                : 'Export to CSV'}
            </Button>
          ) : (
            <Button variant="outlined" onClick={() => exportToCsv(currentList)}>Export to CSV</Button>
          )}
          {canBulkCommunicate && (
            <Button
              variant="contained"
              color="secondary"
              startIcon={<EmailIcon />}
              onClick={() => setBulkOpen(true)}
            >
              Official Communication
            </Button>
          )}
          {canSeeOnboarding && (
            <Button variant="contained" component={Link} to="/onboarding">+ Add Employee</Button>
          )}
        </Box>
      </Box>

      {msg && <Alert severity={msg.type} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {/* Tabs */}
      <Paper sx={{ borderRadius: { xs: 2, sm: 3 }, overflow: 'hidden' }}>
        <Tabs
          value={tabIdx}
          onChange={(_, v) => setTabIdx(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Tab label={`All Employees (${activeEmployees.length})`} />
          {canSeeOnboarding && (
            <Tab label={`Onboardings (${filteredOnboardings.length})`} />
          )}
          {!isHod && (
            <Tab label={`Inactive >3 Months (${inactiveEmployees.length})`} />
          )}
        </Tabs>

        {/* ── All Employees filters ── */}
        {tabIdx !== onboardingTabIdx && (
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', overflowX: 'auto' }}>
            <Grid container spacing={2} alignItems="center" wrap="nowrap" sx={{ minWidth: { xs: isHod ? 360 : 860, md: 0 } }}>
              <Grid item xs={12} sm={isHod ? 12 : 4} sx={{ minWidth: { xs: isHod ? 360 : 320, md: 0 } }}>
                <TextField size="small" label="Search Name, ID or Email" value={search} fullWidth
                  onChange={e => setSearch(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> }} />
              </Grid>
              {!isHod && (
                <>
                  <Grid item xs={12} sm={3} sx={{ minWidth: { xs: 220, md: 220 } }}>
                    <Autocomplete sx={{ width: '100%' }} size="small" options={roles} value={filterRole} onChange={(_, v) => setFilterRole(v)} fullWidth
                      renderInput={p => <TextField {...p} label="Filter by Role" />} />
                  </Grid>
                  <Grid item xs={12} sm={5} sx={{ minWidth: { xs: 220, md: 220 } }}>
                    <Autocomplete sx={{ width: '100%' }} size="small" options={departments} getOptionLabel={o => o.name} fullWidth
                      value={filterDept} onChange={(_, v) => setFilterDept(v)}
                      renderInput={p => <TextField {...p} label="Filter by Department" />} />
                  </Grid>
                </>
              )}
            </Grid>
          </Box>
        )}

        {/* ── Onboardings filter bar ── */}
        {tabIdx === onboardingTabIdx && (
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'nowrap', overflowX: 'auto' }}>
            <FormControl size="small" sx={{ width: 380, minWidth: 380 }}>
              <InputLabel>Financial Month</InputLabel>
              <Select
                label="Financial Month"
                value={selectedMonthOption.label}
                onChange={(e) => {
                  const opt = monthOptions.find(o => o.label === e.target.value);
                  if (opt) setSelectedMonthOption(opt);
                }}
              >
                {monthOptions.map(opt => (
                  <MuiMenuItem key={opt.label} value={opt.label}>{opt.label}</MuiMenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Search Name, ID or Email"
              value={onboardingSearch}
              onChange={e => setOnboardingSearch(e.target.value)}
              sx={{ width: 320, minWidth: 320 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> }}
            />
            {selectedOnboardings.size > 0 && (
              <Typography variant="body2" color="text.secondary">
                {selectedOnboardings.size} of {filteredOnboardings.length} selected
              </Typography>
            )}
          </Box>
        )}

        {/* ── Tab panels ── */}
        <TabPanel value={tabIdx} index={0}>{renderTable(activeEmployees)}</TabPanel>

        {canSeeOnboarding && (
          <TabPanel value={tabIdx} index={1}>
            {renderOnboardingsTable(filteredOnboardings)}
          </TabPanel>
        )}

        {!isHod && (
          <TabPanel value={tabIdx} index={canSeeOnboarding ? 2 : 1}>
            {inactiveEmployees.length > 0 && (
              <Alert severity="warning" sx={{ m: 2 }}>
                These {inactiveEmployees.length} account(s) have been inactive for more than 3 months and require action.
              </Alert>
            )}
            {renderTable(inactiveEmployees, true)}
          </TabPanel>
        )}
      </Paper>

      {/* Actions Dropdown */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        <MuiMenuItem
          component={Link}
          to={activeRow ? `/profile/${activeRow.id}` : '#'}
          state={{ from: location.pathname }}
          onClick={closeMenu}
        >
          View Profile
        </MuiMenuItem>
        <MuiMenuItem
          component={Link}
          to={activeRow ? `/directory/${activeRow.id}/employee-records` : '#'}
          state={{ ...location.state, from: location.pathname, tab: 'leave' }}
          onClick={closeMenu}
        >
          Leave Summary
        </MuiMenuItem>
        <MuiMenuItem
          component={Link}
          to={activeRow ? `/directory/${activeRow.id}/employee-records` : '#'}
          state={{ ...location.state, from: location.pathname, tab: 'attendance' }}
          onClick={closeMenu}
        >
          Attendance Log
        </MuiMenuItem>
        {menuContext === 'onboarding' && (
          <MuiMenuItem
            disabled={!canModifyLeaveBalances(activeRow)}
            onClick={() => activeRow && handleOpenLeaveDialog(activeRow)}
          >
            Modify Leave Balances
          </MuiMenuItem>
        )}
        {menuContext === 'directory' && (
          activeRow?.status === 'INACTIVE' ? (
            <MuiMenuItem onClick={() => doActivate(activeRow)}>
              Activate Account
            </MuiMenuItem>
          ) : (
            // HODs do not have the power to deactivate any employee profile.
            !isHod && (
              <MuiMenuItem onClick={() => doDeactivate(activeRow)}>
                Deactivate
              </MuiMenuItem>
            )
          )
        )}
        {menuContext === 'directory' && activeRow?.status === 'INACTIVE' && !activeRow?.delete_requested && (
          <MuiMenuItem
            onClick={() => { closeMenu(); setDelReqDialog({ open: true, employee: activeRow }); }}
            sx={{ color: 'error.main' }}
          >
            Delete Request
          </MuiMenuItem>
        )}
        {menuContext === 'directory' && activeRow?.status === 'INACTIVE' && activeRow?.delete_requested && (
          <MuiMenuItem
            onClick={() => doWithdrawDeleteRequest(activeRow)}
            sx={{ color: 'warning.main' }}
          >
            Withdraw Request
          </MuiMenuItem>
        )}
      </Menu>

      {/* Delete Request confirm dialog */}
      <Dialog open={delReqDialog.open} onClose={() => setDelReqDialog({ open: false, employee: null })}>
        <DialogTitle>Submit Delete Request</DialogTitle>
        <DialogContent>
          <Typography>
            Submit a deletion request for <strong>{delReqDialog.employee?.first_name} {delReqDialog.employee?.last_name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This will flag the account for Admin/SuperAdmin review. The account will not be deleted immediately.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDelReqDialog({ open: false, employee: null })}>Cancel</Button>
          <Button variant="contained" color="error" onClick={doDeleteRequest}>Submit Request</Button>
        </DialogActions>
      </Dialog>

      {/* Official Communication dialog */}
      {canBulkCommunicate && (
        <OfficialCommunicationDialog
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          departments={departments}
        />
      )}

      {/* Leave Balance Edit Dialog */}
      <Dialog
        open={leaveDialog.open}
        onClose={() => !saveLoading && setLeaveDialog({ open: false, employee: null })}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' } } }}
      >
        <DialogTitle>Modify Leave Balances</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Updating balances for <strong>{leaveDialog.employee?.first_name} {leaveDialog.employee?.last_name}</strong>.
            {isHr && (
              <Typography variant="caption" display="block" color="warning.main">
                HR can edit only once and only on the activation day. Admin and SuperAdmin can edit later if needed.
              </Typography>
            )}
          </Typography>
          {balanceValidationError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Allocated balance cannot be lower than used plus pending days.
            </Alert>
          )}
          <TableContainer component={Paper} variant="outlined" sx={{ boxShadow: 'none', overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 620 }}>
              <TableHead sx={{ bgcolor: 'grey.50' }}>
                <TableRow>
                  <TableCell><b>Leave Type</b></TableCell>
                  <TableCell align="right"><b>Used</b></TableCell>
                  <TableCell align="right"><b>Pending</b></TableCell>
                  <TableCell align="right"><b>Available</b></TableCell>
                  <TableCell sx={{ width: 180 }}><b>Allocated</b></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {editingBalances.map((b, idx) => {
                  const used = Number(b.used || 0);
                  const pending = Number(b.pending || 0);
                  const totalAllocated = Number(b.total_allocated || 0);
                  const available = totalAllocated - used - pending;
                  const invalid = totalAllocated < used + pending;
                  return (
                    <TableRow key={b.id}>
                      <TableCell>{getLeaveTypeName(b.leave_type_id)}</TableCell>
                      <TableCell align="right">{used}</TableCell>
                      <TableCell align="right">{pending}</TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          label={available}
                          color={available >= 0 ? 'success' : 'error'}
                          variant={available >= 0 ? 'outlined' : 'filled'}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          type="number"
                          size="small"
                          fullWidth
                          value={b.total_allocated}
                          error={invalid}
                          inputProps={{ min: used + pending, step: 0.5 }}
                          onChange={(e) => {
                            const newBals = [...editingBalances];
                            newBals[idx] = {
                              ...newBals[idx],
                              total_allocated: e.target.value === '' ? '' : Number(e.target.value),
                            };
                            setEditingBalances(newBals);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {editingBalances.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      No leave balances found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaveDialog({ open: false, employee: null })} disabled={saveLoading}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveBalances} disabled={saveLoading || balanceValidationError || editingBalances.length === 0}>
            {saveLoading ? <CircularProgress size={24} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
