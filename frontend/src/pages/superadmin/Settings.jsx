import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Grid, TextField, Button, Alert, CircularProgress,
  Card, CardContent, Divider, Chip, Switch, IconButton, InputAdornment
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import NotificationsIcon from '@mui/icons-material/Notifications';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { formatDisplayDate } from '../../utils/dateFormat';

export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [configs, setConfigs] = useState([]);
  const [configDrafts, setConfigDrafts] = useState({});
  const [editingConfigKey, setEditingConfigKey] = useState('');
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [geoThreshold, setGeoThreshold] = useState('');
  const [draftGeoThreshold, setDraftGeoThreshold] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDeadlineTime, setReminderDeadlineTime] = useState('10:30 AM IST');
  const [reminderOfficialEmail, setReminderOfficialEmail] = useState('');
  const [reminderLastSentDate, setReminderLastSentDate] = useState('');
  const [mailConfig, setMailConfig] = useState({
    official_email: '',
    smtp_server: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    from_name: 'anix HRMS',
    from_email: '',
    password_reset_link_validity_minutes: 10,
    smtp_password_set: false,
  });
  const [mailTestRecipient, setMailTestRecipient] = useState('');
  const [mailSaving, setMailSaving] = useState(false);
  const [editingGeo, setEditingGeo] = useState(false);
  const [weekOffCancelling, setWeekOffCancelling] = useState(false);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isHrOrAdmin = user?.role === 'HR' || isSuperAdmin;
  const officialEmailConfig = configs.find((config) => config.key === 'OFFICIAL_COMMUNICATION_EMAIL');
  const officialEmailValue = officialEmailConfig?.value || 'no-reply@anix-hrms.example';

  useEffect(() => {
    fetchConfigs();
    if (isSuperAdmin) {
      fetchReminderStatus();
      fetchMailConfig();
    }
  }, [isSuperAdmin]);

  const fetchConfigs = async () => {
    try {
      const res = await api.get('/api/config/');
      setConfigs(res.data);
      setConfigDrafts(
        res.data.reduce((acc, config) => {
          acc[config.key] = config.value;
          return acc;
        }, {})
      );
      const geoConfig = res.data.find(c => c.key === 'GEO_THRESHOLD_METERS');
      if (geoConfig) {
        setGeoThreshold(geoConfig.value);
        setDraftGeoThreshold(geoConfig.value);
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: 'Failed to load configurations', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchReminderStatus = async () => {
    try {
      const res = await api.get('/api/attendance/reminder/status');
      setReminderEnabled(res.data.enabled);
      setReminderDeadlineTime(res.data.deadline_time || '10:30 AM IST');
      setReminderOfficialEmail(res.data.official_email || '');
      setReminderLastSentDate(res.data.last_sent_date || '');
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMailConfig = async () => {
    try {
      const res = await api.get('/api/config/mail');
      setMailConfig({
        official_email: res.data.official_email || '',
        smtp_server: res.data.smtp_server || '',
        smtp_port: res.data.smtp_port || 587,
        smtp_user: res.data.smtp_user || '',
        smtp_password: '',
        from_name: res.data.from_name || 'anix HRMS',
        from_email: res.data.from_email || '',
        password_reset_link_validity_minutes: res.data.password_reset_link_validity_minutes || 10,
        smtp_password_set: !!res.data.smtp_password_set,
      });
      setMailTestRecipient(res.data.official_email || '');
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveGeo = async () => {
    if (!draftGeoThreshold || isNaN(draftGeoThreshold) || Number(draftGeoThreshold) < 10) {
      setMessage({ text: 'Geo threshold must be at least 10 meters', type: 'error' });
      return;
    }
    setSaving(true);
    setMessage({ text: '', type: '' });
    try {
      await api.put('/api/config/update', {
        key: 'GEO_THRESHOLD_METERS',
        value: draftGeoThreshold
      });
      setGeoThreshold(draftGeoThreshold);
      setEditingGeo(false);
      setMessage({ text: 'Geo threshold updated successfully!', type: 'success' });
      fetchConfigs();
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to update', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleReminder = async () => {
    try {
      const newValue = !reminderEnabled;
      await api.post('/api/attendance/reminder/toggle', { enabled: newValue });
      setReminderEnabled(newValue);
      await fetchReminderStatus();
      setMessage({ text: `Attendance reminder ${newValue ? 'enabled' : 'disabled'}!`, type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to toggle reminder', type: 'error' });
    }
  };

  const handleSendReminderNow = async () => {
    setSaving(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.post('/api/attendance/reminder/send-now');
      setMessage({
        text: `Reminder processed. Sent: ${res.data.sent || 0}, skipped: ${res.data.skipped || 0}, failed: ${res.data.failed || 0}.`,
        type: res.data.failed > 0 ? 'warning' : 'success',
      });
      await fetchReminderStatus();
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to send reminder', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleConfigDraftChange = (key, value) => {
    setConfigDrafts((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleStartConfigEdit = (key, value) => {
    setEditingConfigKey(key);
    handleConfigDraftChange(key, value);
    setMessage({ text: '', type: '' });
  };

  const handleCancelConfigEdit = (key, value) => {
    handleConfigDraftChange(key, value);
    setEditingConfigKey('');
    setMessage({ text: '', type: '' });
  };

  const handleSaveConfig = async (key) => {
    const nextValue = configDrafts[key];
    if (key === 'GEO_THRESHOLD_METERS' && (!nextValue || isNaN(nextValue) || Number(nextValue) < 10)) {
      setMessage({ text: 'Geo threshold must be at least 10 meters', type: 'error' });
      return;
    }
    if (key === 'OFFICIAL_COMMUNICATION_EMAIL' && !/^\S+@\S+\.\S+$/.test(nextValue || '')) {
      setMessage({ text: 'Enter a valid official email address', type: 'error' });
      return;
    }
    if (key === 'ATTENDANCE_DEADLINE_TIME' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(nextValue || '')) {
      setMessage({ text: 'Attendance deadline must use HH:MM in 24-hour format', type: 'error' });
      return;
    }

    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      await api.put('/api/config/update', { key, value: nextValue });
      if (key === 'GEO_THRESHOLD_METERS') {
        setGeoThreshold(nextValue);
        setDraftGeoThreshold(nextValue);
        setEditingGeo(false);
      }
      if (key === 'OFFICIAL_COMMUNICATION_EMAIL' && isSuperAdmin) {
        await fetchReminderStatus();
      }
      setEditingConfigKey('');
      setMessage({ text: `${key} updated successfully!`, type: 'success' });
      fetchConfigs();
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to update', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleStartGeoEdit = () => {
    setDraftGeoThreshold(geoThreshold);
    setEditingGeo(true);
    setEditingConfigKey('');
    setMessage({ text: '', type: '' });
  };

  const handleCancelGeoEdit = () => {
    setDraftGeoThreshold(geoThreshold);
    setEditingGeo(false);
    setMessage({ text: '', type: '' });
  };

  const handleMailConfigChange = (key, value) => {
    setMailConfig((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSaveMailConfig = async () => {
    if (!/^\S+@\S+\.\S+$/.test(mailConfig.official_email || '')) {
      setMessage({ text: 'Enter a valid official email address', type: 'error' });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(mailConfig.smtp_user || '')) {
      setMessage({ text: 'Enter a valid SMTP user email', type: 'error' });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(mailConfig.from_email || '')) {
      setMessage({ text: 'Enter a valid from email address', type: 'error' });
      return;
    }
    if (!mailConfig.smtp_server) {
      setMessage({ text: 'SMTP server is required', type: 'error' });
      return;
    }
    if (!mailConfig.smtp_port || Number(mailConfig.smtp_port) < 1) {
      setMessage({ text: 'SMTP port must be valid', type: 'error' });
      return;
    }
    if (!mailConfig.password_reset_link_validity_minutes || Number(mailConfig.password_reset_link_validity_minutes) < 1) {
      setMessage({ text: 'Password reset validity must be at least 1 minute', type: 'error' });
      return;
    }

    setMailSaving(true);
    setMessage({ text: '', type: '' });
    try {
      await api.put('/api/config/mail', {
        ...mailConfig,
        smtp_port: Number(mailConfig.smtp_port),
        password_reset_link_validity_minutes: Number(mailConfig.password_reset_link_validity_minutes),
      });
      setMessage({ text: 'Mail settings updated successfully!', type: 'success' });
      await fetchMailConfig();
      await fetchConfigs();
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to update mail settings', type: 'error' });
    } finally {
      setMailSaving(false);
    }
  };

  const handleSendTestMail = async () => {
    if (!/^\S+@\S+\.\S+$/.test(mailTestRecipient || '')) {
      setMessage({ text: 'Enter a valid test recipient email', type: 'error' });
      return;
    }

    setMailSaving(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.post('/api/config/mail/test', {
        recipient_email: mailTestRecipient,
        subject: 'anix HRMS Mail Test',
        body: `This is a test email from anix HRMS.\n\nOfficial communication mailbox: ${mailConfig.official_email || officialEmailValue}\n`,
      });
      setMessage({ text: res.data.message || 'Test email sent successfully', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to send test email', type: 'error' });
    } finally {
      setMailSaving(false);
    }
  };

  const handleAutoCancelWeekOffs = async () => {
    setWeekOffCancelling(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.post('/api/leave/maintenance/auto-cancel-week-offs');
      setMessage({
        text: res.data.message || `${res.data.cancelled} week-off request(s) auto-cancelled.`,
        type: res.data.cancelled > 0 ? 'success' : 'info',
      });
    } catch (err) {
      setMessage({ text: err.response?.data?.detail || 'Failed to auto-cancel week-offs', type: 'error' });
    } finally {
      setWeekOffCancelling(false);
    }
  };

  if (loading) {
    return <Box p={4} textAlign="center"><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={1}>
        <SettingsIcon sx={{ fontSize: 32, color: '#d66a18' }} />
        <Typography variant="h5" fontWeight="bold">System Settings</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Configure system-wide parameters for the HRMS application.
      </Typography>

      {message.text && (
        <Alert severity={message.type} sx={{ mb: 3, borderRadius: 2 }} onClose={() => setMessage({ text: '', type: '' })}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Geo Threshold Configuration */}
        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 4, border: '1px solid #eee', boxShadow: 'none' }}>
            <CardContent sx={{ p: 3 }}>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Box sx={{ bgcolor: 'rgba(244, 124, 32, 0.12)', p: 1.5, borderRadius: 2 }}>
                  <LocationOnIcon color="primary" />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight="bold">Geo Validation Threshold</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Distance (meters) before attendance is flagged
                  </Typography>
                </Box>
              </Box>
              
              <Divider sx={{ my: 2 }} />
              
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Current Value</Typography>
                <Chip label={`${geoThreshold} meters`} color="primary" variant="outlined" sx={{ fontWeight: 'bold' }} />
              </Box>

              {editingGeo ? (
                <>
                  <TextField
                    fullWidth
                    label="New Threshold (meters)"
                    type="number"
                    value={draftGeoThreshold}
                    onChange={(e) => setDraftGeoThreshold(e.target.value)}
                    helperText="Minimum: 10 meters"
                    sx={{ mb: 2 }}
                  />

                  <Box display="flex" gap={2}>
                    <Button variant="contained" fullWidth onClick={handleSaveGeo} disabled={saving} sx={{ py: 1.5, borderRadius: 2 }}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button variant="outlined" fullWidth onClick={handleCancelGeoEdit} disabled={saving} sx={{ py: 1.5, borderRadius: 2 }}>
                      Cancel
                    </Button>
                  </Box>
                </>
              ) : (
                <Button
                  variant="outlined"
                  fullWidth
                  startIcon={<EditIcon />}
                  onClick={handleStartGeoEdit}
                  sx={{ py: 1.5, borderRadius: 2 }}
                >
                  Edit Geo Threshold
                </Button>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Mail Configuration */}
        {isSuperAdmin && (
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 4, border: '1px solid #eee', boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Box sx={{ bgcolor: 'rgba(33, 150, 243, 0.1)', p: 1.5, borderRadius: 2 }}>
                    <NotificationsIcon sx={{ color: '#1976d2' }} />
                  </Box>
                  <Box>
                    <Typography variant="h6" fontWeight="bold">Mail Configuration</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Configure the sender mailbox and SMTP transport used by all system emails
                    </Typography>
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Official Communication Email"
                      type="email"
                      value={mailConfig.official_email}
                      onChange={(e) => handleMailConfigChange('official_email', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="SMTP Server"
                      value={mailConfig.smtp_server}
                      onChange={(e) => handleMailConfigChange('smtp_server', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="SMTP Port"
                      type="number"
                      value={mailConfig.smtp_port}
                      onChange={(e) => handleMailConfigChange('smtp_port', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="SMTP User"
                      type="email"
                      value={mailConfig.smtp_user}
                      onChange={(e) => handleMailConfigChange('smtp_user', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="SMTP Password"
                      type={showSmtpPassword ? 'text' : 'password'}
                      value={mailConfig.smtp_password}
                      onChange={(e) => handleMailConfigChange('smtp_password', e.target.value)}
                      helperText={mailConfig.smtp_password_set ? 'Leave blank to keep the current password' : 'Required to enable mail delivery'}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              aria-label="toggle password visibility"
                              edge="end"
                              onClick={() => setShowSmtpPassword((value) => !value)}
                            >
                              {showSmtpPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="From Name"
                      value={mailConfig.from_name}
                      onChange={(e) => handleMailConfigChange('from_name', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="From Email"
                      type="email"
                      value={mailConfig.from_email}
                      onChange={(e) => handleMailConfigChange('from_email', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Password Reset Link Validity (Minutes)"
                      type="number"
                      value={mailConfig.password_reset_link_validity_minutes}
                      onChange={(e) => handleMailConfigChange('password_reset_link_validity_minutes', e.target.value)}
                      helperText="Default is 10 minutes"
                    />
                  </Grid>
                </Grid>

                <Box sx={{ mt: 2, mb: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    Current official mailbox: <strong>{officialEmailValue}</strong>
                  </Typography>
                </Box>

                <TextField
                  fullWidth
                  label="Test Recipient Email"
                  type="email"
                  value={mailTestRecipient}
                  onChange={(e) => setMailTestRecipient(e.target.value)}
                  sx={{ mb: 2 }}
                  helperText="Use this to verify the current SMTP setup before enabling reminders"
                />

                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleSaveMailConfig}
                  disabled={mailSaving}
                  sx={{ py: 1.5, borderRadius: 2, mb: 1 }}
                >
                  {mailSaving ? 'Saving...' : 'Save Mail Settings'}
                </Button>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={fetchMailConfig}
                  disabled={mailSaving}
                  sx={{ py: 1.5, borderRadius: 2 }}
                >
                  Reload Current Mail Settings
                </Button>
                <Button
                  variant="text"
                  fullWidth
                  onClick={handleSendTestMail}
                  disabled={mailSaving}
                  sx={{ py: 1.5, borderRadius: 2, mt: 1 }}
                >
                  Send Test Email
                </Button>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Attendance Reminder - Super Admin Only */}
        {isSuperAdmin && (
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 4, border: '1px solid #eee', boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Box sx={{ bgcolor: 'rgba(255, 152, 0, 0.1)', p: 1.5, borderRadius: 2 }}>
                    <NotificationsIcon color="warning" />
                  </Box>
                  <Box>
                  <Typography variant="h6" fontWeight="bold">Attendance Reminder</Typography>
                  <Typography variant="body2" color="text.secondary">
                      Email notification for users who missed attendance
                  </Typography>
                </Box>
                </Box>
                
                <Divider sx={{ my: 2 }} />
                
                <Box sx={{ mb: 3, p: 2, bgcolor: '#f8f9fa', borderRadius: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    When enabled, an email will be sent at <strong>{reminderDeadlineTime}</strong> every working day to users who haven't marked their attendance.
                  </Typography>
                  {reminderOfficialEmail && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Sender mailbox: <strong>{reminderOfficialEmail}</strong>
                    </Typography>
                  )}
                  {reminderLastSentDate && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Last sent on: <strong>{formatDisplayDate(reminderLastSentDate)}</strong>
                    </Typography>
                  )}
                </Box>

                <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ p: 2, bgcolor: reminderEnabled ? 'rgba(76, 175, 80, 0.08)' : 'rgba(244, 67, 54, 0.08)', borderRadius: 2 }}>
                  <Box>
                    <Typography variant="body1" fontWeight="bold">
                      {reminderEnabled ? 'Active' : 'Inactive'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {reminderEnabled ? 'Emails will be sent' : 'Emails disabled'}
                    </Typography>
                  </Box>
                  <Switch
                    checked={reminderEnabled}
                    onChange={handleToggleReminder}
                    color="success"
                  />
                </Box>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleSendReminderNow}
                  disabled={saving}
                  sx={{ mt: 2, py: 1.25, borderRadius: 2 }}
                >
                  Send Reminder Now
                </Button>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Week-Off Auto-Cancel - HR/SuperAdmin Only */}
        {isHrOrAdmin && (
          <Grid item xs={12} md={6}>
            <Card sx={{ borderRadius: 4, border: '1px solid #eee', boxShadow: 'none' }}>
              <CardContent sx={{ p: 3 }}>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Box sx={{ bgcolor: 'rgba(156, 39, 176, 0.1)', p: 1.5, borderRadius: 2 }}>
                    <EventBusyIcon sx={{ color: '#9c27b0' }} />
                  </Box>
                  <Box>
                    <Typography variant="h6" fontWeight="bold">Week-Off Maintenance</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Auto-cancel stale week-off swap requests
                    </Typography>
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ mb: 3, p: 2, bgcolor: '#f8f9fa', borderRadius: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Cancels all <strong>PENDING</strong> or <strong>HOD-approved</strong> week-off swap requests where the swap date has already passed. These requests can no longer be fulfilled and should be cleared.
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    This also runs automatically when leave requests are fetched. Use this button for an immediate cleanup.
                  </Typography>
                </Box>

                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleAutoCancelWeekOffs}
                  disabled={weekOffCancelling}
                  startIcon={weekOffCancelling ? <CircularProgress size={18} /> : <EventBusyIcon />}
                  sx={{ py: 1.5, borderRadius: 2 }}
                >
                  {weekOffCancelling ? 'Processing...' : 'Auto-Cancel Stale Week-Off Swaps'}
                </Button>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* All Configurations List */}
        <Grid item xs={12}>
          <Card sx={{ borderRadius: 4, border: '1px solid #eee', boxShadow: 'none' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 2 }}>All System Configurations</Typography>
              <Divider sx={{ mb: 2 }} />
              
              <Grid container spacing={2}>
                {configs
                  .filter((config) => ![
                    'ATTENDANCE_REMINDER_LAST_SENT_DATE',
                    'OFFICIAL_COMMUNICATION_EMAIL',
                    'SMTP_SERVER',
                    'SMTP_PORT',
                    'SMTP_USER',
                    'EMAILS_FROM_NAME',
                    'EMAILS_FROM_EMAIL',
                    'SMTP_PASSWORD',
                    'PASSWORD_RESET_LINK_VALIDITY_MINUTES',
                    'timestamps_backfilled_to_ist',
                  ].includes(config.key))
                  .map((config) => (
                  <Grid item xs={12} sm={6} md={4} key={config.key}>
                    <Box sx={{ p: 2, bgcolor: '#f8f9fa', borderRadius: 2, border: '1px solid #eee' }}>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="body2" fontWeight="bold">{config.key}</Typography>
                        {editingConfigKey === config.key ? (
                          <Chip label="Editing" size="small" color="warning" variant="outlined" />
                        ) : (
                          <Chip label={config.value} size="small" color="primary" variant="outlined" />
                        )}
                      </Box>
                      {config.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                          {config.description}
                        </Typography>
                      )}

                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                        Access: {config.access_level || 'N/A'}
                      </Typography>

                      {editingConfigKey === config.key ? (
                        <>
                          <TextField
                            fullWidth
                            size="small"
                            label="Value"
                            value={configDrafts[config.key] ?? ''}
                            onChange={(e) => handleConfigDraftChange(config.key, e.target.value)}
                            sx={{ mb: 2 }}
                          />
                          <Box display="flex" gap={1}>
                            <Button
                              variant="contained"
                              size="small"
                              onClick={() => handleSaveConfig(config.key)}
                              disabled={saving}
                            >
                              Save
                            </Button>
                            <Button
                              variant="outlined"
                              size="small"
                              onClick={() => handleCancelConfigEdit(config.key, config.value)}
                              disabled={saving}
                            >
                              Cancel
                            </Button>
                          </Box>
                        </>
                      ) : (
                        <Button
                          variant="text"
                          size="small"
                          startIcon={<EditIcon />}
                          onClick={() => handleStartConfigEdit(config.key, config.value)}
                        >
                          Edit
                        </Button>
                      )}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
