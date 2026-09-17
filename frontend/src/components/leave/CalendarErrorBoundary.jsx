import React from 'react';
import { Box, Typography, Alert } from '@mui/material';

/**
 * Catches render-time errors in its children and renders a safe fallback
 * instead of blanking the whole page. Used to wrap the shared month
 * calendar so a regression in the calendar cannot make the Calendar
 * History tab (employee) or the Leave Summary (HOD directory view)
 * inaccessible.
 */
export default class CalendarErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Surface the error so the dev console (or a log scraper) shows
    // exactly which component failed to render.
    console.error('[CalendarErrorBoundary] caught error:', error, info);
    this.setState({ info });
  }

  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      return (
        <Box sx={{ p: 2 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            The leave calendar failed to render.
            {error?.message ? ` (${error.message})` : ''}
          </Alert>
          {this.props.fallback || (
            <Typography variant="body2" color="text.secondary">
              You can still browse the Leave Details list below.
            </Typography>
          )}
        </Box>
      );
    }
    return this.props.children;
  }
}
