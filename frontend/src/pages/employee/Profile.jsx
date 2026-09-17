import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, Button, CircularProgress, Alert, Chip, Autocomplete, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Divider,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { formatDisplayDate } from '../../utils/dateFormat';

export default function Profile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // If no ID is passed in route, we assume viewing one's own profile
  const targetId = id || user?.id;

  const [profileData, setProfileData] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [openResetDialog, setOpenResetDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verificationSending, setVerificationSending] = useState(false);
  const [documentUrls, setDocumentUrls] = useState({});

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    department_id: '',
    default_week_off: 'Sunday'
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const [profRes, deptRes] = await Promise.all([
          api.get(`/api/employees/${targetId}`),
          api.get('/api/departments/')
        ]);
        setProfileData(profRes.data);
        setDepartments((deptRes.data || []).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
        setFormData({
          first_name: profRes.data.first_name || '',
          last_name: profRes.data.last_name || '',
          email: profRes.data.email || '',
          phone: profRes.data.phone || '',
          address: profRes.data.address || '',
          department_id: profRes.data.department_id || '',
          default_week_off: profRes.data.default_week_off || 'Sunday'
        });
      } catch (err) {
        setError("Failed to load profile. " + (err.response?.data?.detail || ""));
      } finally {
        setLoading(false);
      }
    };
    if (targetId) {
      fetchProfile();
    }
  }, [targetId]);

  const handleSave = async () => {
    setError(''); setSuccess('');
    try {
      await api.put(`/api/employees/${targetId}`, formData);
      setSuccess("Profile updated successfully!");
      setIsEditing(false);
      const res = await api.get(`/api/employees/${targetId}`);
      setProfileData(res.data);
    } catch (err) {
      setError("Failed to update profile. " + (err.response?.data?.detail || ""));
    }
  };

  const handleResendActivation = async () => {
    setVerificationMessage('');
    setVerificationSending(true);
    try {
      const res = await api.post(`/api/employees/${targetId}/resend-activation-email`);
      setVerificationMessage(res.data.message || 'Activation email sent.');
    } catch (err) {
      setVerificationMessage(err.response?.data?.detail || 'Failed to send activation email.');
    } finally {
      setVerificationSending(false);
    }
  };

  const handleUploadDocument = async (docType, file) => {
    if (!file) return;
    const uploadForm = new FormData();
    uploadForm.append('doc_type', docType);
    uploadForm.append('file', file);
    try {
      // Explicitly unset Content-Type so browser sets multipart/form-data with boundary
      const res = await api.post(`/api/employees/${targetId}/documents`, uploadForm, {
        headers: { 'Content-Type': undefined },
      });
      setSuccess(`${docType.replace('_', ' ')} uploaded successfully!`);
      setProfileData(res.data);
    } catch (err) {
      console.error('Upload error:', err);
      const detail = err.response?.data?.detail || err.message || 'Unknown error';
      setError(`Failed to upload document. ${detail}`);
    }
  };

  useEffect(() => {
    if (!profileData?.id) {
      setDocumentUrls({});
      return undefined;
    }

    const docs = [
      { key: 'id_proof', path: profileData.id_proof_path },
      { key: 'pan_card', path: profileData.pan_card_path },
      { key: 'passbook', path: profileData.passbook_path },
    ].filter((doc) => doc.path);
    let cancelled = false;
    const createdUrls = [];

    const loadDocuments = async () => {
      const nextUrls = {};
      await Promise.all(docs.map(async (doc) => {
        try {
          const res = await api.get(`/api/employees/${profileData.id}/documents/${doc.key}`, {
            responseType: 'blob',
          });
          if (cancelled) return;
          const url = URL.createObjectURL(res.data);
          createdUrls.push(url);
          nextUrls[doc.key] = url;
        } catch {
          nextUrls[doc.key] = '';
        }
      }));
      if (!cancelled) {
        setDocumentUrls(nextUrls);
      }
    };

    loadDocuments();

    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [profileData?.id, profileData?.id_proof_path, profileData?.pan_card_path, profileData?.passbook_path]);

  const openDocument = async (docType) => {
    const existingUrl = documentUrls[docType];
    if (existingUrl) {
      window.open(existingUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const res = await api.get(`/api/employees/${targetId}/documents/${docType}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to open document.');
    }
  };

  const handleSystemReset = async () => {
    try {
      setLoading(true);
      await api.delete('/api/employees/admin/system/clean');
      setOpenResetDialog(false);
      setSuccess("System cleaned up! All non-admin data has been wiped.");
    } catch (err) {
      setError("Failed to reset system. " + (err.response?.data?.detail || ""));
      setOpenResetDialog(false);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Box sx={{ p: 3 }}><CircularProgress /></Box>;

  const isEditable = user?.id === targetId || ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role);
  const isAccountProfile = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(profileData?.role);
  const viewValueSx = {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
  const workViewItemSx = (width) => ({
    width: { xs: '100%', md: width },
    flexBasis: { md: width },
    maxWidth: { md: width },
    minWidth: 0,
  });
  const personalViewItemSx = (width) => ({
    width: { xs: '100%', md: width },
    flexBasis: { md: width },
    maxWidth: { md: width },
    minWidth: 0,
  });

  return (
    <Box maxWidth="lg" sx={{ width: '100%', mx: 'auto' }}>
      <Box display="flex" justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={3} gap={2} flexDirection={{ xs: 'column', sm: 'row' }}>
        <Typography variant="h4" fontWeight="bold" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
          {user?.id === targetId ? 'My Profile' : 'Employee Profile'}
        </Typography>
        <Box display="flex" gap={1.5} flexWrap="wrap" sx={{ '& .MuiButton-root': { flex: { xs: '1 1 100%', sm: '0 0 auto' } } }}>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(-1)}
            sx={{ borderRadius: 2, textTransform: 'none', color: 'text.secondary' }}
          >
            Back
          </Button>

          {isEditable && !isEditing && (
            <Button variant="contained" color="primary" onClick={() => setIsEditing(true)} sx={{ borderRadius: 2 }}>
              Edit Profile
            </Button>
          )}
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      {verificationMessage && <Alert severity="info" sx={{ mb: 2 }}>{verificationMessage}</Alert>}

	      {profileData && (
	        <>
	          <Paper sx={{ p: { xs: 2.25, sm: 4 }, mb: 4, borderRadius: { xs: 2, sm: 3 } }}>
	            {isAccountProfile ? (
	              <>
	                <Typography variant="h6" color="primary" gutterBottom sx={{ mt: 1, mb: 3, fontWeight: 700 }}>Account Information</Typography>
	                {!isEditing ? (
	                  <Box
	                    sx={{
	                      display: 'grid',
	                      gridTemplateColumns: {
	                        xs: '1fr',
	                        sm: 'repeat(2, minmax(0, 1fr))',
	                        md: '0.8fr 0.9fr 1.05fr 1.05fr 0.9fr 1.6fr 0.95fr',
	                      },
	                      columnGap: { sm: 3, md: 3.5 },
	                      rowGap: 3,
	                      alignItems: 'start',
	                    }}
	                  >
	                    {[
	                      ['Account ID', profileData.employee_id],
	                      ['Role', profileData.role?.replace('_', ' ') || 'N/A'],
	                      ['First Name', profileData.first_name],
	                      ['Last Name', profileData.last_name],
	                      ['Phone', profileData.phone || '-'],
	                      ['Email', profileData.email || '-'],
	                      ['Joined On', profileData.activated_at ? formatDisplayDate(profileData.activated_at) : profileData.updated_at ? formatDisplayDate(profileData.updated_at) : '-'],
	                    ].map(([label, value]) => (
	                      <Box key={label} sx={{ minWidth: 0 }}>
	                        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
	                          {label}
	                        </Typography>
	                        <Typography
	                          variant="body1"
	                          fontWeight={500}
	                          color={label === 'Joined On' ? 'success.main' : 'text.primary'}
	                          sx={viewValueSx}
	                          title={String(value || '')}
	                        >
	                          {value}
	                        </Typography>
	                      </Box>
	                    ))}
	                  </Box>
	                ) : (
	                  <Box
	                    sx={{
	                      display: 'grid',
	                      gridTemplateColumns: {
	                        xs: '1fr',
	                        sm: 'repeat(2, minmax(0, 1fr))',
	                        md: '0.8fr 0.9fr 1.05fr 1.05fr 0.9fr 1.6fr 0.95fr',
	                      },
	                      columnGap: { sm: 2, md: 2.5 },
	                      rowGap: 2.5,
	                      alignItems: 'start',
	                    }}
	                  >
	                    <TextField label="Account ID" fullWidth size="small" variant="outlined" value={profileData.employee_id} disabled />
	                    <TextField label="Role" fullWidth size="small" variant="outlined" value={profileData.role?.replace('_', ' ') || 'N/A'} disabled />
	                    <TextField label="First Name" fullWidth size="small" variant="outlined" value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value.replace(/[^A-Za-z ]/g, '') })} />
	                    <TextField label="Last Name" fullWidth size="small" variant="outlined" value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value.replace(/[^A-Za-z ]/g, '') })} />
	                    <TextField label="Phone" fullWidth size="small" variant="outlined" inputMode="numeric" inputProps={{ maxLength: 10 }} value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
	                    <TextField label="Email" type="email" fullWidth size="small" variant="outlined" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
	                    <TextField
	                      label="Joined On"
	                      fullWidth
	                      size="small"
	                      variant="outlined"
	                      value={profileData.activated_at ? formatDisplayDate(profileData.activated_at) : profileData.updated_at ? formatDisplayDate(profileData.updated_at) : '-'}
	                      disabled
	                    />
	                  </Box>
	                )}

	                {isEditing && (
	                  <Box mt={5} display="flex" justifyContent="flex-end" gap={2} flexDirection={{ xs: 'column-reverse', sm: 'row' }} sx={{ '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } } }}>
	                    <Button variant="outlined" onClick={() => setIsEditing(false)}>Cancel</Button>
	                    <Button variant="contained" color="success" onClick={handleSave}>Save Changes</Button>
	                  </Box>
	                )}
	              </>
	            ) : (
	              <>
	            <Typography variant="h6" color="primary" gutterBottom sx={{ mt: 1, mb: 3, fontWeight: 700 }}>Work Information</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6} sx={isEditing ? { width: { xs: "40%", md: "20%" } } : workViewItemSx('14%')}>
                {isEditing && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role) ? (
                  <TextField label="Employee ID" fullWidth size="small" variant="outlined" value={profileData.employee_id} disabled />
                ) : (
                  <Box sx={{ p: { xs: 1.5, sm: 0 }, borderRadius: 2, bgcolor: { xs: 'rgba(244,124,32,0.04)', sm: 'transparent' } }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Employee ID</Typography>
                    <Typography variant="body1" fontWeight={500}>{profileData.employee_id}</Typography>
                  </Box>
                )}
              </Grid>
              <Grid item xs={12} sm={6} sx={isEditing ? { width: { xs: "50%", md: "20%" } } : workViewItemSx('14%')}>
                {isEditing && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role) ? (
                  <TextField label="Role" fullWidth size="small" variant="outlined" value={profileData.role?.replace('_', ' ') || 'N/A'} disabled />
                ) : (
                  <Box sx={{ p: { xs: 1.5, sm: 0 }, borderRadius: 2, bgcolor: { xs: 'rgba(244,124,32,0.04)', sm: 'transparent' } }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Role</Typography>
                    <Typography variant="body1" fontWeight={500}>{profileData.role?.replace('_', ' ') || 'N/A'}</Typography>
                  </Box>
                )}
              </Grid>
              <Grid item xs={12} sm={6} sx={isEditing ? { minWidth: { xs: "100%", md: "20%" } } : workViewItemSx('18%')}>
                {isEditing && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role) ? (
                  <Autocomplete
                    sx={{ width: '100%' }}
                    options={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']}
                    value={formData.default_week_off}
                    onChange={(e, newValue) => {
                      setFormData({ ...formData, default_week_off: newValue || 'Sunday' });
                    }}
                    renderInput={(params) => <TextField {...params} label="Default Week Off" fullWidth size="small" variant="outlined" />}
                  />
                ) : (
                  <Box sx={{ p: { xs: 1.5, sm: 0 }, borderRadius: 2, bgcolor: { xs: 'rgba(244,124,32,0.04)', sm: 'transparent' } }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Default Week Off</Typography>
                    <Typography variant="body1" fontWeight={500}>{profileData.default_week_off}</Typography>
                  </Box>
                )}
              </Grid>
              <Grid item xs={12} sm={6} sx={isEditing ? { minWidth: { xs: "100%", md: "30%" } } : workViewItemSx('26%')}>
                {isEditing && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role) ? (
                  <Autocomplete
                    sx={{ width: '100%' }}
                    options={departments}
                    getOptionLabel={(option) => option.name}
                    value={departments.find(d => d.id === formData.department_id) || null}
                    onChange={(e, newValue) => {
                      setFormData({ ...formData, department_id: newValue ? newValue.id : '' });
                    }}
                    renderInput={(params) => <TextField {...params} label="Department" fullWidth size="small" variant="outlined" />}
                  />
                ) : (
                  <Box sx={{ p: { xs: 1.5, sm: 0 }, borderRadius: 2, bgcolor: { xs: 'rgba(244,124,32,0.04)', sm: 'transparent' }, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Department</Typography>
                    <Typography variant="body1" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{departments.find(d => d.id === profileData.department_id)?.name || 'Unassigned'}</Typography>
                  </Box>
                )}
              </Grid>

              {!isEditing && profileData.email_verified && (
                <Grid item xs={12} sx={workViewItemSx('18%')}>
                  <Box sx={{ p: { xs: 1.5, sm: 0 }, borderRadius: 2, bgcolor: { xs: 'rgba(244,124,32,0.04)', sm: 'transparent' } }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Joined On</Typography>
                    <Typography variant="body1" fontWeight={500} color="success.main">
                      {profileData.activated_at
                        ? formatDisplayDate(profileData.activated_at)
                        : profileData.updated_at
                          ? formatDisplayDate(profileData.updated_at)
                          : '—'}
                    </Typography>
                  </Box>
                </Grid>
              )}
            </Grid>

            <Divider sx={{ my: 4 }} />

            <Box display="flex" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1} mb={3} flexDirection={{ xs: 'column', sm: 'row' }}>
              <Typography variant="h6" color="primary" gutterBottom sx={{ mb: 0, fontWeight: 700 }}>Personal Details</Typography>
              {profileData.email_verified ? (
                <Chip icon={<VerifiedIcon sx={{ fontSize: 18 }} />} label="Email Verified" color="success" variant="outlined" size="small" />
              ) : (
                <Chip icon={<MarkEmailUnreadIcon sx={{ fontSize: 18 }} />} label="Email Unverified" color="warning" variant="outlined" size="small" />
              )}
            </Box>
            {!isEditing ? (
              <Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1.35fr 0.75fr 0.7fr 2fr' },
                    columnGap: { md: 4 },
                    rowGap: 3,
                    alignItems: 'start',
                    maxWidth: { md: 850 },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>First Name</Typography>
                    <Typography variant="body1" fontWeight={500} sx={viewValueSx}>{profileData.first_name}</Typography>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Last Name</Typography>
                    <Typography variant="body1" fontWeight={500} sx={viewValueSx}>{profileData.last_name}</Typography>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Phone</Typography>
                    <Typography variant="body1" fontWeight={500} sx={viewValueSx}>{profileData.phone || '—'}</Typography>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Email</Typography>
                      {profileData.email_verified ? (
                        <VerifiedIcon sx={{ fontSize: 18, color: '#2e7d32' }} titleAccess="Email verified" />
                      ) : (
                        <MarkEmailUnreadIcon sx={{ fontSize: 18, color: '#ed6c02' }} titleAccess="Email not verified" />
                      )}
                    </Box>
                    <Typography variant="body1" fontWeight={500} sx={viewValueSx}>{profileData.email}</Typography>
                    {!profileData.email_verified && (user?.id === targetId || ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role)) && (
                      <Button
                        size="small"
                        variant="text"
                        onClick={handleResendActivation}
                        disabled={verificationSending}
                        sx={{ mt: 0.5, px: 0, minWidth: 'auto' }}
                      >
                        {verificationSending ? 'Sending...' : 'Resend Activation Email'}
                      </Button>
                    )}
                  </Box>
                </Box>
                <Box sx={{ mt: 3, width: '100%' }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Address</Typography>
                  <Typography variant="body1" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{profileData.address || '—'}</Typography>
                </Box>
              </Box>
            ) : (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Grid container spacing={3}>
                  <Grid item xs={12} sm={6} sx={isEditing ? { minWidth: { xs: "100%", md: "30%" }, width: { xs: "50%", md: "30%" } } : personalViewItemSx('30%')}>
                    {isEditing ? (
                      <TextField label="First Name" fullWidth size="small" variant="outlined" value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value.replace(/[^A-Za-z ]/g, '') })} />
                    ) : (
                      <Box>
                        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>First Name</Typography>
                        <Typography variant="body1" fontWeight={500}>{profileData.first_name}</Typography>
                      </Box>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6} sx={isEditing ? { minWidth: { xs: "100%", md: "20%" }, width: { xs: "50%", md: "20%" } } : personalViewItemSx('20%')}>
                    {isEditing ? (
                      <TextField label="Last Name" fullWidth size="small" variant="outlined" value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value.replace(/[^A-Za-z ]/g, '') })} />
                    ) : (
                      <Box>
                        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Last Name</Typography>
                        <Typography variant="body1" fontWeight={500}>{profileData.last_name}</Typography>
                      </Box>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6} sx={isEditing ? { minWidth: { xs: "100%", md: "15%" }, width: { xs: "50%", md: "15%" } } : personalViewItemSx('15%')}>
                    {isEditing ? (
                      <TextField label="Phone" fullWidth size="small" variant="outlined" inputMode="numeric" inputProps={{ maxLength: 10 }} value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
                    ) : (
                      <Box>
                        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Phone</Typography>
                        <Typography variant="body1" fontWeight={500}>{profileData.phone || '—'}</Typography>
                      </Box>
                    )}
                  </Grid>
                  <Grid item xs={12} sm={6} sx={isEditing ? { minWidth: { xs: "100%", md: "27%" }, width: { xs: "50%", md: "25%" } } : personalViewItemSx('35%')}>
                    {isEditing ? (
                      <TextField label="Email" type="email" fullWidth size="small" variant="outlined" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                    ) : (
                      <Box>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Email</Typography>
                          {profileData.email_verified ? (
                            <VerifiedIcon sx={{ fontSize: 18, color: '#2e7d32' }} titleAccess="Email verified" />
                          ) : (
                            <MarkEmailUnreadIcon sx={{ fontSize: 18, color: '#ed6c02' }} titleAccess="Email not verified" />
                          )}
                        </Box>
                        <Typography variant="body1" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{profileData.email}</Typography>
                        {!profileData.email_verified && (user?.id === targetId || ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role)) && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={handleResendActivation}
                            disabled={verificationSending}
                            sx={{ mt: 0.5, px: 0, minWidth: 'auto' }}
                          >
                            {verificationSending ? 'Sending...' : 'Resend Activation Email'}
                          </Button>
                        )}
                      </Box>
                    )}
                  </Grid>
                </Grid>
              </Grid>

              <Grid item xs={12} sx={{ width: "100%" }}>
                {isEditing ? (
                  <TextField
                    label="Address"
                    multiline
                    rows={4}
                    fullWidth
                    size="small"
                    variant="outlined"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    sx={{ width: '100%', '& .MuiInputBase-root': { alignItems: 'flex-start' } }}
                  />
                ) : (
                  <Box sx={{ height: 'max-content', minHeight: '100%' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>Address</Typography>
                    <Typography variant="body1" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{profileData.address || '—'}</Typography>
                  </Box>
                )}
              </Grid>
            </Grid>
            )}

            {isEditing && (
              <Box mt={5} display="flex" justifyContent="flex-end" gap={2} flexDirection={{ xs: 'column-reverse', sm: 'row' }} sx={{ '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } } }}>
                <Button variant="outlined" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button variant="contained" color="success" onClick={handleSave}>Save Changes</Button>
              </Box>
            )}

            <Box mt={6}>
              <Typography variant="h5" fontWeight="bold" sx={{ mb: 3, fontSize: { xs: '1.35rem', sm: '1.5rem' } }}>Documents <span style={{ display: 'inline-block', verticalAlign: 'middle', fontSize: '0.85rem', color: '#666' }}>(PDF/JPG/JPEG/PNG (100KB-2MB))</span></Typography>
              <Grid container spacing={3} alignItems="stretch">
                {[
                  { title: 'ID Proof (Aadhar/Voter ID)', key: 'id_proof', path: profileData.id_proof_path },
                  { title: 'PAN Card', key: 'pan_card', path: profileData.pan_card_path },
                  { title: 'Bank Passbook', key: 'passbook', path: profileData.passbook_path },
                ].map((doc, idx) => (
                  <Grid item xs={12} md={4} key={idx} sx={{ display: 'flex', width: { xs: "100%", md: 315 } }}>
                    <Paper sx={{ p: 2, textAlign: 'center', height: '100%', width: '100%', minHeight: { xs: 300, sm: 278 }, display: 'flex', flexDirection: 'column', borderRadius: 2 }} variant="outlined">
                      <Typography variant="subtitle2" mb={2} fontWeight="bold" sx={{ minHeight: { sm: 40 }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{doc.title}</Typography>
                      {doc.path ? (
                        <Box flexGrow={1}>
                          <Box
                            component="img"
                            src={documentUrls[doc.key] || ''}
                            alt={doc.title}
                            sx={{ width: '100%', height: { xs: 170, sm: 120 }, objectFit: 'cover', borderRadius: 1, mb: 1, border: '1px solid #ccc', bgcolor: 'grey.50' }}
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                          />
                          <Typography variant="body2" color="text.secondary" sx={{ display: 'none' }}>Preview unvailable for this format.</Typography>
                          <Button size="small" variant="outlined" type="button" onClick={() => openDocument(doc.key)} fullWidth sx={{ mb: 1, borderRadius: 2 }}>View / Download</Button>
                        </Box>
                      ) : (
                        <Box flexGrow={1} display="flex" alignItems="center" justifyItems="center" width="100%">
                          <Typography variant="body2" color="text.secondary" py={4} width="100%">Not Uploaded</Typography>
                        </Box>
                      )}
                      {isEditing && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role) && (
                        <Box mt={2}>
                          <Button variant="contained" component="label" size="small" fullWidth sx={{ borderRadius: 2 }}>
                            Upload New {doc.title.split(' ')[0]}
                            <input type="file" hidden onChange={(e) => handleUploadDocument(doc.key, e.target.files[0])} />
                          </Button>
                        </Box>
                      )}
                    </Paper>
                  </Grid>
                ))}
	              </Grid>
	            </Box>
	              </>
	            )}
	          </Paper>
        </>
      )}

      {user?.role === 'SUPER_ADMIN' && user?.id === targetId && (
        <Box mt={4}>
          <Paper sx={{ p: 4, border: '1px solid red' }}>
            <Typography variant="h5" color="error" fontWeight="bold" mb={2}>Danger Zone</Typography>
            <Typography variant="body1" mb={3}>
              Perform a full system reset. This action deletes all non-admin Employee data.
            </Typography>
            <Button variant="contained" color="error" onClick={() => setOpenResetDialog(true)}>Reset System Data</Button>
          </Paper>
          <Dialog open={openResetDialog} onClose={() => setOpenResetDialog(false)}>
            <DialogTitle color="error" fontWeight="bold">Confirm System Data Reset</DialogTitle>
            <DialogContent><DialogContentText>Are you absolutely sure? This will wipe the ENTIRE system database.</DialogContentText></DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenResetDialog(false)}>Cancel</Button>
              <Button onClick={handleSystemReset} color="error" variant="contained">Yes, Purge Data</Button>
            </DialogActions>
          </Dialog>
        </Box>
      )}
    </Box>
  );
}
