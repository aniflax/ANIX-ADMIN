import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Chip,
  Button,
  TextField,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import api from '../../api/axios';
import { formatDisplayDate, formatDisplayDateTime, getIsoDate } from '../../utils/dateFormat';
import { getTargetDefaultForSwap } from '../../utils/weekOff';
import { notifyCooldownRemainingMs, formatRelativeFromNow } from './leaveNotify';

const HALF_DAY_PERIOD_LABELS = {
  FIRST_HALF: 'First Half',
  SECOND_HALF: 'Second Half',
};

const STATUS_COLOR = {
  APPROVED: 'success',
  HOD_APPROVED: 'info',
  PENDING: 'warning',
  REJECTED: 'error',
  CANCELLED: 'default',
};

function isWeekOffRequest(request) {
  return (request?.leave_type_name || '').toLowerCase() === 'week off';
}

function resolveStatusLabel(request) {
  if (!request) return '';
  if (request.status === 'CANCELLED') return 'Cancelled';
  if (request.status === 'REJECTED') return 'Rejected';
  if (request.status === 'PENDING') {
    return request.hod_skipped ? 'Awaiting HR' : 'Awaiting HoD';
  }
  if (request.status === 'HOD_APPROVED') return 'Awaiting HR';
  if (request.status === 'APPROVED') {
    return request.hod_skipped ? 'Final Approved' : 'Approved';
  }
  return request.status;
}

function Field({ label, value, sx }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, ...sx }}>
      <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
        {value ?? '—'}
      </Typography>
    </Box>
  );
}

export default function LeaveRequestDetailDialog({
  open,
  onClose,
  request,
  viewer = 'EMPLOYEE',
  employees = [],
  departments = [],
  defaultWeekOff,
  onActionComplete,
  readOnly: readOnlyProp = false,
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const safeRequest = request || {};

  const employee = useMemo(
    () => employees.find((s) => s.id === safeRequest.employee_id),
    [employees, safeRequest.employee_id],
  );
  const department = useMemo(() => {
    if (employee?.department_id) {
      return departments.find((d) => d.id === employee.department_id);
    }
    return null;
  }, [departments, employee]);

  const approverHod = useMemo(
    () => employees.find((s) => s.id === safeRequest.approver_hod_id),
    [employees, safeRequest.approver_hod_id],
  );
  const approverHr = useMemo(
    () => employees.find((s) => s.id === safeRequest.approver_hr_id),
    [employees, safeRequest.approver_hr_id],
  );

  const isWeekOff = isWeekOffRequest(safeRequest);
  const swapDateStr = getIsoDate(safeRequest.start_date);
  const replacedDefaultStr = useMemo(() => {
    if (!isWeekOff || !swapDateStr) return null;
    return getTargetDefaultForSwap(swapDateStr, defaultWeekOff);
  }, [isWeekOff, swapDateStr, defaultWeekOff]);

  const statusLabel = request ? resolveStatusLabel(request) : '';
  const statusColor = STATUS_COLOR[safeRequest.status] || 'default';

  const readOnly = readOnlyProp
    || !request
    || viewer === 'EMPLOYEE'
    || safeRequest.status === 'CANCELLED'
    || safeRequest.status === 'REJECTED'
    || safeRequest.status === 'APPROVED';

  const canApprove = useMemo(() => {
    const status = safeRequest.status;
    if (status === 'CANCELLED' || status === 'REJECTED' || status === 'APPROVED') return false;
    if (status === 'PENDING') {
      // PENDING requests are normally approved by the HOD. HR/Admin/SuperAdmin
      // can also approve PENDING on behalf of the HOD (admin override or
      // delegated approval), but plain HR cannot jump ahead of the HOD.
      return viewer === 'HOD' || viewer === 'ADMIN' || viewer === 'SUPER_ADMIN';
    }
    if (status === 'HOD_APPROVED') {
      return viewer === 'HR' || viewer === 'ADMIN' || viewer === 'SUPER_ADMIN';
    }
    return false;
  }, [viewer, safeRequest.status]);

  const canNotify = useMemo(() => {
    const status = safeRequest.status;
    if (status !== 'PENDING' && status !== 'HOD_APPROVED') return false;
    if (viewer === 'HOD' && status === 'PENDING' && !safeRequest.hod_skipped) return false;
    if (viewer === 'HR' && status === 'PENDING' && !safeRequest.hod_skipped) return true;
    if ((viewer === 'HOD' || viewer === 'ADMIN' || viewer === 'SUPER_ADMIN') && status === 'HOD_APPROVED') return true;
    if (viewer === 'HR' && status === 'HOD_APPROVED') return false;
    if ((viewer === 'ADMIN' || viewer === 'SUPER_ADMIN') && status === 'PENDING') return true;
    return false;
  }, [viewer, safeRequest.status, safeRequest.hod_skipped]);

  const notifyTargetRole = useMemo(() => {
    const status = safeRequest.status;
    if (status === 'PENDING') return 'HOD';
    if (status === 'HOD_APPROVED') return 'HR';
    return null;
  }, [safeRequest.status]);

  const isOnCooldown = notifyCooldownRemainingMs(safeRequest) > 0;
  const lastNotifiedLabel = safeRequest.last_notified_at
    ? formatRelativeFromNow(safeRequest.last_notified_at)
    : null;

  if (!request) {
    return null;
  }

  const refresh = () => {
    if (onActionComplete) onActionComplete(request);
  };

  const handleApprove = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.post(`/api/leave/action/${request.id}`, { action: 'APPROVE' });
      setSuccess('Leave request approved.');
      refresh();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to approve.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError('Rejection reason is required.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.post(`/api/leave/action/${request.id}`, {
        action: 'REJECT',
        rejection_reason: rejectReason.trim(),
      });
      setRejectOpen(false);
      setRejectReason('');
      setSuccess('Leave request rejected.');
      refresh();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reject.');
    } finally {
      setBusy(false);
    }
  };

  const handleNotify = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post(`/api/leave/notify/${request.id}`);
      setSuccess(res.data?.message || 'Notification sent.');
      refresh();
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to send notification.';
      setError(detail);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.post(`/api/leave/cancel/${request.id}?comment=${encodeURIComponent('Cancelled by user')}`);
      setSuccess('Leave request cancelled.');
      refresh();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to cancel.');
    } finally {
      setBusy(false);
    }
  };

  const showActionButtons = !readOnly && (canApprove || canNotify);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6" fontWeight="bold">Leave Request Details</Typography>
          <Chip label={statusLabel} color={statusColor} size="small" />
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 2 }}>
          <Field
            label="Employee"
            value={employee ? `${employee.first_name} ${employee.last_name}` : 'Unknown'}
          />
          <Field
            label="Employee ID"
            value={employee?.employee_id != null ? `#${employee.employee_id}` : '—'}
          />
          <Field
            label="Department"
            value={department?.name || (employee?.department_id ? 'Unassigned' : 'Unassigned')}
          />
          <Field
            label="Leave Type"
            value={request.leave_type_name || '—'}
          />
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {isWeekOff ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 2 }}>
            <Field
              label="Original Week-Off Date"
              value={formatDisplayDate(replacedDefaultStr)}
            />
            <Field
              label="Swap Date (Requested Week-Off)"
              value={formatDisplayDate(swapDateStr)}
            />
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
            <Field
              label="Start Date"
              value={formatDisplayDate(request.start_date)}
            />
            <Field
              label="End Date"
              value={formatDisplayDate(request.end_date)}
            />
            <Field
              label="Days"
              value={
                request.is_half_day
                  ? `0.5 (${HALF_DAY_PERIOD_LABELS[request.half_day_period] || 'Half Day'})`
                  : request.total_days
              }
            />
          </Box>
        )}

        <Field
          label="Reason"
          value={request.reason}
          sx={{ mb: 2 }}
        />

        {request.status === 'REJECTED' && request.rejection_reason && (
          <Field
            label="Rejection Reason"
            value={request.rejection_reason}
            sx={{ mb: 2 }}
          />
        )}
        {request.status === 'CANCELLED' && request.cancel_comment && (
          <Field
            label="Cancel Comment"
            value={request.cancel_comment}
            sx={{ mb: 2 }}
          />
        )}

        <Divider sx={{ my: 1.5 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 1 }}>
          <Field
            label="Created"
            value={formatDisplayDateTime(request.created_at)}
          />
          <Field
            label="Last Updated"
            value={formatDisplayDateTime(request.updated_at)}
          />
          {!request.hod_skipped && (
            <Field
              label="HOD Approver"
              value={approverHod ? `${approverHod.first_name} ${approverHod.last_name}` : '—'}
            />
          )}
          <Field
            label="HR Approver"
            value={approverHr ? `${approverHr.first_name} ${approverHr.last_name}` : '—'}
          />
        </Box>

        {request.hod_skipped && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            HOD step was skipped (applicant is HOD, has no department, or department HOD is on leave).
          </Typography>
        )}

        {request.last_notified_at && (
          <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'rgba(244, 124, 32, 0.08)', border: '1px solid', borderColor: 'warning.light' }}>
            <Typography variant="body2">
              <b>Last notified:</b> {formatDisplayDateTime(request.last_notified_at)}
              {lastNotifiedLabel && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  ({lastNotifiedLabel})
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total notifications sent: {request.notify_count || 0}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1, px: 3, pb: 2.5, alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {viewer === 'EMPLOYEE' && request.employee_id && (request.status === 'PENDING' || request.status === 'HOD_APPROVED') && (
            <Button color="error" variant="outlined" onClick={handleCancel} disabled={busy}>
              Cancel Request
            </Button>
          )}
        </Box>
        <Button onClick={onClose} disabled={busy}>Close</Button>

        {showActionButtons && canApprove && (
          <>
            <Button color="error" variant="outlined" onClick={() => setRejectOpen(true)} disabled={busy}>
              Reject
            </Button>
            <Button color="success" variant="contained" onClick={handleApprove} disabled={busy}>
              {busy ? <CircularProgress size={18} /> : 'Approve'}
            </Button>
          </>
        )}
        {showActionButtons && canNotify && (
          <Button
            color="warning"
            variant="contained"
            onClick={handleNotify}
            disabled={busy || isOnCooldown}
          >
            {busy ? <CircularProgress size={18} /> : `Notify ${notifyTargetRole}`}
          </Button>
        )}
      </DialogActions>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reject Leave Request</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            label="Rejection Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleReject} disabled={busy}>
            Confirm Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
