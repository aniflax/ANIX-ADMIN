import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, Grid, TextField, Button,
  CircularProgress, Alert, Container, Divider, Stack, Chip, Popover,
  InputAdornment, IconButton
} from '@mui/material';
import api from '../../api/axios';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const ONBOARDING_DRAFT_KEY = 'hrms.onboarding.draft.v1';
const DOCUMENTS = [
  { label: 'ID Proof (Aadhar/Voter ID)', name: 'id_proof' },
  { label: 'PAN Card', name: 'pan_card' },
  { label: 'Bank Passbook Image', name: 'passbook' },
];

const getInitialFormData = () => {
  const defaults = {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    password: '',
    confirm_password: '',
  };

  try {
    const savedDraft = JSON.parse(sessionStorage.getItem(ONBOARDING_DRAFT_KEY) || '{}');
    return {
      ...defaults,
      first_name: savedDraft.first_name || '',
      last_name: savedDraft.last_name || '',
      email: savedDraft.email || '',
      phone: savedDraft.phone || '',
      address: savedDraft.address || '',
    };
  } catch {
    return defaults;
  }
};

function useStableIsMobile() {
  const [isMobile] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 899.95px)').matches
      : false
  ));
  return isMobile;
}

export default function Onboarding() {
  const isMobile = useStableIsMobile();
  const fileInputRefs = useRef({});
  const previewUrlsRef = useRef(new Set());

  const [formData, setFormData] = useState(getInitialFormData);

  const [files, setFiles] = useState({
    id_proof: { file: null, previewUrl: '' },
    pan_card: { file: null, previewUrl: '' },
    passbook: { file: null, previewUrl: '' },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [fileUploadErrors, setFileUploadErrors] = useState({});
  const [previewAnchorEl, setPreviewAnchorEl] = useState(null);
  const [previewDocName, setPreviewDocName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
  const minDocSize = 100 * 1024;
  const maxDocSize = 2 * 1024 * 1024;

  useEffect(() => {
    const draft = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
    };
    try {
      sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage can fail in private mode; the form still works without draft recovery.
    }
  }, [formData]);

  useEffect(() => () => {
    previewUrlsRef.current.forEach((previewUrl) => {
      URL.revokeObjectURL(previewUrl);
    });
    previewUrlsRef.current.clear();
  }, []);

  // Format file size for display
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  // Note: URL cleanup is handled in handleFileChange when replacing a file

  const sanitizeName = (value) => value.replace(/[^A-Za-z ]/g, '');
  const sanitizePhone = (value) => value.replace(/\D/g, '').slice(0, 10);

  const isValidDocFile = (file) => {
    if (!file) return false;
    const extension = file.name.split('.').pop()?.toLowerCase();
    return allowedTypes.has(file.type) || ['pdf', 'jpg', 'jpeg', 'png'].includes(extension);
  };

  const getDocError = (file) => {
    if (!file) return 'Required document';
    if (!isValidDocFile(file)) return 'Upload PDF, JPG, JPEG, or PNG files only.';
    if (file.size < minDocSize) return `File is too small (${formatFileSize(file.size)}). Min: 100 KB.`;
    if (file.size > maxDocSize) return `File is too large (${formatFileSize(file.size)}). Max: 2 MB.`;
    return '';
  };

  const validateField = (name, value, currentForm = formData) => {
    if (name === 'first_name' || name === 'last_name') {
      if (!value) return 'This field is required.';
      if (!/^[A-Za-z ]+$/.test(value)) return 'Only alphabets and spaces are allowed.';
    }
    if (name === 'phone') {
      if (!value) return 'Phone number is required.';
      if (!/^\d{10}$/.test(value)) return 'Phone number must be 10 digits.';
    }
    if (name === 'email') {
      if (!value) return 'Email is required.';
    }
    if (name === 'address') {
      if (!value.trim()) return 'Address is required.';
    }
    if (name === 'password') {
      if (!value) return 'Password is required.';
      if (value.length < 6) return 'Password must be at least 6 characters.';
    }
    if (name === 'confirm_password') {
      if (!value) return 'Please confirm your password.';
      if (value !== currentForm.password) return 'Passwords do not match.';
    }
    return '';
  };

  const isFormValid = () => {
    const personalOk =
      formData.first_name &&
      /^[A-Za-z ]+$/.test(formData.first_name) &&
      formData.last_name &&
      /^[A-Za-z ]+$/.test(formData.last_name) &&
      formData.phone &&
      /^\d{10}$/.test(formData.phone) &&
      formData.email &&
      formData.address.trim() &&
      formData.password &&
      formData.password.length >= 6 &&
      formData.confirm_password &&
      formData.confirm_password === formData.password;

    const docsOk = Object.values(files).every((doc) => doc.file && !getDocError(doc.file));
    return Boolean(personalOk && docsOk);
  };

  const validateAll = () => {
    const nextErrors = {
      first_name: validateField('first_name', formData.first_name),
      last_name: validateField('last_name', formData.last_name),
      phone: validateField('phone', formData.phone),
      email: validateField('email', formData.email),
      address: validateField('address', formData.address),
      password: validateField('password', formData.password),
      confirm_password: validateField('confirm_password', formData.confirm_password, formData),
      id_proof: getDocError(files.id_proof.file),
      pan_card: getDocError(files.pan_card.file),
      passbook: getDocError(files.passbook.file),
    };

    setFieldErrors(nextErrors);
    return Object.values(nextErrors).every((msg) => !msg);
  };

  const handleFileChange = (e, name) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.target.files?.[0] || null;
    const nextError = getDocError(file);

    if (nextError) {
      setFieldErrors((prev) => ({ ...prev, [name]: nextError }));
      setFileUploadErrors((prev) => ({ ...prev, [name]: nextError }));
      e.target.value = '';
      return;
    }

    setFiles((prev) => {
      const previous = prev[name];
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
        previewUrlsRef.current.delete(previous.previewUrl);
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return {
        ...prev,
        [name]: {
          file,
          previewUrl,
        },
      };
    });
    setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    setFileUploadErrors((prev) => ({ ...prev, [name]: '' }));
    e.target.value = '';
  };

  const triggerFilePicker = useCallback((name) => {
    fileInputRefs.current[name]?.click();
  }, []);

  const handleTextChange = (field, value) => {
    let nextValue = value;
    if (field === 'first_name' || field === 'last_name') {
      nextValue = sanitizeName(value);
    }
    if (field === 'phone') {
      nextValue = sanitizePhone(value);
    }

    setFormData((prev) => {
      const updated = { ...prev, [field]: nextValue };
      if (field === 'password' && prev.confirm_password) {
        setFieldErrors((current) => ({
          ...current,
          confirm_password: updated.confirm_password === nextValue ? '' : 'Passwords do not match.',
        }));
      }
      return updated;
    });

    setFieldErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setError(''); setSuccess('');

    if (!validateAll()) {
      setError('Please fix the highlighted fields before submitting.');
      return;
    }

    setLoading(true);
    const data = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      if (key !== 'confirm_password') data.append(key, value);
    });
    data.append('id_proof', files.id_proof.file);
    data.append('pan_card', files.pan_card.file);
    data.append('passbook', files.passbook.file);

    try {
      const response = await api.post('/api/onboarding/register', data, {
        headers: { 'Content-Type': undefined },
      });
      sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
      setSuccess(response.data.message || `Account created successfully! Please check your email and click the activation link to activate your account and receive your Sevak ID.`);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const errorMessage = Array.isArray(detail)
        ? detail.map((item) => item.msg || item.message || String(item)).join(' ')
        : detail || err.message || 'Failed to register. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // SHARED COMPONENTS
  // ============================================================

  const submitButton = (
    <Button
      fullWidth
      variant="contained"
      size="large"
      type="button"
      onClick={handleSubmit}
      disabled={loading || !isFormValid()}
      sx={{ py: 2, mt: 2, borderRadius: 2, fontWeight: 'bold' }}
    >
      {loading ? <CircularProgress size={24} color="inherit" /> : 'Register for Onboarding'}
    </Button>
  );

  // ============================================================
  // MOBILE VERSION - PERSONAL INFO
  // ============================================================

  const mobilePersonalInfoFields = (
    <Grid container spacing={2} mb={4} justifyContent="center">
      <Grid item xs={12} sx={{ width: '100%' }}>
        <TextField
          fullWidth
          label="First Name"
          required
          value={formData.first_name}
          onChange={(e) => handleTextChange('first_name', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, first_name: validateField('first_name', formData.first_name) }))}
          error={Boolean(fieldErrors.first_name)}
          helperText={fieldErrors.first_name || ' '}
        />
      </Grid>
      <Grid item xs={12} sx={{ width: '100%' }}>
        <TextField
          fullWidth
          label="Last Name"
          required
          value={formData.last_name}
          onChange={(e) => handleTextChange('last_name', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, last_name: validateField('last_name', formData.last_name) }))}
          error={Boolean(fieldErrors.last_name)}
          helperText={fieldErrors.last_name || ' '}
        />
      </Grid>
      <Grid item xs={12} sx={{ width: '100%' }}>
        <TextField
          fullWidth
          label="Phone Number"
          required
          inputMode="numeric"
          inputProps={{ maxLength: 10 }}
          value={formData.phone}
          onChange={(e) => handleTextChange('phone', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, phone: validateField('phone', formData.phone) }))}
          error={Boolean(fieldErrors.phone)}
          helperText={' '}
        />
      </Grid>
      <Grid item xs={12} sx={{ width: '100%' }}>
        <TextField
          fullWidth
          label="Email Address"
          type="email"
          required
          value={formData.email}
          onChange={(e) => handleTextChange('email', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, email: validateField('email', formData.email) }))}
          error={Boolean(fieldErrors.email)}
          helperText={fieldErrors.email || ' '}
        />
      </Grid>
      <Grid item xs={12} sx={{ width: '100%' }}>
        <TextField
          fullWidth
          label="Password"
          type={showPassword ? 'text' : 'password'}
          required
          value={formData.password}
          onChange={(e) => handleTextChange('password', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, password: validateField('password', formData.password) }))}
          error={Boolean(fieldErrors.password)}
          helperText={fieldErrors.password || ' '}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255, 255, 255, 0.8)' } }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="toggle password visibility"
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  size="small"
                  color="primary"
                  type="button"
                >
                  {showPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Grid>
      <Grid item xs={12} sx={{ width: '100%' }}>
        <TextField
          fullWidth
          label="Confirm Password"
          type={showConfirmPassword ? 'text' : 'password'}
          required
          value={formData.confirm_password}
          onChange={(e) => handleTextChange('confirm_password', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, confirm_password: validateField('confirm_password', formData.confirm_password, formData) }))}
          error={Boolean(fieldErrors.confirm_password)}
          helperText={fieldErrors.confirm_password || ' '}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255, 255, 255, 0.8)' } }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="toggle confirm password visibility"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  edge="end"
                  size="small"
                  color="primary"
                  type="button"
                >
                  {showConfirmPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Grid>
      <Grid item xs={12} sx={{ width: '100%' }}>
        <TextField
          fullWidth
          label="Full Address"
          multiline
          rows={4}
          required
          value={formData.address}
          onChange={(e) => handleTextChange('address', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, address: validateField('address', formData.address) }))}
          error={Boolean(fieldErrors.address)}
          helperText={fieldErrors.address || ' '}
        />
      </Grid>
    </Grid>
  );

  // ============================================================
  // DESKTOP VERSION
  // ============================================================

  const desktopPersonalInfoFields = (
    <Grid container spacing={2} mb={4} >
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label="First Name"
          required
          value={formData.first_name}
          onChange={(e) => handleTextChange('first_name', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, first_name: validateField('first_name', formData.first_name) }))}
          error={Boolean(fieldErrors.first_name)}
          helperText={fieldErrors.first_name || ' '}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label="Last Name"
          required
          value={formData.last_name}
          onChange={(e) => handleTextChange('last_name', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, last_name: validateField('last_name', formData.last_name) }))}
          error={Boolean(fieldErrors.last_name)}
          helperText={fieldErrors.last_name || ' '}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label="Phone Number"
          required
          inputMode="numeric"
          inputProps={{ maxLength: 10 }}
          value={formData.phone}
          onChange={(e) => handleTextChange('phone', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, phone: validateField('phone', formData.phone) }))}
          error={Boolean(fieldErrors.phone)}
          helperText={' '}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label="Email Address"
          type="email"
          required
          value={formData.email}
          onChange={(e) => handleTextChange('email', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, email: validateField('email', formData.email) }))}
          error={Boolean(fieldErrors.email)}
          helperText={fieldErrors.email || ' '}
        />
      </Grid>
      <Grid item xs={12} sm={6} sx={{ width: '31%' }}>
        <TextField
          fullWidth
          label="Password"
          type={showPassword ? 'text' : 'password'}
          required
          value={formData.password}
          onChange={(e) => handleTextChange('password', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, password: validateField('password', formData.password) }))}
          error={Boolean(fieldErrors.password)}
          helperText={fieldErrors.password || ' '}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255, 255, 255, 0.8)' } }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="toggle password visibility"
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  size="small"
                  color="primary"
                  type="button"
                >
                  {showPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Grid>
      <Grid item xs={12} sm={6} sx={{ width: '31%' }}>
        <TextField
          fullWidth
          label="Confirm Password"
          type={showConfirmPassword ? 'text' : 'password'}
          required
          value={formData.confirm_password}
          onChange={(e) => handleTextChange('confirm_password', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, confirm_password: validateField('confirm_password', formData.confirm_password, formData) }))}
          error={Boolean(fieldErrors.confirm_password)}
          helperText={fieldErrors.confirm_password || ' '}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255, 255, 255, 0.8)' } }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="toggle confirm password visibility"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  edge="end"
                  size="small"
                  color="primary"
                  type="button"
                >
                  {showConfirmPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Grid>
      <Grid item xs={12} sx={{ width: '98%' }}>
        <TextField
          fullWidth
          label="Full Address"
          multiline
          rows={4}
          required
          value={formData.address}
          onChange={(e) => handleTextChange('address', e.target.value)}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, address: validateField('address', formData.address) }))}
          error={Boolean(fieldErrors.address)}
          helperText={fieldErrors.address || ' '}
        />
      </Grid>
    </Grid>
  );

  const desktopView = (
    <Box>
      <Typography variant="h6" fontWeight={800} textAlign="center" mb={4}>
        Personal Information
      </Typography>
      {desktopPersonalInfoFields}

      <Divider sx={{ mb: 4 }} />

      <Typography variant="h6" fontWeight={800} textAlign="center" mb={2}>
        Mandatory Documents
      </Typography>
      <Grid container spacing={3} mb={4} alignItems="stretch">
        {DOCUMENTS.map((doc) => (
          <Grid item xs={12} md={4} key={doc.name} sx={{ display: 'flex', minWidth: 245, width: "31.3%" }}>
            <Box
              sx={{
                p: 2,
                flex: 1,
                height: '100%',
                minHeight: { xs: 'auto', md: 232 },
                border: '1px solid',
                borderColor: fieldErrors[doc.name] ? 'error.main' : 'divider',
                borderRadius: 2,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                justifyContent: 'space-between',
                boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'rgba(25, 118, 210, 0.08)',
                    color: 'primary.main',
                    flexShrink: 0,
                  }}
                >
                  <DescriptionOutlinedIcon fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.2 }}>
                    {doc.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    PDF/JPG/JPEG/PNG (100KB-2MB)
                  </Typography>
                </Box>
              </Stack>

              <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <Button
                  variant="outlined"
                  type="button"
                  fullWidth
                  startIcon={<CloudUploadIcon />}
                  onClick={() => triggerFilePicker(doc.name)}
                  sx={{ borderRadius: 2, justifyContent: 'center' }}
                >
                  {files[doc.name].file ? 'Re-upload' : 'Upload'}
                </Button>
                <input
                  ref={(node) => {
                    fileInputRefs.current[doc.name] = node;
                  }}
                  type="file"
                  hidden
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => handleFileChange(e, doc.name)}
                />

                {(fileUploadErrors[doc.name] || fieldErrors[doc.name]) && (
                  <Typography variant="caption" color="error.main" sx={{ mt: 0.5 }}>
                    {fileUploadErrors[doc.name] || fieldErrors[doc.name]}
                  </Typography>
                )}

                {files[doc.name].file && (
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                    sx={{ mt: 1.25 }}
                  >
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      icon={<CheckCircleOutlineIcon fontSize="small" />}
                      label="Uploaded"
                    />
                    <Button
                      size="small"
                      type="button"
                      variant="text"
                      startIcon={<VisibilityOutlinedIcon fontSize="small" />}
                      onClick={(event) => {
                        setPreviewAnchorEl(event.currentTarget);
                        setPreviewDocName(doc.name);
                      }}
                      sx={{ fontWeight: 700, minWidth: 0 }}
                    >
                      Preview
                    </Button>
                  </Stack>
                )}

                {!files[doc.name].file && <Box sx={{ minHeight: 32 }} />}
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      {submitButton}

      {/* Desktop Popover Preview */}
      <Popover
        open={Boolean(previewAnchorEl) && Boolean(previewDocName)}
        anchorEl={previewAnchorEl}
        onClose={() => {
          setPreviewAnchorEl(null);
          setPreviewDocName('');
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              p: 1.5,
              borderRadius: 3,
              width: { xs: 280, sm: 360 },
              maxWidth: '90vw',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.18)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <Stack spacing={1}>
          <Typography variant="subtitle2" fontWeight={800}>
            Document Preview
          </Typography>
          <Box
            sx={{
              width: '100%',
              height: 260,
              borderRadius: 2,
              overflow: 'hidden',
              bgcolor: 'grey.100',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            {previewDocName && files[previewDocName]?.file?.type?.startsWith('image/') ? (
              <Box
                component="img"
                src={files[previewDocName].previewUrl}
                alt="Document preview"
                sx={{ width: '100%', height: '100%', objectFit: 'contain', bgcolor: 'white' }}
              />
            ) : (
              <Box
                component="iframe"
                title="Document preview"
                src={previewDocName ? files[previewDocName]?.previewUrl : ''}
                sx={{ width: '100%', height: '100%', border: 0, bgcolor: 'white' }}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            Preview opens inside the onboarding screen.
          </Typography>
        </Stack>
      </Popover>
    </Box>
  );

  // ============================================================
  // MOBILE VERSION
  // ============================================================

  const mobileView = (
    <Box>
      <Typography variant="h6" fontWeight={800} textAlign="center" mb={4}>
        Personal Information
      </Typography>
      {mobilePersonalInfoFields}

      <Divider sx={{ mb: 4 }} />

      <Typography variant="h6" fontWeight={800} textAlign="center" mb={2}>
        Mandatory Documents
      </Typography>
      <Grid container spacing={3} mb={4} alignItems="stretch">
        {DOCUMENTS.map((doc) => (
          <Grid item xs={12} key={doc.name} sx={{ display: 'flex', width: "100%" }}>
            <Box
              sx={{
                p: 2,
                flex: 1,
                border: '1px solid',
                borderColor: fieldErrors[doc.name] ? 'error.main' : 'divider',
                borderRadius: 2,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'rgba(25, 118, 210, 0.08)',
                    color: 'primary.main',
                    flexShrink: 0,
                  }}
                >
                  <DescriptionOutlinedIcon fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.2 }}>
                    {doc.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    PDF/JPG/JPEG/PNG (100KB-2MB)
                  </Typography>
                </Box>
              </Stack>

              <Box sx={{ mt: 4, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <Button
                  variant="outlined"
                  type="button"
                  fullWidth
                  startIcon={<CloudUploadIcon />}
                  onClick={() => triggerFilePicker(doc.name)}
                  sx={{ borderRadius: 2, justifyContent: 'center' }}
                >
                  {files[doc.name].file ? 'Re-upload' : 'Upload'}
                </Button>
                <input
                  ref={(node) => {
                    fileInputRefs.current[doc.name] = node;
                  }}
                  type="file"
                  hidden
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => handleFileChange(e, doc.name)}
                />

                {(fileUploadErrors[doc.name] || fieldErrors[doc.name]) && (
                  <Typography variant="caption" color="error.main" sx={{ mt: 0.5 }}>
                    {fileUploadErrors[doc.name] || fieldErrors[doc.name]}
                  </Typography>
                )}

                {files[doc.name].file && (
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                    sx={{ mt: 1.25 }}
                  >
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      icon={<CheckCircleOutlineIcon fontSize="small" />}
                      label="Uploaded"
                    />
                    <Button
                      size="small"
                      type="button"
                      variant="text"
                      startIcon={<OpenInNewIcon fontSize="small" />}
                      onClick={() => {
                        window.open(files[doc.name].previewUrl, '_blank');
                      }}
                      sx={{ fontWeight: 700, minWidth: 0 }}
                    >
                      Open
                    </Button>
                  </Stack>
                )}

                {!files[doc.name].file && <Box sx={{ minHeight: 32 }} />}
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      {submitButton}
    </Box>
  );

  // ============================================================
  // MAIN RENDER - Use CSS display to avoid focus loss on re-render
  // ============================================================

  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Paper sx={{ p: { xs: 3, md: 3 }, borderRadius: 2, boxShadow: 3 }}>
        <Box textAlign="center" mb={3}>
          <Typography variant="h3" fontWeight="bold" color="primary" gutterBottom>
            Sevak Onboarding
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Join the anix community. Please provide your details and mandatory documents.
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
        {success && (
          <Alert severity="success" sx={{ mb: 3 }}>
            {success} <a href="/login" style={{ color: '#f47c20', fontWeight: 'bold' }}>Go to login</a>.
          </Alert>
        )}

        {!success && (
          isMobile ? mobileView : desktopView
        )}
      </Paper>
    </Container>
  );
}
