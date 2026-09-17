import React, { useEffect, useState } from 'react';
import {
  Box, Container, Paper, Typography, TextField, Button, Alert, CircularProgress,
  InputAdornment, IconButton
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const employeeId = searchParams.get('id');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [linkValid, setLinkValid] = useState(false);
  const [expiresAt, setExpiresAt] = useState(null);
  const [timeLeft, setTimeLeft] = useState('');

  // Decode JWT payload to show expiry time without verifying signature
  const decodeJwtPayload = (jwtToken) => {
    try {
      const base64Payload = jwtToken.split('.')[1];
      const payload = JSON.parse(atob(base64Payload.replace(/-/g, '+').replace(/_/g, '/')));
      return payload;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const validateLink = async () => {
      if (!token || !employeeId) {
        setError('Invalid reset link.');
        setCheckingLink(false);
        return;
      }

      const payload = decodeJwtPayload(token);
      if (payload?.exp) {
        setExpiresAt(new Date(payload.exp * 1000));
      }

      try {
        await api.post('/api/auth/reset-password-validate', {
          token,
          employee_id: employeeId
        });
        setLinkValid(true);
      } catch (err) {
        setError(err.response?.data?.detail || 'Reset link is invalid or has expired.');
      } finally {
        setCheckingLink(false);
      }
    };

    validateLink();
  }, [token, employeeId]);

  useEffect(() => {
    if (!expiresAt) return;
    const updateTimeLeft = () => {
      const diff = expiresAt - new Date();
      if (diff <= 0) {
        setTimeLeft('Expired');
        setLinkValid(false);
        setError('Reset link has expired.');
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}m ${seconds}s`);
    };
    updateTimeLeft();
    const interval = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/auth/reset-password-confirm', {
        token: token,
        employee_id: employeeId,
        new_password: password
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reset password. Link may be expired.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingLink) {
    return (
      <Container maxWidth="xs" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }} variant="body2" color="text.secondary">
          Verifying reset link...
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xs" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
        {!linkValid ? (
          <>
            <Typography variant="h5" align="center" fontWeight="bold" gutterBottom color="primary">
              Invalid Reset Link
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
              This password reset link is invalid or has expired. Please request a new reset link.
            </Typography>
            <Alert severity="error" sx={{ mb: 2 }}>
              {error || 'Reset link is invalid or has expired.'}
            </Alert>
            <Button fullWidth variant="contained" sx={{ mt: 1 }} onClick={() => navigate('/login')}>
              Back to Login
            </Button>
          </>
        ) : (
          <>
            <Typography variant="h5" align="center" fontWeight="bold" gutterBottom color="primary">
              Reset Password
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 1 }}>
              Enter your new password below.
            </Typography>
            {timeLeft && (
              <Typography variant="caption" align="center" display="block" color={timeLeft === 'Expired' ? 'error' : 'warning.main'} sx={{ mb: 2, fontWeight: 600 }}>
                Link expires in: {timeLeft}
              </Typography>
            )}

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {success && (
              <Alert severity="success" sx={{ mb: 2 }}>
                Password reset successfully! Redirecting to login...
              </Alert>
            )}

            {!success && (
              <Box component="form" onSubmit={handleSubmit}>
                <TextField
                  margin="normal"
                  fullWidth
                  label="New Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle password visibility"
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                          size="small"
                          color="primary"
                        >
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  margin="normal"
                  fullWidth
                  label="Confirm New Password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle confirm password visibility"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          edge="end"
                          size="small"
                          color="primary"
                        >
                          {showConfirmPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{ mt: 3, py: 1.5 }}
                  disabled={loading}
                >
                  {loading ? <CircularProgress size={24} color="inherit" /> : 'Update Password'}
                </Button>
              </Box>
            )}
          </>
        )}
      </Paper>
    </Container>
  );
}
