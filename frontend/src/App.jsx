import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme, alpha } from '@mui/material/styles';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import EmployeeDirectory from './pages/hr/EmployeeDirectory';
import Profile from './pages/employee/Profile';
import ApplyLeave from './pages/employee/ApplyLeave';
import Leaves from './pages/employee/Leaves';
import PendingApprovals from './pages/hod/PendingApprovals';
import LeaveAdmin from './pages/hr/LeaveAdmin';
import Attendance from './pages/employee/Attendance';
import AttendanceReports from './pages/hr/AttendanceReports';
import Onboarding from './pages/auth/Onboarding';
import Docs from './pages/auth/Docs';
import ResetPassword from './pages/auth/ResetPassword';
import ActivateAccount from './pages/auth/VerifyEmail';
import Departments from './pages/hr/Departments';
import Locations from './pages/hr/Locations';
import AccountManagement from './pages/admin/AccountManagement';
import Settings from './pages/superadmin/Settings';
import AttendanceReport from './pages/hr/AttendanceReport';
import EmployeeDirectoryRecordView from './pages/hr/EmployeeDirectoryRecordView';

const theme = createTheme({
  palette: {
    primary: {
      main: '#f47c20',
      light: '#ff9f4d',
      dark: '#d66a18',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#fdb813',
      light: '#ffd35f',
      dark: '#e0a20e',
      contrastText: '#3b2a14',
    },
    background: {
      default: '#fff8f2',
      paper: '#ffffff',
    },
    text: {
      primary: '#2f251c',
      secondary: '#6b5b4d',
    },
    divider: '#f3dfcf',
    info: {
      main: '#ef6c00',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: 'Cambria, "Plus Jakarta Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    h1: { fontFamily: 'Cambria, "Plus Jakarta Sans", Georgia, "Times New Roman", serif' },
    h2: { fontFamily: 'Cambria, "Plus Jakarta Sans", Georgia, "Times New Roman", serif' },
    h3: { fontFamily: 'Cambria, "Plus Jakarta Sans", Georgia, "Times New Roman", serif' },
    h4: { fontFamily: 'Cambria, "Plus Jakarta Sans", Georgia, "Times New Roman", serif' },
    h5: { fontFamily: 'Cambria, "Plus Jakarta Sans", Georgia, "Times New Roman", serif' },
    h6: { fontFamily: '"Plus Jakarta Sans", Georgia, "Times New Roman", serif' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #fff5ec 0%, #fffaf4 45%, #ffffff 100%)',
          color: '#2f251c',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(90deg, #f47c20 0%, #fdb813 100%)',
          color: '#ffffff',
          boxShadow: '0 10px 24px rgba(214, 106, 24, 0.28)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          border: '1px solid #f3dfcf',
          boxShadow: '0 10px 24px rgba(168, 98, 45, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid #f3dfcf',
          boxShadow: '0 10px 24px rgba(168, 98, 45, 0.08)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          textTransform: 'none',
          fontWeight: 700,
        },
        containedPrimary: {
          background: 'linear-gradient(90deg, #f47c20 0%, #fdb813 100%)',
          boxShadow: '0 10px 18px rgba(214, 106, 24, 0.28)',
          '&:hover': {
            background: 'linear-gradient(90deg, #d66a18 0%, #e5a00d 100%)',
            boxShadow: '0 12px 22px rgba(214, 106, 24, 0.34)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#f47c20',
            boxShadow: `0 0 0 2px ${alpha('#f47c20', 0.12)}`,
          },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          color: '#f47c20',
          '&:hover': { color: '#d66a18' },
        },
      },
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/activate-account" element={<ActivateAccount />} />

            <Route path="/" element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }>
              <Route index element={<Dashboard />} />
              <Route path="directory" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'HOD']}>
                  <EmployeeDirectory />
                </ProtectedRoute>
              } />
              <Route path="directory/:id/employee-records" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR', 'HOD']}>
                  <EmployeeDirectoryRecordView />
                </ProtectedRoute>
              } />
              {/* Backward compatibility redirects — ensuring these don't break based on path nesting */}
              <Route path="directory/:id/leave-summary" element={<Navigate to={`../employee-records`} replace />} />
              <Route path="directory/:id/attendance-log" element={<Navigate to={`../employee-records`} replace />} />
              <Route path="profile" element={<Profile />} />
              <Route path="profile/:id" element={<Profile />} />

              {/* Leaves – consolidated tab page for all employees */}
              <Route path="leaves" element={
                <ProtectedRoute allowedRoles={['EMPLOYEE', 'HOD']}>
                  <Leaves />
                </ProtectedRoute>
              } />
              {/* Legacy direct apply route kept for backward compat */}
              <Route path="leave/apply" element={
                <ProtectedRoute allowedRoles={['EMPLOYEE', 'HOD']}>
                  <ApplyLeave />
                </ProtectedRoute>
              } />
              <Route path="leave/approvals" element={
                <ProtectedRoute allowedRoles={['HOD']}>
                  <PendingApprovals />
                </ProtectedRoute>
              } />
              <Route path="leave/admin" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
                  <LeaveAdmin />
                </ProtectedRoute>
              } />
              {/* Alias for in-app navigation + email links (no slash) */}
              <Route path="leave-admin" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
                  <LeaveAdmin />
                </ProtectedRoute>
              } />

              <Route path="departments" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
                  <Departments />
                </ProtectedRoute>
              } />

              <Route path="locations" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <Locations />
                </ProtectedRoute>
              } />

              <Route path="attendance" element={
                <ProtectedRoute allowedRoles={['EMPLOYEE', 'HOD']}>
                  <Attendance />
                </ProtectedRoute>
              } />
              <Route path="attendance/reports" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
                  <AttendanceReports />
                </ProtectedRoute>
              } />

              <Route path="attendance/non-compliance" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
                  <AttendanceReport />
                </ProtectedRoute>
              } />

              <Route path="settings" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <Settings />
                </ProtectedRoute>
              } />

              {/* Account Management – Admin + SuperAdmin only */}
              <Route path="accounts" element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
                  <AccountManagement />
                </ProtectedRoute>
              } />

              {/* Other protected routes will go here */}
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;
