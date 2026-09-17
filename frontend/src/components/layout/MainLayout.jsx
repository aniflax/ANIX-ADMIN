import React, { useState } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import {
  AppBar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Button,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  InputAdornment,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LogoutIcon from '@mui/icons-material/Logout';
import LockResetIcon from '@mui/icons-material/LockReset';
import PeopleIcon from '@mui/icons-material/People';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import HolidayVillageIcon from '@mui/icons-material/HolidayVillage';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PlaceIcon from '@mui/icons-material/Place';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CorporateFareIcon from '@mui/icons-material/CorporateFare';
import SettingsIcon from '@mui/icons-material/Settings';
import WarningIcon from '@mui/icons-material/Warning';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';

const drawerWidth = 240;

export default function MainLayout(props) {
  const { window } = props;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountMenuAnchor, setAccountMenuAnchor] = useState(null);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [pwData, setPwData] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const accountMenuOpen = Boolean(accountMenuAnchor);
  const displayName = user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Sevak';
  const displayRole = user?.role?.replace('_', ' ') || '';

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const closeAccountMenu = () => {
    setAccountMenuAnchor(null);
  };

  const handleOpenChangePassword = () => {
    closeAccountMenu();
    setChangePwOpen(true);
  };

  const closeChangePassword = () => {
    setChangePwOpen(false);
    setPwData({ current_password: '', new_password: '', confirm_password: '' });
    setPwError('');
    setPwSuccess('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess('');
    if (pwData.new_password !== pwData.confirm_password) {
      setPwError('Passwords do not match.');
      return;
    }
    setPwSubmitting(true);
    try {
      await api.post('/api/auth/change-password', {
        current_password: pwData.current_password,
        new_password: pwData.new_password,
      });
      setPwSuccess('Password changed successfully.');
      setPwData({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setPwError(err.response?.data?.detail || 'Failed to change password.');
    } finally {
      setPwSubmitting(false);
    }
  };

  const handleAccountLogout = () => {
    closeAccountMenu();
    logout();
  };

  const getNavItems = () => {
    const hasSelfAttendanceAndLeaves = user && ['SEVAK', 'HOD'].includes(user.role);
    const items = [
      { text: 'Dashboard', icon: <DashboardIcon />, path: '/' },
      { text: 'My Profile', icon: <PersonIcon />, path: '/profile' },
    ];

    if (hasSelfAttendanceAndLeaves) {
      items.push({ text: 'Attendance', icon: <PlaceIcon />, path: '/attendance' });
      items.push({ text: 'Leaves', icon: <HolidayVillageIcon />, path: '/leaves' });
    }

    if (user && ['SUPER_ADMIN', 'ADMIN', 'HR', 'HOD'].includes(user.role)) {
      items.push({ text: user.role === 'HOD' ? 'Department Directory' : 'Sevak Directory', icon: <PeopleIcon />, path: '/directory' });
    }

    if (user && user.role === 'HOD') {
      items.push({ text: 'Leave Approvals', icon: <FactCheckIcon />, path: '/leave/approvals' });
    }

    if (user && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role)) {
      items.push({ text: 'Departments', icon: <CorporateFareIcon />, path: '/departments' });
      items.push({ text: 'Leaves Admin', icon: <AdminPanelSettingsIcon />, path: '/leave/admin' });
      items.push({ text: 'Attendance Compliance', icon: <AssessmentIcon />, path: '/attendance/reports' });
      items.push({ text: 'Attendance Report', icon: <WarningIcon />, path: '/attendance/non-compliance' });
    }

    if (user && user.role === 'SUPER_ADMIN') {
      items.push({ text: 'Locations', icon: <PlaceIcon />, path: '/locations' });
      items.push({ text: 'Settings', icon: <SettingsIcon />, path: '/settings' });
    }

    if (user && ['SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
      items.push({ text: 'Account Management', icon: <AdminPanelSettingsIcon />, path: '/accounts' });
    }

    return items;
  };
  
  const navItems = getNavItems();

  const drawer = (
    <div>
      <Toolbar>
        <Typography
          variant="h6"
          noWrap
          component="div"
          sx={{
            fontWeight: 800,
            color: 'primary.main',
            letterSpacing: 0.3,
          }}
        >
          ANIX-HRMS
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {navItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              component={Link}
              to={item.path}
              selected={location.pathname === item.path}
              onClick={() => setMobileOpen(false)}
              sx={{
                mx: 1,
                my: 0.3,
                borderRadius: 2,
                '&.Mui-selected': {
                  backgroundColor: 'rgba(244,124,32,0.12)',
                  '&:hover': { backgroundColor: 'rgba(244,124,32,0.18)' },
                },
              }}
            >
              <ListItemIcon sx={{ color: location.pathname === item.path ? 'primary.main' : 'inherit' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                primaryTypographyProps={{
                  fontWeight: location.pathname === item.path ? 'bold' : 'normal',
                  color: location.pathname === item.path ? 'primary.main' : 'inherit'
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Divider />
      <List>
        <ListItem disablePadding>
          <ListItemButton onClick={logout}>
            <ListItemIcon>
              <LogoutIcon color="error" />
            </ListItemIcon>
            <ListItemText primary="Logout" sx={{ color: 'error.main' }} />
          </ListItemButton>
        </ListItem>
      </List>
    </div>
  );

  const container = window !== undefined ? () => window().document.body : undefined;

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, fontSize: { xs: '1rem', sm: '1.25rem' }, fontWeight: 800 }}>
            ANIX-HRMS
          </Typography>
          {user && (
            <>
              <Button
                color="inherit"
                onClick={(event) => setAccountMenuAnchor(event.currentTarget)}
                endIcon={<KeyboardArrowDownIcon fontSize="small" />}
                aria-controls={accountMenuOpen ? 'account-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={accountMenuOpen ? 'true' : undefined}
                sx={{
                  minWidth: 0,
                  maxWidth: { xs: 190, sm: 420 },
                  px: { xs: 1, sm: 1.5 },
                  py: 0.75,
                  borderRadius: 2,
                  color: 'inherit',
                  textAlign: 'right',
                  textTransform: 'none',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.14)' },
                  '& .MuiButton-endIcon': { ml: { xs: 0.25, sm: 0.75 } },
                }}
              >
                <Box
                  sx={{
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'flex-end',
                    gap: 0.75,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.15,
                      fontWeight: 800,
                    }}
                  >
                    {displayName}
                  </Typography>
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{
                      display: { xs: 'none', sm: 'inline' },
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.15,
                      fontWeight: 700,
                      opacity: 0.9,
                    }}
                  >
                    {displayRole}
                  </Typography>
                </Box>
              </Button>
              <Menu
                id="account-menu"
                anchorEl={accountMenuAnchor}
                open={accountMenuOpen}
                onClose={closeAccountMenu}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{
                  sx: {
                    mt: 1,
                    minWidth: 220,
                    borderRadius: 2,
                    '& .MuiMenuItem-root': {
                      gap: 1.5,
                      py: 1.1,
                      fontWeight: 700,
                    },
                  },
                }}
              >
                <MenuItem component={Link} to="/profile" onClick={closeAccountMenu}>
                  <PersonIcon fontSize="small" color="primary" />
                  My Profile
                </MenuItem>
                <MenuItem onClick={handleOpenChangePassword}>
                  <LockResetIcon fontSize="small" color="primary" />
                  Change Password
                </MenuItem>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem onClick={handleAccountLogout} sx={{ color: 'error.main' }}>
                  <LogoutIcon fontSize="small" color="error" />
                  Logout
                </MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>
      
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
        aria-label="mailbox folders"
      >
        {/* Mobile drawer */}
        <Drawer
          container={container}
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              background: 'linear-gradient(180deg, #fff7ef 0%, #ffffff 60%)',
            },
          }}
        >
          {drawer}
        </Drawer>
        {/* Desktop drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              background: 'linear-gradient(180deg, #fff7ef 0%, #ffffff 60%)',
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Main content area */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 1.5, sm: 3 },
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          minWidth: 0,
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>

      {/* Change Password dialog — lives in the layout so the top-right dropdown
          can open it on the current page without navigating. */}
      <Dialog
        open={changePwOpen}
        onClose={closeChangePassword}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: '100%' }, borderRadius: 3 } }}
      >
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent>
          {pwError && <Alert severity="error" sx={{ mb: 2 }}>{pwError}</Alert>}
          {pwSuccess && <Alert severity="success" sx={{ mb: 2 }}>{pwSuccess}</Alert>}
          <TextField
            margin="dense"
            label="Current Password"
            type={showCurrentPassword ? 'text' : 'password'}
            fullWidth
            variant="outlined"
            value={pwData.current_password}
            onChange={(e) => setPwData({ ...pwData, current_password: e.target.value })}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label="toggle current password visibility"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    edge="end"
                    size="small"
                    color="primary"
                  >
                    {showCurrentPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <TextField
            margin="dense"
            label="New Password"
            type={showNewPassword ? 'text' : 'password'}
            fullWidth
            variant="outlined"
            value={pwData.new_password}
            onChange={(e) => setPwData({ ...pwData, new_password: e.target.value })}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label="toggle new password visibility"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    edge="end"
                    size="small"
                    color="primary"
                  >
                    {showNewPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <TextField
            margin="dense"
            label="Confirm New Password"
            type={showConfirmPassword ? 'text' : 'password'}
            fullWidth
            variant="outlined"
            value={pwData.confirm_password}
            onChange={(e) => setPwData({ ...pwData, confirm_password: e.target.value })}
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
        </DialogContent>
        <DialogActions sx={{ p: 3, flexDirection: { xs: 'column-reverse', sm: 'row' }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, ml: { xs: '0 !important', sm: 1 } } }}>
          <Button onClick={closeChangePassword} disabled={pwSubmitting}>Cancel</Button>
          <Button onClick={handleChangePassword} variant="contained" color="primary" disabled={pwSubmitting}>
            {pwSubmitting ? 'Updating...' : 'Update Password'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
