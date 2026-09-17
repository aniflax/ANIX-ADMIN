import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Grid, Card, CardContent, Chip, Alert,
  Avatar, Divider, CircularProgress, LinearProgress
} from '@mui/material';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import CakeIcon from '@mui/icons-material/Cake';
import EventIcon from '@mui/icons-material/Event';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import BeachAccessIcon from '@mui/icons-material/BeachAccess';
import SelfImprovementIcon from '@mui/icons-material/SelfImprovement';
import axios from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { formatDisplayDate } from '../utils/dateFormat';

const greetings = (name, hour) => {
  if (hour < 12) return `Good Morning, ${name}! ☀️`;
  if (hour < 17) return `Good Afternoon, ${name}! ☀️`;
  if (hour < 20) return `Good Evening, ${name}! 🌊`;
  return `Good Night, ${name}! 🌙`;
};

const warmMessages = [
  "Your service is a gift to the world. Thank you for being here today.",
  "Every small act of selfless service creates ripples of joy. Keep shining!",
  "Today is a new opportunity to serve with love and dedication.",
  "Your presence makes a difference. Have a wonderful and productive day!",
  "You are the heart of anix. Thank you for your dedication and devotion.",
  "May your day be filled with purpose, peace, and positivity!",
  "Together, we serve. Together, we grow. Have a beautiful day ahead!",
];

const HALF_DAY_PERIOD_LABELS = {
  FIRST_HALF: 'First Half',
  SECOND_HALF: 'Second Half',
};

export default function Dashboard() {
  const { user } = useAuth();
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);

  const hour = new Date().getHours();
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const warmMsg = warmMessages[dayOfYear % warmMessages.length];

  useEffect(() => {
    axios.get('/api/dashboard/events')
      .then(res => setEvents(res.data))
      .catch(() => setEvents(null))
      .finally(() => setLoading(false));
  }, []);

  const firstName = user?.first_name || 'Sevak';

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', width: '100%' }}>
      {/* Warm Greeting Header */}
      <Paper
        elevation={0}
        sx={{
          background: 'linear-gradient(135deg, #f47c20 0%, #d66a18 100%)',
          color: 'white',
          p: { xs: 2.5, sm: 4 },
          borderRadius: { xs: 2.5, sm: 3 },
          mb: 3,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Typography variant="h4" fontWeight="bold" gutterBottom sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' }, lineHeight: 1.2 }}>
            {greetings(firstName, hour)}
          </Typography>
          {events?.is_birthday && (
            <Alert
              icon={<CakeIcon />}
              severity="success"
              sx={{ mb: 2, backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: 'none' }}
            >
              🎂 Happy Birthday, {firstName}! Wishing you a wonderful day filled with joy and blessings! 🎉
            </Alert>
          )}
          <Typography variant="subtitle1" sx={{ opacity: 0.9, mb: 1 }}>
            <WbSunnyIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
            {warmMsg}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.75 }}>
            {user?.role?.replace('_', ' ')} • Sevak ID: {user?.sevak_id}
          </Typography>
        </Box>
        {/* Decorative circles */}
        <Box sx={{
          display: { xs: 'none', sm: 'block' },
          position: 'absolute', top: -40, right: -40, width: 180, height: 180,
          borderRadius: '50%', background: 'rgba(255,255,255,0.08)'
        }} />
        <Box sx={{
          display: { xs: 'none', sm: 'block' },
          position: 'absolute', bottom: -30, right: 80, width: 120, height: 120,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)'
        }} />
      </Paper>

      <Grid container spacing={3}>
        {/* Gurudev Quote */}
        <Grid item xs={12} md={7}>
          <Paper elevation={2} sx={{ p: 3, borderRadius: 3, height: '100%', borderLeft: '4px solid #d66a18' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
              <SelfImprovementIcon sx={{ color: '#d66a18', mr: 1 }} />
              <Typography variant="subtitle2" color="text.secondary" fontWeight="bold">
                GURUDEV'S WISDOM FOR TODAY
              </Typography>
            </Box>
            <FormatQuoteIcon sx={{ color: '#d66a18', fontSize: 28, opacity: 0.5 }} />
            <Typography variant="body1" sx={{ fontStyle: 'italic', color: 'text.primary', lineHeight: 1.8, mt: 0.5 }}>
              {events?.quote || "Love is not an emotion. It is your very existence."}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              — Gurudev Sri Sri Ravishankar
            </Typography>
          </Paper>
        </Grid>

        {/* Upcoming Leave Reminder */}
        <Grid item xs={12} md={5}>
          <Paper elevation={2} sx={{ p: 3, borderRadius: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <BeachAccessIcon sx={{ color: '#f4811f', mr: 1 }} />
              <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                YOUR UPCOMING LEAVE
              </Typography>
            </Box>
            {loading ? (
              <CircularProgress size={24} />
            ) : events?.upcoming_leave ? (
              <Box>
                <Chip label="Approved" color="success" size="small" sx={{ mb: 1 }} />
                <Typography variant="h6" fontWeight="bold">
                  {events.upcoming_leave.total_days} Day{events.upcoming_leave.total_days > 1 ? 's' : ''} Leave
                </Typography>
                {events.upcoming_leave.is_half_day && (
                  <Typography variant="body2" color="primary" fontWeight={700}>
                    {HALF_DAY_PERIOD_LABELS[events.upcoming_leave.half_day_period] || 'Half Day'}
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  Starting {formatDisplayDate(events.upcoming_leave.start_date)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Ends {formatDisplayDate(events.upcoming_leave.end_date)}
                </Typography>
                <Alert severity="info" sx={{ mt: 1.5, py: 0.5 }} icon={false}>
                  🏖️ Wishing you a relaxing and rejuvenating break!
                </Alert>
              </Box>
            ) : (
              <Box sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No upcoming approved leaves in the next 7 days.
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Enjoy your uninterrupted service! 🙏
                </Typography>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Today's Events (HR / HOD / Admin) */}
        {events?.events && events.events.length > 0 && (
          <Grid item xs={12}>
            <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <EventIcon sx={{ color: '#f47c20', mr: 1 }} />
                <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                  TODAY'S HIGHLIGHTS
                </Typography>
              </Box>
              <Grid container spacing={2}>
                {events.events.map((evt, i) => (
                  <Grid item xs={12} sm={6} md={4} key={i}>
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        {evt.type === 'BIRTHDAY' ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar sx={{ bgcolor: '#ff7043', width: 32, height: 32, fontSize: 16 }}>🎂</Avatar>
                            <Typography variant="body2">{evt.message}</Typography>
                          </Box>
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar sx={{ bgcolor: '#ffb74d', width: 32, height: 32, fontSize: 16 }}>🏖️</Avatar>
                            <Typography variant="body2">{evt.message}</Typography>
                          </Box>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          </Grid>
        )}

        {/* Quick Stats */}
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ borderRadius: 3, bgcolor: '#e8f5e9', border: '1px solid #c8e6c9' }}>
            <CardContent>
              <Typography variant="subtitle2" color="success.dark" gutterBottom>Role</Typography>
              <Typography variant="h6" fontWeight="bold" color="success.dark">
                {user?.role?.replace('_', ' ')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ borderRadius: 3, bgcolor: '#fff3e0', border: '1px solid #ffe0b2' }}>
            <CardContent>
              <Typography variant="subtitle2" color="primary.dark" gutterBottom>Sevak ID</Typography>
              <Typography variant="h6" fontWeight="bold" color="primary.dark">
                #{user?.sevak_id}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
