import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Tabs, Tab, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, IconButton, Tooltip, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, Alert, CircularProgress,
  Menu, MenuItem as MuiMenuItem, Grid, FormControl, InputLabel, Select,
  FormControlLabel, FormHelperText, Switch
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VerifiedIcon from '@mui/icons-material/Verified';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PasswordIcon from '@mui/icons-material/Password';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import SendIcon from '@mui/icons-material/Send';
import PersonIcon from '@mui/icons-material/Person';
import { Link } from 'react-router-dom';
import axios from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { formatDisplayDate, formatDisplayDateTime } from '../../utils/dateFormat';

const statusColor = { ACTIVE: 'success', INACTIVE: 'default', LOCKED: 'error' };
const roleColor = { SUPER_ADMIN: 'error', ADMIN: 'warning', HR: 'primary', HOD: 'secondary', EMPLOYEE: 'default' };
const initialAccountForm = {
  account_id: '',
  role: 'HR',
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  send_invitation: true,
};
const initialOtpState = {
  email: '',
  otp: '',
  otp_token: '',
  email_verification_token: '',
};
const initialAccountErrors = {};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const noWrapCellSx = { whiteSpace: 'nowrap' };
const employeeIdCellSx = { ...noWrapCellSx, minWidth: 92 };
const lastLoginCellSx = { ...noWrapCellSx, minWidth: 120 };
const emailCellSx = { ...noWrapCellSx, minWidth: 220 };

const sanitizeName = (value) => value.replace(/[^A-Za-z\s.'-]/g, '').replace(/\s+/g, ' ').slice(0, 100);
const sanitizePhone = (value) => value.replace(/\D/g, '').slice(0, 10);
const normalizeEmail = (value) => value.trim().toLowerCase();

const validateAccountField = (name, value) => {
  const trimmed = String(value || '').trim();
  if (name === 'first_name') {
    if (!trimmed) return 'First name is required.';
    if (trimmed.length < 2) return 'First name must be at least 2 characters.';
  }
  if (name === 'last_name') {
    if (!trimmed) return 'Last name is required.';
    if (trimmed.length < 2) return 'Last name must be at least 2 characters.';
  }
  if (name === 'phone') {
    if (!trimmed) return 'Phone number is required.';
    if (!/^\d{10}$/.test(trimmed)) return 'Phone number must be 10 digits.';
  }
  if (name === 'email') {
    if (!trimmed) return 'Email is required.';
    if (!emailPattern.test(trimmed)) return 'Enter a valid email address.';
  }
  if (name === 'account_id' && trimmed) {
    const accountId = Number(trimmed);
    if (accountId < 10001 || accountId > 10010) return 'Account ID must be between 10001 and 10010.';
  }
  return '';
};

function TabPanel({ children, value, index }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

export default function AccountManagement() {
  const { user } = useAuth();
  const [tab, setTab] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [lockedAccounts, setLockedAccounts] = useState([]);
  const [deleteRequests, setDeleteRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, action: null, account: null });
  const [anchorEl, setAnchorEl] = useState(null);
  const [activeAccount, setActiveAccount] = useState(null);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [addAccountStep, setAddAccountStep] = useState('email');
  const [otpState, setOtpState] = useState(initialOtpState);
  const [accountForm, setAccountForm] = useState(initialAccountForm);
  const [accountErrors, setAccountErrors] = useState(initialAccountErrors);
  const [accountDialogMsg, setAccountDialogMsg] = useState(null);
  const [accountCreating, setAccountCreating] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [createdAccount, setCreatedAccount] = useState(null);
  const [mailingCredentials, setMailingCredentials] = useState(false);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, locked, del] = await Promise.allSettled([
        axios.get('/api/employees/admin/accounts'),
        axios.get('/api/employees/admin/locked-list'),
        axios.get('/api/employees/admin/delete-requests')
      ]);
      if (acc.status === 'fulfilled') setAccounts(acc.value.data);
      if (locked.status === 'fulfilled') setLockedAccounts(locked.value.data);
      if (del.status === 'fulfilled') setDeleteRequests(del.value.data);
      
      // Surface any failures
      const failures = [acc, locked, del].filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.error('Some account data failed to load:', failures.map(f => f.reason));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleMenuOpen = (e, account) => {
    setAnchorEl(e.currentTarget);
    setActiveAccount(account);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setActiveAccount(null);
  };

  const handleAction = (action) => {
    const account = activeAccount;
    handleMenuClose();
    setConfirmDialog({ open: true, action, account });
  };

  const executeAction = async () => {
    const { action, account } = confirmDialog;
    setConfirmDialog({ open: false, action: null, account: null });
    try {
      if (action === 'unlock') await axios.post(`/api/employees/${account.id}/unlock`);
      else if (action === 'lock') await axios.post(`/api/employees/${account.id}/lock`);
      else if (action === 'delete') await axios.delete(`/api/employees/${account.id}/hard-delete`);
      else if (action === 'reset-pw') await axios.post(`/api/employees/${account.id}/reset-password-notify`);
      else if (action === 'revoke-delete') await axios.delete(`/api/employees/${account.id}/delete-request`);
      
      setMsg({ type: 'success', text: `Action '${action}' completed for ${account.first_name} ${account.last_name}.` });
      fetchAll();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.detail || 'Action failed.' });
    }
  };

  const resetAddAccountDialog = () => {
    setAddAccountOpen(false);
    setAddAccountStep('email');
    setOtpState(initialOtpState);
    setAccountForm(initialAccountForm);
    setAccountErrors(initialAccountErrors);
    setAccountDialogMsg(null);
    setCreatedAccount(null);
    setAccountCreating(false);
    setOtpSending(false);
    setOtpVerifying(false);
    setMailingCredentials(false);
  };

  const handleSendAccountOtp = async () => {
    const email = normalizeEmail(otpState.email);
    const emailError = validateAccountField('email', email);
    if (emailError) {
      setAccountErrors({ email: emailError });
      return;
    }
    setAccountDialogMsg(null);
    setAccountErrors(initialAccountErrors);
    setOtpSending(true);
    try {
      const response = await axios.post('/api/employees/admin/accounts/otp/send', { email }, { skipAuthLogout: true });
      setOtpState((prev) => ({
        ...prev,
        email: response.data.email || email,
        otp: '',
        otp_token: response.data.otp_token,
      }));
      setAccountForm((prev) => ({ ...prev, email: response.data.email || email }));
      setAddAccountStep('otp');
      setAccountDialogMsg({ type: 'success', text: response.data.message || 'OTP sent successfully.' });
    } catch (e) {
      setAccountDialogMsg({ type: 'error', text: e.response?.data?.detail || 'Could not send OTP.' });
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyAccountOtp = async () => {
    if (!/^\d{6}$/.test(otpState.otp)) {
      setAccountErrors({ otp: 'Enter the 6 digit OTP.' });
      return;
    }
    setAccountDialogMsg(null);
    setAccountErrors(initialAccountErrors);
    setOtpVerifying(true);
    try {
      const response = await axios.post(
        '/api/employees/admin/accounts/otp/verify',
        {
          email: otpState.email,
          otp: otpState.otp,
          otp_token: otpState.otp_token,
        },
        { skipAuthLogout: true }
      );
      setOtpState((prev) => ({
        ...prev,
        email: response.data.email,
        email_verification_token: response.data.email_verification_token,
      }));
      setAccountForm((prev) => ({ ...prev, email: response.data.email }));
      setAddAccountStep('details');
      setAccountDialogMsg({ type: 'success', text: response.data.message || 'Email verified.' });
    } catch (e) {
      setAccountDialogMsg({ type: 'error', text: e.response?.data?.detail || 'OTP verification failed.' });
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleAccountFieldChange = (field, value) => {
    let nextValue = value;
    if (field === 'first_name' || field === 'last_name') nextValue = sanitizeName(value);
    if (field === 'phone') nextValue = sanitizePhone(value);
    if (field === 'account_id') nextValue = value.replace(/\D/g, '').slice(0, 5);
    setAccountForm((prev) => ({ ...prev, [field]: nextValue }));
    setAccountErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validateAccountForm = () => {
    const errors = {
      account_id: validateAccountField('account_id', accountForm.account_id),
      first_name: validateAccountField('first_name', accountForm.first_name),
      last_name: validateAccountField('last_name', accountForm.last_name),
      phone: validateAccountField('phone', accountForm.phone),
      email: validateAccountField('email', accountForm.email),
    };
    const compactErrors = Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
    setAccountErrors(compactErrors);
    return Object.keys(compactErrors).length === 0;
  };

  const handleCreateAccount = async () => {
    setAccountDialogMsg(null);
    if (!validateAccountForm()) {
      setAccountDialogMsg({ type: 'error', text: 'Please fix the highlighted fields before creating the account.' });
      return;
    }
    setAccountCreating(true);
    try {
      const payload = {
        ...accountForm,
        account_id: accountForm.account_id ? Number(accountForm.account_id) : null,
        first_name: accountForm.first_name.trim(),
        last_name: accountForm.last_name.trim(),
        phone: accountForm.phone.trim() || null,
        email: normalizeEmail(accountForm.email),
        email_verification_token: otpState.email_verification_token,
      };
      const response = await axios.post('/api/employees/admin/accounts', payload, { skipAuthLogout: true });
      setCreatedAccount(response.data);
      setAddAccountStep('created');
      setAccountDialogMsg({ type: 'success', text: response.data.message || 'Account created successfully.' });
      fetchAll();
    } catch (e) {
      setAccountDialogMsg({ type: 'error', text: e.response?.data?.detail || 'Account creation failed.' });
    } finally {
      setAccountCreating(false);
    }
  };

  const handleMailCredentials = async () => {
    if (!createdAccount?.account?.id || !createdAccount?.temporary_password) return;
    setAccountDialogMsg(null);
    setMailingCredentials(true);
    try {
      await axios.post(
        `/api/employees/admin/accounts/${createdAccount.account.id}/send-credentials`,
        {
          temporary_password: createdAccount.temporary_password,
        },
        { skipAuthLogout: true }
      );
      setAccountDialogMsg({ type: 'success', text: 'Login credentials mailed successfully.' });
    } catch (e) {
      setAccountDialogMsg({ type: 'error', text: e.response?.data?.detail || 'Could not mail login credentials.' });
    } finally {
      setMailingCredentials(false);
    }
  };

  if (loading) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;

  const actionLabel = {
    unlock: { label: 'Unlock Account', color: 'success', msg: 'Are you sure you want to unlock this account?' },
    lock: { label: 'Lock Account', color: 'warning', msg: 'Are you sure you want to lock this account?' },
    delete: { label: 'Delete Account', color: 'error', msg: '⚠️ This will permanently delete the account. This cannot be undone.' },
    'reset-pw': { label: 'Reset Password', color: 'info', msg: 'Send password reset instructions via Email/SMS?' },
    'revoke-delete': { label: 'Revoke Delete Request', color: 'warning', msg: 'Are you sure you want to revoke this delete request?' },
  };

  const renderEmailStatus = (account) => (
    <Box display="flex" alignItems="center" gap={0.75} flexWrap="nowrap" sx={{ minWidth: 0 }}>
      <Typography variant="body2" component="span" noWrap sx={{ minWidth: 0 }}>
        {account.email || 'No Email'}
      </Typography>
      {account.email && (
        account.email_verified ? (
          <VerifiedIcon sx={{ fontSize: 18, color: '#2e7d32', flexShrink: 0 }} titleAccess="Email verified" />
        ) : (
          <MarkEmailUnreadIcon sx={{ fontSize: 18, color: '#ed6c02', flexShrink: 0 }} titleAccess="Email not verified" />
        )
      )}
    </Box>
  );

  const renderAccountRow = (account) => (
    <TableRow key={account.id} hover>
      <TableCell sx={employeeIdCellSx}>{account.employee_id}</TableCell>
      <TableCell sx={noWrapCellSx}><strong>{account.first_name} {account.last_name}</strong></TableCell>
      <TableCell sx={emailCellSx}>{renderEmailStatus(account)}</TableCell>
      <TableCell sx={noWrapCellSx}>
        <Chip 
          label={account.role?.replace('_', ' ')} 
          size="small" 
          color={roleColor[account.role] || 'default'} 
        />
      </TableCell>
      <TableCell sx={noWrapCellSx}>
        <Chip 
          label={account.status} 
          size="small" 
          color={statusColor[account.status] || 'default'} 
        />
      </TableCell>
      <TableCell sx={noWrapCellSx}>{account.failed_login_attempts ?? '—'}</TableCell>
      <TableCell sx={lastLoginCellSx}>
        {formatDisplayDate(account.last_login, 'N/A')}
      </TableCell>
      <TableCell sx={noWrapCellSx}>
        <IconButton size="small" aria-label={`Actions for ${account.first_name} ${account.last_name}`} onClick={(e) => handleMenuOpen(e, account)}>
          <MoreVertIcon />
        </IconButton>
      </TableCell>
    </TableRow>
  );

  return (
    <Box>
      <Box
        display="flex"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        gap={2}
        sx={{ mb: 1, flexDirection: { xs: 'column', sm: 'row' } }}
      >
        <Typography variant="h5" fontWeight="bold">🔐 Account Management</Typography>
        {isSuperAdmin && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setAddAccountOpen(true)}
            sx={{ width: { xs: '100%', sm: 'auto' }, flexShrink: 0 }}
          >
            Add Account
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 3 }}>
        Manage account statuses, unlock accounts, and handle deletion requests.
      </Typography>

      {msg && <Alert severity={msg.type} sx={{ mb: 3 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Paper sx={{ borderRadius: 3, overflow: 'hidden', boxShadow: 3 }}>
        <Tabs 
          value={tab} 
          onChange={(_, v) => setTab(v)} 
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}
        >
          <Tab label={`All Accounts (${accounts.length})`} />
          <Tab 
            label={
              <Box display="flex" alignItems="center" gap={1}>
                Locked Accounts ({lockedAccounts.length})
                {lockedAccounts.length > 0 && <Box sx={{ width: 8, height: 8, bgcolor: 'error.main', borderRadius: '50%' }} />}
              </Box>
            } 
          />
          <Tab label={`Delete Requests (${deleteRequests.length})`} />
        </Tabs>

        <TabPanel value={tab} index={0}>
          <Box sx={{ overflowX: 'auto', p: 1 }}>
            <Table size="small" sx={{ minWidth: 980 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell sx={employeeIdCellSx}><strong>Employee ID</strong></TableCell>
                  <TableCell sx={noWrapCellSx}><strong>Name</strong></TableCell>
                  <TableCell sx={emailCellSx}><strong>Email</strong></TableCell>
                  <TableCell sx={noWrapCellSx}><strong>Role</strong></TableCell>
                  <TableCell sx={noWrapCellSx}><strong>Status</strong></TableCell>
                  <TableCell sx={noWrapCellSx}><strong>Failed Attempts</strong></TableCell>
                  <TableCell sx={lastLoginCellSx}><strong>Last Login</strong></TableCell>
                  <TableCell sx={noWrapCellSx}><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {accounts.map(renderAccountRow)}
              </TableBody>
            </Table>
          </Box>
        </TabPanel>

        <TabPanel value={tab} index={1}>
          {lockedAccounts.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">No locked accounts found.</Typography>
            </Box>
          ) : (
            <Box sx={{ overflowX: 'auto', p: 1 }}>
              <Table size="small" sx={{ minWidth: 780 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: '#fff5f5' }}>
                    <TableCell sx={noWrapCellSx}><strong>Name</strong></TableCell>
                    <TableCell><strong>Reason</strong></TableCell>
                    <TableCell sx={lastLoginCellSx}><strong>Locked At</strong></TableCell>
                    <TableCell sx={emailCellSx}><strong>Contact</strong></TableCell>
                    <TableCell sx={noWrapCellSx}><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lockedAccounts.map(a => (
                    <TableRow key={a.id} hover>
                      <TableCell sx={noWrapCellSx}>
                        <Typography fontWeight="bold">{a.first_name} {a.last_name}</Typography>
                        <Typography variant="caption" color="text.secondary">#{a.employee_id}</Typography>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={0.5} color="error.main">
                          <ErrorOutlineIcon fontSize="small" />
                          <Typography variant="body2">{a.lock_reason}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={lastLoginCellSx}>{formatDisplayDateTime(a.locked_at, 'N/A')}</TableCell>
                      <TableCell sx={emailCellSx}>
                        {renderEmailStatus(a)}
                        <Typography variant="body2">{a.phone || 'No Phone'}</Typography>
                      </TableCell>
                      <TableCell sx={noWrapCellSx}>
                        <Box display="flex" gap={1} flexWrap="wrap">
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<PersonIcon />}
                            component={Link}
                            to={`/profile/${a.id}`}
                          >
                            Profile
                          </Button>
                          <Button
                            variant="outlined"
                            size="small"
                            color="success"
                            startIcon={<LockOpenIcon />}
                            onClick={() => setConfirmDialog({ open: true, action: 'unlock', account: a })}
                          >
                            Unlock
                          </Button>
                          {a.reset_pending ? (
                            <Chip 
                              label="PWD Reset Pending" 
                              size="small" 
                              color="info" 
                              variant="outlined"
                              icon={<PasswordIcon />}
                              sx={{ height: 32 }}
                            />
                          ) : (
                            <Button 
                              variant="outlined" 
                              size="small" 
                              startIcon={<PasswordIcon />}
                              onClick={() => setConfirmDialog({ open: true, action: 'reset-pw', account: a })}
                            >
                              Reset PWD
                            </Button>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </TabPanel>

        <TabPanel value={tab} index={2}>
          {deleteRequests.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">No pending deletion requests.</Typography>
            </Box>
          ) : (
            <Box sx={{ overflowX: 'auto', p: 1 }}>
              <Table size="small" sx={{ minWidth: 640 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell sx={employeeIdCellSx}><strong>Employee ID</strong></TableCell>
                    <TableCell sx={noWrapCellSx}><strong>Name</strong></TableCell>
                    <TableCell sx={noWrapCellSx}><strong>Role</strong></TableCell>
                    <TableCell sx={noWrapCellSx}><strong>Requested By</strong></TableCell>
                    <TableCell sx={noWrapCellSx}><strong>Actions</strong></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deleteRequests.map(a => (
                    <TableRow key={a.id} hover sx={{ bgcolor: '#fff3e0' }}>
                      <TableCell sx={employeeIdCellSx}>{a.employee_id}</TableCell>
                      <TableCell sx={noWrapCellSx}><strong>{a.first_name} {a.last_name}</strong></TableCell>
                      <TableCell sx={noWrapCellSx}><Chip label={a.role?.replace('_', ' ')} size="small" /></TableCell>
                      <TableCell sx={noWrapCellSx}>{a.delete_requested_by_name || 'Unknown'}</TableCell>
                      <TableCell sx={noWrapCellSx}>
                        <Box display="flex" gap={1} flexWrap="wrap">
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PersonIcon />}
                            component={Link}
                            to={`/profile/${a.id}`}
                          >
                            Profile
                          </Button>
                          <Button size="small" variant="outlined" color="warning"
                            onClick={() => setConfirmDialog({ open: true, action: 'revoke-delete', account: a })}>
                            Revoke
                          </Button>
                          {isSuperAdmin && (
                            <Button size="small" variant="contained" color="error"
                              onClick={() => setConfirmDialog({ open: true, action: 'delete', account: a })}>
                              Delete Permanently
                            </Button>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </TabPanel>
      </Paper>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MuiMenuItem
          component={Link}
          to={activeAccount ? `/profile/${activeAccount.id}` : '#'}
          onClick={handleMenuClose}
        >
          <PersonIcon fontSize="small" sx={{ mr: 1 }} /> Profile
        </MuiMenuItem>
        {activeAccount?.status === 'LOCKED' && (
          <MuiMenuItem onClick={() => handleAction('unlock')}>
            <LockOpenIcon fontSize="small" sx={{ mr: 1 }} /> Unlock Account
          </MuiMenuItem>
        )}
        {activeAccount?.status !== 'LOCKED' && activeAccount?.role !== 'SUPER_ADMIN' && (
          <MuiMenuItem onClick={() => handleAction('lock')}>
            <LockIcon fontSize="small" sx={{ mr: 1 }} /> Lock Account
          </MuiMenuItem>
        )}
        <MuiMenuItem onClick={() => handleAction('reset-pw')}>
          <PasswordIcon fontSize="small" sx={{ mr: 1 }} /> Reset Password
        </MuiMenuItem>
        {isSuperAdmin && activeAccount?.role !== 'SUPER_ADMIN' && (
          <MuiMenuItem onClick={() => handleAction('delete')} sx={{ color: 'error.main' }}>
            <DeleteForeverIcon fontSize="small" sx={{ mr: 1 }} /> Delete Account
          </MuiMenuItem>
        )}
      </Menu>

      <Dialog
        open={addAccountOpen}
        onClose={resetAddAccountDialog}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}
      >
        <DialogTitle>Add Account</DialogTitle>
        <DialogContent dividers>
          {accountDialogMsg && (
            <Alert severity={accountDialogMsg.type} sx={{ mb: 2 }} onClose={() => setAccountDialogMsg(null)}>
              {accountDialogMsg.text}
            </Alert>
          )}
          {addAccountStep === 'email' && (
            <Box sx={{ maxWidth: 380, mx: 'auto' }}>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 2 }}>
                Verify Email
              </Typography>
              <TextField
                label="Email ID"
                type="email"
                value={otpState.email}
                onChange={(e) => {
                  setOtpState({ ...otpState, email: e.target.value });
                  setAccountErrors((prev) => ({ ...prev, email: '' }));
                }}
                onBlur={() => setAccountErrors((prev) => ({ ...prev, email: validateAccountField('email', normalizeEmail(otpState.email)) }))}
                error={Boolean(accountErrors.email)}
                helperText={accountErrors.email || ' '}
                fullWidth
                required
              />
            </Box>
          )}

          {addAccountStep === 'otp' && (
            <Box sx={{ maxWidth: 300, mx: 'auto' }}>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>
                Enter OTP
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                OTP sent to {otpState.email}.
              </Typography>
              <TextField
                label="OTP"
                value={otpState.otp}
                onChange={(e) => {
                  setOtpState({ ...otpState, otp: e.target.value.replace(/\D/g, '').slice(0, 6) });
                  setAccountErrors((prev) => ({ ...prev, otp: '' }));
                }}
                error={Boolean(accountErrors.otp)}
                helperText={accountErrors.otp || ' '}
                inputProps={{ inputMode: 'numeric', maxLength: 6 }}
                fullWidth
                required
              />
            </Box>
          )}

          {addAccountStep === 'details' && (
            <Box>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 2 }}>
                Account Information
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  columnGap: 2,
                  rowGap: 2,
                  alignItems: 'start',
                }}
              >
              <Box>
                <TextField
                  label="Account ID"
                  value={accountForm.account_id}
                  onChange={(e) => handleAccountFieldChange('account_id', e.target.value)}
                  onBlur={() => setAccountErrors((prev) => ({ ...prev, account_id: validateAccountField('account_id', accountForm.account_id) }))}
                  error={Boolean(accountErrors.account_id)}
                  helperText={accountErrors.account_id || 'Optional. Reserved range: 10001-10010.'}
                  fullWidth
                  inputProps={{ inputMode: 'numeric', min: 10001, max: 10010 }}
                />
              </Box>
              <Box>
                <FormControl fullWidth>
                  <InputLabel>Role</InputLabel>
                  <Select
                    label="Role"
                    value={accountForm.role}
                    onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value })}
                  >
                    <MuiMenuItem value="HR">HR</MuiMenuItem>
                    <MuiMenuItem value="ADMIN">Admin</MuiMenuItem>
                  </Select>
                  <FormHelperText>&nbsp;</FormHelperText>
                </FormControl>
              </Box>
              <Box>
                <TextField
                  label="First Name"
                  value={accountForm.first_name}
                  onChange={(e) => handleAccountFieldChange('first_name', e.target.value)}
                  onBlur={() => setAccountErrors((prev) => ({ ...prev, first_name: validateAccountField('first_name', accountForm.first_name) }))}
                  error={Boolean(accountErrors.first_name)}
                  helperText={accountErrors.first_name || ' '}
                  fullWidth
                  required
                />
              </Box>
              <Box>
                <TextField
                  label="Last Name"
                  value={accountForm.last_name}
                  onChange={(e) => handleAccountFieldChange('last_name', e.target.value)}
                  onBlur={() => setAccountErrors((prev) => ({ ...prev, last_name: validateAccountField('last_name', accountForm.last_name) }))}
                  error={Boolean(accountErrors.last_name)}
                  helperText={accountErrors.last_name || ' '}
                  fullWidth
                  required
                />
              </Box>
              <Box>
                <TextField
                  label="Phone"
                  value={accountForm.phone}
                  onChange={(e) => handleAccountFieldChange('phone', e.target.value)}
                  onBlur={() => setAccountErrors((prev) => ({ ...prev, phone: validateAccountField('phone', accountForm.phone) }))}
                  error={Boolean(accountErrors.phone)}
                  helperText={accountErrors.phone || ' '}
                  inputProps={{ inputMode: 'numeric', maxLength: 10 }}
                  fullWidth
                  required
                />
              </Box>
              <Box>
                <TextField
                  label="Email ID"
                  type="email"
                  value={accountForm.email}
                  disabled
                  fullWidth
                  required
                />
              </Box>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={accountForm.send_invitation}
                      onChange={(e) => setAccountForm({ ...accountForm, send_invitation: e.target.checked })}
                    />
                  }
                  label="Send activation invitation"
                />
              </Box>
              </Box>
            </Box>
          )}

          {addAccountStep === 'created' && createdAccount && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Account created for <strong>{createdAccount.account.first_name} {createdAccount.account.last_name}</strong>.
            </Alert>
          )}
          {addAccountStep === 'created' && createdAccount && (
            <Box sx={{ mt: 2, p: 2, borderRadius: 2, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2">Account ID</Typography>
              <Typography variant="h6" sx={{ mb: 1 }}>{createdAccount.account.employee_id}</Typography>
              <Typography variant="body2">One-time password</Typography>
              <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>{createdAccount.temporary_password}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, px: 3, py: 2, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, ml: { xs: '0 !important', sm: 1 } } }}>
          <Button onClick={resetAddAccountDialog}>Close</Button>
          {addAccountStep === 'email' && (
            <Button
              variant="contained"
              onClick={handleSendAccountOtp}
              disabled={otpSending || !otpState.email.trim()}
            >
              {otpSending ? 'Sending...' : 'Send OTP'}
            </Button>
          )}
          {addAccountStep === 'otp' && (
            <>
              <Button onClick={() => setAddAccountStep('email')} disabled={otpVerifying}>
                Back
              </Button>
              <Button
                variant="contained"
                onClick={handleVerifyAccountOtp}
                disabled={otpVerifying || otpState.otp.length !== 6}
              >
                {otpVerifying ? 'Verifying...' : 'Verify OTP'}
              </Button>
            </>
          )}
          {addAccountStep === 'details' && (
            <Button
              variant="contained"
              onClick={handleCreateAccount}
              disabled={accountCreating || !otpState.email_verification_token}
            >
              {accountCreating ? 'Creating...' : 'Create Account'}
            </Button>
          )}
          {addAccountStep === 'created' && (
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              onClick={handleMailCredentials}
              disabled={mailingCredentials}
            >
              {mailingCredentials ? 'Sending...' : 'Mail Login Details'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ open: false, action: null, account: null })}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}
      >
        <DialogTitle>{actionLabel[confirmDialog.action]?.label}</DialogTitle>
        <DialogContent>
          <Typography>{actionLabel[confirmDialog.action]?.msg}</Typography>
          {confirmDialog.account && (
            <Typography sx={{ mt: 1 }} color="text.secondary">
              Account: <strong>{confirmDialog.account?.first_name} {confirmDialog.account?.last_name}</strong> (#{confirmDialog.account?.employee_id})
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, px: 3, pb: 3, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, ml: { xs: '0 !important', sm: 1 } } }}>
          <Button onClick={() => setConfirmDialog({ open: false, action: null, account: null })}>Cancel</Button>
          <Button variant="contained" color={actionLabel[confirmDialog.action]?.color} onClick={executeAction}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
