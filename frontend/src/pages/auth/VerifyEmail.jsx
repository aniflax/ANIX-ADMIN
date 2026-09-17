import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Paper, Typography, Alert } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const getActivationParam = (searchParams, key) => {
  const directValue = searchParams.get(key);
  if (directValue) return directValue;

  if (typeof window === 'undefined') return null;

  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  const hashQuery = queryIndex >= 0 ? hash.slice(queryIndex + 1) : hash.replace(/^#/, '');
  return new URLSearchParams(hashQuery).get(key);
};

export default function ActivateAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setToken, setUser } = useAuth();
  const token = getActivationParam(searchParams, 'token');
  const employeeId = getActivationParam(searchParams, 'id') || getActivationParam(searchParams, 'employee_id');

  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [employeeIdAllocated, setEmployeeIdAllocated] = useState(null);
  const [checkingLink, setCheckingLink] = useState(true);

  useEffect(() => {
    const validateLink = async () => {
      if (!token || !employeeId) {
        setStatus('error');
        setMessage('Account activation link is invalid or has expired.');
        setCheckingLink(false);
        return;
      }

      try {
        await api.post('/api/auth/activate-account-validate', { token, employee_id: employeeId });
        const res = await api.post('/api/auth/activate-account', { token, employee_id: employeeId });
        setStatus('success');
        setEmployeeIdAllocated(res.data.employee_id);
        setMessage(res.data.message || 'Account activated successfully!');

        // Auto-login: store token and fetch user
        const accessToken = res.data.access_token;
        if (accessToken) {
          localStorage.setItem('token', accessToken);
          setToken(accessToken);
          const userRes = await api.get('/api/auth/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          setUser(userRes.data);
        }
      } catch (err) {
        setStatus('error');
        setMessage(err.response?.data?.detail || 'Account activation link is invalid or has expired.');
      } finally {
        setCheckingLink(false);
      }
    };

    validateLink();
  }, [token, employeeId, setToken, setUser]);

  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => navigate('/'), 3000);
      return () => clearTimeout(timer);
    }
  }, [status, navigate]);

  if (checkingLink) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
          background: 'linear-gradient(135deg, #fff5ec 0%, #fffaf4 45%, #ffffff 100%)',
        }}
      >
        <Paper sx={{ maxWidth: 520, width: '100%', p: 4, textAlign: 'center', borderRadius: 4 }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }} variant="h6">
            Activating your account...
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        background: 'linear-gradient(135deg, #fff5ec 0%, #fffaf4 45%, #ffffff 100%)',
      }}
    >
      <Paper sx={{ maxWidth: 520, width: '100%', p: 4, textAlign: 'center', borderRadius: 4 }}>
        {status === 'success' ? (
          <>
            <CheckCircleIcon sx={{ fontSize: 56, color: '#2e7d32' }} />
            <Typography variant="h5" fontWeight="bold" sx={{ mt: 2 }}>
              Account Activated
            </Typography>
            <Alert severity="success" sx={{ mt: 3, textAlign: 'left' }}>
              {message || 'Account activated successfully!'}
            </Alert>
            {employeeIdAllocated && (
              <Typography variant="body1" fontWeight={600} sx={{ mt: 2, color: 'primary.main' }}>
                You can now login with Employee ID: {employeeIdAllocated}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Redirecting to the application...
            </Typography>
          </>
        ) : (
          <>
            <CheckCircleIcon sx={{ fontSize: 56, color: '#d32f2f' }} />
            <Typography variant="h5" fontWeight="bold" sx={{ mt: 2 }}>
              Invalid Activation Link
            </Typography>
            <Alert severity="error" sx={{ mt: 3, textAlign: 'left' }}>
              {message || 'Account activation link is invalid or has expired.'}
            </Alert>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Please request a new activation link.
            </Typography>
            <Button sx={{ mt: 3 }} type="button" variant="contained" onClick={() => navigate('/login')}>
              Go to Login
            </Button>
          </>
        )}
      </Paper>
    </Box>
  );
}
