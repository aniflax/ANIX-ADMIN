import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  TextField,
  RadioGroup,
  FormControlLabel,
  Radio,
  FormControl,
  FormLabel,
  Chip,
  Autocomplete,
  Alert,
  Stack,
  Divider,
  CircularProgress,
  Tooltip,
  IconButton,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../api/axios';

const ROLES = [
  { value: 'SEVAK', label: 'Sevak' },
  { value: 'HOD', label: 'HOD' },
  { value: 'HR', label: 'HR' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
];

const ROLE_LABEL = ROLES.reduce((acc, r) => { acc[r.value] = r.label; return acc; }, {});

const DEBOUNCE_MS = 350;
const DEFAULT_SUBJECT = 'Official Communication from anix HRMS';

export default function OfficialCommunicationDialog({ open, onClose, departments = [] }) {
  const [mode, setMode] = useState('all');
  const [departmentId, setDepartmentId] = useState(null);
  const [roles, setRoles] = useState([]);
  const [excludeIds, setExcludeIds] = useState([]);
  const [includeIds, setIncludeIds] = useState([]); // Custom mode only

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [previewCount, setPreviewCount] = useState(0);
  const [previewSample, setPreviewSample] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  // Full pool of active accounts with email (all roles) used for the
  // Exclude/Include pickers so HR/Admin/SA are also selectable.
  const [allAccounts, setAllAccounts] = useState([]);

  // When the form dialog closes after a successful send, we surface the
  // delivery summary in a separate acknowledgement dialog.
  const [ack, setAck] = useState(null); // null when closed, or {total, sent, ...} when open

  // Always read the freshest selection from this ref to keep the preview
  // effect's dependency array stable and avoid render loops.
  const selectionRef = useRef({ mode, departmentId, roles, includeIds, excludeIds });
  selectionRef.current = { mode, departmentId, roles, includeIds, excludeIds };

  // Reset everything when the form opens or closes (but not when the
  // acknowledgement dialog is up — that's a separate dialog).
  useEffect(() => {
    if (!open) return;
    setMode('all');
    setDepartmentId(null);
    setRoles([]);
    setExcludeIds([]);
    setIncludeIds([]);
    setSubject('');
    setMessage('');
    setPreviewCount(0);
    setPreviewSample([]);
    setPreviewLoading(false);
    setPreviewError('');
    setSending(false);
    setSendError('');
    api.get('/api/communications/accounts')
      .then((res) => setAllAccounts(Array.isArray(res.data) ? res.data : []))
      .catch(() => setAllAccounts([]));
  }, [open]);

  const fetchPreview = useCallback(async (selection) => {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await api.post('/api/communications/bulk/preview', {
        mode: selection.mode,
        department_id: selection.departmentId,
        roles: selection.roles,
        include_ids: selection.includeIds,
        exclude_ids: selection.excludeIds,
      });
      setPreviewCount(res.data?.count || 0);
      setPreviewSample(res.data?.sample || []);
    } catch (err) {
      setPreviewError(err.response?.data?.detail || 'Failed to resolve recipients.');
      setPreviewCount(0);
      setPreviewSample([]);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (mode === 'department' && !departmentId) {
      setPreviewCount(0);
      setPreviewSample([]);
      return;
    }
    if (mode === 'role' && (!roles || roles.length === 0)) {
      setPreviewCount(0);
      setPreviewSample([]);
      return;
    }
    // Debounce + read current selection from a ref to keep deps stable.
    const handle = setTimeout(() => {
      fetchPreview(selectionRef.current);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, departmentId, roles, includeIds, excludeIds]);

  const handleSend = async () => {
    if (!message.trim()) {
      setSendError('Message is required.');
      return;
    }
    if (previewCount === 0) {
      setSendError('No recipients to send to. Adjust your selection.');
      return;
    }
    setSending(true);
    setSendError('');
    try {
      const res = await api.post('/api/communications/bulk', {
        mode,
        department_id: departmentId,
        roles,
        include_ids: includeIds,
        exclude_ids: excludeIds,
        subject: subject.trim() || DEFAULT_SUBJECT,
        message: message.trim(),
      });
      // Close the form and surface a separate acknowledgement dialog
      // with the delivery summary.
      onClose();
      setAck(res.data);
    } catch (err) {
      setSendError(err.response?.data?.detail || 'Failed to send official communication.');
    } finally {
      setSending(false);
    }
  };

  const handleCloseAck = () => {
    setAck(null);
  };

  const departmentOptions = useMemo(
    () => departments.map((d) => ({ id: d.id, name: d.name })),
    [departments],
  );

  const accountOptions = useMemo(
    () => allAccounts.map((s) => ({
      id: s.id,
      sevak_id: s.sevak_id,
      first_name: s.first_name,
      last_name: s.last_name,
      email: s.email,
      role: s.role,
      department_id: s.department_id,
    })),
    [allAccounts],
  );

  const formatAccountLabel = (o) => o
    ? `${o.first_name} ${o.last_name} (#${o.sevak_id}) — ${ROLE_LABEL[o.role] || o.role}`
    : '';

  return (
    <>
      <Dialog
        open={open}
        onClose={() => !sending && onClose()}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6" fontWeight="bold">Official Communication</Typography>
            <Typography variant="body2" color="text.secondary">
              Send an official email to one or more accounts.
            </Typography>
          </Box>
          <IconButton onClick={() => !sending && onClose()} disabled={sending} aria-label="close">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ pt: 2 }}>
          {sendError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSendError('')}>{sendError}</Alert>}

          {/* Recipients */}
          <FormControl component="fieldset" sx={{ mb: 2 }}>
            <FormLabel component="legend" sx={{ fontWeight: 700, color: 'text.primary' }}>Recipients</FormLabel>
            <RadioGroup
              row
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <FormControlLabel value="all" control={<Radio />} label="All Accounts" />
              <FormControlLabel value="department" control={<Radio />} label="By Department" />
              <FormControlLabel value="role" control={<Radio />} label="By Role" />
              <FormControlLabel value="custom" control={<Radio />} label="Custom" />
            </RadioGroup>
          </FormControl>

          {mode === 'department' && (
            <Autocomplete
              sx={{ mb: 2 }}
              options={departmentOptions}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              value={departmentOptions.find((d) => d.id === departmentId) || null}
              onChange={(_, v) => setDepartmentId(v?.id || null)}
              renderInput={(params) => <TextField {...params} label="Department" required />}
            />
          )}

          {mode === 'role' && (
            <Autocomplete
              sx={{ mb: 2 }}
              multiple
              options={ROLES}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(o, v) => o.value === v.value}
              value={ROLES.filter((r) => roles.includes(r.value))}
              onChange={(_, v) => setRoles(v.map((r) => r.value))}
              renderInput={(params) => <TextField {...params} label="Roles" required={roles.length === 0} />}
              renderTags={(value, getTagProps) => value.map((option, index) => (
                <Chip {...getTagProps({ index })} key={option.value} label={option.label} size="small" />
              ))}
            />
          )}

          {mode === 'custom' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
              <Autocomplete
                multiple
                options={accountOptions}
                getOptionLabel={formatAccountLabel}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={accountOptions.filter((s) => includeIds.includes(s.id))}
                onChange={(_, v) => setIncludeIds(v.map((s) => s.id))}
                renderInput={(params) => <TextField {...params} label="Include (restrict to these accounts)" helperText="Leave empty to start from all accounts" />}
                renderTags={(value, getTagProps) => value.map((option, index) => (
                  <Chip {...getTagProps({ index })} key={option.id} label={`${option.first_name} ${option.last_name}`} size="small" />
                ))}
              />
            </Box>
          )}

          {/* Exclude — visible in all modes */}
          <Autocomplete
            multiple
            sx={{ mb: 2 }}
            options={accountOptions}
            getOptionLabel={formatAccountLabel}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            value={accountOptions.filter((s) => excludeIds.includes(s.id))}
            onChange={(_, v) => setExcludeIds(v.map((s) => s.id))}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Exclude accounts"
                helperText="Accounts selected here will be removed from the recipient list. Includes Sevaks, HODs, HR, Admin, and Super Admin."
              />
            )}
            renderTags={(value, getTagProps) => value.map((option, index) => (
              <Chip {...getTagProps({ index })} key={option.id} label={`${option.first_name} ${option.last_name}`} size="small" />
            ))}
          />

          {/* Live preview */}
          <Box sx={{
            p: 1.5, borderRadius: 2, bgcolor: 'rgba(244, 124, 32, 0.06)', border: '1px solid',
            borderColor: previewCount === 0 ? 'warning.light' : 'success.light', mb: 3,
            // Fixed minHeight + reserved chip slot prevents the form below
            // from jumping while the preview count is loading / resolving.
            minHeight: 72,
          }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'nowrap' }}>
              <Box sx={{ width: 120, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                {previewLoading ? (
                  <CircularProgress size={18} />
                ) : (
                  <Chip
                    size="small"
                    color={previewCount > 0 ? 'success' : 'warning'}
                    label={previewCount === 0 ? '0 recipients' : `${previewCount} recipient${previewCount === 1 ? '' : 's'}`}
                    sx={{ width: '100%', justifyContent: 'center' }}
                  />
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {previewError ? previewError : 'Live count of accounts this message will be sent to.'}
              </Typography>
            </Stack>
            {previewSample.length > 0 && (
              <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {previewSample.map((s) => (
                  <Chip
                    key={s.id}
                    size="small"
                    variant="outlined"
                    label={`${s.first_name} ${s.last_name} (#${s.sevak_id}) — ${ROLE_LABEL[s.role] || s.role}`}
                  />
                ))}
                {previewCount > previewSample.length && (
                  <Chip size="small" variant="outlined" label={`+${previewCount - previewSample.length} more`} />
                )}
              </Box>
            )}
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Message */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <FormLabel sx={{ fontWeight: 700, color: 'text.primary' }}>Message</FormLabel>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            label="Subject (optional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            sx={{ mb: 2 }}
            helperText={`Defaults to "${DEFAULT_SUBJECT}" when left empty.`}
          />
          <TextField
            fullWidth
            multiline
            rows={6}
            required
            label="Message body"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            helperText="This message will be emailed to the resolved recipients."
          />
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} disabled={sending}>Close</Button>
          <Tooltip title={previewCount === 0 ? 'Select at least one recipient' : ''} arrow>
            <span>
              <Button
                variant="contained"
                onClick={handleSend}
                disabled={sending || previewCount === 0 || !message.trim()}
              >
                {sending ? <CircularProgress size={18} /> : `Send to ${previewCount || 0}`}
              </Button>
            </span>
          </Tooltip>
        </DialogActions>
      </Dialog>

      {/* Acknowledgement dialog — shown after a successful send */}
      <Dialog
        open={!!ack}
        onClose={handleCloseAck}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleIcon color="success" />
          <Typography variant="h6" fontWeight="bold">Communication Sent</Typography>
        </DialogTitle>
        <DialogContent dividers>
          {ack && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Your official communication was dispatched successfully.
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <b>Total recipients:</b> {ack.total}
                </Typography>
                <Typography variant="body2" color="success.main">
                  <b>Sent:</b> {ack.sent}
                </Typography>
                {ack.failed > 0 && (
                  <Typography variant="body2" color="error.main">
                    <b>Failed:</b> {ack.failed}
                  </Typography>
                )}
                {ack.skipped_no_email > 0 && (
                  <Typography variant="body2" color="warning.main">
                    <b>Skipped (no email):</b> {ack.skipped_no_email}
                  </Typography>
                )}
                {ack.subject && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    <b>Subject:</b> {ack.subject}
                  </Typography>
                )}
              </Stack>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={handleCloseAck}>OK</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
